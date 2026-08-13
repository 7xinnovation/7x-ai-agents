import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

/**
 * Read-only company + Form 9 lookups for EPGL (FB-1268 / FB-1269).
 *
 * Salesforce serves these over the STANDARD query endpoint — `GET /query?q=<SOQL>`
 * — so the caller writes the SOQL. Our agent turns API operations into tools the
 * model calls, and letting a model compose SOQL would mean a prompt injection
 * (via, say, an uploaded document) could read anything the integration user can
 * see. So the statements live HERE as fixed templates and the model only supplies
 * a value, which is validated before it is substituted. The `q` parameter is
 * never exposed as a tool input.
 *
 * Credentials are the EPGL Salesforce integration's own OAuth client-credentials
 * grant — the same org and app as the write contract, so nothing new to provision.
 */

const INTEGRATION_NAME = /epgl.*salesforce/i;
const API_VERSION = "v62.0";

/** Salesforce ids are alphanumeric, 15 or 18 chars. Anything else is not an id. */
const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
/** Licence numbers seen in the org are digits, sometimes with -/ separators. */
const LICENCE_NO = /^[A-Za-z0-9][A-Za-z0-9\-/ ]{0,38}$/;

export interface EpglCompany {
  accountId: string;
  name?: string;
  nameArabic?: string;
  tradeNameEn?: string;
  tradeNameAr?: string;
  tradeLicenseNumber?: string;
  tradeLicenseExpiry?: string;
  emirate?: string;
  regulator?: string;
  postalLicenseNumber?: string;
  /** Plain text, derived from the org's HTML-formula status field. */
  licenseStatus?: string;
  licenseExpiry?: string;
  contacts: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    emiratesId?: string;
    /** Multi-select picklist — ';'-separated in Salesforce, split here. */
    designations: string[];
  }[];
}

export interface EpglForm9Quarter {
  name?: string;
  year?: string;
  quarter?: string;
  status?: string;
  approvalStatus?: string;
  submittedDate?: string;
  /** The licence RECORD id. Renewal finance rows require it and no other
   *  operation returns it (the vendor's own example selects the licence NAME). */
  licenseRecordId?: string;
  licenseName?: string;
  licenseStartDate?: string;
  licenseEndDate?: string;
  postalLicenseNumber?: string;
  totalRevenue?: number;
  leviableRevenue?: number;
  nonLeviableRevenue?: number;
  calculatedLevy?: number;
  dueFees?: number;
  amountPaid?: number;
  payableBalance?: number;
}

/** The org's licence status is a UI formula field: `<img ... alt="Inactive" ...>`. */
export function plainLicenseStatus(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const alt = /alt="([^"]+)"/i.exec(raw);
  if (alt) return alt[1];
  return /<[a-z]/i.test(raw) ? undefined : raw;
}

/** Escape a literal for a SOQL string, after it has been shape-validated. */
function soqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function assertShape(value: string, pattern: RegExp, what: string): string {
  const v = value.trim();
  if (!pattern.test(v)) throw new Error(`${what} is not in an accepted format`);
  return v;
}

interface Creds { baseUrl: string; tokenUrl: string; clientId: string; clientSecret: string }

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60_000;

async function creds(agentId: string, env: EnvKey): Promise<Creds> {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) throw new Error("EPGL Salesforce integration is not configured for this environment");
  const clientSecret = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  if (!spec.oauthClientId || !clientSecret || !spec.oauthTokenUrl) {
    throw new Error("EPGL Salesforce OAuth credentials are incomplete");
  }
  return {
    baseUrl: spec.baseUrl.replace(/\/$/, ""),
    tokenUrl: spec.oauthTokenUrl,
    clientId: spec.oauthClientId,
    clientSecret: clientSecret as string,
  };
}

async function token(c: Creds): Promise<string> {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: c.clientId,
    client_secret: c.clientSecret,
  });
  // Salesforce rejects a `scope` parameter on this grant — do not add one.
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Salesforce token request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Salesforce token response had no access_token");
  cached = { token: json.access_token, at: Date.now() };
  return json.access_token;
}

async function query<T>(agentId: string, env: EnvKey, soql: string): Promise<T[]> {
  const c = await creds(agentId, env);
  const run = async (bearer: string) =>
    fetch(`${c.baseUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    });
  let res = await run(await token(c));
  if (res.status === 401) {
    cached = null; // token revoked or expired early — mint once more
    res = await run(await token(c));
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Salesforce query failed (HTTP ${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { records?: T[] };
  return json.records ?? [];
}

const COMPANY_FIELDS =
  "Id, Name, EPG_Company_Name_Arabic__c, EPG_Trade_Name_in_English__c, EPG_Trade_Name_in_Arabic__c, " +
  "EPG_Trade_license_no__c, EPG_Trade_license_Expiry_date__c, EPG_Emirates__c, EPG_Regulator__c, " +
  "EPG_License_Number__c, EPG_License_Status__c, EPG_License_Expiry_Date__c, " +
  "(SELECT FirstName, LastName, Email, Phone, EPG_Emirates_Id__c, EPG_Designation__c FROM Contacts)";

function toCompany(r: Record<string, any>): EpglCompany {
  return {
    accountId: r.Id,
    name: r.Name ?? undefined,
    nameArabic: r.EPG_Company_Name_Arabic__c ?? undefined,
    tradeNameEn: r.EPG_Trade_Name_in_English__c ?? undefined,
    tradeNameAr: r.EPG_Trade_Name_in_Arabic__c ?? undefined,
    tradeLicenseNumber: r.EPG_Trade_license_no__c ?? undefined,
    tradeLicenseExpiry: r.EPG_Trade_license_Expiry_date__c ?? undefined,
    emirate: r.EPG_Emirates__c ?? undefined,
    regulator: r.EPG_Regulator__c ?? undefined,
    postalLicenseNumber: r.EPG_License_Number__c ?? undefined,
    licenseStatus: plainLicenseStatus(r.EPG_License_Status__c),
    licenseExpiry: r.EPG_License_Expiry_Date__c ?? undefined,
    contacts: ((r.Contacts?.records ?? []) as Record<string, any>[]).map((c) => ({
      firstName: c.FirstName ?? undefined,
      lastName: c.LastName ?? undefined,
      email: c.Email ?? undefined,
      phone: c.Phone ?? undefined,
      emiratesId: c.EPG_Emirates_Id__c ?? undefined,
      designations: String(c.EPG_Designation__c ?? "").split(";").map((s) => s.trim()).filter(Boolean),
    })),
  };
}

/**
 * Company profile by trade licence number.
 *
 * NOTE: a licence number can match MORE THAN ONE Account — branches carry the
 * same number as their parent (the vendor's own Form 9 notes say a filing is
 * always against the main licensed company, never a branch). Their
 * AccountByLicense Apex resource applies that rule, but our integration user is
 * not granted that class yet (403), so every match is returned and the caller
 * must not silently assume the first one.
 */
export async function companyByTradeLicense(
  agentId: string,
  env: EnvKey,
  tradeLicenseNumber: string
): Promise<EpglCompany[]> {
  const v = soqlLiteral(assertShape(tradeLicenseNumber, LICENCE_NO, "trade licence number"));
  const rows = await query<Record<string, any>>(
    agentId, env,
    `SELECT ${COMPANY_FIELDS} FROM Account WHERE EPG_Trade_license_no__c = '${v}'`
  );
  return rows.map(toCompany);
}

/** Company profile by Salesforce Account id. */
export async function companyByAccountId(
  agentId: string,
  env: EnvKey,
  accountId: string
): Promise<EpglCompany | null> {
  const v = soqlLiteral(assertShape(accountId, SF_ID, "account id"));
  const rows = await query<Record<string, any>>(
    agentId, env,
    `SELECT ${COMPANY_FIELDS} FROM Account WHERE Id = '${v}'`
  );
  return rows.length ? toCompany(rows[0]!) : null;
}

/**
 * Quarterly Form 9 submissions for a company, newest first.
 *
 * Form 9 is what IDEP files into Salesforce each quarter, so these ARE the
 * quarterly figures FB-1269 asked for. `EPG_License__c` is selected deliberately:
 * it is the licence record id the renewal finance rows require, and the vendor's
 * example query omits it in favour of the licence name.
 */
export async function form9ByAccountId(
  agentId: string,
  env: EnvKey,
  accountId: string,
  limit = 12
): Promise<EpglForm9Quarter[]> {
  const v = soqlLiteral(assertShape(accountId, SF_ID, "account id"));
  const n = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const rows = await query<Record<string, any>>(
    agentId, env,
    "SELECT Id, Name, EPG_Year__c, Quarter__c, EPG_Status__c, EPG_Approval_Status__c, EPG_Submitted_Date__c, " +
    "EPG_License__c, EPG_License__r.Name, EPG_License_Start_Date__c, EPG_License_End_Date__c, " +
    "EPG_Postal_License_Number__c, EPG_Total_Revenue__c, EPG_Total_Revenue_for_Leviable_Services__c, " +
    "Total_Revenue_for_Non_Leviable_Services__c, EPG_Calculated_Levy_Amount__c, " +
    "EPG_Due_Fees_for_the_period__c, EPG_Amount_Paid__c, Payable_Balance_For_Customer__c " +
    `FROM EPG_Form_9__c WHERE EPG_Company_Name__c = '${v}' ` +
    `ORDER BY EPG_Year__c DESC, Quarter__c DESC LIMIT ${n}`
  );
  return rows.map((r) => ({
    name: r.Name ?? undefined,
    year: r.EPG_Year__c ?? undefined,
    quarter: r.Quarter__c ?? undefined,
    status: r.EPG_Status__c ?? undefined,
    approvalStatus: r.EPG_Approval_Status__c ?? undefined,
    submittedDate: r.EPG_Submitted_Date__c ?? undefined,
    licenseRecordId: r.EPG_License__c ?? undefined,
    licenseName: r.EPG_License__r?.Name ?? undefined,
    licenseStartDate: r.EPG_License_Start_Date__c ?? undefined,
    licenseEndDate: r.EPG_License_End_Date__c ?? undefined,
    postalLicenseNumber: r.EPG_Postal_License_Number__c ?? undefined,
    totalRevenue: r.EPG_Total_Revenue__c ?? undefined,
    leviableRevenue: r.EPG_Total_Revenue_for_Leviable_Services__c ?? undefined,
    nonLeviableRevenue: r.Total_Revenue_for_Non_Leviable_Services__c ?? undefined,
    calculatedLevy: r.EPG_Calculated_Levy_Amount__c ?? undefined,
    dueFees: r.EPG_Due_Fees_for_the_period__c ?? undefined,
    amountPaid: r.EPG_Amount_Paid__c ?? undefined,
    payableBalance: r.Payable_Balance_For_Customer__c ?? undefined,
  }));
}
