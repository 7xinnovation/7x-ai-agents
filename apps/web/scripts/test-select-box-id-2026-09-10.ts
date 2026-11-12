/**
 * A reservation identifies the box by uniqueBoxID, whatever key it arrived under.
 *
 * Production, 10 September. MyHome Instant, Sharjah: FreeBoxes listed box 970081
 * as free at 10:10:47, the customer picked it, and Rental/Select went out at
 * 10:13:13 as `{"boxNumber": 970081, "locationId": "SHJ", …}` with no
 * uniqueBoxID at all. Emirates Post answered 108 BOX_NOT_FREE. The assistant
 * moved to Dubai and did the same thing with 910500.
 *
 * The correction existed and had a hole in exactly the shape of this bundle. It
 * ran only when the id did NOT match one we had offered — which on MyBox is
 * always, because their uniqueBoxId carries a prefix the printed number does not
 * (2098 is offered as 22098). On MyHome and MyHome Instant the two are the SAME
 * number, so the id matched, the correction took its early exit, and the key was
 * never fixed. MyBox worked; the delivered bundles could not reserve at all.
 *
 * A reservation that succeeds looks like this, and nothing else identifies the
 * box in it:
 *
 *   {"bundleId":"MYHOMEF","uniqueBoxID":"916666","physicalBoxRequired":false,…}
 *
 * Run from apps/web:  npx tsx scripts/test-select-box-id-2026-09-10.ts
 */
export {};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const block = src.slice(
  src.indexOf("// Reserve the box the customer actually chose"),
  src.indexOf("// A BOX WE ALREADY HOLD IS NOT A BOX SOMEONE ELSE TOOK.")
);

console.log("\nThe id lands on uniqueBoxID");
check("the rewrite is outside the no-match branch", /if \(chosen\) \{/.test(block));
check("uniqueBoxID is always set from the chosen id", /body\.uniqueBoxID = chosen;/.test(block));
check("the lower-case spelling is removed", /delete body\.uniqueBoxId;/.test(block));
check("...and so is boxNumber, which is what went out on 10 September", /delete body\.boxNumber;/.test(block));
check("a correction is audited rather than silent", /field: "uniqueBoxID"/.test(block));

console.log("\nBoth ways a box can be named still resolve");
// MyBox: printed 2098, offered as 22098 — the digits have to be matched.
check("a prefixed id is still matched on its digits", /id\.endsWith\(sent\) \|\| sent\.endsWith\(id\)/.test(block));
check("...and the number the customer was shown is looked up too", /uniqueByNumber\[sent\]/.test(block));
// MyHome: printed and unique are the same number, which is the case that broke.
check("an exact match is still a match", /offeredBoxIds\.includes\(sent\) \? sent : null/.test(block));
check("every spelling the model uses is read", /body\.uniqueBoxID \?\? body\.uniqueBoxId \?\? body\.boxNumber/.test(block));

console.log("\nphysicalBoxRequired comes from the bundle");
check("it is set when the model left it out", /body\.physicalBoxRequired === undefined && bundleForBox/.test(block));
check("MyHome and MyHome Instant are delivered, so false", /const delivered = \/\^MYHOME\/\.test\(bundleForBox\)/.test(block));
check("...and everything else is collected, so true", /body\.physicalBoxRequired = !delivered/.test(block));
check("a value the model DID send is left alone", /=== undefined/.test(block));

console.log("\nThe behaviour, on the two id shapes Emirates Post actually use");
const resolve = (offered: string[], byNumber: Record<string, string>, body: Record<string, unknown>, caseBox = "") => {
  const sent = String(body.uniqueBoxID ?? body.uniqueBoxId ?? body.boxNumber ?? "");
  let chosen: string | null = offered.includes(sent) ? sent : null;
  if (sent && !chosen) chosen = byNumber[sent] ?? offered.find((id) => id.endsWith(sent) || sent.endsWith(id)) ?? null;
  if (sent && !chosen) {
    const nums = Object.keys(byNumber).filter((n) => n.length >= 3 && sent.endsWith(n) && offered.includes(byNumber[n]!)).sort((a, b) => b.length - a.length);
    chosen = (nums[0] ? byNumber[nums[0]] : undefined) ?? (caseBox && offered.includes(byNumber[caseBox] ?? "") ? byNumber[caseBox] : undefined) ?? null;
  }
  const out = { ...body };
  if (chosen) { out.uniqueBoxID = chosen; delete out.uniqueBoxId; delete out.boxNumber; }
  return out;
};
{
  // MyHome Instant, Sharjah — the exact payload that failed.
  const out = resolve(["970054", "970058", "970081"], {}, { bundleId: "MYHOMEF", boxNumber: 970081, locationId: "SHJ" });
  check("970081 reserves as uniqueBoxID", out.uniqueBoxID === "970081", out);
  check("...and boxNumber is gone", out.boxNumber === undefined, out);
}
{
  // MyBox, Dubai — printed 2098, offered as 22098. This path always worked.
  const out = resolve(["22098", "22145"], { "2098": "22098" }, { bundleId: "IN", boxNumber: "2098" });
  check("a prefixed MyBox id still resolves", out.uniqueBoxID === "22098", out);
  check("...and boxNumber is gone there too", out.boxNumber === undefined, out);
}
{
  const out = resolve(["916666"], {}, { bundleId: "MYHOMEF", uniqueBoxID: "916666" });
  check("a payload that was already right is unchanged", out.uniqueBoxID === "916666" && out.boxNumber === undefined, out);
}
{
  const out = resolve(["970054"], {}, { bundleId: "MYHOMEF", boxNumber: "999999" });
  check("a box we never offered is not invented into uniqueBoxID", out.uniqueBoxID === undefined, out);
  check("...and is left for Emirates Post to refuse", out.boxNumber === "999999", out);
}

{
  // MyBox, Abu Dhabi, staging 12 November — the exact payload that failed.
  const offered = ["172423", "172432", "172447", "172449", "172472"];
  const byNum = { "72423": "172423", "72432": "172432", "72447": "172447", "72449": "172449", "72472": "172472" };
  const out = resolve(offered, byNum, { bundleId: "IN", uniqueBoxID: "2072423" });
  check("a wrong prefix (2072423 for 172423) resolves by the printed number", out.uniqueBoxID === "172423", out);
  const out2 = resolve(offered, byNum, { bundleId: "IN", uniqueBoxID: "9999999" }, "72432");
  check("an id matching nothing falls back to the box chosen on the case", out2.uniqueBoxID === "172432", out2);
  const out3 = resolve(offered, byNum, { bundleId: "IN", uniqueBoxID: "9999999" });
  check("...and with no case box, nothing is invented", out3.uniqueBoxID === "9999999", out3);
}
check("the source carries the wrong-prefix fallback", /sent\.endsWith\(n\) && offeredBoxIds\.includes\(uniqueByNumber\[n\]!\)/.test(block));
check("...and the case-box fallback", /opts\.caseBoxNumber\?\.\(\)/.test(block));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
