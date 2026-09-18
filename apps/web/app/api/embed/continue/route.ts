import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";
import { carrySessionForward } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Start a NEW conversation without signing the customer out of this one.
 *
 * POST { agent, from } -> { ok, conversationId }
 *
 * "Logged-in user — refreshing the chat window using the refresh button prompts
 * the user to sign in again" (mobile bug list, item 10). It did, and the reason
 * is structural rather than a slip: a UAE PASS session lives against the
 * CONVERSATION, encrypted, deliberately out of the page's reach. A new
 * conversation therefore has no session, and the widget had nothing in hand to
 * give it one.
 *
 * So the server moves it — see carrySessionForward, which also explains why this
 * is not a new capability: a conversation id is ALREADY a session bearer, since
 * every /api/chat turn quoting one continues as that customer. This hands the
 * same holder the same session in a fresh conversation, and refuses an id that
 * was never signed in.
 */
export async function POST(req: NextRequest) {
  let body: { agent?: string; from?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const slug = body.agent;
  const from = body.from;
  if (!slug || !from) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ ok: false, error: "unknown_agent" }, { status: 404 });

  const carried = await carrySessionForward(agent.id, from).catch((e) => {
    log.error("carry_session_failed", e, { agentId: agent.id });
    return null;
  });
  if (!carried) {
    // One answer whether the id is unknown, belongs to another agent, or was
    // never signed in. Which of those it was is ours to know.
    return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, conversationId: carried.conversationId });
}
