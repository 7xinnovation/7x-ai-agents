/**
 * Trade licences by Emirates ID — the IDEP wrapper in front of MOEc.
 *
 * EPGL's team stood this up so we do not talk to the Government Service Bus
 * ourselves; their service holds the GSB credentials and is the one registered
 * to call it. Ours are a client id and secret for THEIR API.
 *
 *   POST /api/v1/Auth/authenticate        { clientId, clientSecret } -> accessToken
 *   POST /api/v1/Moe/licenses-by-owner    { ownerId }                -> the customer's licences
 *   POST /api/v1/Moe/license-details-by-ern { licenseId, entityId }  -> one licence + its OWNERS
 *
 * THE TWO CALLS RETURN DIFFERENT THINGS, and the difference decides the flow.
 * by-owner answers "which licences does this Emirates ID hold" and comes back
 * with statusCode 101 — "Only license information is fetched, Personal details
 * are not retrieved as it needs a prior consent" — so it carries no owners.
 * by-ern answers for ONE licence and does include `owners.personDetails[]`, each
 * with a `personEmiratesID`. So proving that a person owns a licence means
 * looking that licence up specifically; the list alone cannot do it.
 *
 * 101 IS A SUCCESS. Verified live on 4 Sep 2026: six real licences returned
 * alongside it. Treating anything but 100 as failure — which an earlier version
 * of this file did — would have reported a customer's own licences as an error
 * the moment the list came back empty for an unrelated reason.
 *
 * MOEc CODES ARE NOT TRANSLATED HERE. `licenseAddrEmirate` ("1"),
 * `licenseStatusID` ("MOECID7") and `licenseLegalTypeID` are MOEc's own
 * numbering and we have not been given the lists. They are carried through raw
 * and named *Raw so nothing downstream mistakes them for the three-letter
 * emirate codes EPGL's Salesforce uses.
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
  passportNo?: string;
  mobile?: string;
  email?: string;
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

/**
 * A real value, or undefined.
 *
 * Real records carry placeholders where a field is simply not held:
 * personFullNameEN is a literal "-", personEmail is "not applicable". Passed
 * through, those become a person named "-" on a card the customer is asked to
 * confirm.
 */
const PLACEHOLDER = /^(null|undefined|-+|n\/?a|not applicable|none)$/i;
function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && !PLACEHOLDER.test(s) ? s : undefined;
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
    // Lowercase in the live response ("bnBranchFlag"), title-case in MOEc's own
    // published sample. Both, because we see both.
    isBranch: bool(pick(d, "bnBranchFlag", "BNBranchFlag")) === true,
    hasFullDetail: true,
    activities: rows(activityRoot?.licenseActivity ?? activityRoot?.LicenseActivity).map((a) => ({
      code: str(pick(a, "activityCode")),
      nameEn: str(pick(a, "activityNameEN", "activityNameEn")),
      nameAr: str(pick(a, "activityNameAR", "activityNameAr")),
      startDate: str(pick(a, "activityStartDate")),
    })),
    owners: rows(ownerRoot?.personDetails ?? ownerRoot?.PersonDetails ?? ownerRoot?.OwnerDetails).map((o) => ({
      // personFullNameEN comes back as a literal "-" on real records where only
      // the Arabic name is held. `str` drops it, so the Arabic name is what a
      // caller sees rather than a dash presented as somebody's name.
      nameEn: str(pick(o, "personFullNameEN", "personFullNameEn", "ownerFullNameEN", "nameEn")),
      nameAr: str(pick(o, "personFullNameAR", "personFullNameAr", "ownerFullNameAR", "nameAr")),
      emiratesId: normaliseEmiratesId(pick(o, "personEmiratesID", "ownerEmiratesID", "emiratesId")) ?? undefined,
      nationality: str(pick(o, "personNationality", "ownerNationality")),
      passportNo: str(pick(o, "personPassportNo", "ownerPassportNo")),
      mobile: str(pick(o, "personMobileNo", "ownerMobileNo")),
      email: str(pick(o, "personEmail", "ownerEmail")),
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
  const j = json as Record<string, unknown> | undefined;
  const root = (j?.["getLicenseDetailsByOwnerID_Response"] ?? j?.["getLicenseDetails_Response"]) as
    | Record<string, unknown>
    | undefined;
  if (!root) return { licences: [], rawCount: 0 };
  const status = rows(root.statusMessages)[0];
  // by-owner returns an ARRAY; by-ern returns a single OBJECT. `rows` handles
  // both, which is why one parser serves both endpoints.
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
  clientId: string;
  clientSecret: string;
}

const AUTH_PATH = "/api/v1/Auth/authenticate";
const BY_OWNER_PATH = "/api/v1/Moe/licenses-by-owner";
const BY_ERN_PATH = "/api/v1/Moe/license-details-by-ern";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config(): MoeConfig | null {
  const base = env("MOE_API_BASE_URL").replace(/\/$/, "");
  const clientId = env("MOE_API_CLIENT_ID");
  const clientSecret = env("MOE_API_CLIENT_SECRET");
  if (!base || !clientId || !clientSecret) return null;
  // Refuse to be pointed at the government bus. The whole arrangement is that
  // EPGL's service calls GSB and we call EPGL's service; a base URL is the one
  // thing someone could paste in by hand.
  if (/gsb\.government\.ae/i.test(base)) return null;
  return { base, clientId, clientSecret };
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
 * An access token for the wrapper, cached until it actually expires.
 *
 * Their auth returns `expiresIn` as a STRING of seconds ("3600"), so it is
 * coerced rather than trusted to be a number. Refreshed a minute early: a token
 * that expires between the check and the call costs the customer a failed turn.
 */
async function bearer(cfg: MoeConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await withTimeout((signal) =>
    fetch(`${cfg.base}${AUTH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }),
      signal,
    })
  );
  if (!res.ok) throw new Error(`Registry auth failed (HTTP ${res.status})`);
  const json = (await res.json()) as { accessToken?: string; expiresIn?: string | number };
  if (!json.accessToken) throw new Error("Registry auth returned no accessToken");
  const secs = Number(json.expiresIn);
  const ttl = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 10 * 60_000;
  tokenCache = { token: json.accessToken, expiresAt: Date.now() + Math.max(ttl - TOKEN_SKEW_MS, 30_000) };
  return json.accessToken;
}

/** One authenticated POST, with a single retry when the token is refused. */
async function post(cfg: MoeConfig, path: string, body: unknown): Promise<unknown> {
  const call = async () => {
    const token = await bearer(cfg);
    return withTimeout((signal) =>
      fetch(`${cfg.base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal,
      })
    );
  };
  let res = await call();
  if (res.status === 401 || res.status === 403) {
    // A token can go stale between the cache check and the call. Mint a fresh
    // one and try once more rather than failing the customer's turn.
    tokenCache = null;
    res = await call();
  }
  if (!res.ok) throw new Error(`Registry ${path} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Did the registry actually answer, or fail quietly?
 *
 * 100 is "Success". 101 is "Success (Only license information is fetched,
 * Personal details are not retrieved as it needs a prior consent)" -- a real
 * success, verified live alongside six real licences. Anything else, with
 * nothing returned, is a failure and must not be reported to a customer as
 * "you own no companies".
 *
 * And licences that arrived but did not map are a SHAPE CHANGE, not an empty
 * registry -- both end as an empty array, and only one of them means what the
 * customer would be told.
 */
const SUCCESS_STATUS = new Set(["100", "101"]);

/**
 * "No Data Found" is an ANSWER.
 *
 * 102 is the registry saying it holds nothing against that Emirates ID, and it
 * was being thrown as a failure — so a renewal on 16 September told the customer
 * "the registry lookup hit an error just now" when the registry had in fact
 * replied, promptly and correctly. The two readings send the conversation to
 * different places: a failure means try again later, an empty answer means the
 * licence is held some other way and we should ask for it.
 *
 * The caution that surrounds SUCCESS_STATUS still stands for everything else:
 * any other non-success code with nothing returned is a refusal, and must never
 * be reported to a customer as "you own no companies".
 */
const NO_DATA_STATUS = new Set(["102"]);

function assertRegistryAnswered(r: {
  licences: MoeLicence[];
  rawCount: number;
  statusCode?: string;
  statusText?: string;
}): void {
  if (r.statusCode && NO_DATA_STATUS.has(r.statusCode)) return; // answered: nothing on file
  if (r.statusCode && !SUCCESS_STATUS.has(r.statusCode) && !r.licences.length) {
    throw new Error(`Registry lookup refused (${r.statusCode}${r.statusText ? `: ${r.statusText}` : ""})`);
  }
  if (r.rawCount > 0 && !r.licences.length) {
    throw new Error(`Registry returned ${r.rawCount} licence(s) in a shape this parser does not recognise`);
  }
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

  const { licences, rawCount, statusCode, statusText } = parseMoeResponse(await post(cfg, BY_OWNER_PATH, { ownerId: eid }));
  assertRegistryAnswered({ licences, rawCount, statusCode, statusText });
  log.info("moe_licences_read", { count: licences.length, full: licences.filter((l) => l.hasFullDetail).length });
  resultCache.set(key, { at: Date.now(), licences });
  return licences;
}

/**
 * ONE licence, by its printed number — and, unlike the list, with its OWNERS.
 *
 * This is the call that can answer "does this person own this licence". The
 * by-owner list comes back with statusCode 101 and no personal details, so it
 * establishes which licences exist and nothing about who holds them. Ownership
 * has to be checked here, on the specific licence.
 *
 * `entityId` is the issuing authority (`licenseIssuanceEDID` on any licence the
 * list returned) and defaults to 1, which is what the live records carry.
 */
export async function licenceByNumber(licenceNo: string, entityId = 1): Promise<MoeLicence | null> {
  const no = String(licenceNo ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/ ]{0,38}$/.test(no)) throw new Error("licence number is not in an accepted format");

  if (moeIsMock()) return MOCK_LICENCES.find((l) => l.tradeLicenseNo === no) ?? null;
  const cfg = config();
  if (!cfg) throw new MoeNotConfiguredError();

  const parsed = parseMoeResponse(await post(cfg, BY_ERN_PATH, { licenseId: no, entityId }));
  assertRegistryAnswered(parsed);
  const licence = parsed.licences[0] ?? null;
  log.info("moe_licence_read", { found: Boolean(licence), owners: licence?.owners.length ?? 0 });
  return licence;
}

/**
 * Is this Emirates ID one of the licence's owners?
 *
 * Three-valued, and the middle value is the point. "The registry returned no
 * readable owner" is NOT "this person is not an owner": the by-owner list never
 * carries owners at all, and a licence looked up there would otherwise read as
 * a failed ownership check. `unknown` means fall back to document review.
 */
export function ownerMatch(licence: MoeLicence, emiratesId: string): "match" | "no-match" | "unknown" {
  const want = normaliseEmiratesId(emiratesId);
  if (!want) return "unknown";
  const known = licence.owners.map((o) => o.emiratesId).filter((v): v is string => !!v);
  if (!known.length) return "unknown";
  return known.includes(want) ? "match" : "no-match";
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
