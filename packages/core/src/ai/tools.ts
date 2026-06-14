import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, CaseState } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { adapterContext } from "../adapters/registry";
import { setField, setDocument, setJourney, findJourney } from "../case/engine";

/** Tool schemas exposed to Claude. Generic across every agent/journey. */
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the approved knowledge base for grounded passages. Use BEFORE answering any licensing/compliance/policy question.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "set_journey",
    description: "Start or switch the active journey (e.g. new_license, renewal) once intent is clear.",
    input_schema: {
      type: "object",
      properties: { journey_key: { type: "string" } },
      required: ["journey_key"],
    },
  },
  {
    name: "collect_field",
    description:
      "Record one collected field value into the case. The value is validated; if invalid you receive a corrective message to relay.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { description: "string, number, boolean, or array for group fields" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "record_document",
    description:
      "Record the status of a required document (pending/uploaded/accepted/rejected). Actual file bytes are handled by the upload UI.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        status: { type: "string", enum: ["pending", "uploaded", "accepted", "rejected"] },
        file_name: { type: "string" },
        rejection_reason: { type: "string" },
      },
      required: ["key", "status"],
    },
  },
  {
    name: "submit_case",
    description: "Submit the completed case to the system of record. Only call when readiness is complete and the user confirms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_escalation",
    description: "File a human callback request in the system of record.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "request_authentication",
    description: "Signal that the user must sign in before a transactional action can proceed.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

export type ToolEvent =
  | { type: "case"; state: CaseState }
  | { type: "citation"; source: string }
  | { type: "escalation"; reference: string }
  | { type: "auth_required"; reason: string }
  | { type: "submitted"; reference: string };

export interface DispatchInput {
  agent: AgentDefinition;
  state: CaseState;
  adapters: AdapterBundle;
  authenticated: boolean;
  userRef?: string;
  locale: string;
  agentId: string;
}

export interface DispatchResult {
  result: string; // tool_result content returned to the model
  state: CaseState;
  events: ToolEvent[];
  isError?: boolean;
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DispatchInput
): Promise<DispatchResult> {
  const { agent, adapters } = ctx;
  let state = ctx.state;
  const events: ToolEvent[] = [];

  switch (name) {
    case "search_knowledge": {
      if (!adapters.knowledge) return { result: "No knowledge base configured.", state, events };
      const actx = adapterContext(agent, agent.integrations.knowledge);
      const hits = await adapters.knowledge.search(actx, {
        agentId: ctx.agentId,
        query: String(input.query ?? ""),
        locale: ctx.locale,
      });
      for (const h of hits) events.push({ type: "citation", source: h.source });
      if (!hits.length) return { result: "No relevant passages found in the approved knowledge base.", state, events };
      return {
        result: hits.map((h, i) => `[${i + 1}] (${h.source})\n${h.content}`).join("\n\n"),
        state,
        events,
      };
    }

    case "set_journey": {
      const key = String(input.journey_key ?? "");
      const journey = findJourney(agent, key);
      if (!journey) return { result: `Unknown journey "${key}".`, state, events, isError: true };
      if (journey.requiresAuth && !ctx.authenticated) {
        events.push({ type: "auth_required", reason: `Starting ${journey.key} requires sign-in.` });
        return { result: "This journey requires an authenticated user. Ask them to sign in.", state, events };
      }
      state = setJourney(agent, state, key);
      events.push({ type: "case", state });
      return { result: `Journey set to ${key}. First step: ${state.currentStep}.`, state, events };
    }

    case "collect_field": {
      const { state: next, error } = setField(agent, state, String(input.key), input.value);
      if (error) return { result: `Validation failed: ${error.message}`, state, events, isError: true };
      state = next;
      events.push({ type: "case", state });
      return { result: `Saved ${input.key}. Readiness: ${state.readiness.complete ? "complete" : `missing ${state.readiness.missing.map((m) => m.key).join(", ")}`}.`, state, events };
    }

    case "record_document": {
      state = setDocument(agent, state, {
        key: String(input.key),
        status: input.status as CaseState["documents"][number]["status"],
        fileName: input.file_name as string | undefined,
        rejectionReason: input.rejection_reason as string | undefined,
      });
      events.push({ type: "case", state });
      return { result: `Document ${input.key} -> ${input.status}.`, state, events };
    }

    case "request_authentication": {
      events.push({ type: "auth_required", reason: String(input.reason ?? "") });
      return { result: "Authentication prompt surfaced to the user.", state, events };
    }

    case "request_escalation": {
      if (!adapters.crm) return { result: "No CRM configured for escalation.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.crm);
      const { reference } = await adapters.crm.createCallback(actx, {
        name: String(input.name ?? "Unknown"),
        phone: String(input.phone ?? ""),
        email: input.email as string | undefined,
        reason: String(input.reason ?? ""),
        userRef: ctx.userRef,
      });
      state = { ...state, status: "escalated" };
      events.push({ type: "escalation", reference });
      events.push({ type: "case", state });
      return { result: `Callback created with reference ${reference}.`, state, events };
    }

    case "submit_case": {
      if (!ctx.authenticated) {
        events.push({ type: "auth_required", reason: "Submission requires sign-in." });
        return { result: "User must authenticate before submission.", state, events };
      }
      if (!state.readiness.complete) {
        return {
          result: `Cannot submit — missing: ${state.readiness.missing.map((m) => `${m.key} (${m.kind})`).join(", ")}.`,
          state,
          events,
          isError: true,
        };
      }
      if (!adapters.crm) return { result: "No CRM configured.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.crm);
      // Duplicate guard (PRD: surface existing reference instead of creating a duplicate).
      const dup = await adapters.crm.findDuplicate?.(actx, {
        journeyKey: state.journeyKey!,
        data: state.data,
      });
      if (dup) {
        return { result: `An active request already exists: ${dup.reference}. Surface it instead of creating a duplicate.`, state, events };
      }
      const { reference } = await adapters.crm.createCase(actx, {
        journeyKey: state.journeyKey!,
        data: state.data,
        userRef: ctx.userRef,
      });
      state = { ...state, status: "submitted", reference };
      events.push({ type: "submitted", reference });
      events.push({ type: "case", state });
      return { result: `Submitted. Reference: ${reference}.`, state, events };
    }

    default:
      return { result: `Unknown tool ${name}.`, state, events, isError: true };
  }
}
