import { currentScope } from "@/lib/scope";
import { getDb, conversations, messages, cases, auditLog, agents } from "@dialog/db";
import { emptyCase, type CaseState, type Locale } from "@dialog/config";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";

export interface Session {
  conversationId: string;
  caseId: string;
  state: CaseState;
  history: { role: "user" | "assistant"; content: string }[];
  // Decrypted session token stored for this conversation, if any.
  sessionToken?: string;
  /**
   * Where that token came from. "backend" = a real backend session (e.g. minted by
   * the OTP/passwordless flow) which may be used as the bearer for protected
   * integration calls. "uaepass" = a UAE PASS OIDC access token, which proves
   * IDENTITY only — it is NOT a backend API session, so it may only be used as a
   * bearer by integrations that explicitly declare authType "uaepass_live"
   * (FB-1485: using it everywhere made every Emirates Post call 401 for a
   * signed-in customer, and the agent then asked them to sign in again).
   */
  sessionTokenKind?: "backend" | "uaepass";
  // Server-authoritative auth state for this conversation (sticky once signed in
  // via UAE PASS), used for journey gating instead of the client's claim.
  authenticated: boolean;
  // External identity (e.g. UAE PASS sub) attached at sign-in, if any.
  userRef?: string;
}

/**
 * Marker prefix that records a stored token as a UAE PASS identity token rather
 * than a backend API session. Kept inside the encrypted value so no schema change
 * is needed; a value without the prefix is a backend session (legacy rows too).
 */
const UAEPASS_TOKEN_PREFIX = "uaepass:";

/** Persist a session token for a conversation (encrypted at rest). */
export async function saveSessionToken(
  conversationId: string,
  token: string,
  kind: "backend" | "uaepass" = "backend"
) {
  const tagged = kind === "uaepass" ? `${UAEPASS_TOKEN_PREFIX}${token}` : token;
  await getDb().update(conversations).set({ sessionToken: encryptSecret(tagged) }).where(eq(conversations.id, conversationId));
}

/** Split a stored token into its provenance + the raw token. */
function readSessionToken(stored: string | null | undefined): {
  token?: string;
  kind?: "backend" | "uaepass";
} {
  const plain = decryptSecret(stored);
  if (!plain) return {};
  if (plain.startsWith(UAEPASS_TOKEN_PREFIX)) {
    return { token: plain.slice(UAEPASS_TOKEN_PREFIX.length), kind: "uaepass" };
  }
  return { token: plain, kind: "backend" };
}

/**
 * Where a verified Emirates ID lives on a case.
 *
 * Bookkeeping, so the "__" prefix: it is filtered out of the case panel and
 * never reaches a submission as a field of its own. It is here rather than on
 * the conversation because the conversations table has nowhere to put it and a
 * migration to hold one string that only EPGL reads is not worth the schema.
 */
export const VERIFIED_EID_KEY = "__verified_emirates_id";

/**
 * Remember the Emirates ID UAE PASS just verified.
 *
 * EPGL's licence registry takes an Emirates ID and nothing else, so a sign-in
 * that does not carry this forward leaves the lookup with nothing to work with.
 * Best-effort: a failure here costs the customer a prefilled licence list, not
 * their sign-in.
 */
export async function rememberVerifiedEmiratesId(caseId: string, emiratesId: string): Promise<void> {
  const digits = String(emiratesId ?? "").replace(/\D/g, "");
  if (!/^\d{15}$/.test(digits)) return;
  try {
    await mutateCase(caseId, (st) => ({ ...st, data: { ...st.data, [VERIFIED_EID_KEY]: digits } }));
  } catch {
    /* the sign-in itself has already succeeded; do not fail it for this */
  }
}

/**
 * The Salesforce account a signed-in EPGL customer's portal login belongs to.
 *
 * Same reasoning as the Emirates ID beside it, and for now the same JOB. EPGL's
 * token does not yet carry `idn`, so the registry lookup that turns an Emirates
 * ID into somebody's trade licences has nothing to work with — but the token
 * does carry `accountId`, and that names their company outright rather than
 * finding it. Until the Emirates ID arrives this is what stops a signed-in
 * applicant being asked to type a licence number we could have read.
 *
 * Bookkeeping, so the "__" prefix: out of the case panel, out of submissions.
 */
export const VERIFIED_ACCOUNT_KEY = "__verified_account_id";

/** Salesforce ids are 15 or 18 characters of [A-Za-z0-9], and nothing else. */
const SF_ID = /^[A-Za-z0-9]{15,18}$/;

export async function rememberVerifiedAccountId(caseId: string, accountId: string): Promise<void> {
  const id = String(accountId ?? "").trim();
  if (!SF_ID.test(id)) return;
  try {
    await mutateCase(caseId, (st) => ({ ...st, data: { ...st.data, [VERIFIED_ACCOUNT_KEY]: id } }));
  } catch {
    /* the sign-in itself has already succeeded; do not fail it for this */
  }
}

/**
 * A NEW CONVERSATION FOR A CUSTOMER WHO IS ALREADY SIGNED IN.
 *
 * "Logged-in user — refreshing the chat window using the refresh button prompts
 * the user to sign in again" (mobile bug list, item 10). The control starts a
 * new chat rather than refreshing, and it has been given an icon that says so —
 * but starting one still threw the sign-in away, and that half was never fixed
 * for the path the app is actually on.
 *
 * A UAE PASS sign-in leaves nothing in the widget. The token is stored here,
 * against the CONVERSATION, which is the whole design: it is never handed to the
 * page. So a new conversation is a conversation with no session, and the next
 * turn is a guest — whatever the header said a moment ago. The earlier fix
 * covered only the native handoff, where the app can mint another code. There is
 * nothing to mint here.
 *
 * So the session moves. The new conversation inherits the encrypted token, the
 * verified subject and the Emirates ID that was resolved for it — everything
 * that says WHO, and nothing that says what they were doing, which is what
 * "new chat" means.
 *
 * ON WHY THIS IS NOT A NEW CAPABILITY. The conversation id is already a session
 * bearer: getOrCreateSession above takes one, reads `authenticated` and the
 * stored token off the row, and every /api/chat turn quoting that id continues
 * as that customer. Anyone holding an id can already act with it. This grants
 * exactly what it already grants — to the same holder, in a fresh conversation —
 * and it refuses an id that is not authenticated, so it can never manufacture a
 * session that did not exist.
 */
export async function carrySessionForward(
  agentId: string,
  fromConversationId: string
): Promise<{ conversationId: string } | null> {
  const db = getDb();
  const from = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, fromConversationId), eq(conversations.agentId, agentId)),
  });
  /**
   * Not ours, or never signed in.
   *
   * `authenticated` is the whole test, and a stored token is NOT required. It
   * is set by markAuthenticated, which every sign-in path calls only after a
   * verified subject — so the flag already means "an identity was established
   * here", whether or not a credential came with it. A client cannot set it:
   * getOrCreateSession only honours a claimed one when clientAuthClaimTrusted()
   * says so, and that is UAEPASS_MOCK=1, a dev deployment.
   *
   * Requiring the token as well looked stricter and was simply wrong. The UAE
   * PASS mock deliberately stores none — "a synthetic placeholder no backend
   * would accept" — so the first version of this refused every tester using
   * ?mock=1, which is the whole of QA, while behaving correctly in production
   * where a real sign-in does store one. A guard that only fires for the people
   * testing it is worse than no guard.
   */
  if (!from || !from.authenticated) return null;

  const [conv] = await db
    .insert(conversations)
    .values({
      agentId,
      locale: from.locale,
      authenticated: true,
      userRef: from.userRef,
      // Copied as stored — still encrypted, never decrypted on this path. The
      // token does not need to be read to be carried, and a session that never
      // had one (the mock) carries null, which is what it had.
      sessionToken: from.sessionToken,
    })
    .returning();

  // The identity the old case had resolved travels with it; the application does
  // not. An Emirates ID is a fact about the customer, and asking Emirates Post
  // for it again on the next turn would be a round trip for something we know.
  const oldCase = await db.query.cases.findFirst({ where: eq(cases.conversationId, from.id) });
  const old = (oldCase?.state?.data ?? {}) as Record<string, unknown>;
  const fresh = emptyCase();
  const carried: Record<string, unknown> = {};
  // Both are facts about the CUSTOMER rather than about the application, so both
  // travel; asking for either again on the next turn is a round trip for
  // something the sign-in already settled.
  for (const k of [VERIFIED_EID_KEY, VERIFIED_ACCOUNT_KEY]) {
    if (typeof old[k] === "string" && old[k]) carried[k] = old[k];
  }
  const state = Object.keys(carried).length ? { ...fresh, data: { ...fresh.data, ...carried } } : fresh;

  await db.insert(cases).values({ conversationId: conv!.id, agentId, state });
  return { conversationId: conv!.id };
}

/**
 * Sign a conversation out.
 *
 * The token goes, the authenticated flag goes, and the identity goes — all
 * three, in one statement. Clearing only the client's view of it was the bug
 * behind FB-1485: the header said signed out while the server still held a
 * verified session and the next turn was still authenticated, so the customer
 * could not tell which they were.
 *
 * The VERIFIED Emirates ID and account id are dropped from the case too. The
 * first is the strongest
 * identifier in this system, it is what the ownership and licence checks are
 * keyed on, and leaving it behind after a sign-out would let the next person at
 * the same screen act as the last one.
 */
export async function signOutConversation(conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ sessionToken: null, authenticated: false, userRef: null })
    .where(eq(conversations.id, conversationId));
  const c = await db.query.cases.findFirst({ where: eq(cases.conversationId, conversationId) });
  if (!c) return;
  await mutateCase(c.id, (st) => {
    const data = { ...st.data };
    delete data[VERIFIED_EID_KEY];
    // And the account it resolved to, for the same reason: it is the other way
    // to reach the same company records.
    delete data[VERIFIED_ACCOUNT_KEY];
    return { ...st, data };
  }).catch(() => undefined);
}

/** Mark a conversation as authenticated and record the external identity (e.g. UAE PASS sub). */
export async function markAuthenticated(conversationId: string, userRef: string) {
  await getDb().update(conversations).set({ authenticated: true, userRef }).where(eq(conversations.id, conversationId));
}

/**
 * PO Boxes this customer has used in previous conversations (matched by their
 * UAE PASS identity). The EP account-level APIs that would list boxes by
 * identity are disabled upstream (see BLOCKERS §1 #4), so this is how the
 * account pulse avoids re-asking a returning customer for their box number —
 * the first sign-in asks once, every later one starts from what we know.
 */
export async function knownCustomerBoxes(
  agentId: string,
  userRef: string,
  limit = 5
): Promise<{ box: string; emirate?: string }[]> {
  const rows = await getDb()
    .select({ state: cases.state })
    .from(cases)
    .innerJoin(conversations, eq(cases.conversationId, conversations.id))
    .where(and(eq(conversations.agentId, agentId), eq(conversations.userRef, userRef)))
    .orderBy(desc(cases.updatedAt))
    .limit(25);
  const seen = new Map<string, { box: string; emirate?: string }>();
  for (const r of rows) {
    const data = ((r.state as CaseState | null)?.data ?? {}) as Record<string, unknown>;
    let box: string | undefined;
    let emirate: string | undefined;
    for (const [k, v] of Object.entries(data)) {
      const nk = k.replace(/[_\s-]/g, "").toLowerCase();
      if (/^(po)?box(number|no)?$/.test(nk) && (typeof v === "string" || typeof v === "number")) box = String(v);
      else if (nk === "emirate" && typeof v === "string") emirate = v;
    }
    if (box && !seen.has(box)) seen.set(box, { box, emirate });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export interface CustomerFacts {
  boxes: { box: string; emirate?: string }[];
  // Most-recently used branch — offered (never pre-selected) on the next rental.
  preferredBranch?: string;
  // Contact details on file from previous journeys (Round-2 feedback FB-1374/
  // FB-1395: a signed-in customer's mobile + email are prefilled, not re-asked).
  contactPhone?: string;
  contactEmail?: string;
  // Completed requests, newest first (FB-1397: show account history on sign-in).
  history: { reference: string; journey: string; date: string }[];
}

/**
 * Everything we know about a returning signed-in customer from their previous
 * conversations: boxes, preferred branch, contact details, and completed
 * requests. One pass over their recent cases (superset of knownCustomerBoxes).
 */
export async function knownCustomerFacts(agentId: string, userRef: string): Promise<CustomerFacts> {
  const rows = await getDb()
    .select({ state: cases.state, updatedAt: cases.updatedAt })
    .from(cases)
    .innerJoin(conversations, eq(cases.conversationId, conversations.id))
    .where(and(eq(conversations.agentId, agentId), eq(conversations.userRef, userRef)))
    .orderBy(desc(cases.updatedAt))
    .limit(25);
  const facts: CustomerFacts = { boxes: [], history: [] };
  const seenBoxes = new Set<string>();
  for (const r of rows) {
    const st = r.state as CaseState | null;
    const data = (st?.data ?? {}) as Record<string, unknown>;
    let box: string | undefined;
    let emirate: string | undefined;
    for (const [k, v] of Object.entries(data)) {
      const nk = k.replace(/[_\s-]/g, "").toLowerCase();
      if (/^(po)?box(number|no)?$/.test(nk) && (typeof v === "string" || typeof v === "number")) box = String(v);
      else if (nk === "emirate" && typeof v === "string") emirate = v;
    }
    // A BOX NUMBER FROM AN ABANDONED ATTEMPT IS NOT A BOX ON FILE.
    //
    // This reads the customer's past cases, and a case exists from the moment
    // they pick a number — long before anyone pays for it. After an afternoon of
    // testing, five numbers that had been reserved and never paid for were
    // announced to the customer as "your PO Boxes", the agent fetched details
    // for each, and Emirates Post answered BOX NOT FOUND five times, which reads
    // as the customer's own boxes having vanished. Their real boxes — seventeen
    // of them, all Active — were never mentioned, because these came first.
    //
    // A rental counts only once it completed: submitted with a reference, or
    // paid. Anything short of that is an attempt, and attempts are not property.
    const completed = st?.status === "submitted" || Boolean(st?.reference) || st?.payment?.status === "paid";
    if (box && completed && !seenBoxes.has(box) && seenBoxes.size < 5) {
      seenBoxes.add(box);
      facts.boxes.push({ box, emirate });
    }
    if (!facts.preferredBranch && typeof data.branch === "string" && data.branch.trim()) facts.preferredBranch = data.branch.trim();
    if (!facts.contactPhone) {
      const phone = data.contact_phone ?? data.updated_phone;
      if (typeof phone === "string" && phone.trim()) facts.contactPhone = phone.trim();
    }
    if (!facts.contactEmail && typeof data.contact_email === "string" && data.contact_email.trim()) {
      facts.contactEmail = data.contact_email.trim();
    }
    if (st?.status === "submitted" && st.reference && facts.history.length < 6) {
      facts.history.push({
        reference: st.reference,
        journey: (st.journeyKey ?? "request").replace(/_/g, " "),
        date: r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : "",
      });
    }
  }
  return facts;
}

// Fields we treat as a returning customer's stable company profile. These are
// prefilled for a signed-in EPGL user (feedback FB-2/FB-3: account/company
// details + EID come from the customer's profile; quarterly figures come from
// IDEP/company data — the customer confirms, does not re-enter). In the absence
// of a live IDEP/Salesforce company-profile read endpoint, the profile is
// reconstructed from the customer's most recent applications (a demo stand-in
// for that feed — swap in the SF/IDEP read once the contract exposes it).
const EPGL_PROFILE_KEYS = [
  "company_name", "company_name_ar", "trade_license_number", "license_expiry_date", "postal_license_number",
  "regulator", "emirate", "region", "address_street", "po_box", "activity_codes",
  "owner_name", "owner_emirates_id", "owner_nationality", "owner_passport_no", "owner_contact_no",
  "contact_name", "contact_email", "contact_phone", "contact_designation",
  "trade_name_en", "trade_name_ar",
  "financial_year", "leviable_income_q1", "leviable_income_q2", "leviable_income_q3", "leviable_income_q4",
  "accountant_name", "accountant_email", "accountant_phone",
];

/**
 * Reconstruct a returning EPGL customer's company profile from their most recent
 * applications: merge the profile-relevant fields across their cases (most
 * recent value wins). Returns an empty object when nothing is on file so the
 * agent cleanly falls back to the documents-first flow for a brand-new customer.
 */
export async function knownEpglProfile(
  agentId: string,
  userRef: string
): Promise<Record<string, string>> {
  const rows = await getDb()
    .select({ state: cases.state })
    .from(cases)
    .innerJoin(conversations, eq(cases.conversationId, conversations.id))
    .where(and(eq(conversations.agentId, agentId), eq(conversations.userRef, userRef)))
    .orderBy(desc(cases.updatedAt))
    .limit(25);
  const profile: Record<string, string> = {};
  for (const r of rows) {
    const data = ((r.state as CaseState | null)?.data ?? {}) as Record<string, unknown>;
    for (const k of EPGL_PROFILE_KEYS) {
      if (profile[k] !== undefined) continue; // most-recent-first: first non-empty wins
      const v = data[k];
      if (v !== undefined && v !== null && v !== "") profile[k] = String(v);
    }
  }
  return profile;
}

/**
 * Server-authoritative conversation state. The client only holds a
 * conversationId; history + case live in the DB so sessions survive reloads and
 * can be resumed (PRD: partial-application retention / resume) and audited.
 */
/**
 * A client's "I am authenticated" claim is honored only while no real UAE PASS
 * integration is live (mock/dev, e2e scripts) — with real UAE PASS in
 * production, the ONLY way a conversation becomes authenticated is the UAE PASS
 * callback (markAuthenticated), which also records the verified identity.
 * Otherwise anyone could claim authenticated:true and e.g. bypass guest PII
 * redaction on integration lookups.
 */
function clientAuthClaimTrusted(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.UAEPASS_MOCK === "1") return true;
  return !(process.env.UAEPASS_CLIENT_ID && process.env.UAEPASS_CLIENT_SECRET);
}

export async function getOrCreateSession(input: {
  agentId: string;
  conversationId?: string;
  locale: Locale;
  authenticated: boolean;
  userRef?: string;
}): Promise<Session> {
  const db = getDb();
  const claimedAuth = input.authenticated && clientAuthClaimTrusted();

  if (input.conversationId) {
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, input.conversationId), eq(conversations.agentId, input.agentId)),
    });
    if (conv) {
      // Auth is sticky and server-authoritative: once a conversation is signed in
      // (UAE PASS callback sets authenticated + a session token), a later client
      // request claiming "guest" must NOT downgrade it — otherwise the next
      // message after sign-in would re-gate the journey. Client can only upgrade.
      const effectiveAuth = conv.authenticated || claimedAuth || Boolean(conv.sessionToken);
      if (effectiveAuth !== conv.authenticated || (input.userRef && conv.userRef !== input.userRef)) {
        await db
          .update(conversations)
          .set({ authenticated: effectiveAuth, userRef: input.userRef ?? conv.userRef })
          .where(eq(conversations.id, conv.id));
      }
      const caseRow = await db.query.cases.findFirst({ where: eq(cases.conversationId, conv.id) });
      const history = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt));
      const stored = readSessionToken(conv.sessionToken);
      return {
        conversationId: conv.id,
        caseId: caseRow!.id,
        state: caseRow!.state,
        history: history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        sessionToken: stored.token,
        sessionTokenKind: stored.kind,
        authenticated: effectiveAuth,
        userRef: input.userRef ?? conv.userRef ?? undefined,
      };
    }
  }

  // New session.
  const [conv] = await db
    .insert(conversations)
    .values({
      agentId: input.agentId,
      locale: input.locale,
      authenticated: claimedAuth,
      userRef: input.userRef,
    })
    .returning();
  const [caseRow] = await db
    .insert(cases)
    .values({ conversationId: conv!.id, agentId: input.agentId, state: emptyCase() })
    .returning();
  return { conversationId: conv!.id, caseId: caseRow!.id, state: caseRow!.state, history: [], authenticated: claimedAuth, userRef: input.userRef };
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  meta: Record<string, unknown> = {}
) {
  if (!content) return;
  await getDb().insert(messages).values({ conversationId, role, content, meta });
}

export async function saveCase(caseId: string, state: CaseState) {
  await getDb().update(cases).set({ state, updatedAt: new Date() }).where(eq(cases.id, caseId));
}

/**
 * Read-modify-write the case under a row lock.
 *
 * A plain getCase() → mutate → saveCase() loses concurrent work: the case is one
 * jsonb blob, so whoever saves last overwrites the other's changes with a state
 * they read before it existed. That is not theoretical — uploading a second
 * document while the first was still being read by the vision model (several
 * seconds) silently un-uploaded the first, and the agent then asked for it again.
 *
 * `mutate` runs INSIDE the transaction against the freshest state, so parallel
 * uploads queue on the lock and each sees the previous one's result.
 */
export async function mutateCase(
  caseId: string,
  mutate: (state: CaseState) => CaseState
): Promise<CaseState> {
  return await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ state: cases.state })
      .from(cases)
      .where(eq(cases.id, caseId))
      .for("update");
    if (!row) throw new Error("case_not_found");
    const next = mutate(row.state as CaseState);
    await tx.update(cases).set({ state: next, updatedAt: new Date() }).where(eq(cases.id, caseId));
    return next;
  });
}

export async function audit(input: {
  agentId?: string;
  conversationId?: string;
  actor: "user" | "agent" | "system";
  action: string;
  payload?: Record<string, unknown>;
}) {
  await getDb().insert(auditLog).values({
    agentId: input.agentId,
    conversationId: input.conversationId,
    actor: input.actor,
    action: input.action,
    payload: input.payload ?? {},
  });
}

/**
 * Has this exact thing already been recorded for this conversation?
 *
 * For work that must happen once and can be reached from several directions.
 * The EPGL payment notification is the case in point: the gateway webhook, the
 * client's status poll and the reconcile sweep can each be the one that learns a
 * payment settled, and Salesforce should hear about it once.
 *
 * Matched on the payload's `reference` rather than the row alone, so a second
 * payment on the same conversation -- a reissued link, a retry after a decline
 * -- is still notified.
 */
export async function auditSeen(
  conversationId: string,
  action: string,
  reference: string
): Promise<boolean> {
  const row = await getDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.conversationId, conversationId),
        eq(auditLog.action, action),
        sql`${auditLog.payload} ->> 'reference' = ${reference}`
      )
    )
    .limit(1);
  return row.length > 0;
}

/** Fetch the active case for a conversation (used by the upload route). */
export async function getCase(conversationId: string) {
  const row = await getDb().query.cases.findFirst({ where: eq(cases.conversationId, conversationId) });
  if (!row) return null;
  return { caseId: row.id, agentId: row.agentId, state: row.state };
}

export interface InboxItem {
  id: string;
  locale: string;
  authenticated: boolean;
  createdAt: string;
  agentName: string | null;
  agentSlug: string | null;
  primary: string | null;
  lastMessage: string | null;
  lastRole: string | null;
  messageCount: number;
}

/** Conversation list for the Messenger-style admin inbox. */
export async function listConversations(limit = 60): Promise<InboxItem[]> {
  // Scoped accounts see the conversations of their own agents and no others.
  const scope = await currentScope();
  const only = scope ? sql`WHERE a.slug IN (${sql.join(scope.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const res = await getDb().execute(sql`
    SELECT c.id, c.locale, c.authenticated, c.created_at AS "createdAt",
      a.name AS "agentName", a.slug AS "agentSlug",
      a.definition->'theme'->'colors'->>'primary' AS primary,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage",
      (SELECT m.role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS "lastRole",
      (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::int AS "messageCount"
    FROM conversations c LEFT JOIN agents a ON a.id = c.agent_id
    ${only}
    ORDER BY c.created_at DESC LIMIT ${limit}
  `);
  // drizzle neon-serverless returns { rows }
  return ((res as unknown as { rows?: InboxItem[] }).rows ?? (res as unknown as InboxItem[])) ?? [];
}

/** Full detail for the inbox thread + profile panel (admin-only). */
export async function adminConversationDetail(id: string) {
  const db = getDb();
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conv) return null;
  const agent = conv.agentId ? await db.query.agents.findFirst({ where: eq(agents.id, conv.agentId) }) : null;
  // A conversation reached by its id directly is still that agent's, so the
  // scope decides here as it does in the list.
  const scope = await currentScope();
  if (scope && !(agent?.slug && scope.includes(agent.slug))) return null;
  const caseRow = await db.query.cases.findFirst({ where: eq(cases.conversationId, id) });
  const msgs = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  const auditRows = await db
    .select({ action: auditLog.action, actor: auditLog.actor, payload: auditLog.payload, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(eq(auditLog.conversationId, id))
    .orderBy(desc(auditLog.createdAt));
  return {
    id: conv.id,
    locale: conv.locale,
    authenticated: conv.authenticated,
    userRef: conv.userRef,
    createdAt: conv.createdAt,
    agent: agent
      ? { name: agent.name, slug: agent.slug, primary: (agent.definition as { theme?: { colors?: { primary?: string } } })?.theme?.colors?.primary ?? "#0020F5" }
      : null,
    case: caseRow?.state ?? null,
    messages: msgs.filter((m) => m.role === "user" || m.role === "assistant"),
    audit: auditRows,
  };
}

/** For the status/resume endpoint. */
export async function loadConversation(conversationId: string) {
  const db = getDb();
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) return null;
  const caseRow = await db.query.cases.findFirst({ where: eq(cases.conversationId, conv.id) });
  const history = await db
    // createdAt so a resumed transcript carries the same times the live one does.
    .select({ role: messages.role, content: messages.content, meta: messages.meta, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.createdAt));
  return { conversation: conv, case: caseRow?.state ?? emptyCase(), messages: history };
}
