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

console.log("\nEverything that reads the DATA stays");
{
  const g = J("renewal").guidance;
  check("the figures come from the filed returns", /come from the Form 9 returns ALREADY FILED with EPGL/.test(g));
  check("...through the history tool", /epgl_form9_history/.test(g));
  check("a missing quarter is still asked for", /does not return for a quarter in the licence period/.test(g));
  check("the levy rules are untouched", /Quote levy figures only as read from the Form 9 record/.test(g));
  check("the quarter derivation is untouched", /license_period_start_quarter/.test(g));
  check("the financial fields still exist", new Set(J("renewal").steps.flatMap((s: any) => s.fields).map((f: any) => f.key)).has("leviable_income_q1"));
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
