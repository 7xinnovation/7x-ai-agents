import { z } from "zod";
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
});
export type DocumentRequirement = z.infer<typeof DocumentRequirement>;

export const DocumentStatus = z.enum([
  "pending",
  "uploaded",
  "rejected",
  "accepted",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;
