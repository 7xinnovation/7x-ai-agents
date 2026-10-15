/**
 * The portal's super admin, checked against a running deployment.
 *
 * Signs in by one-time code (the code is read from the dev server log, so
 * this runs locally), then: a developer is refused the admin API; the admin
 * reads every endpoint; creates and edits an account; cannot lock itself out;
 * the settings take effect (doorway paused answers 503/-32013, rate limit
 * answers 429/-32012, banner text appears); and every change is in the log.
 *
 * From apps/web, with the dev server on :3000 writing to <log>:
 *   npx tsx scripts/test-portal-admin-2026-10-15.ts --log <dev server log> --admin <admin email> --app-key <an API key>
 */
import fs from "node:fs";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (arg("--base") ?? "http://localhost:3000").replace(/\/$/, "");
const LOG = arg("--log")!;
const ADMIN = arg("--admin")!;
const APP_KEY = arg("--app-key");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : " - got: " + JSON.stringify(got)?.slice(0, 300)}`);
  ok ? pass++ : fail++;
};

const json = { "content-type": "application/json", origin: BASE };

async function signIn(email: string): Promise<string> {
  const before = fs.readFileSync(LOG, "utf8").length;
  const r = await fetch(`${BASE}/api/developers/otp/request`, { method: "POST", headers: json, body: JSON.stringify({ email }) });
  if (r.status !== 200) throw new Error(`otp request ${r.status}`);
  let code: string | undefined;
  for (let i = 0; i < 20 && !code; i++) {
    await new Promise((res) => setTimeout(res, 300));
    const tail = fs.readFileSync(LOG, "utf8").slice(before);
    const line = tail.split("\n").filter((l) => l.includes("developer_otp_not_sent_dev_code") && l.includes(email)).at(-1);
    code = line ? /"code":"(\d{6})"/.exec(line)?.[1] : undefined;
  }
  if (!code) throw new Error(`no code for ${email} in the log (a code is sent at most once a minute)`);
  const v = await fetch(`${BASE}/api/developers/otp/verify`, { method: "POST", headers: json, body: JSON.stringify({ email, code }) });
  const cookie = v.headers.get("set-cookie")?.split(";")[0];
  if (v.status !== 200 || !cookie) throw new Error(`verify ${v.status}`);
  return cookie;
}

async function main() {
  const admin = await signIn(ADMIN);
  const A = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}/api/developers/admin${path}`, { ...init, headers: { ...json, cookie: admin, ...(init.headers ?? {}) } });

  console.log("\nAccess");
  check("no session → 401", (await fetch(`${BASE}/api/developers/admin/overview`)).status === 401);
  check("admin → overview 200", (await A("/overview")).status === 200);

  // A throwaway developer, created by the admin, to prove a developer is refused.
  const email = `dev-${Date.now().toString(36)}@example.test`;
  const created = await A("/accounts", { method: "POST", body: JSON.stringify({ organization: "Test Org", name: "Test Dev", email, role: "developer", notify: false }) });
  const cj = (await created.json()) as { account?: { id: string }; signInUrl?: string };
  check("create account → 201 with a sign-in URL", created.status === 201 && Boolean(cj.signInUrl?.includes("/developers/login?email=")), cj);
  const dup = await A("/accounts", { method: "POST", body: JSON.stringify({ organization: "x", name: "x", email, role: "developer" }) });
  check("same email again → 409", dup.status === 409);
  const devCookie = await signIn(email);
  const asDev = await fetch(`${BASE}/api/developers/admin/overview`, { headers: { cookie: devCookie } });
  check("a developer → 403 on the admin API", asDev.status === 403);
  const devPage = await fetch(`${BASE}/developers/admin`, { headers: { cookie: devCookie }, redirect: "manual" });
  check("a developer → the admin page is not found", devPage.status === 404, devPage.status);

  console.log("\nAccounts");
  const list = (await (await A("/accounts")).json()) as { accounts: { id: string; email: string; role: string; active: boolean }[] };
  const me = list.accounts.find((a) => a.email === ADMIN)!;
  check("the list has the admin and the new developer", Boolean(me) && me.role === "admin" && list.accounts.some((a) => a.email === email));
  const self = await A(`/accounts/${me.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  check("deactivating yourself → 409 self_lockout", self.status === 409 && ((await self.json()) as { error: string }).error === "self_lockout");
  const rename = await A(`/accounts/${cj.account!.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed Dev" }) });
  check("rename → 200", rename.status === 200);
  const off = await A(`/accounts/${cj.account!.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  check("deactivate the developer → 200", off.status === 200);
  const after = await fetch(`${BASE}/api/developers/me`, { headers: { cookie: devCookie } });
  check("...and their session stops working at once", after.status === 401, after.status);
  const otp = await fetch(`${BASE}/api/developers/otp/request`, { method: "POST", headers: json, body: JSON.stringify({ email }) });
  check("...a deactivated address still gets the same neutral answer", otp.status === 200);

  console.log("\nApplications and logs");
  const apps = (await (await A("/apps")).json()) as { apps: unknown[]; agents: unknown[] };
  check("every application listed, with the agent catalogue", Array.isArray(apps.apps) && apps.agents.length >= 1);
  const reqs = (await (await A("/requests?limit=5")).json()) as { requests: unknown[]; nextCursor: string | null };
  check("requests: a page and a cursor field", Array.isArray(reqs.requests) && "nextCursor" in reqs);
  if (reqs.nextCursor) {
    const next = (await (await A(`/requests?limit=5&cursor=${reqs.nextCursor}`)).json()) as { requests: { id: string }[] };
    check("requests: the next page is different", next.requests[0]?.id !== (reqs.requests[0] as { id: string })?.id);
  }
  const tasks = (await (await A("/tasks?limit=5")).json()) as { tasks: { id: string }[] };
  check("tasks: a page", Array.isArray(tasks.tasks));
  if (tasks.tasks[0]) {
    const t = (await (await A(`/tasks/${tasks.tasks[0].id}`)).json()) as { task?: { history: unknown[] } };
    check("one task in full, with its history", Array.isArray(t.task?.history));
  }
  for (const scope of ["portal", "sandbox", "all"]) {
    const ev = (await (await A(`/events?scope=${scope}&limit=5`)).json()) as { events: unknown[] };
    check(`events, scope ${scope}`, Array.isArray(ev.events));
  }
  const mine = (await (await A(`/events?scope=portal&q=${encodeURIComponent(email)}&limit=20`)).json()) as { events: { action: string }[] };
  const actions = mine.events.map((e) => e.action);
  check("the admin's changes are in the log: created, updated", actions.includes("developer_admin_account_created") && actions.includes("developer_admin_account_updated"), actions);

  console.log("\nSettings take effect");
  const s0 = (await (await A("/settings")).json()) as { settings: Record<string, unknown> };
  check("settings read with defaults", s0.settings.doorwayEnabled === true && typeof s0.settings.rateLimitPerMinute === "number");
  const bad = await A("/settings", { method: "PATCH", body: JSON.stringify({ codeTtlMinutes: 0 }) });
  check("an invalid value → 400 invalid_value", bad.status === 400);
  const unknown = await A("/settings", { method: "PATCH", body: JSON.stringify({ nonsense: 1 }) });
  check("an unknown setting → 400", unknown.status === 400);

  const banner = `Banner check ${Date.now().toString(36)}`;
  await A("/settings", { method: "PATCH", body: JSON.stringify({ bannerText: banner }) });
  const page = await (await fetch(`${BASE}/developers`)).text();
  check("the banner text appears in the portal", page.includes(banner));

  if (APP_KEY) {
    const call = () =>
      fetch(`${BASE}/a2a/po-box-sandbox`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": APP_KEY },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetTask", params: { id: "00000000-0000-4000-8000-000000000000" } }),
      });
    await A("/settings", { method: "PATCH", body: JSON.stringify({ doorwayEnabled: false }) });
    const paused = await call();
    const pj = (await paused.json()) as { error?: { code: number } };
    check("doorway paused → 503 and -32013", paused.status === 503 && pj.error?.code === -32013, { status: paused.status, pj });
    await A("/settings", { method: "PATCH", body: JSON.stringify({ doorwayEnabled: true, rateLimitPerMinute: 2 }) });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await call()).status);
    check("rate limit 2/min → the third call is 429", codes.includes(429), codes);
    await A("/settings", { method: "PATCH", body: JSON.stringify({ rateLimitPerMinute: 120 }) });
    check("doorway back on", (await call()).status !== 503);
  }
  await A("/settings", { method: "PATCH", body: JSON.stringify({ bannerText: s0.settings.bannerText }) });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
