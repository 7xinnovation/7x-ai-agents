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
import { messageLocale, historyLocale } from "../lib/replyLocale";

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

console.log("\nData is not a sentence (16 September)");
/**
 * An Arabic application, at the step where the assistant asks for the
 * applicant's name and email. The customer answered with their own name, their
 * own address and their own number — the only script any of them can be written
 * in — and the interface switched to English for the rest of the session while
 * they carried on typing Arabic.
 */
for (const t of [
  "emre karayalcin, emre.karayalcin@7x.ae, 0553708434",
  "emre.karayalcin@7x.ae",
  "Emre Karayalcin",
  "LR-37382",
  "YI FANG TAIWAN FRUIT TEA L.L.C",
  "697670",
  "0553708434",
  "784-1984-0847950-3",
]) {
  check(`"${t.slice(0, 38)}" is data, not English`, messageLocale(t) !== "en", messageLocale(t));
}
check("a sentence with contact details in it is still a sentence",
  messageLocale("you can email me at emre.karayalcin@7x.ae if anything is missing") === "en",
  messageLocale("you can email me at emre.karayalcin@7x.ae if anything is missing"));
check("three words are enough to ask for English", messageLocale("I prefer English") === "en");
check("...and Arabic still needs only its own script", messageLocale("اسمي عمرة") === "ar");
// The other half of the same rule: a Latin ANSWER inside an Arabic journey is
// the commonest thing there is, and none of it is a language change.
for (const t of ["Dubai", "Al Mankhool", "Limited Liability Company (LLC)", "MyBox", "Ajman Central Post Office"]) {
  check(`"${t}" is an answer, not English`, messageLocale(t) !== "en", messageLocale(t));
}
check("a real English question still switches", messageLocale("what documents do you need from me") === "en");
check("...and so does asking for it outright", messageLocale("can we continue in english") === "en");

console.log("\nDigits and punctuation are not letters");
check("a box number with Arabic around it is Arabic", messageLocale("الصندوق 2290 من فضلك") === "ar");
check("a bare number decides nothing", messageLocale("392028") === null);

console.log("\nThe language the conversation has been held in");
{
  const ar = [
    { role: "assistant", content: "مرحباً! كيف يمكنني مساعدتك اليوم في رخص النشاط البريدي؟" },
    { role: "user", content: "التقدّم بطلب رخصة" },
    { role: "assistant", content: "ممتاز، لنبدأ. العملية بسيطة وتمر بثلاث مراحل: رفع المستندات، مراجعة البيانات، ثم الدفع." },
  ];
  const en = [
    { role: "assistant", content: "Hello! How can I help you with postal activity licensing today?" },
    { role: "assistant", content: "Great — let's start. The process has three stages: documents, details, then payment." },
  ];
  check("an Arabic transcript reads as Arabic", historyLocale(ar) === "ar");
  check("an English one as English", historyLocale(en) === "en");
  check("the customer's own messages do not decide it", historyLocale([{ role: "user", content: "أريد رخصة" }, ...en]) === "en");
  check("a transcript too short to tell decides nothing", historyLocale([{ role: "assistant", content: "تم." }]) === null, historyLocale([{ role: "assistant", content: "تم." }]));
  check("an empty history decides nothing", historyLocale([]) === null && historyLocale(undefined) === null);
  // THE REPORTED CASE: the interface says English, the transcript is Arabic, and
  // the model mirrors what it reads unless something says otherwise.
  check("a switch is visible as a disagreement", historyLocale(ar) !== "en");
}


console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
