/**
 * The scope, as a scoped account actually experiences it (2026-09-06).
 *
 * The unit test proves the rules; this proves the wiring. It gives the existing
 * staging test viewer a scope of nxn-dialog only, signs in as them over HTTP,
 * and asks for the things they should and should not be able to reach.
 *
 * STAGING ONLY. It resets that one test account's password and scope, and puts
 * the scope back to "all agents" when it is done.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-scope-live-2026-09-06.ts --env <file> --host <url>
 */
import { config } from "dotenv";
import { resolve } from "node:path";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
config({ path: resolve(arg("--env") ?? "../../.env") });

import { getDb, users } from "@dialog/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/users";

const HOST = (arg("--host") ?? "https://app-7xil-agents-stg-gzdxeng6cba9byac.uaenorth-01.azurewebsites.net").replace(/\/$/, "");
const EMAIL = "viewer+e2e@7x.ae";
const PASS = `scope-${Date.now()}`;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

async function main() {
  const db = getDb();
  await db.update(users).set({ passwordHash: hashPassword(PASS), role: "viewer", active: true, agentScope: ["nxn-dialog"] }).where(eq(users.email, EMAIL));

  const login = await fetch(`${HOST}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  check("the scoped viewer can sign in", login.ok, login.status);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  const as = (p: string) => fetch(`${HOST}${p}`, { headers: { cookie } });

  const list = await as("/api/admin/agents");
  const slugs: string[] = list.ok ? ((await list.json()).agents ?? []).map((a: any) => a.slug) : [];
  check("the agent list holds only their agent", JSON.stringify(slugs) === '["nxn-dialog"]', slugs);

  check("their own agent opens", (await as("/api/admin/agents/nxn-dialog")).status === 200);
  const other = await as("/api/admin/agents/epgl-dialog");
  check("the other agent is 404, not 403 — it should not be confirmed to exist", other.status === 404, other.status);
  check("...and its knowledge base too", (await as("/api/admin/agents/epgl-dialog/kb")).status === 404);
  check("...and its integrations", (await as("/api/admin/agents/epgl-dialog/integrations")).status === 404);

  const convs = await as("/api/admin/conversations");
  const other_ = convs.ok ? ((await convs.json()).items ?? []).filter((c: any) => c.agentSlug && c.agentSlug !== "nxn-dialog") : [];
  check("the inbox holds no other agent's conversations", other_.length === 0, other_.slice(0, 3));

  // Not a redirect to the login screen: they ARE signed in, the agent is simply
  // not theirs. Next serves the page's own not-found.
  const page = await fetch(`${HOST}/admin/epgl-dialog`, { headers: { cookie }, redirect: "manual" });
  check("the editor page for the other agent is not served", page.status === 404, page.status);
  check("their own editor page IS served", (await fetch(`${HOST}/admin/nxn-dialog`, { headers: { cookie }, redirect: "manual" })).status === 200);

  // Put it back: an unscoped test account is what every other script expects.
  await db.update(users).set({ agentScope: [] }).where(eq(users.email, EMAIL));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
