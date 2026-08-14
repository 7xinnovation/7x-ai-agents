/**
 * Run the whole GSB chain end to end and say exactly where it stops.
 *
 * The company lookups have never seen a live 200. Every field mapping in
 * lib/gsbLookup is written from the spec, and specs drift — so "it is wired" and
 * "it works" are different claims, and only this can settle the second one.
 *
 * The chain, in the order the journey uses it:
 *
 *   1  issuing authorities           guest tier, works today
 *   2  companies under an authority  needs the Emirates Post session
 *   3  company by trade licence      needs the session; returns the owners
 *   4  ownership check               compares an Emirates ID to those owners
 *
 * Steps 2-4 need a token. Emirates Post issues it from
 * /services/pobox/users/api/v1/Account/Token in exchange for a UAE PASS code, and
 * it lands in the host page's localStorage under "accessToken" — so the quickest
 * way to get one for a test is to sign in on their site and copy that value.
 *
 * Run from apps/web:
 *   npx tsx scripts/verify-gsb-chain.ts [--env <file>] [--token <accessToken>]
 *                                       [--licence <no>] [--eid <emirates-id>]
 *
 * Exit code is 0 only when every step it could attempt actually succeeded.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
config({
  path: arg("--env") ? resolve(arg("--env")!) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import type { EnvKey } from "../lib/integrations";
import { companiesByAuthority, companyByLicence, listIssuingEntities, ownerMatch } from "../lib/gsbLookup";
import { epUsersBaseUrl, introspectEmiratesPostToken } from "../lib/hostToken";

const token = arg("--token");
const licence = arg("--licence");
const eid = arg("--eid");

let failures = 0;
const ok = (s: string) => console.log(`  ok      ${s}`);
const bad = (s: string) => { failures++; console.log(`  FAILED  ${s}`); };
const skip = (s: string) => console.log(`  skipped ${s}`);

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const env = ((agent.definition as { activeEnvironment?: string }).activeEnvironment ?? "production") as EnvKey;
  console.log(`nxn-dialog, active environment: ${env}\n`);

  // 0. The token itself, before anything is blamed on the endpoints.
  if (token) {
    const base = await epUsersBaseUrl(agent.id, env);
    if (!base) bad("0. no users service resolved for this environment");
    else {
      const v = await introspectEmiratesPostToken(token, base);
      if (v.ok) {
        ok(`0. token valid — subject ${v.identity.sub.slice(0, 12)}…${v.identity.emiratesId ? `, Emirates ID on file` : ""}`);
        if (v.identity.emiratesId && !eid) console.log(`          (its Emirates ID can be used for step 4 — pass --eid ${v.identity.emiratesId})`);
      } else {
        bad(`0. token rejected: ${v.reason}`);
        console.log("          later steps will fail for this reason, not because of the lookups");
      }
    }
  } else {
    skip("0. token check — no --token given");
  }

  // 1. Authorities. Guest tier, so this is the one step that works unauthenticated.
  let authorityCode = "";
  try {
    const list = await listIssuingEntities(agent.id, env, token);
    if (!list.length) bad("1. issuing authorities returned an empty list");
    else {
      ok(`1. issuing authorities — ${list.length} returned (e.g. ${list[0]!.code} ${list[0]!.nameEn})`);
      authorityCode = list[0]!.code;
    }
  } catch (e) {
    bad(`1. issuing authorities — ${(e as Error).message}`);
  }

  // 2. Companies under one authority.
  if (!token) skip("2. companies by authority — needs --token");
  else if (!authorityCode) skip("2. companies by authority — no authority code from step 1");
  else {
    try {
      const rows = await companiesByAuthority(agent.id, env, authorityCode, token);
      // An empty list is a legitimate answer for an authority with no companies,
      // so it is reported rather than failed.
      ok(`2. companies under authority ${authorityCode} — ${rows.length} returned${rows[0]?.nameEn ? ` (e.g. ${rows[0].nameEn})` : ""}`);
    } catch (e) {
      bad(`2. companies by authority — ${(e as Error).message}`);
    }
  }

  // 3 + 4. One company by licence, then the ownership check.
  if (!token || !licence) skip("3. company by licence — needs --token and --licence");
  else {
    try {
      const found = await companyByLicence(agent.id, env, authorityCode, licence, token);
      if (!found) bad(`3. company by licence ${licence} — no match under authority ${authorityCode}`);
      else {
        ok(`3. company by licence — ${found.company.nameEn ?? "(no name)"}, ${found.owners.length} owner(s)`);
        const readable = found.owners.filter((o) => o.emiratesId).length;
        console.log(`          ${readable} of ${found.owners.length} owners carry a readable Emirates ID`);
        if (!eid) skip("4. ownership check — needs --eid");
        else {
          const verdict = ownerMatch(found.owners, eid);
          // Every verdict is a legitimate outcome; only a crash is a failure.
          ok(`4. ownership check — ${verdict}`);
          if (verdict === "unknown") console.log("          unknown means fall back to document review, NOT that they are not the owner");
        }
      }
    } catch (e) {
      bad(`3. company by licence — ${(e as Error).message}`);
    }
  }

  console.log(
    failures
      ? `\n${failures} step(s) failed.`
      : token
        ? "\nEvery step attempted succeeded."
        : "\nThe unauthenticated part of the chain is healthy. Re-run with --token to prove the rest."
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
