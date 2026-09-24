import { NextResponse } from "next/server";
import { assessHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live integration health for both agents.
 *
 * Every probe is read-only — see lib/health — so this is safe to refresh as
 * often as anybody likes. Never cached: a page that tells you a service was up
 * a minute ago is not a health page. Gated by the admin session (middleware),
 * because the detail lines name base URLs and service accounts.
 */
export async function GET() {
  try {
    return NextResponse.json(await assessHealth(), { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (e) {
    console.error("[health] assessment failed", e);
    return NextResponse.json(
      { error: "Health check failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
