/**
 * Native handoff codes (2026-09-03).
 *
 * The mobile developer objected to the widget being handed the customer's real
 * Emirates Post token, and was right: anything that can read the WebView's JS
 * context could replay it against Emirates Post for as long as it stayed valid.
 * The app now exchanges it from native code and only a code reaches the WebView.
 *
 * What has to hold for that to be worth anything: the code carries no
 * credential, expires quickly, and is refused for a different agent.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-handoff-2026-09-03.ts
 */
process.env.SECRETS_KEY ||= "0".repeat(64);
import { mintHandoff, readHandoff, HANDOFF_TTL_MS } from "@/lib/handoff";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const CID = "11111111-1111-1111-1111-111111111111";
const NOW = 1_757_000_000_000;
const TOKEN = "ep-session-token-that-must-never-appear";

// 1. Round trip.
{
  const code = mintHandoff(CID, "nxn-dialog", NOW)!;
  const r = readHandoff(code, "nxn-dialog", NOW + 1_000);
  check("a fresh code reads back", r.ok === true, r);
  check("...to the right conversation", r.ok && r.claims.cid === CID, r);
}

// 2. It carries NO credential. This is the entire point: mintHandoff is not even
//    given the token, so there is nothing in the code to steal.
{
  const code = mintHandoff(CID, "nxn-dialog", NOW)!;
  check("the token is nowhere in the code", !code.includes(TOKEN), code.slice(0, 40));
  check("the code is opaque, not readable JSON", !/\{|cid/.test(code), code.slice(0, 40));
  // (cid, agent) -- `now` has a default, so it is not counted. No token parameter
  // exists to pass one to, which is the guarantee rather than a convention.
  check("mintHandoff has no token parameter", mintHandoff.length === 2, mintHandoff.length);
}

// 3. Two minutes is a page load, not a session.
{
  const code = mintHandoff(CID, "nxn-dialog", NOW)!;
  check("valid just before expiry", readHandoff(code, "nxn-dialog", NOW + HANDOFF_TTL_MS - 1).ok === true);
  check("refused at expiry", readHandoff(code, "nxn-dialog", NOW + HANDOFF_TTL_MS).ok === false);
  const late = readHandoff(code, "nxn-dialog", NOW + HANDOFF_TTL_MS + 60_000);
  check("...and reported as expired, not malformed", !late.ok && late.reason === "expired", late);
  check("the window really is 2 minutes", HANDOFF_TTL_MS === 120_000, HANDOFF_TTL_MS);
}

// 4. Scoped to one agent: a code minted for the PO Box assistant is not a way
//    into the licensing one.
{
  const code = mintHandoff(CID, "nxn-dialog", NOW)!;
  const other = readHandoff(code, "epgl-dialog", NOW + 1_000);
  check("refused for a different agent", !other.ok && other.reason === "wrong_agent", other);
}

// 5. Garbage is refused rather than trusted.
{
  for (const [label, value] of [
    ["empty", ""],
    ["plain text", "not-a-code"],
    ["a bare conversation id", CID],
    // The one that mattered: decryptSecret returns unprefixed input unchanged
    // (legacy plaintext rows), so without an explicit isEncrypted check this
    // forged payload was ACCEPTED as a valid code.
    ["forged plaintext JSON", JSON.stringify({ cid: CID, agent: "nxn-dialog", exp: NOW + 99_999 })],
    ["forged JSON wearing the prefix", `enc:v1:${JSON.stringify({ cid: CID, agent: "nxn-dialog", exp: NOW + 99_999 })}`],
  ] as const) {
    check(`refused: ${label}`, readHandoff(value, "nxn-dialog", NOW).ok === false, value.slice(0, 30));
  }
}

// 6. A tampered code does not decrypt to something usable -- swapping the
//    conversation id must not be a matter of editing the string.
{
  const code = mintHandoff(CID, "nxn-dialog", NOW)!;
  const flipped = code.slice(0, -4) + (code.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  check("a tampered code is refused", readHandoff(flipped, "nxn-dialog", NOW + 1_000).ok === false);
}

// 7. Two codes for the same conversation differ -- an IV that repeats would let
//    two captures be compared.
{
  const a = mintHandoff(CID, "nxn-dialog", NOW)!;
  const b = mintHandoff(CID, "nxn-dialog", NOW)!;
  check("identical inputs still produce different codes", a !== b, { a: a.slice(0, 24), b: b.slice(0, 24) });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
