/**
 * The spreadsheet reader, against real files rather than fixtures.
 *
 * Run from apps/web:  npx tsx scripts/test-sheet-2026-09-15.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { readSheet, parseCsv } from "../lib/sheet";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got).slice(0, 300)}`}`); }
};

console.log("\nCSV");
{
  const s = readSheet("list.csv", Buffer.from("Trade License,Company Name\n697670,YI FANG TAIWAN FRUIT TEA L.L.C\n233051,ARAMEX\n"));
  check("headers", JSON.stringify(s.headers) === '["Trade License","Company Name"]', s.headers);
  check("rows", s.rows.length === 2, s.rows);
  check("values", s.rows[1]![0] === "233051", s.rows[1]);
}
{
  const s = readSheet("list.csv", Buffer.from('﻿a;b\n"x;y";"he said ""no"""\n'));
  check("a BOM is stripped", s.headers[0] === "a", s.headers);
  check("semicolons are a delimiter when they dominate", s.headers.length === 2, s.headers);
  check("quoted delimiters survive", s.rows[0]![0] === "x;y", s.rows[0]);
  check("doubled quotes unescape", s.rows[0]![1] === 'he said "no"', s.rows[0]);
}
{
  const r = parseCsv("a,b\n\n\nc,d\n");
  check("blank lines are not data", readSheet("x.csv", Buffer.from("a,b\n\n\nc,d\n")).rows.length === 1, r);
}

console.log("\nXLSX — read from a file the team actually sent");
{
  const real = "/Users/emrekarayalcin/Documents/7x-proj-tech/agents/feedback export unresolved 2026-09-14.xlsx";
  if (!existsSync(real)) {
    console.log("  --   skipped: no sample workbook on this machine");
  } else {
    const s = readSheet("feedback.xlsx", readFileSync(real));
    check("it has headers", s.headers.length > 1, s.headers);
    check("it has rows", s.rows.length > 1, s.rows.length);
    check("cells are strings, not XML", !s.headers.some((h) => /[<>]/.test(h)), s.headers);
    check("shared strings resolved (no bare indices)", s.rows.some((r) => r.some((c) => /[A-Za-z]{3,}/.test(c))));
    console.log(`       headers: ${JSON.stringify(s.headers).slice(0, 200)}`);
    console.log(`       first row: ${JSON.stringify(s.rows[0]).slice(0, 200)}`);
  }
}

console.log("\nWhat it refuses");
{
  try {
    // "cfd0" is the OLE compound-document magic of a pre-2007 .xls.
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    readSheet("old.xls", xls);
    check("an old .xls is refused with an explanation", false);
  } catch (e) {
    check("an old .xls is refused with an explanation", /re-save it as \.xlsx or \.csv/.test((e as Error).message), (e as Error).message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
