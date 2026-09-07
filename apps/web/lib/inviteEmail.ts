import { sendEmail, isValidEmail, type EmailResult } from "./email";

/**
 * The invitation to the console.
 *
 * An account is created without a password and the person sets their own from a
 * link, so a password is never chosen on someone's behalf, never typed into a
 * chat window, and never has to be relayed by a third person. The link is
 * single use and expires.
 *
 * The message says who invited them, what they are being given access to, and
 * when the link stops working — the three things that decide whether an email
 * like this reads as legitimate or as phishing.
 */
export interface InviteEmailInput {
  to: string;
  name: string;
  link: string;
  /** What they will be able to do: "view", "edit", … */
  role: string;
  /** The agents they will see. Empty means all of them. */
  agents?: string[];
  invitedBy?: string | null;
  expiresAt: Date;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "5 September 2026" — no clock, because the exact minute is not the point. */
const day = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });

export function inviteEmailBody(input: InviteEmailInput): { subject: string; text: string; html: string } {
  const scope = input.agents?.length
    ? `You will have access to ${input.agents.join(" and ")}.`
    : "You will have access to every agent in the console.";
  const from = input.invitedBy ? `${input.invitedBy} has invited you` : "You have been invited";
  const subject = "Your invitation to the Dialog admin console";

  const text = [
    `Hello ${input.name},`,
    "",
    `${from} to the Dialog admin console as a ${input.role}. ${scope}`,
    "",
    "Choose your password to finish setting up your account:",
    input.link,
    "",
    `This link works once and expires on ${day(input.expiresAt)}.`,
    "If you were not expecting this invitation, you can ignore it — no account is active until the link is used.",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101828">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e7ec;border-radius:14px;padding:32px">
        <tr><td>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.55">Hello ${esc(input.name)},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.55">${esc(from)} to the <b>Dialog admin console</b> as a ${esc(input.role)}. ${esc(scope)}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55">Choose your password to finish setting up your account.</p>
          <p style="margin:0 0 24px">
            <a href="${esc(input.link)}" style="display:inline-block;background:#0020F5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14.5px;padding:12px 22px;border-radius:9px">Set your password</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#667085">This link works once and expires on ${esc(day(input.expiresAt))}.</p>
          <p style="margin:0 0 18px;font-size:13px;line-height:1.55;color:#667085">If you were not expecting this invitation you can ignore it — no account is active until the link is used.</p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#98a2b3;word-break:break-all">${esc(input.link)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

  return { subject, text, html };
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<EmailResult> {
  if (!isValidEmail(input.to)) return { ok: false, reason: `invalid_recipient:${input.to}` };
  const { subject, text, html } = inviteEmailBody(input);
  return sendEmail({ to: input.to, subject, text, html });
}
