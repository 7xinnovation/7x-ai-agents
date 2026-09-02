/**
 * The callback, as Emirates Post's own contact form raises it (2026-09-02).
 *
 * Their form posts to /nextApi/case with a flat body and the mobile as "00" plus
 * digits. The endpoint is CAPTCHA-gated -- every request without a valid
 * x-turnstile-token answers 403 "Invalid CAPTCHA token", tested against staging
 * with the token in five body fields and three header names -- so the phone
 * normalisation is the part that can be checked here, and the live call is
 * exercised only when a token is configured.
 *
 * Run from apps/web:  npx tsx scripts/test-ep-case-2026-09-02.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { epMobile, raiseEpCase } from "@/lib/epCase";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

// The shapes a UAE mobile arrives in, against the rule their form applies.
check("a local 05 number", epMobile("0553708434") === "00971553708434");
check("spaces and punctuation", epMobile("+971 55 370-8434") === "00971553708434");
check("already international", epMobile("971553708434") === "00971553708434");
check("00-prefixed", epMobile("00971553708434") === "00971553708434");
check("a landline is not a mobile shape they take", epMobile("042951111") === "");
check("nonsense is dropped", epMobile("call me") === "");
check("empty is empty", epMobile(undefined) === "");

// Without a token there is nothing to send, and the caller must be told which
// kind of failure it was so the callback can fall back rather than vanish.
{
  const saved = process.env.NXN_CASE_TURNSTILE_TOKEN;
  delete process.env.NXN_CASE_TURNSTILE_TOKEN;
  process.env.NXN_CASE_API_BASE_URL = process.env.NXN_CASE_API_BASE_URL || "https://www-stg.emiratespost.ae";
  const r = await raiseEpCase({ firstName: "Test", lastName: "User", mobile: "0553708434", message: "probe" });
  check("no token means not_configured, not a silent failure", !r.ok && r.reason === "not_configured", r);
  if (saved) process.env.NXN_CASE_TURNSTILE_TOKEN = saved;
}

// With a token configured, the live call is exercised for real.
if (process.env.NXN_CASE_TURNSTILE_TOKEN) {
  const r = await raiseEpCase({
    firstName: "Test", lastName: "User", mobile: "0553708434",
    email: "test@example.com", message: "Automated check — please ignore.",
  });
  check(`the live call is accepted (${r.ok ? r.caseNumber : `${r.reason}: ${r.detail}`})`, r.ok, r);
} else {
  console.log("SKIP live call — NXN_CASE_TURNSTILE_TOKEN is not set (their endpoint requires it)");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
