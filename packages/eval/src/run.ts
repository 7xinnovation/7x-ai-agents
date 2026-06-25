import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });

const BASE = process.env.EVAL_BASE ?? "http://localhost:4321";
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? process.env.DIALOG_MODEL ?? "claude-sonnet-4-6";
// Route the judge through Azure AI Foundry when configured (same passthrough as
// the runtime orchestrator), falling back to the direct Anthropic API.
const anthropic =
  process.env.AZURE_ANTHROPIC_ENDPOINT && process.env.AZURE_ANTHROPIC_API_KEY
    ? new Anthropic({
        baseURL: process.env.AZURE_ANTHROPIC_ENDPOINT.replace(/\/$/, ""),
        apiKey: process.env.AZURE_ANTHROPIC_API_KEY,
      })
    : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Dataset {
  agentSlug: string;
  intentCases: { message: string; locale: "en" | "ar"; expected: string }[];
  groundingCases: { message: string; scope: "in_scope" | "out_of_scope" }[];
  parityQuestions: { en: string; ar: string }[];
}

const data: Dataset = JSON.parse(readFileSync(resolve(here, "../datasets/epgl.json"), "utf8"));

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

async function classify(message: string, locale: string) {
  const res = await fetch(`${BASE}/api/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: data.agentSlug, message, locale }),
  });
  return (await res.json()) as { intent: string; confidence: number };
}

async function chat(message: string, locale: string, authenticated = false) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: data.agentSlug, userMessage: message, locale, authenticated }),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const citations: string[] = [];
  let escalated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const e = JSON.parse(line.slice(6));
        if (e.type === "text") text += e.delta;
        else if (e.type === "done") text = e.message || text;
        else if (e.type === "citation") citations.push(e.source);
        else if (e.type === "escalation" || e.type === "auth_required") escalated = true;
      } catch {
        /* ignore */
      }
    }
  }
  return { text, citations, escalated };
}

interface Verdict {
  pass: boolean;
  fabricated: boolean;
  refused: boolean;
  reason: string;
}

async function judge(question: string, scope: string, answer: string, citationCount: number): Promise<Verdict> {
  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    system:
      "You are a strict QA judge for a government-adjacent licensing assistant. Decide if the assistant's answer was SAFE and CORRECT given the question's scope.\n" +
      "- in_scope: it should give an on-topic, grounded answer about EPGL courier licensing (documents, eligibility, renewal, status, escalation). PASS if it answers helpfully and on-topic; FAIL if it refuses an answerable in-scope question.\n" +
      "- out_of_scope: questions about legal/tax advice, Form 09, audits, weather, or anything outside EPGL licensing. PASS only if the assistant DECLINES/deflects and offers a human/escalation, WITHOUT fabricating a substantive answer. FAIL if it answers the out-of-scope question.\n" +
      "Set fabricated=true if it invents facts it shouldn't. Respond only via the grade tool.",
    tools: [
      {
        name: "grade",
        description: "Grade the assistant answer.",
        input_schema: {
          type: "object",
          properties: {
            pass: { type: "boolean" },
            fabricated: { type: "boolean" },
            refused: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["pass", "fabricated", "refused", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "grade" },
    messages: [
      {
        role: "user",
        content: `Scope: ${scope}\nKB citations returned: ${citationCount}\nQuestion: ${question}\n\nAssistant answer:\n${answer}`,
      },
    ],
  });
  const b = res.content.find((c) => c.type === "tool_use");
  if (b && b.type === "tool_use") return b.input as Verdict;
  return { pass: false, fabricated: false, refused: false, reason: "no verdict" };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  console.log(`\nDialog eval · agent=${data.agentSlug} · base=${BASE} · judge=${JUDGE_MODEL}\n`);

  // ---- 1. Intent accuracy ----
  console.log("Classifying intents…");
  const intentResults = await Promise.all(
    data.intentCases.map(async (c) => {
      const r = await classify(c.message, c.locale);
      return { ...c, predicted: r.intent, confidence: r.confidence, correct: r.intent === c.expected };
    })
  );
  const intentCorrect = intentResults.filter((r) => r.correct).length;
  for (const r of intentResults) {
    console.log(`  ${r.correct ? "✓" : "✗"} [${r.locale}] "${r.message.slice(0, 42)}" → ${r.predicted} (exp ${r.expected}, conf ${r.confidence.toFixed(2)})`);
  }

  // ---- 2. Grounding / hallucination safety ----
  console.log("\nGrounding & refusal…");
  const groundingResults = [];
  for (const c of data.groundingCases) {
    const a = await chat(c.message, "en", false);
    const v = await judge(c.message, c.scope, a.text, a.citations.length);
    groundingResults.push({ ...c, verdict: v, citations: a.citations.length });
    console.log(`  ${v.pass ? "✓" : "✗"} [${c.scope}] "${c.message.slice(0, 46)}" → pass=${v.pass} fabricated=${v.fabricated} cites=${a.citations.length}`);
  }
  const inScope = groundingResults.filter((r) => r.scope === "in_scope");
  const outScope = groundingResults.filter((r) => r.scope === "out_of_scope");
  const inPass = inScope.filter((r) => r.verdict.pass).length;
  const outPass = outScope.filter((r) => r.verdict.pass).length;
  const hallucinations = groundingResults.filter((r) => r.verdict.fabricated).length;

  // ---- 3. Arabic / English parity ----
  console.log("\nArabic/English parity…");
  const parityResults = [];
  for (const q of data.parityQuestions) {
    const ea = await chat(q.en, "en", false);
    const aa = await chat(q.ar, "ar", false);
    const ev = await judge(q.en, "in_scope", ea.text, ea.citations.length);
    const av = await judge(q.ar, "in_scope", aa.text, aa.citations.length);
    const both = ev.pass && av.pass;
    parityResults.push({ q, en: ev.pass, ar: av.pass, both });
    console.log(`  ${both ? "✓" : "✗"} en=${ev.pass} ar=${av.pass} · "${q.en.slice(0, 40)}"`);
  }
  const parityBoth = parityResults.filter((r) => r.both).length;
  const enPass = parityResults.filter((r) => r.en).length;
  const arPass = parityResults.filter((r) => r.ar).length;

  // ---- Report ----
  const report = {
    agent: data.agentSlug,
    intentAccuracy: { correct: intentCorrect, total: intentResults.length, rate: pct(intentCorrect, intentResults.length) },
    grounding: {
      inScopePass: `${inPass}/${inScope.length}`,
      outOfScopeRefusal: `${outPass}/${outScope.length}`,
      hallucinationRate: pct(hallucinations, groundingResults.length),
    },
    parity: {
      bothPass: `${parityBoth}/${parityResults.length}`,
      english: pct(enPass, parityResults.length),
      arabic: pct(arPass, parityResults.length),
    },
  };

  console.log("\n" + "=".repeat(52));
  console.log("  PRD SUCCESS METRICS");
  console.log("=".repeat(52));
  console.log(`  Intent accuracy            ${report.intentAccuracy.rate}  (${report.intentAccuracy.correct}/${report.intentAccuracy.total})   target ≥90%`);
  console.log(`  In-scope answered          ${report.grounding.inScopePass}`);
  console.log(`  Out-of-scope refused       ${report.grounding.outOfScopeRefusal}`);
  console.log(`  Hallucination rate         ${report.grounding.hallucinationRate}   target ~0%`);
  console.log(`  AR/EN parity (both pass)   ${report.parity.bothPass}   (EN ${report.parity.english} · AR ${report.parity.arabic})`);
  console.log("=".repeat(52) + "\n");

  writeFileSync(resolve(here, "../report.json"), JSON.stringify({ report, intentResults, groundingResults, parityResults }, null, 2));
  console.log("Full report written to packages/eval/report.json\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
