import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public Mapbox token for in-chat map widgets that aren't tied to the branch
 * lookup (e.g. the company-address location picker). The token is a public
 * (pk.) token by design — same one the branches endpoint returns.
 */
export function GET() {
  return NextResponse.json({ token: process.env.MAPBOX_TOKEN || "" });
}
