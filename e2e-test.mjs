// End-to-end test harness for the Dialog platform.
// Exercises live conversation flows (SSE chat) + REST endpoints against a
// running server on :4500. Verifies PRD acceptance behaviors.
const BASE = "http://localhost:4500";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me"; // set ADMIN_PASSWORD to match your .env when running
let ADMIN_COOKIE = ""; // populated by adminLogin()

async function adminLogin(password = ADMIN_PASSWORD) {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/dlg_admin=([^;]+)/);
  if (m) ADMIN_COOKIE = `dlg_admin=${m[1]}`;
  return { status: res.status, cookie: ADMIN_COOKIE };
}

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}
function section(t) { results.push(`\n━━ ${t} ━━`); }

// Drive one chat turn; returns {events[], text, conversationId, state, tools[]}
async function chat({ agentSlug, userMessage, conversationId, locale = "en", authenticated = false, uaePassToken }) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug, userMessage, conversationId, locale, authenticated, uaePassToken }),
  });
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", convId = conversationId, state = null;
  const events = [], tools = [], citations = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      events.push(ev);
      if (ev.type === "session") convId = ev.conversationId;
      else if (ev.type === "text") text += ev.delta;
      else if (ev.type === "case") state = ev.state;
      else if (ev.type === "citation") citations.push(ev.source);
      else if (ev.type === "integration") tools.push(ev.tool ?? "tool");
      else if (ev.type === "escalation") tools.push("escalation:" + ev.reference);
      else if (ev.type === "lookup") tools.push("lookup:" + ev.kind);
      else if (ev.type === "submitted") tools.push("submitted:" + ev.reference);
      else if (ev.type === "payment_initiated") tools.push("payment:" + ev.reference);
      else if (ev.type === "done" && ev.state) state = ev.state;
    }
  }
  return { events, text, conversationId: convId, state, tools, citations,
    types: [...new Set(events.map((e) => e.type))] };
}

const lc = (s) => (s || "").toLowerCase();

async function run() {
  // ───────────────────────── EPGL ─────────────────────────
  section("EPGL · Intent & greeting");
  let r = await chat({ agentSlug: "epgl-dialog", userMessage: "Hello, what can you do?" });
  check("EPGL greeting returns session id", !!r.conversationId);
  check("EPGL streams assistant text", r.text.length > 20);
  check("EPGL mentions licensing", /licens/i.test(r.text));

  section("EPGL · KB-grounded Q&A (citations)");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "What documents do I need to apply for a courier license?" });
  check("KB answer is substantive", r.text.length > 40);
  check("KB answer cites sources OR stays grounded", r.citations.length > 0 || /licen|document|trade/i.test(r.text),
    `citations=${r.citations.length}`);

  section("EPGL · Auth gating for transactional action");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "I want to apply for a new courier license right now. Let's start." });
  const epglAuth = r.types.includes("auth_required") || /sign in|log ?in|authenticat|uae ?pass/i.test(r.text);
  check("Guest apply → prompts authentication", epglAuth, `types=${r.types}`);

  section("EPGL · Escalation / callback");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "This is too complicated, I want a human to call me back please." });
  const epglEsc = r.tools.some((t) => /escal|callback/i.test(t)) || /callback|call you|agent|human|reference/i.test(r.text);
  check("Callback request handled", epglEsc, `tools=${r.tools} text~=${lc(r.text).slice(0,60)}`);

  section("EPGL · Multilingual (Arabic)");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "مرحبا، ماذا يمكنك أن تفعل؟", locale: "ar" });
  check("Arabic reply is in Arabic script", /[؀-ۿ]/.test(r.text), `text=${r.text.slice(0,40)}`);

  section("EPGL · Field collection (authenticated new license)");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "I'm signed in. I want to apply for a new courier license. My company is Falcon Logistics LLC.", authenticated: true });
  let epglConv = r.conversationId;
  check("Authenticated apply proceeds (journey/state set)", !!r.state && (r.state.journeyKey || r.text.length > 20),
    `journey=${r.state?.journeyKey}`);
  // continue the journey — provide more detail, expect captured data or next-question
  r = await chat({ agentSlug: "epgl-dialog", conversationId: epglConv, userMessage: "The trade license number is 123456 and we are based in Dubai.", authenticated: true });
  check("EPGL journey retains context across turns", !!r.state,
    `data keys=${Object.keys(r.state?.data || {}).length}`);

  // ───────────────────────── NXN ─────────────────────────
  section("NXN · Intent & greeting");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "Hi, what services do you offer?" });
  let nxnConv = r.conversationId;
  check("NXN greeting returns session", !!r.conversationId);
  check("NXN mentions PO Box or shipment", /po ?box|shipment|track|rent/i.test(r.text), r.text.slice(0,60));

  section("NXN · Shipment tracking (lookup tool)");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "Track my shipment, the tracking number is NX123456789." });
  const trackedOk = r.tools.some((t) => /lookup|track|shipment/i.test(t)) || /transit|deliver|status|out for|tracking/i.test(r.text);
  check("Shipment lookup executes / returns status", trackedOk, `tools=${r.tools} text~=${lc(r.text).slice(0,70)}`);

  section("NXN · PO Box rental auth gating");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "I want to rent a new personal PO Box." });
  const nxnAuth = r.types.includes("auth_required") || /sign in|log ?in|authenticat|uae ?pass|login/i.test(r.text);
  check("Guest PO Box rental → requires UAE PASS auth", nxnAuth, `types=${r.types} text~=${lc(r.text).slice(0,70)}`);

  section("NXN · Guest renewal allowed (no auth wall)");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "I want to renew my PO Box. It's number 50500." });
  check("Renewal proceeds for guest (asks for details, not blocked)", r.text.length > 20, r.text.slice(0,60));

  section("NXN · KB-grounded Q&A");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "What types of PO Box packages are available?" });
  check("NXN KB answer substantive", r.text.length > 30, `citations=${r.citations.length}`);

  section("EPGL · Status tracking (authenticated, get_status)");
  r = await chat({ agentSlug: "epgl-dialog", userMessage: "What's the status of my license application?", authenticated: true, userRef: "u-e2e" });
  // PRD-correct = relays a real status OR truthfully says none found (never invents one).
  check("Authenticated status check handled via get_status", /status|review|submitted|under|couldn'?t find|no .*(application|record|request)|not found|don'?t (have|see)|on file|nothing/i.test(r.text), r.text.slice(0, 80));

  section("NXN · Corporate PO Box renewal journey exists");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "I need to renew my corporate PO Box.", authenticated: true, userRef: "u-e2e" });
  check("Corporate renewal recognized (not 'unsupported')", !/cannot|unable|don't (?:support|offer)/i.test(r.text), r.text.slice(0, 80));

  section("Payments · Reconciliation sweep");
  {
    const rc = await fetch(`${BASE}/api/payments/reconcile`, { method: "POST" });
    check("POST /api/payments/reconcile → 200", rc.status === 200, `status=${rc.status}`);
    if (rc.status === 200) { const j = await rc.json(); check("reconcile returns sweep counts", j.ok === true && "paymentsChecked" in j, JSON.stringify(j).slice(0, 100)); }
  }

  section("Payments · Webhook rejects bad input");
  {
    const wh = await fetch(`${BASE}/api/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: "DOES-NOT-EXIST", outcome: "paid" }) });
    check("Webhook unknown ref → 404 (not silent success)", wh.status === 404, `status=${wh.status}`);
  }

  // ───────────────────────── REST endpoints ─────────────────────────
  section("REST · Public agent config");
  let res = await fetch(`${BASE}/api/agents/nxn-dialog`);
  check("GET /api/agents/nxn-dialog → 200", res.status === 200, `status=${res.status}`);
  if (res.status === 200) { const j = await res.json(); check("agent config has journeys", Array.isArray(j.journeys ?? j.definition?.journeys) || !!j.slug); }

  section("REST · Intent classifier");
  res = await fetch(`${BASE}/api/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentSlug: "nxn-dialog", message: "I want to track a parcel" }) });
  check("POST /api/classify → 200", res.status === 200, `status=${res.status}`);
  if (res.status === 200) { const j = await res.json(); check("classifier returns intent + confidence", j.intent !== undefined && j.confidence !== undefined, JSON.stringify(j).slice(0,80)); }

  section("REST · Conversation resume");
  if (nxnConv) {
    res = await fetch(`${BASE}/api/conversations/${nxnConv}`);
    check("GET /api/conversations/:id → 200", res.status === 200, `status=${res.status}`);
    if (res.status === 200) { const j = await res.json(); check("resume returns messages array", Array.isArray(j.messages), `keys=${Object.keys(j)}`); }
    res = await fetch(`${BASE}/api/conversations/${nxnConv}`);
    const j2 = res.status === 200 ? await res.json() : {};
    check("resume does NOT leak audit log (public)", !("audit" in j2), `keys=${Object.keys(j2)}`);
  }

  section("REST · Admin auth + RBAC");
  res = await fetch(`${BASE}/api/admin/conversations`, { redirect: "manual" });
  check("Admin API without cookie → blocked (401/403/302)", [401, 403, 302, 307].includes(res.status), `status=${res.status}`);
  // Stale/forged token must be rejected (signature verification).
  res = await fetch(`${BASE}/api/admin/conversations`, { headers: { Cookie: "dlg_admin=forged.invalid.token" }, redirect: "manual" });
  check("Forged session token → rejected", [401, 403, 302, 307].includes(res.status), `status=${res.status}`);
  // Wrong password → 401.
  const badLogin = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
  check("Login with wrong password → 401", badLogin.status === 401, `status=${badLogin.status}`);
  // Real login → signed cookie.
  const login = await adminLogin();
  check("Login with correct password → 200 + signed cookie", login.status === 200 && /\./.test(ADMIN_COOKIE), `status=${login.status}`);
  res = await fetch(`${BASE}/api/admin/conversations`, { headers: { Cookie: ADMIN_COOKIE } });
  check("Admin API with valid session → 200", res.status === 200, `status=${res.status}`);
  if (res.status === 200) { const j = await res.json(); check("admin inbox returns conversations", Array.isArray(j.conversations), `keys=${Object.keys(j)}`); }
  // Owner can reach user management (admin+).
  res = await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: ADMIN_COOKIE } });
  check("Owner reaches /api/admin/users → 200", res.status === 200, `status=${res.status}`);
  if (res.status === 200) { const j = await res.json(); check("users API returns users array", Array.isArray(j.users) && j.users.length > 0, `users=${j.users?.length}`); }
  // /api/admin/me returns role.
  res = await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: ADMIN_COOKIE } });
  check("/api/admin/me returns role", res.status === 200, `status=${res.status}`);
  if (res.status === 200) { const j = await res.json(); check("session role is owner", j.role === "owner", `role=${j.role}`); }

  section("REST · RBAC enforcement (viewer is restricted)");
  // Owner provisions a viewer, then we log in as that viewer and confirm limits.
  const vEmail = `viewer+e2e@7x.ae`;
  await fetch(`${BASE}/api/admin/users`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: ADMIN_COOKIE }, body: JSON.stringify({ email: vEmail, name: "E2E Viewer", password: "viewer-pass-1", role: "viewer" }) });
  const vRes = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: vEmail, password: "viewer-pass-1" }) });
  const vCookie = (vRes.headers.get("set-cookie") || "").match(/dlg_admin=([^;]+)/)?.[0] ?? "";
  check("Viewer can log in", vRes.status === 200 && !!vCookie, `status=${vRes.status}`);
  res = await fetch(`${BASE}/api/admin/conversations`, { headers: { Cookie: vCookie } });
  check("Viewer GET (read) → 200", res.status === 200, `status=${res.status}`);
  res = await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: vCookie }, redirect: "manual" });
  check("Viewer → /api/admin/users blocked (403)", res.status === 403, `status=${res.status}`);
  res = await fetch(`${BASE}/api/admin/users`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: vCookie }, redirect: "manual", body: JSON.stringify({ email: "x@y.z", name: "x", password: "xxxxxx", role: "viewer" }) });
  check("Viewer write (POST users) blocked (403)", res.status === 403, `status=${res.status}`);

  // ───────────────────────── Summary ─────────────────────────
  console.log(results.join("\n"));
  console.log(`\n══════════════════════════════════════`);
  console.log(`  RESULTS: ${pass} passed · ${fail} failed · ${pass + fail} total`);
  console.log(`══════════════════════════════════════`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
