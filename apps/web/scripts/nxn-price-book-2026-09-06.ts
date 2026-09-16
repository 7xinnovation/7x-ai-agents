/**
 * The price book, as the duration cards will read it.
 *
 * Every figure here was learned by reserving a box and reading the price back.
 * A term missing from this list carries no price on the cards — deliberately —
 * so this is the list to check when a duration says "confirmed when the box is
 * reserved" and someone expects a number.
 *
 * Run from apps/web:
 *   ENVFILE=<envfile> npx tsx scripts/nxn-price-book-2026-09-06.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.env.ENVFILE ?? "../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "../lib/integrations";
import { observedRents, observedServices, registrationFees } from "../lib/registrationFees";

const prefix = (n: string) => n.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

async function main() {
  const [row] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled);
  if (!intg) throw new Error("no enabled integration");
  const tool = `${prefix(intg.name)}__post_api_Rental_Select`;
  const [rents, svc, fees] = await Promise.all([
    observedRents(row.id, tool),
    observedServices(row.id, tool),
    registrationFees(row.id, tool),
  ]);

  const byBundle = new Map<string, { years: number; rent: number }[]>();
  for (const [k, rent] of rents) {
    const [bundle, years] = k.split("|");
    if (!bundle || !years) continue;
    byBundle.set(bundle, [...(byBundle.get(bundle) ?? []), { years: Number(years), rent }]);
  }
  for (const [bundle, terms] of [...byBundle].sort()) {
    const fee = fees.get(bundle) ?? null;
    console.log(`\n${bundle}  (registration ${fee ?? "—"})`);
    for (const t of terms.sort((a, b) => a.years - b.years)) {
      console.log(`  ${String(t.years).padStart(2)}y  rent ${String(t.rent).padStart(6)}  → card shows AED ${fee !== null ? (t.rent + fee).toFixed(2) : "?"}`);
    }
    const seen = [...svc].filter(([k]) => k.startsWith(`${bundle}|`));
    if (seen.length) console.log(`  services seen: ${seen.map(([k, v]) => `${k.split("|")[1]}y ${(v as string[]).join("/")}`).join("  ·  ")}`);
  }
  console.log(`\n${rents.size} priced term(s) across ${byBundle.size} bundle(s).`);

  /**
   * --check: a bundle that has lost its longer terms.
   *
   * The prices are learned, and on 16 September MyBox silently lost four of its
   * five: the observations had been pushed out of the query's row window by a
   * day of ordinary chat traffic, so the cards offered AED 370.00 for one year
   * and "confirmed when the box is reserved" for the rest. Nothing errored and
   * nothing in the logs said so — it looked exactly like a bundle nobody had
   * ever priced. Worth one line in CI rather than a customer noticing.
   */
  if (process.argv.includes("--check")) {
    const thin = [...byBundle].filter(([, terms]) => terms.length < 2).map(([b]) => b);
    if (thin.length) {
      console.log(`\nCHECK FAILED: ${thin.join(", ")} carr${thin.length === 1 ? "ies" : "y"} only one priced term — the longer durations will show no price.`);
      process.exitCode = 1;
    } else console.log("\ncheck ok: every bundle carries more than one priced term");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
