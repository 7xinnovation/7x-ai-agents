/**
 * "Only sometimes, not every single time."
 *
 * Reported 16 September. Email IS configured — Resend, on both environments, from
 * no-reply@7x-lab.com — and that was never the problem: the ONLY thing that could
 * send one was the send_confirmation_email tool, which the assistant calls when it
 * decides to. Emirates Post's completion guidance tells it to OFFER an email; the
 * EPGL journeys say nothing about email at all. So a licence application that
 * settled and submitted might be emailed, or might not, with nothing different
 * about the two runs.
 *
 * The send now belongs to the completion, and the body is the confirmation the
 * customer just read rather than a second one written here.
 *
 * Run from apps/web:  npx tsx scripts/test-completion-email-2026-09-16.ts
 */
import { completionEmail, completionRecipient, plainFromReply } from "../lib/completionEmail";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const B = "```";
const RECEIPT = "/api/receipt/a1f03189?c=3b2f6e1c";

/** LR-37380's closing message, as it was sent. */
const REPLY = `Payment received — thank you.

Your application is already on file and all documents are attached. Here's where things stand:

${B}summary
title: APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C
- Application reference: LR-37380
- Payment: AED 1,000 — paid
- Documents: All submitted
- Postal activity: Letters & Post Items Delivery
- Receipt: [Download receipt](${RECEIPT})
${B}

**What happens next:**
- The EPGL team reviews your documents, typically within one business day (8 working hours)
- Once approved, your licence is issued and appears in the EPGL portal
- You'll receive an email notification when it's ready

${B}buttons
- Check application status
${B}`;

console.log("\nThe reply, as plain text");
{
  const out = plainFromReply(REPLY, "https://agent.7x.ae");
  check("the card's title survives", out.includes("APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C"), out);
  check("...and its rows, as label and value", out.includes("  Application reference: LR-37380") && out.includes("  Payment: AED 1,000 — paid"), out);
  check("the next steps survive", out.includes("Once approved, your licence is issued and appears in the EPGL portal"));
  check("bold markers are gone", !out.includes("**") && out.includes("What happens next:"));
  check("no fences leak into the email", !out.includes(B), out);
  check("the button is dropped — an email cannot honour a tap", !out.includes("Check application status"), out);
  check("the receipt link becomes an address someone can open", out.includes(`Download receipt: https://agent.7x.ae${RECEIPT}`), out);
}
{
  const relative = plainFromReply(`See [here](/x) and [there](https://e.ae/y).`, null);
  check("with no base url the path is still shown", relative.includes("here: /x") && relative.includes("there: https://e.ae/y"), relative);
  check("a plain code block is kept", plainFromReply("a\n```\ncode\n```\nb").includes("code"));
  check("a total line is kept as one", plainFromReply(`${B}summary\n- A: 1\ntotal: AED 70.00\n${B}`).includes("Total: AED 70.00"));
}

console.log("\nThe email itself");
{
  const mail = completionEmail({
    agentName: "Emirates Post Group Licensing",
    locale: "en",
    reference: "LR-37380",
    contactName: "Emre Karayalcin",
    replyText: REPLY,
    baseUrl: "https://agent.7x.ae",
    receiptPath: RECEIPT,
  });
  check("the subject names the agent and the reference", mail.subject === "Emirates Post Group Licensing — confirmation (LR-37380)", mail.subject);
  check("it opens by name", mail.text.startsWith("Dear Emre Karayalcin,"), mail.text.slice(0, 40));
  check("it carries the summary the customer read", mail.text.includes("Application reference: LR-37380"));
  check("the receipt is in it once, not twice", (mail.text.match(/\/api\/receipt\//g) ?? []).length === 1, mail.text);
  check("and it says not to reply", mail.text.includes("This is an automated message"));
  check("no blank-line pile-ups", !/\n{3,}/.test(mail.text), JSON.stringify(mail.text));
}
{
  // A reply whose card never named the reference, and a customer we have no name
  // for: the email must still be usable on its own.
  const mail = completionEmail({
    agentName: "Emirates Post",
    reference: "EP-0099",
    replyText: "Your PO Box is confirmed.",
    receiptPath: RECEIPT,
    baseUrl: "https://agent.7x.ae",
  });
  check("the reference is added when the message left it out", mail.text.includes("Reference: EP-0099"), mail.text);
  check("no name, no salutation of a stranger", mail.text.startsWith("Hello,"), mail.text.slice(0, 20));
  check("the receipt is added when the message left it out", mail.text.includes(`https://agent.7x.ae${RECEIPT}`));
}
{
  const ar = completionEmail({ agentName: "بريد الإمارات", locale: "ar", reference: "EP-1", replyText: "تم.", receiptPath: RECEIPT });
  check("Arabic subject", ar.subject === "بريد الإمارات — تأكيد (EP-1)", ar.subject);
  check("Arabic receipt label", ar.text.includes("تحميل الإيصال:"), ar.text);
  check("Arabic footer", ar.text.includes("هذه رسالة آلية"));
}

console.log("\nWho it goes to");
check("the contact email on the case", completionRecipient({ contact_email: "a@b.ae" }) === "a@b.ae");
check("trimmed", completionRecipient({ contact_email: "  a@b.ae " }) === "a@b.ae");
check("nothing usable is nothing sent", completionRecipient({ contact_email: "not-an-address" }) === null);
check("and an empty case sends nothing", completionRecipient({}) === null);

console.log("\nFired by the completion, not by the model");
{
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  const at = route.indexOf("const emailTo = completionRecipient(finalState.data);");
  check("the completion email exists in the turn", at > 0);
  const block = route.slice(at, at + 2600);
  check("...gated on the same settled transaction the survey uses", /if \(purchase\?\.reference && !finalState\.confirmationEmailedAt && emailTo && emailConfigured\(\)\)/.test(block), block.slice(0, 200));
  check("...sent once per case", /confirmationEmailedAt: new Date\(\)\.toISOString\(\)/.test(block));
  check("...never on top of one the assistant already sent", /if \(emailToolSent\)/.test(block));
  check("...deferred, so the chat is not held open", /deferred\.push\(async \(\) => \{/.test(block));
  check("...audited either way", /res\.ok \? "confirmation_email_sent" : "confirmation_email_failed"/.test(block));
  check("...quoting the reference the CUSTOMER holds", /finalState\.referenceLabel \?\? finalState\.reference/.test(block));
  check("...with the reply as the body", /replyText: finalText/.test(block));
  check("...and an absolute link built from the forwarded host", /x-forwarded-host/.test(block));
  check("the tool marks its own send", /if \(res\.ok\) emailToolSent = true;/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
