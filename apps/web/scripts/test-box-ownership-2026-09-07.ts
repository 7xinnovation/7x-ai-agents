/**
 * A box you do not hold is not yours to manage (2026-09-07).
 *
 * Reported on production: signed in as yourself, typing a stranger's PO Box
 * number let you manage it — add an authorised agent, and the rest. The journey
 * required a signed-in customer and stopped there; it never checked that the
 * box they NAMED was one of theirs.
 *
 * Renewing stays open on purpose. Emirates Post's own guest flow renews any box
 * from its number and emirate, and paying to extend someone's subscription takes
 * nothing from them. Everything that CHANGES a box is gated.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-box-ownership-2026-09-07.ts
 */
import { isManagementPath, boxNumberIn, holdsBox, mayManage } from "@/lib/boxOwnership";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// ── what counts as managing ─────────────────────────────────────────────────
for (const p of [
  "/api/Renewal/SaveAgent",
  "/api/Renewal/UpdateAgent",
  "/api/Renewal/GetAgents",
  "/api/Renewal/SaveTijari",
  "/api/Renewal/ProcessPaymentTijari",
  "/api/Renewal/VerifyCancel",
  "/api/Renewal/ValidateCancel",
  "/api/ChangeAddress/Save",
  "/api/ChangeLock/Save",
  "/api/ChangeLock/Confirm/{paymentRefNo}",
  "/api/UpdateAutoRenewConfig",
  "/api/Guest/UpdateAutoRenewConfig",
]) check(`managing: ${p}`, isManagementPath(p, "POST"), p);

check("cancelling a subscription is managing", isManagementPath("/api/Renewal", "DELETE"));
check("...but reading one is not", !isManagementPath("/api/Renewal", "GET"));

// RENEWING IS NOT MANAGING. Emirates Post's own guest flow does this by design.
for (const p of [
  "/api/Guest/Renewal/Save",
  "/api/Guest/Renewal/Pricing",
  "/api/Guest/Renewal/ConfirmPayment",
  "/api/Renewal/Pricing",
  "/api/Renewal/Save",
  "/api/Renewal/Details",
  "/api/Rental/Save",
  "/api/Rental/Select",
  "/api/Rental/Bundle",
]) check(`NOT managing: ${p}`, !isManagementPath(p, "POST"), p);

// ── finding the box in the request ──────────────────────────────────────────
check("a box number in the body", boxNumberIn({ body: { boxNumber: 450735 } }) === "450735");
check("a differently-spelled one", boxNumberIn({ body: { PoBoxNumber: "44192" } }) === "44192");
check("one in the query string", boxNumberIn({ BoxNumber: "50500" }) === "50500");
check("a uniqueBoxId", boxNumberIn({ body: { uniqueBoxID: "2450735" } }) === "2450735");
check("one nested deeper", boxNumberIn({ body: { agent: { poBox: "76402" } } }) === "76402");
check("nothing at all", boxNumberIn({ body: { name: "Someone" } }) === undefined);
check("a cycle does not hang it", (() => { const a: Record<string, unknown> = {}; a.self = a; a.boxNumber = "1"; return boxNumberIn(a) === "1"; })());

// ── whose box is it ─────────────────────────────────────────────────────────
const mine = ["450735", "911933", "44192"];
check("my own box", holdsBox(mine, "450735"));
check("its uniqueBoxId form", holdsBox(mine, "2450735"));
check("a stranger's box", !holdsBox(mine, "999999"));
check("a box that merely starts the same", !holdsBox(mine, "450"), holdsBox(mine, "450"));
check("nothing asked", !holdsBox(mine, ""));

// ── the verdict ─────────────────────────────────────────────────────────────
check("managing my own box is allowed", mayManage(mine, "450735").ok);
check("managing a stranger's is REFUSED", !mayManage(mine, "999999").ok);
check("...and the refusal names the box", /999999/.test(mayManage(mine, "999999").reason ?? ""));
check("...and says renewing is different", /[Rr]enewing a box is a different matter/.test(mayManage(mine, "999999").reason ?? ""));
check("a customer with no boxes cannot manage one", !mayManage([], "999999").ok);

// FAILS CLOSED. An unverifiable claim of ownership is the case this exists for.
check("ownership unknown REFUSES", !mayManage(null, "450735").ok);
check("...and asks them to sign in rather than blaming the system", /sign in with UAE PASS/.test(mayManage(null, "450735").reason ?? ""));
check("no box number at all REFUSES", !mayManage(mine, undefined).ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
