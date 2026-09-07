/**
 * The details they already gave Emirates Post (2026-09-07).
 *
 * Signing in hands us the mobile and email on their account, and the journey
 * then asked for both again from someone who had just proved who they were.
 * They are SEEDED — shown for confirmation — and an answer already given in the
 * conversation always wins.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-known-contact-2026-09-07.ts
 */
import { contactSeed, tidyMobile, tidyEmail } from "@/lib/knownContact";
import type { CaseState } from "@dialog/config";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const caseWith = (data: Record<string, unknown>): CaseState => ({ data } as unknown as CaseState);

// ── the numbers, however they are written ───────────────────────────────────
check("a local mobile is kept", tidyMobile("0553708434") === "0553708434");
check("+971 becomes 0", tidyMobile("+971553708434") === "0553708434");
check("971 without the plus too", tidyMobile("971553708434") === "0553708434");
check("a bare 5xxxxxxxx gains its 0", tidyMobile("553708434") === "0553708434");
check("spaces and dashes are ignored", tidyMobile("055 370-8434") === "0553708434");
check("nothing in, nothing out", tidyMobile("") === undefined && tidyMobile(undefined) === undefined);
check("a non-number is not a number", tidyMobile("call me") === undefined, tidyMobile("call me"));

check("an address is kept", tidyEmail("emre.karayalcin@7x.ae") === "emre.karayalcin@7x.ae");
check("it is trimmed", tidyEmail("  a@b.ae  ") === "a@b.ae");
check("something that is not an address is dropped", tidyEmail("not-an-email") === undefined);
check("an empty one is dropped", tidyEmail("") === undefined);

// ── what gets seeded ────────────────────────────────────────────────────────
const known = { mobile: "+971553708434", email: "customer@example.ae" };
check(
  "an empty case takes both",
  JSON.stringify(contactSeed(caseWith({}), known)) ===
    JSON.stringify({ contact_phone: "0553708434", contact_email: "customer@example.ae" }),
  contactSeed(caseWith({}), known)
);
check(
  "an answer already given is NOT overwritten",
  contactSeed(caseWith({ contact_phone: "0501111111" }), known).contact_phone === undefined,
  contactSeed(caseWith({ contact_phone: "0501111111" }), known)
);
check(
  "...and the other field is still offered",
  contactSeed(caseWith({ contact_phone: "0501111111" }), known).contact_email === "customer@example.ae"
);
check(
  "a phone under a different name still counts as answered",
  contactSeed(caseWith({ mobile: "0501111111" }), known).contact_phone === undefined
);
check(
  "an email under a different name too",
  contactSeed(caseWith({ email: "already@given.ae" }), known).contact_email === undefined
);
check("an empty string is not an answer", contactSeed(caseWith({ contact_phone: "  " }), known).contact_phone === "0553708434");
check("nothing on file, nothing seeded", Object.keys(contactSeed(caseWith({}), {})).length === 0);
check(
  "a malformed number on file is not seeded",
  Object.keys(contactSeed(caseWith({}), { mobile: "n/a", email: "n/a" })).length === 0,
  contactSeed(caseWith({}), { mobile: "n/a", email: "n/a" })
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
