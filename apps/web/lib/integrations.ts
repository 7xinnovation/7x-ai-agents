import type Anthropic from "@anthropic-ai/sdk";
import { getDb, agentIntegrations } from "@dialog/db";
import { and, eq, desc } from "drizzle-orm";
import type { ApiOperation } from "./openapi";

export interface IntegrationRow {
  id: string;
  name: string;
  specUrl: string;
  baseUrl: string;
  authType: "none" | "bearer" | "apiKey";
  authValue: string | null;
  authHeader: string | null;
  operations: ApiOperation[];
  enabled: boolean;
}

export async function listIntegrations(agentId: string): Promise<IntegrationRow[]> {
  const rows = await getDb()
    .select()
    .from(agentIntegrations)
    .where(eq(agentIntegrations.agentId, agentId))
    .orderBy(desc(agentIntegrations.createdAt));
  return rows as unknown as IntegrationRow[];
}

export async function createIntegration(agentId: string, input: Omit<IntegrationRow, "id" | "enabled">) {
  const [row] = await getDb()
    .insert(agentIntegrations)
    .values({
      agentId,
      name: input.name,
      specUrl: input.specUrl,
      baseUrl: input.baseUrl,
      authType: input.authType,
      authValue: input.authValue,
      authHeader: input.authHeader,
      operations: input.operations as unknown as Record<string, unknown>[],
      enabled: true,
    })
    .returning();
  return row;
}

export async function setIntegrationEnabled(agentId: string, id: string, enabled: boolean) {
  await getDb().update(agentIntegrations).set({ enabled }).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

export async function deleteIntegration(agentId: string, id: string) {
  await getDb().delete(agentIntegrations).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

const prefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

/**
 * Build Claude tools + an executor from an agent's enabled integrations.
 * Each OpenAPI operation becomes a tool; calling it performs the HTTP request.
 */
export async function buildApiTools(agentId: string): Promise<{
  tools: Anthropic.Tool[];
  exec: (toolName: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
}> {
  const integrations = (await listIntegrations(agentId)).filter((i) => i.enabled);
  const tools: Anthropic.Tool[] = [];
  const map = new Map<string, { intg: IntegrationRow; op: ApiOperation }>();

  for (const intg of integrations) {
    const pfx = prefix(intg.name);
    for (const op of intg.operations) {
      const toolName = `${pfx}__${op.toolName}`.slice(0, 64);
      if (map.has(toolName)) continue;
      map.set(toolName, { intg, op });
      tools.push({
        name: toolName,
        description: `[${intg.name}] ${op.summary}`.slice(0, 380),
        input_schema: op.inputSchema as Anthropic.Tool["input_schema"],
      });
    }
  }

  const exec = async (toolName: string, input: Record<string, unknown>) => {
    const entry = map.get(toolName);
    if (!entry) return { result: `Unknown integration tool ${toolName}.`, isError: true };
    return executeOperation(entry.intg, entry.op, input ?? {});
  };

  return { tools, exec };
}

export async function executeOperation(
  intg: IntegrationRow,
  op: ApiOperation,
  input: Record<string, unknown>
): Promise<{ result: string; isError?: boolean }> {
  try {
    let path = op.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { Accept: "application/json" };

    for (const p of op.params) {
      const v = input[p.name];
      if (v === undefined || v === null || v === "") continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
      else if (p.in === "query") query.set(p.name, String(v));
      else if (p.in === "header") headers[p.name] = String(v);
    }

    if (intg.authType === "bearer" && intg.authValue) headers["Authorization"] = `Bearer ${intg.authValue}`;
    if (intg.authType === "apiKey" && intg.authValue) headers[intg.authHeader || "X-API-Key"] = intg.authValue;

    let body: string | undefined;
    if (op.hasBody && input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }

    const qs = query.toString();
    const url = `${intg.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method: op.method, headers, body, signal: ctrl.signal });
    clearTimeout(timer);

    const text = await res.text();
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "…(truncated)" : text;
    return { result: `HTTP ${res.status} ${res.statusText}\n${trimmed}`, isError: !res.ok };
  } catch (e) {
    return { result: `Integration call failed: ${e instanceof Error ? e.message : "error"}`, isError: true };
  }
}
