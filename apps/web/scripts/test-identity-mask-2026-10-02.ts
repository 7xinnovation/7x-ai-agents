/**
 * Identity numbers masked in the CHAT, not only in the panel (2026-10-02).
 *
 * "It didn't mask the first part of the passport number which it should, just
 * like it's done on the right side."
 *
 * The rule was built on 11 September and built client-side, in the application
 * panel. The chat was never covered, so the panel showed `•••••4322` beside a
 * reply that read:
 *
 *   "Zain's passport is in — picked up passport number ending P11734322."
 *
 * Masked in one pane and printed in full in the other, in the same sentence as
 * the word "ending".
 *
 * Run from apps/web:  npx tsx scripts/test-identity-mask-2026-10-02.ts
 */
import { readFileSync } from "node:fs";
import { identityGuard, identityValues, maskIdentitiesIn } from "../lib/identityGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

/** The case as it stood when the reply above was written. */
const CASE = {
  partner_1_passport: "P11734322",
  partner_1_emirates_id: "784-1997-0827680-5",
  partner_2_passport: "A08466759",
  trade_license_number: "1196781",
  po_box_number: "450367",
  contact_name: "ZAIN ELABDEEN",
};

console.log("\nOnly the values the case holds as identity numbers");
{
  const v = identityValues(CASE);
  check("the passports are watched", v.includes("P11734322") && v.includes("A08466759"), v);
  check("...and the Emirates ID", v.includes("784-1997-0827680-5"));
  // A guard that masked these would be a worse bug than the one it fixes.
  check("the trade licence is NOT", !v.includes("1196781"));
  check("the PO Box is NOT", !v.includes("450367"));
  check("a name is NOT", !v.some((x) => x.includes("ZAIN")));
  // Longest first, so masking "P11734322" never leaves a shorter prefix behind.
  check("longest first", v[0]!.length >= v[v.length - 1]!.length);
}

console.log("\nThe sentence from the screenshot");
{
  const line = "Zain's passport is in — picked up passport number ending P11734322.";
  const out = maskIdentitiesIn(line, identityValues(CASE));
  check("the number is masked", out.includes("•••••4322"), out);
  check("...and is no longer there in full", !out.includes("P11734322"));
  // "ending •••••4322" is now a true sentence, which it was not before.
  check("...the rest of the sentence is untouched", out.startsWith("Zain's passport is in"));
}

console.log("\nWhat must NOT be touched");
{
  const vals = identityValues(CASE);
  const line = "Your application LR-37652 for trade licence 1196781 covers PO Box 450367 — total AED 101,000.";
  check("references, licences, boxes and money survive", maskIdentitiesIn(line, vals) === line, maskIdentitiesIn(line, vals));
}

console.log("\nAn Emirates ID is masked even before the case records it");
{
  // Read aloud from a document in the same breath it was extracted. No other
  // number in either agent begins 784-.
  const out = maskIdentitiesIn("I can see 784-1961-1874270-7 on the card.", []);
  check("masked on sight", out.includes("•••-••••-••••270-7"), out);
  // Separators kept, so it still reads as an Emirates ID rather than a blob.
  check("...with the shape kept", out.includes("-") && out.endsWith("on the card."));
  const bare = maskIdentitiesIn("The number is 784199983926421 exactly.", []);
  check("...written without separators too", bare.includes("•••••••••••6421"), bare);
}

console.log("\nStreaming: a number split across deltas must not escape");
{
  const g = identityGuard(() => identityValues(CASE));
  let out = "";
  // The exact way it would arrive from the model, a few characters at a time.
  for (const d of ["Zain's passport is in — picked ", "up passport number ending P117", "34322.", " Now I need Partner 1's Emirates ID."]) out += g.push(d);
  out += g.flush();
  check("nothing leaks in halves", !out.includes("P11734322"), out);
  check("...and the masked value is there once", (out.match(/•••••4322/g) ?? []).length === 1, out);
  check("...the whole reply still arrives", out.startsWith("Zain's passport is in") && out.endsWith("Emirates ID."));
  check("...and it was counted", g.masked() > 0);
}
{
  // Nothing to mask: every byte still comes out, in order, exactly once.
  const g = identityGuard(() => []);
  const text = "Hello — your renewal is ready to submit. Shall I proceed with the filing now?";
  let out = "";
  for (const ch of text) out += g.push(ch);
  out += g.flush();
  check("a reply with no identity numbers is unchanged", out === text, out);
}

console.log("\nAnd it is the last filter before the customer");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("wired outermost on the text path", /const out = idMask\.push\(keyGuard\.push\(/.test(route));
// A non-text event ends the run, so what it is holding goes with it.
check("...flushed when the run ends", /\+ idMask\.flush\(\);\s*\n\s*if \(held\)/.test(route));
check("...and at the end of the turn", /\+ keyGuard\.flush\(\)\) \+ idMask\.flush\(\);/.test(route));
// The case gains a passport number mid-turn, when the document is read.
check("the case is read lazily, not captured", /identityGuard\(\(\) => identityValues\(/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
