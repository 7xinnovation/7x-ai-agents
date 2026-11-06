import { NextRequest, NextResponse } from "next/server";
import { paymentRows, type Window } from "@/lib/transactions";
import { listAgentsForFilter } from "@/lib/metrics";
import { currentScope, selectAgent } from "@/lib/scope";
import { LIST_HEAD, casesForConversations, csv, listRow } from "@/lib/paymentDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Payments page as a spreadsheet — the same window, agent and status the
 * page is showing, with what each payment was for (the PO Box, the customer)
 * beside the money. Scoped exactly as the page is.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = sp.get("days");
  const windowDays: Window = days && ["7", "30", "90"].includes(days) ? Number(days) : "all";
  const status = ["paid", "failed", "initiated"].includes(sp.get("status") ?? "") ? sp.get("status") : null;
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, sp.get("agent") ?? undefined, scope);
  if (scope && !selected) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rows = await paymentRows({ windowDays, agentId: selected?.id, status, limit: 5000 });
  const byConv = await casesForConversations([...new Set(rows.map((r) => r.conversationId).filter((x): x is string => Boolean(x)))]);
  const body = csv([LIST_HEAD, ...rows.map((r) => listRow(r, r.conversationId ? byConv.get(r.conversationId) : undefined))]);
  const name = `payments-${selected?.slug ?? "all-agents"}-${windowDays === "all" ? "all-time" : `${windowDays}d`}${status ? `-${status}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
