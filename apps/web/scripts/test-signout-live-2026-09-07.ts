/**
 * Signing out, end to end (2026-09-07).
 *
 * Signing in had no way out. On a shared or public screen that leaves a PO Box
 * account — its addresses, its agents — one tap away for whoever sits down next.
 *
 * The half that matters is the SERVER's: clearing only the client's view of a
 * session was FB-1485, where the header said signed out while the next turn was
 * still authenticated. So this checks the conversation itself, not the widget.
 *
 * STAGING. It signs a throwaway conversation in and out again.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-signout-live-2026-09-07.ts --env <file> --host <url> --token <jwt>
 */
import { config } from "dotenv";
import { resolve } from "node:path";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
config({ path: resolve(arg("--env") ?? "../../.env") });

import { getDb, conversations, cases } from "@dialog/db";
import { eq } from "drizzle-orm";

const HOST = (arg("--host") ?? "https://app-7xil-agents-stg-gzdxeng6cba9byac.uaenorth-01.azurewebsites.net").replace(/\/$/, "");
const TOKEN = arg("--token")!;
if (!TOKEN) throw new Error("--token <the customer's Emirates Post session jwt> is required");

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

async function say(userMessage: string, conversationId?: string, withToken = true): Promise<string | undefined> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentSlug: "nxn-dialog", userMessage, conversationId, locale: "en",
      authenticated: withToken, ...(withToken ? { uaePassToken: TOKEN } : {}),
    }),
  });
  if (!res.ok || !res.body) return undefined;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", cid = conversationId;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try { const ev = JSON.parse(line.slice(5)); if (ev.conversationId) cid = ev.conversationId; } catch { /* not ours */ }
    }
  }
  return cid;
}

async function main() {
  const db = getDb();
  const cid = await say("Hello", undefined, true);
  check("a signed-in conversation is created", Boolean(cid), cid);
  if (!cid) { console.log("\n0 passed, 1 failed"); process.exit(1); }

  const before = await db.query.conversations.findFirst({ where: eq(conversations.id, cid) });
  check("the server records it as authenticated", before?.authenticated === true, before?.authenticated);
  check("...with an identity", Boolean(before?.userRef), before?.userRef);
  // A session token is stored by the UAE PASS callback path; the host-token path
  // re-verifies the bearer each turn instead and stores nothing. Either is a
  // signed-in conversation, so this records what was there rather than demanding
  // it — and the check that matters is that it is GONE afterwards.
  const hadToken = Boolean(before?.sessionToken);
  console.log(`   (a session token was stored beforehand: ${hadToken})`);

  const c1 = await db.query.cases.findFirst({ where: eq(cases.conversationId, cid) });
  const hadEid = Boolean((c1?.state as { data?: Record<string, unknown> } | null)?.data?.__verified_emirates_id);
  console.log(`   (verified Emirates ID on the case beforehand: ${hadEid})`);

  const out = await fetch(`${HOST}/api/embed/signout`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: cid, agentSlug: "nxn-dialog" }),
  });
  check("sign-out is accepted", out.ok, out.status);
  check("...and says so", (await out.json()).authenticated === false);

  const after = await db.query.conversations.findFirst({ where: eq(conversations.id, cid) });
  check("the SERVER is no longer authenticated", after?.authenticated === false, after?.authenticated);
  check("the identity is gone", !after?.userRef, after?.userRef);
  check("the session token is gone", !after?.sessionToken, after?.sessionToken ? "still held" : "");

  const c2 = await db.query.cases.findFirst({ where: eq(cases.conversationId, cid) });
  const stillEid = Boolean((c2?.state as { data?: Record<string, unknown> } | null)?.data?.__verified_emirates_id);
  check("the verified Emirates ID is gone from the case", !stillEid, stillEid);
  if (!hadEid) console.log("   (it was not on the case to begin with — the host-token path keeps it in the turn, not the case)");

  // Signing out twice, and signing out something that is not ours, are both fine.
  check("signing out again is harmless", (await fetch(`${HOST}/api/embed/signout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: cid, agentSlug: "nxn-dialog" }) })).ok);
  const wrong = await fetch(`${HOST}/api/embed/signout`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: "00000000-0000-4000-8000-000000000000", agentSlug: "nxn-dialog" }),
  });
  check("an unknown conversation answers the same way", wrong.ok);
  const bad = await fetch(`${HOST}/api/embed/signout`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: "not-a-uuid", agentSlug: "nxn-dialog" }),
  });
  check("a malformed request is refused", bad.status === 400);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
