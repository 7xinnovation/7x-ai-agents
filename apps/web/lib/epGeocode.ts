/**
 * Turn a pinned map location into an address Emirates Post recognises.
 *
 * Typing an address is where the MyHome journey keeps failing. A customer setting
 * up an Ajman box typed "al bursha", then "dubai creek", and was told twice that
 * neither is a district in Ajman. Spelling and cross-emirate help go some way,
 * but the honest fix is not to make people name a district at all: their own
 * portal lets you drop a pin, and the same reverse-geocode is available to us.
 *
 * Two calls, both on Emirates Post's shipping service and both needing the
 * customer's session:
 *
 *   MasterLocation/ReverseByProvider   -> emirate, area, street, building
 *   MasterLocation/Territories/Reversegeo -> whether they deliver there at all
 *
 * The area that comes back is a NAME, and Rental/Save wants the masters CODE, so
 * it is matched against the region list for the emirate the pin landed in — the
 * pin decides the emirate, not the customer.
 */
import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";
import { regionsFor, exactRegion, searchRegions, type EpRegion } from "./epRegions";

const INTEGRATION_NAME = /nxn/i;

export interface PinnedAddress {
  emirateCode?: string;
  emirate?: string;
  /** Emirates Post's own name for the area at that point. */
  area?: string;
  street?: string;
  building?: string;
  /** The masters region this resolves to, when one matches. */
  region?: EpRegion;
  /** Other regions worth offering when the area did not resolve outright. */
  candidates?: EpRegion[];
  /** Villa number, on the rare occasion the geocoder knows it. */
  villaNumber?: string;
  /** Emirates Post's own name for the delivery territory the point falls in. */
  territory?: string;
  /** True when Emirates Post says the point is outside its delivery territory. */
  outOfService?: boolean;
  /** Out of delivery area — reachable, but not on a normal delivery round. */
  remote?: boolean;
}

async function spec(agentId: string, env: EnvKey) {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const s = row?.environments[env] as EnvSpec | undefined;
  if (!s) throw new Error("NXN integration is not configured for this environment");
  const apiKey = isEncrypted(s.apiKey) ? decryptSecret(s.apiKey) : s.apiKey;
  return { baseUrl: String(s.baseUrl).replace(/\/$/, ""), apiKey: (apiKey as string) || undefined };
}

async function get(url: string, apiKey: string | undefined, token: string, locale: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const h: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Accept-Language": locale === "ar" ? "ar" : "en",
    };
    if (apiKey) h["X-API-KEY"] = apiKey;
    const res = await fetch(url, { headers: h, signal: ctl.signal });
    if (!res.ok) return null;
    // These two answer with JSON *inside* a JSON string — the body parses to
    // `"{\"emirateCode\":\"DXB\",…}"`, not to an object. Verified live on 1 Sep.
    let parsed: unknown = await res.json();
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { return null; }
    }
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function addressFromPin(
  agentId: string,
  env: EnvKey,
  lat: number,
  lng: number,
  token: string,
  locale = "en"
): Promise<PinnedAddress | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const s = await spec(agentId, env);

  const [rev, territory] = await Promise.all([
    get(`${s.baseUrl}/shipping/api/MasterLocation/ReverseByProvider?Longitude=${lng}&Latitude=${lat}&Provider=1`, s.apiKey, token, locale),
    get(`${s.baseUrl}/shipping/api/MasterLocation/Territories/Reversegeo?Take=1&Skip=0&Lng=${lng}&Lat=${lat}`, s.apiKey, token, locale),
  ]);
  if (!rev) return null;
  // The portal reads these off the response body directly; a payload wrapper is
  // cheap to tolerate and costs nothing if it never appears.
  const d = (rev.payload && typeof rev.payload === "object" ? rev.payload : rev) as Record<string, unknown>;

  const out: PinnedAddress = {
    // "Dubai Emirate" reads oddly in a sentence; the code is what we act on.
    emirateCode: str(d.emirateCode).toUpperCase() || undefined,
    emirate: str(d.emirate).replace(/\s+Emirate$/i, "") || undefined,
    area: str(d.area) || str(d.district) || undefined,
    street: str(d.street) || undefined,
    // The portal takes the first comma-separated part as the building number,
    // and the rest repeats the street. Placeholders come back for open ground.
    building: (() => {
      const b = str(d.building).split(",")[0]?.trim() ?? "";
      return b && !/^(planned building|utility structure|building)$/i.test(b) ? b : undefined;
    })(),
    villaNumber: str(d.villaNumber) || undefined,
  };

  const list = (territory?.list ?? (territory?.payload as Record<string, unknown> | undefined)?.list) as
    | Record<string, unknown>[]
    | undefined;
  if (Array.isArray(list)) {
    if (!list.length) out.outOfService = true;
    else {
      if (list[0]?.isOutOfService === true) out.outOfService = true;
      // ODA is "out of delivery area" -- reachable, but not on a normal round.
      // A MyHome box is a weekly delivery to the door, so it is worth saying.
      if (list[0]?.isOda === true) out.remote = true;
      // Their territory name is often the better one: the geocoder answered
      // "Al Dhafra Municipality" where the territory said "Bu Hasa".
      const t = str(list[0]?.nameEn);
      if (t && t !== "NA" && !out.area) out.area = t;
      if (t && t !== "NA") out.territory = t;
    }
  }

  if (out.emirateCode && (out.area || out.territory)) {
    const rows = await regionsFor(env, out.emirateCode);
    if (rows.length) {
      // The two services spell the same place differently -- the geocoder says
      // "Nadd Al Shiba 1" where the masters list says "Nad Al Sheeba 1" -- so
      // both names are tried, exactly first and then with the search's slack.
      // Territory first: it is the more precise of the two. The geocoder called a
      // point in Al Majaz "Sharjah", which matches every business with Sharjah in
      // its name, while the territory said "Al Majaz 2".
      const tries = [out.territory, out.area].filter(Boolean) as string[];
      const hit = tries.map((t) => exactRegion(rows, t)).find(Boolean);
      if (hit) out.region = hit;
      else {
        const found = tries.flatMap((t) => searchRegions(rows, t, 6)).filter((r) => r.deliverable);
        const seen = new Set<string>();
        out.candidates = found.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true))).slice(0, 6);
        // A single candidate is NOT promoted to the answer. A pin in empty
        // desert geocoded to "Al Dhafra Municipality", which fuzzy-matched the
        // one nearby area -- "Al Dafra Airbase" -- and a sole match would have
        // made that the customer's home address without them ever seeing it.
        // Only an exact name match answers on its own; the rest are offered.
      }
    }
  }
  return out;
}
