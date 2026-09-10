/**
 * An address read off the trade licence is not a question.
 *
 * Reported 10 September: "One more thing before we wrap up — please confirm the
 * location of your company's office on the map", with a pin control, for a
 * company whose street address had been read off its trade licence several turns
 * earlier and was in the panel in Arabic at that moment.
 *
 * The existing guard only decided whether WE appended a map block. The model
 * writes its own, with its own label, and nothing took that away.
 *
 * Run from apps/web:  npx tsx scripts/test-map-offer-2026-09-10.ts
 */
import { mapOfferGuard } from "../lib/locateGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** Feed a reply through in awkward chunks, as the model actually streams it. */
function run(text: string, opts: { addressKnown: boolean; userAsked?: string }, chunk = 7): string {
  const g = mapOfferGuard({ addressKnown: () => opts.addressKnown, userAsked: opts.userAsked });
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
}

const REPORTED =
  "Got it. One more thing before we wrap up — please confirm the location of your company's office on the map.\n\n" +
  "```locate\nlabel: Drag the pin to your office location\n```";

console.log("\nThe address is on file");
{
  const out = run(REPORTED, { addressKnown: true });
  check("the pin control goes", !/```locate/.test(out), out);
  check("...and so does the sentence that offered it", !/on the map/i.test(out), out);
  check("the rest of the reply survives", /Got it\./.test(out), out);
}
{
  const t = "Your application is ready. Please drop a pin on the map so I can confirm the area. Anything else?";
  const out = run(t, { addressKnown: true });
  check("a bare offer with no block goes too", !/drop a pin/i.test(out), out);
  check("...and the sentences around it stay", /ready\./.test(out) && /Anything else\?/.test(out), out);
}

console.log("\nThe address is NOT on file");
{
  const out = run(REPORTED, { addressKnown: false });
  check("the map is left exactly as written", out === REPORTED, out);
}

console.log("\nThe customer asked for it");
{
  const out = run(REPORTED, { addressKnown: true, userAsked: "can I pin it on the map instead?" });
  check("an explicit request is honoured", /```locate/.test(out), out);
  const out2 = run(REPORTED, { addressKnown: true, userAsked: "I want to correct my location" });
  check("...including a request to correct it", /```locate/.test(out2), out2);
}

console.log("\nWhat it must not touch");
{
  const t = "Location shared: Al Mankhool, Dubai. That pin is inside your emirate, so we can proceed.";
  check("talking about a pin already dropped is not an offer", run(t, { addressKnown: true }) === t, run(t, { addressKnown: true }));
}
{
  const t = "Here are your branches.\n\n```cards\n- id: 1\n  title: Al Mankhool\n```\n\nWhich one?";
  check("other fenced blocks pass untouched", run(t, { addressKnown: true }) === t, run(t, { addressKnown: true }));
}
{
  const t = "Your licence request is LR-37325. The fee is AED 1,000.";
  check("an ordinary reply is unchanged", run(t, { addressKnown: true }) === t, run(t, { addressKnown: true }));
}
{
  // Arabic offers were invisible to the earlier regex for want of word boundaries.
  const t = "حسنًا. يرجى تحديد موقعك على الخريطة.\n\n```locate\nlabel: حدد موقعك\n```";
  const out = run(t, { addressKnown: true });
  check("the Arabic offer goes as well", !/```locate/.test(out) && !/الخريطة/.test(out), out);
}

console.log("\nChunking must not change the answer");
for (const size of [1, 3, 11, 400]) {
  const out = run(REPORTED, { addressKnown: true }, size);
  check(`identical at ${size} bytes a chunk`, !/```locate/.test(out) && /Got it\./.test(out), out);
}
{
  const t = "All set.\n\n```locate\nlabel: Pin\n```";
  const whole = run(t, { addressKnown: false }, 1);
  check("nothing is lost when the map is kept", whole === t, whole);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
