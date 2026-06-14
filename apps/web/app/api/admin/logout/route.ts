import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Clear the admin session and return to the login page. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set("dlg_admin", "", { path: "/", maxAge: 0 });
  return res;
}
