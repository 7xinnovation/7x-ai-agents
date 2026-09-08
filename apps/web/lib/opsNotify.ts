import { sendEmail, isValidEmail, textToHtml, type EmailResult } from "./email";

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
  kind: "key_delivery" | "home_delivery" | "authorised_agent" | "viban_request";
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
    (val(data, "contact_name") || val(data, "full_name")) &&
      `Name: ${val(data, "contact_name") || val(data, "full_name")}`,
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

  // THE AUTHORISED AGENT SHOULD BE TOLD THEY ARE ONE.
  //
  // Emirates Post's own confirmation goes to the box HOLDER and describes the
  // subscription; the person named as the agent gets a copy of a letter about
  // somebody else's box, with nothing in it saying what they now are or what
  // they may do. So they get their own note.
  const agentEmail = val(data, "agent_email") || val(data, "authorised_agent_email");
  const agentName = val(data, "agent_name") || val(data, "authorised_agent_name");
  if (agentEmail && isValidEmail(agentEmail)) {
    const box = val(data, "box_number");
    const branch = val(data, "branch");
    const holder = val(data, "customer_name") || val(data, "full_name");
    const body = [
      `Dear ${agentName || "Sir or Madam"},`,
      ``,
      `You have been added as an AUTHORISED AGENT on an Emirates Post PO Box.` +
        (holder ? ` The box is held by ${holder}.` : ""),
      ``,
      ...[
        box && `PO Box: ${box}${val(data, "emirate") ? `, ${val(data, "emirate")}` : ""}`,
        branch && `Branch: ${branch}`,
        `Reference: ${reference}`,
      ].filter(Boolean),
      ``,
      `As an authorised agent you may collect mail from this PO Box on the holder's behalf.`,
      `Please bring your Emirates ID when you collect, so the branch can identify you.`,
      ``,
      `If you were not expecting this, or you do not wish to be an agent on this box,`,
      `please contact Emirates Post and quote the reference above.`,
      ``,
      `This is an automated message — please do not reply to it.`,
    ].join("\n");
    out.push({
      kind: "authorised_agent",
      to: agentEmail,
      result: await sendEmail({
        to: agentEmail,
        subject: `You have been added as an authorised agent on PO Box ${box || reference}`,
        text: body,
        html: textToHtml(body, "Authorised agent confirmation"),
      }),
    });
  }

  // VIRTUAL IBAN → EPGL Finance raise one with the bank.
  //
  // Their process map gives the applicant a choice of two ways to pay, and this
  // is the one that does not touch our gateway: the assistant submits the
  // application, Finance requests a Virtual IBAN from the bank, pastes it onto
  // the Salesforce application, and the applicant receives it by email and pays
  // by transfer. Finance confirms receipt and issues the receipt themselves.
  //
  // The map has the Finance Officer open Salesforce and extract the company
  // name, trade licence number and issuance date BY HAND before they can raise
  // the request. We already hold all three, so they are in the email — the
  // manual lookup is the step most likely to be got wrong or skipped.
  //
  // We deliberately send NO payment notification for this branch: the money
  // never reaches us, so Finance confirming receipt is what marks it paid.
  if (val(data, "payment_method").toLowerCase() === "viban") {
    const to = process.env.EPGL_FINANCE_EMAIL || "";
    const body = [
      `A licence application was submitted (${input.agentName}) and the applicant chose to pay by VIRTUAL IBAN.`,
      ``,
      `Please raise a Virtual IBAN with the bank and paste it onto the application in Salesforce.`,
      ``,
      `Licence request: ${reference}`,
      ...[
        val(data, "company_name") && `Company name: ${val(data, "company_name")}`,
        val(data, "company_name_ar") && `Company name (Arabic): ${val(data, "company_name_ar")}`,
        val(data, "trade_license_number") && `Trade licence number: ${val(data, "trade_license_number")}`,
        val(data, "license_issue_date") && `Trade licence issuance date: ${val(data, "license_issue_date")}`,
        val(data, "license_expiry_date") && `Trade licence expiry date: ${val(data, "license_expiry_date")}`,
        val(data, "emirate") && `Emirate: ${val(data, "emirate")}`,
      ].filter(Boolean),
      ``,
      `Applicant contact:`,
      ...(customerLines.length ? customerLines : ["  (none recorded)"]),
      ``,
      `The applicant has been told Finance will email them the Virtual IBAN to pay into.`,
      `No payment has been taken through the payment gateway for this application.`,
    ].join("\n");
    out.push({
      kind: "viban_request",
      to: to || undefined,
      result: to
        ? await sendEmail({ to, subject: `[${input.agentName}] Virtual IBAN request — licence request ${reference}`, text: body })
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
