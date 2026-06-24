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
  // True only when the spec EXPLICITLY marks this operation as secured (global
  // security, or a non-empty operation-level security). Specs that declare no
  // security at all leave this false — auth is then decided by the backend (a
  // 401/403 at call time), so public/guest endpoints are never pre-blocked.
  requiresAuth: boolean;
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

function tryJson(text: string): any | null {
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}
const isSpec = (j: any) => j && (j.openapi || j.swagger || j.paths);
const resolve = (href: string, base: string) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

/** Extract candidate spec URLs referenced inside an HTML/JS document. */
function refsIn(text: string, base: string): string[] {
  const out: string[] = [];
  const add = (h: string | undefined) => { if (!h) return; const u = resolve(h, base); if (u) out.push(u); };
  let m: RegExpExecArray | null;
  const fileRe = /["'`]([^"'`\s]+?\.(?:json|ya?ml))(?:[?#"'`])/gi;
  while ((m = fileRe.exec(text))) add(m[1]);
  const urlCfg = /\burls?\s*:\s*(?:\[\s*\{[^}]*url\s*:\s*)?["'`]([^"'`]+)["'`]/gi;
  while ((m = urlCfg.exec(text))) add(m[1]);
  return out;
}

function conventionUrls(specUrl: string): string[] {
  const dir = specUrl.replace(/[^/]*$/, "");
  const origin = (() => { try { return new URL(specUrl).origin; } catch { return ""; } })();
  const conv = ["openapi.json", "swagger.json", "v3/api-docs", "api-docs", "swagger/v1/swagger.json", "v2/api-docs", "openapi"];
  const out: string[] = [];
  for (const c of conv) {
    const a = resolve(c, dir);
    if (a) out.push(a);
    if (origin) out.push(`${origin}/${c}`);
  }
  return out;
}

async function loadSpec(specUrl: string): Promise<{ spec: any; resolvedUrl: string }> {
  const res = await fetch(specUrl, { headers: { Accept: "application/json, application/yaml;q=0.9, */*;q=0.5" } });
  if (!res.ok) throw new Error(`Could not fetch the URL (HTTP ${res.status}).`);
  const text = await res.text();
  const direct = tryJson(text);
  if (isSpec(direct)) return { spec: direct, resolvedUrl: specUrl };

  // Likely a Swagger-UI HTML page — discover the real spec.
  const candidates = new Set<string>(refsIn(text, specUrl));
  // Swagger UI keeps the spec URL in swagger-initializer.js / config scripts.
  const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((s) => s[1])
    .filter((s): s is string => !!s && /swagger|openapi|initializer|config|api-?docs/i.test(s))
    .slice(0, 4);
  for (const s of scripts) {
    const u = resolve(s, specUrl);
    if (!u) continue;
    try {
      const r = await fetch(u);
      if (r.ok) refsIn(await r.text(), u).forEach((c) => candidates.add(c));
    } catch {
      /* ignore */
    }
  }
  conventionUrls(specUrl).forEach((c) => candidates.add(c));

  let n = 0;
  for (const cand of candidates) {
    if (cand === specUrl || n++ >= 14) continue;
    try {
      const r = await fetch(cand, { headers: { Accept: "application/json, */*;q=0.5" } });
      if (!r.ok) continue;
      const j = tryJson(await r.text());
      if (isSpec(j)) return { spec: j, resolvedUrl: cand };
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "That URL returned a web page, not an OpenAPI spec. It looks like a Swagger UI docs page — paste the spec URL itself (it usually ends in /openapi.json, /swagger.json, or /v3/api-docs)."
  );
}

export async function parseSpec(specUrl: string, baseUrlOverride?: string): Promise<ParsedSpec> {
  const { spec, resolvedUrl } = await loadSpec(specUrl);
  const title: string = spec.info?.title ?? "API";
  const baseUrl = (baseUrlOverride || deriveBaseUrl(spec, resolvedUrl)).replace(/\/$/, "");

  const operations: ApiOperation[] = [];
  const paths = spec.paths ?? {};
  const methods = ["get", "post", "put", "patch", "delete"];
  const used = new Set<string>();
  // Global security applies unless an operation overrides it. Empty/absent = none.
  const globalSecured = Array.isArray(spec.security) && spec.security.length > 0;

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

      // Operation-level security overrides global: [] = public, [..] = secured.
      const requiresAuth = Array.isArray(op.security) ? op.security.length > 0 : globalSecured;

      operations.push({
        toolName,
        method: method.toUpperCase(),
        path,
        summary: op.summary || op.description || `${method.toUpperCase()} ${path}`,
        inputSchema: { type: "object", properties, required },
        params,
        hasBody,
        requiresAuth,
      });
    }
  }

  return { title, baseUrl, operations };
}
