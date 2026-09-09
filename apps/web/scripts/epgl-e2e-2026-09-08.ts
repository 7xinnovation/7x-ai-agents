/**
 * The whole EPGL new-licence application, driven through the real chat endpoint.
 *
 * Not a mock: it posts to /api/chat and /api/upload on the deployed site, sends
 * the actual trade licence, MOA, Emirates IDs and passports, and follows
 * whatever the assistant asks for rather than a fixed script — a scripted driver
 * fights the model the moment it varies its order, and then every later check
 * fails for a reason that has nothing to do with what is being tested.
 *
 * It stops at the payment card. The card needs a human, and the application it
 * leaves behind is real, so run it against a sandbox Salesforce only.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-e2e-2026-09-08.ts --host <url> [--docs <dir>] [--verbose]
 *
 * The documents are looked for in --docs and in its TEST subfolder, because that
 * is where they actually live: half in one, half in the other.
 */
export {};

const cliArg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const HOST = (cliArg("--host") ?? "").replace(/\/$/, "");
const DOCS = cliArg("--docs") ?? "/Users/emrekarayalcin/Documents/7x-proj-tech/agents";
/** "gateway" (default) or "viban" — which payment branch to walk. */
const PAY = (cliArg("--pay") ?? "gateway").toLowerCase();
const VERBOSE = process.argv.includes("--verbose");
if (!HOST) throw new Error("--host <https://…> is required");

const { readFileSync, existsSync } = await import("node:fs");

/** Which real file answers which document slot. */
const FILES: Record<string, string> = {
  trade_license: "Trade License Main 697670 - 2025 - 2026.pdf",
  moa: "Yi Fang MOA 2020 (old).pdf",
  emirates_id: "EID - Faisal Eissa Lutfi Ali Hussain.pdf",
  partner_1_emirates_id: "EID - Faisal Eissa Lutfi Ali Hussain.pdf",
  partner_1_passport: "Passport - Faisal - Details Page.pdf",
  partner_2_emirates_id: "EID - Mohammad Al Nuaimi.pdf",
  partner_2_passport: "Passport Mohamed Alnuaimi .pdf",
  partner_3_emirates_id: "EID - Valentina Mintah.pdf",
  partner_3_passport: "Passport - Valentina Mintah.pdf",
};

let conversationId: string | undefined;
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`    ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`    FAIL ${name}${got === undefined ? "" : `\n         ${String(got).slice(0, 220)}`}`); }
}

async function say(userMessage: string, attempt = 0): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentSlug: "epgl-dialog", userMessage, conversationId, locale: "en" }),
    });
  } catch (e) {
    // The documents are megabytes and the link to the host is not always
    // steady. A dropped connection is not a finding about the product.
    if (attempt >= 4) throw e;
    console.log(`    (connection dropped; retrying in 20s)`);
    await new Promise((r) => setTimeout(r, 20_000));
    return say(userMessage, attempt + 1);
  }
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (e) {
      // ECONNRESET part-way through the stream. The request was fine; the link
      // dropped. Retrying the whole turn is what a customer's browser would do.
      if (attempt >= 4) throw e;
      console.log(`    (stream dropped; asking again in 20s)`);
      await new Promise((r) => setTimeout(r, 20_000));
      return say(userMessage, attempt + 1);
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
          if (typeof ev.conversationId === "string") conversationId = ev.conversationId;
        } catch { /* keepalive */ }
      }
    }
  }
  // The model endpoint blips; a customer would just send it again.
  if (/\[ERROR\]|went wrong on our side/.test(text) && attempt < 2) {
    console.log("    (transient error; asking again in 12s)");
    await new Promise((r) => setTimeout(r, 12_000));
    return say(userMessage, attempt + 1);
  }
  if (VERBOSE) console.log(`\n> ${userMessage}\n${text}\n`);
  return text;
}

/** Every `upload` block the assistant put in a reply, in order. */
const wantedUploads = (t: string) =>
  [...t.matchAll(/```upload\n([\s\S]*?)```/g)]
    .map((m) => /key:\s*(\S+)/.exec(m[1] ?? "")?.[1] ?? "")
    .filter(Boolean);

async function upload(key: string, attempt = 0): Promise<string> {
  const name = FILES[key];
  if (!name) return `(no file mapped for ${key})`;
  const path = [`${DOCS}/${name}`, `${DOCS}/TEST/${name}`].find((p) => existsSync(p));
  if (!path) return `(missing on disk: ${name})`;
  const fd = new FormData();
  fd.append("agentSlug", "epgl-dialog");
  fd.append("conversationId", conversationId ?? "");
  fd.append("key", key);
  fd.append("file", new Blob([new Uint8Array(readFileSync(path))], { type: "application/pdf" }), name);
  try {
    const res = await fetch(`${HOST}/api/upload`, { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as { rejected?: boolean; reason?: string };
    return json.rejected ? `REJECTED: ${json.reason ?? "no reason"}` : "uploaded";
  } catch (e) {
    if (attempt >= 4) return `(upload failed: ${(e as Error).message})`;
    console.log(`    (upload of ${key} dropped; retrying in 20s)`);
    await new Promise((r) => setTimeout(r, 20_000));
    return upload(key, attempt + 1);
  }
}

console.log(`\n${HOST} · epgl-dialog · new licence, driven end to end\n`);

/**
 * What to say to whatever was just asked.
 *
 * Ordered: the first pattern that matches wins, so the specific questions sit
 * above the catch-all. Uploads are not in here — they are handled before this
 * is consulted, because answering "yes" into an open file picker is what the
 * assistant reasonably reads as the customer not having uploaded anything.
 */
const answers: [RegExp, string][] = [
  [/duplicate|existing applications on file|update one of these/i, "Submit as new application"],
  [/postal (services|activities)|which activities|activity code/i, "Letters & post items delivery, and parcels delivery."],
  [/payment method|how would you like to pay|virtual iban/i, PAY === "viban" ? "Bank transfer (Virtual IBAN)" : "Card payment (online)"],
  [/owner'?s emirates id|emirates id number/i, "784-1984-0847950-3"],
  [/which emirate/i, "Dubai"],
  [/region|area of/i, "Al Mankhool"],
  [/p\.?o\.? ?box/i, "13422"],
  [/e-?mail/i, "emre.karayalcin@7x.ae"],
  [/phone|mobile|contact number/i, "0553708434"],
  [/contact person|who should we contact|your full name/i, "Emre Karayalcin"],
  [/address|street|premises|map|pin/i, "Shop No. R.40.13, Roads and Transport Authority Property (BurJuman Station) - Al Mankhool"],
  [/terms|declaration|undertaking|accept/i, "Yes, I accept."],
];

const seen = new Set<string>();
let reply = await say("I want to apply for a new postal activity licence");
let priced = "";
let lastSaid = "";
/** The licence request number, which only exists once the composite lands. */
let submitted = false;

console.log("  walking the journey");
/**
 * A real payment card, not a sentence about one.
 *
 * "The secure payment card will appear below" is what the assistant says when it
 * has narrated the submission and called nothing — and an earlier version of
 * this driver counted that as reaching payment, so a run where neither the
 * submission nor the payment happened reported 6/6. Only the block itself, or a
 * button carrying an amount, means the customer can actually pay.
 */
const paid = (t: string) => /```pay\b/.test(t) || /Pay\s+AED\s*[\d,]+/i.test(t);

for (let turn = 0; turn < 40; turn++) {
  // The Virtual IBAN branch never opens a card; a licence request number is
  // the whole of its success.
  if (PAY === "viban" ? submitted : paid(reply)) { priced = reply; break; }

  // 1. Anything it asked to be uploaded, before anything is said.
  const asked = wantedUploads(reply).filter((k) => !seen.has(k));
  if (asked.length) {
    const results: string[] = [];
    for (const key of asked) {
      seen.add(key);
      const r = await upload(key);
      results.push(`${key}: ${r}`);
      if (r.startsWith("REJECTED")) check(`${key} was accepted`, false, r);
    }
    console.log(`    sent — ${results.join(" · ")}`);
    reply = await say("I've uploaded that. Please carry on.");
    continue;
  }

  if (/\bLR-\d{4,}\b/.test(reply) && /submitted|reference|received/i.test(reply)) submitted = true;

  // 2. Otherwise answer what was asked.
  const hit = answers.find(([re]) => re.test(reply));
  const next = hit ? hit[1] : "Yes, that's correct — please continue.";
  // Saying the same thing twice into the same question gets nowhere; move it on.
  reply = await say(next === lastSaid ? "Please continue with the application." : next);
  lastSaid = next;
}

console.log("\n  the documents");
check("the trade licence was taken", seen.has("trade_license"));
check("the MOA was taken", seen.has("moa"));
check(
  "all three partners' documents were asked for",
  ["partner_1_emirates_id", "partner_2_emirates_id", "partner_3_emirates_id"].every((k) => seen.has(k)),
  [...seen].join(", ")
);

console.log("\n  submission and payment");
check(PAY === "viban" ? "it reached the end of the Virtual IBAN branch" : "it reached a real payment card", Boolean(priced), reply.slice(0, 220));
check("the application was actually submitted, not just narrated", submitted, reply.slice(0, 220));
check("nothing blew up on our side", !/went wrong on our side/i.test(reply), reply.slice(0, 220));
check("no internal identifier leaked", !/maps to key|__c\b|referenceId/i.test(priced || reply), (priced || reply).slice(0, 220));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log(`failed: ${failures.join(" · ")}`);
console.log(`conversation ${conversationId}\n`);
process.exit(fail ? 1 : 0);
