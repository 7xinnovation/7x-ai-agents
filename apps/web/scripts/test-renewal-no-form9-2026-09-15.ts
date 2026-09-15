/**
 * The Form 9 is filed on EPGL's platform, not handed over in a chat.
 *
 * Emirates Post, 15 September. The upload goes; everything that reads Form 9
 * DATA stays, because the renewal's financial summary is built from the returns
 * already filed — epgl_form9_history — and always could have been for a company
 * EPGL already licenses. The upload was the fallback, and being mandatory it was
 * asked of everybody.
 *
 * Run from apps/web:  npx tsx scripts/test-renewal-no-form9-2026-09-15.ts --env <file>
 */
// A file whose only imports are dynamic is not a module, and top-level await
// then fails the type check — which is a build failure, not a test failure.
export {};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const envAt = process.argv.indexOf("--env");
if (envAt === -1) throw new Error("--env <file> is required");
const { databaseUrlFrom } = await import("./lib/envFile");
const { drizzle } = await import("drizzle-orm/node-postgres");
const pg = (await import("pg")).default;
const { agents } = await import("@dialog/db");
const { eq } = await import("drizzle-orm");
const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[envAt + 1]!) });
const db = drizzle(pool, { schema: { agents } });
const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
const def = row!.definition as any;
const J = (k: string) => def.journeys.find((x: any) => x.key === k);
const docs = (j: any) => j.steps.flatMap((s: any) => s.documents ?? []);

console.log("\nThe upload is gone");
{
  const renewal = J("renewal");
  check("no form_9 slot on the renewal", !docs(renewal).some((d: any) => d.key === "form_9"), docs(renewal).map((d: any) => d.key));
  check("...and the assistant is told not to ask", /THE FORM 9 IS NOT COLLECTED HERE/.test(renewal.guidance));
  check("...nor to list it among what to have ready", /do not list it among the documents they should have ready/.test(renewal.guidance));
}

/**
 * THE FIGURES WENT WITH IT, the same afternoon.
 *
 * This section used to assert the opposite — that removing the Form 9 PDF left
 * everything reading its DATA in place. Emre's follow-up closed that: "the
 * quarterly leviable details... i believe you referring this to form9 basically
 * which should be based on what i mentioned about removing the form 9 from the
 * flow." He is right. We had stopped asking for the document and gone on asking
 * for everything printed on it, one quarter at a time, in a conversation that
 * had just said the Form 9 is filed somewhere else.
 */
console.log("\nAnd so did the figures on it");
{
  const g = J("renewal").guidance;
  const keys = new Set(J("renewal").steps.flatMap((s: any) => s.fields).map((f: any) => f.key));
  for (const k of [
    "leviable_income_q1",
    "leviable_income_q2",
    "leviable_income_q3",
    "leviable_income_q4",
    "license_period_start_quarter",
    "financial_year",
  ])
    check(`no ${k} field`, !keys.has(k), k);
  check("the assistant is told to collect no revenue figures", /NO REVENUE FIGURES ARE COLLECTED ON A RENEWAL/.test(g));
  check("...and not to present quarters for confirmation", /do not present quarters for confirmation/.test(g));
  check("the quarter-walking instructions are gone", !/QUARTERS ARE CALENDAR QUARTERS/.test(g));
  check("...as is the instruction to read four figures off a Form 9", !/READ THE FIGURES, DO NOT DICTATE THEM/.test(g));
  check("the preparation list no longer promises them", !/the quarterly leviable-income figures come from IDEP/.test(g));
  // What the levy IS, and who works it out, is unchanged: EPGL assess it from
  // the returns they hold and state it in the payment request.
  check("the levy rules are untouched", /Quote levy figures only as read from the Form 9 record/.test(g));
  check("...and the flat licence fee with them", /AED 100,700/.test(g));
  check("the history tool is still there to answer a question", /epgl_form9_history/.test(g));
}

console.log("\nWhat it says when somebody asks");
{
  const g = J("renewal").guidance;
  check("Form 9 is completed outside the widget", /completed on the EPGL platform, outside this chat/.test(g));
  check("...and a renewal waits on it", /cannot be processed while returns are missing/.test(g));
  // The list of who is outstanding does not exist yet, so nobody may be told
  // they are — a guess about somebody's compliance is worse than "I cannot see".
  check("nobody is told their returns are outstanding on a guess", /unless epgl_form9_history actually shows a gap/.test(g));
  check("...and the reason is recorded", /we are not yet given that list/.test(g));
}

console.log("\nThe new licence never had one");
check("no form_9 on the new-licence journey either", !docs(J("new_license")).some((d: any) => d.key === "form_9"));

await pool.end();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
