import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversation";

export const runtime = "nodejs";

/** Resume / status: returns the persisted messages + current case for a session. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadConversation(id);
  if (!data) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  return NextResponse.json({
    conversationId: data.conversation.id,
    authenticated: data.conversation.authenticated,
    locale: data.conversation.locale,
    case: data.case,
    messages: data.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      // The time each message was persisted, so a resumed conversation reads the
      // same as the live one. Emirates Post asked for a timestamp on every part
      // of the conversation alongside the consent stamps — an audit trail with a
      // gap where the transcript was reloaded is not one.
      .map((m) => ({ role: m.role, content: m.content, at: m.createdAt?.toISOString?.() ?? null })),
  });
}
