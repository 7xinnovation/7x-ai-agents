/**
 * Find out what the registration fee is for a bundle nobody has rented yet.
 *
 * The fee is stated in exactly one place — the `NEW-REG` line of a successful
 * `Rental/Select` — and the bundle cards read it back from the Selects this
 * deployment has already made. That works the moment a bundle has been rented
 * once and leaves the rest saying "shown in full before you pay", which is what
 * corporate looked like: every corporate reservation this week failed, so no
 * corporate bundle had a figure.
 *
 * So this makes the reservation deliberately, reads the NEW-REG line, and
 * records the response under its own action name — `registration_fee_observed`,
 * never `integration_write` — so nobody later mistakes it for a customer's
 * rental. It reserves a box for 30 minutes, creates no order, and takes no
 * payment.
 *
 * STAGING ONLY. Refuses to run against a production integration: a hold on a
 * live box is somebody's box.
 *
 * AND IT HOLDS BOXES FOR 30 MINUTES. Run it against a branch NOBODY IS TESTING.
 * On 4 Sep it was pointed at Al Barsha while that branch was under test, and the
 * tester's own reservation came back 108 BOX_NOT_FREE on a box this script was
 * holding. `--office` has no default for that reason.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-observe-registration-fees-2026-09-04.ts --env <file> --token <jwt> [--office 244] [--force]
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

import { getDb, agents, auditLog } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "../lib/integrations";
import { registrationFees, feesInSelectResponse } from "../lib/registrationFees";

/** The same prefix buildApiTools gives a tool, so the observations land in the same scope. */
const integrationPrefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const TOKEN = arg("--token");
// NO DEFAULT, deliberately. On 4 Sep this ran against Al Barsha (244) — the
// branch being tested at that moment — and put 30-minute holds on boxes the
// tester was then offered, so their reservation failed with 108 BOX_NOT_FREE on
// a box we were holding ourselves. Naming the branch has to be a decision.
const OFFICE = arg("--office");
if (!OFFICE) throw new Error("--office <officeId> is required. NEVER pick a branch anyone is testing on: this script HOLDS boxes for 30 minutes.");
const FORCE = process.argv.includes("--force");
const ONLY = arg("--bundle")?.split(",");
if (!TOKEN) throw new Error("--token <the customer's Emirates Post session jwt> is required");

/** Corporate rentals are refused 154 ERROR_GETTING_PRICING_DETAILS without this. */
const PHYSICAL_BOX_REQUIRED = true;

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  if (env !== "staging") throw new Error(`REFUSING: the agent is pointed at ${env}. This script reserves boxes.`);
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error("no enabled staging integration");
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);

  // The tool name the chat would have used, so the observations land in the same
  // scope the bundle cards read from.
  const selectTool = `${integrationPrefix(intg.name)}__post_api_Rental_Select`;
  const known = await registrationFees(row.id, selectTool);
  console.log(`\n${intg.name} · ${env}\nalready known: ${[...known].map(([b, f]) => `${b}=${f}`).join(", ") || "none"}\n`);

  const json = async (path: string) => (await (await fetch(base + path, { headers: h })).json())?.payload;

  const bundles: { id: string; name: string }[] = [];
  for (const request of ["P", "C"]) {
    const list = (await json(`/api/Rental/Bundle?request=${request}`)) as Record<string, unknown>[] | undefined;
    for (const b of list ?? []) bundles.push({ id: String(b.bundle_Id), name: String(b.name_En) });
  }
  console.log(`bundles: ${bundles.map((b) => `${b.id} (${b.name})`).join(", ")}\n`);

  for (const b of bundles) {
    if (ONLY && !ONLY.includes(b.id)) continue;
    if (known.has(b.id) && !FORCE) { console.log(`${b.id} ${b.name}: already AED ${known.get(b.id)} — skipped`); continue; }

    const dates = (await json(`/api/Rental/ExpiryDates?BundleId=${b.id}`)) as { dates?: string[] } | undefined;
    const expiry = dates?.dates?.[0];
    // MyHome pools its boxes by emirate; MyBox and corporate hold them per branch.
    const location = /^MYHOME/i.test(b.id) ? "DXB" : OFFICE;
    const free = (await json(`/api/Rental/FreeBoxes?BundleId=${b.id}&LocationId=${location}`)) as { uniqueBoxId: string }[] | undefined;
    if (!expiry || !free?.length) { console.log(`${b.id} ${b.name}: nothing to reserve (${free?.length ?? 0} free at ${location})`); continue; }

    let recorded = false;
    // 108 BOX_NOT_FREE is about one box, not the bundle, so a refusal is worth
    // one more try before giving up on the bundle.
    for (const box of free.slice(0, 5)) {
      const body = { bundleId: b.id, uniqueBoxID: box.uniqueBoxId, poBoxExpiryDate: expiry, physicalBoxRequired: PHYSICAL_BOX_REQUIRED };
      const r = await fetch(`${base}/api/Rental/Select`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const text = await r.text();
      const response = `HTTP ${r.status} ${r.statusText}\n${text}`;
      const fees = r.ok ? feesInSelectResponse(response) : new Map();
      if (!fees.size) continue;
      await db.insert(auditLog).values({
        agentId: row.id,
        actor: "system",
        action: "registration_fee_observed",
        payload: {
          tool: selectTool,
          method: "POST",
          path: "/api/Rental/Select",
          input: body,
          response: response.slice(0, 4000),
          // Extracted here, because a corporate response is longer than the room
          // above and the NEW-REG line is the last thing in it.
          fees: Object.fromEntries(fees),
          note: "Reservation made by scripts/nxn-observe-registration-fees-2026-09-04 to read the NEW-REG line. Not a customer rental.",
        },
      });
      const until = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(11, 16);
      console.log(`${b.id} ${b.name}: AED ${[...fees.values()][0]} — recorded. HOLDING box ${box.uniqueBoxId} until ~${until} UTC; nobody else can reserve it until then.`);
      recorded = true;
      break;
    }
    if (!recorded) console.log(`${b.id} ${b.name}: no reservation succeeded, so no figure — the card keeps its wording`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
