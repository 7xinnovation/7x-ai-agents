/**
 * The master agent's routing rules (lib/masterAgent), without a model.
 *
 *   npx tsx scripts/test-master-agent-2026-11-04.ts
 *
 * What must hold: a tapped service button routes without asking anyone; an
 * answer to the agent in charge ("yes", a box number, a button from its last
 * reply, an upload, a payment coming back) never moves the conversation; the
 * router moves a conversation under way only when it is sure; and when nobody
 * can tell which service is wanted, the master asks.
 */
import { AgentDefinition } from "@dialog/config";
import {
  isMaster,
  defaultDelegate,
  matchLabel,
  buttonsIn,
  plainlyAnAnswer,
  decide,
  needsRouter,
  delegateBrief,
  whichService,
  SWITCH_CONFIDENCE,
  type RouteInput,
} from "../lib/masterAgent";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}

const base = { tenantSlug: "epg", persona: "", locales: ["en", "ar"], greeting: { en: "Hi" }, theme: { brandName: "EP", colors: {}, launcher: {} } };
const master = AgentDefinition.parse({
  ...base,
  slug: "ep-master",
  name: "Emirates Post",
  delegates: [
    { slug: "nxn-dialog", label: { en: "PO Boxes", ar: "صناديق البريد" } },
    { slug: "epgl-dialog", label: { en: "Postal licences", ar: "التراخيص البريدية" } },
  ],
  defaultDelegate: "nxn-dialog",
});
const nxn = AgentDefinition.parse({
  ...base,
  tenantSlug: "nxn",
  slug: "nxn-dialog",
  name: "Emirates Post",
  intents: [
    { key: "renew_personal_pobox", description: { en: "Renew a personal PO Box" } },
    { key: "human_help", description: { en: "Talk to a person" } },
  ],
});
const epgl = AgentDefinition.parse({
  ...base,
  tenantSlug: "epgl",
  slug: "epgl-dialog",
  name: "EPGL Dialog",
  intents: [{ key: "new_license", description: { en: "Apply for a new postal licence" } }],
});
const ordinary = AgentDefinition.parse({ ...base, slug: "x", name: "X" });
const children = { "nxn-dialog": nxn, "epgl-dialog": epgl };
const input = (over: Partial<RouteInput>): RouteInput => ({
  master,
  children,
  message: "",
  locale: "en",
  current: null,
  lastReply: null,
  synthetic: false,
  ...over,
});

console.log("what a master is");
check("a definition with delegates is a master", isMaster(master));
check("an ordinary definition is not", !isMaster(ordinary));
check("the configured default delegate", defaultDelegate(master) === "nxn-dialog");
check(
  "a default that is not a delegate falls back to the first",
  defaultDelegate({ ...master, defaultDelegate: "nope" }) === "nxn-dialog"
);

console.log("service buttons");
check("English label routes", matchLabel(master, "PO Boxes") === "nxn-dialog");
check("case and punctuation do not matter", matchLabel(master, "  postal LICENCES. ") === "epgl-dialog");
check("Arabic label routes", matchLabel(master, "التراخيص البريدية") === "epgl-dialog");
check("a sentence containing a label is not a tap", matchLabel(master, "I want to know about PO Boxes prices") === null);
const ask = whichService(master, "en");
check("the master's question offers every service as a button", JSON.stringify(buttonsIn(ask)) === JSON.stringify(["PO Boxes", "Postal licences"]), buttonsIn(ask));
check("…and tapping one routes", buttonsIn(ask).map((b) => matchLabel(master, b)).join() === "nxn-dialog,epgl-dialog");
check("Arabic question in Arabic", whichService(master, "ar").includes("صناديق البريد"));

console.log("answers stay with whoever asked");
const reply = "Which box would you like to renew?\n\n```buttons\n- Box 450293 in Dubai\n- Another box\n```";
check("'yes'", plainlyAnAnswer("yes", null));
check("a box number", plainlyAnAnswer("450293", null));
check("a date", plainlyAnAnswer("12/03/2027", null));
check("a button from the last reply", plainlyAnAnswer("Box 450293 in Dubai", reply));
check("a real request is not an answer", !plainlyAnAnswer("I also need a postal licence for my company", reply));
check(
  "'yes' mid-renewal stays on NXN without the router",
  !needsRouter(input({ message: "yes", current: "nxn-dialog" })) && decide(input({ message: "yes", current: "nxn-dialog" }), null).target === "nxn-dialog"
);
check(
  "an upload stays with the current delegate",
  decide(input({ message: "document_uploaded", current: "epgl-dialog", synthetic: true }), null).target === "epgl-dialog"
);
check(
  "a returning payment with no conversation goes to the default",
  decide(input({ message: "payment_settled", synthetic: true }), null).target === "nxn-dialog"
);

console.log("the router's verdict");
const switching = input({ message: "I also need a postal licence for my company", current: "nxn-dialog", lastReply: reply });
check("a real request consults the router", needsRouter(switching));
check(
  "a sure switch moves the conversation",
  decide(switching, { target: "epgl-dialog", confidence: 0.9 }).target === "epgl-dialog"
);
check(
  "an unsure switch does not",
  decide(switching, { target: "epgl-dialog", confidence: SWITCH_CONFIDENCE - 0.05 }).target === "nxn-dialog"
);
check("'unclear' mid-conversation stays", decide(switching, { target: "unclear", confidence: 0.9 }).target === "nxn-dialog");
check("a router failure mid-conversation stays", decide(switching, "failed").target === "nxn-dialog");
check("a target that is not a delegate is ignored", decide(switching, { target: "collections-dialog", confidence: 1 }).target === "nxn-dialog");
const opening = input({ message: "How do I apply for a postal licence?" });
check("a clear first message starts there", decide(opening, { target: "epgl-dialog", confidence: 0.8 }).target === "epgl-dialog");
check("an unclear first message asks which service", decide(input({ message: "hello there friend" }), { target: "unclear", confidence: 0.9 }).target === null);
check("a router failure on the first message asks", decide(opening, "failed").target === null);
check("a short first message still asks the router (no one to answer)", needsRouter(input({ message: "hi" })));
check("a current id that is not a delegate is treated as none", decide(input({ message: "yes", current: "x" }), { target: "unclear", confidence: 1 }).target === null);

console.log("the router reads the delegates' own definitions");
const brief = delegateBrief(master.delegates![0]!, nxn, "en");
check("names the delegate and its live intents", brief.includes("nxn-dialog") && brief.includes("Renew a personal PO Box"), brief);
check("leaves out the generic human-help intent", !brief.includes("Talk to a person"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
