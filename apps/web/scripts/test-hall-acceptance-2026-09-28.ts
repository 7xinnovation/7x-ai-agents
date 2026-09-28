/**
 * "Proceed" is not an acceptance (2026-09-28).
 *
 * Reported on Emirates Post, with screenshots: a customer picks a branch that is
 * a P.O. Box hall, the service-limitations notice appears with two buttons, and
 * they type "Proceed". The next message is "Which box number would you like?".
 * Nothing had been accepted, and nothing had asked twice.
 *
 * On Emirates Post's own website and app those words sit in a modal behind a
 * mandatory checkbox — Continue does nothing until it is ticked. The agent was
 * the one channel where a customer could rent a box at a hall without ever
 * agreeing that there is no counter there and their key is issued in another
 * building.
 *
 * Run from apps/web:  npx tsx scripts/test-hall-acceptance-2026-09-28.ts
 */
import { readFileSync } from "node:fs";
import {
  HALL_ACCEPTED_KEY,
  HALL_PENDING_KEY,
  hallAccepted,
  hallAcceptedFor,
  hallNoticeBlock,
  mustAcceptReply,
  pendingHall,
  readsAsAcceptance,
  readsAsAnotherBranch,
  readsAsBarePush,
} from "../lib/hallNotice";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const HALL = {
  officeId: "215",
  name: "Al Quoz Mall",
  alternative: "Al Barsha Post Office",
  nameAr: "مول القوز",
  alternativeAr: "مكتب بريد البرشاء",
};

console.log("\nThe word that was typed when this was reported");
// The whole bug in one assertion.
check('"Proceed" is not acceptance', !readsAsAcceptance("Proceed"));
check('...it is recognised as a push past the notice', readsAsBarePush("Proceed"));
for (const word of ["continue", "ok", "OK.", "yes", "yeah", "next", "go ahead", "done", "تابع", "نعم", "حسنا"]) {
  check(`  "${word}" neither accepts nor slips through unnoticed`, !readsAsAcceptance(word) && readsAsBarePush(word));
}

console.log("\nWhat DOES accept");
for (const said of [
  "I accept these limitations, continue",
  "I accept",
  "accept",
  "I agree",
  "i acknowledge and agree to the above terms",
  "Accepted, go ahead",
  "أوافق على هذه الشروط، تابع",
  "اوافق",
  "موافق",
]) {
  check(`  "${said}"`, readsAsAcceptance(said));
}
// An acceptance that carries a push is still an acceptance — the order of the
// checks matters, and this is the button's own label.
check("the English button's exact label is not read as a bare push",
  readsAsAcceptance("I accept these limitations, continue"));
check("the Arabic button's exact label is not read as a bare push",
  readsAsAcceptance("أوافق على هذه الشروط، تابع") && !readsAsBarePush("أوافق على هذه الشروط، تابع"));

console.log("\nAnd a refusal is never read as an acceptance");
for (const said of ["I do not accept", "I don't agree", "no", "لا أوافق", "I can't accept that"]) {
  check(`  "${said}"`, !readsAsAcceptance(said));
}

console.log("\nThe other button");
check('"Choose a different branch"', readsAsAnotherBranch("Choose a different branch"));
check('"can I pick another location?"', readsAsAnotherBranch("can I pick another location?"));
check('"اختيار فرع آخر"', readsAsAnotherBranch("اختيار فرع آخر"));
check("...and it is not mistaken for accepting", !readsAsAcceptance("Choose a different branch"));

console.log("\nWhat is written down, and read back");
check("nothing pending on an empty case", pendingHall({}) === null);
const pendingData = { [HALL_PENDING_KEY]: HALL };
check("a pending hall reads back", pendingHall(pendingData)?.name === "Al Quoz Mall");
check("...with the branch that issues the key", pendingHall(pendingData)?.alternative === "Al Barsha Post Office");
check("...and is NOT accepted merely by being pending", !hallAcceptedFor(pendingData, "215"));
const acceptedData = {
  ...pendingData,
  [HALL_ACCEPTED_KEY]: { at: "2026-09-28T09:00:00.000Z", branch: HALL.name, officeId: "215", alternativeBranch: HALL.alternative },
};
check("once accepted, it is", hallAcceptedFor(acceptedData, "215"));
check("...and the timestamp is kept, because it is a record of acceptance", hallAccepted(acceptedData) === "2026-09-28T09:00:00.000Z");
// Accepting one hall is not accepting another: the text is the same, the branch
// their key is issued at is not.
check("accepting one hall does not accept a different one", !hallAcceptedFor(acceptedData, "219"));
check("an older record with no officeId is still honoured",
  hallAcceptedFor({ [HALL_ACCEPTED_KEY]: { at: "2026-09-27T00:00:00.000Z", branch: "somewhere" } }, "215"));

console.log("\nThe notice the customer reads");
const en = hallNoticeBlock(HALL, "en");
check("names the hall", en.includes("Al Quoz Mall"));
check("names where the key actually is", en.includes("Al Barsha Post Office"));
check("says the key is not issued there", /Keys are not issued at this P\.O\. Box Hall location/.test(en));
check("carries both buttons and no third", /```buttons\n- I accept these limitations, continue\n- Choose a different branch\n```/.test(en));
const ar = hallNoticeBlock(HALL, "ar");
// Until today this was built inline in the chat route and was English only, so
// an Arabic conversation met a wall of English at the one moment something is
// being accepted.
check("an Arabic conversation gets an Arabic notice", /تنبيه مهم/.test(ar) && !/Important Notice/.test(ar));
check("...naming the hall in Arabic", ar.includes("مول القوز"));
check("...and the operational branch in Arabic", ar.includes("مكتب بريد البرشاء"));
check("...with Arabic buttons", /أوافق على هذه الشروط، تابع/.test(ar));

console.log("\nWhat a push is answered with");
const blocked = mustAcceptReply(HALL, "en");
check("it says what is needed", /accept the service limitations/i.test(blocked));
check("it names the button rather than repeating itself", /I accept these limitations, continue/.test(blocked));
check("...and offers the way out", /choose a different branch/i.test(blocked));
check("the Arabic version is Arabic", /لا يمكننا المتابعة/.test(mustAcceptReply(HALL, "ar")));

console.log("\nThe box lookup is refused, which is the part that cannot be talked round");
const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
check("the gate is on FreeBoxes, the call that IS choosing a branch",
  /const askedHall = loc \? lastBranchHalls\.find\(\(h\) => h\.officeId === loc\) : undefined;/.test(integrations));
check("...and refuses when this branch has not been accepted",
  /if \(askedHall && opts\.hallLimitationsAccepted && !opts\.hallLimitationsAccepted\(loc\)\)/.test(integrations));
check("...telling the model not to invent box numbers instead",
  /do NOT list or invent box numbers/.test(integrations));
check("...and that it may call again once they accept",
  /call this again with the same LocationId/.test(integrations));
check("the refusal is recorded", /action: "hall_limitations_lookup_blocked"/.test(integrations));
check("the hall is exposed to the turn that has to show the notice", /getUnacceptedHall: \(\) => unacceptedHall,/.test(integrations));
check("the hall's Arabic name is carried through from the branch list", /nameAr: String\(h\.nameAr \?\? ""\) \|\| undefined,/.test(integrations));

console.log("\nAnd the turn itself");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("acceptance is judged on the customer's words, not the model's report",
  /if \(readsAsAcceptance\(body\.userMessage\)\)/.test(route));
check("...recorded with the branch, the key branch and the time",
  /\[HALL_ACCEPTED_KEY\]: \{\s*\n\s*at,\s*\n\s*branch: hallToAccept\.name,/.test(route));
check("...and audited as the customer's own act", /actor: "user",\s*\n\s*action: "hall_limitations_accepted"/.test(route));
check("a bare push is answered without running the model at all",
  /readsAsBarePush\(body\.userMessage\)[\s\S]{0,400}mustAcceptReply\(hallToAccept, body\.locale\)/.test(route));
check("...and that refusal is in the transcript, not just on the wire",
  /appendMessage\(session\.conversationId, "assistant", reply\)/.test(route));
check("...and recorded", /action: "hall_limitations_push_blocked"/.test(route));
check("the other button clears the pending hall", /delete data\[HALL_PENDING_KEY\];/.test(route));
check("the case the tools read is updated in the same breath", /liveState = session\.state;/.test(route));
check("the tool layer is asked per branch", /hallLimitationsAccepted: \(officeId: string\) => hallAcceptedFor\(liveState\.data as Record<string, unknown>, officeId\)/.test(route));
check("the notice is appended until accepted, not once per conversation",
  /const accepted = hallAcceptedFor\(finalState\.data as Record<string, unknown>, chosen\?\.officeId\);\s*\n\s*if \(chosen && !accepted\) \{/.test(route));
check("...and the pending hall is persisted on the case", /\[HALL_PENDING_KEY\]: \{/.test(route));
check("...without a second set of buttons if the model wrote it too",
  /if \(!\/Important Notice\|تنبيه مهم\/i\.test\(finalText\)\) \{/.test(route));
check("the model is told the rental cannot go on", /ACCEPTANCE OUTSTANDING/.test(readFileSync(new URL("../lib/hallNotice.ts", import.meta.url), "utf8")));
// The guard that made "Proceed" work: shown once, then never again.
check("the once-per-conversation suppression is gone", !/noticeAlreadyShown/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
