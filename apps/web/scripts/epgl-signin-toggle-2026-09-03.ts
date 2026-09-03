/**
 * Turn the EPGL sign-in gate on or off (2026-09-03).
 *
 * The renewal journey asks the customer to sign in before it will do anything,
 * which is right for production and in the way while the licensing team is
 * testing document uploads. Emre asked for it off for now.
 *
 * Journey.requiresAuth defaults to TRUE in the schema, so "off" is an explicit
 * false rather than an absent field -- leaving it undefined puts the gate back.
 *
 * BUT THE FLAG WAS NOT WHAT WAS ASKING. Checked against staging on 3 Sep: both
 * journeys already had requiresAuth false, and the widget still opened a renewal
 * with "I'll need you to sign in first". Nothing gated it -- the MODEL chose to,
 * because the renewal guidance opens with "If signed in, confirm the company and
 * license from their profile first" and the sensible reading of that is to ask.
 *
 * So this also writes an explicit instruction NOT to open with sign-in, and
 * removes it again on --on. A flag nobody is enforcing and a prompt everybody is
 * reading is exactly how a gate survives being switched off.
 *
 * Idempotent, and says what it changed. Run from apps/web:
 *   npx tsx scripts/epgl-signin-toggle-2026-09-03.ts --off [--env <file>] [--dry-run]
 *   npx tsx scripts/epgl-signin-toggle-2026-09-03.ts --on          <- before go-live
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const DRY = process.argv.includes("--dry-run");
const JOURNEYS = ["new_license", "renewal"];

interface Journey { key: string; requiresAuth?: boolean; guidance?: string; steps?: { key: string; requiresAuth?: boolean }[] }

const MARKER = "DO NOT OPEN WITH SIGN-IN";
const NO_UPFRONT_SIGNIN =
  `${MARKER} — start this journey from what the customer gives you. Do NOT ask them to sign in before you begin, ` +
  `do not call request_authentication as your first move, and do not tell them the journey needs their account: it ` +
  `does not. Everything here can be built from the documents they upload and the details they confirm. If they ARE ` +
  `already signed in, use their profile as the guidance below describes. If they are not, carry on without it and ` +
  `offer sign-in only at the point it actually helps them — before submission, so the application is linked to ` +
  `their account — and as an offer they can decline, never as a condition of continuing.`;

function want(): boolean {
  const on = process.argv.includes("--on");
  const off = process.argv.includes("--off");
  if (on === off) throw new Error("pass exactly one of --on or --off");
  return on;
}

async function main() {
  const required = want();
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    if (j.requiresAuth === required) {
      console.log(`  (already) ${j.key}: requiresAuth ${required}`);
    } else {
      console.log(`  + ${j.key}: requiresAuth ${String(j.requiresAuth ?? "(default true)")} -> ${required}`);
      j.requiresAuth = required;
      changed++;
    }
    // A step can gate on its own, and a journey opened up while a step still
    // demands sign-in stops in exactly the same place for exactly the same
    // reason -- with nothing in the journey to explain why.
    for (const step of j.steps ?? []) {
      if (!required && step.requiresAuth) {
        console.log(`      + ${j.key}/${step.key}: step requiresAuth true -> false`);
        step.requiresAuth = false;
        changed++;
      }
    }

    // The instruction, which is what was actually producing the sign-in prompt.
    const g = String(j.guidance ?? "");
    const has = g.includes(MARKER);
    if (!required && !has) {
      j.guidance = `${NO_UPFRONT_SIGNIN}\n\n${g}`.trim();
      changed++;
      console.log(`      + ${j.key}: guidance — do not open with sign-in`);
    } else if (required && has) {
      j.guidance = g
        .split("\n\n")
        .filter((para) => !para.includes(MARKER))
        .join("\n\n")
        .trim();
      changed++;
      console.log(`      - ${j.key}: guidance — sign-in instruction removed`);
    }
  }

  const missing = JOURNEYS.filter((k) => !def.journeys.some((j) => j.key === k));
  if (missing.length) throw new Error(`journeys not found on ${SLUG}: ${missing.join(", ")}`);
  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written. Sign-in is now ${required ? "REQUIRED" : "OFF"} for ${JOURNEYS.join(" and ")}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
