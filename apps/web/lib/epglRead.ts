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
  /**
   * The licence RECORD id (Account.EPG_License__c) — NOT the printed licence
   * number. A renewal's finance rows need this in EPG_License_No__c, which is an
   * id-type lookup: sending the number is rejected with "id value of incorrect
   * type", which is what blocked renewal submissions.
   */
  licenseRecordId?: string;
  /** Plain text, derived from the org's HTML-formula status field. */
  licenseStatus?: string;
  licenseExpiry?: string;
  /**
   * WHAT A RENEWAL WILL COST, READ RATHER THAN CALCULATED.
   *
   * EPGL's renewal process map has a step reading "System calculates renewal
   * fees and penalties if any". We do not calculate any of it — Salesforce
   * already holds every figure as a rollup, and computing a penalty ourselves
   * would be inventing a number the regulator is the authority on. These are
   * read straight off the Account and its licence record:
   *
   *   licenceAmount       Account.EPG_License_Amount__c        the licence fee on file
   *   advanceBalance      Account.EPG_Balance_License_Amount__c what an advance payment still covers
   *   pendingPenalties    Account.EPG_Pending_Penalties__c     "Due Amount (Penalties/Fines)"
   *   pendingFines        Account.EPG_Pending_Fines__c
   *   totalPenalties      EPG_License__r.Total_Penalty_Amount__c
   *   form9Penalties      EPG_License__r.EPG_Form_9_penalty_charges__c   non-submission
   *   renewalPenalty      EPG_License__r.Total_License_Renewal_Penalty__c  late renewal
   *   nonCompliance       EPG_License__r.Total_Non_Compliance_Penalties__c
   *   totalDue            EPG_License__r.EPG_Pending_Amount_Including_Penalties__c
   *   totalLevy           EPG_License__r.EPG_Total_Levy_Amount__c
   *
   * All of them are currency rollups and all of them are populated in their org
   * — measured on 15 September, e.g. CIAO DELIVERY SERVICES carrying 18,000 in
   * Form 9 non-submission penalties against a 100,000 licence amount.
   *
   * These are for the AGENT to state, never to add up. The payable figure is the
   * one EPGL put in the payment request after the document review.
   */
  fees?: {
    licenceAmount?: number;
    advanceBalance?: number;
    pendingPenalties?: number;
    pendingFines?: number;
    totalPenalties?: number;
    form9Penalties?: number;
    renewalPenalty?: number;
    nonCompliance?: number;
    totalDue?: number;
    totalLevy?: number;
  };
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

/**
 * What EPGL's records say is OUTSTANDING against a licence, in words.
 *
 * The figures arrive as ten currency rollups with names only Salesforce loves,
 * and handing a model ten numbers and hoping is how "your total is 121,700"
 * gets said to somebody. So the numbers are turned into a statement of fact
 * here, with the arithmetic deliberately NOT done: the agent may say what is
 * outstanding and what each amount is for, and may not total it or present it
 * as the amount to pay.
 *
 * That restraint is EPGL's, not caution for its own sake. A penalty in their org
 * carries an approval state — EPG_Penalty_Status__c, EPG_Is_CEO_Approved__c, a
 * legal-action flag — and some sit in Draft. The payable figure is the one
 * Licensing put in the payment request they issue after the document review, and
 * it is the only one that has been through that.
 *
 * Returns null when nothing is outstanding, so a clean licence produces no
 * paragraph at all rather than a row of zeroes.
 */
export function outstandingSummary(fees: EpglCompany["fees"]): string | null {
  if (!fees) return null;
  const lines: string[] = [];
  const add = (label: string, v: number | undefined) => {
    if (typeof v === "number" && v > 0) lines.push(`${label}: AED ${v.toLocaleString("en-AE")}`);
  };
  add("Form 9 non-submission penalties", fees.form9Penalties);
  add("Late renewal penalty", fees.renewalPenalty);
  add("Non-compliance penalties", fees.nonCompliance);
  add("Pending fines", fees.pendingFines);
  // The rollups overlap — the account-level total is only worth saying when the
  // itemised lines did not already account for it.
  if (!lines.length) add("Penalties and fines outstanding", fees.pendingPenalties);
  add("Total due on the licence, EPGL's figure", fees.totalDue);
  if (!lines.length) return null;
  return (
    "OUTSTANDING ON THIS LICENCE, from EPGL's own records:\n" +
    lines.map((l) => `  - ${l}`).join("\n") +
    "\nTELL THE CUSTOMER THIS BEFORE THEY PAY, plainly, as EPGL's record rather than as your own calculation, and say what each amount is for. " +
    "Do NOT add these together, do NOT add them to the licence fee, and do NOT present any figure as the amount they must pay: penalties carry an approval state in EPGL's system and some are not yet approved. " +
    "The payable total is the one EPGL state in the payment request they issue after the document review — say so. " +
    "If the customer asks you to work out a total, explain that EPGL confirm the exact amount and you do not want to quote them a figure that turns out to be wrong."
  );
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

/**
 * The licence status, as a word.
 *
 * TWO FIELDS, ONE SOURCE. Account.License_Status__c and
 * Account.EPG_License_Status__c are both formulas over
 * EPG_License__r.License_status__c; the second is built for the Salesforce UI
 * and returns markup. EPGL named the right one in contract 2.0.0 on
 * 15 September, and a look at their org says it matters more than "returns
 * HTML" suggests — a CANCELLED licence comes back as
 *
 *   <img src="/resource/InactiveLicense" alt="Inactive" .../> Cancelled
 *
 * so reading the alt text, which is what this did, reported a cancelled licence
 * as merely inactive. We now select License_Status__c, which says "Cancelled".
 *
 * The HTML path stays as the fallback: it is the older field, it is what four
 * weeks of this agent read, and stripping it is still better than showing
 * someone an <img> tag.
 */
export function plainLicenseStatus(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  if (!/<[a-z]/i.test(raw)) return raw.trim() || undefined;
  // The word is the text BESIDE the icon, not the icon's alt: the alt says
  // "Inactive" on a cancelled licence, which is how this used to lose the
  // difference between the two.
  const text = raw.replace(/<[^>]*>/g, " ").replace(/&nbsp;?/gi, " ").replace(/\s+/g, " ").trim();
  if (text) return text;
  const alt = /alt="([^"]+)"/i.exec(raw);
  return alt ? alt[1] : undefined;
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
  "EPG_License_Number__c, EPG_License__c, License_Status__c, EPG_License_Expiry_Date__c, " +
  // What a renewal costs and what is outstanding — read, never calculated.
  "EPG_License_Amount__c, EPG_Balance_License_Amount__c, EPG_Pending_Penalties__c, EPG_Pending_Fines__c, " +
  "EPG_License__r.Total_Penalty_Amount__c, EPG_License__r.EPG_Form_9_penalty_charges__c, " +
  "EPG_License__r.Total_License_Renewal_Penalty__c, EPG_License__r.Total_Non_Compliance_Penalties__c, " +
  "EPG_License__r.EPG_Pending_Amount_Including_Penalties__c, EPG_License__r.EPG_Total_Levy_Amount__c, " +
  "(SELECT FirstName, LastName, Email, Phone, EPG_Emirates_Id__c, LegalEntity_Profile_Person_EmiratesID__c, EPG_Designation__c FROM Contacts)";

/**
 * Keep the figures that are actually figures.
 *
 * A null rollup and a zero rollup mean different things — "no penalty record"
 * against "nothing outstanding" — and only the second is worth saying out loud.
 * Nulls are dropped; an all-null set becomes undefined, so a company with no
 * financial record carries no `fees` at all rather than a shape full of blanks.
 */
function money(raw: Record<string, unknown>): EpglCompany["fees"] {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? (out as EpglCompany["fees"]) : undefined;
}

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
    licenseRecordId: r.EPG_License__c ?? undefined,
    licenseStatus: plainLicenseStatus(r.License_Status__c ?? r.EPG_License_Status__c),
    licenseExpiry: r.EPG_License_Expiry_Date__c ?? undefined,
    fees: money({
      licenceAmount: r.EPG_License_Amount__c,
      advanceBalance: r.EPG_Balance_License_Amount__c,
      pendingPenalties: r.EPG_Pending_Penalties__c,
      pendingFines: r.EPG_Pending_Fines__c,
      totalPenalties: r.EPG_License__r?.Total_Penalty_Amount__c,
      form9Penalties: r.EPG_License__r?.EPG_Form_9_penalty_charges__c,
      renewalPenalty: r.EPG_License__r?.Total_License_Renewal_Penalty__c,
      nonCompliance: r.EPG_License__r?.Total_Non_Compliance_Penalties__c,
      totalDue: r.EPG_License__r?.EPG_Pending_Amount_Including_Penalties__c,
      totalLevy: r.EPG_License__r?.EPG_Total_Levy_Amount__c,
    }),
    contacts: ((r.Contacts?.records ?? []) as Record<string, any>[]).map((c) => ({
      firstName: c.FirstName ?? undefined,
      lastName: c.LastName ?? undefined,
      email: c.Email ?? undefined,
      phone: c.Phone ?? undefined,
      emiratesId: c.EPG_Emirates_Id__c ?? c.LegalEntity_Profile_Person_EmiratesID__c ?? undefined,
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

/**
 * Company profile for the person signed in, found by their Emirates ID.
 *
 * Salesforce confirmed the gap and the field: "sign-in gives us the customer's
 * Emirates ID rather than a trade license number, so we can't yet identify the
 * company from the signed-in user. Contacts already carry EPG_Emirates_ID__c."
 * That last sentence is what makes this buildable without waiting — the field is
 * already there, so the join is ours to write.
 *
 * Matched through Contact rather than Account, because the Emirates ID belongs to
 * a PERSON: the same individual can appear on several companies, so this returns
 * every Account they are a contact on and the caller must let them choose rather
 * than assume the first.
 *
 * Both spellings are queried. An Emirates ID is written 784-YYYY-NNNNNNN-C by
 * people and often stored as 15 bare digits, and matching only the form the
 * customer happened to sign in with would report "no company" for a customer
 * whose record is perfectly good.
 */
export async function companyByEmiratesId(
  agentId: string,
  env: EnvKey,
  emiratesId: string
): Promise<EpglCompany[]> {
  const digits = String(emiratesId ?? "").replace(/\D/g, "");
  if (!/^\d{15}$/.test(digits)) throw new Error("Emirates ID is not in an accepted format");
  const dashed = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
  const rows = await query<Record<string, any>>(
    agentId, env,
    `SELECT ${COMPANY_FIELDS} FROM Account WHERE Id IN ` +
      `(SELECT AccountId FROM Contact WHERE EPG_Emirates_Id__c IN ('${soqlLiteral(digits)}', '${soqlLiteral(dashed)}'))`
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
