import type Anthropic from "@anthropic-ai/sdk";
import { getDb, agentIntegrations } from "@dialog/db";
import { and, eq, desc } from "drizzle-orm";
import type { ApiOperation } from "./openapi";
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto";
import { redactGuestPII } from "./pii";
import { simulateNxnMockOp, stagingTestBoxNumbers } from "./mockPersona";
import { audit } from "./conversation";
import { regionsFor, exactRegion, searchRegions } from "./epRegions";
import { parseHours, openNow } from "./branchHours";
import { prepareBranches, poBoxHallNotice, type BranchRow } from "./branchList";
import { rentalTotal, bundlePeriods, describePeriods, periodSavings, describeSavings, registrationFee, type BundlePeriod } from "./rentalTotal";
import { registrationFees, observedRents, observedServices, rememberFees, feesInSelectResponse, rentInSelectResponse, rentKey } from "./registrationFees";
import { gatewayOrderState } from "./gatewayOrder";
import { renewalChoices, upgradesAmong, describeBundle, type RenewalBundle } from "./renewalBundles";

export type EnvKey = "staging" | "production";

export type AuthType = "none" | "bearer" | "apiKey" | "uaepass_test" | "uaepass_live" | "oauth2_cc";

export interface EnvSpec {
  specUrl: string;
  baseUrl: string;
  // uaepass_test: use the stored token (authValue) as the session bearer.
  // uaepass_live: use the UAE PASS session token forwarded by the embedding site.
  // oauth2_cc: OAuth2 client-credentials (e.g. Salesforce External Client App) —
  //   authValue holds the client SECRET (encrypted); oauthClientId/oauthTokenUrl
  //   below complete the grant. Tokens are fetched + cached server-side.
  authType: AuthType;
  authValue: string | null;
  authHeader: string | null;
  // OAuth2 client-credentials fields (authType "oauth2_cc" only).
  oauthClientId?: string | null;
  oauthTokenUrl?: string | null;
  // Gateway/app API key sent on EVERY request (e.g. NXN guest APIs require an
  // X-API-KEY header). Independent of the per-user session above; both can apply.
  apiKey?: string | null;
  apiKeyHeader?: string | null; // defaults to "X-API-KEY"
  operations: ApiOperation[];
}

export interface IntegrationRow {
  id: string;
  name: string;
  enabled: boolean;
  environments: Partial<Record<EnvKey, EnvSpec>>;
}

export async function listIntegrations(agentId: string): Promise<IntegrationRow[]> {
  const rows = await getDb()
    .select()
    .from(agentIntegrations)
    .where(eq(agentIntegrations.agentId, agentId))
    .orderBy(desc(agentIntegrations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    environments: (r.environments ?? {}) as Partial<Record<EnvKey, EnvSpec>>,
  }));
}

/** Mask an integration's stored secrets before sending to the admin UI (never leak tokens). */
export function maskIntegrations(rows: IntegrationRow[]): IntegrationRow[] {
  return rows.map((r) => ({
    ...r,
    environments: Object.fromEntries(
      Object.entries(r.environments).map(([k, spec]) => [
        k,
        spec ? { ...spec, authValue: spec.authValue ? "••••••••" : null } : spec,
      ])
    ) as IntegrationRow["environments"],
  }));
}

/** Add or replace one environment's spec on an integration (matched by name). */
export async function upsertEnvironment(agentId: string, name: string, env: EnvKey, spec: EnvSpec) {
  const db = getDb();
  const existing = (await listIntegrations(agentId)).find((i) => i.name.toLowerCase() === name.toLowerCase());
  // Encrypt secrets at rest (PRD: encryption at rest for integration tokens).
  // A masked placeholder means "keep the existing secret" (admin re-save).
  const prev = existing?.environments[env];
  const authValue = spec.authValue === "••••••••" ? (prev?.authValue ?? null) : encryptSecret(spec.authValue);
  const apiKey = spec.apiKey === "••••••••" ? (prev?.apiKey ?? null) : encryptSecret(spec.apiKey);
  spec = { ...spec, authValue, apiKey };
  if (existing) {
    const environments = { ...existing.environments, [env]: spec };
    await db.update(agentIntegrations).set({ environments }).where(eq(agentIntegrations.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(agentIntegrations)
    .values({ agentId, name, environments: { [env]: spec }, enabled: true })
    .returning();
  return row!.id;
}

export async function setIntegrationEnabled(agentId: string, id: string, enabled: boolean) {
  await getDb().update(agentIntegrations).set({ enabled }).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

export async function deleteIntegration(agentId: string, id: string) {
  await getDb().delete(agentIntegrations).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

/** Remove a single environment from an integration (deletes the integration if none left). */
export async function deleteEnvironment(agentId: string, id: string, env: EnvKey) {
  const it = (await listIntegrations(agentId)).find((i) => i.id === id);
  if (!it) return;
  const environments = { ...it.environments };
  delete environments[env];
  if (Object.keys(environments).length === 0) return deleteIntegration(agentId, id);
  await getDb().update(agentIntegrations).set({ environments }).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

const prefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

/**
 * Did a box-availability response actually carry any box numbers? Used to decide
 * whether the staging test set is needed — so a working upstream response (even a
 * shape we do not fully parse) always wins over the fallback.
 */
function hasBoxNumbers(result: string): boolean {
  const body = result.slice(result.indexOf("\n") + 1);
  if (!/^HTTP 2/.test(result)) return false;
  try {
    const json = JSON.parse(body);
    let found = false;
    const walk = (v: unknown, depth: number) => {
      if (found || depth > 5 || v === null) return;
      if (Array.isArray(v)) {
        // A non-empty array of box-shaped entries (or bare numbers) counts.
        if (v.length && v.some((x) => typeof x === "string" || typeof x === "number" || (x && typeof x === "object"))) found = true;
        for (const x of v) walk(x, depth + 1);
        return;
      }
      if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    };
    // Only look under keys that would hold the list, so an error envelope with a
    // populated "errors" array is not mistaken for availability.
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (/^(payload|data|result|freeboxes|availableboxnumbers|boxes)$/i.test(k)) walk(v, 0);
    }
    return found;
  } catch {
    return false;
  }
}

/**
 * Login/token operations are callable WITHOUT an existing session — they are how
 * a session is obtained (e.g. UAE PASS-independent OTP: passwordLessToken →
 * verifyPasswordLessToken). Everything else is "protected" and needs a session.
 */
function isAuthOperation(op: ApiOperation): boolean {
  return /(^|\/)(token|login|sign-?in|authenticate|auth|otp|passwordless)/i.test(op.path) || /token|login|otp|passwordless/i.test(op.toolName);
}

/** Best-effort extraction of a session/bearer token from a JSON response body. */
export function extractSessionToken(body: string): string | null {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return null; }
  const KEY = /(access_?token|session_?token|id_?token|auth_?token|bearer|^token$|jwt)/i;
  let found: string | null = null;
  const walk = (v: unknown, depth: number) => {
    if (found || depth > 4 || v === null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (found) return;
      if (typeof val === "string" && KEY.test(k) && val.length >= 20) { found = val; return; }
      if (typeof val === "object") walk(val, depth + 1);
    }
  };
  walk(json, 0);
  return found;
}

/**
 * Build Claude tools + executor for the agent's ACTIVE environment. Each enabled
 * integration that has a spec for `activeEnv` contributes its operations.
 *
 * Session tokens (auth). These are NOT interchangeable (FB-1485):
 *  - `sessionToken`  : a BACKEND session for THIS conversation (e.g. minted by the
 *                      OTP/passwordless flow on a previous turn). Valid bearer for
 *                      any token-auth integration.
 *  - captured at runtime: if a login op returns a backend token mid-turn, it is
 *                      captured and reused for subsequent protected calls;
 *                      `getCapturedToken()` lets the caller persist it.
 *  - `uaePassToken`  : a UAE PASS OIDC access token. It proves IDENTITY, it is not a
 *                      backend API session, so it is only sent to integrations that
 *                      declare authType "uaepass_live". Sending it to an integration
 *                      holding its own service token (authType "uaepass_test") made
 *                      every Emirates Post call 401 and the agent then asked an
 *                      already-signed-in customer to sign in again.
 */
/**
 * One key for a company, whichever way it is named.
 *
 * The model rewrites a licence number ("CN-1234567" / "CN 1234567") and a company
 * name ("PRINCIPLE EXPRESS CARGO L.L.C" / "Principle Express Cargo LLC") on the
 * way through, so the two sides of this comparison are flattened to letters and
 * digits before they meet.
 */
/**
 * A request body fit to keep.
 *
 * An upload carries a base64 file -- megabytes of it -- and there is nothing to
 * learn from the bytes, only from the fact and the name. Anything long enough to
 * be a document is replaced by its size.
 */
function auditableInput(input: unknown): unknown {
  const MAX = 400;
  const walk = (v: unknown, depth = 0): unknown => {
    if (depth > 6) return "…";
    if (typeof v === "string") return v.length > MAX ? `<${v.length} chars omitted>` : v;
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, depth + 1);
      return out;
    }
    return v;
  };
  return walk(input ?? {});
}

/**
 * The box halls in a conversation's branch list, remembered across turns.
 *
 * The list is fetched in the turn the branches are shown; the customer picks one
 * in the NEXT turn, by which time the annotated rows are long gone. That is why
 * the hall notice never appeared for Naif: nothing that could recognise a hall
 * still existed at the moment one was chosen. So the halls outlive their turn.
 */
/**
 * How long a customer needs before "have you paid?" is a fair question.
 *
 * Measured, not chosen: today's settled payments were confirmed after the
 * customer had finished, and every "not paid" answer came from a check made
 * 26-57 seconds after the order was created -- while they were still typing.
 */
const PAYMENT_SETTLE_GRACE_MS = 75_000;

/** How many times we have asked about one order's payment, so the answer stops repeating. */
const paymentChecks = new Map<string, number>();

/**
 * The rental end dates Emirates Post offered, remembered across turns.
 *
 * Same shape as the halls: the durations are fetched in one turn and the box is
 * reserved in a later one, so by the time the term matters the list is gone —
 * and the correction that exists to reserve the right term had nothing to
 * correct against. 15:53: a two-year choice reserved for one year, again.
 */
const expiryMemory = new Map<string, { at: number; byBundle: Record<string, string[]> }>();
/** The published term prices per bundle, for the turn the durations are shown in. */
const priceBookMemory = new Map<string, { at: number; byBundle: Record<string, BundlePeriod[]> }>();

function rememberPriceBook(conversationId: string | undefined, book: Map<string, BundlePeriod[]>) {
  if (!conversationId || !book.size) return;
  if (priceBookMemory.size > 500) for (const [k, v] of priceBookMemory) if (Date.now() - v.at > HALL_TTL_MS) priceBookMemory.delete(k);
  priceBookMemory.set(conversationId, { at: Date.now(), byBundle: Object.fromEntries(book) });
}

function recallPriceBook(conversationId: string | undefined): Map<string, BundlePeriod[]> {
  if (!conversationId) return new Map();
  const hit = priceBookMemory.get(conversationId);
  if (!hit || Date.now() - hit.at > HALL_TTL_MS) return new Map();
  return new Map(Object.entries(hit.byBundle));
}

function rememberExpiryDates(conversationId: string | undefined, byBundle: Map<string, string[]>) {
  if (!conversationId || !byBundle.size) return;
  if (expiryMemory.size > 500) for (const [k, v] of expiryMemory) if (Date.now() - v.at > HALL_TTL_MS) expiryMemory.delete(k);
  expiryMemory.set(conversationId, { at: Date.now(), byBundle: Object.fromEntries(byBundle) });
}

function recallExpiryDates(conversationId: string | undefined): Map<string, string[]> {
  if (!conversationId) return new Map();
  const hit = expiryMemory.get(conversationId);
  if (!hit || Date.now() - hit.at > HALL_TTL_MS) return new Map();
  return new Map(Object.entries(hit.byBundle));
}

/**
 * Branch name to officeId, remembered across turns.
 *
 * `myHomeProfile.deliveryOfficeID` is the branch the customer picked, and the
 * only place we ever learned it was a FreeBoxes call made with a numeric
 * officeId. Teaching the model to ask for MyHome boxes by EMIRATE — which is
 * correct, and is what makes the boxes appear at all — removed that. 6 Sep: a
 * MyHome save went out with no deliveryOfficeID and Emirates Post answered 173
 * MYHOME_ADDDRESS_NOT_FOUND, which names the address and not the missing field.
 *
 * The branch list carries both, so it is read from there instead.
 */
const branchDirectory = new Map<string, { at: number; byName: Record<string, string> }>();

function rememberBranches(conversationId: string | undefined, rows: { officeId?: unknown; nameEn?: unknown }[]) {
  if (!conversationId || !rows.length) return;
  const cur = branchDirectory.get(conversationId)?.byName ?? {};
  for (const r of rows) {
    const id = String(r.officeId ?? "").trim();
    const name = String(r.nameEn ?? "").trim();
    if (id && name) cur[name.toLowerCase()] = id;
  }
  if (branchDirectory.size > 500) for (const [k, v] of branchDirectory) if (Date.now() - v.at > HALL_TTL_MS) branchDirectory.delete(k);
  branchDirectory.set(conversationId, { at: Date.now(), byName: cur });
}

/** The officeId for a branch the customer named, however they cased it. */
function officeIdForBranch(conversationId: string | undefined, branch: string | null | undefined): string | null {
  const name = String(branch ?? "").trim().toLowerCase();
  if (!conversationId || !name) return null;
  const hit = branchDirectory.get(conversationId);
  if (!hit || Date.now() - hit.at > HALL_TTL_MS) return null;
  if (hit.byName[name]) return hit.byName[name]!;
  // "Al Barsha" for "Al Barsha Post Office" — the customer rarely types the suffix.
  const found = Object.entries(hit.byName).find(([k]) => k.startsWith(name) || name.startsWith(k));
  return found ? found[1] : null;
}

const hallMemory = new Map<string, { at: number; halls: { officeId: string; name: string; alternative: string }[] }>();
const HALL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The upgrades a renewal may offer, by bundle id.
 *
 * Renewing is the moment a customer is already thinking about the box, so it is
 * the moment to ask whether they want a better one — Emirates Post asked for the
 * MyHome customer to be offered MyHome Instant at that point, and their own
 * backend supports it: Renewal/Pricing takes a `newBundleId` with
 * `isBundleChanged: true` and prices the new bundle for the same term.
 *
 * Only moves Emirates Post has confirmed belong here. MyBox to MyHome is not one
 * of them: it turns a box collected at a branch into one delivered to a door,
 * which needs an address and a delivery office, and a renewal has neither.
 */
const RENEWAL_UPGRADES: Record<string, string> = { MYHOME3: "MYHOMEF" };

function rememberHalls(conversationId: string | undefined, halls: { officeId: string; name: string; alternative: string }[]) {
  if (!conversationId) return;
  if (hallMemory.size > 500) for (const [k, v] of hallMemory) if (Date.now() - v.at > HALL_TTL_MS) hallMemory.delete(k);
  hallMemory.set(conversationId, { at: Date.now(), halls });
}

function recallHalls(conversationId: string | undefined) {
  if (!conversationId) return [];
  const hit = hallMemory.get(conversationId);
  if (!hit || Date.now() - hit.at > HALL_TTL_MS) return [];
  return hit.halls;
}

/**
 * How many years is a recorded duration? `2_YEAR`, "2 years", "24 months", "2".
 * Anything unreadable returns null, and the model's own date is left alone.
 */
export function durationYears(duration: string | null | undefined): number | null {
  const t = String(duration ?? "").trim().toLowerCase();
  if (!t) return null;
  const months = /(\d+)\s*_?\s*month/.exec(t);
  if (months) {
    const m = Number(months[1]);
    return Number.isFinite(m) && m > 0 && m % 12 === 0 ? m / 12 : null;
  }
  const n = /(\d+)/.exec(t);
  if (!n) return null;
  const v = Number(n[1]);
  return Number.isFinite(v) && v > 0 && v <= 20 ? v : null;
}

/**
 * The offered date that is `years` away, copied verbatim.
 *
 * Emirates Post offers 1, 2, 3, 5 and 10 years as absolute dates, and the string
 * must go back exactly as it came — recomputing one returns "Invalid date value".
 * Matched by the YEAR it lands in rather than by position, so a list that offers
 * a different set still resolves correctly, and an unmatched year returns null.
 */
export function dateForYears(dates: string[], years: number): string | null {
  const now = new Date();
  for (const d of dates) {
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) continue;
    // Whole years between today and that date, rounded to the nearest year: the
    // dates sit on the anniversary, so this is exact in practice.
    const diff = (t.getTime() - now.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
    if (Math.round(diff) === years) return d;
  }
  return null;
}

/** The reservation tool in a tool map, which scopes what we have observed. */
function selectToolFor(map: Map<string, unknown>): string | undefined {
  return [...map.keys()].find((t) => /rental_select$/i.test(t));
}

/** Whole years from today to an offered expiry date, or null if it is not readable. */
export function yearsUntil(date: string, now: Date = new Date()): number | null {
  const t = new Date(date);
  if (Number.isNaN(t.getTime())) return null;
  const years = Math.round((t.getTime() - now.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
  return years >= 1 && years <= 20 ? years : null;
}

/** A priced line from Rental/Select, by service and (optionally) criteria. */
function priceOf(details: unknown, serviceType: string, criteria?: string): number | null {
  if (!Array.isArray(details)) return null;
  const row = details.find((d: Record<string, unknown>) => {
    if (String(d?.serviceType ?? "").toUpperCase() !== serviceType.toUpperCase()) return false;
    if (!criteria) return true;
    return String(d?.serviceCriteria ?? "").toUpperCase() === criteria.toUpperCase();
  }) as Record<string, unknown> | undefined;
  return typeof row?.totalAmount === "number" ? row.totalAmount : null;
}

export interface EpglDocumentRow {
  key: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  fileId: string;
}

/**
 * Add a placeholder record to the EPGL composite for every uploaded file.
 *
 * Salesforce tracks an application's documents as EPG_Document__c rows -- one
 * per file -- and the Documents panel on the licence request lists THOSE, not
 * the files. Upload a file with no placeholder and it lands on the record while
 * the panel stays empty, which is exactly what LR-37176 and LR-37177 looked
 * like: both uploads returned 201, and both applications appeared to have no
 * documents. Their own spec shows the shape; the model was told to send it and
 * omitted it twice, so it is built here where it cannot be forgotten.
 */
export function withEpglDocumentPlaceholders(
  input: Record<string, unknown> | undefined,
  docs: EpglDocumentRow[]
): Record<string, unknown> | undefined {
  if (!docs.length) return input;
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  const items = Array.isArray(body.compositeRequest)
    ? [...(body.compositeRequest as Record<string, unknown>[])]
    : [];
  if (!items.length) return input;
  // A composite that already carries documents is the model's to own.
  if (items.some((i) => /EPG_Document__c/i.test(String(i?.url ?? "")))) return input;
  const accountItem = items.find((i) => /sobjects\/Account$/i.test(String(i?.url ?? "")));
  if (!accountItem) return input;

  const accountRef = String(accountItem.referenceId ?? "NewAccount");
  const docItem = {
    method: "POST",
    referenceId: "NewDocument",
    url: "/services/data/v66.0/sobjects/EPG_Document__c",
    body: docs.map((d) => ({
      EPG_Company__c: `@{${accountRef}.id}`,
      EPG_File_Name__c: d.fileName,
      docType__c: d.fileType,
      fileType__c: d.fileType,
      EPG_File_Id__c: d.fileId,
      fileSize__c: d.sizeBytes,
    })),
  };
  // After the Account it references, and before the licence request, so the
  // request stays the last thing that happens.
  const lrAt = items.findIndex((i) => /EPG_License_Request__c$/i.test(String(i?.url ?? "")));
  if (lrAt === -1) items.push(docItem);
  else items.splice(lrAt, 0, docItem);
  body.compositeRequest = items;
  return { ...input, body };
}

/**
 * Fill the licence request's own fields from the case, deterministically.
 *
 * The composite is composed BY THE MODEL, so which fields it carries varies run
 * to run -- and under repeated prompting it gets shorter. LR-37212's request
 * carried the emirate, region, activity codes, service, terms acceptance, the
 * amount paid and the payment reference. LR-37214, submitted after the customer
 * had to ask three times whether it was submitting, carried five fields and none
 * of those. Same journey, same data collected, a record with Payment Info empty
 * and Terms and Conditions unticked.
 *
 * These are not judgement calls: every one of them is a value already on the case
 * or a payment already settled. So they are written here rather than requested in
 * a prompt and hoped for. The model's own values win where it supplied one --
 * this fills gaps, it does not overrule.
 */
export interface EpglRequestFacts {
  emirate?: string;
  region?: string;
  activityCodes?: string;
  regulator?: string;
  termsAccepted?: boolean;
  /** What actually settled, fee included. */
  amountPaid?: number;
  paymentReference?: string;
}

export function withEpglRequestFields(
  input: Record<string, unknown> | undefined,
  facts: EpglRequestFacts
): Record<string, unknown> | undefined {
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  const items = Array.isArray(body.compositeRequest)
    ? [...(body.compositeRequest as Record<string, unknown>[])]
    : [];
  if (!items.length) return input;

  const fill = (item: Record<string, unknown> | undefined, values: Record<string, unknown>) => {
    if (!item) return false;
    const b = { ...((item.body ?? {}) as Record<string, unknown>) };
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === "") continue;
      // Never overwrite what the model read off the documents.
      if (b[k] !== undefined && b[k] !== null && b[k] !== "") continue;
      b[k] = v;
      changed = true;
    }
    if (changed) item.body = b;
    return changed;
  };

  let patched = false;
  patched = fill(items.find((i) => /sobjects\/Account$/i.test(String(i?.url ?? ""))), {
    EPG_Regulator__c: facts.regulator,
    EPG_Emirates__c: facts.emirate,
  }) || patched;

  patched = fill(items.find((i) => /EPG_License_Request__c$/i.test(String(i?.url ?? ""))), {
    EPG_Emirates__c: facts.emirate,
    EPG_Region__c: facts.region,
    EPG_Activity_Codes__c: facts.activityCodes,
    Terms_Conditions_Accepted__c: facts.termsAccepted === true ? true : undefined,
    EPG_Amount_Paid__c: facts.amountPaid,
    EPG_Payment_Reference__c: facts.paymentReference,
  }) || patched;

  if (!patched) return input;
  body.compositeRequest = items;
  return { ...input, body };
}

export function normaliseCompanyKey(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function buildApiTools(
  agentId: string,
  activeEnv: EnvKey,
  opts: {
    uaePassToken?: string;
    sessionToken?: string;
    authenticated?: boolean;
    mockSimulate?: boolean;
    /**
     * Submission writes that must not run before the customer has paid.
     * `toolSuffixes` are unprefixed operation tool names (e.g. post_api_Rental_Save)
     * for journeys whose submission requiresPayment; the gate is live while the
     * case's payment status is anything other than "paid".
     */
    blockUnpaidSaves?: { toolSuffixes: string[]; paid: boolean };
    /** Ties a failed backend call to the conversation it broke, for the audit log. */
    conversationId?: string;
    /**
     * True when the ACTIVE journey takes payment on the backend's own gateway (its
     * apiFlow declares a confirmTool). It changes what a save returning a payment
     * URL means: there, the URL is the payment and an unpaid order is the whole
     * story; here, the customer has already paid on our checkout and the save is
     * only the record — so the same response must not be reported the same way.
     */
    backendGateway?: boolean;
    /**
     * Where the backend's gateway sends the customer back to. It is set here and
     * never shown to the model: handed the URL in its prompt, the model put it in
     * a pay block, and the popup opened our own return page, announced the
     * customer was back, and closed -- for a payment that had never been offered.
     */
    paymentReturnUrl?: string;
    /**
     * Trade licence numbers and company names GSB returned in this case, already
     * normalised. A corporate save whose company is one of these is flagged to
     * Emirates Post as auto-populated — their own portal makes the same
     * distinction, and skips the document upload when it holds.
     */
    gsbCompanies?: string[];
    /** What the customer already decided about existing applications, if anything. */
    duplicateDecision?: () => string | null;
    /**
     * Licence-request values taken from the case rather than from the model.
     * See withEpglRequestFields: the composite is the model's to compose, so
     * which fields it carries varies run to run, and the ones it drops are the
     * ones nobody notices until the record is reviewed.
     */
    epglRequestFacts?: EpglRequestFacts;
    /**
     * The documents this case holds, for the EPGL composite's placeholder rows.
     *
     * Salesforce tracks an application's files as EPG_Document__c records — one
     * per file — and the portal's Documents panel lists those, not the files
     * themselves. Uploading a file without its placeholder puts it on the record
     * but leaves the panel empty, which is exactly what LR-37176 and LR-37177
     * looked like. The model was asked for these and left them out both times, so
     * they are built here from what was actually uploaded.
     */
    epglDocuments?: EpglDocumentRow[];
    /**
     * The case's uploaded files, base64, for Emirates Post's rental save.
     *
     * A corporate rental carries the trade licence inside
     * mainCorporateProfile.attachments and an agent's ID inside that agent's
     * listBoxAgentDetail entry. We were collecting both from the customer and
     * sending neither, so Emirates Post received an application with no documents
     * on it.
     */
    rentalAttachments?: () => Promise<{ key: string; fileName: string; fileFormat: string; base64: string }[]>;
    /**
     * The rental duration the customer actually chose, from the case.
     *
     * 4 Sep: they picked "2 Years — expires 03-09-2028, AED 670", the case
     * recorded `duration: 2_YEAR`, and the reservation went out with the ONE
     * YEAR date. Emirates Post held 370 for a year, the save then claimed two
     * years and AED 400, and the gateway — which prices from the hold — asked
     * for 370. They were about to buy a different box from the one they chose.
     * The date is not something to be recalled; it is read from the case here.
     */
    /** Read-only access to the gateway the backend opened the payment on. */
    gateway?: { baseUrl: string; outletRef: string; apiKey: string };
    chosenDuration?: () => string | null;
    /**
     * The facts a rental save must state, from the reservation and the case.
     *
     * `totalAmount` is the money. It was left to the model, which wrote 700 on
     * one attempt and 670 on the retry twenty seconds later for the same box —
     * the second one dropping the AED 30 courier the breakdown had just promised
     * — and Emirates Post charges whatever it is sent. The same payload also
     * arrived once without boxNumber, emirateCode, expiryDate or newBundleId and
     * was refused 157. None of it was ever unknown to us.
     */
    rentalSaveFacts?: () => {
      totalAmount: number | null;
      boxNumber?: string | null;
      emirateCode?: string | null;
      bundleId?: string | null;
      /** Did the customer ask for the key by courier? */
      keyDelivery?: boolean;
      /** Where that courier goes, assembled from the case. */
      keyDeliveryAddress?: Record<string, string> | null;
      /** The branch they picked, which is also MyHome's delivery office. */
      branch?: string | null;
    };
    /**
     * The card Emirates Post already holds for this signed-in customer.
     *
     * Their own rent flow puts it on paymentProperties.savedCard and still sends
     * the customer to the payment page, so this pre-selects their card there
     * rather than charging anything on its own. Resolved lazily: it is one more
     * call and only the save needs it.
     */
    savedCard?: () => Promise<{ cardToken?: string; maskedPan?: string; expiry?: string; scheme?: string; cardholderName?: string } | null>;
    /** uniqueBoxIds offered in an earlier turn; the customer picks in a later one. */
    initialOfferedBoxIds?: string[];
    /** The gateway payment opened in an earlier turn; the confirm comes later. */
    initialGatewayPayment?: { url: string; reference: string; orderNo?: string | null; paidAt?: string | null } | null;
    /** A hold carried over from an earlier turn; Select and Save are turns apart. */
    initialHold?: { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; expiryDate?: string | null; services?: string[]; agentExtraPrice?: number | null; agentIncludedPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null;
  } = {}
): Promise<{
  tools: Anthropic.Tool[];
  exec: (toolName: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
  getCapturedToken: () => string | null;
  getLastBranchQuery: () => { emirate: string; bundle: string } | null;
  /** PO Box halls in the branch list this turn, and where their keys are issued. */
  getLastBranchHalls: () => { officeId: string; name: string; alternative: string }[];
  /** The hall the customer chose, if the box lookup was made against one. */
  getChosenHall: () => { name: string; alternative: string } | null;
  /** The one-time registration fee, as Emirates Post has priced it. */
  getRegistrationFee: () => number | null;
  /**
   * What each rental term costs, for the bundle whose durations were last
   * fetched. A term Emirates Post has never been seen to charge for is present
   * with a null total — it has a date and no price, and must be shown that way
   * rather than have one worked out for it.
   */
  getDurationPrices: () => { bundle: string; terms: { years: number; rent: number | null; fee: number | null; total: number | null }[] } | null;
  /** The Emirates Post hold from the last successful Rental/Select, if any. */
  getLastHold: () => { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; expiryDate?: string | null; services?: string[]; agentExtraPrice?: number | null; agentIncludedPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null;
  /** uniqueBoxIds from the most recent availability lookup. */
  getOfferedBoxIds: () => string[];
  /** Normalised company keys GSB has returned in this case. */
  getGsbCompanies: () => string[];
  /** The payment Emirates Post opened on their gateway, from either save. */
  getGatewayPayment: () => { url: string; reference: string; orderNo: string | null; amount?: number | null; openedAt?: string | null; gatewayOrderId?: string | null; paidAt?: string | null } | null;
}> {
  const integrations = (await listIntegrations(agentId)).filter((i) => i.enabled);
  const tools: Anthropic.Tool[] = [];
  const map = new Map<string, { spec: EnvSpec; op: ApiOperation }>();

  for (const intg of integrations) {
    const spec = intg.environments[activeEnv];
    if (!spec) continue; // no spec for the active environment
    const pfx = prefix(intg.name);
    for (const op of spec.operations) {
      // Operations can be explicitly disabled (e.g. a backend write that isn't
      // provisioned, or an auth-only duplicate) so they never become a tool.
      if ((op as { enabled?: boolean }).enabled === false) continue;
      const toolName = `${pfx}__${op.toolName}`.slice(0, 64);
      if (map.has(toolName)) continue;
      map.set(toolName, { spec, op });
      tools.push({
        name: toolName,
        description: `[${intg.name}] ${op.summary}`.slice(0, 380),
        input_schema: op.inputSchema as Anthropic.Tool["input_schema"],
      });
    }
  }

  // Runtime BACKEND session token: one captured this turn takes priority over one
  // persisted from a previous turn. The UAE PASS identity token is deliberately NOT
  // part of this chain — it is offered separately and only honoured by uaepass_live.
  let captured: string | null = null;
  /** The live Emirates Post hold from the most recent successful Rental/Select. */
  /**
   * A reservation is only a reservation while it is CURRENT. Seeding the last one
   * from the case carried it across attempts: a Select that came back BOX_NOT_FREE
   * left the previous hold in place, the payment gate saw one and allowed the
   * charge, and the save then quoted a reference belonging to a box the customer
   * had not chosen — ERROR_GETTING_HOLD_DETAILS, after taking the money.
   */
  const freshHold = (
    h: { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null } | null | undefined
  ) => {
    if (!h?.reference) return null;
    if (!h.expiresAt) return h;
    const t = Date.parse(h.expiresAt);
    return Number.isFinite(t) && t <= Date.now() ? null : h;
  };
  /** Companies GSB has named in this case, so a save can say where they came from. */
  const gsbCompanies = new Set(opts.gsbCompanies ?? []);
  /** uniqueBoxIds the customer was offered, so a reservation can use a real one. */
  let offeredBoxIds: string[] = opts.initialOfferedBoxIds ?? [];
  let lastHold: { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; expiryDate?: string | null; services?: string[]; agentExtraPrice?: number | null; agentIncludedPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null =
    freshHold(opts.initialHold) ?? null;
  const runtimeToken = () => captured ?? opts.sessionToken ?? undefined;

  // Remember the emirate + bundle of the most recent branch-locations lookup so
  // the route can deterministically render the "browse nearby branches" map even
  // when the model forgets to emit the ```map block (which it does often).
  /**
   * The payment Emirates Post opened, whichever save opened it.
   *
   * A rental gets here through a hold; a guest renewal has no hold at all. Kept
   * apart from the hold so both can find it.
   */
  let gatewayPayment: { url: string; reference: string; orderNo: string | null; amount?: number | null; openedAt?: string | null; gatewayOrderId?: string | null; paidAt?: string | null } | null =
    opts.initialGatewayPayment
      ? { url: opts.initialGatewayPayment.url, reference: opts.initialGatewayPayment.reference, orderNo: opts.initialGatewayPayment.orderNo ?? null, paidAt: opts.initialGatewayPayment.paidAt ?? null }
      : null;
  let lastBranchQuery: { emirate: string; bundle: string } | null = null;
  /** The duration ladder as last priced, for the guard that stamps the cards. */
  let durationPrices: { bundle: string; terms: { years: number; rent: number | null; fee: number | null; total: number | null }[] } | null = null;
  // The branch a MyHome customer picked. Their boxes are listed by emirate, so the
  // officeId is dropped from that lookup -- but Rental/Save still wants it as
  // myHomeProfile.deliveryOfficeID, and nothing later in the flow carries it.
  let lastMyHomeOfficeId: string | null = null;
  const asStr = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  // How many times each branch's box list has been asked for this turn, so a
  // "Refresh" pages further into the staging test set instead of repeating.
  const freeBoxPages = new Map<string, number>();

  // The box's own expiry, learned from any renewal Details response this turn.
  // Renewal pricing is only accepted on that box's ANNIVERSARY (see
  // anniversaryExpiry) and the model kept substituting 31 December, so the date
  // is corrected here rather than left to prompting.
  let knownExpiry: { box: string; iso: string; bundle?: string } | null = null;

  /**
   * Per-term prices for each bundle, learned when the bundle list is read.
   *
   * The registration fee is nowhere in any response. It is the hold's
   * minimumAmount minus the published price of the term the customer chose, so
   * that published price has to survive from the bundle list to the hold.
   */
  // Seeded from the conversation: the bundles are listed in one turn and the
  // durations priced in a later one, so a per-request map was empty exactly when
  // the duration cards needed it — which is why they showed five dates and no
  // prices. Same shape as the box halls and the offered dates.
  const bundlePriceBook = recallPriceBook(opts.conversationId);

  /**
   * Halls in the branch list this turn.
   *
   * Kept so the notice can be rendered by US rather than asked for in prose. The
   * guidance told the model to show it word for word and the model did not --
   * which is what guidance does under pressure, and why the map block beside it
   * is appended deterministically too.
   */
  let lastBranchHalls: { officeId: string; name: string; alternative: string }[] = recallHalls(opts.conversationId);
  /**
   * The hall the customer actually PICKED, if they picked one.
   *
   * Listing the notice for every hall in the emirate the moment the branch cards
   * appear is noise: Emirates Post shows it when a hall is CHOSEN. Choosing is
   * not a thing the model reports — but asking FreeBoxes for a hall's officeId
   * is exactly what choosing it does, so that is the signal.
   */
  let chosenHall: { name: string; alternative: string } | null = null;
  /** Registration fees observed for this integration, loaded when bundles are listed. */
  let feeBook: Map<string, number> = new Map();
  /** The rental end dates Emirates Post offered for a bundle, exactly as written. */
  const expiryDatesByBundle = recallExpiryDates(opts.conversationId);
  /**
   * The renewal that was actually PRICED: its bundle id and expiry, as sent.
   *
   * 5 Sep: pricing ran for `newBundleId: "BR"` and came back AED 13,872; the
   * save then went out as "PRE", and again as "PREMIUM", and Emirates Post
   * answered 105 INVALID BUNDLE OR RENT TYPE both times. The chat told the
   * customer it was "an issue with the bundle on the backend side". The bundle
   * id was on the pricing call twenty seconds earlier.
   */
  let lastPriced: { bundleId: string; expiryDate: string; amount: number | null } | null = null;
  /**
   * The bundle the box is on TODAY, read from the renewal details Emirates Post
   * returned — never from the conversation. It decides whether an upgrade is
   * possible, and it is what `isBundleChanged` is compared against.
   */
  let currentBundleId: string | null = null;

  /**
   * The bundle's per-term prices, re-fetching if this turn has not seen them.
   *
   * The book is filled when Rental/Bundle is read, and that usually happened
   * SEVERAL TURNS EARLIER -- the customer picks a bundle, then a branch, then a
   * box, and only then a period. The book lives for one turn, so by the time the
   * periods are shown it is empty and the prices are gone. One extra call is
   * cheaper than showing a customer a price that was multiplied rather than
   * quoted.
   */
  const bundlePricesFor = async (bundleId: string): Promise<BundlePeriod[]> => {
    if (!bundleId) return [];
    const known = bundlePriceBook.get(bundleId);
    if (known?.length) return known;
    const bundleTool = [...map.keys()].find((t) => /rental_bundle$/i.test(t));
    if (!bundleTool) return [];
    try {
      // exec() runs the tool through the same path, which fills the book on the
      // way past -- so this is a cache warm, not a second parser.
      await exec(bundleTool, {});
    } catch {
      /* best-effort: without it the periods simply carry no prices */
    }
    return bundlePriceBook.get(bundleId) ?? [];
  };

  /** Learn the box's expiry from any renewal Details response, cached or fresh. */
  const rememberExpiry = (toolName: string, r: { result: string; isError?: boolean }) => {
    if (r.isError || !/renewal_details/i.test(toolName)) return;
    const iso = r.result.match(/"currentExpiryDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!iso) return;
    const box = r.result.match(/"boxNumber"\s*:\s*"?(\d+)/)?.[1];
    // The bundle id is quoted straight after it in poBoxSubscriptionDetails and
    // is what pricing must be asked for when the bundle is not being changed.
    const bundle = r.result.match(/"bundle"\s*:\s*"([^"]+)"/)?.[1];
    knownExpiry = { box: box ?? "", iso, bundle };
  };

  /**
   * Pricing was asked for a box whose expiry we have not seen this turn. Look it
   * up from the box number the pricing call itself carries, so the anniversary
   * correction still applies. Best-effort: a failure here just leaves the date
   * as the model supplied it, exactly as before.
   */
  const learnExpiryForPricing = async (input: Record<string, unknown>) => {
    const body = ((input?.body ?? input) ?? {}) as Record<string, unknown>;
    const pick = (...names: string[]) => {
      for (const n of names) {
        const k = Object.keys(body).find((x) => x.toLowerCase() === n);
        if (k && body[k]) return String(body[k]);
      }
      return "";
    };
    const box = pick("boxnumber", "box");
    const emirate = pick("emiratecode", "emirate");
    if (!box) return;
    const detailsTool = [...map.keys()].find((t) => /guest_renewal_details/i.test(t)) ?? [...map.keys()].find((t) => /renewal_details/i.test(t));
    if (!detailsTool) return;
    try {
      const r = await exec(detailsTool, { BoxNumber: box, EmirateCode: emirate });
      rememberExpiry(detailsTool, r);
    } catch {
      /* best-effort */
    }
  };

  const exec = async (toolName: string, input: Record<string, unknown>) => {
    const entry = map.get(toolName);
    if (!entry) return { result: `Unknown integration tool ${toolName}.`, isError: true };

    // Renewal pricing: force the target expiry onto the box's own anniversary.
    // The box's expiry is normally learned from the Details call earlier in the
    // turn, but it may not be: Details can be served from the cache below, and
    // in a multi-turn renewal it may have been called in an earlier request
    // altogether (a different process, even a different instance). So if the
    // expiry is not known, fetch it — the same cache usually makes that free —
    // rather than letting the date fall back to whatever the model guessed.
    if (/renewal_pricing/i.test(toolName)) {
      if (!knownExpiry) await learnExpiryForPricing(input);
      const corrected = correctPricingInputs(input, knownExpiry);
      if (corrected) input = corrected;
    }
    // Read-only lookups are served from a short-lived cache. Profiling showed the
    // model re-fetching the same catalogue (bundles, branches) on consecutive
    // turns, and every repeat cost a whole model round (~3s) plus a call to a
    // backend that is not always healthy. Cached only for GETs, only on success,
    // and keyed so a different customer or a different privacy view can never
    // read another's entry (see readCache).
    // A paid submission must not be written before the money is taken.
    //
    // Enabling the save operations (2026-08-19) made Rental/Save callable for the
    // first time, and the model started calling it at the consent step -- before
    // payment. It needs an Emirates Post session it does not have there, so it 401d
    // and the journey stopped dead: personal_po_box_rental reached payment 22 times
    // up to 2026-08-18 and zero times after. The apiFlow notes already said "after
    // the payment settles", but a note is guidance and this is an ordering
    // invariant, so it is enforced here rather than asked for.
    // Reserve the box for the TERM the customer actually chose.
    //
    // `poBoxExpiryDate` is the only place the duration exists in a reservation,
    // and the model writes it from memory: on 4 Sep it wrote the one-year date
    // over a two-year choice, and every figure after that described a rental
    // nobody had asked for. The offered dates are known — Rental/ExpiryDates
    // returned them minutes earlier — and so is the choice, so neither is left
    // to recall.
    if (/rental_select$/i.test(toolName) && opts.chosenDuration) {
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      const bundle = asStr(body.bundleId ?? body.BundleId);
      const dates = expiryDatesByBundle.get(bundle) ?? [];
      const years = durationYears(opts.chosenDuration());
      const wanted = years !== null ? dateForYears(dates, years) : null;
      if (wanted && asStr(body.poBoxExpiryDate) !== wanted) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "rental_select_expiry_corrected",
          payload: {
            tool: toolName,
            method: entry.op.method,
            path: entry.op.path,
            input: { sent: body.poBoxExpiryDate, used: wanted, duration: opts.chosenDuration(), offered: dates },
            response: `The customer chose ${years} year(s); the reservation was about to be made to ${String(body.poBoxExpiryDate)}.`,
          },
        }).catch(() => {});
        body.poBoxExpiryDate = wanted;
        input = { ...input, body };
      }
    }

    // Reserve the box the customer actually chose, with the id the backend issued.
    if (/rental_select$/i.test(toolName) && offeredBoxIds.length) {
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      const sent = String(body.uniqueBoxID ?? body.uniqueBoxId ?? "");
      if (sent && !offeredBoxIds.includes(sent)) {
        // The model builds this id rather than copying it, so it arrives with a
        // prefix added or dropped. Match on the digits that are actually a box.
        const match =
          offeredBoxIds.find((id) => id.endsWith(sent) || sent.endsWith(id)) ?? null;
        if (match) {
          body.uniqueBoxID = match;
          delete body.uniqueBoxId;
          input = { ...input, body };
        }
      }
    }

    // A BOX WE ALREADY HOLD IS NOT A BOX SOMEONE ELSE TOOK.
    //
    // 4 Sep: box 902015 was reserved at 13:16:21 (hold 260612174, AED 765). The
    // customer tapped "Pay with my saved Visa", the model called Select AGAIN on
    // the same box 26 seconds later, and Emirates Post answered 108 BOX_NOT_FREE
    // — correctly, because WE were holding it. The chat told the customer someone
    // else had just taken their box and walked them back to the box list, with
    // the reservation they had already been quoted still live behind them. The
    // same shape ended the corporate flow.
    //
    // Selecting a box twice is not a second reservation; the reservation already
    // in hand IS the answer. Serve it, and never spend the customer's box on a
    // call that can only refuse it.
    if (/rental_select$/i.test(toolName) && lastHold) {
      const body = (input?.body ?? {}) as Record<string, unknown>;
      const asked = String(body.uniqueBoxID ?? body.uniqueBoxId ?? "");
      const bundle = String(body.bundleId ?? "");
      const live = !lastHold.expiresAt || Date.parse(
        lastHold.expiresAt.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(lastHold.expiresAt)
          ? lastHold.expiresAt
          : `${lastHold.expiresAt}Z`
      ) > Date.now();
      // The TERM has to match too. 15:54: the customer had picked two years, the
      // first reservation went out for one, the model corrected itself and asked
      // again with the two-year date — and this guard handed back the one-year
      // hold because the box number was the same. Same box, different term, is a
      // different reservation and must be made afresh.
      const wantedExpiry = asStr(body.poBoxExpiryDate);
      const sameTerm = !wantedExpiry || !lastHold.expiryDate || wantedExpiry === lastHold.expiryDate;
      if (asked && asked === lastHold.uniqueBoxId && (!bundle || bundle === lastHold.bundleId) && sameTerm && live) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "rental_select_reused_hold",
          payload: { tool: toolName, method: entry.op.method, path: entry.op.path, input: input ?? {}, response: `hold ${lastHold.reference} already covers box ${asked}` },
        }).catch(() => {});
        return {
          result:
            `This box is ALREADY RESERVED BY THIS CONVERSATION — reservation ${lastHold.reference}` +
            (typeof lastHold.amount === "number" ? `, total AED ${lastHold.amount.toFixed(2)}` : "") +
            (lastHold.expiresAt ? `, held until ${lastHold.expiresAt}` : "") +
            ". Emirates Post was NOT called again: reserving a box a second time answers 108 BOX_NOT_FREE because the first reservation is holding it, and relaying that told a customer their own box had been taken by someone else. Nothing has gone wrong and the customer has lost nothing. Do NOT tell them the box is unavailable, do NOT offer them another number, and do NOT reserve anything again — continue from this reservation straight to Rental/Save.",
        };
      }
    }

    // DO NOT ASK WHETHER THEY HAVE PAID WHILE THEY ARE STILL PAYING.
    //
    // 4 Sep, order 260972870: created 15:36:18, asked about at 15:36:44. Nobody
    // opens a payment page, reads a card number off a card and types it in
    // twenty-six seconds. Every payment that settled today was confirmed after
    // the customer had finished; every "not paid" came from a check made 26 to
    // 57 seconds after the order was created, while the page was still open.
    //
    // Asking early is not free. It is a POST against the backend's payment
    // record, it answers paymentStatus 2 for an order that has simply not been
    // paid YET, and the chat then tells the customer their payment failed and
    // hands them another link -- while the page they are typing into is open in
    // front of them. So the first check waits until they have plausibly had time.
    // NOT anchored, deliberately. The rental's confirm tool is called
    // `…post_api_Rental_UpdatePayment_paymentReferenceNo` — the path parameter is
    // part of the name — so `/updatepayment$/` matched nothing, and both this
    // wait and the paid-at stamp below were dead code for every rental. The
    // signed-in renewal's `post_api_Renewal_ConfirmPayment` was missed the other
    // way, by a pattern that only named the GUEST one.
    if (/(updatepayment|confirmpayment)/i.test(toolName) && gatewayPayment?.openedAt && !gatewayPayment.paidAt) {
      const age = Date.now() - Date.parse(gatewayPayment.openedAt);
      if (Number.isFinite(age) && age >= 0 && age < PAYMENT_SETTLE_GRACE_MS) {
        const wait = Math.ceil((PAYMENT_SETTLE_GRACE_MS - age) / 1000);
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "payment_check_too_early",
          payload: {
            tool: toolName,
            method: entry.op.method,
            path: entry.op.path,
            input: input ?? {},
            response: `The order was opened ${Math.round(age / 1000)}s ago; not asking for another ${wait}s.`,
          },
        }).catch(() => {});
        return {
          result:
            `NOT ASKED YET. This order was created ${Math.round(age / 1000)} seconds ago and the customer is very likely still on the payment page — nobody types a card number in that time. Asking now would come back "not paid" for an order that has simply not been paid YET, and telling them that while their payment page is open is how a payment that was about to go through gets abandoned. Say you will confirm it the moment it lands, ask them to finish on the payment page, and check again in about ${wait} seconds. Do NOT say the payment failed, do NOT say it has not come through, and do NOT offer them a new payment link.`,
        };
      }
    }

    // A RENEWAL IS SAVED AS WHAT IT WAS PRICED AS.
    //
    // The bundle id and the expiry are chosen by the customer, priced by
    // Emirates Post, and then rewritten from memory on the save: "BR" was
    // priced, "PRE" and "PREMIUM" were sent, and 105 INVALID BUNDLE OR RENT TYPE
    // came back both times. Neither value was ever in doubt.
    if (/(guest_renewal_save|renewal_save)$/i.test(toolName) && lastPriced) {
      const body = (input?.body ?? {}) as Record<string, unknown>;
      const fixes: string[] = [];
      if (asStr(body.newBundleId) && asStr(body.newBundleId) !== lastPriced.bundleId) {
        fixes.push(`newBundleId ${String(body.newBundleId)} -> ${lastPriced.bundleId}`);
        body.newBundleId = lastPriced.bundleId;
      }
      if (asStr(body.expiryDate) && asStr(body.expiryDate) !== lastPriced.expiryDate) {
        fixes.push(`expiryDate ${String(body.expiryDate)} -> ${lastPriced.expiryDate}`);
        body.expiryDate = lastPriced.expiryDate;
      }
      if (lastPriced.amount !== null && body.totalAmount !== lastPriced.amount) {
        fixes.push(`totalAmount ${String(body.totalAmount)} -> ${lastPriced.amount}`);
        body.totalAmount = lastPriced.amount;
      }
      if (fixes.length) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "renewal_save_corrected",
          payload: {
            tool: toolName,
            method: entry.op.method,
            path: entry.op.path,
            input: { fixes },
            response: "The save was rewritten to match the renewal Emirates Post actually priced.",
          },
        }).catch(() => {});
      }
    }

    // Rental/Save: use the hold we were actually issued, whatever the model wrote.
    if (/rental_save$/i.test(toolName)) {
      if (!lastHold) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "integration_call_failed",
          payload: { tool: toolName, method: entry.op.method, path: entry.op.path, input: input ?? {}, response: "REFUSED LOCALLY: no hold on this case" },
        }).catch(() => {});
        return {
          result:
            "No hold exists for this rental. Emirates Post records a rental against a reservation created by Rental/Select, and that call has not succeeded in this conversation — so this save would fail with ERROR_GETTING_HOLD_DETAILS whatever is sent. Call Rental/Select first with the box's uniqueBoxId, then save. Do NOT invent a reference and do NOT take payment until the hold is confirmed.",
          isError: true,
        };
      }
      const body = (input?.body ?? {}) as Record<string, unknown>;
      let patched = false;
      if (body.subscriptionReferenceNumber !== lastHold.reference) {
        body.subscriptionReferenceNumber = lastHold.reference;
        patched = true;
      }
      // THE AMOUNT IS NOT THE MODEL'S TO WRITE. Emirates Post charges what this
      // field says: 700 on one attempt, 670 on the retry, for one unchanged
      // rental. It is computed from the reservation and the customer's own
      // choices — the same function the summary card uses — so the card and the
      // charge cannot say different things.
      const facts = opts.rentalSaveFacts?.();
      // PRICE WHAT THIS PAYLOAD ACTUALLY ASKS FOR.
      //
      // Reading the customer's choices off the CASE looked right and is not:
      // the case is written when the turn ends, and since the preferences step
      // moved after the reservation, the courier choice and the save now happen
      // in the same round — so the save was priced against a case that did not
      // yet know about it. Summary AED 700, order AED 670, twice in a row.
      //
      // The payload does know. It carries `additionalServiceDetailList` and a
      // `keyDeliveryAddress`, and those are the services Emirates Post is being
      // asked to provide. Charging for exactly what is being requested cannot
      // drift from it, whatever the case knows at that instant.
      const services = Array.isArray(body.additionalServiceDetailList)
        ? (body.additionalServiceDetailList as Record<string, unknown>[])
        : [];
      // Only if Emirates Post PRICED it on this reservation. A KEY-DELIVERY
      // line sent for a bundle that has none returns 223
      // INVALID_ADDITIONAL_SERVICE and takes the whole rental with it — and
      // charging for it would be charging for a service they do not sell.
      const courierOffered = (lastHold.services ?? []).some((sv) => /key[-_ ]?delivery/i.test(sv));
      const courierAsked =
        courierOffered &&
        (services.some((sv) => /key[-_ ]?delivery/i.test(String(sv?.serviceType ?? ""))) ||
          Boolean(body.keyDeliveryAddress) ||
          Boolean(facts?.keyDelivery));
      // Asked for on a bundle that cannot provide it: drop it rather than fail.
      if (!courierOffered && (services.length || body.keyDeliveryAddress)) {
        body.additionalServiceDetailList = services.filter(
          (sv) => !/key[-_ ]?delivery/i.test(String(sv?.serviceType ?? ""))
        );
        delete body.keyDeliveryAddress;
        patched = true;
      }
      // The customer asked for it and the payload forgot to request it: a
      // courier they chose, paid for and never receive is the worse half of this.
      if (courierAsked && !services.some((sv) => /key[-_ ]?delivery/i.test(String(sv?.serviceType ?? "")))) {
        body.additionalServiceDetailList = [...services, { quantity: 1, serviceType: "KEY-DELIVERY" }];
        patched = true;
      }
      // And somewhere to deliver it to. A courier line with no address is a
      // charge for a delivery nobody can make.
      if (courierAsked && !body.keyDeliveryAddress && facts?.keyDeliveryAddress) {
        body.keyDeliveryAddress = facts.keyDeliveryAddress;
        patched = true;
      }
      if (courierAsked !== Boolean(services.length) || !body.keyDeliveryAddress) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "rental_save_courier_checked",
          payload: {
            tool: toolName,
            method: entry.op.method,
            path: entry.op.path,
            input: { courierAsked, servicesSent: services.length, addressPresent: Boolean(body.keyDeliveryAddress) },
            response: "Key delivery reconciled between the customer's choice and the save payload.",
          },
        }).catch(() => {});
      }
      const agents = Array.isArray(body.listBoxAgentDetail) ? (body.listBoxAgentDetail as unknown[]).length : 1;
      const owed =
        typeof lastHold.amount === "number"
          ? rentalTotal(
              { base: lastHold.amount, agentExtraPrice: lastHold.agentExtraPrice, keyDeliveryPrice: lastHold.keyDeliveryPrice },
              { agentCount: Math.max(1, agents), keyDelivery: courierAsked }
            ).total
          : null;
      if (owed !== null && owed > 0 && body.totalAmount !== owed) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "rental_save_amount_corrected",
          payload: {
            tool: toolName,
            method: entry.op.method,
            path: entry.op.path,
            input: { sent: body.totalAmount, charged: owed, courier: courierAsked, agents },
            response: `The save was about to ask for ${String(body.totalAmount)}; the reservation plus the services it requests come to ${owed}.`,
          },
        }).catch(() => {});
        body.totalAmount = owed;
        patched = true;
      }
      // The rest of what the payload must state, and what a 157 was hiding: a
      // save arrived with none of these and Emirates Post answered
      // ERROR_GETTING_HOLD_DETAILS, which names the hold and not the four
      // missing fields.
      for (const [key, value] of [
        ["boxNumber", facts?.boxNumber],
        ["emirateCode", facts?.emirateCode],
        ["newBundleId", facts?.bundleId ?? lastHold.bundleId],
      ] as const) {
        if (value && !body[key]) { body[key] = /^\d+$/.test(String(value)) && key === "boxNumber" ? Number(value) : value; patched = true; }
      }
      // THE SAVED CARD IS NOT THE MODEL'S TO WRITE.
      //
      // 15:54: `"savedCard": {"scheme":"Visa","cardToken":"1111","maskedPan":
      // "XXXXXXXXXXXX1111"}`. The customer's real token is a 60-character
      // tokenised pan; "1111" is the last four digits of their card, made up to
      // fill the field. Emirates Post refused with 157 ERROR_GETTING_HOLD_DETAILS
      // — an error that names the hold and says nothing about the card — and the
      // chat told the customer AED 400 had been charged to their Visa. Nothing
      // had been charged. No order existed.
      //
      // There is exactly one place a card token can come from: the saved-cards
      // lookup. If it says the customer has one, that is what goes; if it says
      // they have none, no card goes at all.
      const props = (body.paymentProperties ?? {}) as Record<string, unknown>;
      const written = props.savedCard as Record<string, unknown> | undefined;
      // ONLY the five fields the spec defines for savedCard: expiry, scheme,
      // cardToken, maskedPan, cardholderName. The saved-cards lookup returns the
      // whole card record — isDefault, isExpired and the rest — and substituting
      // it wholesale started sending Emirates Post a shape their contract does
      // not describe. Every payment that has ever settled carried exactly these
      // five; the three that did not settle after 16:10 carried seven.
      const raw = opts.savedCard ? await opts.savedCard().catch(() => null) : null;
      const real = raw
        ? (Object.fromEntries(
            (["expiry", "scheme", "cardToken", "maskedPan", "cardholderName"] as const)
              .map((k) => [k, (raw as Record<string, unknown>)[k]])
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
          ) as Record<string, unknown>)
        : null;
      if (written) {
        if (!real) {
          delete props.savedCard;
          patched = true;
        } else if (
          String(written.cardToken ?? "") !== String(real.cardToken ?? "") ||
          Object.keys(written).some((k) => !(k in real))
        ) {
          props.savedCard = real;
          patched = true;
          void audit({
            agentId,
            conversationId: opts.conversationId,
            actor: "system",
            action: "rental_save_card_corrected",
            payload: {
              tool: toolName,
              method: entry.op.method,
              path: entry.op.path,
              input: { sentTokenLength: String(written.cardToken ?? "").length },
              response: "The save carried a card token the saved-cards lookup did not issue; the real one was substituted.",
            },
          }).catch(() => {});
        }
      }
      // A SAVE CANNOT DISAGREE WITH ITS OWN RESERVATION. On 4 Sep the save
      // claimed `expiryDate: 2028-09-03` and AED 400 over a hold made to
      // 2027-09-03 for 370. Emirates Post prices from the hold, so the gateway
      // asked for a year — and the two-year rental the customer had chosen
      // existed only in our sentences. The reservation is the fact.
      if (lastHold.expiryDate && body.expiryDate && body.expiryDate !== lastHold.expiryDate) {
        body.expiryDate = lastHold.expiryDate;
        patched = true;
      }
      // billingDetail is optional in the spec and mandatory in practice. Without it
      // the call comes back 400 {"Error":"Error from payment gateway"} — a message
      // that names the gateway and says nothing about the field it is missing, and
      // which the agent duly relayed as a fault on Emirates Post's side. Verified
      // against staging: identical payload, billingDetail added, HTTP 200.
      // COMPLETE it, do not merely supply it when absent. Skipping whenever the
      // model had written something left a billingDetail of firstName, lastName and
      // emailAddress only — no address, city or country — and that save came back
      // 157. Every save that carried all six fields has succeeded.
      const pay = (body.paymentProperties ?? {}) as Record<string, unknown>;
      const u = (body.userProfile ?? {}) as Record<string, unknown>;
      const full = String(u.customerNameEN ?? u.customerNameAr ?? "").trim();
      const cut = full.lastIndexOf(" ");
      const emirate = String((input as Record<string, unknown>)?.emirateCode ?? body.emirateCode ?? "").trim();
      const given = (pay.billingDetail ?? {}) as Record<string, unknown>;
      const filled = {
        firstName: String(given.firstName ?? "") || (cut > 0 ? full.slice(0, cut) : full),
        lastName: String(given.lastName ?? "") || (cut > 0 ? full.slice(cut + 1) : ""),
        emailAddress: String(given.emailAddress ?? "") || String(u.email ?? ""),
        address: String(given.address ?? "") || emirate || "United Arab Emirates",
        cityName: String(given.cityName ?? "") || emirate || "United Arab Emirates",
        countryName: String(given.countryName ?? "") || "United Arab Emirates",
      };
      if (JSON.stringify(given) !== JSON.stringify(filled)) {
        pay.billingDetail = filled;
        body.paymentProperties = pay;
        patched = true;
      }

      // Did these company details come from Emirates Post, or from the customer?
      //
      // A corporate rental carries IsCorporateInfoAutoPopulated. It is true when
      // the company was picked from the GSB licence registry — Emirates Post
      // already holds those details and its own portal then sends no trade
      // licence scan at all — and false when the customer typed the licence
      // number and uploaded the documents. We were never setting it, so every
      // corporate rental looked like the manual kind.
      const corp = (body.mainCorporateProfile ?? {}) as Record<string, unknown>;
      if (Object.keys(corp).length) {
        const known = gsbCompanies;
        const fromGsb =
          known.has(normaliseCompanyKey(corp.tradeLicenseNo)) ||
          known.has(normaliseCompanyKey(corp.companyNameEn)) ||
          known.has(normaliseCompanyKey(corp.companyNameAr));
        if (body.IsCorporateInfoAutoPopulated !== fromGsb) {
          body.IsCorporateInfoAutoPopulated = fromGsb;
          patched = true;
        }
      }

      // The key delivery address, in the shape their own flow writes it.
      //
      // keyDeliveryAddress.deliveryAddress is a single string, and their portal
      // builds it from the parts: "<area>, <street>, No:<villa>, <extra>". We
      // sent whatever the customer typed -- the same field, but not the same
      // thing to read on a delivery run. Where the structured parts exist, and
      // only where they say more than what is already there, compose it.
      const kd = body.keyDeliveryAddress as Record<string, unknown> | undefined;
      if (kd) {
        const next = { ...kd };
        const mh = (body.myHomeProfile ?? {}) as Record<string, unknown>;
        const addr = (mh.myHomeAddress ?? {}) as Record<string, unknown>;
        const custAddr = (u.customersAddress ?? {}) as Record<string, unknown>;
        // regionName on myHomeAddress is the CODE; the readable name is the one
        // written onto the customer's own address record when the pin resolved.
        const area = asStr(custAddr.regionName);
        const street = asStr(addr.streetOrLandmark) || asStr(custAddr.streetOrLandmark);
        const villa = asStr(addr.villaOrApartmentNo) || asStr(custAddr.villaOrApartmentNo);
        const building = asStr(addr.buildingName) || asStr(custAddr.buildingName);
        const composed = [area, street, villa ? `No:${villa}` : "", building].filter(Boolean).join(", ");
        if (composed && (street || villa) && composed.length > asStr(next.deliveryAddress).length) {
          next.deliveryAddress = composed;
        }
        if (!asStr(next.emirateCode)) next.emirateCode = asStr(addr.emirateCode) || asStr(custAddr.emirateCode);
        if (!asStr(next.name)) next.name = asStr(u.customerNameEN);
        if (!asStr(next.mobileNo)) next.mobileNo = asStr(u.mobileNumber);
        if (JSON.stringify(next) !== JSON.stringify(kd)) {
          body.keyDeliveryAddress = next;
          patched = true;
        }
      }

      // The card they already have with Emirates Post.
      //
      // A signed-in customer with a card on file was being sent to the payment
      // page to type it again -- the journey said "if a saved card is on file,
      // use it directly" and nothing behind that sentence did anything. Their own
      // rent flow puts the card on paymentProperties.savedCard and still opens
      // the payment page, so this pre-selects it there. It charges nothing by
      // itself; the customer still completes the payment and can change the card.
      if (opts.savedCard && !pay.savedCard) {
        const card = await opts.savedCard().catch(() => null);
        if (card?.cardToken) {
          pay.savedCard = {
            cardToken: card.cardToken,
            maskedPan: card.maskedPan ?? "",
            expiry: card.expiry ?? "",
            scheme: card.scheme ?? "",
            cardholderName: card.cardholderName ?? "",
          };
          body.paymentProperties = pay;
          patched = true;
        }
      }

      // The return URL is ours to set, not the model's to remember.
      const ret = opts.paymentReturnUrl;
      if (ret && pay.paymentReturnUrl !== ret) {
        pay.paymentReturnUrl = ret;
        body.paymentProperties = pay;
        patched = true;
      }

      // MyHome is delivered to the customer's door, and Emirates Post will only
      // accept an address whose AREA it recognises -- as a code from its masters
      // service ("DXB-84"), which is what the portal puts in regionName. A typed
      // address goes in as "Sobha Hartland" and comes back 173
      // MYHOME_ADDDRESSNOT_FOUND, an error that names no field and reads like an
      // outage. Resolve the code here, and refuse rather than guess: delivering a
      // year of someone's post to the wrong area is worse than asking again.
      const bundleId = String(lastHold.bundleId ?? "").toUpperCase();
      if (/^MYHOME/.test(bundleId) || body.myHomeProfile) {
        const mh = { ...((body.myHomeProfile ?? {}) as Record<string, unknown>) };
        const addr = { ...((mh.myHomeAddress ?? {}) as Record<string, unknown>) };
        const emirate =
          asStr(addr.emirateCode).toUpperCase() ||
          lastBranchQuery?.emirate ||
          "";
        const env = /-stg\.|-stg\/|box-stg/.test(entry.spec.baseUrl) ? "staging" : "production";
        const rows = emirate ? await regionsFor(env, emirate) : [];
        if (rows.length) {
          // The area may arrive under any of these: the model has no way to know
          // which field Emirates Post reads, and the answer (regionName) is the
          // counter-intuitive one.
          const typed =
            asStr(addr.regionName) || asStr(addr.regionCode) || asStr(addr.detailedAddress) || asStr(addr.streetOrLandmark);
          const hit = exactRegion(rows, typed);
          if (!hit || !hit.deliverable) {
            const near = searchRegions(rows, typed, 12);
            const list = near.length
              ? near.filter((r) => r.deliverable).map((r) => `${r.code} = ${r.nameEn}`).join("\n")
              : "";
            void audit({
              agentId,
              conversationId: opts.conversationId,
              actor: "system",
              action: "integration_call_failed",
              payload: { tool: toolName, method: entry.op.method, path: entry.op.path, input: input ?? {}, response: `REFUSED LOCALLY: area "${typed}" is not an Emirates Post delivery area in ${emirate}` },
            }).catch(() => {});
            return {
              result:
                (hit && !hit.deliverable
                  ? `Emirates Post does not deliver to ${hit.nameEn}, so a MyHome box cannot be set up at that address.`
                  : `"${typed}" is not an area Emirates Post recognises in ${emirate}, so this save would fail with MYHOME_ADDDRESSNOT_FOUND. Nothing has gone wrong and the customer has NOT been charged -- their hold is still valid.`) +
                (list
                  ? `\n\nAsk the customer which of these areas theirs is in, as CARDS, then call this tool again with myHomeProfile.myHomeAddress.regionName set to the CODE (the part before the "="), not the name:\n${list}`
                  : `\n\nAsk the customer for the AREA their address is in (the district name Emirates Post would recognise, not the building or community name) and try again.`) +
                `\n\nAlso send streetOrLandmark, buildingName and villaOrApartmentNo from what they have already told you, and keep the full address in detailedAddress.`,
              isError: true,
            };
          }
          if (asStr(addr.regionName) !== hit.code) {
            addr.regionName = hit.code;
            mh.myHomeAddress = addr;
            body.myHomeProfile = mh;
            patched = true;
          }
          // The customer's own address record, which is what the portal's
          // "Delivery Address details" panel reads. Rented through us it reads
          // "- UAE, , No:" -- the components were never sent, and the one
          // structured address we have is the one just resolved above.
          if (!u.customersAddress) {
            u.customersAddress = {
              emirateCode: emirate,
              regionCode: hit.code,
              regionName: hit.nameEn,
              streetOrLandmark: asStr(addr.streetOrLandmark),
              buildingName: asStr(addr.buildingName),
              villaOrApartmentNo: asStr(addr.villaOrApartmentNo),
              detailedAddress: asStr(addr.detailedAddress),
              countryName: "United Arab Emirates",
            };
            body.userProfile = u;
            patched = true;
          }
        }
        // deliveryOfficeID is the branch the customer chose. The portal always
        // sends it; we only know it because the MyHome box lookup is asked for by
        // officeId before we rewrite it to an emirate.
        const office = lastMyHomeOfficeId ?? officeIdForBranch(opts.conversationId, opts.rentalSaveFacts?.().branch);
        if (office && asStr(mh.deliveryOfficeID) !== office) {
          mh.deliveryOfficeID = office;
          body.myHomeProfile = mh;
          patched = true;
        }
        if (!asStr(mh.deliveryOfficeID)) {
          void audit({
            agentId,
            conversationId: opts.conversationId,
            actor: "system",
            action: "myhome_delivery_office_missing",
            payload: {
              tool: toolName,
              method: entry.op.method,
              path: entry.op.path,
              input: { branch: opts.rentalSaveFacts?.().branch ?? null },
              response: "No deliveryOfficeID could be resolved; Emirates Post will answer 173 MYHOME_ADDDRESS_NOT_FOUND.",
            },
          }).catch(() => {});
        }
        if (!asStr(mh.emailID) && asStr(u.email)) { mh.emailID = u.email; body.myHomeProfile = mh; patched = true; }
        if (!asStr(mh.mobileNo) && asStr(u.mobileNumber)) { mh.mobileNo = u.mobileNumber; body.myHomeProfile = mh; patched = true; }
      }

      // The priced extras have to be declared, not just added to the total: the
      // portal sends a line per extra and we sent none, so a customer charged for
      // key courier had no courier line on their order.
      const priced = new Set((lastHold.services ?? []).map((x) => x.toUpperCase()));
      const agentCount = Array.isArray(body.listBoxAgentDetail) ? (body.listBoxAgentDetail as unknown[]).length : 0;
      const wantsCourier = Boolean(body.keyDeliveryAddress) && priced.has("KEY-DELIVERY");

      // The extras list is OURS to build, not the model's to copy.
      //
      // It copied serviceCriteria straight off priceDetails -- "M", "A", "I" --
      // into a field whose enum is Mandatory/Additional/Inclusive/Undefined, and
      // the save came back with four conversion errors. The two vocabularies
      // describe the same thing and are not interchangeable, so the list is
      // rebuilt from what was actually chosen and nothing is carried across.
      const extras: Record<string, unknown>[] = [];
      if (agentCount > 0 && priced.has("AGENT")) extras.push({ quantity: agentCount, serviceType: "AGENT" });
      if (wantsCourier) extras.push({ quantity: 1, serviceType: "KEY-DELIVERY" });
      const before = Array.isArray(body.additionalServiceDetailList) ? body.additionalServiceDetailList : [];
      if (JSON.stringify(extras) !== JSON.stringify(before)) {
        if (extras.length) body.additionalServiceDetailList = extras;
        else delete body.additionalServiceDetailList;
        patched = true;
      }
      // An address for a courier this bundle does not offer goes with the line.
      if (!wantsCourier && body.keyDeliveryAddress && !priced.has("KEY-DELIVERY")) {
        delete body.keyDeliveryAddress;
        patched = true;
      }

      // The total, computed the way Emirates Post computes it.
      //
      // minimumAmount already contains the rent, the registration and the FIRST
      // agent -- that agent's line is Inclusive. Only agents beyond the first are
      // charged, plus the courier if it was chosen. The model added the first
      // agent's 50 on top, showed the customer 450, and the backend answered
      // "121 MISMATCH_IN_AMOUNT: TotalAmountShouldBe:400".
      if (typeof lastHold.amount === "number") {
        // The same function the summary and the payment use. Three copies of
        // this sum disagreed with each other; there is one now.
        const { total } = rentalTotal(
          { base: lastHold.amount, agentExtraPrice: lastHold.agentExtraPrice, keyDeliveryPrice: lastHold.keyDeliveryPrice },
          { agentCount, keyDelivery: wantsCourier }
        );
        if (body.totalAmount !== total) {
          body.totalAmount = total;
          patched = true;
        }
      }

      if (patched) input = { ...input, body };
    }

    if (/submitlicenserequest$/i.test(toolName)) {
      if ((opts.epglDocuments ?? []).length) {
        input = withEpglDocumentPlaceholders(input, opts.epglDocuments ?? []) ?? input;
      }
      if (opts.epglRequestFacts) {
        input = withEpglRequestFields(input, opts.epglRequestFacts) ?? input;
      }
    }

    // The documents the customer uploaded, onto the rental they belong to.
    //
    // Their portal puts the trade licence and the owner's ID in
    // mainCorporateProfile.attachments, and each agent's ID pages in that agent's
    // own listBoxAgentDetail entry, with a numeric attachmentType per document.
    // We asked customers for all of these and sent none of them.
    if (/rental_save$/i.test(toolName) && opts.rentalAttachments) {
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      // Read the bytes only now. A base64 document is hundreds of kilobytes and
      // this is the one call in the conversation that needs them.
      const files = await opts.rentalAttachments().catch(() => []);
      const pick = (...keys: string[]) => files.find((f) => keys.includes(f.key));
      const attach = (f: { fileName: string; fileFormat: string; base64: string } | undefined, type: number) =>
        f ? [{ attachmentName: f.fileName, attachment: f.base64, fileFormat: f.fileFormat, attachmentType: type }] : [];
      let patched = false;

      // Corporate: trade licence 3, owner ID front 1, owner ID back 2 -- the
      // numbering their own rent flow uses.
      const corp = body.mainCorporateProfile as Record<string, unknown> | undefined;
      if (corp && !Array.isArray(corp.attachments)) {
        const list = [
          ...attach(pick("trade_license", "trade_licence"), 3),
          ...attach(pick("owner_id_front", "owner_eid_front"), 1),
          ...attach(pick("owner_id_back", "owner_eid_back"), 2),
        ];
        if (list.length) {
          body.mainCorporateProfile = { ...corp, attachments: list };
          patched = true;
        }
      }

      // Agents: ID front 1, back 2. A different numbering from the corporate
      // block above, which is theirs, not a mistake here.
      const agents = body.listBoxAgentDetail;
      if (Array.isArray(agents) && agents.length) {
        const front = pick("agent_eid_front", "agent_id_front");
        const back = pick("agent_eid_back", "agent_id_back");
        if (front || back) {
          const next = agents.map((a, i) => {
            const row = { ...(a as Record<string, unknown>) };
            // Only the first agent's pages are on the case; a second agent's
            // documents would be its own uploads, and inventing them is worse
            // than leaving them off.
            if (i > 0 || Array.isArray(row.attachments)) return row;
            const list = [...attach(front, 1), ...attach(back, 2)];
            if (list.length) row.attachments = list;
            return row;
          });
          if (JSON.stringify(next) !== JSON.stringify(agents)) {
            body.listBoxAgentDetail = next;
            patched = true;
          }
        }
      }
      if (patched) input = { ...input, body };
    }

    // Guest renewal: the same two gaps that took a day on Rental/Save.
    //
    // Guest/Renewal/Save answered 500 "Internal system error" on 2 Sep with a body
    // carrying only the box, the date and the amount. Their own guest flow asks
    // for the subscriber and a billing address before it will take a payment
    // (customerKYC and paymentProperties.billingDetail), and neither was there.
    // A 500 says nothing about which field is missing, so the missing ones are
    // filled where they can be and the call is refused where they cannot.
    if (/guest_renewal_save$/i.test(toolName)) {
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      const kyc = (body.customerKYC ?? {}) as Record<string, unknown>;
      const first = asStr(kyc.firstName);
      const last = asStr(kyc.lastName);
      const email = asStr(kyc.email);
      const mobile = asStr(kyc.mobileNumber);
      if (!first || !last || !email || !mobile) {
        void audit({
          agentId,
          conversationId: opts.conversationId,
          actor: "system",
          action: "integration_call_failed",
          payload: { tool: toolName, method: entry.op.method, path: entry.op.path, input: auditableInput(input), response: "REFUSED LOCALLY: customerKYC incomplete" },
        }).catch(() => {});
        return {
          result:
            "This renewal cannot be saved yet: Emirates Post needs the subscriber's details before it will take a payment, and the request is missing some. Ask the customer for whichever of these you do not already have — first name, last name, mobile number, email address — and who is renewing the box (owner, family member, authorised agent, company employee or other, from the renewed-by options). Then send them as customerKYC { firstName, lastName, email, mobileNumber, renewalUserCapacity }. Do NOT retry this call until you have all four. Nothing has gone wrong and the customer has not been charged.",
          isError: true,
        };
      }
      // billingDetail, exactly as on the rental save: optional in the spec,
      // required in practice, and all six fields or none.
      const pay = { ...((body.paymentProperties ?? {}) as Record<string, unknown>) };
      const em = asStr(body.emirateCode) || asStr(kyc.area);
      const given = (pay.billingDetail ?? {}) as Record<string, unknown>;
      const filled = {
        firstName: asStr(given.firstName) || first,
        lastName: asStr(given.lastName) || last,
        emailAddress: asStr(given.emailAddress) || email,
        address: asStr(given.address) || asStr(kyc.address1) || em || "United Arab Emirates",
        cityName: asStr(given.cityName) || em || "United Arab Emirates",
        countryName: asStr(given.countryName) || "United Arab Emirates",
      };
      let patched = false;
      if (JSON.stringify(given) !== JSON.stringify(filled)) {
        pay.billingDetail = filled;
        patched = true;
      }
      if (opts.paymentReturnUrl && pay.paymentReturnUrl !== opts.paymentReturnUrl) {
        pay.paymentReturnUrl = opts.paymentReturnUrl;
        patched = true;
      }
      // A guest has no account to save a card to and nothing to auto-renew from.
      if (pay.saveCreditCard === true || pay.isAutomaticSubscriptionEnabled === true) {
        pay.saveCreditCard = false;
        pay.isAutomaticSubscriptionEnabled = false;
        patched = true;
      }
      if (patched) {
        body.paymentProperties = pay;
        input = { ...input, body };
      }
    }

    // The guest renewal's confirm takes the reference in the BODY. Same rule as
    // the rental's: the reference is the one Emirates Post issued, not one the
    // model remembered.
    if (/guest_renewal_confirmpayment$/i.test(toolName)) {
      if (!gatewayPayment) {
        return {
          result:
            "There is no payment to confirm yet. A payment reference only exists once the renewal has been saved and Emirates Post has opened the payment, and that has not happened in this conversation — so this call would fail whatever is sent. Save the renewal first, give the customer its payment link, and confirm only after they say they have paid.",
          isError: true,
        };
      }
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      if (body.paymentReferenceNumber !== gatewayPayment.reference) {
        body.paymentReferenceNumber = gatewayPayment.reference;
      }
      if (!asStr(body.requestSource)) body.requestSource = "PoBoxAIBot";
      input = { ...input, body };
    }

    // UpdatePayment takes the reference in the PATH; send the one we were given.
    if (/updatepayment/i.test(toolName)) {
      if (!lastHold?.paymentRef) {
        return {
          result:
            "There is no order to confirm yet. A payment reference only exists once the save has created the order, and that has not happened in this conversation — so this call would fail whatever is sent. Create the order first, give the customer its payment link, and confirm only after they say they have paid.",
          isError: true,
        };
      }
      if (input?.paymentReferenceNo !== lastHold.paymentRef) {
        input = { ...input, paymentReferenceNo: lastHold.paymentRef };
      }
    }

    const gate = opts.blockUnpaidSaves;
    if (gate && !gate.paid && gate.toolSuffixes.some((sfx) => toolName.endsWith(sfx))) {
      return {
        result:
          "This submission cannot be recorded yet: the customer has NOT paid. Do not call this tool again until the payment has settled. Take the payment first, then call it once. Do not tell the customer anything failed -- nothing has gone wrong and they have not been charged; simply continue to the payment step.",
        isError: true,
      };
    }
    const cacheKey = readCacheKey(entry.op, toolName, input, opts, runtimeToken());
    if (cacheKey) {
      const hit = readCache(cacheKey);
      if (process.env.DIALOG_DEBUG_CACHE === "1") {
        console.log(`[lookup-cache] ${hit ? "HIT " : "miss"} ${toolName} ${JSON.stringify(input ?? {})}`);
      }
      // A cached Details response still teaches us the box's expiry. Reading it
      // here matters: this early return sits BEFORE the capture further down, so
      // without it the anniversary correction above quietly stopped working the
      // moment the cache warmed up.
      if (hit) { rememberExpiry(toolName, hit); return hit; }
    } else if (process.env.DIALOG_DEBUG_CACHE === "1") {
      console.log(`[lookup-cache] skip ${toolName} (${entry.op.method}${isAuthOperation(entry.op) ? ", auth op" : ""})`);
    }
    // TEST-ONLY: for the mock persona, substitute realistic responses for the EP
    // ops that can't hit the real API (no live session / fake box) so the demo
    // completes. Branch locations are real (auth=false), so not simulated here.
    if (opts.mockSimulate) {
      const sim = simulateNxnMockOp(toolName, input ?? {});
      if (sim) return sim;
    }
    // MyHome availability is EMIRATE-wide, not branch-by-branch.
    //
    // LocationId means two different things depending on the bundle: an officeId
    // for MyBox, an emirate code for MyHome and MyHome Instant. Sending an officeId
    // for MyHome returns an empty list rather than an error — which reads as "no
    // boxes here" and had every one of the 75 branches looking sold out while the
    // portal was showing hundreds. Confirmed with Emirates Post 31 Aug; DXB returns
    // 471 boxes by emirate and 0 by officeId.
    if (/freeboxes/i.test(toolName)) {
      const inp = { ...((input ?? {}) as Record<string, unknown>) };
      const bundle = asStr(inp.BundleId ?? inp.bundleId).toUpperCase();
      const loc = asStr(inp.LocationId ?? inp.locationId);
      if (/^MYHOME/.test(bundle) && /^\d+$/.test(loc)) {
        // lastBranchQuery only holds within a turn, and the branch is usually chosen
        // in an earlier one — which is why the first version of this silently did
        // nothing. The officeId itself carries the emirate: every branch Emirates
        // Post lists is numbered by it (checked against all 75 on 31 Aug).
        const byOfficeId: Record<string, string> = {
          "1": "AUH", "2": "DXB", "3": "SHJ", "4": "AJM", "5": "UAQ", "6": "RAK", "7": "FUJ",
          "9": "DXB", // 999 DIRECT DELIVERY, listed under Dubai
        };
        const emirate =
          asStr(inp.EmirateCode ?? inp.emirateCode).toUpperCase() ||
          lastBranchQuery?.emirate ||
          byOfficeId[loc[0] ?? ""] ||
          "";
        lastMyHomeOfficeId = loc;
        if (emirate) {
          inp.LocationId = emirate;
          delete inp.locationId;
          input = inp;
        }
      }
    }
    // Capture branch-locations queries (BundleId + EmirateCode) for the map widget.
    if (/boxlocations/i.test(toolName)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const bundle = asStr(inp.BundleId ?? inp.bundleId ?? inp.bundle_Id ?? inp.bundle);
      const emirate = asStr(inp.EmirateCode ?? inp.emirateCode ?? inp.Emirate ?? inp.emirate).toUpperCase();
      if (bundle && emirate) lastBranchQuery = { emirate, bundle };
    }
    // Decrypt stored secrets only at the moment of the outbound call.
    const liveSpec: EnvSpec = {
      ...entry.spec,
      authValue: isEncrypted(entry.spec.authValue) ? decryptSecret(entry.spec.authValue) : entry.spec.authValue,
      apiKey: isEncrypted(entry.spec.apiKey) ? decryptSecret(entry.spec.apiKey) : entry.spec.apiKey,
    };
    // Guest privacy: with no verified identity (no UAE PASS / OTP session and the
    // conversation isn't authenticated), backend responses are PII-redacted before
    // the model sees them — a guest proving knowledge of a box number must not
    // learn the holder's name, email, phone, or ID.
    const identified = Boolean(opts.authenticated) || Boolean(runtimeToken()) || Boolean(opts.uaePassToken);
    let res = await executeOperation(liveSpec, entry.op, input ?? {}, runtimeToken(), {
      redactPII: !identified,
      identityToken: opts.uaePassToken,
      // Already-verified customer: a backend 401 must never be reported as "sign in
      // again" (FB-1485) — their identity is fine, that backend session is not.
      customerAuthenticated: Boolean(opts.authenticated) || Boolean(opts.uaePassToken),
    });

    /**
     * The saved card was refused, so try again WITHOUT it.
     *
     * Emirates Post answers a rental save carrying an unusable saved card with
     * `400 {"errorDetails":{"Error":"Error from payment gateway"}}` -- seen with
     * the token VISA1111 on a staging account. The card is theirs, not ours, and
     * we cannot tell a good token from a bad one before sending it.
     *
     * Without this the journey simply stops: the box is held, nothing is
     * charged, and the customer is offered "try again", which sends the same
     * card and fails the same way. Dropping the card and retrying opens the
     * payment page for them to enter one, which is what they would have got had
     * they picked "a different card" -- so it turns a dead end into the path
     * they can actually finish on.
     *
     * Once, and only for this specific failure: a retry loop against a payment
     * endpoint is its own kind of danger.
     */
    if (
      res.isError &&
      /rental_save$/i.test(toolName) &&
      /error from payment gateway/i.test(res.result ?? "") &&
      (((input?.body as Record<string, unknown>)?.paymentProperties as Record<string, unknown>)?.savedCard)
    ) {
      const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
      const pay = { ...((body.paymentProperties ?? {}) as Record<string, unknown>) };
      delete pay.savedCard;
      body.paymentProperties = pay;
      const retryInput = { ...input, body };
      const retry = await executeOperation(liveSpec, entry.op, retryInput, runtimeToken(), {
        redactPII: !identified,
        identityToken: opts.uaePassToken,
        customerAuthenticated: Boolean(opts.authenticated) || Boolean(opts.uaePassToken),
      });
      void audit({
        agentId,
        conversationId: opts.conversationId,
        actor: "system",
        action: retry.isError ? "rental_save_retry_without_card_failed" : "rental_save_retried_without_card",
        payload: { tool: toolName, path: entry.op.path },
      }).catch(() => {});
      if (!retry.isError) {
        input = retryInput;
        res = {
          ...retry,
          result:
            retry.result +
            "\n\nTHE SAVED CARD WAS REFUSED by Emirates Post's payment gateway, so the order was created WITHOUT it and the payment page will ask for card details instead. Tell the customer plainly that their saved card could not be used this time and they will need to enter a card on the payment page — do NOT say the payment failed, because no payment was attempted, and do NOT offer to retry with the saved card.",
        };
      }
    }
    // The hold Emirates Post issued, kept out of the model's hands.
    //
    // Rental/Save looks its reservation up by subscriptionReferenceNumber, and the
    // only place that value exists is the Rental/Select response. Asked to carry it
    // across, the model instead sent "SUB-378785-2026" — a number shaped like a
    // reference and belonging to nothing — after telling the customer "the hold is
    // confirmed". The customer was charged and the box was never booked. So the
    // value is captured here and written into the save below; a reference is not
    // something to be recalled, it is something to be held onto.
    if (!res.isError && /rental_select$/i.test(toolName)) {
      // The registration fee for this bundle, in this environment, straight from
      // Emirates Post — so the NEXT customer sees the amount on the bundle card
      // instead of a promise that it will be shown later.
      rememberFees(toolName, res.result);
      let lastHoldDetails: unknown = null;
      try {
        const body = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = body?.payload ?? body;
        lastHoldDetails = p?.priceDetails ?? null;
        const ref = p?.subscriptionReferenceNumber;
        if (ref) {
          lastHold = {
            reference: String(ref),
            amount: typeof p?.minimumAmount === "number" ? p.minimumAmount : null,
            expiresAt: p?.subcsriptionReferenceNumberExpiryDate ?? p?.subscriptionReferenceNumberExpiryDate ?? null,
            uniqueBoxId: String(((input?.body ?? {}) as Record<string, unknown>).uniqueBoxID ?? "") || null,
            // The term this reservation is actually for, in the backend's words.
            expiryDate: p?.poBoxExpiryDate ? String(p.poBoxExpiryDate) : null,
            bundleId: String(((input?.body ?? {}) as Record<string, unknown>).bundleId ?? "") || null,
            // Which extras this box can actually carry. The portal reads the same
            // list to decide whether to OFFER key delivery at all; sending a line
            // for a service Emirates Post did not price returns 223
            // INVALID_ADDITIONAL_SERVICE and the whole rental stops.
            services: Array.isArray(p?.priceDetails)
              ? p.priceDetails.map((d: Record<string, unknown>) => String(d?.serviceType ?? "")).filter(Boolean)
              : [],
            // What an EXTRA agent and a key courier cost. serviceCriteria is the
            // whole point: an AGENT line marked "I" is Inclusive -- the first
            // agent, already inside minimumAmount -- and one marked "A" is what
            // each further agent adds. Reading the wrong one is how a customer
            // was quoted 450 for a 400 rental.
            agentExtraPrice: priceOf(p?.priceDetails, "AGENT", "A"),
            // What the FIRST agent is worth. It is already inside minimumAmount
            // — its line comes back Inclusive — but "Included" with no figure
            // beside it reads as a fee nobody will name.
            agentIncludedPrice: priceOf(p?.priceDetails, "AGENT", "I"),
            keyDeliveryPrice: priceOf(p?.priceDetails, "KEY-DELIVERY"),
          };
        }
      } catch {
        /* a Select we cannot read leaves lastHold alone; the save below refuses */
      }
      // Tell the model what the rental actually costs.
      //
      // minimumAmount already includes the rent, the registration and the FIRST
      // agent -- whose line comes back marked Inclusive. Reading priceDetails as
      // a list of things to add up produced a summary of 450 for a 400 rental:
      // the customer saw an agent fee, then saw it disappear when the backend
      // refused the amount. So the arithmetic is done here and the answer is
      // handed over, rather than left to be inferred from five lines.
      if (lastHold && typeof lastHold.amount === "number") {
        const agentExtra = lastHold.agentExtraPrice;
        const courier = lastHold.keyDeliveryPrice;
        // Which term did they take? The hold does not say, so it is matched by
        // price against the bundle's own table: the one whose price leaves a
        // plausible registration fee. With one term priced there is no ambiguity.
        const terms = bundlePriceBook.get(lastHold.bundleId ?? "") ?? [];
        // Emirates Post itemises the fee as a NEW-REG line. Read it; the
        // subtraction below is only the fallback for a response that omits it.
        const regFee =
          priceOf(lastHoldDetails, "NEW-REG") ??
          (terms
            .map((t) => registrationFee(lastHold!.amount, t.price))
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b)[0] ?? null);
        res = {
          ...res,
          result:
            res.result +
            `\n\nWHAT THIS RENTAL COSTS. The total for the box, with one authorised agent and no courier, is AED ${lastHold.amount.toFixed(2)} — minimumAmount above. It ALREADY includes the annual rental, the registration fee and the first agent (its AGENT line is marked Inclusive, which means free). Do NOT add the first agent's fee: a summary that did showed AED 450 for a 400 rental.` +
            // The registration fee, at last with a figure. Derived, not guessed:
            // the hold minus the published price of the term they chose. Stated
            // only when that subtraction is trustworthy.
            (regFee !== null
              ? ` THE ONE-TIME REGISTRATION FEE IS AED ${regFee.toFixed(2)}. The box is now reserved, so this figure is known — and this is the moment to show it. BEFORE you open the payment card, give the customer the final itemised total as a summary block, with the registration fee on its own line:\n` +
                "```summary\ntitle: What you will pay\n" +
                `- Box rental: AED ${(lastHold.amount - regFee).toFixed(2)}\n` +
                `- One-time registration fee: AED ${regFee.toFixed(2)}\n` +
                "- <any extra agents or key delivery, each on its own line>\n" +
                "- Total: AED <the AMOUNT TO CHARGE given to you>\n```\n" +
                "Their earlier summary could not name this amount because the box had not been reserved yet, so if it said the fee would be shown before payment, this is where that promise is kept. Never send them to the payment page without it."
              : " A one-time registration fee is inside that total. Its exact amount cannot be separated out for this rental, so say a one-time registration fee is included and do NOT state a figure for it.") +
            (lastHold.agentIncludedPrice
              ? ` THE FIRST AUTHORISED AGENT COSTS THE CUSTOMER NOTHING. Emirates Post prices that line at AED ${lastHold.agentIncludedPrice.toFixed(2)} and marks it Inclusive, which means it is what a further agent would cost and NOT a charge on this rental — minimumAmount above is the rental plus the registration fee and nothing else. Write the row as \`- Authorised agent (their name): No charge — the first agent is included\`. Do NOT print ${lastHold.agentIncludedPrice.toFixed(2)} beside their name: a customer reads a figure next to a service as a fee, asks why it is there, and they are right to.`
              : "") +
            (agentExtra
              ? (() => {
                  // The AGENT line is priced for the TERM, not per year: 50 for
                  // one year, 150 for three, 250 for five. Emirates Post's own
                  // page writes "AED 150 per year" on a three-year box, which is
                  // the term total wearing the wrong label — so say both, and
                  // say which is which.
                  const yrs = lastHold.expiryDate ? yearsUntil(lastHold.expiryDate) : null;
                  const perYear = yrs && yrs > 0 ? agentExtra / yrs : null;
                  return ` EACH AGENT AFTER THE FIRST ADDS AED ${agentExtra.toFixed(2)}${
                    yrs && perYear ? ` for the ${yrs === 1 ? "year" : `${yrs} years`} — AED ${perYear.toFixed(2)} a year` : ""
                  }, and each of those IS added to the total. That figure already covers the whole term: do NOT multiply it by the years again.`;
                })()
              : "") +
            (courier ? ` Key courier delivery adds AED ${courier.toFixed(2)} if the customer chooses it.` : " Key courier delivery is not offered for this bundle.") +
            (opts.savedCard ? " If Emirates Post already holds a card for this customer it is sent with the order, so the payment page opens on that card — tell them which card it is and that they can change it there. Never say they have been charged, and never ask them for card details yourself." : "") +
            ` Show the breakdown from priceDetails if you like, but the TOTAL is that sum and nothing else. You do not need to send it — totalAmount is set for you from these figures.` +
            ` AED ${lastHold.amount.toFixed(2)} IS NOT "THE CONFIRMED TOTAL". It is minimumAmount: the box before the customer adds anything to it. Once they have taken a courier or a second agent, the amount to charge is HIGHER than it, the summary card and the payment page will both say so, and a sentence quoting ${lastHold.amount.toFixed(2)} beside them reads as a correction of a card that was right. On 6 September a customer was shown a card footed at 1,300 and told underneath it that Emirates Post had confirmed 1,270. Do not describe this figure as confirmed, final, or the total, and never put a second total in prose next to a card that already carries one.`,
        };
      }
      // The hold expiry reaches the customer as a deadline, and the backend
      // states it in UTC — so the chat told a Dubai customer their box was held
      // until "14:46 UTC", four hours earlier than the truth and in a timezone
      // nobody here reads the clock in. Convert it once, here, rather than hoping.
      if (lastHold?.expiresAt) {
        const t = Date.parse(lastHold.expiresAt.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(lastHold.expiresAt)
          ? lastHold.expiresAt
          : `${lastHold.expiresAt}Z`);
        if (Number.isFinite(t)) {
          const uae = new Date(t + 4 * 3600_000);
          const hh = String(uae.getUTCHours()).padStart(2, "0");
          const mm = String(uae.getUTCMinutes()).padStart(2, "0");
          const dd = String(uae.getUTCDate()).padStart(2, "0");
          const mo = String(uae.getUTCMonth() + 1).padStart(2, "0");
          res = {
            ...res,
            result:
              res.result +
              `\n\nTHE HOLD EXPIRES AT ${hh}:${mm} ON ${dd}-${mo}-${uae.getUTCFullYear()}, UAE TIME. Use exactly that when you tell the customer their deadline — write it as "${hh}:${mm} (UAE time)". The expiry in the response above is UTC; do not repeat it, do not say "UTC", and do not convert it yourself.`,
          };
        }
      }
    }
    // Remember the ids the backend actually issued. uniqueBoxId is not derivable
    // from the box number — MyBox prefixes it with 2, MyHome does not — so the only
    // safe source is this response.
    if (!res.isError && /freeboxes/i.test(toolName)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const rows = b?.payload ?? b;
        if (Array.isArray(rows) && rows.length) {
          offeredBoxIds = rows
            .map((x: Record<string, unknown>) => String(x?.uniqueBoxId ?? ""))
            .filter(Boolean)
            .slice(0, 400);
        }
      } catch {
        /* an unreadable list leaves the previous ids in place */
      }
    }
    // The duplicate check, asked ONCE.
    //
    // It returns every application ever filed for this trade licence, and the
    // list grows with each test or resubmission, so the model kept putting the
    // same question in front of the customer -- "there are drafts, update one
    // instead?" -- on every attempt. They had already answered it. Once they
    // have chosen, the choice is recorded on the case and the model is told to
    // proceed rather than ask again.
    if (!res.isError && /duplicatecheck$/i.test(toolName)) {
      const decided = opts.duplicateDecision?.();
      res = {
        ...res,
        result:
          res.result +
          (decided
            ? `\n\nTHE CUSTOMER HAS ALREADY ANSWERED THIS. They chose: ${decided}. Do NOT show the list of existing applications again and do NOT ask whether to update one — they have decided, and asking a second time reads as not having listened. Proceed on that decision.`
            : "\n\nIf this returns existing applications, put the choice to the customer ONCE — update an existing one, or submit as new — and then remember what they said. Asking again on a later attempt, with the same list, is the same question they have already answered."),
      };
    }
    // The rental periods, priced from the bundle rather than multiplied.
    //
    // Rental/ExpiryDates returns DATES and no prices at all, so the model had the
    // annual figure and a list of dates and did the only thing it could: 300 x
    // the number of years. Every term came out exactly linear -- 600, 900, 1500,
    // 3000 -- which is not what Emirates Post charges, and it hid the multi-year
    // discount entirely. The real per-term prices were read from Rental/Bundle
    // earlier in the same conversation, so they are attached here.
    if (!res.isError && /rental_expirydates$/i.test(toolName)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const bundleId = asStr(inp.bundleId ?? inp.BundleId);
      const periods = await bundlePricesFor(bundleId);
      if (periods.length) {
        const savings = periodSavings(periods);
        const bySaving = new Map(savings.map((x) => [x.months, x]));
        const lines = periods.map((pd) => {
          const sv = bySaving.get(pd.months);
          return (
            `  ${pd.years} year${pd.years === 1 ? "" : "s"}: AED ${pd.price.toFixed(2)} TOTAL` +
            (sv ? ` — saves AED ${sv.saving.toFixed(2)} (${sv.percent}%) against ${sv.years} x AED ${(sv.yearlyEquivalent / sv.years).toFixed(2)}` : "")
          );
        });
        res = {
          ...res,
          result:
            res.result +
            "\n\nTHESE ARE THE PRICES FOR EACH PERIOD. This response carries DATES ONLY — it has no prices in it — so take them from here and NEVER multiply the yearly price by the number of years. Doing that produced 2 years = AED 600 for a bundle that actually costs less, and it hid the multi-year discount completely:\n" +
            lines.join("\n") +
            (savings.length
              ? "\nPut the total in `price` and the saving in `pricenote` (e.g. `pricenote: saves AED 50 (8%) vs paying yearly`) so the discount is visible on the card where the customer is choosing. Quote the saving exactly as given above." +
                " A period with no saving listed has none — say nothing about a discount for it rather than implying one."
              : "\nNone of these periods carries a discount, so do NOT suggest one — quote the totals as they are.") +
            "\nA period listed here with no price above is not priced for this bundle: offer the dates you have prices for.",
        };
      }
    }
    // A renewal offers the customer's own bundle and the tiers ABOVE it, never
    // below. Emirates Post does not support downgrading here, so a cheaper
    // bundle on the list is a choice that cannot complete -- and the customer
    // only discovers that after picking it.
    if (!res.isError && /renewal_details/i.test(toolName)) {
      try {
        const parsed = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const sub = (parsed?.payload?.poBoxRenewalDetails ?? parsed?.payload ?? parsed)?.poBoxSubscriptionDetails as
          | Record<string, unknown>
          | undefined;
        const possible = sub?.listPossibleBundles;
        if (sub && Array.isArray(possible) && possible.length) {
          const current = sub.currentBundle as RenewalBundle | undefined;
          const { bundles, dropped } = renewalChoices(possible as RenewalBundle[], current);
          const up = upgradesAmong(bundles, current);
          // The annotation used to be written ONLY when a lower tier had been
          // filtered out, so a MyHome customer — who has nothing below them and
          // MyHome Instant above — got no instruction at all, and the upgrade
          // Emirates Post asked to be offered was never mentioned. The list being
          // present is what matters, not whether anything was removed from it.
          if (dropped > 0 || up.length) {
            sub.listPossibleBundles = bundles;
            const currentName = String(current?.bundleName ?? current?.bundleId ?? "their current bundle").trim();
            res = {
              ...res,
              raw: JSON.stringify(parsed),
              result:
                `${res.result.slice(0, res.result.indexOf("\n") + 1)}${JSON.stringify(parsed)}` +
                (up.length
                  ? `\n\nTHIS BOX CAN BE UPGRADED, AND THE RENEWAL IS WHERE TO SAY SO. The customer is on ${currentName}; Emirates Post also offers ${up
                      .map((b) => describeBundle(b))
                      .join(", ")} on this renewal. When you present the renewal, offer the upgrade as a plain choice beside renewing on ${currentName} — one line each, with the price — and let them pick. Do not talk them into it and do not pre-select it.\n` +
                    `To price an upgrade, call renewal pricing again with newBundleId set to the chosen bundle's bundleId from the list above and isBundleChanged true; the total on the summary must then be the one that pricing returned, never the old bundle's. If they stay where they are, price it as ${currentName} with isBundleChanged false.`
                  : "") +
                (dropped > 0
                  ? `\n\nlistPossibleBundles has already been filtered to the customer's CURRENT bundle and the tiers above it; ${dropped} lower tier(s) were removed because a renewal cannot downgrade. Offer exactly what is left and do not mention the ones that are missing. If the customer asks to move to a cheaper bundle, say plainly that a renewal keeps their current bundle or upgrades it, and that changing down is done through Emirates Post directly.`
                  : ""),
            };
          }
        }
      } catch {
        /* an unreadable body leaves the list exactly as it arrived */
      }
    }
    // The registration fee, named on the bundle card.
    //
    // Emirates Post asked for it to sit under the price, and the price on this
    // response is the annual rental alone: MyBox reads 300 and the customer pays
    // 370. The amount is nowhere in this payload and there is no endpoint for it,
    // so the card says a fee applies and the figure comes from the hold, where it
    // is itemised. Naming a number we cannot source is how AED 25 happened.
    if (!res.isError && /rental_bundle$/i.test(toolName)) {
      // Each bundle prices its own terms, and the model was quoting bundle_Price
      // for all of them -- AED 300 whether the customer picked one year or three.
      // The per-period table is built here so there is nothing to infer.
      let periodNote = "";
      /** The bundle ids in THIS response — not every one ever looked up. */
      const idsThisCall: string[] = [];
      // Kept so the registration fee can be derived at Select: it is the hold
      // minus the published price of the term the customer chose, and nothing
      // else states it.
      try {
        const parsed = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const list = (parsed?.payload ?? parsed) as Record<string, unknown>[];
        if (Array.isArray(list)) {
          const lines = list
            .map((bn) => {
              const periods = bundlePeriods(bn);
              const id = asStr(bn.bundle_Id);
              if (id) idsThisCall.push(id);
              if (id && periods.length) bundlePriceBook.set(id, periods);
              if (periods.length < 2) return null;
              const savings = periodSavings(periods);
              return (
                `${asStr(bn.name_En) || id}: ${describePeriods(periods)}` +
                (savings.length ? `\n    SAVINGS — ${describeSavings(savings)}` : "")
              );
            })
            .filter(Boolean);
          rememberPriceBook(opts.conversationId, bundlePriceBook);
          if (lines.length) {
            periodNote =
              "\n\nEACH RENTAL PERIOD HAS ITS OWN PRICE, and where a longer term saves money the saving is stated. Show the saving on the card for that period (e.g. `badge: Save AED 50`) so a longer term reads as a choice rather than a bigger number — and quote the saving exactly as given, never work one out yourself. These are the prices: Quote these EXACTLY when you show the customer their period options — do not use the 12-month price for every period, and never multiply one period's price to reach another:\n" +
              lines.join("\n") +
              "\nA bundle not listed here prices only one term, so it has only the one price. A period the customer asks for that is not listed is not offered for that bundle — say so rather than quoting a figure for it.";
          }
        }
      } catch {
        /* an unreadable list just means no period table; the fields are still in the payload */
      }
      // THE FEE, WITH ITS AMOUNT.
      //
      // Emirates Post asked three times for the figure to sit under the price,
      // and until now the honest answer was that nothing prices it before the
      // box is reserved. It is priced afterwards, though — the NEW-REG line of
      // every Select — so the amount comes from the Selects this deployment has
      // already made, per bundle, in this environment. A bundle nobody has
      // rented yet still says the fee is shown before payment; it stops saying
      // that the moment one rental goes through.
      const selectTool = [...map.keys()].find((t) => /rental_select$/i.test(t));
      feeBook = selectTool ? await registrationFees(agentId, selectTool) : new Map<string, number>();
      const known = idsThisCall
        .map((id) => (feeBook.has(id) ? `${id} = AED ${feeBook.get(id)!.toFixed(2)}` : null))
        .filter(Boolean);
      const svcBook = selectTool ? await observedServices(agentId, selectTool) : new Map<string, string[]>();
      // Availability is per TERM, so a bundle only counts as "never" when every
      // term we have seen for it lacks the line.
      const termsSeen = (id: string) => [...svcBook.entries()].filter(([k]) => k.startsWith(`${id}|`));
      const neverCourier = idsThisCall.filter(
        (id) => termsSeen(id).length > 0 && termsSeen(id).every(([, v]) => !v.includes("KEY-DELIVERY"))
      );
      const courierNote = neverCourier.length
        ? `\n\nKEY COURIER DELIVERY IS NOT SOLD ON ${neverCourier.join(", ")} AT ANY LENGTH. Those boxes are delivered to the customer's door and the key travels with them, so Emirates Post prices no KEY-DELIVERY line at all. Do NOT offer the choice, do NOT put AED 30 on anything and do NOT add it to a total — on 6 Sep a MyHome customer was offered courier delivery and charged 30 for a service that does not exist on that bundle. On the bundles that DO offer it, availability still varies by term, and the duration list will tell you which.`
        : "";
      const feeNote = known.length
        ? "\n\nTHE REGISTRATION FEE FOR THESE BUNDLES, from Emirates Post's own pricing: " +
          known.join(", ") +
          ". Put the amount in `pricenote` on that bundle's card, exactly as `pricenote: + AED <amount> one-time registration fee`, with no rounding and no arithmetic of your own. A bundle NOT named in that list has no figure yet — give it `pricenote: + one-time registration fee, shown in full before you pay` and do not borrow another bundle's number for it."
        : "\n\nNo registration fee has been observed for these bundles yet, so give every card `pricenote: + one-time registration fee, shown in full before you pay` and state no amount.";
      res = {
        ...res,
        result:
          res.result +
          periodNote +
          "\n\nbundle_Price is the TWELVE-MONTH RENTAL ONLY. Every new rental also carries a one-time registration fee, which is not in this response. Put the rental in `price` and the fee in `pricenote`, which renders as small print DIRECTLY UNDER the price where it belongs:\n" +
          "```cards\n- title: MyBox\n  price: AED 300 / year\n  pricenote: + AED 70 one-time registration fee\n  desc: Dedicated mailbox at an Emirates Post branch.\n```\n" +
          "Do NOT put it in `badge` — that renders as a large pill above the product name, which shouts a footnote louder than the price it qualifies. Do NOT put it in `desc`, which is for what the bundle IS. Do NOT add the fee to the price: the price line is the rental, the fee is its own line, and the pre-payment summary itemises both. Never leave it unmentioned — the customer would otherwise meet a total higher than the card with no warning." +
          feeNote +
          courierNote,
      };
    }
    // Tell the customer which branches actually have boxes.
    //
    // BoxLocations lists every branch in the emirate whether or not one is free,
    // so the agent offered Dubai Central — 0 boxes on 31 Aug — as the customer's
    // "usual branch", and the dead end only showed up two steps later. The count
    // is not in the response and there is no endpoint for it, so it is the
    // availability lookup itself, once per branch, run together and bounded: a
    // slow answer here is worse than an unannotated card.
    if (!res.isError && /boxlocations/i.test(toolName)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const rows = (b?.payload ?? b) as Record<string, unknown>[];
        const inp = (input ?? {}) as Record<string, unknown>;
        const bundle = asStr(inp.BundleId ?? inp.bundleId);
        const emirate = asStr(inp.EmirateCode ?? inp.emirateCode).toUpperCase();
        if (Array.isArray(rows) && rows.length && bundle) {
          // MyHome boxes are pooled across the emirate, not held at a branch, so
          // one lookup answers for all of them.
          const pooled = /^MYHOME/i.test(bundle);
          const targets = pooled ? [emirate] : rows.slice(0, 15).map((r) => asStr(r.officeId)).filter(Boolean);
          const counts = await Promise.all(
            targets.map(async (loc) => {
              const ctl = new AbortController();
              const timer = setTimeout(() => ctl.abort(), 8000);
              try {
                const u = new URL(`${String(liveSpec.baseUrl).replace(/\/$/, "")}/api/Rental/FreeBoxes`);
                u.searchParams.set("BundleId", bundle);
                u.searchParams.set("LocationId", loc);
                const h: Record<string, string> = { Accept: "application/json" };
                if (liveSpec.apiKey) h[liveSpec.apiKeyHeader || "X-API-KEY"] = String(liveSpec.apiKey);
                const tok = runtimeToken();
                if (tok) h.Authorization = `Bearer ${tok}`;
                const r = await fetch(u, { headers: h, signal: ctl.signal });
                if (!r.ok) return [loc, null] as const;
                const parsed = (await r.json()) as { payload?: unknown };
                const list = parsed?.payload ?? parsed;
                return [loc, Array.isArray(list) ? list.length : null] as const;
              } catch {
                return [loc, null] as const;
              } finally {
                clearTimeout(timer);
              }
            })
          );
          const byLoc = new Map<string, number | null>(counts);
          // Annotated AND filtered in one place, testable on its own: a branch
          // with nothing to rent is dropped rather than greyed out, and a PO Box
          // hall is marked so the customer is warned before they choose it.
          const { branches, hidden } = prepareBranches(rows as BranchRow[], byLoc, { pooled, emirate });
          const annotated = branches.length !== rows.length || branches.some((x) => x.freeBoxCount !== undefined || x.openNow !== undefined || x.isPoBoxHall);
          (b as Record<string, unknown>).payload = branches;
          const halls = branches.filter((x) => x.isPoBoxHall);
          lastBranchHalls = halls.map((h) => ({
            officeId: String(h.officeId ?? ""),
            name: String(h.nameEn ?? h.officeId ?? ""),
            alternative: String(h.alternativeBranchEn ?? ""),
          }));
          rememberHalls(opts.conversationId, lastBranchHalls);
          rememberBranches(opts.conversationId, rows as { officeId?: unknown; nameEn?: unknown }[]);
          if (annotated) {
            res = {
              ...res,
              result:
                `${res.result.slice(0, res.result.indexOf("\n") + 1)}${JSON.stringify(b)}` +
                "\n\nfreeBoxCount is how many boxes are FREE at that branch right now, counted live. Branches with none have ALREADY BEEN REMOVED from this list" +
                (hidden ? ` (${hidden} of them)` : "") +
                ", so show every branch here as available and never mention the ones that are missing. Branches with no freeBoxCount were not counted; show those normally too." +
                (halls.length
                  ? "\n\nSOME OF THESE ARE PO BOX HALLS, NOT BRANCHES: " +
                    halls.map((h) => `${h.nameEn} (keys and counter services at ${h.alternativeBranchEn ?? "another branch"})`).join("; ") +
                    ". A box hall gives access to boxes only — no counter, no parcels, no registered mail — and the KEY IS NOT ISSUED THERE. Mark each one on its card (e.g. `badge: P.O. Box Hall`). If the customer chooses one, you MUST show them this notice WORD FOR WORD before going any further, and get their explicit acknowledgement before reserving anything:\n\n" +
                    poBoxHallNotice("<the alternativeBranchEn for the hall they chose>") +
                    "\n\nSubstitute the real branch name where the placeholder is. Do not paraphrase, shorten or summarise the notice, and do not proceed on an assumed yes — a customer who is not told turns up at a room of boxes expecting a post office, with their key in another building. A hall is still a REAL OPTION and is offered like any other location on this list: the notice is a condition of choosing it, not a reason to steer them away from it."
                  : "") +
                "\n\nopenNow says whether the branch is open at this moment, in UAE time; when it is false, opensAt is when it next opens. A CLOSED branch can still be rented — say so — but the customer must be told before they pick it, not after: put `badge: Closed now` on its card and give the opening time in the line beneath (e.g. `desc: Closed now, opens 08:00`). If the branch they choose is closed, tell them plainly, say when it opens, and in the same reply name a branch from this list that is open now and has boxes, as an alternative they can take instead. Never let a customer walk to a closed counter because we did not mention it.",
              raw: JSON.stringify(b),
            };
          }
        }
      } catch {
        /* an unreadable list is shown as it came; the cards still work */
      }
    }
    // Rental/Save creates the order and OPENS a payment on Emirates Post's own
    // gateway — it does not record one already taken. Proved against staging: after
    // a 200 the N-Genius order sits at state STARTED, and UpdatePayment answers
    // {"isPaymentSuccess": false, "amountPaid": 0.0}. The box is reserved against an
    // unpaid order, which is why it never appears in the customer's portal. The
    // agent, seeing an orderNo come back, told the customer it was confirmed.
    // The payment Emirates Post opened, from whichever save opened it.
    //
    // A rental reaches it through a hold; a guest renewal has none, and reading
    // the hold there found nothing — so the customer was told their order was
    // created and, in the next line, that the payment link was not ready. The
    // order was real, and unpaid.
    if (!res.isError && /(rental_save|guest_renewal_save)$/i.test(toolName) && /paymentUrl/i.test(res.result)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = b?.payload ?? b;
        const g = p?.paymentGateWayResponse ?? {};
        if (g.paymentUrl && g.referenceNumber) {
          // What the gateway will actually ask for, in the gateway's own words.
          // N-Genius states it in the minor unit: 67000 fils is AED 670.00. The
          // chat card said AED 700 for this order because the model added up
          // priceDetails and counted the first agent, whose line is Inclusive.
          const minor = Number(g?.niOrderResult?.amount?.value);
          const cur = String(g?.niOrderResult?.amount?.currencyCode ?? "AED");
          gatewayPayment = {
            url: String(g.paymentUrl),
            reference: String(g.referenceNumber),
            orderNo: p?.orderNo ? String(p.orderNo) : p?.orderNumber ? String(p.orderNumber) : null,
            amount: Number.isFinite(minor) && minor > 0 && /^[A-Z]{3}$/.test(cur) ? minor / 100 : null,
            openedAt: new Date().toISOString(),
            // The gateway's own order id, so a refusal can be asked about
            // directly instead of being reported as "not come through yet".
            gatewayOrderId: String(g?.niOrderResult?._id ?? "").replace(/^urn:order:/, "") || null,
          };
        }
      } catch {
        /* an unreadable save leaves the confirm to fail loudly rather than quietly */
      }
    }
    // A guest renewal opens the payment the same way a rental does, so it gets
    // the same warning about what an order without a settled payment means.
    if (!res.isError && /guest_renewal_save$/i.test(toolName) && gatewayPayment) {
      res = {
        ...res,
        result:
          res.result +
          `\n\nTHE ORDER EXISTS AND IS NOT PAID. Emirates Post has opened a payment for it on their own gateway. Present the payment URL from this response as a PAY BLOCK — three backticks, then pay, then \`url: <the paymentUrl>\`, then \`amount: AED <total>\`, then three backticks — and say the renewal completes once they pay. Do NOT call it renewed, confirmed or complete on the strength of an order number. When they say they have paid, confirm it with the confirm tool and only then tell them the renewal is done.`,
      };
    }
    if (!res.isError && /rental_save$/i.test(toolName) && /paymentUrl/i.test(res.result)) {
      // Keep the reference the confirm call actually wants. The save response
      // carries two UUIDs: paymentGateWayResponse.referenceNumber, which
      // UpdatePayment answers 200 for, and niOrderResult.reference, which it
      // answers 500 for. Nothing about either says which is which.
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = b?.payload ?? b;
        const g = p?.paymentGateWayResponse ?? {};
        if (lastHold && g.referenceNumber) {
          lastHold = {
            ...lastHold,
            orderNo: p?.orderNo ? String(p.orderNo) : null,
            paymentRef: String(g.referenceNumber),
            paymentUrl: g.paymentUrl ? String(g.paymentUrl) : null,
          };
        }
      } catch {
        /* an unreadable save leaves the confirm call to fail loudly rather than quietly */
      }
      res = {
        ...res,
        result:
          res.result +
          (opts.backendGateway
            ? "\n\nNOT YET PAID ON EMIRATES POST'S SIDE. This response contains a paymentUrl, which means an order was created and a payment was OPENED on their gateway — it has not been settled. Whatever the customer paid elsewhere has not reached this order, so the box is reserved against an unpaid order and will NOT appear in their portal. Do NOT say the booking is confirmed, complete, or successful, and do NOT present the order number as a confirmation. Say the reservation is recorded and the payment still has to be completed with Emirates Post, and escalate — this needs a decision from 7X about which gateway takes the money, not a retry."
            : "\n\nTHE RENTAL IS RECORDED. This is the confirmation: give the customer the order reference from this response. The customer paid on OUR checkout, which has already settled — this response also carries a paymentUrl because the backend opens its own payment alongside the record, and that one is deliberately unused. Do NOT mention it, do NOT offer it, do NOT describe the booking as unsettled or needing reconciliation, and do NOT arrange a callback. Nothing has gone wrong."),
      };
    }
    // The moment the money is confirmed. It is not a fact the model can be asked
    // for -- it says "payment confirmed" whenever it reads well -- and the survey
    // Emirates Post asked us to show is owed to a completed purchase, not to a
    // hopeful one.
    if (!res.isError && /(updatepayment|confirmpayment)/i.test(toolName)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = b?.payload ?? b;
        // THEIR INVOICE ENDPOINT IS NOT A LINK WE CAN GIVE OUT.
        //
        // The confirm response carries `paymentDetails.invoiceUrl`, the model
        // offers it as "Download invoice", and it answers 500 Internal Server
        // Error — so the customer's last click of a completed purchase lands on
        // a stack trace. We generate our own receipt for exactly this, and it
        // works. Take the broken one away rather than asking the model not to
        // use it.
        try {
          const det = p?.paymentDetails as Record<string, unknown> | undefined;
          if (det && det.invoiceUrl) {
            delete det.invoiceUrl;
            res = {
              ...res,
              result:
                `${res.result.slice(0, res.result.indexOf("\n") + 1)}${JSON.stringify(b)}` +
                "\n\nDO NOT LINK AN INVOICE FROM THIS RESPONSE. Emirates Post's own invoice endpoint answers 500 for these references, so a customer who has just paid would click it and land on an error. The receipt link is added to your reply for you — do not write one of your own, and do not describe an invoice as available anywhere else.",
              raw: JSON.stringify(b),
            };
          }
        } catch {
          /* nothing to strip */
        }
        if (p?.isPaymentSuccess === true) {
          // A rental records it on the hold; a guest renewal has none, so the
          // gateway payment carries it instead.
          if (lastHold) lastHold = { ...lastHold, paidAt: lastHold.paidAt ?? new Date().toISOString() };
          if (gatewayPayment) gatewayPayment = { ...gatewayPayment, paidAt: gatewayPayment.paidAt ?? new Date().toISOString() };
        } else if (p && p.isPaymentSuccess === false) {
          // Ask the gateway what it actually did. "paymentStatus 2" covers a
          // declined card and a payment nobody has attempted, and telling a
          // customer whose card was refused to "try the payment page again"
          // sends them round the same loop with the same card.
          const gw = opts.gateway && gatewayPayment?.gatewayOrderId
            ? await gatewayOrderState({ ...opts.gateway, orderId: gatewayPayment.gatewayOrderId }).catch(() => null)
            : null;
          if (gw?.paid) {
            // The gateway took the money and the backend has not caught up.
            res = {
              ...res,
              result:
                res.result +
                `\n\nTHE GATEWAY SAYS THIS IS PAID${gw.card ? ` (${gw.card})` : ""} AND EMIRATES POST HAS NOT RECORDED IT YET. The customer HAS been charged. Do not ask them to pay again under any circumstances, and do not offer the payment link. Say the payment went through and is still being recorded, give them the order number, and offer a callback so it can be reconciled.`,
            };
          } else if (gw && !gw.untouched) {
            res = {
              ...res,
              result:
                res.result +
                `\n\nTHE CARD WAS REFUSED AT THE GATEWAY. N-Genius reports this attempt as ${gw.state}${gw.card ? ` on ${gw.card}` : ""}${gw.reason ? ` — ${gw.reason}` : ""}. That is a bank decline, not a fault on Emirates Post's side and not something the customer did wrong. Tell them the card was declined, say plainly that nothing has been charged, and offer to open the payment page again SO THEY CAN USE A DIFFERENT CARD — retrying the same card gets the same answer. Their reservation still stands.`,
            };
          } else if (gw?.untouched) {
            res = {
              ...res,
              result:
                res.result +
                "\n\nNO PAYMENT HAS BEEN ATTEMPTED ON THIS ORDER. The gateway has no attempt against it at all, so the customer has not finished on the payment page — they have not been charged and nothing has failed. Ask them to complete it on the page that is already open, and check again when they say they are done.",
            };
          }
          // "YOU HAVE NOT BEEN CHARGED" IS NOT OURS TO SAY.
          //
          // 4 Sep: a customer completed the payment, we checked 42 seconds later,
          // Emirates Post answered isPaymentSuccess:false / amountPaid:0, and the
          // chat told them they had not been charged and offered the button
          // again. Half an hour later the answer was still the same, so the
          // check was not premature — but nothing in that response describes the
          // customer's CARD. It describes Emirates Post's record of this order.
          // Those are different facts, and only the bank knows the first one.
          const order = String(p?.orderNumber ?? gatewayPayment?.orderNo ?? "").trim();
          const attempts = (paymentChecks.get(order || "?") ?? 0) + 1;
          paymentChecks.set(order || "?", attempts);
          res = {
            ...res,
            result:
              res.result +
              "\n\nEMIRATES POST HAS NOT RECORDED A PAYMENT AGAINST THIS ORDER. That is the whole of what this response says. It does NOT say the customer's card was untouched, and you must never tell them they have not been charged, that no money left their account, or that the payment definitely failed — a customer who has just paid reads that as us losing their money, and a bank authorisation we cannot see is not ours to rule out. Say that the payment has not reached Emirates Post against order " +
              (order ? `${order}` : "this order") +
              ", and that if their bank shows a charge they must NOT pay again." +
              (attempts >= 2
                ? " THIS IS ATTEMPT " +
                  attempts +
                  " AND THE ANSWER HAS NOT CHANGED. Stop offering the payment button: a second link for an order the gateway has already refused is how a customer ends up paying twice. Give them the order number, say Emirates Post's team will trace it, take a contact number and raise a callback."
                : " Offer to check once more in a moment, and if it is still not recorded, stop and raise a callback with the order number rather than sending them back to the payment page.") +
              " The reservation is still held, so nothing they have done is lost.",
          };
        }
      } catch {
        /* an unreadable confirm leaves the purchase unconfirmed, which is the safe way round */
      }
    }
    // A Select that FAILED means the customer has no reservation for the box they
    // just chose. Whatever was held before is for a different box, so it must not
    // stand in for this one — that is what let a charge through on a box the
    // backend had already refused.
    // A SAVE THAT FAILED IS NOT A PAYMENT.
    //
    // 15:54: Rental/Save answered 157, no order was created, no money moved —
    // and the customer was told "your payment of AED 400.00 went through on your
    // Visa ending 1111, but Emirates Post could not record the booking", with a
    // reference to quote to support. There was nothing to quote and nothing had
    // been charged. Telling someone they have paid when they have not is the
    // single worst thing this journey can say.
    // 173 names the address and means the delivery OFFICE.
    if (res.isError && /MYHOME_ADDDRESS_NOT_FOUND|"173"/.test(res.result)) {
      res = {
        ...res,
        result:
          res.result +
          "\n\n173 IS USUALLY THE DELIVERY OFFICE, NOT THE ADDRESS. myHomeProfile needs `deliveryOfficeID` — the officeId of the branch the customer chose — and every MyHome save that has ever succeeded carried one. It is filled in for you from the branch on the case; if it could not be resolved, ask the customer which branch they picked rather than asking them to re-enter their address. The other cause is `myHomeAddress.regionName`, which must hold the area CODE (\"DXB-94\"), never the area name. Do NOT tell the customer their address was not found until both of those are right — they will change a correct address to a wrong one trying to help.",
      };
    }
    if (res.isError && /INVALID BUNDLE OR RENT TYPE|"105"/.test(res.result)) {
      res = {
        ...res,
        result:
          res.result +
          "\n\n105 MEANS THE BUNDLE ID IS WRONG, not that anything is broken on Emirates Post's side. The only valid id is the one the PRICING call used — the same string, exactly — and a renewal cannot be saved as a bundle it was not priced as. Do not describe this to the customer as a backend problem with the bundle, do not send them to raise an enquiry over it, and do not try a different spelling of the name: re-read the bundle id from the pricing response and send that.",
      };
    }
    if (res.isError && /(rental_save|guest_renewal_save)$/i.test(toolName)) {
      res = {
        ...res,
        result:
          res.result +
          "\n\nNO ORDER WAS CREATED AND NO MONEY HAS MOVED. This call failed, so there is no order, no payment reference and no charge — the customer's card has not been touched, whatever card was involved. Do NOT say their payment went through, do NOT say they have been charged, do NOT give them a payment reference, and do NOT tell them to raise an enquiry about a payment that never happened. Their reservation is still held. Say plainly that the booking could not be created, that nothing has been charged, and try once more; if it fails again, offer a callback and give them ONLY the reservation reference.",
      };
    }
    if (res.isError && /rental_select$/i.test(toolName)) {
      const asked = String(((input?.body ?? {}) as Record<string, unknown>).uniqueBoxID ?? "");
      if (asked && lastHold && lastHold.uniqueBoxId !== asked) lastHold = null;
      // 108 says the box is not free. It does NOT say who has it, and the chat
      // filled that in — "it may have just been taken by another customer" —
      // which is a story about a competitor for a box that is usually held by an
      // abandoned attempt, or by us. Say what is known.
      // A refusal that names no reason. Corporate rentals hit this on 4 Sep:
      // `{"errorDetails":{},"payload":null}` — and the chat turned it into "Al
      // Barsha Post Office has no available boxes at the moment", which the
      // backend never said. An unexplained refusal has to STAY unexplained.
      if (/"errorDetails"\s*:\s*\{\s*\}/.test(res.result)) {
        res = {
          ...res,
          result:
            res.result +
            "\n\nEmirates Post refused this reservation and gave NO reason: the error object is empty. You therefore do not know why, so do not supply a reason. In particular do NOT say the branch has no boxes, that the branch is full, or that someone else took the number — none of that is in this response, and the branch listing said otherwise. Tell the customer this number could not be reserved and offer the other numbers from the same branch; if a second number fails the same way, stop trying, say the reservation service is not accepting this booking right now, and offer a callback. Never re-run the branch availability lookup to explain a failed reservation — an empty list from a lookup made afterwards is a different question, not the answer to this one.",
        };
      }
      // 154 is not a mystery: a corporate reservation sent with
      // physicalBoxRequired=false cannot be priced. Proved on staging 4 Sep —
      // the same box, same date, answered 154 with false and reserved cleanly
      // with true (260612178, AED 1,065).
      if (/ERROR_GETTING_PRICING_DETAILS|"154"/.test(res.result)) {
        res = {
          ...res,
          result:
            res.result +
            "\n\nEmirates Post could not price this reservation. Check `physicalBoxRequired` before you tell the customer anything: a box COLLECTED AT A BRANCH — MyBox and every corporate bundle — needs `physicalBoxRequired: true`, and sending false answers exactly this error. MyHome and MyHome Instant are delivered to the customer's address and take false. Correct the flag and reserve again. This is not a problem with the box, the branch or the customer, so do not describe it as one, and do not send them back to choose a different number.",
        };
      }
      if (/BOX_NOT_FREE|BOX IS NOT AVAILABLE/i.test(res.result)) {
        res = {
          ...res,
          result:
            res.result +
            "\n\nThis box cannot be reserved. Emirates Post does not say WHY, so do not say why either — in particular do NOT tell the customer another customer just took it, which is a guess that reads as bad luck they caused. Say the number is not available to reserve, apologise once, and offer the remaining numbers at the same branch. If this is a box you already reserved for them in this conversation, their reservation still stands and nothing needs redoing.",
        };
      }
    }
    // Capture a freshly-minted session token from a login/token op for reuse.
    if (!res.isError && isAuthOperation(entry.op)) {
      const body = res.result.slice(res.result.indexOf("\n") + 1);
      const tok = extractSessionToken(body);
      if (tok) captured = tok;
    }

    // STAGING ONLY — reserved test box numbers.
    // Emirates Post staging cannot serve box availability (Rental/FreeBoxes needs a
    // live EP session, and there is no inventory behind it), so every rental journey
    // stopped at the box-number step. When the real call cannot produce numbers, fall
    // back to a deterministic reserved set so the journey can be tested end to end.
    // Gated on the agent's activeEnvironment, so it disappears on its own the moment
    // an agent is switched to production.
    // ...and only while nothing tries to RESERVE what it hands out. Rental/Select
    // is the authority on availability, and it answers a made-up number with
    // "BOX_NOT_FREE" (108) — so with the hold step live these numbers send the
    // customer round a loop of boxes that were never real, four in a row, each
    // one looking like someone beat them to it. When something can check, stop
    // inventing: say availability is not published here and let the truth stand.
    const holdEnabled = [...map.keys()].some((t) => /rental_select$/i.test(t));
    if (activeEnv === "staging" && !holdEnabled && /freeboxes/i.test(toolName) && !hasBoxNumbers(res.result)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const bundleId = asStr(inp.BundleId ?? inp.bundleId ?? inp.bundle_Id);
      const locationId = asStr(inp.LocationId ?? inp.locationId ?? inp.OfficeId ?? inp.officeId);
      // Each repeat call for the same branch pages further in, so "Refresh" shows a
      // genuinely different set rather than the same numbers again.
      const key = `${bundleId}|${locationId}`;
      const page = freeBoxPages.get(key) ?? 0;
      freeBoxPages.set(key, page + 1);
      const boxes = stagingTestBoxNumbers(bundleId, locationId, page);
      return {
        result:
          `HTTP 200 OK\n${JSON.stringify({
            success: true,
            stagingTestData: true,
            count: boxes.length,
            availableBoxNumbers: boxes,
            freeBoxes: boxes.map((b) => ({ boxNumber: b, available: true })),
          })}\n\nNOTE FOR THE ASSISTANT: Emirates Post staging does not publish live box availability, so these are ` +
          `RESERVED TEST box numbers for this staging environment. Present them as the available box numbers for the ` +
          `chosen branch and let the customer pick one so the journey can continue; "Refresh" returns a different set. ` +
          `They are real, selectable choices for testing purposes — do not describe them as confirmed live inventory, ` +
          `and if the customer asks whether these are live numbers, say plainly that this is a test environment.`,
        isError: false,
      };
    }
    // The rental durations Emirates Post offers, kept verbatim. `poBoxExpiryDate`
    // must be one of these strings, offset and all, and the customer's choice of
    // duration is nothing but a choice of which one.
    if (!res.isError && /expirydates/i.test(toolName)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const dates = (b?.payload ?? b)?.dates;
        const inp = (input ?? {}) as Record<string, unknown>;
        const bundle = asStr(inp.BundleId ?? inp.bundleId ?? inp.bundle_Id);
        if (bundle && Array.isArray(dates) && dates.length) {
          expiryDatesByBundle.set(bundle, dates.map(String));
          rememberExpiryDates(opts.conversationId, expiryDatesByBundle);
          // WHAT EACH TERM COSTS.
          //
          // This response carries dates and no prices, so the cards showed five
          // durations and nothing to choose between them — and before that the
          // model was multiplying the annual rate in its head, which is the same
          // arithmetic that put AED 700 over a 670 payment page. It is not
          // guesswork: a bundle that publishes a price for a term uses that
          // price, one that does not is the annual rate for that many years, and
          // the one-time registration fee is added once. MyBox two years is
          // 600 + 70 = 670, which is exactly what the reservation comes back at.
          const periods = bundlePriceBook.get(bundle) ?? [];
          // MULTIPLYING THE ANNUAL RATE IS WRONG, and not by a little.
          //
          // Rental/Bundle returns null for every multi-year field on the
          // personal bundles, so the cards were computed as the annual rate
          // times the years. Emirates Post's pricing engine has those prices
          // anyway and they are DISCOUNTED — measured 6 Sep against real
          // reservations: MyBox five years is 1,200 not 1,500; MyHome ten years
          // is 4,000 not 6,950. The cards were overstating by nearly three
          // thousand dirhams, and the multi-year discount we were asked to show
          // was inverted.
          //
          // So a term is priced from what Emirates Post has actually charged for
          // it, or it carries no price at all. Corporate publishes its own
          // multi-year prices and those are exact.
          const rents = selectToolFor(map) ? await observedRents(agentId, selectToolFor(map)!) : new Map<string, number>();
          const svcTerms = selectToolFor(map) ? await observedServices(agentId, selectToolFor(map)!) : new Map<string, string[]>();
          const annual = periods.find((p) => p.years === 1)?.price ?? null;
          // The fee book is loaded when the bundles are listed, which may have
          // been a different turn; a duration priced without the registration
          // fee is a duration priced wrong.
          if (!feeBook.size) {
            const selTool = [...map.keys()].find((t) => /rental_select$/i.test(t));
            if (selTool) feeBook = await registrationFees(agentId, selTool);
          }
          const fee = feeBook.get(bundle) ?? null;
          // The same ladder, kept as numbers, so the guard on the way out can
          // hold the cards to it instead of trusting them to be copied.
          durationPrices = {
            bundle,
            terms: dates
              .map(String)
              .map((d) => {
                const years = yearsUntil(d);
                if (years === null) return null;
                const published = periods.find((p) => p.years === years)?.price ?? null;
                const observed = rents.get(rentKey(bundle, years)) ?? null;
                const rent = published ?? observed ?? (years === 1 ? annual : null);
                return { years, rent, fee, total: rent !== null && fee !== null ? rent + fee : rent };
              })
              .filter((t): t is { years: number; rent: number | null; fee: number | null; total: number | null } => t !== null),
          };
          const lines = dates
            .map(String)
            .map((d) => {
              const years = yearsUntil(d);
              if (years === null) return null;
              const published = periods.find((p) => p.years === years)?.price ?? null;
              const observed = rents.get(rentKey(bundle, years)) ?? null;
              // Published first (corporate states its own), then what we have
              // seen charged, and for one year the annual rate IS the term.
              const rent = published ?? observed ?? (years === 1 ? annual : null);
              if (rent === null) return null;
              const total = fee !== null ? rent + fee : rent;
              return (
                `${years} year${years === 1 ? "" : "s"} (expires ${d.slice(0, 10)}) — AED ${total.toFixed(2)}` +
                (fee !== null ? ` (rental AED ${rent.toFixed(2)} + registration AED ${fee.toFixed(2)})` : " rental, plus the one-time registration fee")
              );
            })
            .filter(Boolean);
          if (lines.length) {
            const courierTerms = dates
              .map(String)
              .map((d) => yearsUntil(d))
              .filter((y): y is number => y !== null)
              .filter((y) => svcTerms.get(rentKey(bundle, y))?.includes("KEY-DELIVERY"));
            const noCourierTerms = dates
              .map(String)
              .map((d) => yearsUntil(d))
              .filter((y): y is number => y !== null)
              .filter((y) => svcTerms.has(rentKey(bundle, y)) && !svcTerms.get(rentKey(bundle, y))!.includes("KEY-DELIVERY"));
            const unpriced = dates
              .map(String)
              .map((d) => yearsUntil(d))
              .filter((y): y is number => y !== null)
              .filter((y) => !periods.some((p) => p.years === y) && !rents.has(rentKey(bundle, y)) && y !== 1);
            res = {
              ...res,
              result:
                res.result +
                "\n\nWHAT EACH DURATION COSTS. This response carries dates and no prices, and a list of durations with no prices is not a choice. Put the amount on every duration card, exactly as given here, and never work one out yourself:\n" +
                lines.join("\n") +
                "\nThese totals already include the one-time registration fee, which is charged once however long the term is. Quote them verbatim; the reservation will come back at the same figure." +
                (courierTerms.length || noCourierTerms.length
                  ? `\nKEY COURIER DELIVERY: ${courierTerms.length ? `offered on ${courierTerms.map((y) => `${y} year${y === 1 ? "" : "s"}`).join(", ")}` : "not offered on any of these terms"}${noCourierTerms.length ? `, NOT offered on ${noCourierTerms.map((y) => `${y} year${y === 1 ? "" : "s"}`).join(", ")}` : ""}. It varies by TERM, not only by bundle — MyBox carries it at one, two and three years and not at five or ten. Offer the choice only on a term that has it, and never put AED 30 on one that does not.`
                  : "") +
                (unpriced.length
                  ? `\nNO PRICE IS AVAILABLE for ${unpriced.map((y) => `${y} years`).join(", ")}. Emirates Post discounts the longer terms and does not publish those figures, so multiplying the annual rate OVERSTATES them — a ten-year MyHome is 4,000, not 6,950. Show those durations with "price confirmed when the box is reserved" and no figure, and if the customer picks one, reserve the box and quote the exact total from the reservation before anything else.`
                  : ""),
            };
          }
        }
      } catch {
        /* an unreadable list just means the model's own date stands */
      }
    }

    // What the renewal was priced AS.
    if (!res.isError && /renewal_pricing/i.test(toolName)) {
      const b = ((input?.body ?? {}) as Record<string, unknown>);
      const bundleId = asStr(b.newBundleId ?? b.bundleId);
      const expiryDate = asStr(b.expiryDate);
      let amount: number | null = null;
      try {
        const parsed = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const a = (parsed?.payload ?? parsed)?.poBoxPrice?.amount;
        if (typeof a === "number") amount = a;
      } catch {
        /* the price is a bonus here; the bundle id is the point */
      }
      if (bundleId && expiryDate) lastPriced = { bundleId, expiryDate, amount };
    }

    // Which branch did they choose? Asking for the boxes at a hall IS choosing it.
    if (/freeboxes/i.test(toolName)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const loc = asStr(inp.LocationId ?? inp.locationId ?? inp.OfficeId ?? inp.officeId);
      const hall = loc ? lastBranchHalls.find((h) => h.officeId === loc) : undefined;
      if (hall) chosenHall = { name: hall.name, alternative: hall.alternative };
      else if (loc) chosenHall = null;
    }
    rememberExpiry(toolName, res);
    if (cacheKey && !res.isError) writeCache(cacheKey, res);
    // Keep the backend's own words. Until now a failed call existed only in the
    // model's context for that turn: the customer was told, correctly, that the
    // backend refused -- and afterwards nobody could find out what it actually said,
    // which makes "do the logs show anything?" unanswerable for the one failure mode
    // this system has most of. Errors only; a success is already visible as a case.
    // A lookup that answers 200 with an empty list is not an error, and used to
    // leave no trace at all — so "the branch has no boxes" and "we asked for the
    // wrong branch" were indistinguishable afterwards. They are very different:
    // Naif holds boxes under officeId 214 and none under its mainOfficeId 209.
    const emptyLookup =
      !res.isError && /freeboxes|boxlocations|bundle/i.test(toolName) && !hasBoxNumbers(res.result);
    // A WRITE is audited whether it succeeded or not.
    //
    // "A success is already visible as a case" held until a submission succeeded
    // and created the wrong thing. EPGL's composite answered 200, the case
    // recorded a reference, and the licence request in Salesforce was a different
    // record from the one we had recorded -- with no trace of what was sent or
    // what came back, that took a chain of inference to find rather than a query.
    // A write changes someone else's system; it is worth the row.
    const isWriteCall = entry.op.method !== "GET";
    if (res.isError || emptyLookup || isWriteCall) {
      void audit({
        agentId,
        conversationId: opts.conversationId,
        actor: "system",
        action: res.isError
          ? "integration_call_failed"
          : isWriteCall
            ? "integration_write"
            : "integration_empty_result",
        payload: {
          tool: toolName,
          method: entry.op.method,
          path: entry.op.path,
          // What we ASKED for. Without it a wrong parameter is invisible: the
          // response says "nothing here" and never says which "here".
          input: auditableInput(input),
          // Already PII-redacted for an unidentified customer, and truncated again
          // here: this is for diagnosing a backend, not for keeping their payload.
          // A write gets more room -- a composite response names an item per
          // record and the interesting one is rarely first.
          response: res.result.slice(0, isWriteCall ? 4000 : 600),
          // The registration fee, extracted before that truncation can lose it.
          // A corporate reservation prices seven services and its NEW-REG line
          // sits past 4000 characters, so the row that was meant to remember the
          // fee for the bundle cards remembered everything except the fee.
          ...(!res.isError && /rental_select$/i.test(toolName)
            ? (() => {
                const f = feesInSelectResponse(res.result);
                const r = rentInSelectResponse(res.result, new Date());
                return {
                  ...(f.size ? { fees: Object.fromEntries(f) } : {}),
                  ...(r.size ? { rents: Object.fromEntries(r) } : {}),
                };
              })()
            : {}),
        },
      }).catch(() => {
        /* diagnostics must never take down the call they are describing */
      });
    }
    return res;
  };

  return {
    tools,
    exec,
    getCapturedToken: () => captured,
    getLastBranchQuery: () => lastBranchQuery,
    getLastBranchHalls: () => lastBranchHalls,
    getChosenHall: () => chosenHall,
    getRegistrationFee: () => {
      // The bundle they chose, when we know it. Otherwise: every bundle Emirates
      // Post prices charges the same registration fee, and while that stays true
      // the figure does not depend on which one they picked. The moment two
      // differ, this stops answering rather than guessing between them.
      const forBundle = lastHold?.bundleId ? feeBook.get(lastHold.bundleId) : undefined;
      if (forBundle !== undefined) return forBundle;
      const vals = [...feeBook.values()];
      return vals.length && vals.every((v) => v === vals[0]) ? vals[0]! : null;
    },
    getDurationPrices: () => durationPrices,
    getLastHold: () => lastHold,
    getOfferedBoxIds: () => offeredBoxIds,
    getGatewayPayment: () => gatewayPayment,
    getGsbCompanies: () => [...gsbCompanies],
  };
}

/**
 * Put a renewal's target expiry on the box's OWN anniversary.
 *
 * Emirates Post accepts a renewal price only for a date that is the box's
 * current expiry with the same month and day, some whole number of years later,
 * and strictly in the future. Verified on staging: a box expiring 27-12 prices
 * on 27-12 and returns "SYSTEM ERROR ... 171" on 31-12; a past date is rejected
 * too. Our guidance used to say "year-end", which happened to work only for the
 * boxes that genuinely expire on 31 December and silently broke the rest.
 *
 * The correct date is arithmetic, not judgement, so it is computed here instead
 * of being asked of the model: the YEAR the model chose is respected (that is
 * the customer's chosen duration), while the month and day are taken from the
 * box, and the result is advanced until it is in the future. Returns a new input
 * object, or null when there is nothing to correct.
 */
export function correctPricingInputs(
  input: Record<string, unknown>,
  known: { box: string; iso: string; bundle?: string } | null,
  today = new Date()
): Record<string, unknown> | null {
  if (!known) return null;
  const body = (input?.body ?? input) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return null;
  const find = (name: string) => Object.keys(body).find((k) => k.toLowerCase() === name);
  const nextBody = { ...body };
  let changed = false;

  // ── expiry: the box's own anniversary, in the future ──
  const key = find("expirydate");
  if (key) {
    const requested = String(body[key] ?? "");
    const reqYear = Number(requested.slice(0, 4));
    const [expYear, month, day] = known.iso.split("-").map(Number);
    if (reqYear && expYear && month && day) {
      // Keep the model's chosen year (the duration), take month/day from the box,
      // then step forward whole years until the date is genuinely in the future.
      let year = Math.max(reqYear, expYear);
      const pad = (n: number) => String(n).padStart(2, "0");
      const build = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
      while (new Date(`${build(year)}T00:00:00Z`).getTime() <= today.getTime()) year++;
      const fixed = `${build(year)}T00:00:00`;
      if (fixed !== requested) { nextBody[key] = fixed; changed = true; }
    }
  }

  // ── bundle: unless the customer is CHANGING bundle, it is the box's current
  // one. The model was guessing here too and retrying after the same opaque
  // error, which cost a round and sometimes failed outright.
  const bundleKey = find("newbundleid") ?? find("bundleid");
  const changedKey = find("isbundlechanged");
  const isChanging = changedKey ? body[changedKey] === true || String(body[changedKey]).toLowerCase() === "true" : false;
  const asked = bundleKey ? String(body[bundleKey] ?? "") : "";
  // An UPGRADE is a different bundle asked for deliberately. Emirates Post only
  // prices one when `isBundleChanged` is true, and without that flag the
  // correction below would quietly put the old bundle back — so the customer
  // would be told MyHome Instant's price and charged MyHome's, or the reverse.
  // A move we recognise sets the flag; anything else is still treated as the
  // model having mistyped the current bundle.
  const upgrading = Boolean(known.bundle && asked && RENEWAL_UPGRADES[known.bundle] === asked);
  if (upgrading && !isChanging) {
    nextBody[changedKey ?? "isBundleChanged"] = true;
    changed = true;
  }
  if (bundleKey && known.bundle && !isChanging && !upgrading && asked !== known.bundle) {
    nextBody[bundleKey] = known.bundle;
    changed = true;
  }

  if (!changed) return null;
  return input?.body ? { ...input, body: nextBody } : nextBody;
}

/**
 * Short-lived cache for read-only integration lookups.
 *
 * Why: profiling a live NXN rental showed Rental/Bundle fetched again on the very
 * next turn. Each repeat is a full model round (~3s) plus a call to a backend
 * that is not always healthy, so caching removes both the latency and a failure
 * mode. Catalogue data (bundles, branches, expiry dates) does not change within
 * a conversation.
 *
 * Safety — the key includes everything that could change what a caller is
 * allowed to see, so an entry can never be served to the wrong person:
 *   - the operation and its exact inputs,
 *   - the caller's PRIVACY VIEW (guest results are PII-redacted; an identified
 *     caller must not be served a redacted entry, nor the reverse),
 *   - a fingerprint of the session token in play (a customer's own session can
 *     make the backend return their record rather than a public one).
 * Writes, auth/login operations and error responses are never cached.
 */
const LOOKUP_TTL_MS = 90_000;
const LOOKUP_CACHE_MAX = 400;
const lookupCache = new Map<string, { at: number; value: { result: string; isError?: boolean } }>();

/** Cheap, non-reversible fingerprint — the token itself is never used as a key. */
function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function readCacheKey(
  op: ApiOperation,
  toolName: string,
  input: Record<string, unknown>,
  opts: { authenticated?: boolean; uaePassToken?: string; mockSimulate?: boolean },
  token: string | undefined
): string | null {
  if (op.method.toUpperCase() !== "GET") return null;   // never cache writes
  if (isAuthOperation(op)) return null;                 // never cache token minting
  const identified = Boolean(opts.authenticated) || Boolean(token) || Boolean(opts.uaePassToken);
  return [
    toolName,
    JSON.stringify(input ?? {}),
    identified ? "id" : "guest",
    token ? fingerprint(token) : "-",
  ].join("|");
}

function readCache(key: string): { result: string; isError?: boolean } | null {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LOOKUP_TTL_MS) { lookupCache.delete(key); return null; }
  return hit.value;
}

function writeCache(key: string, value: { result: string; isError?: boolean }) {
  lookupCache.set(key, { at: Date.now(), value });
  // Bounded: drop the oldest entries once over the cap (insertion-ordered Map).
  while (lookupCache.size > LOOKUP_CACHE_MAX) {
    const oldest = lookupCache.keys().next().value;
    if (oldest === undefined) break;
    lookupCache.delete(oldest);
  }
}

/**
 * OAuth2 client-credentials token cache (e.g. Salesforce External Client App).
 * Salesforce's token endpoint takes x-www-form-urlencoded grant_type=client_credentials
 * and REJECTS a "scope" parameter (scope policy lives on the app). Tokens are
 * cached per (tokenUrl, clientId) and invalidated on a 401 so the next call
 * re-mints; Salesforce doesn't reliably return expires_in for this grant, so we
 * cap cache age conservatively.
 */
const OAUTH_CACHE_TTL_MS = 20 * 60_000;
const oauthTokens = new Map<string, { token: string; fetchedAt: number }>();

async function getClientCredentialsToken(spec: EnvSpec, forceRefresh = false): Promise<string> {
  const tokenUrl = spec.oauthTokenUrl || "";
  const clientId = spec.oauthClientId || "";
  const clientSecret = spec.authValue || "";
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("OAuth2 client-credentials integration is not fully configured (token URL / client id / secret).");
  }
  const key = `${tokenUrl}|${clientId}`;
  const hit = oauthTokens.get(key);
  if (!forceRefresh && hit && Date.now() - hit.fetchedAt < OAUTH_CACHE_TTL_MS) return hit.token;

  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`OAuth2 token request failed (HTTP ${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("OAuth2 token response had no access_token.");
  oauthTokens.set(key, { token: json.access_token, fetchedAt: Date.now() });
  return json.access_token;
}

export async function executeOperation(
  spec: EnvSpec,
  op: ApiOperation,
  input: Record<string, unknown>,
  runtimeToken?: string,
  opts: { redactPII?: boolean; identityToken?: string; customerAuthenticated?: boolean } = {}
): Promise<{ result: string; isError?: boolean; raw?: string }> {
  try {
    const tokenAuth = spec.authType === "bearer" || spec.authType === "uaepass_test" || spec.authType === "uaepass_live";
    // Effective bearer, in strict precedence (FB-1485):
    //  1. a BACKEND session for this conversation (OTP-minted / captured this turn);
    //  2. the integration's own stored service token (bearer / uaepass_test);
    //  3. the UAE PASS identity token — ONLY for uaepass_live, which is the one
    //     authType that documents the customer's UAE PASS session as its bearer.
    // Sending a UAE PASS identity token to an integration that holds its own service
    // token 401s the whole backend for signed-in customers.
    const stored = spec.authType === "bearer" || spec.authType === "uaepass_test" ? spec.authValue : null;
    const identity = spec.authType === "uaepass_live" ? opts.identityToken : undefined;
    const bearer = runtimeToken ?? stored ?? identity ?? null;
    /**
     * WHICH credential we sent — this decides what a 401 means. Rejecting the
     * customer's own UAE PASS session (which is short-lived) genuinely calls for
     * signing in again; rejecting a service token says nothing about the customer
     * and must never bounce them through sign-in.
     */
    const bearerSource: "session" | "service" | "identity" | "none" = runtimeToken
      ? "session"
      : stored
        ? "service"
        : identity
          ? "identity"
          : "none";

    // No session at all. A customer who IS already verified must never be told to
    // sign in again — that is a backend-availability problem, not an identity one.
    const signInMsg = opts.customerAuthenticated
      ? "This backend action could not be authorised: the customer is already signed in, so do NOT ask them to sign in again and do NOT start a passcode flow. Tell them this detail cannot be retrieved from the system right now, continue with whatever you can do without it, and offer a callback if it blocks them. Never invent a result."
      : "This action needs the customer to be signed in, but no active session is available yet. " +
        (spec.authType === "uaepass_live"
          ? "Ask them to sign in with UAE PASS on the website, "
          : "Start the sign-in (one-time passcode) flow to obtain a session, ") +
        "or offer a callback. Do not invent a result.";

    // A gateway/app API key is a credential in its own right: the Emirates Post
    // guest endpoints (Rental/FreeBoxes, Guest/Renewal/Details and /Pricing)
    // authorise on X-API-KEY alone even though the swagger marks them secured. So
    // an operation is only pre-blocked when we hold NO credential at all.
    // Without this, removing the UAE PASS identity token from the bearer chain
    // silently blocked those reads before they were even attempted — they had
    // been passing the pre-gate only because that token happened to fill the
    // bearer slot, never because the backend wanted it.
    const hasGatewayKey = Boolean(spec.apiKey);

    // Pre-gate ONLY operations the spec explicitly marks as secured (and only when
    // we have no credential at all and it isn't itself a login op). Guest/public
    // endpoints — and specs that declare no security at all — are NOT blocked here;
    // the backend decides via a 401/403, which we translate gracefully below.
    if (tokenAuth && !bearer && !hasGatewayKey && op.requiresAuth && !isAuthOperation(op)) {
      return { result: signInMsg, isError: true };
    }

    let path = op.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { Accept: "application/json" };

    for (const p of op.params) {
      const v = input[p.name];
      if (v === undefined || v === null || v === "") continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
      else if (p.in === "query") query.set(p.name, String(v));
      else if (p.in === "header") headers[p.name] = String(v);
    }

    // System-level OAuth2 client-credentials (e.g. Salesforce): mint/reuse a
    // cached app token. This is machine auth — never the customer's session.
    const oauthCC = spec.authType === "oauth2_cc";
    if (oauthCC) {
      try {
        headers["Authorization"] = `Bearer ${await getClientCredentialsToken(spec)}`;
      } catch (e) {
        return {
          result: `The backend integration could not authenticate: ${e instanceof Error ? e.message : "error"}. Tell the customer this service is temporarily unavailable and offer a callback — the operations team must verify the integration credentials.`,
          isError: true,
        };
      }
    } else if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (spec.authType === "apiKey" && spec.authValue) headers[spec.authHeader || "X-API-Key"] = spec.authValue;
    // Gateway/app API key sent on EVERY request when configured (e.g. NXN guest APIs).
    if (spec.apiKey) headers[spec.apiKeyHeader || "X-API-KEY"] = spec.apiKey;

    let body: string | undefined;
    if (op.hasBody && input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }

    const qs = query.toString();
    const url = `${spec.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const doFetch = async () => {
      const ctrl = new AbortController();
      // 15s is right for a lookup and far too short for a write. Rental/Save
      // creates the order AND opens a payment on Emirates Post's gateway, which
      // takes longer than that — so the whole chain would come good and then be
      // cut off at the last call, after the customer had paid. A read that hangs
      // should still fail fast; a write gets the time it needs.
      const isWrite = op.method !== "GET" && op.method !== "HEAD";
      const timer = setTimeout(() => ctrl.abort(), isWrite ? 60000 : 15000);
      try {
        return await fetch(url, { method: op.method, headers, body, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };
    let res = await doFetch();
    // Cached app token may have been revoked/expired server-side — re-mint once.
    if (oauthCC && res.status === 401) {
      try {
        headers["Authorization"] = `Bearer ${await getClientCredentialsToken(spec, true)}`;
        res = await doFetch();
      } catch {
        /* fall through to the generic 401 handling below */
      }
    }

    // Backend says auth is required/insufficient — translate to guidance instead
    // of a raw 401/403 (the backend is the source of truth for what needs a session).
    if ((res.status === 401 || res.status === 403) && tokenAuth && !isAuthOperation(op)) {
      if (!bearer) return { result: signInMsg, isError: true };
      // What was rejected decides the remedy (FB-1485).
      if (bearerSource === "identity") {
        // The customer's own UAE PASS token was refused. TWO different causes look
        // identical from here and we cannot tell them apart:
        //   (a) the session genuinely expired mid-conversation — re-signing in fixes it;
        //   (b) this backend does not accept a UAE PASS token as its bearer at all
        //       (Emirates Post mints its OWN session via Account/passwordLessToken),
        //       in which case re-signing in yields another token that fails the same
        //       way, and the customer loops forever.
        // So do not state a cause we have not established, and cap the retry at one.
        return {
          result:
            "The backend rejected the customer's UAE PASS token for this action. Do NOT tell them their session expired — we cannot tell whether it lapsed or whether this backend does not accept UAE PASS tokens at all, and stating a cause we do not know is a guess presented as fact. If you have NOT already asked them to sign in again in this conversation: say their sign-in could not be verified, ask them to sign in with UAE PASS once more, and keep everything already collected. If you HAVE already asked and it failed again, STOP asking — a second failure means re-authenticating is not the fix. Say this cannot be completed automatically right now and offer a callback. Never start a one-time-passcode flow and never invent a result.",
          isError: true,
        };
      }
      if (bearerSource === "session") {
        return {
          result:
            "The backend session obtained earlier in this conversation was rejected (expired or invalid). Re-run the sign-in (one-time passcode) flow to obtain a fresh session, or offer a callback. Do not invent a result.",
          isError: true,
        };
      }
      // A service/app credential was refused. The customer's sign-in is irrelevant,
      // so never bounce them through sign-in — that reads as being logged out.
      return {
        result:
          "This backend endpoint rejected the integration's own service credentials. The customer's sign-in is NOT the problem: do NOT ask them to sign in again, do NOT say their session expired, and do NOT start a passcode flow. Say plainly that this particular detail is not available from the system at the moment, carry on with everything you can complete without it, and offer a callback only if it genuinely blocks them.",
        isError: true,
      };
    }

    let text = await res.text();
    // Redact BEFORE truncation so a long payload can't smuggle PII past the cut.
    if (opts.redactPII) text = redactGuestPII(text);
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "…(truncated)" : text;
    // `raw` is for US, never for the model: the cut above lands mid-JSON on a long
    // response, and anything parsing the trimmed copy gets nothing. The rental save
    // is 4.3KB, so the order number and payment reference were being dropped on the
    // floor by a limit that exists to protect the prompt, not the code.
    return { result: `HTTP ${res.status} ${res.statusText}\n${trimmed}`, isError: !res.ok, raw: text };
  } catch (e) {
    // A write that timed out is not a write that failed. The request reached them
    // and may well have been carried out; we simply stopped listening. Saying it
    // failed sends the customer to support for something that may already be done,
    // and a retry could book it twice.
    const aborted = e instanceof Error && /abort/i.test(e.message);
    if (aborted && op.method !== "GET" && op.method !== "HEAD") {
      return {
        result:
          "TIMED OUT WITH THE OUTCOME UNKNOWN. The request was sent and no reply came back in time, so it may have succeeded on their side. Do NOT say it failed, do NOT say the booking was not recorded, and do NOT send it again — a retry could create a second one. Tell the customer it is taking longer than usual to confirm, that their payment is safe, and that you are checking; then check the status with a READ operation if one exists, and offer a callback only if that cannot confirm it either.",
        isError: true,
      };
    }
    return { result: `Integration call failed: ${e instanceof Error ? e.message : "error"}`, isError: true };
  }
}
