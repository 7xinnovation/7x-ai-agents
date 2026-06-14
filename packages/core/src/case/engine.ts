import type {
  AgentDefinition,
  Journey,
  FieldDef,
  CaseState,
  CaseDocument,
} from "@dialog/config";

/**
 * Pure case engine. The conversation's tools call these functions to mutate the
 * case; the UI renders the result. No LLM, no I/O — fully testable.
 */

export function findJourney(agent: AgentDefinition, key: string | null): Journey | undefined {
  if (!key) return undefined;
  return agent.journeys.find((j) => j.key === key);
}

/** Flatten all field defs across a journey's steps (groups kept intact). */
function journeyFields(journey: Journey): FieldDef[] {
  return journey.steps.flatMap((s) => s.fields);
}

/**
 * Tiny, safe condition evaluator for document `condition` expressions.
 * Supports: `key == 'value'`, `key != 'value'`, `key` (truthy). No code exec.
 */
export function evalCondition(expr: string | undefined, data: Record<string, unknown>): boolean {
  if (!expr) return true;
  const eq = expr.match(/^\s*([\w.]+)\s*(==|!=)\s*'([^']*)'\s*$/);
  if (eq) {
    const [, key, op, val] = eq;
    const actual = String(data[key!] ?? "");
    return op === "==" ? actual === val : actual !== val;
  }
  return Boolean(data[expr.trim()]);
}

export interface FieldValidationError {
  key: string;
  message: string;
}

/** Validate a single field value against its rules. Returns null if valid. */
export function validateField(field: FieldDef, value: unknown): FieldValidationError | null {
  const v = field.validation;
  const fail = (def: string): FieldValidationError => ({
    key: field.key,
    message: field.validation.message?.en ?? def,
  });
  if (value === undefined || value === null || value === "") {
    return v.required ? fail(`${field.key} is required`) : null;
  }
  if (field.type === "percentage" || field.type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return fail(`${field.key} must be a number`);
    if (v.min !== undefined && n < v.min) return fail(`${field.key} must be ≥ ${v.min}`);
    if (v.max !== undefined && n > v.max) return fail(`${field.key} must be ≤ ${v.max}`);
  }
  if (typeof value === "string") {
    if (v.minLength && value.length < v.minLength) return fail(`${field.key} is too short`);
    if (v.maxLength && value.length > v.maxLength) return fail(`${field.key} is too long`);
    if (v.pattern && !new RegExp(v.pattern).test(value)) return fail(`${field.key} has an invalid format`);
  }
  if (field.type === "group" && v.sumChildrenEquals !== undefined && Array.isArray(value)) {
    // Sum the first numeric child across rows (e.g. shareholder percentages).
    const numericChild = field.children?.find((c) => c.type === "percentage" || c.type === "number");
    if (numericChild) {
      const total = (value as Record<string, unknown>[]).reduce(
        (s, row) => s + Number(row[numericChild.key] ?? 0),
        0
      );
      if (total !== v.sumChildrenEquals) {
        return fail(`${field.key} must sum to ${v.sumChildrenEquals} (currently ${total})`);
      }
    }
  }
  return null;
}

/** Apply a collected field value, validating first. Returns updated state or error. */
export function setField(
  agent: AgentDefinition,
  state: CaseState,
  key: string,
  value: unknown
): { state: CaseState; error?: FieldValidationError } {
  const journey = findJourney(agent, state.journeyKey);
  const field = journey ? journeyFields(journey).find((f) => f.key === key) : undefined;
  if (field) {
    const error = validateField(field, value);
    if (error) return { state, error };
  }
  const next: CaseState = { ...state, data: { ...state.data, [key]: value } };
  return { state: recomputeReadiness(agent, next) };
}

/** Record/replace a document's status. */
export function setDocument(
  agent: AgentDefinition,
  state: CaseState,
  doc: CaseDocument
): CaseState {
  const documents = [...state.documents.filter((d) => d.key !== doc.key), doc];
  return recomputeReadiness(agent, { ...state, documents });
}

/** Recompute submission readiness against the active journey (PRD readiness check). */
export function recomputeReadiness(agent: AgentDefinition, state: CaseState): CaseState {
  const journey = findJourney(agent, state.journeyKey);
  if (!journey) {
    return { ...state, readiness: { complete: false, missing: [] } };
  }
  const missing: CaseState["readiness"]["missing"] = [];

  for (const field of journeyFields(journey)) {
    if (!field.validation.required) continue;
    const present = state.data[field.key] !== undefined && state.data[field.key] !== "";
    const valid = present && !validateField(field, state.data[field.key]);
    if (!valid) missing.push({ key: field.key, kind: "field" });
  }

  for (const step of journey.steps) {
    for (const reqDoc of step.documents) {
      if (reqDoc.requirement !== "mandatory") continue;
      if (!evalCondition(reqDoc.condition, state.data)) continue;
      const uploaded = state.documents.find(
        (d) => d.key === reqDoc.key && (d.status === "uploaded" || d.status === "accepted")
      );
      if (!uploaded) missing.push({ key: reqDoc.key, kind: "document" });
    }
  }

  const complete = missing.length > 0 ? false : Boolean(journey.steps.length);
  const status: CaseState["status"] =
    state.status === "submitted" || state.status === "escalated"
      ? state.status
      : complete
        ? "ready"
        : "draft";
  return { ...state, readiness: { complete, missing }, status };
}

/** Set the active journey and reset step to the first. */
export function setJourney(agent: AgentDefinition, state: CaseState, journeyKey: string): CaseState {
  const journey = findJourney(agent, journeyKey);
  const next: CaseState = {
    ...state,
    journeyKey,
    currentStep: journey?.steps[0]?.key ?? null,
  };
  return recomputeReadiness(agent, next);
}
