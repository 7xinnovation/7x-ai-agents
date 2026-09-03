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
  /**
   * True when this came from MOEc's full record. False when it came from the
   * wrapper's summary shape, which carries no expiry, address, status or owners
   * -- so a missing expiry means UNKNOWN, not "does not expire".
   */
  hasFullDetail: boolean;
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
    hasFullDetail: true,
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
export function parseOwnerDetails(json: unknown): {
  licences: MoeLicence[];
  /** How many entries MOEc sent, before mapping. See the note below. */
  rawCount: number;
  statusCode?: string;
  statusText?: string;
} {
  const root = (json as Record<string, unknown>)?.["getLicenseDetailsByOwnerID_Response"] as
    | Record<string, unknown>
    | undefined;
  if (!root) return { licences: [], rawCount: 0 };
  const status = rows(root.statusMessages)[0];
  const raw = rows(root.licenseInfo);
  return {
    licences: raw.map(mapLicence).filter((l): l is MoeLicence => l !== null),
    rawCount: raw.length,
    statusCode: str(pick(status ?? {}, "statusCode")),
    statusText: str(pick(status ?? {}, "statusDescriptionEN")),
  };
}


/**
 * The wrapper's OWN response shape, which is far thinner than MOEc's.
 *
 * `GetLicenseContactInfoResponse` keeps five fields and drops the rest of the
 * registry record — no expiry date, no address, no status, no activities, no
 * owners. Mapped here anyway, because a name and a licence number still save the
 * customer typing them, but `hasFullDetail` is false so nothing downstream
 * presents a blank expiry as though the registry had said the licence never
 * expires.
 */
export function mapSummaryRow(row: Record<string, unknown>): MoeLicence | null {
  const ern = str(pick(row, "ERN", "ern"));
  const licenceNo = str(pick(row, "TradeLicenseNumber", "tradeLicenseNumber"));
  if (!ern && !licenceNo) return null;
  const contacts = rows(pick(row, "AvailableContactMethods", "availableContactMethods"));
  const contact = (type: string) =>
    contacts
      .filter((c) => str(pick(c, "Type", "type"))?.toLowerCase() === type)
      .map((c) => str(pick(c, "FullValue", "fullValue")) ?? str(pick(c, "Value", "value")))
      .find(Boolean);
  return {
    ern: ern ?? licenceNo!,
    tradeLicenseNo: licenceNo,
    nameEn: str(pick(row, "CompanyNameEn", "companyNameEn")),
    nameAr: str(pick(row, "CompanyNameAr", "companyNameAr")),
    issuingEntityCode: str(pick(row, "IssuingEntityCode", "issuingEntityCode")),
    isBranch: false,
    hasFullDetail: false,
    officialEmail: contact("email"),
    mobile: contact("sms"),
    activities: [],
    owners: [],
    managers: [],
  };
}

/**
 * One parser for both shapes we might be served.
 *
 * Today the endpoint returns the summary rows. If the wrapper is later given a
 * pass-through that keeps MOEc's record intact, the same call starts returning
 * the full shape and this keeps working without a deployment — which is the whole
 * reason both are handled rather than only the one that exists.
 */
export function parseMoeResponse(json: unknown): {
  licences: MoeLicence[];
  rawCount: number;
  statusCode?: string;
  statusText?: string;
} {
  const full = parseOwnerDetails(json);
  if (full.rawCount > 0 || full.statusCode) return full;
  const payload = (json as Record<string, unknown>)?.payload ?? (json as Record<string, unknown>)?.Payload;
  const raw = rows(payload);
  return {
    licences: raw.map(mapSummaryRow).filter((l): l is MoeLicence => l !== null),
    rawCount: raw.length,
  };
}

interface MoeConfig {
  base: string;
  path: string;
  token?: string;
  oauth?: { tokenUrl: string; clientId: string; clientSecret: string };
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config(): MoeConfig | null {
  const base = env("MOE_API_BASE_URL").replace(/\/$/, "");
  if (!base) return null;
  // Refuse to be pointed at the government bus. Reaching GSB directly needs
  // credentials this module no longer holds, but a base URL is the one thing
  // someone could paste in by hand, and the whole point of the wrapper is that
  // the registry is called by the service registered to call it.
  if (/gsb\.government\.ae/i.test(base)) return null;
  const token = env("MOE_API_TOKEN");
  const oauth = {
    tokenUrl: env("MOE_API_TOKEN_URL"),
    clientId: env("MOE_API_CLIENT_ID"),
    clientSecret: env("MOE_API_CLIENT_SECRET"),
  };
  const hasOauth = Object.values(oauth).every(Boolean);
  if (!token && !hasOauth) return null;
  return {
    base,
    path: env("MOE_API_PATH") || "/api/entities/get-moe",
    token: token || undefined,
    oauth: hasOauth ? oauth : undefined,
  };
}

/**
 * Whether this deployment serves a fixture instead of calling out.
 *
 * Unlike GSB, the wrapper HAS a staging host, so this is no longer the only way
 * to keep test traffic off live records — point staging at stg.wayn.ae instead.
 * It stays as the default for a deployment with nothing configured.
 */
export function moeIsMock(): boolean {
  return env("MOE_API_MOCK") === "1" || (!config() && env("MOE_API_MOCK") !== "0");
}

/** True when this deployment can actually reach the registry endpoint. */
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
    hasFullDetail: true,
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
 * The bearer for a registry read.
 *
 * The wrapper validates a JWT issued by accounts.emiratespost.ae — the same
 * identity service the Emirates Post widget's tokens come from — so a static
 * service token works and is refreshed here when client credentials are given
 * instead. Their own services mint one at `connect/token` on that host.
 */
async function bearer(cfg: MoeConfig): Promise<string> {
  if (cfg.token) return cfg.token;
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const o = cfg.oauth!;
  const res = await withTimeout((signal) =>
    fetch(o.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: o.clientId,
        client_secret: o.clientSecret,
      }).toString(),
      signal,
    })
  );
  if (!res.ok) throw new Error(`Registry token request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Registry token response carried no access_token");
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

  const bearerToken = await bearer(cfg);
  const res = await withTimeout((signal) =>
    fetch(`${cfg.base}${cfg.path}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        // Whose licences to read. Without it the endpoint answers for whoever the
        // token belongs to, which is our service account and owns nothing.
        "x-emirates-id": eid,
        Accept: "application/json",
      },
      signal,
    })
  );

  if (res.status === 401 || res.status === 403) tokenCache = null;
  if (!res.ok) {
    throw new Error(`Registry lookup failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const { licences, rawCount, statusCode, statusText } = parseMoeResponse(await res.json());
  if (statusCode && statusCode !== "100" && !licences.length) {
    throw new Error(`Registry lookup refused (${statusCode}${statusText ? `: ${statusText}` : ""})`);
  }
  // Licences arrived and not one of them mapped. That is a shape change, not a
  // person who owns nothing, and the two are otherwise indistinguishable: both
  // end as an empty array, and the customer is told "nothing is registered to
  // you" while the registry is in fact answering.
  if (rawCount > 0 && !licences.length) {
    throw new Error(`Registry returned ${rawCount} licence(s) in a shape this parser does not recognise`);
  }
  log.info("moe_licences_read", { count: licences.length, full: licences.filter((l) => l.hasFullDetail).length });
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
 * document review — and it is what the summary shape always returns, since that
 * shape carries no owners at all.
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
