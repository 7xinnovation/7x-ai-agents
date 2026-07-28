import { sendEmail, type EmailResult } from "./email";

/**
 * Internal ops notifications fired when a PO Box submission completes — mirrors
 * the website's back-office coordination (Round-2 feedback FB-1391/FB-1392):
 *  - Key delivery chosen → the branch manager receives an email with a courier
 *    tracking reference and the customer/delivery details.
 *  - A MyHome (home mailbox) bundle → the EMX delivery team receives an email to
 *    arrange the home installation/delivery, with the case reference as the
 *    request number for tracking and follow-up.
 * Recipients come from env (NXN_BRANCH_OPS_EMAIL / NXN_EMX_TEAM_EMAIL). When
 * unset, the notification is skipped and reported as such — the caller audits
 * either way so the coordination trail is never silent.
 */
export interface OpsNotifyOutcome {
  kind: "key_delivery" | "home_delivery";
  to?: string;
  trackingRef?: string;
  result: EmailResult | { ok: false; reason: "recipient_not_configured" };
}

const val = (data: Record<string, unknown>, key: string) => {
  const v = data[key];
  return v === undefined || v === null ? "" : String(v);
};

export async function notifyOpsForSubmission(input: {
  reference: string;
  journeyKey: string;
  data: Record<string, unknown>;
  agentName: string;
}): Promise<OpsNotifyOutcome[]> {
  const { reference, data } = input;
  const out: OpsNotifyOutcome[] = [];

  const customerLines = [
    val(data, "contact_phone") && `Phone: ${val(data, "contact_phone")}`,
    val(data, "contact_email") && `Email: ${val(data, "contact_email")}`,
    val(data, "box_number") && `PO Box: ${val(data, "box_number")}`,
    val(data, "emirate") && `Emirate: ${val(data, "emirate")}`,
    val(data, "branch") && `Branch: ${val(data, "branch")}`,
  ].filter(Boolean);

  // Key delivery → branch manager, same process as the website (courier pickup).
  if (val(data, "key_delivery") === "deliver") {
    const to = process.env.NXN_BRANCH_OPS_EMAIL || "";
    const trackingRef = `KD-${reference}`;
    const body = [
      `A key delivery was requested for a new PO Box rental (${input.agentName}).`,
      ``,
      `Case reference: ${reference}`,
      `Courier tracking reference: ${trackingRef}`,
      ...customerLines,
      ...(val(data, "delivery_address") ? [`Delivery address: ${val(data, "delivery_address")}`] : []),
      ``,
      `Please arrange the key handover to the courier following the standard website key-delivery process.`,
    ].join("\n");
    out.push({
      kind: "key_delivery",
      to: to || undefined,
      trackingRef,
      result: to
        ? await sendEmail({ to, subject: `[${input.agentName}] Key delivery request ${trackingRef} (case ${reference})`, text: body })
        : { ok: false, reason: "recipient_not_configured" },
    });
  }

  // MyHome bundle → EMX team arranges the home mailbox delivery/installation.
  const bundle = (val(data, "package") || val(data, "bundle") || "").toUpperCase();
  if (bundle.startsWith("MYHOME")) {
    const to = process.env.NXN_EMX_TEAM_EMAIL || "";
    const body = [
      `A MyHome PO Box was rented (${input.agentName}) — please arrange the home mailbox delivery.`,
      ``,
      `Request number (for tracking and follow-up): ${reference}`,
      `Bundle: ${bundle}`,
      ...customerLines,
      ...(val(data, "delivery_address") ? [`Address: ${val(data, "delivery_address")}`] : []),
    ].join("\n");
    out.push({
      kind: "home_delivery",
      to: to || undefined,
      result: to
        ? await sendEmail({ to, subject: `[${input.agentName}] MyHome delivery request ${reference}`, text: body })
        : { ok: false, reason: "recipient_not_configured" },
    });
  }

  return out;
}
