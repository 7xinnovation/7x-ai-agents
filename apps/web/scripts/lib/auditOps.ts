import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLog } from "@dialog/db";

/**
 * Record an operator's change to an integration's operation flags.
 *
 * The admin route audits its own mutations, but these scripts write straight to
 * whichever database `--env` names, so they bypass it entirely. That is the same
 * blind spot in a different shape: on 8 September, Rental/Select was
 * `enabled: false` in production, the model was never handed the reservation
 * tool, and every PO Box rental was refused at the payment step. The last
 * working reservation was 6 September at 19:06. Nothing anywhere recorded what
 * changed it, when, or who by.
 *
 * A script leaves a git trail and console output; neither is in the database
 * anyone would look in. This puts it there.
 *
 * Best-effort by design: an operator tool must not fail because its audit row
 * did. The change has already been written by the time this runs.
 */
export async function auditOperationFlags(
  db: NodePgDatabase<Record<string, unknown>>,
  input: {
    agentId?: string;
    /** The script doing it, so the row points at the code that made the change. */
    script: string;
    integration: string;
    environment: string;
    enabled?: string[];
    disabled?: string[];
    note?: string;
  }
): Promise<void> {
  if (!input.enabled?.length && !input.disabled?.length) return;
  try {
    await db.insert(auditLog).values({
      agentId: input.agentId,
      actor: "system",
      action: "integration_operations_changed",
      payload: {
        by: `script:${input.script}`,
        integration: input.integration,
        environment: input.environment,
        enabled: input.enabled ?? [],
        disabled: input.disabled ?? [],
        ...(input.note ? { note: input.note } : {}),
      },
    });
  } catch {
    /* the change is what matters; a missing row must not fail the run */
  }
}
