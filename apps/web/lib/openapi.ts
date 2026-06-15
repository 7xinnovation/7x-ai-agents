/**
 * Minimal OpenAPI 3 / Swagger 2 parser. Fetches a spec and converts each
 * operation into a callable "tool" the agent can invoke: a JSON-schema input
 * plus the metadata needed to execute the HTTP request at runtime.
 */

export interface ApiOperation {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  // Anthropic tool input schema (object of params + optional `body`).
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  // Parameter routing for execution.
  params: { name: string; in: "path" | "query" | "header" }[];
  hasBody: boolean;
}

export interface ParsedSpec {
  title: string;
  baseUrl: string;
  operations: ApiOperation[];
}

const MAX_OPS = 40;

function mapType(schema: any): string {
  const t = schema?.type;
  if (t === "integer" || t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "array") return "array";
  if (t === "object") return "object";
  return "string";
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "op";
}

function deriveBaseUrl(spec: any, specUrl: string): string {
  // OpenAPI 3
  const server = spec.servers?.[0]?.url;
  if (server) {
    if (/^https?:\/\//.test(server)) return server.replace(/\/$/, "");
    try {
      return new URL(server, specUrl).toString().replace(/\/$/, "");
    } catch {
      /* ignore */
    }
  }
  // Swagger 2
  if (spec.host) {
    const scheme = spec.schemes?.includes("https") ? "https" : spec.schemes?.[0] ?? "https";
    return `${scheme}://${spec.host}${spec.basePath ?? ""}`.replace(/\/$/, "");
  }
  // Fallback: origin of the spec URL
  try {
    const u = new URL(specUrl);
    return `${u.origin}`;
  } catch {
    return "";
  }
}

export async function parseSpec(specUrl: string, baseUrlOverride?: string): Promise<ParsedSpec> {
  const res = await fetch(specUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Could not fetch spec (${res.status})`);
  const spec: any = await res.json();
  const title: string = spec.info?.title ?? "API";
  const baseUrl = (baseUrlOverride || deriveBaseUrl(spec, specUrl)).replace(/\/$/, "");

  const operations: ApiOperation[] = [];
  const paths = spec.paths ?? {};
  const methods = ["get", "post", "put", "patch", "delete"];
  const used = new Set<string>();

  for (const [path, item] of Object.entries<any>(paths)) {
    if (operations.length >= MAX_OPS) break;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of methods) {
      const op = item[method];
      if (!op || operations.length >= MAX_OPS) continue;

      const rawId = op.operationId || `${method}_${path}`;
      let toolName = sanitize(rawId);
      while (used.has(toolName)) toolName = sanitize(`${toolName}_${used.size}`);
      used.add(toolName);

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const params: ApiOperation["params"] = [];

      const allParams = [...shared, ...(op.parameters ?? [])];
      for (const p of allParams) {
        if (!p?.name || p.in === "cookie") continue;
        const where = p.in as "path" | "query" | "header";
        if (where !== "path" && where !== "query" && where !== "header") continue;
        properties[p.name] = {
          type: mapType(p.schema ?? p),
          description: p.description ?? `${p.in} parameter`,
        };
        params.push({ name: p.name, in: where });
        if (p.required || where === "path") required.push(p.name);
      }

      // Request body (OA3) or body param (Swagger 2)
      let hasBody = false;
      const oa3Body = op.requestBody?.content?.["application/json"]?.schema;
      const sw2Body = (op.parameters ?? []).find((p: any) => p.in === "body");
      if (oa3Body || sw2Body) {
        hasBody = true;
        properties["body"] = { type: "object", description: "JSON request body" };
        if (op.requestBody?.required || sw2Body?.required) required.push("body");
      }

      operations.push({
        toolName,
        method: method.toUpperCase(),
        path,
        summary: op.summary || op.description || `${method.toUpperCase()} ${path}`,
        inputSchema: { type: "object", properties, required },
        params,
        hasBody,
      });
    }
  }

  return { title, baseUrl, operations };
}
