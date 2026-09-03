/**
 * Trade licences by Emirates ID — MOEc, over the Government Service Bus.
 *
 * This is the authoritative by-EID lookup, and it is NOT the one NXN uses.
 * lib/gsbLookup talks to Emirates Post's own MOE proxy (/api/MOE/GetEntitiesById)
 * with Emirates Post credentials and, for most tiers, the customer's session
 * bearer. EPGL has neither: its customers sign in with UAE PASS directly, and a
 * UAE PASS token is not a currency any Emirates Post endpoint accepts (FB-1485).
 *
 * So EPGL goes to the source instead. Every credential here belongs to us, the
 * call is server-to-server, and the only thing the customer supplies is the
 * Emirates ID their UAE PASS sign-in already proved. Two hops:
 *
 *   GET  gateway/getAccessToken_MOEc/1.0/getAccessToken            (client_credentials)
 *   POST gateway/fetchLicenseDetailsByOwnerID_MOEc/1.0/getLicenseDetailsByOwnerID
 *
 * The token goes on the second call as `CustomAuth`, NOT as Authorization —
 * Authorization carries Basic credentials on both hops. That is GSB's shape, not
 * a mistake.
 *
 * WHAT WE DELIBERATELY DO NOT DO
 *
 * The reference implementation (wayn-business-api, GET /api/entities/get-moe) is
 * not called, and is not a fallback. It is [AllowAnonymous], takes the Emirates
 * ID from an `x-emirates-id` header, and returns UNMASKED owner email and phone
 * in `FullValue` — anyone may ask it for anyone's licences. It also filters out
 * licences the caller has already linked, which is onboarding behaviour we would
 * have to work around, and its DTO drops the owner block entirely. We want the
 * whole list and we want the owners, so we parse the upstream response ourselves.
 *
 * MOEc CODES ARE NOT TRANSLATED HERE. `licenseAddrEmirate` ("4"), `licenseStatusID`
 * ("MOECID7") and `licenseLegalTypeID` are MOEc's own numbering and we have not
 * been given the lists. They are carried through raw and named *Raw so that
 * nothing downstream mistakes them for the three-letter emirate codes EPGL's
 * Salesforce uses. Guessing "4 = Ajman" from the usual UAE ordering would have
 * been wrong: the sample licence at emirate 4 is in Ras Al Khaimah.
 */
import { createHmac } from "node:crypto";
import { log } from "./logger";

const TOKEN_PATH = "gateway/getAccessToken_MOEc/1.0/getAccessToken";
const OWNER_PATH = "gateway/fetchLicenseDetailsByOwnerID_MOEc/1.0/getLicenseDetailsByOwnerID";

/** Their client allows 15s. We sit inside a chat turn, so we allow less. */
const REQUEST_TIMEOUT_MS = 12_000;
/** Re-lookup is cheap to avoid and the registry does not change within a conversation. */
const RESULT_TTL_MS = 5 * 60_000;
/** Refresh a token this long before it actually expires. */
const TOKEN_SKEW_MS = 60_000;

export interface MoeOwner {
  nameEn?: string;
  nameAr?: string;
  emiratesId?: string;
  nationality?: string;
  /** Share of the licence, when MOEc reports one. */
  sharePercent?: number;
}

export interface MoeManager {
  nameEn?: string;
  nameAr?: string;
  emiratesId?: string;
  email?: string;
  mobile?: string;
  nationality?: string;
  isUaeResident?: boolean;
}

export interface MoeActivity {
  code?: string;
  nameEn?: string;
  nameAr?: string;
  startDate?: string;
}

export interface MoeLicence {
  /** Entity Registration Number — MOEc's stable key, and how we dedupe. */
  ern: string;
  /** The trade licence number as printed, i.e. what EPGL calls the licence no. */
  tradeLicenseNo?: string;
  nameEn?: string;
  nameAr?: string;
  /** MOEc's issuing-entity id. Numeric; not EPGL's regulator picklist. */
  issuingEntityCode?: string;
  registrationDate?: string;
  expiryDate?: string;
  /** MOEc coded values, carried raw — see the header note. */
  statusCodeRaw?: string;
  legalTypeCodeRaw?: string;
  emirateCodeRaw?: string;
  fullAddress?: string;
  officialEmail?: string;
  mobile?: string;
  legalRepresentative?: string;
  isBranch: boolean;
  activities: MoeActivity[];
  owners: MoeOwner[];
  managers: MoeManager[];
}

/**
 * 15 digits, however it was punctuated. Mirrors lib/gsbLookup's copy on purpose:
 * this module stays free of the database imports that one carries, so it can be
 * exercised without a connection.
 */
export function normaliseEmiratesId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return /^\d{15}$/.test(digits) ? digits : null;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : undefined;
}

/** MOEc sends booleans as the strings "true"/"false". */
function bool(v: unknown): boolean | undefined {
  const s = str(v)?.toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return typeof v === "boolean" ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : undefined;
}

/** MOEc wraps most repeated blocks as { Thing: { ThingDetails: [...] } }, but a
 *  single entry sometimes arrives unwrapped, and an empty one as "" or null. */
function rows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

/**
 * Map one `licenseInfo[]` entry.
 *
 * Exported so the shape can be tested against captured payloads without a
 * credential or a network — every field below is one MOEc spelled differently
 * from the one beside it, and that is exactly the kind of thing that rots
 * silently.
 */
export function mapLicence(entry: Record<string, unknown>): MoeLicence | null {
  const d = (entry.licenseDetails ?? entry.LicenseDetails) as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return null;
  const ern = str(pick(d, "licenseERN", "LicenseERN"));
  if (!ern) return null;

  const activityRoot = (entry.licenseActivities ?? entry.LicenseActivities) as Record<string, unknown> | undefined;
  const managerRoot = (entry.Managers ?? entry.managers) as Record<string, unknown> | undefined;
  // The reference DTO does not model owners at all, so the key spelling here is
  // taken from MOEc's own sample rather than from their code. Both plausible
  // shapes are accepted so a response carrying either is not silently dropped.
  const ownerRoot = (entry.Owners ?? entry.owners) as Record<string, unknown> | undefined;

  return {
    ern,
    tradeLicenseNo: str(pick(d, "licenseLocalID", "LicenseLocalID")),
    nameEn: str(pick(d, "BNRegNameEn", "bnRegNameEn")),
    nameAr: str(pick(d, "BNRegNameAr", "bnRegNameAr")),
    issuingEntityCode: str(pick(d, "licenseIssuanceEDID", "LicenseIssuanceEDID")),
    registrationDate: str(pick(d, "licenseRegistrationDate")),
    expiryDate: str(pick(d, "licenseExpirationDate")),
    statusCodeRaw: str(pick(d, "licenseStatusID")),
    legalTypeCodeRaw: str(pick(d, "licenseLegalTypeID")),
    emirateCodeRaw: str(pick(d, "licenseAddrEmirate")),
    fullAddress: str(pick(d, "licenseFullAddress")),
    officialEmail: str(pick(d, "licenseOfficialEmail")),
    mobile: str(pick(d, "licenseMobPhoneNo")),
    legalRepresentative: str(pick(d, "licenseLegalRepresentativeName")),
    isBranch: bool(pick(d, "BNBranchFlag")) === true,
    activities: rows(activityRoot?.licenseActivity ?? activityRoot?.LicenseActivity).map((a) => ({
      code: str(pick(a, "activityCode")),
      nameEn: str(pick(a, "activityNameEN", "activityNameEn")),
      nameAr: str(pick(a, "activityNameAR", "activityNameAr")),
      startDate: str(pick(a, "activityStartDate")),
    })),
    owners: rows(ownerRoot?.PersonDetails ?? ownerRoot?.personDetails ?? ownerRoot?.OwnerDetails).map((o) => ({
      nameEn: str(pick(o, "personFullNameEN", "personFullNameEn", "ownerFullNameEN", "nameEn")),
      nameAr: str(pick(o, "personFullNameAR", "personFullNameAr", "ownerFullNameAR", "nameAr")),
      emiratesId: normaliseEmiratesId(pick(o, "personEmiratesID", "ownerEmiratesID", "emiratesId")) ?? undefined,
      nationality: str(pick(o, "personNationality", "ownerNationality")),
      sharePercent: num(pick(o, "personSharePercentage", "ownerSharePercentage")),
    })),
    managers: rows(managerRoot?.ManagerDetails ?? managerRoot?.managerDetails).map((m) => ({
      nameEn: str(pick(m, "managerFullNameEN", "managerFullNameEn")),
      nameAr: str(pick(m, "managerFullNameAR", "managerFullNameAr")),
      emiratesId: normaliseEmiratesId(pick(m, "managerEmiratesID")) ?? undefined,
      email: str(pick(m, "managerEmail")),
      mobile: str(pick(m, "managerMobileNo")),
      nationality: str(pick(m, "managerNationality")),
      isUaeResident: bool(pick(m, "isManagerResidentofUAE")),
    })),
  };
}

/**
 * The whole response, licences plus MOEc's own status line.
 *
 * `statusMessages` is not decoration: 100 is success and anything else means the
 * empty `licenseInfo` beside it is a FAILURE, not "this person owns no company".
 * The two must never be reported to the customer the same way.
 */
export function parseOwnerDetails(json: unknown): { licences: MoeLicence[]; statusCode?: string; statusText?: string } {
  const root = (json as Record<string, unknown>)?.["getLicenseDetailsByOwnerID_Response"] as
    | Record<string, unknown>
    | undefined;
  if (!root) return { licences: [] };
  const status = rows(root.statusMessages)[0];
  return {
    licences: rows(root.licenseInfo)
      .map(mapLicence)
      .filter((l): l is MoeLicence => l !== null),
    statusCode: str(pick(status ?? {}, "statusCode")),
    statusText: str(pick(status ?? {}, "statusDescriptionEN")),
  };
}

interface MoeConfig {
  base: string;
  entityCode: string;
  token: { clientId: string; clientSecret: string; username: string; password: string; apiKey: string };
  owner: { username: string; password: string; gsbApiKey: string; moecApiKey: string };
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config(): MoeConfig | null {
  const base = (env("MOE_GSB_BASE_URL") || "https://integrate.gsb.government.ae/").replace(/\/?$/, "/");
  const cfg: MoeConfig = {
    base,
    entityCode: env("MOE_GSB_ENTITY_CODE"),
    token: {
      clientId: env("MOE_GSB_TOKEN_CLIENT_ID"),
      clientSecret: env("MOE_GSB_TOKEN_CLIENT_SECRET"),
      username: env("MOE_GSB_TOKEN_USERNAME"),
      password: env("MOE_GSB_TOKEN_PASSWORD"),
      apiKey: env("MOE_GSB_TOKEN_API_KEY"),
    },
    owner: {
      username: env("MOE_GSB_OWNER_USERNAME"),
      password: env("MOE_GSB_OWNER_PASSWORD"),
      gsbApiKey: env("MOE_GSB_OWNER_API_KEY"),
      moecApiKey: env("MOE_GSB_OWNER_MOEC_API_KEY"),
    },
  };
  const complete =
    cfg.entityCode &&
    Object.values(cfg.token).every(Boolean) &&
    Object.values(cfg.owner).every(Boolean);
  return complete ? cfg : null;
}

/**
 * Staging must not read live government records.
 *
 * The reference implementation has no environment override at all — one base URL
 * for every environment — so a staging deployment there queries real people. Ours
 * returns a fixture instead unless this is explicitly turned off, and the fixture
 * is obviously synthetic so nobody mistakes it for a real company.
 */
export function moeIsMock(): boolean {
  return env("MOE_GSB_MOCK") === "1" || (!config() && env("MOE_GSB_MOCK") !== "0");
}

/** True when this deployment can actually reach MOEc. */
export function moeConfigured(): boolean {
  return config() !== null;
}

const MOCK_LICENCES: MoeLicence[] = [
  {
    ern: "4120000000000000001",
    tradeLicenseNo: "SAMPLE-1001",
    nameEn: "SAMPLE TRADING FZ-LLC (TEST DATA)",
    nameAr: "شركة العينة للتجارة (بيانات اختبار)",
    issuingEntityCode: "30",
    registrationDate: "2024-10-28T00:00:00",
    expiryDate: "2027-10-27T00:00:00",
    statusCodeRaw: "MOECID7",
    legalTypeCodeRaw: "17",
    emirateCodeRaw: "4",
    fullAddress: "Sample Building, Test Zone-FZ, Ras Al Khaimah, UAE",
    officialEmail: "owner@example.invalid",
    mobile: "+971500000001",
    legalRepresentative: "SAMPLE OWNER",
    isBranch: false,
    activities: [{ code: "271749963", nameEn: "Marketing Management", nameAr: "الادارة التسويقية" }],
    owners: [{ nameEn: "SAMPLE OWNER", emiratesId: "784199000000000", sharePercent: 100 }],
    managers: [{ nameEn: "SAMPLE MANAGER", emiratesId: "784199000000001", email: "mgr@example.invalid" }],
  },
];

let tokenCache: { token: string; expiresAt: number } | null = null;
const resultCache = new Map<string, { at: number; licences: MoeLicence[] }>();

/** Never key a cache on an Emirates ID in the clear — a heap dump should not be a list of people. */
function cacheKey(eid: string): string {
  return createHmac("sha256", "moe-licence-cache").update(eid).digest("base64url");
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A GSB access token, cached until it actually expires.
 *
 * The reference implementation fetches a fresh one on every single lookup. Inside
 * a chat turn that is a second round trip the customer waits through, for a token
 * whose own `expires_in` says it was good all along.
 */
async function accessToken(cfg: MoeConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const url = new URL(`${cfg.base}${TOKEN_PATH}`);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", cfg.token.clientId);
  url.searchParams.set("client_secret", cfg.token.clientSecret);

  const res = await withTimeout((signal) =>
    fetch(url, {
      headers: {
        Authorization: basic(cfg.token.username, cfg.token.password),
        "GSB-APIKey": cfg.token.apiKey,
        Accept: "application/json",
      },
      signal,
    })
  );
  if (!res.ok) throw new Error(`MOE token request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("MOE token response carried no access_token");
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 10 * 60_000;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + Math.max(ttl - TOKEN_SKEW_MS, 30_000) };
  return json.access_token;
}

export class MoeNotConfiguredError extends Error {
  constructor() {
    super("MOE_NOT_CONFIGURED");
    this.name = "MoeNotConfiguredError";
  }
}

/**
 * Every trade licence registered to one Emirates ID.
 *
 * An empty array is a real answer — plenty of people own no company — and is not
 * the same as a failure, which throws. Callers must keep the two apart: told
 * "lookup failed" the assistant should ask for the licence number and carry on,
 * but told "no licences" it should not imply the registry was unreachable.
 */
export async function licencesByEmiratesId(emiratesId: string): Promise<MoeLicence[]> {
  const eid = normaliseEmiratesId(emiratesId);
  if (!eid) throw new Error("Emirates ID is not in an accepted format");

  if (moeIsMock()) return MOCK_LICENCES;
  const cfg = config();
  if (!cfg) throw new MoeNotConfiguredError();

  const key = cacheKey(eid);
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.licences;

  const token = await accessToken(cfg);
  const res = await withTimeout((signal) =>
    fetch(`${cfg.base}${OWNER_PATH}`, {
      method: "POST",
      headers: {
        Authorization: basic(cfg.owner.username, cfg.owner.password),
        "GSB-APIKey": cfg.owner.gsbApiKey,
        "MOEc-APIKey": cfg.owner.moecApiKey,
        Entity_Code: cfg.entityCode,
        // GSB's own shape: the bearer rides here because Authorization is taken.
        CustomAuth: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ownerID: eid, ownerContest: true, entityContest: true }),
      signal,
    })
  );

  if (res.status === 401 || res.status === 403) {
    // A token can go stale between the cache check and the call. Drop it so the
    // next attempt mints a fresh one rather than reusing the one just refused.
    tokenCache = null;
  }
  if (!res.ok) {
    throw new Error(`MOE licence lookup failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const { licences, statusCode, statusText } = parseOwnerDetails(await res.json());
  // 100 is success. Anything else means the empty list beside it is a failure,
  // not an answer, and must not be reported as "you own no companies".
  if (statusCode && statusCode !== "100" && !licences.length) {
    throw new Error(`MOE licence lookup refused (${statusCode}${statusText ? `: ${statusText}` : ""})`);
  }
  log.info("moe_licences_read", { count: licences.length, statusCode });
  resultCache.set(key, { at: Date.now(), licences });
  return licences;
}

/**
 * Does this Emirates ID appear among a licence's owners or managers?
 *
 * Three-valued for the same reason lib/gsbLookup's ownerMatch is: a licence whose
 * owner block came back empty has NOT been checked, and collapsing that into
 * "not an owner" would refuse a legitimate applicant while collapsing it the
 * other way would wave through an unverified one. `unknown` means fall back to
 * document review.
 */
export function licenceHolderMatch(licence: MoeLicence, emiratesId: string): "match" | "no-match" | "unknown" {
  const want = normaliseEmiratesId(emiratesId);
  if (!want) return "unknown";
  const known = [...licence.owners, ...licence.managers]
    .map((p) => p.emiratesId)
    .filter((v): v is string => !!v);
  if (!known.length) return "unknown";
  return known.includes(want) ? "match" : "no-match";
}

/** Clears both caches. Tests only — a long-lived process should keep them. */
export function __resetMoeCaches(): void {
  tokenCache = null;
  resultCache.clear();
}
