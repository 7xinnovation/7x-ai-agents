import { z } from "zod/v3";
import { LocalizedString } from "./primitives";

/**
 * Document matrix entry. The PRD's "exact document matrix per license type
 * (mandatory vs conditional)" is data, not code — so each company/journey/
 * license type can declare its own set. `condition` is a tiny expression
 * referencing collected case fields (e.g. "license_type == 'courier'").
 */
export const DocumentRequirement = z.object({
  key: z.string(),
  label: LocalizedString,
  description: LocalizedString.optional(),
  requirement: z.enum(["mandatory", "conditional", "optional"]),
  // Only requested when this expression is truthy against the case data.
  condition: z.string().optional(),
  acceptedFormats: z.array(z.string()).default(["pdf", "png", "jpg"]),
  maxSizeMb: z.number().default(10),
  /**
   * EPGL's own name for this slot (see scripts/epgl-2.0-journey-2026-10-20,
   * which generates them from their catalogue).
   *
   * It is what their EPG_Document__c.Document_Type must say, and it must be a
   * name their checklist knows: a made-up one is refused outright --
   * `Document_Type "Partner 1 - Emirates ID" is not required for this
   * application`, 26 October, on LR-54066.
   *
   * Its absence is still meaningful -- a slot without one is never pushed --
   * but it no longer divides generated slots from hand-made ones. Since the
   * 29 October merge (scripts/lib/epglDocumentPairs) three of ours carry a
   * catalogue name because they duplicated a catalogue slot and absorbed it:
   * `moa`, `partner_1_passport` and `partner_1_emirates_id`. `trade_license`
   * and partners 2-8 still have none, each for a reason recorded there.
   */
  salesforceType: z.string().optional(),
  /**
   * EPGL refuse this document without a Valid_To__c (`validityRequired` in
   * their catalogue).
   *
   * It decides whether a document may travel inside the CREATE call, which
   * runs allOrNone=true: a slot that needs a date we do not have would roll
   * back the Account, the owners and the application with it. On 26 October it
   * did exactly that -- an insurance certificate and a lease contract whose
   * PDFs printed no readable expiry took the whole submission down.
   */
  validityRequired: z.boolean().optional(),
});
export type DocumentRequirement = z.infer<typeof DocumentRequirement>;

export const DocumentStatus = z.enum([
  "pending",
  "uploaded",
  "rejected",
  "accepted",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;
