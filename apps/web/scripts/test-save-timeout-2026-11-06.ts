/**
 * A timed-out Rental/Save must not be called "not charged" (6 November 2026,
 * box 453345, hold 260613037).
 *
 * The first save got 157 ERROR_GETTING_HOLD_DETAILS; the retry ran 60 s and
 * timed out. Both the "outcome unknown" note and the "no money has moved" note
 * were put on the timeout, and the customer read "nothing has been charged to
 * your Visa ending 1111" — on a saved-card save whose outcome nobody knew.
 *
 * Run from apps/web:  npx tsx scripts/test-save-timeout-2026-11-06.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${n}`); };
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");

const timeoutText = /`\$\{TIMED_OUT_UNKNOWN\}([^`]+)`/.exec(src)?.[1] ?? "";
check("the timeout note starts with the shared marker", /const TIMED_OUT_UNKNOWN = "TIMED OUT WITH THE OUTCOME UNKNOWN\."/.test(src) && timeoutText.length > 0);
check("...forbids saying they have or have not been charged", /do NOT say they have or have not been charged/.test(timeoutText));
check("...no longer promises 'their payment is safe'", !/payment is safe/.test(timeoutText));
check("...and forbids a retry, which could charge twice", /do NOT send it again/.test(timeoutText) && /charge them twice/.test(timeoutText));
check("the 'no money has moved' note skips a timed-out save",
  /rental_save\|guest_renewal_save\)\$\/i\.test\(toolName\) && !res\.result\.startsWith\(TIMED_OUT_UNKNOWN\)/.test(src));
check("...and still applies to a save that was answered with an error", /NO ORDER WAS CREATED AND NO MONEY HAS MOVED/.test(src));

// The exact composition from 6 November, through the same two conditions.
const appended = (result: string, tool: string) =>
  /(rental_save|guest_renewal_save)$/i.test(tool) && !result.startsWith("TIMED OUT WITH THE OUTCOME UNKNOWN.");
check("a 157 still gets the note", appended("SYSTEM DETAIL — …\nHTTP 400 Bad Request\n{\"ERROR_CODE\":\"157\"}", "nxnstaging__post_api_Rental_Save"));
check("the timeout does not", !appended("TIMED OUT WITH THE OUTCOME UNKNOWN. The request was sent…", "nxnstaging__post_api_Rental_Save"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
