/** Dev check for the tolerant ```upload block parser (FB-1425). */
import { resolveUploadKeys, type UploadCtx } from "../app/embed/[agent]/Markdown";

/**
 * `statuses` and `requirement` are not decoration here.
 *
 * The 15 September rule — a block naming a required document and an optional
 * one is about the required one — reads both, and this fixture carried
 * neither, so the resolver threw on `ctx.statuses[k]` before any case ran.
 * Every document below is mandatory and outstanding, which is the state these
 * cases were always about.
 */
const ctx = {
  docs: {
    agent_eid_front: { requirement: "mandatory" },
    agent_eid_back: { requirement: "mandatory" },
    trade_license: { requirement: "mandatory" },
  },
  statuses: {},
  pendingDocs: ["trade_license"],
} as unknown as UploadCtx;

const cases: [string, string[], string[]][] = [
  ["two key lines", ["key: agent_eid_front", "key: agent_eid_back"], ["agent_eid_front", "agent_eid_back"]],
  ["backticked key", ["key: `agent_eid_front`"], ["agent_eid_front"]],
  ["bullet keys", ["- agent_eid_front", "- agent_eid_back"], ["agent_eid_front", "agent_eid_back"]],
  ["bare key", ["trade_license"], ["trade_license"]],
  ["case/space variance", ["key: Agent EID Front"], ["agent_eid_front"]],
  ["unknown key falls back to pending", ["key: company_license_copy"], ["trade_license"]],
  ["empty body falls back to pending", [], ["trade_license"]],
];

let fail = 0;
for (const [name, body, expect] of cases) {
  const got = resolveUploadKeys(body, ctx);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}  → ${JSON.stringify(got)}`);
  if (!ok) fail++;
}
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("upload resolver OK");
