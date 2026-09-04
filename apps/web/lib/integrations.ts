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
import { renewalChoices, type RenewalBundle } from "./renewalBundles";

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
    initialHold?: { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; services?: string[]; agentExtraPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null;
  } = {}
): Promise<{
  tools: Anthropic.Tool[];
  exec: (toolName: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
  getCapturedToken: () => string | null;
  getLastBranchQuery: () => { emirate: string; bundle: string } | null;
  /** The Emirates Post hold from the last successful Rental/Select, if any. */
  getLastHold: () => { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; services?: string[]; agentExtraPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null;
  /** uniqueBoxIds from the most recent availability lookup. */
  getOfferedBoxIds: () => string[];
  /** Normalised company keys GSB has returned in this case. */
  getGsbCompanies: () => string[];
  /** The payment Emirates Post opened on their gateway, from either save. */
  getGatewayPayment: () => { url: string; reference: string; orderNo: string | null; paidAt?: string | null } | null;
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
  let lastHold: { reference: string; amount: number | null; expiresAt: string | null; uniqueBoxId?: string | null; bundleId?: string | null; services?: string[]; agentExtraPrice?: number | null; keyDeliveryPrice?: number | null; orderNo?: string | null; paymentRef?: string | null; paymentUrl?: string | null; paidAt?: string | null } | null =
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
  let gatewayPayment: { url: string; reference: string; orderNo: string | null; paidAt?: string | null } | null =
    opts.initialGatewayPayment
      ? { url: opts.initialGatewayPayment.url, reference: opts.initialGatewayPayment.reference, orderNo: opts.initialGatewayPayment.orderNo ?? null, paidAt: opts.initialGatewayPayment.paidAt ?? null }
      : null;
  let lastBranchQuery: { emirate: string; bundle: string } | null = null;
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
  const bundlePriceBook = new Map<string, BundlePeriod[]>();

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
        if (lastMyHomeOfficeId && asStr(mh.deliveryOfficeID) !== lastMyHomeOfficeId) {
          mh.deliveryOfficeID = lastMyHomeOfficeId;
          body.myHomeProfile = mh;
          patched = true;
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
      try {
        const body = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = body?.payload ?? body;
        const ref = p?.subscriptionReferenceNumber;
        if (ref) {
          lastHold = {
            reference: String(ref),
            amount: typeof p?.minimumAmount === "number" ? p.minimumAmount : null,
            expiresAt: p?.subcsriptionReferenceNumberExpiryDate ?? p?.subscriptionReferenceNumberExpiryDate ?? null,
            uniqueBoxId: String(((input?.body ?? {}) as Record<string, unknown>).uniqueBoxID ?? "") || null,
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
        const regFee = terms
          .map((t) => registrationFee(lastHold!.amount, t.price))
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b)[0] ?? null;
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
            (agentExtra ? ` Each agent AFTER the first adds AED ${agentExtra.toFixed(2)}.` : "") +
            (courier ? ` Key courier delivery adds AED ${courier.toFixed(2)} if the customer chooses it.` : " Key courier delivery is not offered for this bundle.") +
            (opts.savedCard ? " If Emirates Post already holds a card for this customer it is sent with the order, so the payment page opens on that card — tell them which card it is and that they can change it there. Never say they have been charged, and never ask them for card details yourself." : "") +
            ` Show the breakdown from priceDetails if you like, but the TOTAL is that sum and nothing else. You do not need to send it — totalAmount is set for you from these figures.`,
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
          const { bundles, dropped } = renewalChoices(possible as RenewalBundle[], sub.currentBundle as RenewalBundle);
          if (dropped > 0) {
            sub.listPossibleBundles = bundles;
            res = {
              ...res,
              raw: JSON.stringify(parsed),
              result:
                `${res.result.slice(0, res.result.indexOf("\n") + 1)}${JSON.stringify(parsed)}` +
                `\n\nlistPossibleBundles has already been filtered to the customer's CURRENT bundle and the tiers above it; ${dropped} lower tier(s) were removed because a renewal cannot downgrade. Offer exactly what is left and do not mention the ones that are missing. If the customer asks to move to a cheaper bundle, say plainly that a renewal keeps their current bundle or upgrades it, and that changing down is done through Emirates Post directly.`,
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
              if (id && periods.length) bundlePriceBook.set(id, periods);
              if (periods.length < 2) return null;
              const savings = periodSavings(periods);
              return (
                `${asStr(bn.name_En) || id}: ${describePeriods(periods)}` +
                (savings.length ? `\n    SAVINGS — ${describeSavings(savings)}` : "")
              );
            })
            .filter(Boolean);
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
      res = {
        ...res,
        result:
          res.result +
          periodNote +
          "\n\nbundle_Price is the TWELVE-MONTH RENTAL ONLY. Every new rental also carries a one-time registration fee, which is not in this response and cannot be looked up until the box is reserved. Put the rental in `price` and the fee in `pricenote`, which renders as small print DIRECTLY UNDER the price where it belongs:\n" +
          "```cards\n- title: MyBox\n  price: AED 300 / year\n  pricenote: + one-time registration fee, shown in full before you pay\n  desc: Dedicated mailbox at an Emirates Post branch.\n```\n" +
          "Do NOT put it in `badge` — that renders as a large pill above the product name, which shouts a footnote louder than the price it qualifies. Do NOT put it in `desc`, which is for what the bundle IS. Do NOT state an amount for it here and do NOT add one to the price: the figure is not knowable until the box is reserved, and it is stated in full at the pre-payment summary. Never leave it unmentioned — the customer would otherwise meet a total higher than the card with no warning.",
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
          gatewayPayment = {
            url: String(g.paymentUrl),
            reference: String(g.referenceNumber),
            orderNo: p?.orderNo ? String(p.orderNo) : p?.orderNumber ? String(p.orderNumber) : null,
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
    if (!res.isError && /(updatepayment|guest_renewal_confirmpayment)$/i.test(toolName)) {
      try {
        const b = JSON.parse(res.raw ?? res.result.slice(res.result.indexOf("\n") + 1));
        const p = b?.payload ?? b;
        if (p?.isPaymentSuccess === true) {
          // A rental records it on the hold; a guest renewal has none, so the
          // gateway payment carries it instead.
          if (lastHold) lastHold = { ...lastHold, paidAt: lastHold.paidAt ?? new Date().toISOString() };
          if (gatewayPayment) gatewayPayment = { ...gatewayPayment, paidAt: gatewayPayment.paidAt ?? new Date().toISOString() };
        }
      } catch {
        /* an unreadable confirm leaves the purchase unconfirmed, which is the safe way round */
      }
    }
    // A Select that FAILED means the customer has no reservation for the box they
    // just chose. Whatever was held before is for a different box, so it must not
    // stand in for this one — that is what let a charge through on a box the
    // backend had already refused.
    if (res.isError && /rental_select$/i.test(toolName)) {
      const asked = String(((input?.body ?? {}) as Record<string, unknown>).uniqueBoxID ?? "");
      if (asked && lastHold && lastHold.uniqueBoxId !== asked) lastHold = null;
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
  if (bundleKey && known.bundle && !isChanging && String(body[bundleKey] ?? "") !== known.bundle) {
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
