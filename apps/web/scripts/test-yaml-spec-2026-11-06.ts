/**
 * js-yaml 5.2.1 → 5.5.x (6 November 2026, security audit: a merge-key DoS).
 * The one place it is used is reading an OpenAPI spec published as YAML; this
 * checks that still produces the same operations, and that the DoS shape is
 * refused or bounded rather than hanging.
 *
 * Run from apps/web:  npx tsx scripts/test-yaml-spec-2026-11-06.ts
 */
import { load } from "js-yaml";
import { parseSpecDocument } from "../lib/openapi";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : JSON.stringify(extra ?? ""));
  ok ? pass++ : fail++;
};
const y = `openapi: 3.0.0
info: {title: T, version: "1"}
servers: [{url: "https://api.example.ae"}]
paths:
  /api/Rental/Bundle:
    get:
      operationId: bundles
      parameters: [{name: request, in: query, required: true, schema: {type: string}}]
      responses: {"200": {description: ok}}
  /api/Rental/Select:
    post:
      operationId: select
      requestBody: {content: {application/json: {schema: {type: object, properties: {bundleId: {type: string}}}}}}
      responses: {"200": {description: ok}}
`;
const p = parseSpecDocument(load(y), "https://api.example.ae/spec.yaml");
check("a YAML spec still parses into its operations", p.operations.length === 2, p.operations.map((o) => `${o.method} ${o.path}`));
check("...with method and path", p.operations.some((o) => o.method.toUpperCase() === "GET" && o.path === "/api/Rental/Bundle"));
check("...and the server as the base URL", (p as unknown as { baseUrl?: string }).baseUrl === "https://api.example.ae", (p as unknown as { baseUrl?: string }).baseUrl);

const t0 = Date.now();
let refused = false;
try {
  load(`arr: &arr [${Array(2000).fill("{}").join(",")}]\n` + Array.from({ length: 2000 }, (_, i) => `t${i}: {<<: *arr}`).join("\n"));
} catch {
  refused = true;
}
check("the empty-mapping merge attack is refused or bounded", refused || Date.now() - t0 < 2000, { refused, ms: Date.now() - t0 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
