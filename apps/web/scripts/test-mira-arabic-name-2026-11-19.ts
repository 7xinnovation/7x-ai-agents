/**
 * Mira's name in Arabic is ميره (19 November 2026).
 *
 * Reported on EPGL: one conversation wrote ميرا in the greeting and ميره in the
 * next reply. The translator and the voice already pinned ميره; the chat prompt
 * did not, so the model picked a spelling each time. EPGL 1.x's configured
 * Arabic greeting also said ميرا — that is agent config, fixed per environment.
 */
import { AgentDefinition, emptyCase } from "@dialog/config";
import { buildSystemPrompt } from "@dialog/core";
import seed from "../../../packages/db/src/seed-agents.json" with { type: "json" };

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`); };

const raw = (seed as unknown as { agents: { definition: unknown }[] }).agents[0]!.definition;
const base = AgentDefinition.parse(raw);
const RULE = "YOUR NAME IN ARABIC IS ميره";

for (const locale of ["ar", "en"] as const) {
  const mira = { ...base, name: "EPGL Dialog", persona: "You are Mira, the licensing assistant." };
  const p = JSON.stringify(buildSystemPrompt(mira, emptyCase(mira.journeys[0]?.key ?? null), locale, false));
  check(`${locale}: an agent whose persona is Mira gets the rule`, p.includes(RULE));
  check(`${locale}: ...and it names both wrong spellings`, p.includes("Never ميرا and never ميرة"));
}
const other = { ...base, name: "Support", persona: "You are Sam, the support assistant." };
check("an agent not called Mira does not", !JSON.stringify(buildSystemPrompt(other, emptyCase(null), "ar", false)).includes(RULE));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
