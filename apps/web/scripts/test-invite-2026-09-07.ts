/**
 * Invitations (2026-09-07).
 *
 * An admin adds an email and a name; the person themselves chooses the
 * password, from a link that works once. Nobody types a password on someone
 * else's behalf, and no password is passed between two people.
 *
 * The parts worth pinning are the token's: it is stored as a hash, it expires,
 * and it is spent on use.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-invite-2026-09-07.ts
 */
import { newInviteToken, hashInviteToken, INVITE_TTL_MS } from "@/lib/users";
import { inviteEmailBody } from "@/lib/inviteEmail";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// ── the token ───────────────────────────────────────────────────────────────
const a = newInviteToken();
const b = newInviteToken();
check("the token is long enough to be unguessable", a.token.length >= 40, a.token.length);
check("it is URL-safe, so the link survives being pasted", /^[A-Za-z0-9_-]+$/.test(a.token));
check("two invitations are never the same token", a.token !== b.token);
check("what is STORED is the hash, not the token", a.hash !== a.token && /^[0-9a-f]{64}$/.test(a.hash));
check("the hash is reproducible from the token", hashInviteToken(a.token) === a.hash);
check("a different token hashes differently", hashInviteToken(b.token) !== a.hash);
check("it expires in seven days", Math.round((a.expiresAt.getTime() - Date.now()) / 86_400_000) === 7);
check("...which is what the constant says", INVITE_TTL_MS === 7 * 24 * 60 * 60 * 1000);

// ── the email ───────────────────────────────────────────────────────────────
const LINK = "https://agent.7x.ae/admin/invite/abc123";
const mail = inviteEmailBody({
  to: "someone@7x.ae",
  name: "Farah Nasser",
  link: LINK,
  role: "viewer (read-only)",
  agents: ["Emirates Post"],
  invitedBy: "emre.karayalcin@7x.ae",
  expiresAt: new Date("2026-09-14T00:00:00Z"),
});
check("the link is in the text part", mail.text.includes(LINK));
check("...and in the button", mail.html.includes(`href="${LINK}"`));
check("...and written out, for a client that strips the button", mail.html.split(LINK).length - 1 >= 2);
check("it names who invited them", mail.text.includes("emre.karayalcin@7x.ae"));
check("it says what they will be able to see", mail.text.includes("Emirates Post"));
check("it says when the link stops working", /14 September 2026/.test(mail.text), mail.text);
check("it says an unexpected invitation can be ignored", /ignore/i.test(mail.text));
check("it greets them by name", mail.text.startsWith("Hello Farah Nasser,"));

const everything = inviteEmailBody({ ...{ to: "a@b.co", name: "Sam", link: LINK, role: "admin", expiresAt: new Date() } });
check("with no scope it says every agent", /every agent/i.test(everything.text), everything.text);

// A name is data from a form; it must not become markup.
const nasty = inviteEmailBody({
  to: "a@b.co",
  name: '<img src=x onerror="alert(1)">',
  link: LINK,
  role: "viewer",
  expiresAt: new Date(),
});
check("a name is escaped in the html", !/<img/i.test(nasty.html), nasty.html.slice(0, 200));
check("...and the escaped form is there instead", nasty.html.includes("&lt;img"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
