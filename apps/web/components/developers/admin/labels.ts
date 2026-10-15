/**
 * Words for the admin pages: audit actions, settings, task states and A2A
 * error codes in plain English, plus the date formats every admin table uses.
 * Pure data and functions, safe on the server and the client.
 */

/** Audit actions as a person would say them. Anything unknown falls back to the raw action. */
export const ACTION_LABELS: Record<string, string> = {
  developer_signed_in: "Signed in",
  developer_app_created: "Application created",
  developer_app_rotated: "Credentials rotated",
  developer_app_revoked: "Application revoked",
  developer_app_renamed: "Application renamed",
  developer_otp_send_failed: "Sign-in code not sent",
  developer_otp_not_sent_dev_code: "Sign-in code shown on screen (development)",
  developer_admin_account_created: "Account created",
  developer_admin_account_updated: "Account updated",
  developer_admin_application_revoked: "Application revoked by an admin",
  developer_admin_application_updated: "Application updated by an admin",
  developer_admin_setting_changed: "Setting changed",
  sandbox_agent_synced: "Sandbox agent synced",
};

export function actionLabel(action: string): { label: string; known: boolean } {
  const label = ACTION_LABELS[action];
  return label ? { label, known: true } : { label: action, known: false };
}

/** Settings by name, for the settings page and for "Setting changed" log lines. */
export const SETTING_LABELS: Record<string, string> = {
  doorwayEnabled: "Doorway enabled",
  rateLimitPerMinute: "Rate limit per application per minute",
  codeTtlMinutes: "Code lifetime in minutes",
  codeMaxAttempts: "Wrong attempts allowed",
  defaultAgents: "Agents a new application may call",
  bannerText: "Banner text",
};

/** "developer:ops@7x.ae" → "ops@7x.ae". */
export const byLabel = (by: string | null | undefined): string | null => (by ? by.replace(/^developer:/, "") : null);

function short(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.length ? v.map(short).join(", ") : "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** One line that says what an event was about, from the fields that matter in its payload. */
export function eventDetails(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.key === "string" && ("from" in payload || "to" in payload)) {
    parts.push(`${SETTING_LABELS[payload.key] ?? payload.key}: ${short(payload.from)} → ${short(payload.to)}`);
  }
  for (const k of ["name", "email", "organization", "role", "clientId", "method"] as const) {
    const v = payload[k];
    if (typeof v === "string" && v) parts.push(v);
  }
  const changes = payload.changes;
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    const entries = Object.entries(changes as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length) parts.push(entries.map(([k, v]) => (k === "revoke" ? "revoked" : `${k} ${short(v)}`)).join(", "));
  }
  return parts.join(", ");
}

/** The names behind the codes, so a log line reads without the spec open. */
export const A2A_ERRORS: Record<number, string> = {
  [-32700]: "JSONParseError",
  [-32600]: "InvalidRequestError",
  [-32601]: "MethodNotFoundError",
  [-32602]: "InvalidParamsError",
  [-32603]: "InternalError",
  [-32001]: "TaskNotFoundError",
  [-32002]: "TaskNotCancelableError",
  [-32003]: "PushNotificationNotSupportedError",
  [-32004]: "UnsupportedOperationError",
  [-32005]: "ContentTypeNotSupportedError",
  [-32006]: "InvalidAgentResponseError",
  [-32007]: "ExtendedAgentCardNotConfiguredError",
  [-32008]: "ExtensionSupportRequiredError",
  [-32009]: "VersionNotSupportedError",
  [-32010]: "UnauthenticatedError",
  [-32011]: "PermissionDeniedError",
  [-32012]: "RateLimitedError",
  [-32013]: "UnavailableError",
};

export const TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
] as const;

/** "TASK_STATE_INPUT_REQUIRED" → "Input required". */
export function stateLabel(s: string): string {
  const w = s.replace(/^TASK_STATE_/, "").toLowerCase().replace(/_/g, " ");
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : s;
}

export const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const numberFmt = new Intl.NumberFormat("en-GB");
export const absolute = (iso: string) => dateFmt.format(new Date(iso));

/** "2 min ago" for the glance; callers put the absolute time in the title. */
export function relative(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return absolute(iso);
}
