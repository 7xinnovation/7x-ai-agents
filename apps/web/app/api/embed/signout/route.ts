import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, conversations } from "@dialog/db";
import { eq } from "drizzle-orm";
import { signOutConversation, audit } from "@/lib/conversation";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * Sign the customer out of this conversation.
 *
 * Signing in with no way out is a gap on a shared or public screen more than
 * anywhere else — a PO Box account, its addresses and its agents stay one tap
 * away for whoever sits down next.
 *
 * The conversation id is the only thing needed, and it is the only thing that
 * can be signed out: an id nobody holds is unguessable, and the call clears a
 * session rather than granting one, so the worst a stranger with an id can do is
 * sign that conversation out. It is scoped to the agent it belongs to so an id
 * cannot be redirected at another tenant's conversation.
 */
const Body = z.object({
  conversationId: z.string().uuid(),
  agentSlug: z.string().min(1).max(64),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { conversationId, agentSlug } = parsed.data;

  const agent = await getAgentBySlug(agentSlug);
  if (!agent) return NextResponse.json({ error: "unknown_agent" }, { status: 404 });

  const conv = await getDb().query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  // Already gone, or never ours: either way the answer is the same, and it is
  // the answer the customer wants — they are signed out.
  if (!conv || conv.agentId !== agent.id) return NextResponse.json({ ok: true, authenticated: false });

  await signOutConversation(conversationId);
  await audit({
    agentId: agent.id,
    conversationId,
    actor: "user",
    action: "signed_out",
    payload: { response: "The customer signed out; the session token, the authenticated flag and the verified Emirates ID were cleared." },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, authenticated: false });
}
