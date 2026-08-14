/**
 * Mint a real Emirates Post session token with a one-time passcode.
 *
 * This exists because the GSB company lookups have never seen a live 200, and the
 * two routes to a token both stalled: the UAE PASS code can only be redeemed by
 * Emirates Post's own client, and no GSB client id/secret ever materialised —
 * which the evidence suggests was never the missing piece, since MOE 401s the way
 * every protected endpoint does when nobody is signed in.
 *
 * The passcode flow needs NO client credentials at all. Both endpoints are open:
 *
 *   POST /services/pobox/api/v1/Account/passwordLessToken          -> sends the code
 *   POST /services/pobox/users/api/v1/Account/verifyPasswordLessToken -> returns the token
 *
 * The send call is undocumented in a way that cost several attempts: the mobile
 * number goes in the BODY as a bare JSON string with content-type
 * application/json-patch+json, and the language goes in the Accept-Language
 * HEADER. Put either in the query string or send an object body and it answers
 * "Language and mobile number are required" without telling you which half it
 * could not find.
 *
 * SENDS A REAL SMS. Use your own number. Nothing here is wired into the agent —
 * it is a way to obtain a token so `verify-gsb-chain.ts --token <token>` can prove
 * the company lookups and the ownership check against live data, rather than us
 * finding out on a customer.
 *
 * Run from apps/web:
 *   npx tsx scripts/mint-ep-session.ts --send 05XXXXXXXX
 *   npx tsx scripts/mint-ep-session.ts --verify 05XXXXXXXX 123456
 *   add --prod to use box.emiratespost.ae instead of box-stg
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv.slice(i + 1, i + 3).filter((x) => !x.startsWith("--")) : undefined;
};

const host = process.argv.includes("--prod")
  ? "https://box.emiratespost.ae/services/pobox"
  : "https://box-stg.emiratespost.ae/services/pobox";

async function send(mobile: string) {
  const res = await fetch(`${host}/api/v1/Account/passwordLessToken`, {
    method: "POST",
    headers: { "content-type": "application/json-patch+json", "Accept-Language": "en" },
    body: JSON.stringify(mobile),
  });
  const body = await res.text();
  console.log(`send OTP to ${mobile} -> HTTP ${res.status}`);
  console.log(body.slice(0, 300) || "(empty body)");
  if (res.ok) {
    console.log(`\nCheck the SMS, then:\n  npx tsx scripts/mint-ep-session.ts --verify ${mobile} <code>${process.argv.includes("--prod") ? " --prod" : ""}`);
  } else {
    console.log("\nNot sent. A 400 with {\"payload\":null} usually means the number is not in the expected format;");
    console.log("try it as it appears on the account (with or without the leading 0).");
    process.exitCode = 1;
  }
}

async function verify(mobile: string, code: string) {
  const res = await fetch(`${host}/users/api/v1/Account/verifyPasswordLessToken`, {
    method: "POST",
    headers: { "content-type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify({ token: code, mobileNumber: mobile }),
  });
  const text = await res.text();
  console.log(`verify -> HTTP ${res.status}`);
  if (!res.ok) {
    console.log(text.slice(0, 300));
    process.exitCode = 1;
    return;
  }
  let token = "";
  try {
    const json = JSON.parse(text) as { payload?: { accessToken?: string } | string };
    token = typeof json.payload === "string" ? json.payload : (json.payload?.accessToken ?? "");
  } catch {
    token = text.trim().replace(/^"|"$/g, "");
  }
  if (!token) {
    console.log("No access token in the response:");
    console.log(text.slice(0, 400));
    process.exitCode = 1;
    return;
  }
  console.log(`\naccess token (${token.length} chars):\n${token}\n`);
  console.log("Now prove the GSB chain end to end:");
  console.log(`  npx tsx scripts/verify-gsb-chain.ts --token ${token} --licence <trade-licence-no>`);
  console.log("\nTreat it as a live credential: it is a signed-in customer's session, it expires,");
  console.log("and it belongs in a shell you control rather than in a commit or a chat message.");
}

async function main() {
  const s = arg("--send");
  const v = arg("--verify");
  if (s?.[0]) return send(s[0]);
  if (v?.[0] && v[1]) return verify(v[0], v[1]);
  console.log("usage:");
  console.log("  --send 05XXXXXXXX            request a passcode (SENDS A REAL SMS)");
  console.log("  --verify 05XXXXXXXX 123456   exchange it for an access token");
  console.log("  --prod                       use box.emiratespost.ae (default is box-stg)");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
