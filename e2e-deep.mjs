// Deep E2E: drives a full transactional chatbot journey end to end
// (collect fields -> readiness -> payment initiation -> webhook confirm -> submit)
// plus the confidence-governance gate. Exercises the real LLM + case engine + payment spine.
const BASE = "http://localhost:4500";
let pass = 0, fail = 0; const out = [];
const check = (n, c, d = "") => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n}${d ? " — " + d : ""}`); } };
const section = (t) => out.push(`\n━━ ${t} ━━`);

async function chat({ agentSlug, userMessage, conversationId, authenticated = false, userRef }) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug, userMessage, conversationId, locale: "en", authenticated, userRef }),
  });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", text = "", convId = conversationId, state = null; const ev = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
      let e; try { e = JSON.parse(line.slice(6)); } catch { continue; }
      ev.push(e);
      if (e.type === "session") convId = e.conversationId;
      else if (e.type === "text") text += e.delta;
      else if (e.type === "case") state = e.state;
      else if (e.type === "done" && e.state) state = e.state;
    }
  }
  return { text, conversationId: convId, state, ev, types: [...new Set(ev.map((e) => e.type))] };
}
const evOf = (r, t) => r.ev.find((e) => e.type === t);

async function run() {
  // ─── Confidence governance: ambiguous transactional intent must clarify, not start ───
  section("Governance · ambiguous request does NOT auto-start a transactional journey");
  let r = await chat({ agentSlug: "nxn-dialog", userMessage: "hi i need something for my mail maybe", authenticated: true, userRef: "u-gov" });
  check("Ambiguous msg → no journey auto-started (clarifies)", !r.state?.journeyKey, `journey=${r.state?.journeyKey}`);

  // ─── Full transactional journey: NXN personal PO Box rental (auth + payment) ───
  section("NXN · full rental journey (collect → pay → webhook → submit)");
  const userRef = "u-deep-" + Math.floor(Date.now() / 1000);
  const details =
    "I'd like to rent a new personal PO Box. Here are all my details: " +
    "full name Mariam Al Suwaidi, emirate Dubai, preferred branch Deira Main Post Office, " +
    "the standard/basic package, duration 1 year, no optional add-ons, " +
    "contact phone +971501234567, email mariam@example.ae. Please record everything.";
  r = await chat({ agentSlug: "nxn-dialog", userMessage: details, authenticated: true, userRef });
  const conv = r.conversationId;
  check("Rental journey started", r.state?.journeyKey === "personal_po_box_rental", `journey=${r.state?.journeyKey}`);

  // Drive remaining required fields until readiness complete (max 5 nudges).
  for (let i = 0; i < 5 && r.state && !r.state.readiness?.complete; i++) {
    const missing = (r.state.readiness?.missing ?? []).map((m) => m.key).join(", ");
    r = await chat({
      agentSlug: "nxn-dialog", conversationId: conv, authenticated: true, userRef,
      userMessage: `Please use these for any missing fields (${missing}): full name Mariam Al Suwaidi, emirate Dubai, branch Deira Main Post Office, package basic, duration 1 year, phone +971501234567, email mariam@example.ae.`,
    });
  }
  check("Case reaches submission readiness", !!r.state?.readiness?.complete, `missing=${JSON.stringify(r.state?.readiness?.missing)}`);

  // Ask to pay → expect payment_initiated with a reference.
  let paymentRef = null;
  for (let i = 0; i < 3 && !paymentRef; i++) {
    r = await chat({ agentSlug: "nxn-dialog", conversationId: conv, authenticated: true, userRef, userMessage: i === 0 ? "Yes, everything is correct. Please proceed to payment and give me the secure link." : "Please initiate the payment now." });
    const pe = evOf(r, "payment_initiated"); if (pe) paymentRef = pe.reference;
  }
  check("Payment initiated (reference issued)", !!paymentRef, `state.payment=${JSON.stringify(r.state?.payment)}`);

  // Confirm payment via webhook (authoritative).
  if (paymentRef) {
    const wh = await fetch(`${BASE}/api/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: paymentRef, outcome: "paid" }) });
    const wj = await wh.json().catch(() => ({}));
    check("Webhook confirms payment (200 ok)", wh.status === 200 && (wj.ok || wj.idempotent), `status=${wh.status} ${JSON.stringify(wj)}`);
  }

  // Now submit → expect submitted + reference, status submitted.
  let submittedRef = null;
  for (let i = 0; i < 3 && !submittedRef; i++) {
    r = await chat({ agentSlug: "nxn-dialog", conversationId: conv, authenticated: true, userRef, userMessage: i === 0 ? "Payment is done. Please submit my application now." : "Go ahead and submit it." });
    const se = evOf(r, "submitted"); if (se) submittedRef = se.reference;
  }
  check("Application submitted (reference returned)", !!submittedRef, `status=${r.state?.status} text~=${r.text.slice(0,80)}`);
  check("Case status is 'submitted'", r.state?.status === "submitted", `status=${r.state?.status}`);

  // ─── Auth gate still blocks the same journey for a guest ───
  section("Guard · guest cannot start the rental journey");
  r = await chat({ agentSlug: "nxn-dialog", userMessage: "I want to rent a new personal PO Box right now." });
  const gated = r.types.includes("auth_required") || /sign ?in|log ?in|uae ?pass|authenticat/i.test(r.text);
  check("Guest rental → auth required", gated, `types=${r.types}`);

  console.log(out.join("\n"));
  console.log(`\n══════════════════════════════════════`);
  console.log(`  DEEP RESULTS: ${pass} passed · ${fail} failed · ${pass + fail} total`);
  console.log(`══════════════════════════════════════`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
