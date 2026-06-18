import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

export const runtime = "nodejs";

/** Returns the current admin session's identity + role (for the console UI). */
export async function GET(req: NextRequest) {
  const claims = await verifySession(req.cookies.get("dlg_admin")?.value);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ uid: claims.uid, email: claims.email, role: claims.role });
}
