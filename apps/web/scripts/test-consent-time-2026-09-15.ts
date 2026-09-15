/**
 * The moment of consent, stamped by the server.
 *
 * Emirates Post, 15 September. There WERE timestamps — declaration_accepted_at
 * has been filling in on EPGL for weeks, and the guidance claims "the system
 * automatically records the acceptance DATE AND TIME". Nothing did: the model
 * wrote them, in its own format ("2026-09-13 17:39:27 UTC"), from whatever it
 * believed the time to be. NXN had none at all.
 *
 * Run from apps/web:  npx tsx scripts/test-consent-time-2026-09-15.ts
 *   (add --env <file> to check the agent definitions too)
 */
import { displayValue } from "../app/embed/[agent]/Experience";
import { contactSeed, tidyName } from "../lib/knownContact";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};
const src = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf('case "collect_field"'), src.indexOf('case "collect_field"') + 3600);

console.log("\nThe server stamps it, and the model cannot");
{
  check("an acceptance gets a companion timestamp", /\[`\$\{fieldKey\}_at`\]: new Date\(\)\.toISOString\(\)/.test(block));
  check("...only when it IS an acceptance", /CONSENT_FIELD\.test\(fieldKey\) && isAgreement\(input\.value\)/.test(block));
  check("withdrawing one clears the stamp", /const \{ \[`\$\{fieldKey\}_at`\]: _dropped, \.\.\.rest \}/.test(block));
  check("a timestamp the model offers is refused", /CONSENT_STAMP\.test\(fieldKey\)/.test(block) && /IGNORED\./.test(block));
  check("...and it is told why", /stamped by the server the moment the customer agrees/.test(block));

  const consent = /(_accepted|_consent|_acknowledged)$/;
  for (const k of ["terms_accepted", "save_card_consent", "auto_renew_consent", "declaration_accepted", "commitment_form_accepted", "idep_integration_accepted"])
    check(`${k} is treated as consent`, consent.test(k), k);
  for (const k of ["contact_name", "renewal_period", "po_box_number", "terms_accepted_at"])
    check(`${k} is not`, !consent.test(k), k);

  const agree = src.slice(src.indexOf("function isAgreement"), src.indexOf("export function saysNonResident"));
  check("a true boolean is an agreement", /typeof value === "boolean"/.test(agree));
  check("...and so is a string \"true\" or \"yes\"", /v === "true" \|\| v === "yes"/.test(agree));
  check("...and \"نعم\"", /نعم/.test(agree));
}

console.log("\nThe panel shows the time, not just the day");
{
  check("a consent timestamp keeps its time", displayValue("2026-09-15T08:41:03.000Z") === "15-09-2026 08:41 UTC", displayValue("2026-09-15T08:41:03.000Z"));
  check("a space-separated one too", displayValue("2026-09-15 08:41:03") === "15-09-2026 08:41 UTC", displayValue("2026-09-15 08:41:03"));
  // An expiry date is a date; it must not grow a time it never had.
  check("a plain date is still a plain date", displayValue("2027-12-31") === "31-12-2027", displayValue("2027-12-31"));
  check("a non-date is untouched", displayValue("MYHOMEF") === "MYHOMEF");
  check("nothing is still nothing", displayValue(undefined) === "");
}

console.log("\nA signed-in applicant is not asked who they are");
{
  check("the name is seeded", contactSeed({ data: {} } as never, { name: "Emre Karayalcin" }).contact_name === "Emre Karayalcin");
  check("...alongside the email and mobile", Object.keys(contactSeed({ data: {} } as never, { name: "Emre Karayalcin", email: "a@b.ae", mobile: "0553708434" })).sort().join(",") === "contact_email,contact_name,contact_phone");
  check("an answer already given always wins", contactSeed({ data: { contact_name: "Someone Else" } } as never, { name: "Emre Karayalcin" }).contact_name === undefined);
  // Placeholders UAE PASS returns for an incomplete profile, and initials, which
  // are not a name to read back to somebody as theirs.
  check("a placeholder is not a name", ["-", "  ", "N/A", ".", "A B"].every((v) => tidyName(v) === undefined));
  check("...but a real one survives its whitespace", tidyName("  Emre   Karayalcin ") === "Emre Karayalcin");
  check("an Arabic name is a name", tidyName("فيصل عيسى") === "فيصل عيسى");

  const cb = readFileSync(new URL("../app/api/uaepass/callback/route.ts", import.meta.url), "utf8");
  check("the sign-in passes the name on", /contactSeed\(st, \{ mobile: id\.mobile, email: id\.email, name: id\.name \}\)/.test(cb));
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("EPGL is told not to ask for either", /Do NOT ask for either/.test(route));
  check("...and to confirm rather than announce", /is that right for this application/.test(route));
  check("it reads them from the case, not the callback turn", /str\(session\.state\.data\.contact_name\)/.test(route));
}

console.log("\nEvery message carries the moment it was said");
{
  const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("the bubble renders a time", /<time className="dlg-msg-time"/.test(exp));
  check("...in the customer's own locale", /toLocaleTimeString\(locale === "ar" \? "ar-AE" : "en-GB"/.test(exp));
  check("...to the minute, not the second", /hour: "2-digit", minute: "2-digit"/.test(exp));
  check("a live message is stamped when it is sent", /at: said/.test(exp));
  const conv = readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8");
  check("a resumed transcript keeps its times", /createdAt: messages\.createdAt/.test(conv));
  const api = readFileSync(new URL("../app/api/conversations/[id]/route.ts", import.meta.url), "utf8");
  check("...and the endpoint returns them", /at: m\.createdAt\?\.toISOString/.test(api));
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  check("the time does not compete with the message", /\.dlg-msg-time \{[\s\S]{0,200}opacity: 0\.45/.test(css));
}

const envAt = process.argv.indexOf("--env");
if (envAt !== -1) {
  const { databaseUrlFrom } = await import("./lib/envFile");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = (await import("pg")).default;
  const { agents } = await import("@dialog/db");
  const { eq } = await import("drizzle-orm");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[envAt + 1]!) });
  const db = drizzle(pool, { schema: { agents } });

  console.log("\nThe agent definitions");
  for (const slug of ["nxn-dialog", "epgl-dialog"]) {
    const [row] = await db.select().from(agents).where(eq(agents.slug, slug));
    const def = row!.definition as any;
    for (const j of def.journeys) {
      const keys = new Set(j.steps.flatMap((s: any) => s.fields).map((f: any) => f.key));
      const consents = [...keys].filter((k) => /(_accepted|_consent|_acknowledged)$/.test(k as string));
      const orphans = consents.filter((k) => !keys.has(`${k}_at`));
      check(`${slug}/${j.key}: every acceptance has a timestamp field`, orphans.length === 0, orphans);
      check(`${slug}/${j.key}: the rule is in the guidance`, /THE TIME OF AN ACCEPTANCE IS NOT YOURS TO WRITE/.test(j.guidance));
    }
  }
  const [epgl] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  const ren = (epgl!.definition as any).journeys.find((j: any) => j.key === "renewal");
  const rk = new Set(ren.steps.flatMap((s: any) => s.fields).map((f: any) => f.key));
  check("the renewal has an applicant, not just an accountant", rk.has("contact_name") && rk.has("contact_email"), [...rk].filter((k) => /contact|accountant/.test(k as string)));
  check("...and they are kept apart in the guidance", /are the applicant, accountant_name/.test(ren.guidance));
  await pool.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
