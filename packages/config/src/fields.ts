import { z } from "zod";
import { LocalizedString } from "./primitives";

/**
 * Field types the conversational data collection can capture and the case
 * builder can render. Inline controls (date pickers, enum dropdowns, upload)
 * map to these (PRD: lightweight inline structured inputs).
 */
export const FieldType = z.enum([
  "text",
  "longtext",
  "number",
  "percentage",
  "email",
  "phone",
  "date",
  "enum",
  "boolean",
  "document", // captured via DocumentRequirement, mirrored here for the case view
  "group", // repeatable sub-object, e.g. shareholders
]);
export type FieldType = z.infer<typeof FieldType>;

export const ValidationRule = z.object({
  required: z.boolean().default(false),
  pattern: z.string().optional(), // regex, e.g. Emirates ID / trade-license format
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  // For "group" fields whose numeric children must sum to a value (shareholder % == 100).
  sumChildrenEquals: z.number().optional(),
  // Human-readable, localized message shown on failure (PRD: corrective message).
  message: LocalizedString.optional(),
});
export type ValidationRule = z.infer<typeof ValidationRule>;

export const FieldDef: z.ZodType<FieldDefShape, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    key: z.string(),
    label: LocalizedString,
    type: FieldType,
    help: LocalizedString.optional(),
    // For enum fields.
    options: z
      .array(z.object({ value: z.string(), label: LocalizedString }))
      .optional(),
    validation: ValidationRule.default({ required: false }),
    // For "group" fields — the shape of each repeated item.
    children: z.array(FieldDef).optional(),
    // Whether this field came pre-filled from a system of record (renewal:
    // "do not ask for data EPGL already holds").
    prefillFrom: z.string().optional(),
    /**
     * Whether the customer may correct this value themselves from the case panel
     * (FB-1566: "the only editable changes should be the client's preferred
     * contact details"). Values read off an official document are the document's
     * to state — letting the applicant retype them silently diverges the
     * application from its evidence.
     *
     * Opt-in per journey: if ANY field of a journey sets this, only the fields
     * that set it true get a pencil. A journey that declares it nowhere keeps the
     * original behaviour (every text-like field editable), so agents that have
     * not been curated are unaffected. Enforced server-side in
     * `apps/web/app/api/case/field/route.ts`, not just hidden in the UI.
     */
    editable: z.boolean().optional(),
  })
);

export interface FieldDefShape {
  key: string;
  label: z.infer<typeof LocalizedString>;
  type: z.infer<typeof FieldType>;
  help?: z.infer<typeof LocalizedString>;
  options?: { value: string; label: z.infer<typeof LocalizedString> }[];
  validation: z.infer<typeof ValidationRule>;
  children?: FieldDefShape[];
  prefillFrom?: string;
  editable?: boolean;
}
export type FieldDef = FieldDefShape;
