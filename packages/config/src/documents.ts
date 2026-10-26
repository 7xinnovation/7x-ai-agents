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
   * EPGL's own name for this slot, present only on slots generated FROM their
   * catalogue (see scripts/epgl-2.0-journey-2026-10-20).
   *
   * It is what their EPG_Document__c.Document_Type must say, and its absence is
   * meaningful: our hand-made slots -- `moa`, `trade_license`,
   * `partner_1_passport` -- exist to read fields off a document and have no
   * place on their checklist. Sending one is refused outright:
   * `Document_Type "Partner 1 - Emirates ID" is not required for this
   * application`, 26 October, on LR-54066.
   */
  salesforceType: z.string().optional(),
});
export type DocumentRequirement = z.infer<typeof DocumentRequirement>;

export const DocumentStatus = z.enum([
  "pending",
  "uploaded",
  "rejected",
  "accepted",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;
