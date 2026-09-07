/**
 * How many boxes each branch really has free, and how many we would show.
 *
 * A customer reported that not all of a branch's available boxes appear. There
 * are two separate things that could mean: the backend returning fewer than it
 * has, or us showing fewer than we were given. This reads the first directly and
 * states the second beside it, so the answer is not a guess either way.
 *
 * READ-ONLY: BoxLocations and FreeBoxes are both GETs. Nothing is reserved.
 *
 * Run from apps/web:
 *   ENVFILE=<env> npx tsx scripts/nxn-free-boxes-audit-2026-09-07.ts <token> [emirate] [bundle]
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.env.ENVFILE ?? "../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "../lib/integrations";

const TOKEN = process.argv[2]!;
const EMIRATE = process.argv[3] ?? "DXB";
const BUNDLE = process.argv[4] ?? "IN";

async function main() {
  const [row] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env])!;
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
  const get = async (p: string) => {
    const r = await fetch(base + p, { headers: h });
    const t = await r.text();
    try {
      return { status: r.status, payload: JSON.parse(t)?.payload };
    } catch {
      return { status: r.status, payload: null, raw: t.slice(0, 200) };
    }
  };

  console.log(`${env} · ${base}\nbundle ${BUNDLE} · emirate ${EMIRATE}\n`);
  const locs = (await get(`/api/Rental/BoxLocations?BundleId=${BUNDLE}&EmirateCode=${EMIRATE}`)).payload as
    | { officeId: string; nameEn: string; mainOfficeId?: string }[]
    | null;
  if (!locs?.length) {
    console.log("NO BRANCHES returned for this bundle and emirate.");
    return;
  }
  console.log(`${locs.length} branch(es) returned\n`);
  let empty = 0;
  let total = 0;
  for (const l of locs) {
    const r = await get(`/api/Rental/FreeBoxes?BundleId=${BUNDLE}&LocationId=${l.officeId}`);
    const boxes = Array.isArray(r.payload) ? (r.payload as unknown[]) : [];
    total += boxes.length;
    if (!boxes.length) empty++;
    const hall = l.mainOfficeId && l.mainOfficeId !== l.officeId ? " [PO Box hall]" : "";
    console.log(
      `  ${String(l.officeId).padEnd(5)} ${String(l.nameEn).slice(0, 42).padEnd(44)} ` +
        `HTTP ${r.status}  ${String(boxes.length).padStart(4)} free${hall}` +
        (r.raw ? `  ${r.raw}` : "")
    );
  }
  console.log(
    `\n${total} free box(es) across ${locs.length} branch(es); ${empty} branch(es) returned none.\n` +
      "The chat shows the first 10 of whatever a branch returns, with a Refresh for the next 10 — so a branch\n" +
      "with more than 10 is not showing them all AT ONCE by design. A branch reporting 0 here has none to show."
  );
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
