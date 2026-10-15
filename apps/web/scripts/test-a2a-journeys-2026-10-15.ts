/**
 * Every PO Box journey through the A2A doorway, end to end, with a model
 * playing the customer.
 *
 * Fixed rules cannot answer a conversational agent reliably (an extra question
 * and the script stalls), so each journey has a customer with a goal and the
 * facts they know, played by the fast model. The script reads the agent's text
 * AND its structured blocks, sends what the customer would, settles any
 * sandbox payment when it appears, and stops when the task completes, asks for
 * something the customer cannot give, or runs out of turns. Then it checks
 * the outcome against what the journey should produce.
 *
 * From apps/web (reads the model credentials from the repo .env):
 *   npx tsx scripts/test-a2a-journeys-2026-10-15.ts --base <origin> --key <api key> [--only <journey id>]
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });
import { getAnthropic, fastModel } from "@dialog/core";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (arg("--base") ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = arg("--key")!;
const ONLY = arg("--only");
const EXT = "https://agent.7x.ae/a2a/extensions/citizen-identity/v1";

type Part = { text?: string; data?: Record<string, unknown> };
type Task = {
  id: string;
  contextId: string;
  status: { state: string; message?: { parts: Part[] } };
  artifacts?: { name?: string; parts: Part[] }[];
  metadata?: Record<string, unknown>;
};

interface Journey {
  id: string;
  persona: "ahmed-al-mansoori" | "guest";
  locale: "en" | "ar";
  opening: string;
  customer: string;
  /** What a successful run must end with. */
  expect: (t: Task, transcript: string) => { ok: boolean; why: string };
  /** A run that ends here is a known limitation, reported but not a failure. */
  limitation?: RegExp;
}

const outcome = (t: Task) => t.artifacts?.find((a) => a.name === "service-outcome")?.parts[0]?.data as
  | { journey?: string; reference?: string; payment?: { status?: string; amount?: number } }
  | undefined;
const completedWith = (journey: string) => (t: Task) => {
  const o = outcome(t);
  const ok = t.status.state === "TASK_STATE_COMPLETED" && o?.journey === journey && o?.payment?.status === "paid" && Boolean(o?.reference);
  return { ok, why: `state ${t.status.state}, outcome ${JSON.stringify(o ?? null).slice(0, 160)}` };
};

const JOURNEYS: Journey[] = [
  {
    id: "personal-renewal-signed-in",
    persona: "ahmed-al-mansoori",
    locale: "en",
    opening: "I'd like to renew my PO Box 50500 in Dubai.",
    customer: "You are Ahmed Al Mansoori, signed in. Renew box 50500 in Dubai for one year on the same bundle. Pay by card. Accept the terms. Decline extras like auto-renewal or saving your card. Your mobile and email on file are correct.",
    expect: completedWith("personal_po_box_renewal"),
  },
  {
    id: "personal-renewal-guest",
    persona: "guest",
    locale: "en",
    opening: "I need to renew PO Box 50500 in Dubai.",
    customer:
      "You are a guest (not signed in), the holder of PO Box 50500 in Dubai. Renew for one year, same bundle, pay by card. If asked whether the masked name is you, say yes. Your name is Ahmed Al Mansoori, mobile +971 50 555 0142, email ahmed.almansoori@example.ae, area Al Barsha, street Al Barsha 1. Accept the terms. Decline auto-renewal and saving the card.",
    expect: completedWith("personal_po_box_renewal"),
  },
  {
    id: "personal-rental-signed-in",
    persona: "ahmed-al-mansoori",
    locale: "en",
    opening: "I want to rent a new personal PO Box in Dubai.",
    customer:
      "You are Ahmed Al Mansoori, signed in. Rent a MyBox in Dubai at Dubai Central Post Office, any available box number (pick the first offered), for 1 year. No authorised agent. Collect the key from the branch. Your contact details on file are correct. Accept the terms; decline saving the card and auto-renewal. Pay by card.",
    expect: completedWith("personal_po_box_rental"),
  },
  {
    id: "personal-renewal-arabic",
    persona: "ahmed-al-mansoori",
    locale: "ar",
    opening: "أريد تجديد صندوق البريد رقم 50500 في دبي لسنة واحدة.",
    customer:
      "أنت أحمد المنصوري، مسجل الدخول. جدد صندوق البريد 50500 في دبي لسنة واحدة بنفس الباقة، وادفع بالبطاقة، ووافق على الشروط، وارفض التجديد التلقائي وحفظ البطاقة. اكتب بالعربية دائماً.",
    expect: (t, transcript) => {
      const base = completedWith("personal_po_box_renewal")(t);
      const arabic = /[؀-ۿ]{4,}/.test(transcript.split("AGENT:").slice(1).join(" "));
      return { ok: base.ok && arabic, why: `${base.why}; agent replied in Arabic: ${arabic}` };
    },
  },
  {
    id: "manage-auto-renewal",
    persona: "ahmed-al-mansoori",
    locale: "en",
    opening: "Please switch on auto-renewal for my Dubai PO Box.",
    customer: "You are Ahmed Al Mansoori, signed in. You want auto-renewal turned on for box 50500 in Dubai. Confirm when asked. Nothing else.",
    expect: (t, transcript) => {
      // Any agent reply, with markdown stripped: "Auto-renewal is now **ON**" is the confirmation.
      const said = transcript.split("AGENT:").slice(1).join(" ").replace(/\*\*/g, "");
      const done = /auto-?renew(al)? (is )?(now )?(confirmed )?(on|switched on|enabled|turned on)\b|switched on auto-?renew|is now (on|enabled)/i.test(said);
      return { ok: done && t.status.state !== "TASK_STATE_FAILED", why: `state ${t.status.state}; confirmed on: ${done}` };
    },
  },
  {
    id: "corporate-renewal-guest",
    persona: "guest",
    locale: "en",
    opening: "I need to renew our company PO Box 50500 in Dubai.",
    customer:
      "You represent a company holding PO Box 50500 in Dubai. Trade licence number 123456. Renew for one year, same bundle, pay by card. Contact: Omar Haddad, mobile +971 50 123 4567, email omar.haddad@example.ae, area Business Bay, street Marasi Drive. If asked whether a masked holder name is you, say yes. Accept the terms.",
    expect: completedWith("corporate_po_box_renewal"),
  },
  {
    id: "corporate-rental-signed-in",
    persona: "ahmed-al-mansoori",
    locale: "en",
    opening: "We want to rent a PO Box for our company in Dubai.",
    customer:
      "You are Ahmed Al Mansoori, signed in, renting a corporate PO Box for your company in Dubai: Basic Box bundle, Dubai Central Post Office, first available number, 1 year, issuing authority Dubai Economy and Tourism (DET), trade licence number 1234567, company 'Al Mansoori Trading LLC', company address Office 1204, Bay Square, Business Bay, Dubai. No authorised agent; collect the key at the branch. If a document upload is required, say you cannot upload files in this channel and ask how to continue. Accept the terms, pay by card.",
    expect: completedWith("corporate_po_box_rental"),
    limitation: /upload|document|trade licen[cs]e (copy|document)|attach/i,
  },
  {
    id: "enquiry-branches-and-prices",
    persona: "guest",
    locale: "en",
    opening: "What does a personal PO Box cost in Abu Dhabi and which branches have them?",
    customer: "You are a guest just asking questions. When you have prices and a few branch names, say thanks and stop.",
    expect: (t, transcript) => {
      const last = transcript.split("AGENT:").slice(1).join(" ");
      const ok = /AED\s?\d/.test(last) && /post office|branch/i.test(last) && t.status.state !== "TASK_STATE_FAILED";
      return { ok, why: `prices and branches mentioned: ${ok}` };
    },
  },
];

// ─── Doorway calls ───────────────────────────────────────────────────────────

let rpcId = 0;
async function rpc(method: string, params: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/a2a/po-box-sandbox`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "a2a-version": "1.0" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      });
      return (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const textOf = (t: Task) => t.status.message?.parts.find((p) => typeof p.text === "string")?.text ?? "";
const dataOf = (t: Task) => (t.status.message?.parts.find((p) => p.data)?.data ?? {}) as { blocks?: unknown[]; awaiting?: string; case?: unknown };

// ─── The customer ────────────────────────────────────────────────────────────

async function customerSays(j: Journey, transcript: string, agentText: string, blocks: unknown[]): Promise<string> {
  const res = await getAnthropic().messages.create({
    model: fastModel(),
    max_tokens: 300,
    system:
      `You are role-playing a customer talking to an Emirates Post PO Box service agent through an API. ${j.customer}\n\n` +
      "You receive the agent's latest reply and the structured blocks it offered (buttons, cards, toggles, payment). " +
      "Reply with ONLY the next message the customer sends, nothing else, no quotes. " +
      "When the agent offers buttons or cards, reply with the exact option text you choose. " +
      'For a "toggles" block, follow its "reply" instruction exactly, answering each item according to your instructions, then the confirm label. ' +
      "If the agent shows a payment button or link, reply that you will pay now. Keep replies short. " +
      (j.locale === "ar" ? "Write in Arabic, but copy option texts exactly as offered." : "Write in English."),
    messages: [
      {
        role: "user",
        content: `Conversation so far:\n${transcript.slice(-6000)}\n\nAgent's latest reply:\n${agentText}\n\nStructured blocks:\n${JSON.stringify(blocks).slice(0, 4000)}\n\nYour next message:`,
      },
    ],
  });
  const out = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
  return out.replace(/^["']|["']$/g, "");
}

// ─── Running a journey ───────────────────────────────────────────────────────

interface Result {
  id: string;
  status: "pass" | "fail" | "limitation";
  turns: number;
  seconds: number;
  why: string;
  contextId?: string;
  lastAgent: string;
}

async function run(j: Journey): Promise<Result> {
  const started = Date.now();
  let transcript = `CUSTOMER: ${j.opening}\n`;
  let first = await rpc("SendMessage", {
    message: { role: "ROLE_USER", parts: [{ text: j.opening }], metadata: { [EXT]: { persona: j.persona }, locale: j.locale } },
  });
  if (first.error) return { id: j.id, status: "fail", turns: 1, seconds: 0, why: `error ${first.error.code} ${first.error.message}`, lastAgent: "" };
  let task = (first.result as { task: Task }).task;
  let settled = false;
  let turns = 1;
  for (; turns < 22; turns++) {
    const said = textOf(task);
    transcript += `AGENT: ${said}\n`;
    if (task.status.state === "TASK_STATE_COMPLETED" || task.status.state === "TASK_STATE_FAILED" || task.status.state === "TASK_STATE_CANCELED") break;

    // A payment to make: settle it the way an integrator would in the sandbox, then wait for the task to move on.
    const pay = task.artifacts?.find((a) => a.name === "payment-request")?.parts[0]?.data as { reference?: string; sandbox?: { settleUrl?: string } } | undefined;
    if (task.metadata?.awaiting === "payment" && pay?.sandbox?.settleUrl && !settled) {
      settled = true;
      const s = await fetch(pay.sandbox.settleUrl, { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY }, body: '{"outcome":"paid"}' });
      transcript += `(sandbox payment ${pay.reference} settled: HTTP ${s.status})\n`;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const g = await rpc("GetTask", { id: task.id });
        const t = g.result as Task | undefined;
        if (t && t.status.state !== "TASK_STATE_WORKING" && t.metadata?.awaiting !== "payment") {
          task = t;
          break;
        }
      }
      continue;
    }

    const next = await customerSays(j, transcript, said, dataOf(task).blocks ?? []);
    transcript += `CUSTOMER: ${next}\n`;
    const r = await rpc("SendMessage", { message: { role: "ROLE_USER", taskId: task.id, contextId: task.contextId, parts: [{ text: next }] } });
    if (r.error) {
      // A completed task means the outcome is in; anything else is a real error.
      if (r.error.code === -32004) break;
      return { id: j.id, status: "fail", turns, seconds: Math.round((Date.now() - started) / 1000), why: `error ${r.error.code} ${r.error.message}`, contextId: task.contextId, lastAgent: said.slice(0, 300) };
    }
    task = (r.result as { task: Task }).task;
  }
  const final = (await rpc("GetTask", { id: task.id })).result as Task;
  const verdict = j.expect(final, transcript);
  const lastAgent = textOf(final);
  const status = verdict.ok ? "pass" : j.limitation && j.limitation.test(transcript.split("AGENT:").slice(-3).join(" ")) ? "limitation" : "fail";
  return { id: j.id, status, turns, seconds: Math.round((Date.now() - started) / 1000), why: verdict.why, contextId: task.contextId, lastAgent: lastAgent.replace(/\s+/g, " ").slice(0, 300) };
}

async function main() {
  const list = ONLY ? JOURNEYS.filter((j) => j.id === ONLY) : JOURNEYS;
  // Two at a time: fast enough, gentle on the staging app and the model quota.
  const results: Result[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const batch = await Promise.all(list.slice(i, i + 2).map((j) => run(j).catch((e) => ({ id: j.id, status: "fail" as const, turns: 0, seconds: 0, why: String(e), lastAgent: "" }))));
    for (const r of batch) {
      results.push(r);
      console.log(`${r.status === "pass" ? "ok  " : r.status === "limitation" ? "LIM " : "FAIL"} ${r.id.padEnd(30)} ${String(r.turns).padStart(2)} turns ${String(r.seconds).padStart(4)}s  ${r.why}`);
      if (r.status !== "pass") console.log(`      last agent reply: ${r.lastAgent}\n      context: ${r.contextId ?? "-"}`);
    }
  }
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(`\n${results.filter((r) => r.status === "pass").length} passed, ${results.filter((r) => r.status === "limitation").length} known limitation, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
