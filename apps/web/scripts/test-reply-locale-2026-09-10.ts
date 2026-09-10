/**
 * The widget's language follows the conversation, not just the page.
 *
 * Reported 10 September: an Arabic conversation on the English site, where
 * everything the model said was Arabic and everything the widget said was
 * English — "18 to choose from", "Browse nearby branches on a map",
 * "Submission readiness", "Type your message…". Every one of those strings has
 * an Arabic translation and none of them were being told to use it.
 *
 * Run from apps/web:  npx tsx scripts/test-reply-locale-2026-09-10.ts
 */
import { messageLocale } from "../lib/replyLocale";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

console.log("\nA sentence says which language it is in");
check("Arabic is Arabic", messageLocale("أريد استئجار صندوق بريد في دبي") === "ar");
check("English is English", messageLocale("I want to rent a PO Box in Dubai") === "en");
check("a short Arabic answer still counts", messageLocale("نعم أريد المتابعة") === "ar");

console.log("\nToo short to say");
for (const t of ["hi", "ok", "2290", "👍", "", "  "]) {
  check(`"${t}" decides nothing`, messageLocale(t) === null, messageLocale(t));
}

console.log("\nA borrowed word is not a language");
// The branch names come back from Emirates Post in both scripts, and customers
// paste them. Flipping the whole interface on that would be worse than leaving
// it, so a mixed message decides nothing either way.
check("an Arabic branch name inside an English question does not flip it",
  messageLocale("Does فرع البرشاء have any boxes available today?") !== "ar",
  messageLocale("Does فرع البرشاء have any boxes available today?"));
check("...and an English bundle name inside Arabic does not flip it back",
  messageLocale("أريد باقة MyBox في دبي من فضلك") === "ar",
  messageLocale("أريد باقة MyBox في دبي من فضلك"));

console.log("\nSwitching back is as easy as switching");
check("a clean English sentence after Arabic reads as English",
  messageLocale("Actually, can we continue in English please?") === "en");

console.log("\nDigits and punctuation are not letters");
check("a box number with Arabic around it is Arabic", messageLocale("الصندوق 2290 من فضلك") === "ar");
check("a bare number decides nothing", messageLocale("392028") === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
