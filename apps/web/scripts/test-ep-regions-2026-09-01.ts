/**
 * Typed addresses, as customers actually type them (2026-09-01).
 *
 * From a real conversation: an Ajman box, "al bursha" typed for Al Barsha, then
 * "dubai creek". Both were answered with "not a delivery area in Ajman" and a
 * request for the district — which is the question the customer had just tried
 * to answer. One is a spelling slip, the other is the wrong emirate, and neither
 * is "we don't know that place".
 *
 * Run from apps/web:  npx tsx scripts/test-ep-regions-2026-09-01.ts
 */
import { regionsFor, searchRegions, exactRegion, searchOtherEmirates } from "@/lib/epRegions";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const names = (rs: { nameEn: string }[]) => rs.map((r) => r.nameEn).join(" | ");

const dxb = await regionsFor("staging", "DXB");
const ajm = await regionsFor("staging", "AJM");
check(`Dubai (${dxb.length}) and Ajman (${ajm.length}) load`, dxb.length > 300 && ajm.length > 20);

// Spelling, as typed.
check("'al bursha' reaches Al Barsha", searchRegions(dxb, "al bursha").some((r) => r.nameEn.startsWith("Al Barsha")), names(searchRegions(dxb, "al bursha", 4)));
check("'mirdiff' reaches Mirdif", searchRegions(dxb, "mirdiff").some((r) => /mirdif/i.test(r.nameEn)), names(searchRegions(dxb, "mirdiff", 4)));
check("'jumeira' reaches Jumeirah", searchRegions(dxb, "jumeira").some((r) => /jumeirah/i.test(r.nameEn)), names(searchRegions(dxb, "jumeira", 4)));
check("exact spelling still wins outright", searchRegions(dxb, "Dubai Marina")[0]?.nameEn === "Dubai Marina");

// Slack must not turn every short word into a match.
check("a nonsense word matches nothing", searchRegions(dxb, "zzzqqqwww").length === 0, names(searchRegions(dxb, "zzzqqqwww", 3)));
check("a community name still matches nothing", searchRegions(dxb, "Sobha Hartland").length === 0, names(searchRegions(dxb, "Sobha Hartland", 3)));

// The wrong emirate, which is what actually happened.
const fromAjman = await searchOtherEmirates("staging", "AJM", "al bursha");
check("'al bursha' in Ajman is found in Dubai",
  fromAjman.some((x) => x.emirate === "DXB" && x.region.nameEn.startsWith("Al Barsha")),
  fromAjman.map((x) => `${x.region.nameEn}/${x.emirate}`).join(" | "));
const creek = await searchOtherEmirates("staging", "AJM", "dubai creek");
check("'dubai creek' in Ajman points at Dubai",
  creek.some((x) => x.emirate === "DXB"),
  creek.map((x) => `${x.region.nameEn}/${x.emirate}`).join(" | "));
check("the emirate the customer chose is excluded",
  (await searchOtherEmirates("staging", "DXB", "Dubai Marina")).every((x) => x.emirate !== "DXB"));

// A genuine Ajman district must still resolve in Ajman.
check("'nuaimiya' resolves inside Ajman", searchRegions(ajm, "nuaimiya").length > 0, names(searchRegions(ajm, "nuaimiya", 4)));

// exactRegion stays strict: a code is a code, and a near-miss is not a match.
check("an area code resolves", exactRegion(dxb, "DXB-84")?.nameEn === "Nad Al Sheeba 1");
check("a misspelling is NOT treated as exact", exactRegion(dxb, "al bursha") === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
