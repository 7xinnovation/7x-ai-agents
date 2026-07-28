import { getDb, conversations, messages, cases, auditLog, agents } from "@dialog/db";
import { emptyCase, type CaseState, type Locale } from "@dialog/config";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";

export interface Session {
  conversationId: string;
  caseId: string;
  state: CaseState;
  history: { role: "user" | "assistant"; content: string }[];
  // Decrypted backend session token (e.g. OTP-minted) for this conversation, if any.
  sessionToken?: string;
  // Server-authoritative auth state for this conversation (sticky once signed in
  // via UAE PASS), used for journey gating instead of the client's claim.
  authenticated: boolean;
  // External identity (e.g. UAE PASS sub) attached at sign-in, if any.
  userRef?: string;
}

/** Persist an integration session token for a conversation (encrypted at rest). */
export async function saveSessionToken(conversationId: string, token: string) {
  await getDb().update(conversations).set({ sessionToken: encryptSecret(token) }).where(eq(conversations.id, conversationId));
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
    if (box && !seenBoxes.has(box) && seenBoxes.size < 5) {
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
      return {
        conversationId: conv.id,
        caseId: caseRow!.id,
        state: caseRow!.state,
        history: history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        sessionToken: decryptSecret(conv.sessionToken) ?? undefined,
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
  const res = await getDb().execute(sql`
    SELECT c.id, c.locale, c.authenticated, c.created_at AS "createdAt",
      a.name AS "agentName", a.slug AS "agentSlug",
      a.definition->'theme'->'colors'->>'primary' AS primary,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage",
      (SELECT m.role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS "lastRole",
      (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::int AS "messageCount"
    FROM conversations c LEFT JOIN agents a ON a.id = c.agent_id
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
    .select({ role: messages.role, content: messages.content, meta: messages.meta })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.createdAt));
  return { conversation: conv, case: caseRow?.state ?? emptyCase(), messages: history };
}
