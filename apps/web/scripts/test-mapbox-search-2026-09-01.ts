/**
 * The map's address search, against the real index (2026-09-01).
 *
 * A customer searched "sobha hartland" and was told nothing was found. The
 * picker was on /geocoding/v5/mapbox.places, which has no entry for most of
 * Dubai's communities. Search Box does. This checks the queries that failed, and
 * that the two-step suggest/retrieve actually yields coordinates.
 *
 * Needs MAPBOX_TOKEN (or a file named by TOKFILE). Run from apps/web:
 *   MAPBOX_TOKEN=pk... npx tsx scripts/test-mapbox-search-2026-09-01.ts
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

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const token =
  process.env.MAPBOX_TOKEN ||
  (process.env.TOKFILE && existsSync(process.env.TOKFILE) ? readFileSync(process.env.TOKFILE, "utf8").trim() : "");
if (!token) { console.log("No MAPBOX_TOKEN — skipping."); process.exit(0); }

const session = "test-" + Math.floor(Date.now() / 1000);
const DUBAI = { lat: 25.2048, lng: 55.2708 };

async function suggest(q: string) {
  const r = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}` +
      `&access_token=${token}&session_token=${session}&country=ae&limit=5&proximity=${DUBAI.lng},${DUBAI.lat}&language=en`
  );
  const j = (await r.json()) as { suggestions?: { name?: string; mapbox_id?: string }[] };
  return j.suggestions ?? [];
}

// The community names customers actually type, and that the old index missed.
for (const q of ["sobha hartland", "dubai hills", "jumeirah village circle", "al barsha", "damac hills"]) {
  const hits = await suggest(q);
  check(`"${q}" returns suggestions`, hits.length > 0, hits.map((h) => h.name));
}

// Nonsense must still come back empty rather than confidently wrong.
check("nonsense returns nothing", (await suggest("zzzqqqwwwvvv")).length === 0);

// A suggestion is only a name until it is retrieved; the pin needs coordinates.
const first = (await suggest("sobha hartland"))[0];
check("the first hit is the place itself", /sobha hartland/i.test(first?.name ?? ""), first?.name);
if (first?.mapbox_id) {
  const r = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(first.mapbox_id)}?access_token=${token}&session_token=${session}`
  );
  const j = (await r.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
  const c = j.features?.[0]?.geometry?.coordinates;
  check("retrieve yields coordinates", Array.isArray(c) && c.length === 2, c);
  // Sobha Hartland is in Dubai; anything far outside means the wrong record.
  check("and they are in the UAE",
    Array.isArray(c) && c[0] > 51 && c[0] < 57 && c[1] > 22 && c[1] < 27, c);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
