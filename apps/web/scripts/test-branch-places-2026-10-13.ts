/**
 * FB-1797 — the map points at the right place because the branches do.
 *
 * Emirates Post's Rental/BoxLocations puts a third of Abu Dhabi's branches (and
 * most of Ajman's) in Dubai. lib/branchPlaces.ts keeps a branch's coordinates
 * only when they are in its emirate, places the rest by name with the geocoder
 * when the answer is a place called what the branch is called, and otherwise
 * returns the branch without coordinates. ChatMap lists those without a pin.
 *
 * Unit checks with a fake geocoder, plus static checks over the route and the
 * component. Run from apps/web:  npx tsx scripts/test-branch-places-2026-10-13.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inEmirate, placeQuery, sameName, geocodeInEmirate, placeBranches, clearPlaceCache, EMIRATE_BOX } from "../lib/branchPlaces";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : " — got: " + JSON.stringify(got)?.slice(0, 240)}`);
};

console.log("\nThe emirate boxes");
check("every emirate has a box, latitude then longitude, min before max", ["AUH", "DXB", "SHJ", "AJM", "UAQ", "RAK", "FUJ"].every((e) => { const b = EMIRATE_BOX[e]!; return b[0] < b[1] && b[2] < b[3] && b[0] > 22 && b[1] < 27 && b[2] > 51 && b[3] < 57; }));
check("Musaffah is in Abu Dhabi; Business Bay is not", inEmirate("AUH", 24.35, 54.5) && !inEmirate("AUH", 25.2, 55.27));
check("the exclaves are in: Hatta (Dubai), Masfout (Ajman), Kalba (Sharjah), Dibba (Fujairah)", inEmirate("DXB", 24.8, 56.12) && inEmirate("AJM", 24.82, 56.07) && inEmirate("SHJ", 25.07, 56.36) && inEmirate("FUJ", 25.59, 56.26));
check("Emirates Post's Dubai coordinates for Ajman Central and Al Manama are out", !inEmirate("AJM", 25.1022, 55.1411) && !inEmirate("AJM", 25.0156, 55.062));
check("nothing in an unknown emirate, nothing for NaN", !inEmirate("XXX", 25, 55) && !inEmirate("DXB", Number.NaN, 55.3) && !inEmirate("DXB", 25.2, undefined));

console.log("\nThe place in a branch name");
check("NXN prefix and Branch suffix go; Emirates Post's spelling becomes the geocoder's", placeQuery("NXN - Al Musafah Branch") === "Musaffah" && placeQuery("NXN - Al Wagn Branch") === "Al Wagan" && placeQuery("Al Wagn Post Office") === "Al Wagan", [placeQuery("NXN - Al Musafah Branch"), placeQuery("NXN - Al Wagn Branch")]);
check("abbreviations and the Tam Centre prefix", placeQuery("NXN - MBZ Branch") === "Mohammed Bin Zayed City" && placeQuery("Tam Centre - Dalma Post Office") === "Dalma Island" && placeQuery("NXN - Dalma Access") === "Dalma Island" && placeQuery("Madina Ghayathy Com") === "Ghayathi" && placeQuery("NXN - Masfoot Branch") === "Masfout" && placeQuery("NXN - Al Manama Branch") === "Manama");
check("Access, Complex and a double space", placeQuery("NXN - Al Sila  Access") === "Al Sila" && placeQuery("Al Maryah Island comples") === "Al Maryah Island" && placeQuery("Bus Station complex") === "Bus Station");

console.log("\nIs what the geocoder found the place we asked for?");
check("the same place, spelt by someone else, in a long name", sameName("Mohammed Bin Zayed City", "Mohamed Bin Zayed City") && sameName("Ajman Central", "Ajman Cental"));
check("articles do not count", sameName("Al Rahba", "Rahba") && sameName("Al Hayer", "Al Hayer") && sameName("Al Sila", "Al Sila"));
check("another place with a similar short name is not it", !sameName("Al Butain", "Butais") && !sameName("Al Aamrah", "Al Hamrah") && !sameName("Al Manama", "Al Manara Street"));
check("the geocoder's shrug — the capital — is not it", !sameName("Masdar City", "Abu Dhabi") && !sameName("Dalma", "Abu Dhabi") && !sameName("Al Manaei", "Ras al-Khaimah"));
// A street named after the place passes the NAME check — "Al Dhannah Street" is
// called Al Dhannah — and is turned away by the type filter instead (below).
check("a street named after the place matches by name alone", sameName("Al Dhannah", "Al Dhannah Street"));

console.log("\nThe geocoder, faked");
type Feature = { geometry: { coordinates: number[] }; properties: { name: string; feature_type: string } };
const fakeFetch = (features: Feature[], calls: string[] = []) => (async (url: string | URL | Request) => {
  calls.push(String(url));
  return { ok: true, json: async () => ({ features }) } as unknown as Response;
}) as unknown as typeof fetch;
{
  clearPlaceCache();
  const calls: string[] = [];
  const f = fakeFetch([{ geometry: { coordinates: [54.495, 24.367] }, properties: { name: "Musaffah", feature_type: "neighborhood" } }], calls);
  const got = await geocodeInEmirate("NXN - Al Musafah Branch", "AUH", "pk.test", f);
  check("a matching place inside the box is taken", got?.lat === 24.367 && got?.lng === 54.495, got);
  check("...asked for with the emirate, inside its box, in English", calls.length === 1 && /q=Musaffah%2C%20Abu%20Dhabi/.test(calls[0]!) && /bbox=51\.4%2C22\.5%2C56\.1%2C25|bbox=51\.4,22\.5,56\.1,25/.test(calls[0]!) && /country=ae/.test(calls[0]!) && /language=en/.test(calls[0]!), calls[0]);
  const again = await geocodeInEmirate("NXN - Al Musafah Branch", "AUH", "pk.test", f);
  check("...and remembered: the second ask does not reach the geocoder", again?.lat === 24.367 && calls.length === 1, calls.length);
}
{
  clearPlaceCache();
  const street = fakeFetch([{ geometry: { coordinates: [55.684, 24.141] }, properties: { name: "Al Dhannah Street", feature_type: "street" } }]);
  check("a street is not a branch", (await geocodeInEmirate("NXN - Al Dhannah Branch", "AUH", "pk.test", street)) === null);
  const capital = fakeFetch([{ geometry: { coordinates: [54.377, 24.454] }, properties: { name: "Abu Dhabi", feature_type: "place" } }]);
  check("the capital, offered for a name the geocoder does not know, is not a branch", (await geocodeInEmirate("NXN - Masdar City Branch", "AUH", "pk.test", capital)) === null);
  const outside = fakeFetch([{ geometry: { coordinates: [55.27, 25.2] }, properties: { name: "Bani Yas", feature_type: "neighborhood" } }]);
  check("a matching name outside the emirate is not taken", (await geocodeInEmirate("NXN - Bani Yas Branch", "AUH", "pk.test", outside)) === null);
  const second = fakeFetch([
    { geometry: { coordinates: [54.377, 24.454] }, properties: { name: "Abu Dhabi", feature_type: "place" } },
    { geometry: { coordinates: [55.339, 24.468] }, properties: { name: "Sweihan", feature_type: "place" } },
  ]);
  check("the first acceptable result wins, not the first result", (await geocodeInEmirate("NXN - Sweihan Branch", "AUH", "pk.test", second))?.lng === 55.339);
  const calls: string[] = [];
  const miss = fakeFetch([], calls);
  check("a miss is remembered too", (await geocodeInEmirate("NXN - Al Manaei Branch", "RAK", "pk.test", miss)) === null && (await geocodeInEmirate("NXN - Al Manaei Branch", "RAK", "pk.test", miss)) === null && calls.length === 1, calls.length);
  const down = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  check("the geocoder being down is a miss, not an error", (await geocodeInEmirate("NXN - Al Rahba Branch", "AUH", "pk.test", down)) === null);
  check("no token, no call", (await geocodeInEmirate("NXN - Al Rahba Branch", "AUH", "", miss)) === null && calls.length === 1);
}

console.log("\nPlacing a branch list");
{
  clearPlaceCache();
  const calls: string[] = [];
  const f = fakeFetch([{ geometry: { coordinates: [54.495, 24.367] }, properties: { name: "Musaffah", feature_type: "neighborhood" } }], calls);
  const placed = await placeBranches(
    [
      { id: "1", name: "Abu Dhabi Central Post Office", lat: 24.4805, lng: 54.3676, hours: "08:00-20:00" },
      { id: "2", name: "NXN - Al Musafah Branch", lat: 25.204, lng: 55.2522 },
      { id: "3", name: "NXN - Dalma Access", lat: 25.2488, lng: 55.313 },
      { id: "4", name: "No coordinates at all", lat: Number.NaN, lng: Number.NaN },
    ],
    "AUH",
    "pk.test",
    f
  );
  check("Emirates Post's coordinates are kept when they are in the emirate", placed[0]!.placed === "emirates_post" && placed[0]!.lat === 24.4805 && placed[0]!.hours === "08:00-20:00", placed[0]);
  check("a branch they put in Dubai is placed by name", placed[1]!.placed === "geocoded" && placed[1]!.lat === 24.367 && placed[1]!.lng === 54.495, placed[1]);
  check("one nobody can place keeps its name and has no coordinates", placed[2]!.placed === "unknown" && !("lat" in placed[2]!) && !("lng" in placed[2]!) && placed[2]!.name === "NXN - Dalma Access", placed[2]);
  check("...so does one that never had any", placed[3]!.placed === "unknown" && !("lat" in placed[3]!), placed[3]);
  check("the geocoder is asked only about the misplaced ones", calls.length === 3, calls.length);
  const none = await placeBranches([{ id: "2", name: "NXN - Al Musafah Branch", lat: 25.204, lng: 55.2522 }], "AUH", undefined, f);
  check("without a token a misplaced branch is simply unplaced", none[0]!.placed === "unknown" && calls.length === 3);
}

console.log("\nThe route and the map");
const route = src("../app/api/nxn/branches/route.ts");
check("the branch proxy places every branch before answering", /import \{ placeBranches \} from "@\/lib\/branchPlaces"/.test(route) && /const branches = await placeBranches\(raw, emirate, process\.env\.MAPBOX_TOKEN\)/.test(route));
check("...and no longer drops a branch for having no coordinates", /\.filter\(\(b\) => b\.name\);/.test(route) && !/Number\.isFinite\(b\.lat\)/.test(route));
const map = src("../app/embed/[agent]/ChatMap.tsx");
check("a branch's coordinates are optional in the map", /lat\?: number;\s*\n\s*lng\?: number;/.test(map) && /const hasPin = \(b: Branch\): b is Pinned/.test(map));
check("distance only for a pinned branch; the unplaced come last", /hasPin\(b\) \? \{ \.\.\.b, dist: haversineKm\(loc, b\) \} : b/.test(map) && /list = \[\.\.\.list\.filter\(hasPin\), \.\.\.list\.filter\(\(b\) => !hasPin\(b\)\)\]/.test(map));
check("the pins decide the frame and the markers", /const pins = branches\.filter\(hasPin\);/.test(map) && /const center = \{ lat: pins\[0\]!\.lat, lng: pins\[0\]!\.lng \};/.test(map) && /pins\.slice\(0, 15\)\.forEach/.test(map) && !/branches\.slice\(0, 15\)/.test(map));
check("no pins, no canvas — the list stands alone", /mapboxRef\.current && branches\.some\(hasPin\) \? <div ref=\{mapEl\}/.test(map));
check("a row without a distance shows none", /typeof b\.dist === "number" \? <span className="dlg-map-dist">/.test(map));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
