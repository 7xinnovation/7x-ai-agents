/**
 * What the GSB company lookups ACTUALLY return, field by field (2026-10-29).
 *
 * Emirates Post: "Enhance GSB integration retrieval for both website and agent
 * through EID and any other parameters required — check what other information
 * can be potentially displayed for the user when fetched."
 *
 * That question cannot be answered from the code. `lib/gsbLookup` maps a company
 * to seven fields — trade licence number, name EN/AR, emirate code, issue date,
 * expiry date, issuing entity code — and every one of those mappings was written
 * from a spec. Whatever else the endpoint sends arrives, is not read, and is
 * dropped on the floor. The only way to know what is being dropped is to look at
 * a raw response.
 *
 * So this prints the KEYS, not the mapped shape: every field present on every
 * row, how often it is populated, an example of its value, and a verdict on
 * whether lib/gsbLookup currently carries it through.
 *
 * IT NEEDS A TOKEN, because the MOE endpoints answer 401 to the API key alone.
 * Emirates Post issue one from /services/pobox/users/api/v1/Account/Token in
 * exchange for a UAE PASS code, and it lands in the host page's localStorage
 * under "accessToken" — so signing in on their site and copying that value is
 * the quickest way to hold one. Same route scripts/verify-gsb-chain.ts uses.
 *
 * PERSONAL DATA IS MASKED BY DEFAULT. These are somebody's company records and
 * the output of a probe tends to get pasted into a chat: Emirates IDs, emails,
 * phone numbers and passport numbers print as their shape, not their value.
 * `--full` turns that off for a local look.
 *
 * Run from apps/web:
 *   npx tsx scripts/probe-gsb-fields-2026-10-29.ts --env <file> --token <accessToken> [--eid <id>] [--licence <no> --authority <code>] [--full]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
config({ path: arg("--env") ? resolve(arg("--env")!) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations, type EnvKey, type EnvSpec } from "../lib/integrations";
import { decryptSecret, isEncrypted } from "../lib/crypto";

const TOKEN = arg("--token");
const EID = arg("--eid");
const LICENCE = arg("--licence");
const AUTHORITY = arg("--authority");
const FULL = process.argv.includes("--full");

/** Fields lib/gsbLookup's `toCompany` reads today. Everything else is dropped. */
const MAPPED_COMPANY = new Set([
  "tradeLicenseNo", "entityNameEn", "entityNameAr", "entityEmirateCode",
  "licenseIssueDate", "licenseExpiryDate", "issueEntityCode",
]);
/** And what `toOwner` reads on the by-licence-number response. */
const MAPPED_OWNER = new Set(["ownerNameEn", "ownerNameAr", "ownerEmiratesId", "emiratesId"]);

/** Anything that identifies a person prints as its shape. */
const SENSITIVE = /emirat(es)?id|eid|passport|email|mobile|phone|birth|dob|nationalid/i;
function show(key: string, v: unknown): string {
  if (v === null || v === undefined) return String(v);
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (FULL || !SENSITIVE.test(key)) return s.length > 90 ? `${s.slice(0, 90)}…` : s;
  return `<${s.replace(/\d/g, "9").replace(/[A-Za-z]/g, "a").slice(0, 24)}>`;
}

/** Every key on every row, with how often it carries a real value. */
function report(label: string, rows: Record<string, unknown>[], mapped: Set<string>) {
  console.log(`\n### ${label} — ${rows.length} row(s)`);
  if (!rows.length) { console.log("  (nothing returned)"); return; }
  const keys = new Map<string, { filled: number; example: unknown }>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r ?? {})) {
      const seen = keys.get(k) ?? { filled: 0, example: undefined };
      const real = v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "-";
      keys.set(k, { filled: seen.filled + (real ? 1 : 0), example: seen.example ?? (real ? v : undefined) });
    }
  }
  const width = Math.max(...[...keys.keys()].map((k) => k.length));
  for (const [k, info] of [...keys.entries()].sort()) {
    const flag = mapped.has(k) ? "used  " : "DROPPED";
    console.log(`  ${flag}  ${k.padEnd(width)}  ${String(info.filled).padStart(2)}/${rows.length}  ${show(k, info.example)}`);
  }
  const dropped = [...keys.keys()].filter((k) => !mapped.has(k));
  console.log(`  → ${keys.size} field(s) present, ${dropped.length} not carried through today`);
}

async function main() {
  if (!TOKEN) throw new Error("--token <accessToken> is required — see the header for where to get one");
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found on this database");
  const env = ((agent.definition as { activeEnvironment?: string }).activeEnvironment ?? "production") as EnvKey;

  const rows = await listIntegrations(agent.id);
  const spec = rows.find((r) => /nxn/i.test(r.name) && r.environments[env])?.environments[env] as EnvSpec | undefined;
  if (!spec) throw new Error(`NXN integration is not configured for ${env}`);
  const apiKey = (isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey) as string | undefined;
  const baseUrl = String(spec.baseUrl).replace(/\/$/, "");
  console.log(`nxn-dialog · environment ${env} · ${baseUrl}`);
  console.log(`masking: ${FULL ? "OFF (--full)" : "on — identifiers print as their shape"}`);

  const call = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${TOKEN}` };
    if (apiKey) headers["X-API-KEY"] = apiKey;
    const res = await fetch(url.toString(), { headers });
    const text = await res.text();
    if (!res.ok) { console.log(`\n### ${path} → HTTP ${res.status}\n  ${text.slice(0, 300)}`); return null; }
    let json: any = null;
    try { json = JSON.parse(text); } catch { console.log(`\n### ${path} → not JSON\n  ${text.slice(0, 200)}`); return null; }
    // The envelope itself is worth seeing: a statusCode or a message beside the
    // payload is information the mappers never look at either.
    const envelope = Object.fromEntries(Object.entries(json ?? {}).filter(([k]) => k !== "payload"));
    if (Object.keys(envelope).length) console.log(`\n  envelope for ${path}: ${JSON.stringify(envelope).slice(0, 300)}`);
    const payload = json?.payload;
    return (Array.isArray(payload) ? payload : payload ? [payload] : []) as Record<string, unknown>[];
  };

  if (EID) {
    const byEid = await call("/api/MOE/GetEntitiesById", { entityCode: EID });
    if (byEid) report(`GetEntitiesById (entityCode = the Emirates ID)`, byEid, MAPPED_COMPANY);
    const boxes = await call("/api/PoBox/GetPoBoxesByEmiratesId", { emiratesId: EID }).catch(() => null);
    if (boxes) report("GetPoBoxesByEmiratesId", boxes, new Set());
  }
  if (LICENCE && AUTHORITY) {
    const byNo = await call("/api/MOE/GetEntitiesByLicenseNo", { entityCode: AUTHORITY, licenseNo: LICENCE });
    if (byNo) {
      /**
       * THIS ONE IS AN ENVELOPE, not a row: `{ entityDetails, ownerDetails }`.
       * The first version of this probe compared its two keys against the
       * company field list and announced both as dropped, which was the probe
       * being wrong about the shape — lib/gsbLookup reads the nesting
       * correctly. Unwrapped here so the report describes the response rather
       * than the probe's assumption about it.
       */
      const details = byNo.map((r) => (r as any).entityDetails).filter(Boolean) as Record<string, unknown>[];
      const owners = byNo.flatMap((r) => {
        const o = (r as any).ownerDetails ?? (r as any).owners ?? [];
        return (Array.isArray(o) ? o : [o]).filter(Boolean) as Record<string, unknown>[];
      });
      if (!details.length && !owners.length) {
        console.log(
          `\n### GetEntitiesByLicenseNo — HTTP 200 with entityDetails: null, ownerDetails: null.\n` +
          `  Not an error and not an empty list — the call succeeded and found nothing. companyByLicence\n` +
          `  returns null for this, so the ownership check cannot run on this licence.`
        );
      }
      report("GetEntitiesByLicenseNo — entityDetails", details, MAPPED_COMPANY);
      report("GetEntitiesByLicenseNo — ownerDetails[]", owners, MAPPED_OWNER);
    }
  }
  if (!EID && !(LICENCE && AUTHORITY)) console.log("\nNothing probed: pass --eid, or --licence with --authority.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
