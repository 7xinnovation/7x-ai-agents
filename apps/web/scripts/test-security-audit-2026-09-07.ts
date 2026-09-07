/**
 * The audit's findings, as checks (2026-09-07).
 *
 * Each of these is a rule that was not being enforced anywhere. A rule with no
 * test is a rule until someone edits the line.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-security-audit-2026-09-07.ts
 */
import { safeReturnTo, requestOrigin } from "@/lib/uaepass";
import { sameSitePath } from "@/app/admin/login/LoginClient";
import { isPaymentUrl } from "@/app/embed/[agent]/Markdown";
import { isPrivateAddress, checkOutboundUrl } from "@/lib/outboundUrl";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const US = "https://agent.7x.ae";
const THEIRS = ["https://box.emiratespost.ae"];

// ── CWE-601: where UAE PASS may send someone afterwards ─────────────────────
check("our own embed is fine", safeReturnTo(`${US}/embed/nxn-dialog`, US, THEIRS) === `${US}/embed/nxn-dialog`);
check("a site the agent is embedded on is fine", Boolean(safeReturnTo("https://box.emiratespost.ae/pobox", US, THEIRS)));
check("a relative path is ours", safeReturnTo("/embed/nxn-dialog", US, THEIRS) === `${US}/embed/nxn-dialog`);
check("somewhere else is REFUSED", safeReturnTo("https://evil.example/steal", US, THEIRS) === null);
check("...including a lookalike subdomain", safeReturnTo("https://agent.7x.ae.evil.example", US, THEIRS) === null);
check("...and a lookalike prefix", safeReturnTo("https://notagent.7x.ae", US, THEIRS) === null);
check("protocol-relative is not a path", safeReturnTo("//evil.example", US, THEIRS) === null);
check("javascript: is refused", safeReturnTo("javascript:alert(1)", US, THEIRS) === null);
check("data: is refused", safeReturnTo("data:text/html,<script>1</script>", US, THEIRS) === null);
check("nothing given means nothing honoured", safeReturnTo(null, US, THEIRS) === null);
check("an agent with no configured origins still gets ours", Boolean(safeReturnTo(`${US}/x`, US, [])));

// ── CWE-601: where the admin login lands ────────────────────────────────────
check("a console path is kept", sameSitePath("/admin/inbox") === "/admin/inbox");
check("an absolute URL is dropped", sameSitePath("https://evil.example") === "/admin");
check("protocol-relative is dropped", sameSitePath("//evil.example") === "/admin");
check("a backslash trick is dropped", sameSitePath("/\\evil.example") === "/admin");
check("nothing means the front page", sameSitePath(null) === "/admin");

// ── the pay button only opens a payment page ────────────────────────────────
check("the live gateway", isPaymentUrl("https://paypage.ngenius-payments.com/v2?code=abc"));
check("the sandbox gateway", isPaymentUrl("https://paypage.sandbox.ngenius-payments.com/v2?code=abc"));
check("anywhere else is not a payment page", !isPaymentUrl("https://evil.example/pay"));
check("a lookalike domain is not either", !isPaymentUrl("https://ngenius-payments.com.evil.example/pay"));
check("http is not good enough for a payment", !isPaymentUrl("http://paypage.ngenius-payments.com/v2"));
check("nor is javascript:", !isPaymentUrl("javascript:alert(1)"));

// ── CWE-918: what the server may be told to fetch ───────────────────────────
check("loopback is private", isPrivateAddress("127.0.0.1"));
check("the cloud metadata address is private", isPrivateAddress("169.254.169.254"));
check("10/8 is private", isPrivateAddress("10.0.0.5"));
check("172.16/12 is private", isPrivateAddress("172.20.1.1"));
check("...but 172.32 is not", !isPrivateAddress("172.32.1.1"));
check("192.168/16 is private", isPrivateAddress("192.168.1.1"));
check("IPv6 loopback is private", isPrivateAddress("::1"));
check("IPv4-mapped loopback is private", isPrivateAddress("::ffff:127.0.0.1"));
check("unique-local v6 is private", isPrivateAddress("fd00::1"));
check("a public address is not", !isPrivateAddress("8.8.8.8"));

const verdicts = await Promise.all(
  [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:5432/",
    "https://localhost/openapi.json",
    "file:///etc/passwd",
    "https://user:pass@example.com/spec.json",
    "not a url at all",
  ].map((u) => checkOutboundUrl(u))
);
check("the metadata endpoint is refused", !verdicts[0]!.ok, verdicts[0]);
check("loopback is refused", !verdicts[1]!.ok);
check("localhost by name is refused", !verdicts[2]!.ok);
check("file:// is refused", !verdicts[3]!.ok);
check("credentials in the URL are refused", !verdicts[4]!.ok);
check("nonsense is refused", !verdicts[5]!.ok);

// ── the origin the sign-in round trip is built on ───────────────────────────
// It becomes the redirect target and the UAE PASS redirect_uri, so a header
// anyone can set must not be able to choose it. The second scan still flagged
// the login route for this after the returnTo fix.
const req = (headers: Record<string, string>, origin = "https://internal.local") => ({
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  nextUrl: { origin, protocol: "https:" },
});
const noPin = { ...process.env };
delete process.env.PUBLIC_APP_URL;
delete process.env.NEXT_PUBLIC_DIALOG_HOST;
check(
  "a forwarded host that matches the arriving host is honoured",
  requestOrigin(req({ host: "agent.7x.ae", "x-forwarded-host": "agent.7x.ae", "x-forwarded-proto": "https" })) === "https://agent.7x.ae"
);
check(
  "a SPOOFED forwarded host is not",
  requestOrigin(req({ host: "agent.7x.ae", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })) === "https://agent.7x.ae"
);
check(
  "with no forwarded header the arriving host stands",
  requestOrigin(req({ host: "agent.7x.ae", "x-forwarded-proto": "https" })) === "https://agent.7x.ae"
);
process.env.PUBLIC_APP_URL = "https://agent.7x.ae";
check(
  "a configured public origin beats any header",
  requestOrigin(req({ host: "evil.example", "x-forwarded-host": "evil.example" })) === "https://agent.7x.ae"
);
Object.assign(process.env, noPin);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
