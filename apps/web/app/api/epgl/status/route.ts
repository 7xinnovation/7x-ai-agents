import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v3";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, cases, conversations, messages } from "@dialog/db";
import { audit, auditSeen } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Salesforce pushes an EPGL application's progress here.
 *
 * The applicant holds the conversation with the assistant, not with the portal,
 * so an approval, a rejection or a request for more information should reach
 * them in the thread they are already in. We poll getApplicationStatus as a
 * backstop; this is what makes it immediate.
 *
 * The contract is docs/EPGL-STATUS-PUSH-2026-10-20.md, and the body is
 * deliberately the one getApplicationStatus already returns plus a four-field
 * envelope — they had already built and tested the hard part.
 */

/** Their clock against ours. Wider than it needs to be, narrow enough that a
 *  captured request is not replayable tomorrow. */
const MAX_SKEW_MS = 15 * 60 * 1000;
const ACTION = "epgl_status_push";

const Localized = z.object({ en: z.string().optional(), ar: z.string().optional() }).passthrough();

const Body = z
  .object({
    eventId: z.string().min(1),
    eventType: z.string().optional(),
    occurredOn: z.string().optional(),
    applicationId: z.string().min(1),
    decision: z.object({ status: Localized.optional() }).passthrough().nullable().optional(),
    application: z
      .object({
        applicationId: z.string().optional(),
        applicantStatus: Localized.optional(),
        requestStatus: z.string().optional(),
        reference: z.string().optional(),
        lastUpdatedOn: z.string().optional(),
        informationRequest: z.object({ open: z.boolean().optional() }).passthrough().nullable().optional(),
        licence: z.object({ licenceNumber: z.string().nullable().optional() }).passthrough().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * HMAC-SHA256 over the RAW BYTES, not a re-serialisation of the parsed JSON.
 *
 * FAILS CLOSED WHEN THE SECRET IS UNSET, which is the opposite of the payment
 * webhook beside it. That one skips signing in dev because an unsigned mock
 * payment moves nobody's money. This endpoint carries a REGULATOR'S DECISION:
 * an unauthenticated POST that is believed would tell an applicant their licence
 * was approved. There is no environment where guessing is better than refusing.
 */
function verified(raw: string, header: string | null): boolean {
  const secret = process.env.EPGL_STATUS_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = header.replace(/^sha256=/, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function fresh(header: string | null): boolean {
  if (!header) return false;
  const t = Date.parse(header);
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= MAX_SKEW_MS;
}

/**
 * The conversation this application belongs to.
 *
 * Keyed on the application id in the case data. WHICH KEY THAT IS depends on an
 * answer Salesforce have not given — whether they mint the id or we do — so
 * both spellings are looked at rather than one being guessed at, and the newest
 * case wins if an applicant somehow has two.
 */
async function caseFor(applicationId: string) {
  const [row] = await getDb()
    .select({ caseId: cases.id, conversationId: cases.conversationId, agentId: cases.agentId, state: cases.state })
    .from(cases)
    .where(
      sql`${cases.state} -> 'data' ->> 'application_id' = ${applicationId}
       or ${cases.state} -> 'data' ->> 'applicationId' = ${applicationId}`
    )
    .orderBy(desc(cases.updatedAt))
    .limit(1);
  return row ?? null;
}

/** What the applicant reads, in the language they were using. Their words, not ours. */
function sentence(body: z.infer<typeof Body>, locale: string): string {
  const pick = (v?: { en?: string; ar?: string } | null) =>
    (locale === "ar" ? v?.ar || v?.en : v?.en || v?.ar) ?? "";
  const app = body.application;
  const status = pick(app?.applicantStatus) || pick(body.decision?.status) || app?.requestStatus || "";
  const ref = app?.reference ? ` (${app.reference})` : "";
  const licence = app?.licence?.licenceNumber;

  if (app?.informationRequest?.open) {
    return locale === "ar"
      ? `طلبت مجموعة بريد الإمارات مستندات إضافية لطلبك${ref}. سأوضح لك ما هو مطلوب.`
      : `Emirates Post Group have asked for more documents on your application${ref}. I'll go through what they need.`;
  }
  if (licence) {
    return locale === "ar"
      ? `صدرت رخصتك${ref}. رقم الرخصة ${licence}.`
      : `Your licence has been issued${ref}. The licence number is ${licence}.`;
  }
  return locale === "ar"
    ? `تحدّثت حالة طلبك${ref}: ${status}.`
    : `Your application${ref} has moved to: ${status}.`;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verified(raw, req.headers.get("x-epgl-signature"))) {
    log.warn("epgl_status_push_rejected", { reason: "signature" });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (!fresh(req.headers.get("x-epgl-timestamp"))) {
    log.warn("epgl_status_push_rejected", { reason: "timestamp" });
    return NextResponse.json({ error: "stale_timestamp" }, { status: 401 });
  }

  let json: unknown;
  try { json = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const body = parsed.data;
  const applicationId = body.application?.applicationId || body.applicationId;

  const found = await caseFor(applicationId);
  if (!found) {
    // Not an error at their end: an application may have been started somewhere
    // that is not a conversation of ours. Say so plainly so they stop retrying.
    log.info("epgl_status_push_unmatched", { applicationId, eventId: body.eventId });
    return NextResponse.json({ error: "unknown_application" }, { status: 404 });
  }

  // Once per event, however many times they send it. They should prefer
  // retrying to dropping, so a duplicate is a 200 and not a complaint.
  if (await auditSeen(found.conversationId, ACTION, body.eventId)) {
    return NextResponse.json({ received: true, eventId: body.eventId, idempotent: true });
  }

  /**
   * Delivery order is not guaranteed, so an event older than the one we already
   * acted on is recorded and NOT shown. Telling an applicant their approved
   * licence is "under review" because a retry arrived late is worse than silence.
   */
  const seenAt = (found.state as { data?: Record<string, unknown> })?.data?.__epgl_status_at;
  const occurred = Date.parse(body.occurredOn ?? body.application?.lastUpdatedOn ?? "");
  const stale = Number.isFinite(occurred) && typeof seenAt === "string" && Date.parse(seenAt) > occurred;

  const [conv] = await getDb()
    .select({ locale: conversations.locale })
    .from(conversations)
    .where(eq(conversations.id, found.conversationId))
    .limit(1);

  if (!stale) {
    await getDb().insert(messages).values({
      conversationId: found.conversationId,
      role: "assistant",
      content: sentence(body, conv?.locale ?? "en"),
      meta: { source: ACTION, eventId: body.eventId, eventType: body.eventType ?? "status.changed", applicationId },
    });
    await getDb()
      .update(cases)
      .set({
        state: sql`jsonb_set(jsonb_set(${cases.state}, '{data,__epgl_status_at}', ${JSON.stringify(body.occurredOn ?? new Date().toISOString())}::jsonb, true), '{data,__epgl_status}', ${JSON.stringify(JSON.stringify(body.application?.applicantStatus ?? body.decision?.status ?? {}))}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, found.caseId));
  }

  await audit({
    agentId: found.agentId,
    conversationId: found.conversationId,
    actor: "system",
    action: ACTION,
    // auditSeen matches on `reference`, so the event id has to live there.
    payload: { reference: body.eventId, eventType: body.eventType, applicationId, stale, body: body.application ?? null },
  });

  return NextResponse.json({ received: true, eventId: body.eventId, ...(stale ? { stale: true } : {}) });
}

/** A GET is how somebody checks the address is live before wiring it up. */
export async function GET() {
  return NextResponse.json({
    endpoint: "epgl.status",
    expects: "POST, X-EPGL-Signature (HMAC-SHA256 of the raw body), X-EPGL-Timestamp",
    configured: Boolean(process.env.EPGL_STATUS_WEBHOOK_SECRET),
  });
}
