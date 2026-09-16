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
import { completionEmail, completionRecipient, plainFromReply, summaryRows, nextSteps } from "../lib/completionEmail";
import { textToHtml, emailLogoUrl } from "../lib/email";
import { existsSync, readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const B = "```";
const RECEIPT = "/api/receipt/a1f03189?c=3b2f6e1c";
const EMPTY_CASE = { data: {}, documents: [], payment: {} };

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
  check("the receipt link becomes an address someone can open", out.includes(`  Receipt: https://agent.7x.ae${RECEIPT}`), out);
  check("...without saying 'receipt' twice", !out.includes("Receipt: Download receipt"), out);
  check("the card's title sits in a block of its own, so the rows read as a table", /\n\nAPPLICATION CONFIRMED[^\n]*\n\n  Application reference/.test(out), out);
}
{
  const relative = plainFromReply(`See [here](/x) and [there](https://e.ae/y).`, null);
  check("with no base url the path is still shown", relative.includes("here: /x") && relative.includes("there: https://e.ae/y"), relative);
  check("a plain code block is kept", plainFromReply("a\n```\ncode\n```\nb").includes("code"));
  check("a total line is kept as one", plainFromReply(`${B}summary\n- A: 1\ntotal: AED 70.00\n${B}`).includes("Total: AED 70.00"));
}

console.log("\nThe email is a summary, not a transcript");
{
  const mail = completionEmail({
    agentName: "EPGL",
    locale: "en",
    reference: "LR-37380",
    contactName: "Emre Karayalcin",
    replyText: REPLY,
    facts: EMPTY_CASE,
    baseUrl: "https://agent.7x.ae",
    receiptPath: RECEIPT,
  });
  check("the subject names the agent and the reference", mail.subject === "EPGL — confirmation (LR-37380)", mail.subject);
  check("it opens by name", mail.text.startsWith("Dear Emre Karayalcin,"), mail.text.slice(0, 40));
  check("the card's title is the headline", mail.text.includes("APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C"));
  check("the card's rows are the summary", mail.text.includes("Payment: AED 1,000 — paid") && mail.text.includes("Documents: All submitted"), mail.text);
  check("the reference is stated once, not under two names", (mail.text.match(/LR-37380/g) ?? []).length === 1, mail.text);
  check("...and the card's own row for it is dropped", !mail.text.includes("Application reference:"), mail.text);
  check("the next steps survive", mail.text.includes("- Once approved, your licence is issued and appears in the EPGL portal"), mail.text);

  // THE TRANSCRIPT. Reported 16 September — the email read as a chat log.
  for (const chatter of ["Payment received — thank you.", "already on file and all documents are attached", "Here's where things stand"]) {
    check(`the conversation is left in the chat: "${chatter.slice(0, 34)}…"`, !mail.text.includes(chatter), mail.text);
  }
  check("no fences", !mail.text.includes(B));
  check("the receipt is in it once", (mail.text.match(/\/api\/receipt\//g) ?? []).length === 1, mail.text);
  check("and it says not to reply", mail.text.includes("This is an automated message"));
  check("no blank-line pile-ups", !/\n{3,}/.test(mail.text), JSON.stringify(mail.text));
  check("a dated confirmation", /\nDate: \d{2}-\d{2}-\d{4}/.test(mail.text), mail.text);
}

console.log("\nAnd where the journey never drew a card");
{
  // LR-37382, the Virtual IBAN branch: submitted, unpaid for days, and its
  // closing message sets the details out in prose. This is the branch with the
  // longest wait and the most reason to re-read what was sent.
  const VIBAN_REPLY = `On it — submitting your application now.

Your application has been submitted successfully. Here are your details:

Application reference: LR-37382

EPGL Finance will issue your Virtual IBAN within one working day.

What happens next:
- The EPGL team reviews your documents — typically within one business day (8 working hours)
- Once documents are approved, Finance issue your Virtual IBAN and you transfer the licensing fee to it
- After the transfer is confirmed, your Postal Activity Licence is issued

Keep LR-37382 handy if you ever need to follow up with EPGL.`;
  const mail = completionEmail({
    agentName: "EPGL",
    reference: "LR-37382",
    contactName: "Emre Karayalcin",
    replyText: VIBAN_REPLY,
    facts: {
      data: {
        company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
        trade_license_number: "697670",
        legal_form: "Limited Liability Company (LLC)",
        po_box: "13422",
        emirate: "Dubai",
        region: "Al Mankhool",
        activity_codes: "5320002,5320007,5320009",
        payment_method: "viban",
        contact_email: "emre.karayalcin@7x.ae",
      },
      documents: Array.from({ length: 7 }, () => ({ status: "uploaded" })),
      payment: { status: "none", amount: null, currency: "AED" },
    },
    baseUrl: "https://agent.7x.ae",
  });
  check("the reference leads", mail.text.includes("Reference: LR-37382"), mail.text);
  check("the company is named", mail.text.includes("Company: YI FANG TAIWAN FRUIT TEA L.L.C"));
  check("the trade licence is named", mail.text.includes("Trade licence: 697670"));
  check("the activities are names, not codes", mail.text.includes("Postal activities: Letters & Post Items Delivery, Documents Delivery, Parcels Delivery"), mail.text);
  check("...and never the raw codes", !mail.text.includes("5320002"));
  check("the documents are counted", mail.text.includes("Documents: 7 submitted"));
  // An unpaid application must not read as though money changed hands.
  check("an unpaid Virtual IBAN says how it WILL be paid", mail.text.includes("Payment: Bank transfer (Virtual IBAN)"), mail.text);
  check("...and does not say paid", !/—\s*paid/.test(mail.text), mail.text);
  check("the next steps survive", mail.text.includes("- After the transfer is confirmed, your Postal Activity Licence is issued"));
  check("the conversation does not", !mail.text.includes("On it — submitting") && !mail.text.includes("Keep LR-37382 handy"), mail.text);
  check("no receipt link on a payment that has not happened", !mail.text.includes("/api/receipt/"));
}

console.log("\nThe summary a case yields on its own");
{
  const paid = summaryRows(
    {
      data: { box_number: "5200", branch: "Ajman Central Post Office", package: "MyHome Instant", emirate: "Ajman" },
      documents: [],
      payment: { status: "paid", amount: 995, currency: "AED" },
    },
    "en"
  );
  const value = (l: string) => paid.find((r) => r.label === l)?.value;
  check("a rental reads as a rental", value("PO Box") === "5200" && value("Branch") === "Ajman Central Post Office", paid);
  check("a settled payment says so, with the figure", value("Payment") === "AED 995.00 — paid", paid);
  check("documents are left out when there are none", !paid.some((r) => r.label === "Documents"), paid);
  const arabic = summaryRows({ data: { company_name: "شركة", payment_method: "viban" }, documents: [{ status: "accepted" }], payment: {} }, "ar");
  check("Arabic labels", arabic.some((r) => r.label === "الشركة") && arabic.some((r) => r.label === "المستندات"), arabic);
  check("...including the payment route", arabic.find((r) => r.label === "الدفع")?.value === "تحويل بنكي (آيبان افتراضي)", arabic);
  check("an empty case yields nothing rather than empty rows", summaryRows(EMPTY_CASE, "en").length === 0);
}

console.log("\nNext steps, kept rather than rewritten");
{
  check("a bulleted list is read", nextSteps("Blah.\n\nWhat happens next:\n- one\n- two\n\nThanks.").join("|") === "one|two");
  check("a numbered one too", nextSteps("What happens next:\n1. one\n2. two").join("|") === "one|two");
  check("a message without the heading has none", nextSteps("All done, thanks.").length === 0);
  check("the list stops at the prose after it", nextSteps("What happens next:\n- one\n\nKeep LR-1 handy.").join("|") === "one");
  check("Arabic headings are read", nextSteps("الخطوات التالية:\n- واحد\n- اثنان").length === 2);
}

console.log("\nThe logo at the top of it");
{
  // SVG DOES NOT RENDER IN MAIL. Gmail drops it, Outlook drops it — the customer
  // gets alt text and an empty box — so the mark is sent as the PNG rasterised
  // beside it in /public.
  check("an svg is swapped for its email png", emailLogoUrl("/epgl-logo.svg", "https://agent.7x.ae") === "https://agent.7x.ae/epgl-logo-email.png");
  check("...and the file is actually there", existsSync(new URL("../public/epgl-logo-email.png", import.meta.url)));
  check("...for Emirates Post too", existsSync(new URL("../public/emiratespost-logo-email.png", import.meta.url)));
  check("a png is left alone", emailLogoUrl("/brand.png", "https://agent.7x.ae") === "https://agent.7x.ae/brand.png");
  check("another host is left alone", emailLogoUrl("https://cdn.example.ae/a.svg") === "https://cdn.example.ae/a-email.png");
  check("a relative logo with nowhere to resolve against is dropped", emailLogoUrl("/epgl-logo.svg") === "");
  check("no logo, no image", emailLogoUrl(null, "https://agent.7x.ae") === "");

  const html = textToHtml("Dear Emre,\n\n  Reference: LR-37381\n  Payment: AED 1,000 — paid", "EPGL — confirmation (LR-37381)", {
    name: "EPGL",
    logoUrl: "/epgl-logo.svg",
    primary: "#0167cc",
    baseUrl: "https://agent.7x.ae",
  });
  check("the mark is in the html", html.includes('src="https://agent.7x.ae/epgl-logo-email.png"'), html.slice(0, 400));
  check("...sized in attributes, which is all Outlook reads", /<img [^>]*width="106" height="56"/.test(html));
  check("...with the brand as alt text for a client that blocks images", /alt="EPGL"/.test(html));
  check("...above a rule in the brand colour", html.includes("border-bottom:2px solid #0167cc"));
  check("...and above the heading, not inside it", html.indexOf("epgl-logo-email.png") < html.indexOf("EPGL — confirmation"));
  check("the details still read as a table", html.includes("<table"), html);

  // No CSS filter anywhere: the receipt knocks the mark out to white on screen,
  // and a mail client that strips the filter would render navy on navy.
  check("nothing depends on a css filter", !/filter:/i.test(html));

  const noLogo = textToHtml("Hello", "Subject", { name: "EPG Collections", primary: "#0052a3" });
  check("an agent with no logo gets its name instead", noLogo.includes(">EPG Collections</div>"), noLogo.slice(0, 300));
  check("an unbranded email is unchanged", !textToHtml("Hello", "Subject").includes("border-bottom:2px solid"));
  check("a colour that is not a colour cannot reach the markup", textToHtml("Hi", "S", { name: "X", primary: "red;}</style><script>" }).includes("#0052a3"));
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
  check("...and an absolute link", /baseUrl,/.test(block));
  // Azure sits behind a proxy: `host` there is the internal name, so a receipt
  // link built from it would be unreachable from an inbox.
  check("...resolved against the FORWARDED host", /const fwdHost = req\.headers\.get\("x-forwarded-host"\)/.test(route));
  check("the tool marks its own send", /if \(res\.ok\) emailToolSent = true;/.test(route));
  check("...and the assistant's own email is branded too", /textToHtml\(bodyText, subject, emailBrand\)/.test(route));
  check("the completion email is branded", /textToHtml\(mail\.text, mail\.subject, emailBrand\)/.test(route));
  // "EPGL Dialog — confirmation (LR-37381)" went out on 16 September. The record
  // is called that; the customer has never heard of it.
  check("...and signed with the brand, not the agent record's name", /agentName: brandName/.test(route) && /brandName = agent\.definition\.theme\?\.brandName/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
