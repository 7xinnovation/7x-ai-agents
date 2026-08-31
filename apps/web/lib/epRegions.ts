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
  s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

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

/** Areas worth offering the customer for a typed-in address. */
export function searchRegions(rows: EpRegion[], query: string, limit = 12): EpRegion[] {
  const q = norm(query);
  if (!q) return rows.slice(0, limit);
  const words = q.split(" ").filter((w) => w.length > 2);
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
        // reach Nad Al Sheeba. Partial-word overlap is what gets it there.
        const hits = words.filter((w) => n.includes(w) || a.includes(w)).length;
        if (hits) score = 20 + hits * 10;
      }
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.nameEn.localeCompare(b.r.nameEn));
  return scored.slice(0, limit).map((x) => x.r);
}
