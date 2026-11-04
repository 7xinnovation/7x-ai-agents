/**
 * THE MASTER AGENT: ONE FRONT DOOR, NO COPIES.
 *
 * 4 November 2026: "we need to build a master agent — an agent that has both
 * EPGL and NXN — without rebuilding everything ... in a way that if we change
 * anything on EPGL or NXN, it automatically reflects on the master agent."
 *
 * A master agent's definition lists `delegates` — live agents, by slug. It has
 * no journeys, knowledge, integrations or prompt of its own to drift out of
 * date. Each customer turn is routed to ONE delegate, and that delegate's own
 * chat runtime runs the turn exactly as it would on its own embed: its row is
 * read on every turn, so whatever is changed on NXN or EPGL is what the master
 * does on the next message.
 *
 * WHY ROUTING AND NOT MERGING. Merging both definitions into one prompt would
 * mean one conversation, one case, one journey slot and one tenant — and the
 * runtime branches on the tenant in some sixty places (UAE PASS client, host
 * token key, email sender, Salesforce vs Emirates Post tools, payments). A
 * merged agent would be a third agent to keep in step. A routed one is the two
 * agents themselves.
 *
 * So each delegate keeps its own conversation (and its own case, sign-in and
 * payments) inside the master's chat. The browser holds the map of which
 * conversation belongs to which delegate, and a customer who goes from
 * renewing a PO Box to asking about a licence and back again comes back to the
 * PO Box conversation where they left it.
 *
 * WHEN TO SWITCH. Stickiness wins: a delegate mid-conversation keeps the turn
 * unless the customer is plainly asking for the other service. "yes", "2", a
 * box number, a tapped button from the last reply, an upload or a payment
 * coming back never moves the conversation. Everything else is asked of the
 * fast model, which reads each delegate's OWN name and intents (live, so a new
 * EPGL intent is routable without touching the master), and which must be sure
 * before it moves a conversation that is already under way.
 */
import { getAnthropic, classifierModel, withModelFallback } from "@dialog/core";
import { tr, type AgentDefinition, type Locale } from "@dialog/config";
import { getDb, conversations, messages, agents } from "@dialog/db";
import { and, desc, eq } from "drizzle-orm";
import { log } from "@/lib/logger";

export type Delegate = NonNullable<AgentDefinition["delegates"]>[number];

export function isMaster(def: AgentDefinition): boolean {
  return Array.isArray(def.delegates) && def.delegates.length > 0;
}

export function delegateSlugs(def: AgentDefinition): string[] {
  return (def.delegates ?? []).map((d) => d.slug);
}

/** The delegate a master starts on: `defaultDelegate` if it is one of them, else the first. */
export function defaultDelegate(def: AgentDefinition): string | null {
  const slugs = delegateSlugs(def);
  if (def.defaultDelegate && slugs.includes(def.defaultDelegate)) return def.defaultDelegate;
  return slugs[0] ?? null;
}

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // Arabic diacritics and tatweel
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A tapped service button: the message IS a delegate's label, in either language. */
export function matchLabel(def: AgentDefinition, message: string): string | null {
  const m = norm(message);
  if (!m) return null;
  for (const d of def.delegates ?? []) {
    const labels = [d.label.en, d.label.ar].filter((l): l is string => typeof l === "string" && l.length > 0);
    if (labels.some((l) => norm(l) === m)) return d.slug;
  }
  return null;
}

/** Lines of the last reply's ```buttons block — tapping one of them answers the agent that asked. */
export function buttonsIn(reply: string): string[] {
  const out: string[] = [];
  const re = /```buttons\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) {
    for (const line of m[1]!.split("\n")) {
      const t = line.replace(/^\s*[-*]\s*/, "").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * A message that can only be an answer to whoever asked the question: too
 * short to name a service, no letters at all (a box number, a date, an OTP),
 * or a button the last reply offered. The router is not consulted for these.
 */
export function plainlyAnAnswer(message: string, lastReply: string | null): boolean {
  const t = message.trim();
  if (!/\p{L}/u.test(t)) return true;
  const words = norm(t).split(" ").filter(Boolean);
  if (words.length <= 2) return true;
  if (lastReply) {
    const m = norm(t);
    if (buttonsIn(lastReply).some((b) => norm(b) === m)) return true;
  }
  return false;
}

/** The routing brief for one delegate, read from its live definition. */
export function delegateBrief(d: Delegate, child: AgentDefinition, locale: Locale): string {
  const intents = child.intents
    .filter((i) => i.key !== "human_help")
    .map((i) => `    - ${tr(i.description, locale)}`)
    .join("\n");
  const summary = d.summary ? `  ${tr(d.summary, locale)}\n` : "";
  return `- ${d.slug} — "${tr(d.label, locale)}" (${child.name})\n${summary}  Handles:\n${intents}`;
}

export interface RouteInput {
  master: AgentDefinition;
  children: Record<string, AgentDefinition>;
  message: string;
  locale: Locale;
  /** The delegate holding this conversation now, if any. */
  current: string | null;
  /** That delegate's last reply, for context. */
  lastReply: string | null;
  /** Synthetic turns — an upload, a returning payment, a pulse — never move. */
  synthetic: boolean;
}

export interface RouteDecision {
  /** The delegate to run this turn; null means ask the customer which service. */
  target: string | null;
  reason: "label" | "synthetic" | "answer" | "router" | "router-stay" | "router-unsure" | "router-failed" | "no-delegates";
  confidence?: number;
}

/** How sure the router must be to move a conversation that is already under way, and to start one. */
export const SWITCH_CONFIDENCE = 0.75;
export const START_CONFIDENCE = 0.5;

/** The decision, given what the fast model said (or null when it was not asked or failed). Pure, so it is testable. */
export function decide(input: RouteInput, classified: { target: string; confidence: number } | null | "failed"): RouteDecision {
  const slugs = delegateSlugs(input.master);
  if (!slugs.length) return { target: null, reason: "no-delegates" };
  const current = input.current && slugs.includes(input.current) ? input.current : null;

  const label = matchLabel(input.master, input.message);
  if (label) return { target: label, reason: "label" };
  if (input.synthetic) return { target: current ?? defaultDelegate(input.master), reason: "synthetic" };
  if (current && plainlyAnAnswer(input.message, input.lastReply)) return { target: current, reason: "answer" };

  if (classified === "failed" || classified === null) return { target: current, reason: "router-failed" };
  const { target, confidence } = classified;
  const known = slugs.includes(target);
  if (current) {
    if (known && target !== current && confidence >= SWITCH_CONFIDENCE) return { target, reason: "router", confidence };
    return { target: current, reason: "router-stay", confidence };
  }
  if (known && confidence >= START_CONFIDENCE) return { target, reason: "router", confidence };
  return { target: null, reason: "router-unsure", confidence };
}

/** Whether the fast model needs asking at all for this turn. */
export function needsRouter(input: RouteInput): boolean {
  if (!delegateSlugs(input.master).length) return false;
  if (matchLabel(input.master, input.message)) return false;
  if (input.synthetic) return false;
  const current = input.current && delegateSlugs(input.master).includes(input.current) ? input.current : null;
  if (current && plainlyAnAnswer(input.message, input.lastReply)) return false;
  return true;
}

async function classify(input: RouteInput): Promise<{ target: string; confidence: number } | "failed"> {
  const delegates = (input.master.delegates ?? []).filter((d) => input.children[d.slug]);
  const options = [...delegates.map((d) => d.slug), "unclear"];
  const briefs = delegates.map((d) => delegateBrief(d, input.children[d.slug]!, input.locale)).join("\n\n");
  const context = input.current
    ? `\n\nThe customer is currently talking to "${input.current}". Its last reply was:\n"""${(input.lastReply ?? "").slice(0, 700)}"""\n` +
      `Keep them there ("${input.current}") unless this message is plainly a request for a DIFFERENT service. ` +
      `An answer to that reply, a follow-up, a general question either could answer, a greeting or thanks all stay.`
    : `\n\nThis is the start of the conversation. If the message is a greeting, small talk, or could belong to either service, answer "unclear".`;
  try {
    const res = await withModelFallback(classifierModel(), (model) =>
      getAnthropic().messages.create(
        {
          model,
          max_tokens: 150,
          system:
            `You route a customer's message, for "${input.master.name}", to the one specialist that handles it. Respond only via the route tool.\n\nSpecialists:\n${briefs}` +
            context,
          tools: [
            {
              name: "route",
              description: "The specialist that should answer this message, and how sure you are.",
              input_schema: {
                type: "object",
                properties: {
                  target: { type: "string", enum: options },
                  confidence: { type: "number", description: "0 to 1" },
                },
                required: ["target", "confidence"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "route" },
          messages: [{ role: "user", content: input.message.slice(0, 2000) }],
        },
        // On the customer's critical path: fail fast and keep them where they are.
        { timeout: 6000, maxRetries: 0 }
      )
    );
    const block = res.content.find((c) => c.type === "tool_use");
    if (block && block.type === "tool_use") {
      const v = block.input as { target?: string; confidence?: number };
      return { target: String(v.target ?? "unclear"), confidence: Math.max(0, Math.min(1, Number(v.confidence ?? 0))) };
    }
    return "failed";
  } catch (e) {
    log.error("master_route_failed", e instanceof Error ? e : new Error(String(e)), { master: input.master.slug });
    return "failed";
  }
}

/** Route one turn. Never throws: on any failure the conversation stays where it is. */
export async function routeTurn(input: RouteInput): Promise<RouteDecision> {
  const classified = needsRouter(input) ? await classify(input) : null;
  const decision = decide(input, classified);
  log.info("master_route", {
    master: input.master.slug,
    from: input.current,
    to: decision.target,
    reason: decision.reason,
    confidence: decision.confidence,
  });
  return decision;
}

/**
 * Which delegate owns a conversation id, if it is one of this master's. A
 * conversation id from anywhere else is ignored, never trusted.
 */
export async function delegateOf(conversationId: string | undefined, master: AgentDefinition): Promise<string | null> {
  if (!conversationId) return null;
  const db = getDb();
  const [row] = await db
    .select({ slug: agents.slug })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row && delegateSlugs(master).includes(row.slug) ? row.slug : null;
}

/** The last thing the assistant said in a conversation, for the router's context. */
export async function lastReplyIn(conversationId: string | undefined): Promise<string | null> {
  if (!conversationId) return null;
  const db = getDb();
  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "assistant")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.content ?? null;
}

/** The master's own reply when it cannot tell which service is wanted: one line and a button per service. */
export function whichService(master: AgentDefinition, locale: Locale): string {
  const ask =
    locale === "ar"
      ? "يسعدني مساعدتك. أي خدمة تحتاج؟"
      : "Happy to help. Which service do you need?";
  const buttons = (master.delegates ?? []).map((d) => `- ${tr(d.label, locale)}`).join("\n");
  return `${ask}\n\n\`\`\`buttons\n${buttons}\n\`\`\``;
}

/**
 * WHAT OPENING A SERVICE SHOWS: exactly what that agent's own widget shows.
 *
 * 4 November, on production: tapping "Postal licences" gave EPGL's greeting
 * and nothing to tap. On EPGL's own page that greeting is followed by its
 * starter buttons — the widget builds them from the agent's journeys whenever
 * the greeting carries no ```buttons block of its own (Experience.tsx,
 * `starters`). The master copied the sentence and dropped the options.
 *
 * So: the delegate's greeting as written, and when it has no buttons, its
 * first four journey titles as buttons — the same rule its widget applies,
 * read from its live definition, so a journey EPGL adds is offered here too.
 */
export function delegateOpening(child: AgentDefinition, locale: Locale): string {
  const greeting = tr(child.greeting, locale).trim();
  if (/```\s*buttons/.test(greeting)) return greeting;
  const starters = child.journeys
    .slice(0, 4)
    .map((j) => tr(j.title, locale).trim())
    .filter(Boolean);
  if (!starters.length) return greeting;
  return `${greeting}\n\n\`\`\`buttons\n${starters.map((s) => `- ${s}`).join("\n")}\n\`\`\``;
}
