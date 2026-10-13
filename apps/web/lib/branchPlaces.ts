/**
 * Where a branch really is, when Emirates Post says otherwise.
 *
 * FB-1797, "Map is not pointing to the right place (location is enabled in the
 * browser). Selected Abu Dhabi, then clicked on near branches." Looked at on
 * 13 October 2026 with the customer in Dubai: the Abu Dhabi list opened under
 * "Nearest branches to you" with Al Musafah Post Office 1.9 km away and the map
 * zoomed out to the whole country. Rental/BoxLocations gives seven of staging's
 * twenty Abu Dhabi branches — and sixteen of production's forty-one — the
 * coordinates of Dubai; three of Ajman's four sit in Dubai too, and one of Ras
 * Al Khaimah's in Hatta. Musaffah, Baniyas and Al Wagan are not 2, 7 and 11 km
 * from Business Bay. Framing the map on the branches (29 September) could not
 * help while a third of the branches were in the wrong emirate.
 *
 * So every branch is checked against a box drawn around its emirate — generous,
 * with the exclaves in (Hatta, Masfout, Manama, Kalba, Dibba). One inside its
 * box is kept as Emirates Post gave it. One outside is looked up by NAME with
 * Mapbox's geocoder, and the answer is taken only when it lands inside the box
 * and is called what the branch is called: "Musaffah" for Al Musafah, "Al Wagan"
 * for Al Wagn. A street with a similar name, or the city centroid the geocoder
 * falls back to for a name it does not know, is not the branch, so a branch the
 * geocoder cannot place keeps its name and loses its coordinates: the map lists
 * it without a pin and without a distance, which is the truth we have.
 */

export type BranchInput = {
  id: string;
  name: string;
  nameAr?: string;
  lat?: number;
  lng?: number;
  hours?: string;
  days?: string;
};

export type PlacedBranch = Omit<BranchInput, "lat" | "lng"> & {
  lat?: number;
  lng?: number;
  /** Where the coordinates came from; "unknown" means there are none. */
  placed: "emirates_post" | "geocoded" | "unknown";
};

/** [latMin, latMax, lngMin, lngMax], each emirate with its exclaves. */
export const EMIRATE_BOX: Record<string, [number, number, number, number]> = {
  AUH: [22.5, 25.0, 51.4, 56.1],
  DXB: [24.7, 25.45, 54.8, 56.25],
  SHJ: [24.9, 25.75, 55.25, 56.45],
  AJM: [24.75, 25.5, 55.3, 56.15],
  UAQ: [25.05, 25.7, 55.4, 56.0],
  RAK: [25.35, 26.15, 55.55, 56.4],
  FUJ: [24.85, 25.75, 55.95, 56.5],
};

/** Roughly the emirate's main city, for the geocoder's proximity bias. */
const EMIRATE_CENTRE: Record<string, [number, number]> = {
  AUH: [24.45, 54.65],
  DXB: [25.2, 55.3],
  SHJ: [25.35, 55.4],
  AJM: [25.4, 55.48],
  UAQ: [25.55, 55.55],
  RAK: [25.78, 55.95],
  FUJ: [25.12, 56.33],
};

const EMIRATE_NAME: Record<string, string> = {
  AUH: "Abu Dhabi",
  DXB: "Dubai",
  SHJ: "Sharjah",
  AJM: "Ajman",
  UAQ: "Umm Al Quwain",
  RAK: "Ras Al Khaimah",
  FUJ: "Fujairah",
};

export function inEmirate(emirate: string, lat: number | undefined, lng: number | undefined): boolean {
  const box = EMIRATE_BOX[emirate.toUpperCase()];
  if (!box || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const [la0, la1, lo0, lo1] = box;
  return (lat as number) >= la0 && (lat as number) <= la1 && (lng as number) >= lo0 && (lng as number) <= lo1;
}

/**
 * Emirates Post's spellings that the geocoder does not know, and the
 * abbreviations only their staff use.
 */
const ALIAS: Record<string, string> = {
  "al musafah": "Musaffah",
  "al wagn": "Al Wagan",
  mbz: "Mohammed Bin Zayed City",
  "madina ghayathy": "Ghayathi",
  masfoot: "Masfout",
  // "Al Manama" finds a street in Ajman city; the exclave is "Manama".
  "al manama": "Manama",
  // "Dalma" is answered with the capital; the island is known by its full name.
  dalma: "Dalma Island",
};

/** The place in a branch name: "NXN - Al Musafah Branch" asks for Musaffah. */
export function placeQuery(name: string): string {
  let q = name
    .replace(/^nxn\s*-\s*/i, "")
    .replace(/^tam\s+cent(?:re|er)\s*-\s*/i, "")
    .replace(/\b(?:branch|post\s+office|access|com|complex|comples|centre|center)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const alias = ALIAS[q.toLowerCase()];
  if (alias) q = alias;
  return q;
}

/** Words that carry no weight when two place names are compared. */
const STOP = new Set(["al", "el", "the", "city", "street", "road", "area", "district"]);
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join("");

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Is what the geocoder found called what we asked for?
 *
 * "Mohamed Bin Zayed City" for "Mohammed Bin Zayed City" and "Ajman Cental"
 * for "Ajman Central" are the same place spelt by someone else — one letter in
 * a long name. "Butais" for "Al Butain" and "Al Hamrah" for "Al Aamrah" are
 * other places eighty kilometres away, and the geocoder's "Abu Dhabi" for
 * "Masdar City" is its shrug. Short names must match exactly.
 */
export function sameName(query: string, found: string): boolean {
  const a = norm(query);
  const b = norm(found);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 8 && b.length >= 8 && editDistance(a, b, 1) <= 1;
}

/** The kinds of result that are a place, not a street or a region's centroid. */
const PLACE_TYPES = new Set(["place", "locality", "neighborhood", "district", "poi"]);

type Fetch = typeof fetch;

/** One answer per emirate and name, kept for a day; a miss is remembered too. */
const cache = new Map<string, { at: number; lat?: number; lng?: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function geocodeInEmirate(
  name: string,
  emirate: string,
  token: string,
  fetchImpl: Fetch = fetch
): Promise<{ lat: number; lng: number } | null> {
  const code = emirate.toUpperCase();
  const box = EMIRATE_BOX[code];
  const centre = EMIRATE_CENTRE[code];
  const q = placeQuery(name);
  if (!box || !centre || !q || !token) return null;
  const key = `${code}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lat !== undefined && hit.lng !== undefined ? { lat: hit.lat, lng: hit.lng } : null;

  const [la0, la1, lo0, lo1] = box;
  const url =
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(`${q}, ${EMIRATE_NAME[code]}`)}` +
    `&country=ae&language=en&limit=3&proximity=${centre[1]},${centre[0]}&bbox=${lo0},${la0},${lo1},${la1}` +
    `&access_token=${encodeURIComponent(token)}`;
  let found: { lat: number; lng: number } | null = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetchImpl(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const body = (await res.json()) as {
        features?: { geometry?: { coordinates?: number[] }; properties?: { name?: string; feature_type?: string } }[];
      };
      for (const f of body.features ?? []) {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const kind = String(f.properties?.feature_type ?? "");
        const label = String(f.properties?.name ?? "");
        if (!PLACE_TYPES.has(kind) || !inEmirate(code, lat, lng) || !sameName(q, label)) continue;
        found = { lat: lat as number, lng: lng as number };
        break;
      }
    }
  } catch {
    /* the geocoder being down leaves the branch without a pin, not the map without branches */
  }
  cache.set(key, { at: Date.now(), ...(found ?? {}) });
  return found;
}

/**
 * Every branch with coordinates that are in its emirate — Emirates Post's when
 * those are, the geocoder's when it knows the place, none otherwise.
 */
export async function placeBranches(
  branches: BranchInput[],
  emirate: string,
  token: string | undefined,
  fetchImpl: Fetch = fetch
): Promise<PlacedBranch[]> {
  return Promise.all(
    branches.map(async (b): Promise<PlacedBranch> => {
      const { lat, lng, ...rest } = b;
      if (inEmirate(emirate, lat, lng)) return { ...rest, lat, lng, placed: "emirates_post" };
      const found = token ? await geocodeInEmirate(b.name, emirate, token, fetchImpl) : null;
      if (found) return { ...rest, lat: found.lat, lng: found.lng, placed: "geocoded" };
      return { ...rest, placed: "unknown" };
    })
  );
}

/** Test seam: forget every answer. */
export function clearPlaceCache(): void {
  cache.clear();
}
