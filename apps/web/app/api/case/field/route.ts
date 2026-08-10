import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setField, findJourney } from "@dialog/core";
import { getAgentBySlug } from "@/lib/agents";
import { getCase, saveCase, audit } from "@/lib/conversation";

export const runtime = "nodejs";

/**
 * Inline correction of a captured value (Round-1-internal feedback FB-1325: a
 * pencil icon lets the customer fix a limited set of extracted items without
 * re-typing everything in chat). Guard-rails:
 *  - only fields declared on the ACTIVE journey can be edited;
 *  - consents/acknowledgments and their server-stamped timestamps cannot be
 *    edited here (they must go through the checkbox flow);
 *  - where the journey curates editability (FB-1566), only fields marked
 *    `editable: true` — the customer's own contact details — can be changed;
 *    values read off an official document stay as the document stated them;
 *  - the same field validation as collect_field applies.
 */
const Body = z.object({
  agentSlug: z.string(),
  conversationId: z.string().uuid(),
  key: z.string().min(1),
  value: z.string(),
});

const PROTECTED_KEY = /(_consent|_accepted|_acknowledged)(_at)?$/;

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { agentSlug, conversationId, key, value } = parsed.data;

  const agent = await getAgentBySlug(agentSlug);
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  const caseRow = await getCase(conversationId);
  if (!caseRow) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  const journey = findJourney(agent.definition, caseRow.state.journeyKey);
  const journeyFields = journey?.steps.flatMap((s) => s.fields) ?? [];
  const field = journeyFields.find((f) => f.key === key);
  if (!field) return NextResponse.json({ error: "unknown_field" }, { status: 400 });
  // A journey that marks editability anywhere opts into the curated allowlist;
  // one that marks it nowhere keeps every text-like field editable.
  const curated = journeyFields.some((f) => f.editable !== undefined);
  if (PROTECTED_KEY.test(key) || field.type === "boolean" || (curated && field.editable !== true)) {
    return NextResponse.json({ error: "field_not_editable" }, { status: 400 });
  }

  const { state, error } = setField(agent.definition, caseRow.state, key, value);
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  await saveCase(caseRow.caseId, state);
  await audit({
    agentId: agent.id,
    conversationId,
    actor: "user",
    action: "field_edited",
    payload: { key },
  });
  return NextResponse.json({ case: state });
}
