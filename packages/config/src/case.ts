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
      /**
       * What the total was calculated FROM, before any percentage fee.
       *
       * Remembered because the model passes back whatever it last quoted. A 1%
       * fee applied to a figure that already contains it charges 100,000 ->
       * 101,000 -> 102,010 across reissued payment links for one unchanged
       * application -- the same way the courier fee compounded before
       * chargeableAmount stopped trusting the override.
       */
      baseAmount: z.number().nullable().default(null),
    })
    .default({ status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null }),
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
   * The branch each offered box was listed at, as uniqueBoxId -> officeId, and
   * the uniqueBoxId behind each printed box number.
   *
   * FreeBoxes is per branch, so a box number means nothing without one. The box
   * is chosen in one turn and reserved in a later one, and the tool layer is
   * rebuilt every request -- so this has to live on the case or it is empty at
   * exactly the moment it is needed.
   */
  offeredBoxAt: z.record(z.string()).default({}),
  uniqueByNumber: z.record(z.string()).default({}),
  /**
   * The payment Emirates Post opened for this case, on their own gateway.
   *
   * A RENTAL reaches it through a hold, so it used to be read off the hold. A
   * guest RENEWAL has no hold — Guest/Renewal/Save opens the payment directly —
   * and reading the hold there found nothing, so the customer was told in the
   * same breath that their order was created and that the payment link was not
   * ready. It lives here instead, where both kinds of save can put it.
   */
  gatewayPayment: z
    .object({
      url: z.string(),
      /** What the confirm call is keyed on. */
      reference: z.string(),
      orderNo: z.string().nullable().default(null),
      /**
       * When the payment page was opened. A payment asked about twenty-six
       * seconds after that is a payment still being typed, and the backend
       * answers "not paid" for it — which the chat then reported as a failure
       * while the customer's card page was open in front of them.
       */
      openedAt: z.string().nullable().default(null),
      /** When Emirates Post confirmed the money arrived. */
      paidAt: z.string().nullable().default(null),
      /**
       * What the gateway will actually ask for, in AED.
       *
       * The payment is opened in one turn and confirmed in a later one, and this
       * schema STRIPS what it does not name — so the amount was read off the
       * save, used for that turn's pay button, and then thrown away. The receipt
       * row is written on the confirming turn, found nothing, and recorded a
       * renewal of AED 1,290.25 as AED 0.00.
       */
      amount: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
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
       * What an EXTRA agent and a key courier add. The first agent is Inclusive
       * and already inside the minimum amount; charging for it quoted a customer
       * 450 for a 400 rental and the backend refused with MISMATCH_IN_AMOUNT.
       */
      agentExtraPrice: z.number().nullable().default(null),
      /** What the FIRST agent is worth. Inside the minimum amount already. */
      agentIncludedPrice: z.number().nullable().default(null),
      keyDeliveryPrice: z.number().nullable().default(null),
      /**
       * Set once the order exists. paymentRef is the BACKEND's payment reference
       * (paymentGateWayResponse.referenceNumber) — not the gateway's own order
       * reference, which sits beside it in the same response, is also a UUID, and
       * makes the confirm call answer 500.
       */
      orderNo: z.string().nullable().default(null),
      paymentRef: z.string().nullable().default(null),
      paymentUrl: z.string().nullable().default(null),
      /** When Emirates Post confirmed the money arrived. */
      paidAt: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * When the post-sign-in account pulse ran for this case. It is a proactive turn
   * the customer never asked for, so it happens once: three different signals can
   * report a completed sign-in and the Emirates Post flow fires two of them.
   */
  pulsedAt: z.string().nullable().default(null),
  /**
   * When the Customer Pulse survey was offered for this case. One completed
   * purchase, one survey: the token is minted against the transaction, so
   * issuing a second would attach another response to the same order.
   */
  surveyIssuedAt: z.string().nullable().default(null),
  /**
   * Companies this case saw come back from the GSB licence lookups — trade
   * licence numbers and names, normalised. Emirates Post distinguishes a
   * corporate rental whose company details it supplied from one the customer
   * typed and scanned, and only this list can tell the two apart later: the
   * lookup happens turns before the save.
   */
  gsbCompanies: z.array(z.string()).default([]),
  // Set once submitted to the system of record.
  reference: z.string().nullable(),
  /**
   * The reference a CUSTOMER can quote, when it differs from the one the system
   * of record is keyed by.
   *
   * EPGL is why this exists. Their composite answers with Salesforce record ids
   * -- a11FW000X3ht67kYIA -- and that id is what everything on our side needs:
   * the payment webhook notifies against it, the documents are attached to it.
   * But the number on the licence request, the one in their portal and on their
   * emails, is LR-37319, and it is not in the submit response at all.
   *
   * So `reference` stays the key and this carries the name. Null everywhere the
   * two are the same thing, which is every journey but this one.
   */
  referenceLabel: z.string().nullable().default(null),
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
    offeredBoxAt: {},
    uniqueByNumber: {},
    hold: null,
    gatewayPayment: null,
    pulsedAt: null,
    surveyIssuedAt: null,
    gsbCompanies: [],
    readiness: { complete: false, missing: [] },
    payment: { status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null },
    reference: null,
    referenceLabel: null,
    status: "draft",
  };
}
