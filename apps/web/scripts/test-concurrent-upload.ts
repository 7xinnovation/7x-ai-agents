/**
 * Regression test for the concurrent-upload race (QA, 2026-08-11).
 *
 * Uploading a second document while the first was still being read by the vision
 * model silently un-uploaded the first: both requests read the case before
 * either had saved, and the last write won. The customer saw the trade licence
 * revert to "not uploaded" and was asked for it again.
 *
 * Fires two uploads at the same moment and asserts BOTH survive.
 *
 * Needs the app running and two files to send:
 *   npx tsx scripts/test-concurrent-upload.ts [baseUrl]
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const DOCS_DIR = "/Users/emrekarayalcin/Documents/7x-proj-tech/agents";
const TRADE = `${DOCS_DIR}/Postal License_Adb-0013207.pdf`;
const MOA = `${DOCS_DIR}/MOU 2008_compressed (1).pdf`;

async function startConversation(): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: "epgl-dialog", userMessage: "I want to apply for a new courier licence", locale: "en" }),
  });
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const ev = JSON.parse(line.slice(5));
      if (ev.conversationId) return ev.conversationId as string;
    } catch { /* keepalive */ }
  }
  throw new Error("no conversation id");
}

interface UploadResult {
  case?: { documents?: { key: string; status: string }[] };
  rejected?: boolean;
  reason?: string;
  finishedAt?: number;
}

async function upload(conversationId: string, key: string, path: string): Promise<UploadResult> {
  const form = new FormData();
  form.set("agentSlug", "epgl-dialog");
  form.set("conversationId", conversationId);
  form.set("key", key);
  form.set("file", new Blob([readFileSync(path)], { type: "application/pdf" }), basename(path));
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  const json = (await res.json()) as UploadResult;
  json.finishedAt = Date.now();
  return json;
}

async function main() {
  for (const f of [TRADE, MOA]) {
    if (!existsSync(f)) throw new Error(`missing test document: ${f}`);
  }
  const cid = await startConversation();
  console.log(`  conversation ${cid}`);

  // Both in flight at once — the case is read by each before either has saved.
  console.log("  uploading trade licence and MOA simultaneously…");
  const [a, b] = await Promise.all([
    upload(cid, "trade_license", TRADE),
    upload(cid, "moa", MOA),
  ]);
  for (const [name, r] of [["trade_license", a], ["moa", b]] as const) {
    if (r.rejected) console.log(`  note: ${name} was rejected — ${r.reason}`);
  }

  // Read the case back from the server, not from either response.
  const res = await fetch(`${BASE}/api/conversations/${cid}`);
  const json = (await res.json()) as { case?: { documents?: { key: string; status: string }[] } };
  const docs = json.case?.documents ?? [];
  const status = (k: string) => docs.find((d) => d.key === k)?.status ?? "missing";

  const tl = status("trade_license");
  const moa = status("moa");
  console.log(`  persisted → trade_license=${tl}  moa=${moa}`);

  const serverOk = tl === "uploaded" && moa === "uploaded";
  console.log(serverOk
    ? "  PASS  both documents survived concurrent upload (server)"
    : "  FAIL  a concurrent upload erased the other document (server)");

  // The embed applies the case from whichever upload finishes LAST and ignores
  // the earlier one, because the earlier response describes the case before the
  // other document existed. That is only safe if the last response really does
  // carry both — assert the contract the client now depends on.
  const last = (a.finishedAt ?? 0) >= (b.finishedAt ?? 0) ? a : b;
  const lastDocs = last.case?.documents ?? [];
  const lastHasBoth = ["trade_license", "moa"].every((k) =>
    lastDocs.some((d) => d.key === k && (d.status === "uploaded" || d.status === "accepted"))
  );
  console.log(lastHasBoth
    ? "  PASS  the last response carries both documents (what the panel renders)"
    : `  FAIL  the last response lists only: ${lastDocs.map((d) => `${d.key}=${d.status}`).join(", ")}`);

  const ok = serverOk && lastHasBoth;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
