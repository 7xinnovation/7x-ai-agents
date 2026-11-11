import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";
import {
  getOrCreateSession,
  markAuthenticated,
  mutateCase,
  rememberVerifiedAccountId,
  rememberVerifiedEmiratesId,
  saveSessionToken,
} from "@/lib/conversation";
import { contactSeed } from "@/lib/knownContact";
import { hostTokenConfigured, verifyHostToken } from "@/lib/hostToken";
import { mintClaim, readClaim } from "@/lib/handoff";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Signing in to a service whose login is NOT the mobile app's (11 November).
 *
 * ep-master runs inside Emirates Post's app. The app's sign-in is Emirates
 * Post's and only NXN can use it; EPGL's sign-in is EPGL's own portal. So in the
 * app, EPGL's Sign in opens that portal in the app's browser, and the two ends
 * meet here:
 *
 *   POST application/json { agent, cid }       <- the widget, before opening it
 *     -> { claim }                                a code naming that conversation
 *
 *   POST form { claim, token, lang }            <- dialog-relay.js on the portal,
 *     -> a small "signed in" page                 once the customer is signed in
 *
 * The widget then sees its conversation turn authenticated and carries on.
 *
 * The claim grants nothing alone: the token that arrives with it is verified
 * against the agent's tenant key exactly as a host token is, and its subject,
 * not anything the caller says, becomes the identity.
 */
export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return mint(req);
  return redeem(req);
}

async function mint(req: NextRequest) {
  let body: { agent?: string; cid?: string; locale?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!body.agent) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const agent = await getAgentBySlug(body.agent);
  if (!agent) return NextResponse.json({ ok: false, error: "unknown_agent" }, { status: 404 });
  // The conversation in hand if it is this agent's, else a fresh one for it.
  const session = await getOrCreateSession({
    agentId: agent.id,
    conversationId: body.cid,
    locale: body.locale === "ar" ? "ar" : "en",
    authenticated: false,
  });
  const claim = mintClaim(session.conversationId, body.agent);
  if (!claim) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });
  return NextResponse.json({ ok: true, claim, conversationId: session.conversationId });
}

async function redeem(req: NextRequest) {
  let claim = "";
  let token = "";
  let lang = "";
  try {
    const form = await req.formData();
    claim = String(form.get("claim") ?? "");
    token = String(form.get("token") ?? "").trim();
    lang = String(form.get("lang") ?? "");
  } catch {
    return page(false, lang);
  }
  const c = readClaim(claim);
  if (!c.ok || !token) {
    log.warn("signin_claim_refused", { reason: c.ok ? "no token" : c.reason });
    return page(false, lang);
  }
  const agent = await getAgentBySlug(c.agent);
  if (!agent) return page(false, lang);
  const tenant = agent.definition.tenantSlug;
  if (token.split(".").length !== 3 || !hostTokenConfigured(tenant)) {
    log.warn("signin_claim_refused", { agentId: agent.id, reason: "not a signed token for this tenant" });
    return page(false, lang);
  }
  const v = verifyHostToken(token, { tenant });
  if (!v.ok || !v.claims.sub) {
    log.warn("signin_claim_refused", { agentId: agent.id, reason: v.ok ? "no sub" : v.reason });
    return page(false, lang);
  }
  const claims = v.claims as Record<string, unknown>;
  const str = (k: string) => (typeof claims[k] === "string" && (claims[k] as string).trim() ? (claims[k] as string).trim() : undefined);

  const session = await getOrCreateSession({ agentId: agent.id, conversationId: c.cid, locale: lang.startsWith("ar") ? "ar" : "en", authenticated: false });
  // Kept like the chat route keeps a host token, so later turns have it.
  await saveSessionToken(session.conversationId, token, "uaepass");
  await markAuthenticated(session.conversationId, v.claims.sub);
  if (session.caseId) {
    const eid = str("emiratesId");
    if (eid) await rememberVerifiedEmiratesId(session.caseId, eid);
    const accountId = str("accountId");
    if (accountId) await rememberVerifiedAccountId(session.caseId, accountId).catch(() => {});
    const name = str("name");
    const email = str("email");
    if (name || email) {
      try {
        await mutateCase(session.caseId, (st) => {
          const seed = contactSeed(st, { name, email });
          return Object.keys(seed).length ? { ...st, data: { ...st.data, ...seed } } : st;
        });
      } catch {
        /* signed in either way */
      }
    }
  }
  log.info("signin_claim_accepted", { agentId: agent.id, conversationId: session.conversationId });
  return page(true, lang);
}

/** What the customer sees in the app's browser: where they are, and the way back. */
function page(ok: boolean, lang: string) {
  const ar = lang.toLowerCase().startsWith("ar");
  const title = ok
    ? ar ? "تم تسجيل الدخول" : "You're signed in"
    : ar ? "تعذّر تسجيل الدخول" : "Sign-in didn't complete";
  const text = ok
    ? ar ? "أغلق هذه الصفحة للعودة إلى المحادثة في التطبيق." : "Close this page to go back to the chat in the app."
    : ar ? "أغلق هذه الصفحة وحاول تسجيل الدخول مرة أخرى من المحادثة." : "Close this page and try signing in again from the chat.";
  const html = `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#1b1f24;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:360px;padding:32px 24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4a5260;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main><script>try{window.close()}catch(e){}</script></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
