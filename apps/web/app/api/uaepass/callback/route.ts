import { NextRequest, NextResponse } from "next/server";
import { uaePassConfigured, uaePassMock, exchangeCode, resolveRedirectUri } from "@/lib/uaepass";
import { saveSessionToken, markAuthenticated } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Customer UAE PASS sign-in — step 2. Exchanges the auth code for the user's
 * access token + identity, attaches it to the conversation (the token becomes the
 * session bearer reused for protected integration calls), then returns to the embed.
 */
export async function GET(req: NextRequest) {
  if (!uaePassConfigured()) return NextResponse.json({ error: "uaepass_not_configured" }, { status: 501 });

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  let flow: { state?: string; cid?: string; agent?: string; returnTo?: string } = {};
  try { flow = JSON.parse(req.cookies.get("uaepass_flow")?.value ?? "{}"); } catch { /* ignore */ }

  const back = (params: Record<string, string>) => {
    const url = new URL(flow.returnTo || `${req.nextUrl.origin}/embed/${flow.agent ?? ""}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (flow.cid) url.searchParams.set("cid", flow.cid);
    const res = NextResponse.redirect(url.toString());
    res.cookies.delete("uaepass_flow");
    return res;
  };

  if (err) return back({ uaepass: "cancelled" });
  if (!code || !state || state !== flow.state) return back({ uaepass: "invalid_state" });

  try {
    // Mock mode: synthesize a verified identity instead of calling UAE PASS, so the
    // sign-in → session → authenticated flow is testable without registration.
    const id = uaePassMock()
      ? { accessToken: `mock-uaepass-${crypto.randomUUID()}`, sub: "uaepass-mock-001", name: "Test Persona" }
      : await exchangeCode(code, resolveRedirectUri(req.nextUrl.origin));
    if (flow.cid) {
      await saveSessionToken(flow.cid, id.accessToken); // becomes the bearer for protected calls
      await markAuthenticated(flow.cid, id.sub);
    }
    return back({ uaepass: "ok" });
  } catch (e) {
    log.error("uaepass_callback_failed", e, { cid: flow.cid });
    return back({ uaepass: "error" });
  }
}
