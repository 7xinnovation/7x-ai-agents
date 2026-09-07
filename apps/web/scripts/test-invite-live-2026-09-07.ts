/**
 * An invitation, end to end, against the deployed console (2026-09-07).
 *
 * The unit test pins the token; this drives the real thing: an admin invites a
 * viewer scoped to one agent, the invitee sets a password from the link, lands
 * signed in, and sees exactly the one agent they were given.
 *
 * STAGING. It creates a throwaway account and deletes it at the end.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-invite-live-2026-09-07.ts --env <file> --host <url>
 */
import { config } from "dotenv";
import { resolve } from "node:path";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
config({ path: resolve(arg("--env") ?? "../../.env") });

import { getDb, users } from "@dialog/db";
import { eq } from "drizzle-orm";
import { hashInviteToken } from "../lib/users";

const HOST = (arg("--host") ?? "https://app-7xil-agents-stg-gzdxeng6cba9byac.uaenorth-01.azurewebsites.net").replace(/\/$/, "");
const ADMIN = arg("--admin-email") ?? "emre.karayalcin@7x.ae";
const EMAIL = `invite-test+${Date.now()}@7x.ae`;
const PASSWORD = `chosen-${Date.now()}`;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

async function main() {
  const db = getDb();
  // Sign in as an admin the way the console does. The bootstrap password is the
  // one this environment already uses for its owner account.
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) throw new Error("ADMIN_PASSWORD is not set for this environment");
  const login = await fetch(`${HOST}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPass }),
  });
  check("an admin can sign in", login.ok, login.status);
  const adminCookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

  // ── invite ────────────────────────────────────────────────────────────────
  const created = await fetch(`${HOST}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ email: EMAIL, name: "Invite Test", role: "viewer", agentScope: ["nxn-dialog"], invite: true }),
  });
  const body = await created.json().catch(() => ({}));
  check("the invitation is accepted by the API", created.ok, body);
  check("the account exists straight away", Boolean(body.id), body);
  check("...as a viewer", body.role === "viewer", body.role);
  check("the email was sent, or the link handed back", Boolean(body.sent || body.link), body);

  const [row] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  check("it has NO password until the link is used", row?.passwordHash === null, row?.passwordHash);
  check("its scope was set before the invitation went out", JSON.stringify(row?.agentScope) === '["nxn-dialog"]', row?.agentScope);
  check("only the HASH of the token is stored", Boolean(row?.inviteTokenHash) && row!.inviteTokenHash!.length === 64);
  check("it expires", Boolean(row?.inviteExpiresAt));
  check("it records who invited them", Boolean(row?.invitedBy), row?.invitedBy);

  // Nobody can sign in as them yet.
  const early = await fetch(`${HOST}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check("an invited account cannot be signed into yet", early.status === 401, early.status);

  // The token itself never leaves the server when email works, so for the test
  // it is minted the same way the API does and written straight in.
  const token = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`.padEnd(44, "x");
  await db.update(users).set({ inviteTokenHash: hashInviteToken(token) }).where(eq(users.id, row!.id));

  // ── the page the invitee opens ────────────────────────────────────────────
  const page = await fetch(`${HOST}/admin/invite/${token}`, { redirect: "manual" });
  check("the invitation page is served WITHOUT a session", page.status === 200, page.status);
  const html = await page.text();
  check("...and greets them by name", html.includes("Invite Test") || html.includes("Welcome"), html.slice(0, 200));

  const bad = await fetch(`${HOST}/admin/invite/not-a-real-token-at-all-000000`, { redirect: "manual" });
  check("a made-up token gets the expired page, not a form", (await bad.text()).includes("expired"), bad.status);

  // ── accept ────────────────────────────────────────────────────────────────
  const accepted = await fetch(`${HOST}/api/admin/invite`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  check("the password is accepted", accepted.ok, accepted.status);
  const inviteeCookie = (accepted.headers.get("set-cookie") ?? "").split(";")[0]!;
  check("they are signed in by it", inviteeCookie.startsWith("dlg_admin="), inviteeCookie.slice(0, 20));

  const again = await fetch(`${HOST}/api/admin/invite`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "another-password-entirely" }),
  });
  check("the SAME link cannot be used twice", again.status === 400, again.status);

  const [after] = await db.select().from(users).where(eq(users.id, row!.id)).limit(1);
  check("the invitation is spent", after?.inviteTokenHash === null && after?.inviteExpiresAt === null);
  check("the password they chose is theirs", Boolean(after?.passwordHash));

  // ── and the access they were given ────────────────────────────────────────
  const list = await fetch(`${HOST}/api/admin/agents`, { headers: { cookie: inviteeCookie } });
  const slugs: string[] = list.ok ? ((await list.json()).agents ?? []).map((a: { slug: string }) => a.slug) : [];
  check("they see the one agent they were given", JSON.stringify(slugs) === '["nxn-dialog"]', slugs);
  check("...and not another agent's editor", (await fetch(`${HOST}/api/admin/agents/epgl-dialog`, { headers: { cookie: inviteeCookie } })).status === 404);
  check("a viewer cannot write", (await fetch(`${HOST}/api/admin/users`, { method: "PATCH", headers: { "Content-Type": "application/json", cookie: inviteeCookie }, body: JSON.stringify({ id: row!.id, role: "owner" }) })).status === 403);

  // They can now sign in normally with the password they chose.
  const normal = await fetch(`${HOST}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check("they can sign in with it from then on", normal.ok, normal.status);

  await db.delete(users).where(eq(users.id, row!.id));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
