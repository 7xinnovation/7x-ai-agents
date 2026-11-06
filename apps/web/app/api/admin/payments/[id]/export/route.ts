import { NextResponse } from "next/server";
import { detailCsv, paymentDetail } from "@/lib/paymentDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One transaction as a spreadsheet: details, timeline, transcript. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await paymentDetail(id);
  if (!d) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const name = `transaction-${d.box.boxNumber ? `box-${d.box.boxNumber}-` : ""}${d.payment.gatewayRef ?? d.payment.reference.slice(0, 8)}.csv`;
  return new NextResponse(detailCsv(d), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
