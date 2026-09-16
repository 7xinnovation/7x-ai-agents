import { NextRequest, NextResponse } from "next/server";
import { customerActionLog } from "@/lib/customerActionLog";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The customer's own account of what was done for them.
 *
 * Scoped to one conversation and nothing else: the id IS the credential, the
 * same way the receipt link is, and it is held only by the browser that started
 * the conversation. No case data, no documents, no audit payloads — the rendered
 * lines and nothing more, so a leaked id exposes a list of actions rather than
 * the file behind them.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const slug = req.nextUrl.searchParams.get("agent") ?? "";
  const locale = req.nextUrl.searchParams.get("locale") === "ar" ? "ar" : "en";
  const agent = slug ? await getAgentBySlug(slug) : null;
  const entity = agent?.definition.theme?.brandName?.trim() || agent?.definition.name;

  const log = await customerActionLog(conversationId, { locale, entity });
  return NextResponse.json(log, { headers: { "Cache-Control": "no-store" } });
}
