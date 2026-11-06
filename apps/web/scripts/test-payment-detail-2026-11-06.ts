/**
 * The transaction page and its export (6 November 2026).
 *
 * Emirates Post asked for a page per payment with the PO Box, the timeline and
 * the transcript, and for an export. The audit payloads below are shaped like
 * the real ones on staging (box 453924, 6 November): a response is
 * "HTTP 200 OK\n{json}" with the turn's notes appended, so it never parses
 * whole, and a failure carries Emirates Post's own error code.
 *
 * Run from apps/web:  npx tsx scripts/test-payment-detail-2026-11-06.ts
 */
import { readFileSync } from "node:fs";
import { boxDetails, buildTimeline, detailCsv, listRow, LIST_HEAD, csvCell, type AuditEntry, type PaymentDetail } from "../lib/paymentDetail";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : JSON.stringify(extra ?? ""));
  ok ? pass++ : fail++;
};
const at = (hms: string) => new Date(`2026-11-06T${hms}Z`);
const NOTE = "\n\nWHAT THIS RENTAL COSTS. The total for the box … do not quote it.";

const audit: AuditEntry[] = [
  { action: "integration_empty_result", actor: "system", createdAt: at("06:55:47"), payload: { path: "/api/Rental/Bundle", bundles: ["IN:MyBox", "MYHOME3:MyHome"] } },
  {
    action: "integration_write", actor: "system", createdAt: at("06:58:13"),
    payload: {
      path: "/api/Rental/Select",
      input: { body: { bundleId: "IN", uniqueBoxID: "2453924", poBoxExpiryDate: "2028-11-05T00:00:00+00:00" } },
      response: 'HTTP 200 OK\n{"payload":{"subscriptionReferenceNumber":"260613038","minimumAmount":670.00,"subcsriptionReferenceNumberExpiryDate":"2026-11-06T07:28:13.3361792+00:00","poBoxExpiryDate":"2028-11-05T00:00:00+00:00","priceDetails":[{"bundleID":"IN"' + NOTE,
    },
  },
  {
    action: "integration_call_failed", actor: "system", createdAt: at("06:58:28"),
    payload: {
      path: "/api/Rental/Save",
      response: 'SYSTEM DETAIL — FOR YOUR DECISION…\nHTTP 400 Bad Request\n{"errorDetails":{"RESPONSE_CODE":"157","RESPONSE_MESSAGE":"SYSTEM SYSTEM ERROR: PLEASE CONTACT SUPPORT TEAM","ERROR_CODE":"157","ERROR_MESSAGE":"ERROR_GETTING_HOLD_DETAILS"},"payload":null}\n\nNO ORDER WAS CREATED',
    },
  },
  { action: "rental_select_reused_hold", actor: "system", createdAt: at("06:58:32"), payload: { path: "/api/Rental/Select", input: { body: { bundleId: "IN" } }, response: "reused" } },
  {
    action: "integration_write", actor: "system", createdAt: at("06:58:57"),
    payload: { path: "/api/Rental/Save", input: { body: { boxNumber: 453924, expiryDate: "2028-11-05T00:00:00+00:00", newBundleId: "IN", totalAmount: 670 } }, response: "HTTP 200 OK\n{}" },
  },
  { action: "case_submitted", actor: "agent", createdAt: at("06:58:57"), payload: { journey: "personal_po_box_rental", reference: "260973282" } },
  { action: "integration_write", actor: "system", createdAt: at("06:59:32"), payload: { path: "/api/Rental/UpdatePayment/{paymentReferenceNo}", response: "HTTP 200 OK" } },
  { action: "survey_offered", actor: "system", createdAt: at("06:59:38"), payload: {} },
  { action: "upload_ask_suppressed", actor: "system", createdAt: at("06:57:41"), payload: {} },
];
const data = {
  branch: "Al Barsha Post Office", emirate: "DXB", package: "IN", duration: "2_YEAR", add_agent: "no", box_number: 453924,
  contact_name: "EMRE KARAYALCIN", contact_email: "e@example.ae", contact_phone: "0553708434",
  auto_renew_consent: "yes", save_card_consent: "yes", __authenticated_at: "2026-11-06T06:54:49.070Z",
};
const payment = {
  id: "37171e83-5ad7-449e-abbf-33b4d94701c9", conversationId: "d867a446-f5bc-4ffe-b822-e84318ee6148", agentName: "Emirates Post", agentSlug: "nxn-dialog",
  reference: "f6306740-db23-4216-b37a-0970b1d9c96a", amount: 670, currency: "AED", status: "paid", provider: null, gatewayRef: "260973282",
  createdAt: at("06:59:37"), updatedAt: at("06:59:37"),
};

// ---- the PO Box ---------------------------------------------------------------
const b = boxDetails("personal_po_box_rental", "260973282", data, audit);
check("the box number", b.boxNumber === "453924", b);
check("the bundle by name, from the catalogue call", b.bundle === "MyBox (IN)", b.bundle);
check("branch and emirate in words", b.branch === "Al Barsha Post Office" && b.emirate === "Dubai", b);
check("the duration in words", b.duration === "2 years", b.duration);
check("the box's new expiry", b.expiry === "05-11-2028", b.expiry);
check("the order number", b.orderNumber === "260973282");
check("the reservation reference — from the call that carries it, not the reuse after it", b.holdReference === "260613038", b.holdReference);
check("the customer", b.customer === "EMRE KARAYALCIN" && b.email === "e@example.ae" && b.phone === "0553708434");
check("no representative said as such", b.representative === "None");
check("consents read as Yes", b.autoRenew === "Yes" && b.saveCard === "Yes");
check("a renewal's box comes from po_box_number", boxDetails("personal_po_box_renewal", null, { po_box_number: "50500", renewal_period: "1_YEAR" }, []).boxNumber === "50500");
check("...and its period from renewal_period", boxDetails("personal_po_box_renewal", null, { renewal_period: "1_YEAR" }, []).duration === "1 year");
check("a subscriber's name is put together", boxDetails(null, null, { subscriber_first_name: "Sara", subscriber_last_name: "Al Hashimi" }, []).customer === "Sara Al Hashimi");
check("an EPGL payment's reference is its LR number", boxDetails("new_license", null, { application_id: "LR-54501" }, []).orderNumber === "LR-54501");

// ---- the timeline -------------------------------------------------------------
const tl = buildTimeline({ conversationStarted: at("06:54:08"), authenticatedAt: data.__authenticated_at, audit, payment });
const titles = tl.map((e) => e.title);
check("oldest first", tl.every((e, i) => i === 0 || tl[i - 1]!.at <= e.at));
check("opens with the conversation, then the sign-in", titles[0] === "Conversation started" && titles[1] === "Signed in", titles);
const sel = tl.find((e) => e.title === "Box reserved with Emirates Post");
check("the reservation, with its reference, amount and hold time", !!sel && /reservation 260613038/.test(sel.detail ?? "") && /AED 670\.00/.test(sel.detail ?? "") && /held until/.test(sel.detail ?? ""), sel);
const failed = tl.find((e) => e.kind === "error");
check("the failed order, with Emirates Post's own code", failed?.title === "Rental order failed" && /HTTP 400/.test(failed?.detail ?? "") && /error 157/.test(failed?.detail ?? "") && /ERROR_GETTING_HOLD_DETAILS/.test(failed?.detail ?? ""), failed);
check("the reuse of the reservation", titles.includes("Existing box reservation reused"));
const placed = tl.find((e) => e.title === "Rental order placed with Emirates Post");
check("the order placed, with box, amount and expiry", /box 453924/.test(placed?.detail ?? "") && /AED 670\.00/.test(placed?.detail ?? "") && /05-11-2028/.test(placed?.detail ?? ""), placed);
check("the order submitted with its reference", tl.some((e) => e.title === "Order submitted" && e.detail === "reference 260973282"));
check("the payment reported to Emirates Post", titles.includes("Payment reported to Emirates Post"));
check("a saved-card charge is ONE settled event, not raised-and-settled in the same second",
  titles.filter((t) => t === "Payment settled").length === 1 && !titles.includes("Payment raised"), titles);
check("...with its amount and gateway reference", tl.some((e) => e.title === "Payment settled" && /AED 670\.00/.test(e.detail ?? "") && /260973282/.test(e.detail ?? "")));
check("internal bookkeeping is left out", !titles.some((t) => /upload|suppressed|Bundle/i.test(t)), titles);

const card = buildTimeline({
  conversationStarted: null, audit: [
    { action: "payment_initiated", actor: "agent", createdAt: at("07:00:00"), payload: { amount: 300 } },
    { action: "payment_paid_via_gateway_probe", actor: "system", createdAt: at("07:02:00"), payload: {} },
  ],
  payment: { ...payment, createdAt: at("07:00:00"), updatedAt: at("07:02:00") },
});
check("a card-page payment: raised, then settled, once each", card.map((e) => e.title).join("|") === "Payment raised|Payment settled", card.map((e) => e.title));
const declined = buildTimeline({ conversationStarted: null, audit: [], payment: { ...payment, status: "failed", createdAt: at("07:00:00"), updatedAt: at("07:03:00") } });
check("a declined payment says so", declined.some((e) => e.title === "Payment declined" && e.kind === "error"));
const timeout = buildTimeline({
  conversationStarted: null, payment,
  audit: [{ action: "integration_call_failed", actor: "system", createdAt: at("06:25:28"), payload: { path: "/api/Rental/Save", response: "TIMED OUT WITH THE OUTCOME UNKNOWN. The request was sent…" } }],
});
check("a timed-out order is not called a failure", timeout.some((e) => e.title === "Rental order timed out" && /outcome is unknown/.test(e.detail ?? "")), timeout);

// ---- the export ---------------------------------------------------------------
const detail: PaymentDetail = { payment, journeyKey: "personal_po_box_rental", caseReference: "260973282", box: b, timeline: tl, messages: [
  { role: "user", content: "PO Boxes", createdAt: at("06:54:08") },
  { role: "assistant", content: 'Your box, "453924", is booked,\nthank you.', createdAt: at("06:54:10") },
] };
const out = detailCsv(detail);
check("the export opens with a BOM, for Excel and Arabic", out.charCodeAt(0) === 0xfeff);
check("...carries the box, the order and the payment", /PO Box number,453924/.test(out) && /Order \/ application reference,260973282/.test(out) && /Status,Settled/.test(out));
check("...the timeline, in Dubai time", /Timeline \(Dubai time\),Event,Detail/.test(out) && /"06\/11\/2026, 10:58:13",Box reserved with Emirates Post/.test(out), out.slice(0, 1600));
check("...and the transcript, quoting what needs quoting", /Transcript \(Dubai time\),Speaker,Message/.test(out) && out.includes('Agent,"Your box, ""453924"", is booked,\nthank you."'));
check("a cell with a comma is quoted", csvCell("a,b") === '"a,b"' && csvCell("plain") === "plain" && csvCell(null) === "");
const row = listRow(payment, { journeyKey: "personal_po_box_rental", reference: "260973282", data });
check("a list row has a value for every heading", row.length === LIST_HEAD.length, { row: row.length, head: LIST_HEAD.length });
check("...with the box beside the money", row[LIST_HEAD.indexOf("PO Box number")] === "453924" && row[LIST_HEAD.indexOf("Amount")] === "670.00" && row[LIST_HEAD.indexOf("Status")] === "Settled");

// ---- wired ----------------------------------------------------------------------
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const list = read("../app/admin/payments/page.tsx");
check("the list links each payment to its page", /href=\{`\/admin\/payments\/\$\{r\.id\}`\}/.test(list));
check("...and exports what it is showing", /\/api\/admin\/payments\/export/.test(list) && /p\.set\("status", picked\)/.test(list) && /p\.set\("agent", selected\.slug\)/.test(list));
const page = read("../app/admin/payments/[id]/page.tsx");
check("the page shows the PO Box, the timeline and the transcript", /<h2>PO Box<\/h2>/.test(page) && /<h2>Timeline<\/h2>/.test(page) && /<h2>Transcript<\/h2>/.test(page));
check("...and exports itself", /\/api\/admin\/payments\/\$\{p\.id\}\/export/.test(page));
const exp = read("../app/api/admin/payments/export/route.ts");
check("the list export is scoped like the page", /currentScope/.test(exp) && /selectAgent/.test(exp));
check("the transaction is read through the scoped conversation", /adminConversationDetail/.test(read("../lib/paymentDetail.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
