/**
 * A pinned location, turned into an Emirates Post address (2026-09-01).
 *
 * Needs a customer session — the shipping endpoints answer 401 without one — so
 * it skips unless TOKFILE names a file holding a live Emirates Post token:
 *
 *   TOKFILE=/tmp/tok npx tsx scripts/test-ep-geocode-2026-09-01.ts
 *
 * The expectations come from running it against staging on 1 Sep 2026. They are
 * about SHAPE and RANKING, not exact strings, so a change to their data does not
 * fail the test — but a change to the double-encoded body, the two spellings, or
 * the out-of-service flag does.
 */
import { config } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { addressFromPin } from "@/lib/epGeocode";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const tokFile = process.env.TOKFILE;
if (!tokFile || !existsSync(tokFile)) {
  console.log("No TOKFILE — skipping. These endpoints need a live customer session.");
  process.exit(0);
}
const token = readFileSync(tokFile, "utf8").trim();
const [row] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
const at = (lat: number, lng: number) => addressFromPin(row!.id, "staging", lat, lng, token, "en");

// A street address: everything resolves, including the area code.
const barsha = await at(25.1107, 55.1993);
check("a street address resolves end to end", barsha?.emirateCode === "DXB" && !!barsha?.region, barsha);
check("the area code comes back", /^DXB-\d+$/.test(barsha?.region?.code ?? ""), barsha?.region);
check("the street is captured", !!barsha?.street, barsha?.street);
check("the building number is the first part only", barsha?.building === "5", barsha?.building);
check("the emirate is not left as \"Dubai Emirate\"", barsha?.emirate === "Dubai", barsha?.emirate);

// The two services spell the same place differently — "Nadd Al Shiba 1" from the
// geocoder, "Nad Al Sheeba 1" in the masters list. The right one must rank first.
const nad = await at(25.1608, 55.3095);
check("a differently-spelled area still finds its match",
  nad?.candidates?.[0]?.nameEn === "Nad Al Sheeba 1", nad?.candidates?.map((c) => c.nameEn));
check("a fuzzy match is offered, never assumed", nad?.region === undefined, nad?.region);

// The territory name is the precise one; the geocoder's "Sharjah" is not.
const majaz = await at(25.33, 55.385);
check("the territory beats the generic area name",
  /majaz/i.test(majaz?.candidates?.[0]?.nameEn ?? ""), majaz?.candidates?.map((c) => c.nameEn));

// Open desert: reachable but not on a normal round, and NOT silently resolved to
// the one place that happens to sound similar (Al Dhafra Municipality vs Al Dafra
// Airbase — a sole fuzzy candidate must never become the customer's address).
const desert = await at(23.4, 53.5);
check("a remote point is flagged", desert?.remote === true, desert);
check("a lone fuzzy candidate is not promoted", desert?.region === undefined, desert?.region);

// Off the map entirely.
const sea = await at(25.5, 54.0);
check("a point they do not serve says so", sea?.outOfService === true, sea);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
