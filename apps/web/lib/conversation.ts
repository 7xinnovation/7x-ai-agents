import { getDb, conversations, messages, cases, auditLog, agents } from "@dialog/db";
import { emptyCase, type CaseState, type Locale } from "@dialog/config";
import { and, asc, desc, eq, sql } from "drizzle-orm";

export interface Session {
  conversationId: string;
  caseId: string;
  state: CaseState;
  history: { role: "user" | "assistant"; content: string }[];
}

/**
 * Server-authoritative conversation state. The client only holds a
 * conversationId; history + case live in the DB so sessions survive reloads and
 * can be resumed (PRD: partial-application retention / resume) and audited.
 */
export async function getOrCreateSession(input: {
  agentId: string;
  conversationId?: string;
  locale: Locale;
  authenticated: boolean;
  userRef?: string;
}): Promise<Session> {
  const db = getDb();

  if (input.conversationId) {
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, input.conversationId), eq(conversations.agentId, input.agentId)),
    });
    if (conv) {
      // Keep auth state current within the resumed session.
      if (conv.authenticated !== input.authenticated || (input.userRef && conv.userRef !== input.userRef)) {
        await db
          .update(conversations)
          .set({ authenticated: input.authenticated, userRef: input.userRef ?? conv.userRef })
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
      };
    }
  }

  // New session.
  const [conv] = await db
    .insert(conversations)
    .values({
      agentId: input.agentId,
      locale: input.locale,
      authenticated: input.authenticated,
      userRef: input.userRef,
    })
    .returning();
  const [caseRow] = await db
    .insert(cases)
    .values({ conversationId: conv!.id, agentId: input.agentId, state: emptyCase() })
    .returning();
  return { conversationId: conv!.id, caseId: caseRow!.id, state: caseRow!.state, history: [] };
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
