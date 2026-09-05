import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

/**
 * Trade-licence lookups for NXN, over the Emirates Post MOE (GSB) endpoints.
 *
 * WHAT THESE ENDPOINTS ACTUALLY DO — this differs from how the feature was
 * described, and the difference decides the flow:
 *
 *   GetIssuingEntities()                      -> the issuing authorities
 *   GetEntitiesById(entityCode)               -> companies under ONE AUTHORITY
 *   GetEntitiesByLicenseNo(entityCode, no)    -> one company + its owners
 *
 * `entityCode` is documented by the backend as "Entity code from
 * GetIssuingEntities" — an ISSUING AUTHORITY code. It is not an Emirates ID and
 * does not accept one. The customer's Emirates ID appears ONLY inside
 * ownerDetails[] on the by-licence-number response, i.e. as something to CHECK a
 * licence against, never as something to search by. There is no Emirates-ID-keyed
 * lookup in this API.
 *
 * So the supported shape is: authority -> licence number -> company + owners ->
 * compare the customer's Emirates ID against the owners returned. That last step
 * is `ownerMatch` below, and it is the GSB ownership check the corporate journey
 * currently says is not integrated.
 *
 * As with lib/epglRead, the request is templated HERE and the model only supplies
 * values that are validated first — an operation the model composes freely is a
 * prompt-injection surface, and these reads carry company ownership data.
 */

const INTEGRATION_NAME = /nxn/i;

/** UAE Emirates ID: 15 digits, conventionally shown 784-YYYY-NNNNNNN-C. */
const EID_DIGITS = /^\d{15}$/;
/** Issuing-authority codes come back from GetIssuingEntities as small integers. */
const ENTITY_CODE = /^\d{1,10}$/;
/** Trade licence numbers vary by authority; keep it permissive but bounded. */
const LICENCE_NO = /^[A-Za-z0-9][A-Za-z0-9\-/ ]{0,38}$/;

export interface IssuingEntity {
  code: string;
  nameEn?: string;
  nameAr?: string;
  emirateNameEn?: string;
  emirateNameAr?: string;
  isFreeZone: boolean;
}

export interface GsbCompany {
  tradeLicenseNo?: string;
  nameEn?: string;
  nameAr?: string;
  emirateCode?: string;
  issueDate?: string;
  expiryDate?: string;
  issuingEntityCode?: string;
}

export interface GsbOwner {
  nameEn?: string;
  nameAr?: string;
  emiratesId?: string;
}

/**
 * Strip formatting so "784-1980-1234567-1" and "784198012345671" compare equal.
 * Returns null when what is left is not a 15-digit Emirates ID, so a malformed
 * value can never accidentally equal another malformed value.
 */
export function normaliseEmiratesId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return EID_DIGITS.test(digits) ? digits : null;
}

/**
 * Does this Emirates ID belong to one of the licence's owners?
 *
 * Deliberately three-valued. "No owner on the licence carries a readable Emirates
 * ID" is NOT the same as "this person is not an owner", and collapsing the two
 * would let a licence with unreadable owner records read as a failed ownership
 * check — or, worse the other way, let an unchecked licence pass as verified.
 * The caller must handle `unknown` by falling back to document review.
 */
export function ownerMatch(owners: GsbOwner[], emiratesId: string): "match" | "no-match" | "unknown" {
  const want = normaliseEmiratesId(emiratesId);
  if (!want) return "unknown";
  const known = owners.map((o) => normaliseEmiratesId(o.emiratesId)).filter((v): v is string => v !== null);
  if (!known.length) return "unknown";
  return known.includes(want) ? "match" : "no-match";
}

/**
 * Some registry names carry internal maintenance notes, e.g.
 * "Fujairah Culture & Media Authority (FCMA)TO-BE-REMOVE-OR-ASSIGN-TO-NEW-ED".
 * These reach the customer as the label on a button, so they are stripped here
 * rather than left to the model to notice — it did strip that one, but it had no
 * instruction to, and the next such note will be worded differently.
 */
export function cleanEntityName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/\s*TO[\s-]?BE[\s-]?REMOVE[D]?[\s-]?.*$/i, "")
    .replace(/\s*(DO[\s-]?NOT[\s-]?USE|DUPLICATE|OBSOLETE|TEST[\s-]?ONLY)\b.*$/i, "")
    .trim();
  return cleaned || undefined;
}

function assertShape(value: string, pattern: RegExp, what: string): string {
  const v = String(value ?? "").trim();
  if (!pattern.test(v)) throw new Error(`${what} is not in an accepted format`);
  return v;
}

interface Creds {
  baseUrl: string;
  apiKey?: string;
  /** A service bearer held by the integration itself, if one is configured. */
  serviceToken?: string;
  oauth?: { tokenUrl: string; clientId: string; clientSecret: string };
}

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60_000;

async function creds(agentId: string, env: EnvKey): Promise<Creds> {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) throw new Error("NXN integration is not configured for this environment");

  const secret = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  const apiKey = isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey;

  return {
    baseUrl: String(spec.baseUrl).replace(/\/$/, ""),
    apiKey: (apiKey as string) || undefined,
    // A plain stored token is only a service bearer for the token-bearing auth types.
    serviceToken:
      spec.authType === "bearer" || spec.authType === "uaepass_test" ? ((secret as string) || undefined) : undefined,
    oauth:
      spec.oauthTokenUrl && spec.oauthClientId && secret
        ? { tokenUrl: spec.oauthTokenUrl, clientId: spec.oauthClientId, clientSecret: secret as string }
        : undefined,
  };
}

/**
 * The bearer for a GSB read, in precedence order:
 *   1. an OAuth client-credentials token, when GSB credentials are configured;
 *   2. the integration's own stored service token;
 *   3. the caller's bearer — the customer's session, which is what the endpoint
 *      summaries mean by "requires UAE PASS".
 *
 * The MOE endpoints answer 401 to the API key alone (verified against box-stg),
 * so a read with no bearer at all is refused here rather than sent.
 */
async function bearerFor(c: Creds, callerToken?: string): Promise<string> {
  if (c.oauth) {
    if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
    const res = await fetch(c.oauth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: c.oauth.clientId,
        client_secret: c.oauth.clientSecret,
      }).toString(),
    });
    if (!res.ok) throw new Error(`GSB token request failed (HTTP ${res.status})`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("GSB token response had no access_token");
    cached = { token: json.access_token, at: Date.now() };
    return json.access_token;
  }
  const t = c.serviceToken ?? callerToken;
  if (!t) throw new Error("GSB_NO_CREDENTIAL");
  return t;
}

async function get<T>(
  agentId: string,
  env: EnvKey,
  path: string,
  params: Record<string, string>,
  callerToken?: string,
  auth: "bearer" | "api-key-only" = "bearer"
): Promise<T[]> {
  const c = await creds(agentId, env);
  const url = new URL(`${c.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (c.apiKey) headers["X-API-KEY"] = c.apiKey;
  if (auth === "bearer") headers.Authorization = `Bearer ${await bearerFor(c, callerToken)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`GSB ${path} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as { payload?: T[] | T };
  const payload = json?.payload;
  if (payload === undefined || payload === null) return [];
  return Array.isArray(payload) ? payload : [payload];
}

/**
 * The issuing authorities. THE ONLY valid source for that list — never compose one.
 *
 * Served by the GUEST endpoint, which authorises on the environment's X-API-KEY
 * alone — no bearer, no GSB credential. Verified against both box-stg and box:
 * 55 authorities with their codes, English and Arabic names, emirate and
 * free-zone flag. The MOE variant needs a bearer nobody has yet and is kept only
 * as a fallback, so this list does not wait on the GSB credential.
 *
 * (An earlier probe reported this endpoint as 401 on both hosts. That probe was
 * sending the ENCRYPTED api key string — listIntegrations does not decrypt — so
 * it was testing a garbage credential, not the endpoint.)
 */
export async function listIssuingEntities(agentId: string, env: EnvKey, callerToken?: string): Promise<IssuingEntity[]> {
  let rows: Record<string, any>[];
  try {
    rows = await get<Record<string, any>>(agentId, env, "/api/Guest/GetIssuingEntitiesEscher", {}, undefined, "api-key-only");
  } catch (guestErr) {
    try {
      rows = await get<Record<string, any>>(agentId, env, "/api/MOE/GetIssuingEntities", {}, callerToken);
    } catch {
      throw guestErr; // the guest failure is the one worth reporting
    }
  }
  return rows.map((r) => ({
    code: String(r.entCode ?? ""),
    nameEn: cleanEntityName(r.entEn),
    nameAr: cleanEntityName(r.entAr),
    emirateNameEn: r.entEmirateNameEn ?? undefined,
    emirateNameAr: r.entEmirateNameAr ?? undefined,
    isFreeZone: Number(r.entFreezoneFlag ?? 0) === 1,
  }));
}

function toCompany(r: Record<string, any>): GsbCompany {
  return {
    tradeLicenseNo: r.tradeLicenseNo ?? undefined,
    nameEn: r.entityNameEn ?? undefined,
    nameAr: r.entityNameAr ?? undefined,
    emirateCode: r.entityEmirateCode ?? undefined,
    issueDate: r.licenseIssueDate ?? undefined,
    expiryDate: r.licenseExpiryDate ?? undefined,
    issuingEntityCode: r.issueEntityCode ?? undefined,
  };
}

/** Companies registered under one issuing authority. `entityCode` is an AUTHORITY code. */
export async function companiesByAuthority(
  agentId: string,
  env: EnvKey,
  entityCode: string,
  callerToken?: string
): Promise<GsbCompany[]> {
  const code = assertShape(entityCode, ENTITY_CODE, "issuing authority code");
  const rows = await get<Record<string, any>>(agentId, env, "/api/MOE/GetEntitiesById", { entityCode: code }, callerToken);
  return rows.map(toCompany);
}

/**
 * Every company registered against a customer's Emirates ID.
 *
 * Same endpoint as companiesByAuthority — Emirates Post extended entityCode to
 * accept an Emirates ID as well as an issuing-authority code (confirmed on
 * staging 31 Aug: 784199983926421 returns three licences). It is the same
 * parameter carrying two different kinds of identifier, so this exists as its own
 * function to keep the two callers honest about which they are passing.
 *
 * Note it is GetEntitiesById only. GetEntitiesByLicenseNo still wants a real
 * authority code and answers 500 for an Emirates ID.
 */
export async function companiesByEmiratesId(
  agentId: string,
  env: EnvKey,
  emiratesId: string,
  callerToken?: string
): Promise<GsbCompany[]> {
  const eid = normaliseEmiratesId(emiratesId);
  if (!eid) return [];
  const rows = await get<Record<string, any>>(agentId, env, "/api/MOE/GetEntitiesById", { entityCode: eid }, callerToken);
  return rows.map(toCompany);
}

/**
 * One company by trade licence number, with its owners.
 *
 * This is the only call that returns Emirates IDs, and so the only one that can
 * answer "does this customer own this licence" — see `ownerMatch`.
 */
/**
 * The issuing authority's CODE, from whatever the model has to hand.
 *
 * `GetEntitiesByLicenseNo` is keyed on `entityCode` — Dubai Department of
 * Economy & Tourism is `6` — and the customer picks the authority by NAME. The
 * model is asked to carry the code across, and on 5 Sep it did not: licence
 * 697670 came back with no company, the chat told the customer their licence
 * number was wrong, and the same licence with `entityCode=6` returns YI FANG
 * TAIWAN FRUIT TEA L.L.C. immediately.
 *
 * So the code is resolved rather than recalled: a real code is kept, and a name
 * is looked up in the authority list the customer chose from.
 */
export async function resolveIssuingEntityCode(
  agentId: string,
  env: EnvKey,
  given: string,
  callerToken?: string
): Promise<string | null> {
  const raw = String(given ?? "").trim();
  if (!raw) return null;
  let entities: IssuingEntity[] = [];
  try {
    entities = await listIssuingEntities(agentId, env, callerToken);
  } catch {
    // No list means we cannot check; a numeric code is the best we have.
    return ENTITY_CODE.test(raw) ? raw : null;
  }
  if (!entities.length) return ENTITY_CODE.test(raw) ? raw : null;
  const codes = new Set(entities.map((e) => String(e.code)));
  if (codes.has(raw)) return raw;
  // Compared on letters and digits alone: "Dubai Department of Economy &
  // Tourism" and "Dubai Department of Economy and Tourism" are one authority.
  const key = (v: string) => v.toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9&]/g, "");
  const want = key(raw);
  const hit =
    entities.find((e) => key(String(e.nameEn ?? "")) === want) ??
    entities.find((e) => key(String(e.nameAr ?? "")) === want) ??
    entities.find((e) => want.length > 6 && key(String(e.nameEn ?? "")).includes(want));
  return hit ? String(hit.code) : null;
}

export async function companyByLicence(
  agentId: string,
  env: EnvKey,
  entityCode: string,
  licenceNo: string,
  callerToken?: string
): Promise<{ company: GsbCompany; owners: GsbOwner[] } | null> {
  const code = assertShape(entityCode, ENTITY_CODE, "issuing authority code");
  const no = assertShape(licenceNo, LICENCE_NO, "trade licence number");
  const rows = await get<Record<string, any>>(
    agentId, env, "/api/MOE/GetEntitiesByLicenseNo", { entityCode: code, licenseNo: no }, callerToken
  );
  const first = rows[0];
  if (!first?.entityDetails) return null;
  return {
    company: toCompany(first.entityDetails),
    owners: ((first.ownerDetails ?? []) as Record<string, any>[]).map((o) => ({
      nameEn: o.nameEn ?? undefined,
      nameAr: o.nameAr ?? undefined,
      emiratesId: o.emiratesId ?? undefined,
    })),
  };
}

export interface CustomerPoBox {
  boxNumber?: string;
  /**
   * The emirate CODE, which is what every renewal call is keyed on alongside the
   * box number. RetailApp calls it `cityCode`, not `emirateCode` -- see the
   * mapping below, and the bug it caused.
   */
  emirateCode?: string;
  /** The emirate in words, for showing the customer. Never send this to the API. */
  emirateName?: string;
  branch?: string;
  bundleId?: string;
  expiryDate?: string;
  status?: string;
  isOwner?: boolean;
  /**
   * Whose name the box is in. For a CORPORATE box this is the COMPANY, and it is
   * the only place the API says which companies a customer holds boxes for --
   * asked "what companies do I have", we were answering from the licensing
   * registry alone and leaving out the two they had just rented boxes for.
   */
  holderName?: string;
  /** "Personal" or "Corporate". */
  rentType?: string;
}

/**
 * Box status codes, as the portal's own filter endpoint groups them
 * (GetAgencyBoxStatusFilter, read 31 Aug 2026). A corporate box sits at 14 while
 * Emirates Post reviews the trade licence, which is neither active nor a failure
 * -- and a bare "14" told the customer nothing.
 */
const BOX_STATUS: Record<string, string> = {
  "0": "Free", "5": "Free",
  "1": "Active", "10": "Active", "12": "Active", "13": "Active",
  "9": "On hold",
  "14": "Pending approval",
  "15": "Rejected",
};

/**
 * The PO Boxes already held under a customer's Emirates ID.
 *
 * This is the closest thing the API has to "show what they have under their
 * Emirates ID", and it was easy to miss: it lives on the USERS service, is named
 * after a mobile number, and takes EmiratesId as an optional query parameter.
 *
 * It does NOT return companies or trade licences. Searching both specs for every
 * endpoint that accepts an Emirates ID turns up five, and this is the only one
 * that returns anything a customer owns — the rest set it (Account update, agent
 * update) or attach images of it. There is no companies-by-Emirates-ID lookup to
 * find, which is why the corporate flow verifies ownership through a licence
 * number instead of filtering a list by the ID.
 *
 * Protected, like everything else in this tier, so it answers only for a
 * signed-in customer.
 */
export async function poBoxesByEmiratesId(
  agentId: string,
  env: EnvKey,
  emiratesId: string,
  callerToken?: string
): Promise<CustomerPoBox[]> {
  const eid = normaliseEmiratesId(emiratesId);
  if (!eid) throw new Error("Emirates ID is not in an accepted format");
  const c = await creds(agentId, env);
  const url = new URL(`${c.baseUrl.replace(/\/$/, "")}/users/api/v1/PoBoxes/getpoboxesbymobile`);
  url.searchParams.set("EmiratesId", eid);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (c.apiKey) headers["X-API-KEY"] = c.apiKey;
  headers.Authorization = `Bearer ${await bearerFor(c, callerToken)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`GSB PoBoxes/getpoboxesbymobile failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as { payload?: unknown };
  const rows = Array.isArray(json?.payload) ? (json.payload as Record<string, any>[]) : [];
  // RetailApp names the emirate `cityCode` / `cityName` on THIS operation, and
  // `emirateCode` / `emirateName` on the renewal ones. Reading only the latter
  // meant the emirate was undefined for every box, JSON.stringify dropped the key
  // entirely, and the assistant -- given a box number and no emirate -- guessed.
  // It guessed Dubai, and a box that is not in Dubai came back BOX NOT FOUND.
  // Both spellings are read, and the code and the name are kept apart: the code
  // is what the API is keyed on, the name is only ever shown to the customer.
  return mapCustomerPoBoxes(rows);
}

/**
 * Map RetailApp's box rows. Exported so the field names can be tested against
 * their documented payload without a credential -- the emirate went missing
 * precisely because nothing checked the names against the source.
 */
export function mapCustomerPoBoxes(rows: Record<string, any>[]): CustomerPoBox[] {
  return rows.map((r) => ({
    boxNumber: r.boxNumber ?? r.poBoxNumber ?? r.box_No ?? undefined,
    emirateCode: r.cityCode ?? r.emirateCode ?? r.emirate ?? undefined,
    emirateName: r.cityName ?? r.emirateName ?? undefined,
    branch: r.assignedBranchName ?? r.officeName ?? r.branchName ?? undefined,
    bundleId: r.bundleId ?? r.bundle_Id ?? undefined,
    expiryDate: r.expiryDate ?? r.currentExpiryDate ?? undefined,
    status: BOX_STATUS[String(r.status ?? r.boxStatus ?? "")] ?? (r.status ?? r.boxStatus ?? undefined),
    // boxRelation: 0 = Owner, 1 = Agent. An agent cannot renew on their own
    // account, so "who holds this" is not cosmetic.
    isOwner:
      typeof r.isOwner === "boolean"
        ? r.isOwner
        : r.boxRelation === undefined || r.boxRelation === null
          ? undefined
          : Number(r.boxRelation) === 0,
    holderName: r.ownerName ?? r.holderName ?? undefined,
    rentType: r.rentType === "C" ? "Corporate" : r.rentType === "P" ? "Personal" : (r.rentType ?? undefined),
  }));
}
