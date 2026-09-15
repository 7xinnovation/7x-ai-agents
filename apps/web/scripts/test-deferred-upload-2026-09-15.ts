/**
 * A reply that says "come back to it" does not also put the box back.
 *
 * EPGL, 15 September: a Form 9 was refused as another company's document, the
 * customer said "do I need to upload that right now? I don't have one on me",
 * and the reply agreed — "you can come back to it… you don't need to upload it
 * right now" — with the upload control underneath it and the same rejection
 * repeated in red. The words said later, the interface said now, and the red
 * paragraph reads as a second rejection of a second attempt.
 *
 * Run from apps/web:  npx tsx scripts/test-deferred-upload-2026-09-15.ts
 */
import { collectedUploadGuard, defersUpload, asksSomethingElse } from "../lib/uploadGuard";
import { resolveUploadKeys } from "../app/embed/[agent]/Markdown";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** Streamed in awkward chunks, as the model actually writes it. */
function run(text: string, collected: (k: string) => null = () => null, chunk = 9): string {
  const g = collectedUploadGuard(collected);
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
}

const BLOCK = "```upload\nkey: form_9\n```";

console.log("\nThe reported reply");
{
  const reported =
    "No problem — you can come back to it. The Form 9 is mandatory for the renewal, so the application can't be submitted without it, but you don't need to upload it right now.\n\n" +
    "Let's keep moving with what you do have. What's your **postal license number**?\n\n" + BLOCK;
  const out = run(reported);
  check("the upload control goes", !/```upload/.test(out), out);
  check("the reassurance stays", /you can come back to it/.test(out), out);
  check("...and so does the next question", /postal license number/.test(out), out);
}

console.log("\nA genuine ask is untouched");
{
  const asking = "Let's start with the trade licence. Please upload it below.\n\n```upload\nkey: trade_license\n```";
  check("the control survives", run(asking).includes("```upload"), run(asking));
  const afterReject =
    "The Form 9 you uploaded belongs to TFM EXPRESS SHIPPING L.L.C, not YI FANG TAIWAN FRUIT TEA L.L.C. Please upload the Form 9 for the correct company.\n\n" + BLOCK;
  check("a rejection still offers a retry", run(afterReject).includes("```upload"), run(afterReject));
}

console.log("\nWhat counts as deferring");
for (const s of [
  "you can come back to it",
  "you don't need to upload it right now",
  "no need to upload anything yet — whenever you have it",
  "no rush, we can carry on",
  "لا داعي الآن، يمكنك رفعه لاحقاً",
  "يمكنك العودة إليه عندما يتوفر",
]) check(`"${s.slice(0, 44)}"`, defersUpload(s), s);

for (const s of [
  "Please upload the Form 9 for the correct company.",
  "Let's start with the trade licence.",
  "This document names another company.",
  "يرجى رفع النموذج 9 الخاص بالشركة الصحيحة.",
]) check(`NOT deferring: "${s.slice(0, 40)}"`, !defersUpload(s), s);

console.log("\nStreaming and state");
{
  const reported = "No problem — you can come back to it, you don't need to upload it right now.\n\n" + BLOCK;
  for (const chunk of [1, 4, 17, 500]) {
    check(`chunk size ${chunk} gives the same answer`, !run(reported, () => null, chunk).includes("```upload"), chunk);
  }
  /**
   * WHAT A REPLY HAS SAID, IT HAS SAID — flush() is not a reply boundary.
   *
   * This pair used to assert the opposite: that flush() cleared the flag so the
   * NEXT reply started fresh. It does not end a reply. The chat route flushes
   * every guard whenever a non-text event arrives mid-turn — a case update, a
   * citation, a tool result — and the model calls a tool between almost every
   * pair of sentences, so clearing on flush meant the rule held only for
   * messages that made no tool calls. EPGL's MOA box, reported twice on
   * 15 September, arrived through exactly that gap.
   *
   * The reply boundary is the guard itself: the route builds one per request.
   */
  const g = collectedUploadGuard(() => null);
  let a = "";
  for (const c of ["You can come back to it.\n\n", BLOCK]) a += g.push(c);
  a += g.flush();                                   // a tool call, mid-reply
  for (const c of ["Please upload it below.\n\n", BLOCK]) a += g.push(c);
  a += g.flush();
  check("the control is dropped", !a.includes("```upload"), a);
  check("...and stays dropped across a mid-reply flush", a.split("```upload").length === 1, a);
  // A new reply is a new guard, and knows nothing of the last one.
  const next = collectedUploadGuard(() => null);
  let b = "";
  for (const c of ["Please upload it below.\n\n", BLOCK]) b += next.push(c);
  b += next.flush();
  check("...while the next reply starts clean", b.includes("```upload"), b);
}

console.log("\nThe existing rule still holds");
{
  const already = "Here you go.\n\n```upload\nkey: trade_license\n```";
  const out = run(already, (() => ({ label: "Trade License", fileName: "tl.pdf" })) as never);
  check("a collected document is still answered, not asked for", /Already uploaded/.test(out) && !/```upload/.test(out), out);
}

console.log("\nA message asks for one thing");
{
  // The reported reply, verbatim in shape.
  const eid =
    "Partner 2's passport is in — picked up passport number ending 0887.\n\n" +
    "Now I need Partner 2's Emirates ID. Does Abdelaziz live in the UAE, or is he based outside the UAE?\n\n" +
    "```buttons\n- Upload the Emirates ID\n- Type the number\n- This partner lives outside the UAE\n```\n\n" +
    "```upload\nkey: moa\n```";
  const out = run(eid);
  check("the stray upload control goes", !/```upload/.test(out), out);
  check("the question stays", /based outside the UAE/.test(out), out);
  check("...and so do its three answers", /This partner lives outside the UAE/.test(out), out);

  check("buttons are recognised as the question", asksSomethingElse("```buttons\n- Yes\n```"));
  check("cards are not", !asksSomethingElse("```cards\ntitle: MyBox\n```"));
  check("prose is not", !asksSomethingElse("Please upload the trade licence."));

  // The genuine pairing reads the other way round and must survive.
  const pairing = "Please upload it below.\n\n```upload\nkey: form_9\n```\n\n```buttons\n- I don't have it yet\n```";
  check("upload-then-buttons is left alone", run(pairing).includes("```upload"), run(pairing));
}

console.log("\nAn unresolved block guesses at something the application needs");
{
  const ctx = {
    docs: {
      moa: { label: { en: "MOA" }, requirement: "optional", acceptedFormats: [], maxSizeMb: 10 },
      partner_2_emirates_id: { label: { en: "Partner 2 EID" }, requirement: "mandatory", acceptedFormats: [], maxSizeMb: 10 },
    },
    pendingDocs: ["moa", "partner_2_emirates_id"],
  } as never;
  check("a resolvable key still wins", resolveUploadKeys(["key: partner_2_emirates_id"], ctx).join() === "partner_2_emirates_id");
  const guessed = resolveUploadKeys(["key: nonsense"], ctx);
  check("an optional document is never the guess", !guessed.includes("moa"), guessed);
  check("...the mandatory one is", guessed.join() === "partner_2_emirates_id", guessed);
  check("and only one guess is made", guessed.length <= 1, guessed);
  const noneRequired = resolveUploadKeys(["key: nonsense"], { docs: { moa: { label: { en: "MOA" }, requirement: "optional", acceptedFormats: [], maxSizeMb: 10 } }, pendingDocs: ["moa"] } as never);
  check("nothing outstanding and required: render nothing", noneRequired.length === 0, noneRequired);
}

console.log("\nA block naming two documents is about the required one");
{
  const ctx = {
    docs: {
      moa: { label: { en: "MOA" }, requirement: "optional", acceptedFormats: [], maxSizeMb: 10 },
      lease_contract: { label: { en: "Lease" }, requirement: "optional", acceptedFormats: [], maxSizeMb: 10 },
      partner_1_emirates_id: { label: { en: "Partner 1 EID" }, requirement: "mandatory", acceptedFormats: [], maxSizeMb: 10 },
      partner_1_passport: { label: { en: "Partner 1 passport" }, requirement: "mandatory", acceptedFormats: [], maxSizeMb: 10 },
    },
    statuses: {},
    pendingDocs: ["moa", "partner_1_emirates_id"],
  } as never;

  // The reported shape, verbatim from conversation 699d5f4a.
  const paired = resolveUploadKeys(["key: moa", "key: partner_1_emirates_id"], ctx);
  check("the optional MOA drops out", !paired.includes("moa"), paired);
  check("...and the Emirates ID is what renders", paired.join() === "partner_1_emirates_id", paired);
  check("order does not matter", resolveUploadKeys(["key: partner_1_emirates_id", "key: moa"], ctx).join() === "partner_1_emirates_id");

  // The genuine pairing, which must survive.
  const both = resolveUploadKeys(["key: partner_1_passport", "key: partner_1_emirates_id"], ctx);
  check("two required documents both stay", both.length === 2, both);

  // And an offer of optional things on its own IS the offer.
  const offer = resolveUploadKeys(["key: moa", "key: lease_contract"], ctx);
  check("a block of only optional documents is untouched", offer.length === 2, offer);
  check("a single optional document still renders", resolveUploadKeys(["key: moa"], ctx).join() === "moa");

  // A requirement already met is not a reason to drop the offer beside it.
  const done = { ...(ctx as never as Record<string, never>), statuses: { partner_1_emirates_id: { status: "accepted" } } } as never;
  check("an already-uploaded requirement does not suppress the offer", resolveUploadKeys(["key: moa", "key: partner_1_emirates_id"], done).includes("moa"));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
