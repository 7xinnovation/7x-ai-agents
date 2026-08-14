import { NextResponse } from "next/server";
import { assessReadiness } from "@/lib/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live readiness assessment against the UAE Agentic AI pre-launch gate.
 * Recomputed on every request from the deployed configuration and the audit and
 * analytics tables — never cached, so the dashboard reflects the system as it
 * stands now rather than as it stood at build time. Gated by the admin session
 * (middleware) because it reports our own unmet requirements.
 */
export async function GET() {
  try {
    const report = await assessReadiness();
    return NextResponse.json(report, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (e) {
    console.error("[readiness] assessment failed", e);
    return NextResponse.json(
      { error: "Readiness assessment failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
