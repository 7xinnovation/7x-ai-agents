import { z } from "zod";
import { DocumentStatus } from "./documents";

/**
 * Runtime shape of the "case" being assembled by the conversation — the thing
 * the right-hand panel renders in realtime. The agent's tools mutate this; the
 * UI is a pure function of it. Shape is generic so any journey can use it.
 */
export const CaseDocument = z.object({
  key: z.string(),
  status: DocumentStatus,
  fileName: z.string().optional(),
  rejectionReason: z.string().optional(),
});
export type CaseDocument = z.infer<typeof CaseDocument>;

export const CaseState = z.object({
  journeyKey: z.string().nullable(),
  currentStep: z.string().nullable(),
  // Collected field values, keyed by field key (groups stored as arrays/objects).
  data: z.record(z.unknown()),
  documents: z.array(CaseDocument),
  // Submission readiness, recomputed on every mutation.
  readiness: z.object({
    complete: z.boolean(),
    missing: z.array(
      z.object({ key: z.string(), kind: z.enum(["field", "document"]) })
    ),
  }),
  // Payment state for chargeable journeys (PRD: payment lifecycle tracking).
  payment: z
    .object({
      status: z.enum(["none", "initiated", "paid", "failed"]).default("none"),
      reference: z.string().nullable().default(null),
      amount: z.number().nullable().default(null),
      currency: z.string().default("AED"),
      link: z.string().nullable().default(null),
    })
    .default({ status: "none", reference: null, amount: null, currency: "AED", link: null }),
  /**
   * Journeys the customer has already been asked to confirm, once.
   *
   * The goal-confidence gate scores each turn in isolation, and the turn where
   * the customer answers the confirmation is a bare "Yes, rent a new PO Box" —
   * an affirmation carrying no intent signal, which scores LOWER than the message
   * that triggered the gate. So the gate fired again, the agent asked again, and
   * the customer confirmed the same rental four times before being handed a
   * callback for a journey it could have started at the first yes. Recording the
   * ask makes the second call the one that proceeds, which is the protocol the
   * refusal message already describes.
   */
  confirmedJourneys: z.array(z.string()).default([]),
  /**
   * uniqueBoxIds from the last availability lookup, so the reservation can send
   * one the backend actually issued. They are not derivable: MyBox returns
   * uniqueBoxId "2450063" for box 450063, MyHome returns "958009" for box 958009.
   * Told to use "the 2-prefixed one", the model built 2958009 for a MyHome box and
   * got BOX_NOT_FREE — which reads as someone else having taken it.
   */
  offeredBoxIds: z.array(z.string()).default([]),
  /**
   * A reservation the backend is holding for this case.
   *
   * It has to live in the case, not in the turn. Emirates Post issues it on
   * Rental/Select during the turn that takes payment, and Rental/Save runs in a
   * LATER turn once the payment settles — by which point a per-request closure
   * has been rebuilt and knows nothing. That is exactly how a customer came to be
   * charged 370 for a box that was genuinely held and then never recorded.
   */
  hold: z
    .object({
      reference: z.string(),
      amount: z.number().nullable().default(null),
      expiresAt: z.string().nullable().default(null),
      /** The box this reservation is for. A hold for a different box is not a hold. */
      uniqueBoxId: z.string().nullable().default(null),
      /**
       * The bundle it was reserved under. Nothing in the Save payload says whether
       * a rental is MyHome, and MyHome is the one that needs a home address the
       * backend recognises — so the answer has to be carried from the Select.
       */
      bundleId: z.string().nullable().default(null),
      /**
       * The services Emirates Post priced for this box. An extra it did not price
       * is refused with 223 INVALID_ADDITIONAL_SERVICE, taking the rental with it.
       */
      services: z.array(z.string()).default([]),
      /**
       * Set once the order exists. paymentRef is the BACKEND's payment reference
       * (paymentGateWayResponse.referenceNumber) — not the gateway's own order
       * reference, which sits beside it in the same response, is also a UUID, and
       * makes the confirm call answer 500.
       */
      orderNo: z.string().nullable().default(null),
      paymentRef: z.string().nullable().default(null),
      paymentUrl: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * When the post-sign-in account pulse ran for this case. It is a proactive turn
   * the customer never asked for, so it happens once: three different signals can
   * report a completed sign-in and the Emirates Post flow fires two of them.
   */
  pulsedAt: z.string().nullable().default(null),
  // Set once submitted to the system of record.
  reference: z.string().nullable(),
  status: z.enum(["draft", "ready", "submitted", "escalated"]),
});
export type CaseState = z.infer<typeof CaseState>;

export function emptyCase(): CaseState {
  return {
    journeyKey: null,
    currentStep: null,
    data: {},
    documents: [],
    confirmedJourneys: [],
    offeredBoxIds: [],
    hold: null,
    pulsedAt: null,
    readiness: { complete: false, missing: [] },
    payment: { status: "none", reference: null, amount: null, currency: "AED", link: null },
    reference: null,
    status: "draft",
  };
}
