/**
 * EPGL 2.0 test round, BUG-185 to BUG-201 (10 November 2026).
 * Run from apps/web: npx tsx scripts/test-epgl20-bugs-185-201-2026-11-10.ts
 */
import { readFileSync } from "node:fs";
import { emptyCase, type CaseState } from "@dialog/config";
import {
  cepHolderAnswer, cepNumberFrom, cepHolderStep, requiresCepLicence, asksForFreshApplication, hasApplicationInProgress, freshApplication,
  openingDirective, productRulesDirective, SERVICE_QUESTION, HOLDS_CEP_KEY, CEP_NUMBER_KEY, TEMPERATURE_CATEGORIES,
} from "../lib/epgl20Journey";
import { productFirstDirective } from "../lib/batchUpload";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got).slice(0, 400)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const md = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");

console.log("BUG-185: a lookup that finds nothing is said humanly");
const open = openingDirective(true, "en");
check("never 'registry unreachable'", /never say a registry, a system or a service is unreachable/.test(open));
check("says no trade licence linked to their account, upload instead", /could not find a trade licence linked to their account/.test(open));

console.log("BUG-186: the question, and the headings");
check("the question is 'Which service are you applying for?'", open.includes(`"${SERVICE_QUESTION.en}"`) && productFirstDirective().includes("Which service are you applying for?"));
check("...and in Arabic", openingDirective(true, "ar").includes(SERVICE_QUESTION.ar));
check("the licence-first directive names Licences and Permits", /Licences and Permits/.test(productFirstDirective()));

console.log("BUG-190: the sign-in answer, word for word");
const out = openingDirective(false, "en");
check("not signed in: a fixed reply with two buttons", /word for word/.test(out) && /```buttons\n- Sign in\n- Ask a question instead\n```/.test(out));
check("signed in: no sign-in text", !/word for word/.test(open));
check("Arabic fixed reply", /تسجيل الدخول/.test(openingDirective(false, "ar")));
check("the route adds it on every turn before a product", /directive \+= openingDirective\(!!session\.authenticated, loc\)/.test(route));

console.log("BUG-191: a new application starts one");
for (const m of ["I want a new application", "I want to start a new application", "start over", "Let's start again", "new application", "I'd like to create a fresh application", "أريد تقديم طلب جديد"])
  check(`"${m}" asks for a fresh one`, asksForFreshApplication(m));
for (const m of ["Apply for a new licence", "Apply for Postal Activity License", "Is this a new application?", "Yes", "What documents does a new application need for food delivery and medicine and is the inspection done before or after?"])
  check(`"${m}" does not`, !asksForFreshApplication(m));
const st: CaseState = {
  ...emptyCase(), journeyKey: "new_license", reference: "a11X", status: "submitted",
  data: { product_code: "FOODMED", company_name: "YI FANG TAIWAN FRUIT TEA L.L.C", contact_email: "x@y.ae", contact_name: "Omamah", __authenticated_at: "t" } as CaseState["data"],
  documents: [{ key: "trade_license", status: "uploaded" } as CaseState["documents"][number]],
};
check("a case with a product is in progress", hasApplicationInProgress(st));
check("an empty signed-in case is not", !hasApplicationInProgress({ ...emptyCase(), data: { contact_email: "x@y.ae", __authenticated_at: "t" } as CaseState["data"] }));
const f = freshApplication(st);
const fd = f.data as Record<string, unknown>;
check("fresh: product, company, documents and reference cleared", !fd.product_code && !fd.company_name && f.documents.length === 0 && !f.reference && f.status === "draft");
check("fresh: the signed-in person and contact kept", fd.contact_email === "x@y.ae" && fd.contact_name === "Omamah" && fd.__authenticated_at === "t");
check("fresh: still the new-licence journey", f.journeyKey === "new_license");
check("the route resets before the tap is read, and audits it", /asksForFreshApplication\(body\.userMessage\) && hasApplicationInProgress\(session\.state\)/.test(route) && /epgl_fresh_application/.test(route));

console.log("BUG-197 / 200: CEP licence holder, then the number");
check("LOCKERS and OUTSOURCE need it, others not", requiresCepLicence("LOCKERS") && requiresCepLicence("OUTSOURCE") && !requiresCepLicence("FOODMED") && !requiresCepLicence("CEP30-GEN-DOM"));
check("answers", cepHolderAnswer("Yes, I hold a CEP licence") === true && cepHolderAnswer("No, not yet") === false && cepHolderAnswer("نعم، لدي ترخيص بريد سريع") === true && cepHolderAnswer("Electronic Lockers Service and PUDO") === null);
check("numbers", cepNumberFrom("It's PL-2024-00123") === "PL-2024-00123" && cepNumberFrom("12345") === "12345" && cepNumberFrom("no idea") === null && cepNumberFrom("yes") === null);
const tap = cepHolderStep("LOCKERS", {}, "Electronic Lockers Service and PUDO", "en")!;
check("on the tap: ask the holder question first, nothing else", tap.blocking && /already hold a CEP/.test(tap.directive) && /Yes, I hold a CEP licence/.test(tap.directive));
const yes = cepHolderStep("LOCKERS", {}, "Yes, I hold a CEP licence", "en")!;
check("yes: recorded, then the number is asked", yes.set[HOLDS_CEP_KEY] === true && yes.blocking && /CEP licence number/.test(yes.directive));
const num = cepHolderStep("LOCKERS", { [HOLDS_CEP_KEY]: true }, "PL-2024-00123", "en")!;
check("the number: recorded, the step is done", num.set[CEP_NUMBER_KEY] === "PL-2024-00123" && !num.blocking && num.directive === "");
const noL = cepHolderStep("LOCKERS", {}, "No, not yet", "en")!;
check("LOCKERS without one: may go on, with a CEP application", noL.set[HOLDS_CEP_KEY] === false && !noL.blocking && /together with a new CEP/.test(noL.directive));
const noO = cepHolderStep("OUTSOURCE", {}, "No, not yet", "en")!;
check("OUTSOURCE without one: cannot go ahead", noO.blocking && /cannot go ahead/.test(noO.directive));
check("a CEP licence has no holder step", cepHolderStep("CEP30-GEN-DOM", {}, "x", "en") === null);
check("the route runs it before the upload choice", route.indexOf("cepHolderStep(code, data, body.userMessage, loc)") < route.indexOf("const mode = uploadModeFrom(body.userMessage)"));
check("...and the upload choice waits while it blocks", /!cepHolderStep\(String\(data\.product_code\), data, undefined, loc\)\?\.blocking/.test(route));
const lockRules = productRulesDirective("LOCKERS", [], { [CEP_NUMBER_KEY]: "PL-1" });
check("LOCKERS: the number goes as Principal_Licence_Number", /PL-1: send it as Principal_Licence_Number/.test(lockRules));

console.log("BUG-187 / 195 / 196: no scope question for a permit, no back-and-forth");
check("non-CEP: never ask scope", /has no domestic \/ international scope/.test(lockRules) && /has no domestic/.test(productRulesDirective("FOODMED", [], {})));
check("CEP: no such line", !/has no domestic/.test(productRulesDirective("CEP30-GEN-DOM", [], {})));
check("no narration, no self-correction", /Never narrate what you are doing behind the scenes/.test(lockRules) && /withdraw it in the same message/.test(lockRules));

console.log("BUG-192: temperature categories, as checkboxes, and the dropdown in view");
const food = productRulesDirective("FOODMED", [], {});
check("multi-choice is a toggles checkbox block, never buttons", /NEVER a ```buttons block/.test(food) && /style: checkbox/.test(food));
check("all eight categories offered", TEMPERATURE_CATEGORIES.length === 8 && TEMPERATURE_CATEGORIES.every((c) => food.includes(c)));
check("the dropdown brings its list into view when opened", /panel\.scrollIntoView\(\{ block: "nearest"/.test(md) && /ref=\{panelRef\}/.test(md));

console.log("BUG-194 / 199: required documents and sites before the summary");
const miss = productRulesDirective("FOODMED", ["Storage Premises Declaration"], {});
check("missing documents named, and the summary held back", /DOCUMENTS STILL MISSING: Storage Premises Declaration/.test(miss) && /Do NOT show the summary/.test(miss));
check("FOODMED: storage premises site, type exactly 'Storage premises'", /Site_Type__c exactly "Storage premises"/.test(food) && /never Retail, Pharmacy/.test(food));
check("LOCKERS: each site's type, address, emirate, lockers, authentication, permission, and the document", /"Locker site" or "PUDO point"/.test(lockRules) && /number of lockers/.test(lockRules) && /authenticate/.test(lockRules) && /Site Locations and Contracts document/.test(lockRules));
check("the route adds the product rules on every turn with the live missing list", /productRulesDirective\(code, missingDocuments\(agent\.definition, session\.state, loc\)\.map/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
