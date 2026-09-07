import { load as yamlLoad } from "js-yaml";
import { safeFetch } from "./outboundUrl";

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

// Upper bound on operations imported from one spec. Large specs (e.g. the NXN
// PO Box API has 48) must import fully; per-operation enable/disable then curates
// which become tools.
const MAX_OPS = 200;

function mapType(schema: any): string {
  const t = schema?.type;
  if (t === "integer" || t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "array") return "array";
  if (t === "object") return "object";
  return "string";
}

/**
 * Resolve a request-body schema into something the model can actually follow.
 *
 * This used to collapse EVERY body to `{ type: "object" }` with the description
 * "JSON request body" — the model was told an object goes here and nothing about
 * what belongs in it, so it guessed. On Emirates Post that produced
 * `POST /api/Rental/Save -> 400 {"TotalAmount":["Total Amount is required"],
 * "UserProfile":[...],"PaymentProperties":[...],"SubscriptionReferenceNumber":[...]}`
 * AFTER the customer had paid, and the agent reported it as a fault on their side.
 *
 * So dereference it. $refs are followed against components.schemas (OA3) and
 * definitions (Swagger 2), with a depth cap and a seen-set, because these specs
 * are full of cycles (an Address that contains an Address) and a naive walk never
 * returns. Past the cap the branch degrades to a bare type rather than vanishing.
 */
const BODY_MAX_DEPTH = 4;
const BODY_MAX_CHARS = 12000;

function resolveRef(ref: string, doc: any): any {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let node = doc;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) return null;
  }
  return node;
}

function deref(schema: any, doc: any, depth = 0, seen: Set<string> = new Set()): any {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const ref: string = schema.$ref;
    // A type that contains itself: keep the name, drop the recursion.
    if (seen.has(ref) || depth >= BODY_MAX_DEPTH) return { type: "object", description: ref.split("/").pop() };
    const target = resolveRef(ref, doc);
    if (!target) return { type: "object" };
    return deref(target, doc, depth, new Set([...seen, ref]));
  }
  if (depth >= BODY_MAX_DEPTH) return { type: mapType(schema) };

  const out: Record<string, unknown> = {};
  if (schema.type) out.type = schema.type;
  if (schema.format) out.format = schema.format;
  if (schema.enum) out.enum = schema.enum;
  if (schema.description) out.description = schema.description;
  // required is the whole point of this: it is what the backend rejects on.
  if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required;
  if (schema.items) out.items = deref(schema.items, doc, depth + 1, seen);
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) props[k] = deref(v, doc, depth + 1, seen);
    out.properties = props;
    if (!out.type) out.type = "object";
  }
  // allOf is how these specs express inheritance; merge the members.
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key])) {
      const parts = schema[key].map((x: any) => deref(x, doc, depth, seen));
      if (key === "allOf") {
        const merged: Record<string, unknown> = { type: "object", properties: {}, required: [] as string[] };
        for (const part of parts) {
          Object.assign(merged.properties as object, part?.properties ?? {});
          if (Array.isArray(part?.required)) (merged.required as string[]).push(...part.required);
        }
        if (!(merged.required as string[]).length) delete merged.required;
        return merged;
      }
      out[key] = parts;
    }
  }
  return Object.keys(out).length ? out : { type: mapType(schema) };
}

/** Dereferenced body schema, or a plain object if it resolves to nothing useful. */
function bodySchema(raw: any, doc: any): Record<string, unknown> {
  const fallback = { type: "object", description: "JSON request body" };
  try {
    const resolved = deref(raw, doc);
    if (!resolved?.properties || !Object.keys(resolved.properties).length) return fallback;
    // A body schema that dwarfs the prompt helps nobody; every operation carries
    // one and they all ride in the tool definitions on every single turn.
    if (JSON.stringify(resolved).length > BODY_MAX_CHARS) {
      return {
        type: "object",
        description: "JSON request body",
        properties: resolved.properties,
        ...(resolved.required ? { required: resolved.required } : {}),
      };
    }
    return { description: "JSON request body", ...resolved };
  } catch {
    return fallback;
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "op";
}

function deriveBaseUrl(spec: any, specUrl: string): string {
  // OpenAPI 3
  let server = spec.servers?.[0]?.url as string | undefined;
  if (server) {
    // Substitute server variables with their declared defaults
    // (e.g. https://{myDomain}--{sandboxName}.sandbox.my.salesforce.com).
    const vars = spec.servers?.[0]?.variables ?? {};
    server = server.replace(/\{([^}]+)\}/g, (m: string, name: string) => vars[name]?.default ?? m);
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
    /* fall through to YAML */
  }
  // Many teams ship OpenAPI as YAML (e.g. Salesforce contracts). Only accept a
  // parse that actually looks like a spec/object — YAML happily parses HTML too.
  try {
    const y = yamlLoad(text);
    return y && typeof y === "object" ? y : null;
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
  // Fetched on an admin's instruction, so the URL is checked before it is
  // reached: the address that matters is 169.254.169.254, which answers only
  // from inside the host and hands out its credentials. See lib/outboundUrl.
  const res = await safeFetch(specUrl, { headers: { Accept: "application/json, application/yaml;q=0.9, */*;q=0.5" } });
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
      const r = await safeFetch(u);
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
      const r = await safeFetch(cand, { headers: { Accept: "application/json, */*;q=0.5" } });
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
        properties["body"] = bodySchema(oa3Body ?? sw2Body?.schema, spec);
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
