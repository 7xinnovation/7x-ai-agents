/**
 * Load the EPGL Agentic AI Knowledge Base into the EPGL agent (2026-08-25).
 *
 * Source: "EPGL_Agentic_AI_Knowledge_Base (1).docx" — Emirates Post Group's
 * Licensing & Regulatory FAQ, prepared for exactly this purpose. The admin
 * importer rejects .docx and asks for a PDF export, so the text was extracted
 * from the Word XML (paragraphs and both tables) and is inlined here instead:
 * that keeps what was ingested reviewable in git rather than resting on a file
 * on someone's laptop.
 *
 * Checked first — the EPGL KB held 16 documents, all from "EPGL Licensing Guide
 * §1-§7", and none of this document's distinctive content: no call-centre number,
 * no WhatsApp line, no Tawasul, no 30 kg threshold, no Article 15, no
 * careers.7x.ae. Overlapping topics existed (Form 9 in 3 chunks, AED 100,000 in
 * 4), which is why the check was for specifics rather than for themes.
 *
 * Split the way the document is: one KB document per section, and the FAQ split
 * by its own published categories. Each Q&A is a paragraph, so chunkContent gives
 * one chunk per question — a customer's question retrieves the answer to that
 * question rather than a slab of the surrounding category.
 *
 * TWO SECTIONS ARE DELIBERATELY LEFT OUT:
 *  - "Frequently Asked Questions" is a single provenance line ("entries are
 *    grouped by category as published"). As a retrievable chunk it can only ever
 *    answer a customer with a sentence about the document's own structure.
 *  - "Maintenance & Version Control" is internal governance — review cadence,
 *    version number, and the name of the consultancy that prepared it. Nothing a
 *    customer asked for, and it names a third party.
 *
 * ENGLISH ONLY. The document is English, and its content is regulatory: fees,
 * fines, legal citations, a 30 kg threshold. Machine-translating that into the
 * Arabic half of a knowledge base the agent is told to treat as authoritative
 * would be inventing an official Arabic text. Retrieval does not filter by
 * locale, so these are reachable from an Arabic session — but an Arabic question
 * will not match English chunks under full-text search, so EPGL still need to
 * supply the Arabic.
 *
 * Idempotent: skips any document already present under the same source + title.
 * Run from apps/web:
 *   npx tsx scripts/import-epgl-kb-2026-08-25.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, kbDocuments } from "@dialog/db";
import { and, eq } from "drizzle-orm";
import { getAgentBySlug } from "../lib/agents";
import { createKbDocument } from "../lib/kb";

const SLUG = "epgl-dialog";

const DOCS: { title: string; source: string; content: string }[] = [
  {
    title: "Purpose & Scope",
    source: "EPGL Agentic AI KB §1",
    content: `This knowledge base equips an Agentic AI assistant to answer routine enquiries from CEP licence applicants, licensed postal operators, and the public on behalf of Emirates Post Group (EPG), specifically for matters handled by the Postal Sector Regulatory Committee (PSRC) and the Licensing & Regulatory Department. It is built from the published Frequently Asked Questions on epgl.ae/faq, organised into three categories — Laws and Regulations, Electronic Platform, and Procedures — and is paired with a referral structure so the agent knows when to answer directly and when to route the enquirer to a human team or another channel.

The knowledge base should be treated as a living document: as new FAQs are published or regulations change, entries should be added or revised and the version history updated.`,
  },
  {
    title: "How the AI Agent Should Use This Knowledge Base",
    source: "EPGL Agentic AI KB §2",
    content: `Answer directly and only from the Q&A entries below when a user's question matches an existing entry in meaning, even if phrased differently.

Do not fabricate figures, fees, deadlines, or legal citations that are not present in this knowledge base.

Where an answer references a video walkthrough or the electronic platform, direct the user to that resource rather than attempting to describe on-screen steps not covered here.

If a question falls into a referral category in Section 3 (e.g. violations, complaints, fee disputes), respond with empathy, briefly state the applicable rule if known, and provide the correct referral channel and contact details.

If a question is outside the scope of this knowledge base (general postal services, unrelated government matters, or anything not covered), do not guess — direct the user to EPG Help & Support or the relevant authority.

Always use current UAE regulatory terminology (e.g. Federal Decree-Law No. 21 of 2019) and avoid speculating on unpublished or draft regulations.`,
  },
  {
    title: "Inquiry Routing & Escalation Matrix",
    source: "EPGL Agentic AI KB §3",
    content: `Use this matrix to determine the correct first point of reference and, where needed, the escalation path for enquiries the knowledge base cannot fully resolve.

Licensing applications: new, renewal, cancellation, NOC, location/name/partner changes, branch add/cancel
  First point of reference: Licensing Electronic Platform (self-service, guided by video walkthroughs)
  Escalate / refer to: Licensing & Regulatory Department

Questions on postal fees, levies, Form 9, VAT treatment, quarterly declarations
  First point of reference: Knowledge base (Laws & Regulations) first; unresolved → Licensing Department
  Escalate / refer to: Licensing & Regulatory Department → Finance (fee disputes)

Violations, warnings, and non-compliance notices
  First point of reference: Advise the operator the matter is referred to Legal Affairs; do not attempt to resolve or negotiate
  Escalate / refer to: Legal Affairs Department

Complaint about a violation decision or enforcement action
  First point of reference: Electronic platform complaint form, or email the Licensing complaints mailbox
  Escalate / refer to: Legal Affairs Department (review) → Appeals Committee if escalated

General postal services: track & trace, PO Box, branch locations, delivery times
  First point of reference: Help & Support channels (phone / email / WhatsApp)
  Escalate / refer to: Customer Care / Emirates Post operations (outside PSRC licensing scope)

Regulatory policy questions, PSRC Charter, licensing framework interpretation
  First point of reference: Knowledge base first; unresolved → escalate
  Escalate / refer to: PSRC Secretariat / Licensing & Regulatory Department

Careers and recruitment
  First point of reference: Direct to the Emirates Post careers portal
  Escalate / refer to: Group HR (careers.7x.ae)

Federal/government coordination or cross-authority matters (TDRA, Ministry of Economy, DED, Customs, etc.)
  First point of reference: Acknowledge and note the relevant authority; do not attempt to answer on their behalf
  Escalate / refer to: Relevant government authority (see contact list) — EPG facilitates via its POC

General public suggestions, compliments, or complaints unrelated to licensing
  First point of reference: UAE federal Tawasul channel
  Escalate / refer to: Tawasul (171.ae)

Anything outside the AI agent's verified knowledge base
  First point of reference: Do not guess; provide the Help & Support contact details
  Escalate / refer to: Human EPG representative`,
  },
  {
    title: "Help & Support Contact Channels",
    source: "EPGL Agentic AI KB §3",
    content: `Call Centre: 600 5 99999
WhatsApp: +971 50 773 5305
Email (general enquiries): Available via the Contact page / email link on epgl.ae
Licensing complaints (violations): Submit via the electronic platform, or by email to the Licensing complaints mailbox
Careers: careers.7x.ae
Federal suggestions & complaints (Tawasul): 171.ae
TDRA: tdra.gov.ae
UAE Government Portal: u.ae
Head Office Hours: Monday – Friday, 8:00 AM – 4:00 PM`,
  },
  {
    title: "FAQ: Laws And Regulations",
    source: "EPGL Agentic AI KB §4",
    content: `Q: Are there any fines if Form 9 is not submitted on time?
A: Yes. Fines are imposed according to the system if Form 9 is not submitted on time.

Q: Can the remaining balance of an advance payment from the previous licensing year be carried over upon renewal?
A: No. It is not permitted to carry the remaining balance over to a new licensing year.

Q: Is it permissible for licensed companies to outsource delivery work to unlicensed companies?
A: No. It is not permissible to contract with unlicensed companies.

Q: Are fees imposed on air, land, or sea shipments?
A: Fees are charged for shipments/parcels weighing no more than 30 kg.

Q: Should the quarterly declaration be approved by an external auditor?
A: Yes.

Q: Are postal fees imposed on revenue from services other than transporting documents, letters, and parcels?
A: No fees are charged on such revenue.

Q: Should Form 9 be submitted if there are no revenues subject to fees?
A: Yes, Form 9 should still be submitted.

Q: Are fees imposed on revenue from delivery services under lump-sum contracts?
A: No fees are currently charged for these services.

Q: Can a company deliver parcels weighing more than 30 kg?
A: Yes, without paying fees, provided other official authorities agree.

Q: Is VAT calculated on postal fees?
A: No, VAT is not calculated on postal fees.

Q: What are the reasons for a violation or warning?
A: Practising any postal service that falls within EPG's jurisdiction without obtaining a postal licence.

Q: How can a violation procedure be cancelled or stopped?
A: By obtaining a postal licence.

Q: What materials can be shipped without a licence from the Group?
A: Foodstuffs and parcels over 30 kg.

Q: What activities and services are exclusive to Emirates Post Group and its licensed companies?
A: Transporting documents.
Transporting postal letters.
Transporting parcels of all kinds.

Q: What is the concept and meaning of postal parcels, their weight, and packaging?
A: A postal item containing commodities, gifts, samples, or other materials without the character of letters, intended for transport or distribution, weighing up to 30 kg.

Q: What does the violation stipulated in Article 15 of Law No. (Postal Law) 2019 cover?
A: The exercise of Emirates Post's exclusive activities in any manner, by any party.

Q: Is there a settlement or reconciliation option for violations by unlicensed companies?
A: Yes, but only if a licence application is submitted and the required conditions are met.

Q: What distinguishes EPG's activities from delivery activity licensed by the Departments of Economic Development?
A: DED-licensed delivery activity is limited to food and beverage delivery.

Q: What are the requirements for obtaining a postal licence?
A: Pay the prescribed postal fees (AED 100,000).
Partners' passports.
Partners' Emirates ID.
Lease contract.
Memorandum of Association.
Initial approval or trade licence.

Q: What is the postal fee?
A: Annual fees of 10% of total local and international licensed activity revenue, or AED 2 per shipment — whichever is higher — with a minimum of AED 100,000 paid in advance on granting or renewing the licence.

Q: Is it necessary for a UAE national to be listed on the trade licence?
A: No.

Q: Are there postal fees for opening a new branch?
A: No.

Q: Is a licence applicant exempt from fees if licensed by the Mohammed Bin Rashid Foundation for Supporting Youth Projects or a similar official institution?
A: No, there is no such exemption.

Q: Can annual fees be paid in instalments?
A: No, this is not possible.

Q: Can a licence be granted without a UAE national partner being present?
A: Yes.

Q: Can the advance payment of annual fees be deferred?
A: No, this is not possible.`,
  },
  {
    title: "FAQ: Electronic Platform",
    source: "EPGL Agentic AI KB §4",
    content: `Q: How do I submit a new licence application on the electronic platform?
A:
Create an account and log in
Fill out the application form, upload the required documents & accept the acknowledgement and pledge form
EPG will Review the application
The customer pays the fees
The license will be issued
Upload the Trade license after adding activities

Q: How do I submit a licence renewal application on the electronic platform?
A:
Log in
Fill out the application, upload the required documents & accept the acknowledgement and pledge form
EPG will Review the application
The license will be issued

Q: How do I submit a licence cancellation request on the electronic platform?
A:
Log in
Fill out the application, attach the required documents & accept the acknowledgment and pledge form.
EPG will Review the application
A license cancellation certificate will be issued

Q: How do I request a No-Objection Certificate (NOC) on the electronic platform?
A:
Fill out the application form
Attach the required documents & accept the acknowledgement and pledge form
EPG will Review the application
Obtain a no-objection certificate

Q: How do I submit a request to change the company's location?
A:
Log in
Fill out the application, attach the required documents
EPG will Review the application
A license will be issued

Q: How do I submit a request to change or add a partner?
A:
Log in
Fill out the application, attach the required documents
EPG will Review the application
A Letter will be issued

Q: How do I submit a request to change the company name?
A:
Log in
Fill out the application, attach the required documents
EPG will Review the application
A license will be issued

Q: How do I add a branch on the electronic platform?
A:
Log in
Fill out the application, attach the required documents
EPG will Review the application
A license will be issued

Q: How do I cancel a branch on the electronic platform?
A:
Log in
Fill out the application, attach the required documents & accept the acknowledgment and pledge form.
EPG will Review the application
A Letter will be issued`,
  },
  {
    title: "FAQ: Procedures",
    source: "EPGL Agentic AI KB §4",
    content: `Q: What are the procedures for obtaining a postal licence?
A: Same as the process for submitting a new license application above.

Q: How do I obtain a No-Objection Certificate for food delivery activity?
A: Same as requesting a NOC above.

Q: What are the requirements for postal licence renewal?
A:
Passport (for partners)
Emirates ID (for partners)
Trade license
Lease contract
Memorandum of Association
Trial Balance for the License period
Last fiscal Year Audited Financial Statement or Acknowledgment Letter for submitting the financial statement.

Q: What are the requirements for postal licence cancellation?
A:  Click on Cancellation of License, add Cancellation Reason, Last Date to Stop Postal Activity. Approve declaration and undertaking form. Provide the following:
Trial Balance for the license period
Audited Financial Statements for the latest fiscal year, or an acknowledgment letter confirming their submission
An Excel file containing the revenue data as of the date of the cancellation request.

Q: What happens after a violation is issued?
A:  An SMS and email go out to the client’s registered address with the Violation. The violation is referred to the Legal Affairs Department for handling.

Q: How can I file a complaint regarding a violation?
A: You can file a complaint regarding a violation through any of our official communication channels: our website at www.epgl.ae, email at info@epg.ae, by calling 600 5 99999, or via WhatsApp at +971 50 773 5305. You can also email at complaints@epg.ae.`,
  }
];

async function main() {
  const agent = await getAgentBySlug(SLUG);
  if (!agent) throw new Error(`${SLUG} not found`);
  const db = getDb();

  let added = 0;
  let skipped = 0;
  for (const d of DOCS) {
    const [existing] = await db
      .select({ id: kbDocuments.id })
      .from(kbDocuments)
      .where(and(eq(kbDocuments.agentId, agent.id), eq(kbDocuments.source, d.source), eq(kbDocuments.title, d.title)))
      .limit(1);
    if (existing) {
      console.log(`  (skip) ${d.source} — ${d.title}`);
      skipped++;
      continue;
    }
    const r = await createKbDocument({
      agentId: agent.id,
      title: d.title,
      source: d.source,
      locale: "en",
      content: d.content,
      status: "published",
    });
    console.log(`  + ${d.source} — ${d.title} (${r.chunks} chunk${r.chunks === 1 ? "" : "s"}${r.embedded ? ", embedded" : ""})`);
    added++;
  }
  console.log(`\n${added} added, ${skipped} already present.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
