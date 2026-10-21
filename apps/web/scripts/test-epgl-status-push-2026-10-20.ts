/**
 * The EPGL status endpoint: what it refuses, and why.
 *
 *   npx tsx scripts/test-epgl-status-push-2026-10-20.ts
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const src = readFileSync(new URL("../app/api/epgl/status/route.ts", import.meta.url), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

console.log("\nIt fails closed, unlike the payment webhook beside it");
check("no secret configured means no request is accepted", /if \(!secret \|\| !header\) return false;/.test(src));
check("...and the reason is written down", /REGULATOR'S DECISION/.test(src));
check("the payment webhook still skips when unset, and still should",
  /if \(!secret\) return true;/.test(readFileSync(new URL("../app/api/payments/webhook/route.ts", import.meta.url), "utf8")));

console.log("\nThe signature is over the bytes that arrived");
check("the raw body is read before it is parsed", /const raw = await req\.text\(\);/.test(src) && src.indexOf("await req.text()") < src.indexOf("JSON.parse(raw"));
check("compared in constant time", /timingSafeEqual/.test(src));
check("a length mismatch cannot throw past the check", /a\.length === b\.length && timingSafeEqual/.test(src));

console.log("\nReplay and ordering");
check("a stale timestamp is refused", /MAX_SKEW_MS/.test(src) && /stale_timestamp/.test(src));
check("a repeated eventId is a 200, not a complaint", /auditSeen\(found\.conversationId, ACTION, body\.eventId\)/.test(src) && /idempotent: true/.test(src));
check("an event older than the one already acted on is recorded, not shown", /const stale =/.test(src) && /if \(!stale\)/.test(src));
check("auditSeen matches on reference, so the event id is stored there", /reference: body\.eventId/.test(src));

console.log("\nWhat it says to the applicant");
check("in the conversation's own language", /conv\?\.locale \?\? "en"/.test(src));
check("their words for the status, never ours", /pick\(app\?\.applicantStatus\) \|\| pick\(body\.decision\?\.status\)/.test(src));
check("an open information request is its own sentence", /informationRequest\?\.open/.test(src));
check("an issued licence names its number", /licence\?\.licenceNumber/.test(src));

console.log("\nMatching, while applicationId is unsettled");
check("both spellings are looked at rather than one guessed", /'application_id'/.test(src) && /'applicationId'/.test(src));
check("an unmatched application is a 404 so they stop retrying", /unknown_application/.test(src) && /status: 404/.test(src));

console.log("\nThe signature a sender would compute");
const secret = "shared-secret";
const raw = JSON.stringify({ eventId: "EVT-1", applicationId: "APP-1" });
const sig = createHmac("sha256", secret).update(raw).digest("hex");
check("hex, sha256, over the raw string", sig.length === 64 && /^[0-9a-f]+$/.test(sig));
check("a changed byte changes it", createHmac("sha256", secret).update(raw + " ").digest("hex") !== sig);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
