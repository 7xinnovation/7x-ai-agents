import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, conversations } from "@dialog/db";
import type { Locale } from "@dialog/config";
import { getAgentBySlug } from "@/lib/agents";
import { getCase, saveCase, signOutConversation, audit } from "@/lib/conversation";
import { customerActionLog } from "@/lib/customerActionLog";
import { summariseWithdrawal } from "@/lib/withdrawPermission";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Withdraw a granted permission, in one step (pre-launch gate: "سحب الصلاحية
 * متاح بخطوة واحدة"; FB-1737).
 *
 * Revokes the session and consents, erases what was collected under them, and
 * hands the customer back a plain-language account of what had been done in
 * their name and what has now been erased. The conversation id is the credential
 * — the same trust model as the receipt and the action log — and the action only
 * ever touches the customer's OWN conversation on the named agent.
 *
 * The audit trail is NOT erased: it is the durable record of what was done, and
 * the withdrawal itself is written into it (permission_withdrawn) so the pull-back
 * is as auditable as the actions it revokes.
 */
export async function POST(req: NextRequest) {
  let body: { agentSlug?: unknown; conversationId?: unknown; locale?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const agentSlug = typeof body.agentSlug === "string" ? body.agentSlug : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const locale: Locale = body.locale === "ar" ? "ar" : "en";
  if (!agentSlug || !UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const agent = await getAgentBySlug(agentSlug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The conversation must be this agent's — a leaked id from one widget cannot
  // reach into another's case.
  const conv = await getDb().query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.agentId, agent.id)),
  });
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const c = await getCase(conversationId);
  const entity = agent.definition.theme?.brandName?.trim() || agent.definition.name;

  // What had been done, built from the audit trail, BEFORE anything is cleared.
  const { entries: done } = await customerActionLog(conversationId, { locale, entity });

  const state = c?.state ?? null;
  const summary = state
    ? summariseWithdrawal(state, done, locale, conv.authenticated)
    : { done, erased: [], cleared: null, message: "", };

  // Erase the collected case and revoke the session/consents/identity.
  if (c && summary.cleared) await saveCase(c.caseId, summary.cleared);
  await signOutConversation(conversationId);

  // Record the withdrawal itself — counts only, never the erased values.
  await audit({
    agentId: agent.id,
    conversationId,
    actor: "user",
    action: "permission_withdrawn",
    payload: { erasedCategories: summary.erased.length, actionsDone: done.length },
  }).catch(() => undefined);

  return NextResponse.json(
    { message: summary.message, done: summary.done, erased: summary.erased },
    { headers: { "Cache-Control": "no-store" } }
  );
}
