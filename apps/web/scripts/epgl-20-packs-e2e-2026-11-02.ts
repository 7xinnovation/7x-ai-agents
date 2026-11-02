/**
 * The six EPGL 2.0 test packs, driven through the real chat endpoint (2026-11-02).
 *
 * Asked for: "the test documents you created for all scenarios, i want you to go
 * through them and actually create license requests on staging so we can check
 * to see if all of them are working as expected."
 *
 * So this is not a simulation. It posts to /api/chat and /api/upload on the
 * deployed site, signs in through the mock UAE PASS flow, sends the pack's real
 * PDFs, and follows whatever the assistant asks for rather than a fixed script.
 * What it leaves behind is a real application in Emirates Post's NewLaw sandbox,
 * which somebody has to clear down — so the LR- reference is printed for every
 * run and the packs are not re-runnable without new licence numbers.
 *
 * IT STOPS AT THE PAYMENT CARD. The card needs a human and nothing here pays.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-20-packs-e2e-2026-11-02.ts --host https://7xagents.7x-lab.com --pack 05-lockers-pudo
 *   npx tsx scripts/epgl-20-packs-e2e-2026-11-02.ts --host <url> --all [--verbose]
 */
export {};

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS, type Scenario } from "./lib/epglTestPacks";

const cliArg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const HOST = (cliArg("--host") ?? "").replace(/\/$/, "");
const PACKS = cliArg("--packs") ?? "/Users/emrekarayalcin/Documents/7x-proj-tech/agents/EPGL-2.0-test-packs";
const VERBOSE = process.argv.includes("--verbose");
const MAX_TURNS = Number(cliArg("--turns") ?? 60);
/** 2.0 lives on its own agent since 2 November; epgl-dialog is 1.0 again. */
const SLUG = cliArg("--slug") ?? "epgl-dialog-2";
if (!HOST) throw new Error("--host <https://…> is required");

/**
 * Pack 01 is the 22 October pack and is not in SCENARIOS — it has its own
 * generator and its own company. Described here so --all means all six.
 */
const PACK01: Scenario = {
  dir: "01-cep30-sme-uae-domestic",
  code: "CEP30-UAE-SME-DOM",
  purpose: "The ordinary case.",
  company: {
    en: "7X TEST - DO NOT PROCESS - 20261022A", ar: "", tradeEn: "7X TEST COURIER SERVICES", tradeAr: "",
    tl: "CN-1234567", addrEn: "Office 101, Test Tower, Business Bay, Dubai, UAE", addrAr: "",
    emirate: "Dubai", emirateAr: "دبي", activityEn: ["Courier Services"], activityAr: [],
  } as Scenario["company"],
  describeSelf: "I run a courier company, UAE-national owned SME, domestic only, shipments up to 30 kg.",
  answers: [
    "Yes to electronic tracking, yes to consignment notes.",
    "No food delivery, no medicine delivery, no cold chain. Fleet of 6 vehicles. Insurance AED 1,000,000.",
    "No intermediation, no outsourcing. Data handling confirmed.",
  ],
  watch: [],
};
const ALL: Scenario[] = [PACK01, ...SCENARIOS];

interface Run {
  pack: string;
  conversationId?: string;
  reference?: string;
  submissions: number;
  createAttempts: number;
  paymentOpened: boolean;
  feeSeen?: string;
  uploaded: string[];
  rejected: string[];
  notes: string[];
  lastReply: string;
  turns: number;
}

async function runPack(s: Scenario): Promise<Run> {
  const docsDir = join(PACKS, s.dir, "documents");
  const files = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => f.endsWith(".pdf")) : [];
  const run: Run = { pack: s.dir, submissions: 0, createAttempts: 0, paymentOpened: false, uploaded: [], rejected: [], notes: [], lastReply: "", turns: 0 };
  if (!files.length) { run.notes.push(`no documents found in ${docsDir}`); return run; }

  let conversationId: string | undefined;

  /** One chat turn, reading the SSE stream for what the server actually did. */
  async function say(userMessage: string, extra: Record<string, unknown> = {}, attempt = 0): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: SLUG, userMessage, conversationId, locale: "en", mock: true, ...extra }),
      });
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
      return say(userMessage, extra, attempt + 1);
    }
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      let done: boolean; let value: Uint8Array | undefined;
      try { ({ done, value } = await reader.read()); }
      catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 20_000));
        return say(userMessage, extra, attempt + 1);
      }
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (ev.type === "text" && typeof ev.delta === "string") text += ev.delta;
            if (ev.type === "payment_initiated") run.paymentOpened = true;
            if (ev.type === "submitted" && typeof ev.reference === "string") { run.reference = ev.reference; run.submissions++; }
            if (typeof ev.conversationId === "string") conversationId = ev.conversationId;
          } catch { /* keepalive */ }
        }
      }
    }
    if (/\[ERROR\]|went wrong on our side/.test(text) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 12_000));
      return say(userMessage, extra, attempt + 1);
    }
    if (VERBOSE) console.log(`\n    > ${userMessage}\n${text.replace(/^/gm, "      ")}\n`);
    return text;
  }

  /** Sign in as the mock persona, the way ?mock=1 does in a browser. */
  async function signIn(): Promise<boolean> {
    const login = `${HOST}/api/uaepass/login?mock=1&agent=${SLUG}&cid=${conversationId ?? ""}`;
    const r1 = await fetch(login, { redirect: "manual" });
    const cookie = (r1.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const target = r1.headers.get("location");
    if (!target || !cookie) { run.notes.push(`mock sign-in did not start (${r1.status})`); return false; }
    const r2 = await fetch(new URL(target, HOST).toString(), { redirect: "manual", headers: { cookie } });
    const back = r2.headers.get("location") ?? "";
    if (!/uaepass=ok/.test(back)) { run.notes.push(`mock sign-in did not complete: ${back.slice(0, 120)}`); return false; }
    const cid = new URL(back, HOST).searchParams.get("cid");
    if (cid) conversationId = cid;
    return true;
  }

  /**
   * A slot key is not always the words in the file name. "moa" shares no letters
   * with "memorandum-of-association", and the run on 2 November went to EPGL
   * without one because of it.
   */
  const ALIAS: Record<string, string> = {
    moa: "memorandum of association",
    eid: "emirates id",
    bod: "beneficial ownership declaration",
    tl: "trade licence",
  };

  /** The best file in the pack for a document slot the assistant asked for. */
  function fileFor(key: string): string | undefined {
    const expanded = key.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
      .split(" ").map((w) => ALIAS[w] ?? w).join(" ");
    const want = new Set(expanded.split(" ").map((w) => (w === "license" ? "licence" : w)));
    let best: { file: string; score: number } | undefined;
    for (const f of files) {
      const have = f.toLowerCase().replace(/\.pdf$/, "").replace(/^\d+-/, "").replace(/[^a-z0-9]+/g, " ").split(" ");
      const haveSet = new Set(have.map((w) => (w === "license" ? "licence" : w)));
      let score = 0;
      for (const w of want) if (haveSet.has(w)) score += w.length > 2 ? 2 : 1;
      // "partner1" in a filename vs "partner_1" in a key.
      for (const w of want) if (/^\d$/.test(w) && have.some((h) => h.endsWith(w))) score += 2;
      if (score && (!best || score > best.score)) best = { file: f, score };
    }
    return best?.file;
  }

  async function upload(key: string, attempt = 0): Promise<string> {
    const file = fileFor(key);
    if (!file) return `no file in the pack for ${key}`;
    const fd = new FormData();
    fd.append("agentSlug", SLUG);
    fd.append("conversationId", conversationId ?? "");
    fd.append("key", key);
    fd.append("file", new Blob([new Uint8Array(readFileSync(join(docsDir, file)))], { type: "application/pdf" }), file);
    try {
      const res = await fetch(`${HOST}/api/upload`, { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { rejected?: boolean; reason?: string };
      if (json.rejected) { run.rejected.push(`${key}: ${json.reason ?? "no reason"}`); return `REJECTED (${json.reason ?? "no reason"})`; }
      run.uploaded.push(key);
      return `uploaded ${file}`;
    } catch (e) {
      // Megabytes over a link that is not always steady. A dropped connection is
      // not a finding about the product — on 2 November it cost two whole runs.
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 15_000));
        return upload(key, attempt + 1);
      }
      return `upload failed: ${(e as Error).message}`;
    }
  }

  const wantedUploads = (t: string) =>
    [...t.matchAll(/```upload\n([\s\S]*?)```/g)].map((m) => /key:\s*(\S+)/.exec(m[1] ?? "")?.[1] ?? "").filter(Boolean);

  const pool = [...s.answers];
  const answers: [RegExp, string][] = [
    [/which (postal activity )?licence|which product|what are you applying for|choose the licence/i, s.describeSelf],
    [/already (a )?(submitted )?application|duplicate|existing application|update (the|an) existing/i, "Submit as a new application."],
    [/maximum shipment weight|how heavy|weight (you|your)/i, "30 kg."],
    [/payment method|how would you like to pay|virtual iban|card payment/i, "Card payment (online)."],
    [/company name|is that right for this application|confirm (your|the) (name|details)/i, "Yes, that's correct."],
    [/which emirate/i, s.company.emirate],
    [/region|area of|district/i, "Business Bay"],
    [/p\.?o\.? ?box/i, "50500"],
    [/e-?mail/i, "emre.karayalcin@7x.ae"],
    [/phone|mobile|contact number/i, "0553708434"],
    [/contact person|your full name|who should we contact/i, "Emre Karayalcin"],
    [/address|street|premises/i, s.company.addrEn],
    [/principal'?s? (cep )?licence number|principal licensee|licence number of the principal/i, "The principal is Emirates Post Group, CEP licence number CEP-2026-0001."],
    [/who (is|will be) (the|your) principal|hiring you/i, "Emirates Post Group."],
    [/how many (sites|locations|lockers)/i, "Four sites — two locker banks and two staffed counters."],
    [/consignments? (a|per) month|volume/i, "About 4,000 consignments a month."],
    [/terms|declaration|undertaking|agree|accept/i, "Yes, I have read and agree. Confirm and proceed."],
  ];

  let reply: string;
  try {
    reply = await say("I want to apply for a new postal activity licence.");
    if (!(await signIn())) { run.lastReply = reply; run.conversationId = conversationId; return run; }
    reply = await say("I've signed in. Please continue.");
  } catch (e) {
    run.notes.push(`threw before the journey started: ${(e as Error).message}`);
    run.conversationId = conversationId;
    return run;
  }

  const seen = new Set<string>();
  let lastSaid = "";
  let afterSubmit = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    run.turns = turn + 1;
    if (!run.feeSeen) {
      const fee = /AED\s*([\d,]+(?:\.\d\d)?)/.exec(reply);
      if (fee && /fee|pay|cost|amount/i.test(reply)) run.feeSeen = `AED ${fee[1]}`;
    }
    /**
     * A reference is not the end of the run.
     *
     * Two of these packs are ABOUT what happens after the application is filed
     * — the AED 40,000 one must not open a card, and the outsourcing permit has
     * no fee at all — so stopping at the reference would skip the only thing
     * they test. Four more turns after a reference, then stop; a card that
     * opens stops it immediately, because nothing here pays.
     */
    if (run.paymentOpened || /```pay\b/.test(reply)) { run.lastReply = reply; break; }
    if (!run.reference && /\bLR-\d{4,}\b/.test(reply) && /submitted|reference|received|filed/i.test(reply)) {
      run.reference = /\bLR-\d{4,}\b/.exec(reply)![0];
    }
    if (run.reference && ++afterSubmit > 4) { run.lastReply = reply; break; }
    try {
    const asked = wantedUploads(reply).filter((k) => !seen.has(k));
    if (asked.length) {
      if (asked.length > 1) run.notes.push(`asked for ${asked.length} documents in one message: ${asked.join(", ")}`);
      for (const key of asked) { seen.add(key); console.log(`      · ${key} — ${await upload(key)}`); }
      // The widget's own shape for "a file landed": a silent turn whose text is
      // a directive the server substitutes, not something a customer typed.
      reply = await say("document_uploaded", { documentUploaded: true });
      continue;
    }
    const hit = answers.find(([re]) => re.test(reply));
    const next = hit ? hit[1] : (pool.shift() ?? "Yes, that's correct — please continue.");
    reply = await say(next === lastSaid ? "Please continue with the application." : next);
    lastSaid = next;
    } catch (e) {
      // Whatever has already happened is worth more than the stack trace: the
      // application may well be filed, and the reference is on the run.
      run.notes.push(`turn ${turn + 1} threw: ${(e as Error).message}`);
      break;
    }
  }
  run.lastReply ||= reply;
  run.conversationId = conversationId;
  return run;
}

async function main() {
  const only = cliArg("--pack");
  const packs = process.argv.includes("--all") ? ALL : ALL.filter((p) => p.dir === only);
  if (!packs.length) throw new Error(`--pack <dir> (one of: ${ALL.map((p) => p.dir).join(", ")}) or --all`);
  console.log(`\n${HOST} · ${SLUG} · ${packs.length} pack(s)\n`);
  const runs: Run[] = [];
  for (const s of packs) {
    console.log(`  ${s.dir}  (${s.code}, licence ${s.company.tl})`);
    try { runs.push(await runPack(s)); }
    catch (e) { runs.push({ pack: s.dir, submissions: 0, createAttempts: 0, paymentOpened: false, uploaded: [], rejected: [], notes: [`threw: ${(e as Error).message}`], lastReply: "", turns: 0 }); }
    const r = runs[runs.length - 1]!;
    console.log(`    reference: ${r.reference ?? "—"}   fee: ${r.feeSeen ?? "—"}   card: ${r.paymentOpened ? "opened" : "no"}   docs: ${r.uploaded.length}   turns: ${r.turns}`);
    if (r.rejected.length) console.log(`    rejected: ${r.rejected.join(" · ")}`);
    for (const n of r.notes) console.log(`    note: ${n}`);
    console.log(`    conversation ${r.conversationId ?? "—"}`);
    console.log(`    last reply: ${r.lastReply.replace(/\s+/g, " ").slice(0, 300)}\n`);
  }
  console.log("\n  summary");
  for (const r of runs) console.log(`   ${r.reference ? "OK  " : "--  "} ${r.pack.padEnd(32)} ${r.reference ?? "no reference"}  ${r.feeSeen ?? ""}`);
  console.log("");
}

void main();
