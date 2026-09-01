/**
 * Emirates Post delivery regions ("areas").
 *
 * A MyHome box is delivered to a home address, and the backend will only accept
 * an address whose area it recognises: Rental/Save answers
 * `173 MYHOME_ADDDRESS_NOT_FOUND` for anything else. The list of areas does not
 * live on the PO Box API at all — it comes from a separate masters service, the
 * same one the portal's own rent flow reads (checked against box-stg's bundle,
 * 31 Aug 2026), and the value the portal puts in `myHomeAddress.regionName` is
 * the area's CODE, e.g. "DXB-84", not its name. Sending a typed-in area name is
 * what produced the 173.
 */

const HOSTS: Record<string, string> = {
  staging: "https://masters-stg.epservices.ae",
  production: "https://masters.epservices.ae",
};

export type EpRegion = {
  code: string;
  nameEn: string;
  nameAr: string;
  /** Areas Emirates Post does not deliver to cannot host a MyHome box. */
  deliverable: boolean;
};

const cache = new Map<string, { at: number; rows: EpRegion[] }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function regionsFor(env: string, emirateCode: string): Promise<EpRegion[]> {
  const emirate = emirateCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(emirate)) return [];
  const host = HOSTS[env] ?? HOSTS.production;
  const key = `${host}|${emirate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`${host}/locations/api/Regions?EmirateCode=${emirate}`, {
      signal: ctl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return hit?.rows ?? [];
    const body = (await res.json()) as { data?: { list?: Record<string, unknown>[] } };
    const rows: EpRegion[] = (body?.data?.list ?? [])
      .map((r) => ({
        code: String(r.code ?? ""),
        nameEn: String(r.nameEn ?? ""),
        nameAr: String(r.nameAr ?? ""),
        deliverable: r.isDeliveryAllowed !== false,
      }))
      .filter((r) => r.code && r.nameEn);
    if (rows.length) cache.set(key, { at: Date.now(), rows });
    return rows.length ? rows : (hit?.rows ?? []);
  } catch {
    // A masters service that is down must not take the rental with it: the caller
    // falls back to asking, rather than guessing a code.
    return hit?.rows ?? [];
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();

/** Words that carry no distinguishing weight in a UAE area name. */
const STOP = new Set(["al", "el", "the", "area", "district", "dubai", "abu", "dhabi"]);

/** Levenshtein, bounded — we only ever care whether it is within one or two. */
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

/** How wrong a word may be and still be the same word. */
const slack = (len: number) => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

/** The one area this text can only mean, or null when it is ambiguous. */
export function exactRegion(rows: EpRegion[], value: string): EpRegion | null {
  const v = value.trim();
  if (!v) return null;
  const byCode = rows.find((r) => r.code.toLowerCase() === v.toLowerCase());
  if (byCode) return byCode;
  const n = norm(v);
  const byName = rows.filter((r) => norm(r.nameEn) === n || norm(r.nameAr) === n);
  return byName.length === 1 ? (byName[0] ?? null) : null;
}

/**
 * Areas worth offering the customer for a typed-in address.
 *
 * Customers type "al bursha" for Al Barsha and "Mirdiff" for Mirdif, and an exact
 * match answered both with "not a delivery area" and a request for the district —
 * which is the question they had just tried to answer. So words are compared with
 * a little slack: one wrong letter in a short word, two in a long one.
 */
export function searchRegions(rows: EpRegion[], query: string, limit = 12): EpRegion[] {
  const q = norm(query);
  if (!q) return rows.slice(0, limit);
  const words = q.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  const scored = rows
    .map((r) => {
      const n = norm(r.nameEn);
      const a = norm(r.nameAr);
      let score = 0;
      if (n === q || a === q) score = 100;
      else if (n.startsWith(q) || a.startsWith(q)) score = 80;
      else if (n.includes(q) || a.includes(q)) score = 60;
      else {
        // "Sobha Hartland" matches nothing; "Nad Al Sheeba villa" should still
        // reach Nad Al Sheeba, and "al bursha" should reach Al Barsha.
        const rWords = [...n.split(" "), ...a.split(" ")].filter((w) => w.length > 2 && !STOP.has(w));
        // A shared prefix only means something when the shorter word is most of
        // the longer one. Without that, "bursha" counted as a hit on "Bur Dubai"
        // and outranked Al Barsha, which is what the customer had mistyped.
        const prefixed = (a2: string, b2: string) => {
          const [short, long] = a2.length <= b2.length ? [a2, b2] : [b2, a2];
          return short.length >= 4 && long.startsWith(short) && short.length * 5 >= long.length * 3;
        };
        let exact = 0;
        let partial = 0;
        let fuzzy = 0;
        for (const w of words) {
          if (rWords.includes(w)) { exact++; continue; }
          if (rWords.some((rw) => prefixed(w, rw))) { partial++; continue; }
          const s = slack(w.length);
          if (s && rWords.some((rw) => editDistance(w, rw, s) <= s)) { fuzzy++; }
        }
        // A word that is one letter out beats a word that merely starts the same:
        // a near-miss is usually a typo, a shared prefix is usually a coincidence.
        if (exact || partial || fuzzy) score = 20 + exact * 12 + fuzzy * 8 + partial * 6;
      }
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.nameEn.localeCompare(b.r.nameEn));
  return scored.slice(0, limit).map((x) => x.r);
}

/** Every emirate Emirates Post lists areas for. */
export const EMIRATES: { code: string; name: string }[] = [
  { code: "AUH", name: "Abu Dhabi" },
  { code: "DXB", name: "Dubai" },
  { code: "SHJ", name: "Sharjah" },
  { code: "AJM", name: "Ajman" },
  { code: "UAQ", name: "Umm Al Quwain" },
  { code: "RAK", name: "Ras Al Khaimah" },
  { code: "FUJ", name: "Fujairah" },
];

/**
 * The same search across every other emirate.
 *
 * A customer setting up an Ajman box typed "al bursha" and then "dubai creek",
 * and was told twice that neither is a district in Ajman — true, and useless.
 * Both are real places in Dubai, and saying so is the answer they needed.
 */
export async function searchOtherEmirates(
  env: string,
  exclude: string,
  query: string,
  limit = 4
): Promise<{ emirate: string; emirateName: string; region: EpRegion }[]> {
  const others = EMIRATES.filter((e) => e.code !== exclude.toUpperCase());
  const lists = await Promise.all(others.map(async (e) => [e, await regionsFor(env, e.code)] as const));
  const out: { emirate: string; emirateName: string; region: EpRegion }[] = [];
  for (const [e, rows] of lists) {
    for (const r of searchRegions(rows, query, 2)) {
      if (r.deliverable) out.push({ emirate: e.code, emirateName: e.name, region: r });
    }
  }
  return out.slice(0, limit);
}
