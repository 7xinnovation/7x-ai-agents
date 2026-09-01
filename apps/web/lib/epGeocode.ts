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
  /** True when Emirates Post says the point is outside its delivery territory. */
  outOfService?: boolean;
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
    return (await res.json()) as Record<string, unknown>;
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
    emirateCode: str(d.emirateCode).toUpperCase() || undefined,
    emirate: str(d.emirate) || undefined,
    area: str(d.area) || undefined,
    street: str(d.street) || undefined,
    // The portal takes the first comma-separated part as the building number.
    building: str(d.building).split(",")[0]?.trim() || undefined,
  };

  const list = (territory?.list ?? (territory?.payload as Record<string, unknown> | undefined)?.list) as
    | Record<string, unknown>[]
    | undefined;
  if (Array.isArray(list)) {
    if (!list.length) out.outOfService = true;
    else if (list[0]?.isOutOfService === true) out.outOfService = true;
  }

  if (out.emirateCode && out.area) {
    const rows = await regionsFor(env, out.emirateCode);
    if (rows.length) {
      const hit = exactRegion(rows, out.area);
      if (hit) out.region = hit;
      else out.candidates = searchRegions(rows, out.area, 6).filter((r) => r.deliverable);
    }
  }
  return out;
}
