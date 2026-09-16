import { NextRequest, NextResponse } from "next/server";
import { denyAgent } from "@/lib/scope";
import { getAgentBySlug } from "@/lib/agents";
import { completedRequests, requestDetail } from "@/lib/completedRequests";

export const runtime = "nodejs";

/** One CSV cell, quoted the way a spreadsheet expects it. */
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The completed requests for one agent.
 *
 * `?case=<id>` returns one in full — the confirmation the customer read, every
 * field collected, and the calls made to the system of record. Without it, the
 * list. `?format=csv` gives the list to whoever asked for it in a spreadsheet,
 * which is how these get reconciled against Salesforce today.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const caseId = req.nextUrl.searchParams.get("case");
  if (caseId) {
    const detail = await requestDetail(agent.id, caseId);
    if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(detail);
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const rows = await completedRequests(agent.id, Number.isFinite(limit) ? limit : 200);

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const head = [
      "Completed", "Reference", "Record id", "Journey", "Subject", "Customer", "Email", "Phone",
      "Amount", "Currency", "Payment", "Documents attached", "Documents total", "Sent to record",
      "Language", "Signed in", "Conversation",
    ];
    const body = rows.map((r) =>
      [
        r.completedAt, r.reference, r.recordId, r.journey, r.subject, r.customer, r.email, r.phone,
        r.amount, r.currency, r.paymentStatus, r.documents.attached, r.documents.total, r.sentToRecord,
        r.locale, r.authenticated ? "yes" : "no", r.conversationId,
      ].map(cell).join(",")
    );
    // The BOM is for Excel, which otherwise reads a UTF-8 Arabic company name as
    // mojibake — and half of these names are Arabic.
    return new NextResponse(`﻿${[head.join(","), ...body].join("\r\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-requests-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ rows });
}
