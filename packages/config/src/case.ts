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
    readiness: { complete: false, missing: [] },
    reference: null,
    status: "draft",
  };
}
