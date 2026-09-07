/**
 * Every PO Box Emirates Post returns for a signed-in customer, with nothing
 * hidden — the raw statuses and dates, exactly as their account service states
 * them.
 *
 * A customer with an EXPIRED box reported that it does not appear when they sign
 * in. There are two candidates and they need separating: Emirates Post not
 * returning the box, or us not showing it. This asks the account service
 * directly and prints what it says, so the answer is evidence rather than
 * inference.
 *
 * READ-ONLY. Two GETs: the account, then its boxes.
 *
 * Run from apps/web:
 *   ENVFILE=<env> npx tsx scripts/nxn-account-boxes-2026-09-07.ts <token> [emiratesId]
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.env.ENVFILE ?? "../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "../lib/integrations";
import { mapCustomerPoBoxes, poBoxesForSession, customerPoBoxes } from "../lib/gsbLookup";

const TOKEN = process.argv[2]!;

async function main() {
  const [row] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  const def = row!.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  const spec = (await listIntegrations(row!.id)).find((i) => i.enabled && i.environments[env])!.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);

  let eid = process.argv[3];
  if (!eid) {
    const acc = await (await fetch(`${base}/users/api/v1/Account`, { headers: h })).json();
    eid = String(acc?.payload?.emiratesId ?? "");
    console.log(`account: ${acc?.payload?.firstNameEN ?? ""} ${acc?.payload?.lastNameEN ?? ""} · Emirates ID ${eid || "(none on the record)"}\n`);
  }
  if (!eid) { console.log("No Emirates ID on the account — the box lookup is keyed on it."); return; }

  const r = await fetch(`${base}/users/api/v1/PoBoxes/getpoboxesbymobile?EmiratesId=${eid}`, { headers: h });
  const body = await r.json().catch(() => null);
  const rows = Array.isArray(body?.payload) ? (body.payload as Record<string, unknown>[]) : [];
  console.log(`HTTP ${r.status} · ${rows.length} box(es) returned by Emirates Post\n`);

  const mapped = mapCustomerPoBoxes(rows);
  const now = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const m = mapped[i]!;
    const exp = String(m.expiryDate ?? "").slice(0, 10);
    const lapsed = m.expired ? "  <-- EXPIRED" : "";
    console.log(
      `  ${String(m.boxNumber ?? "?").padEnd(8)} ${String(m.emirateName ?? m.emirateCode ?? "").padEnd(12)}` +
        ` raw status ${String(raw.status ?? raw.boxStatus ?? "?").padEnd(4)} -> ${String(m.status ?? "?").padEnd(22)}` +
        ` expires ${exp || "(none)"}${lapsed}`
    );
  }
  const expired = mapped.filter((b) => b.expired);
  console.log(
    `\n${expired.length} of ${mapped.length} are past their expiry date.\n` +
      "Every row above is passed to the assistant; nothing here filters by status."
  );

  // The Emirates ID lookup is not the whole account. GET /api/v1/PoBoxes answers
  // for whoever the token belongs to, and has been seen to carry boxes the
  // Emirates ID lookup omits entirely.
  const [session, both] = await Promise.all([
    poBoxesForSession(row!.id, env, TOKEN),
    customerPoBoxes(row!.id, env, eid, TOKEN),
  ]);
  console.log(
    `\nby Emirates ID: ${mapped.length} · by session: ${session === null ? "unavailable" : session.length} · MERGED (what the customer now sees): ${both.length}`
  );
  const onlySession = (session ?? []).filter((b) => !mapped.some((m) => String(m.boxNumber) === String(b.boxNumber)));
  if (onlySession.length) {
    console.log(`\n${onlySession.length} box(es) the Emirates ID lookup MISSES, and the customer would not have seen:`);
    for (const b of onlySession) {
      console.log(`  ${String(b.boxNumber).padEnd(8)} ${String(b.emirateName ?? "").padEnd(12)} ${String(b.status ?? "").padEnd(20)} expires ${String(b.expiryDate ?? "").slice(0, 10)}${b.expired ? "  <-- EXPIRED" : ""}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
