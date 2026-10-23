/**
 * Card attribute values that cannot share a line with their label (2026-10-23).
 *
 * Reported from the EPGL 2.0 licence-choice cards: ten products, each carrying
 * its product code as an attribute, and the codes were being chopped mid-token
 * — "CEP30-UAE-SME-" on one line and "DOM" on the next — while the "key" label
 * sat at a different height in every card in the row.
 *
 * Length alone was the wrong test. A thirty-character phrase of short words
 * wraps perfectly well beside its label; a twenty-one-character product code is
 * a single unbreakable token and cannot.
 *
 * Run from apps/web:  npx tsx scripts/test-card-attrs-2026-10-23.ts
 */
import { isOwnLineValue } from "@/app/embed/[agent]/Markdown";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

// ---------------------------------------- the codes that caused the report
for (const code of [
  "CEP30-UAE-SME-DOM", "CEP30-UAE-SME-INTL", "CEP30-NONUAE-SME-DOM",
  "CEP30-NONUAE-SME-INTL", "CEP30-GEN-DOM", "CEP30-GEN-INTL",
]) check(`${code} takes its own line`, isOwnLineValue(code), code);

// ---------------------------------------- short values stay beside the label
check("a price stays inline", !isOwnLineValue("AED 370.00"));
check("a box number stays inline", !isOwnLineValue("58198"));
check("FOODMED is short enough to sit inline", !isOwnLineValue("FOODMED"));
check("INTERMED too", !isOwnLineValue("INTERMED"));
check("OUTSOURCE too", !isOwnLineValue("OUTSOURCE"));
check("a 12-character token is still inline", !isOwnLineValue("123456789012"));
check("13 characters with no space is not", isOwnLineValue("1234567890123"));

// ---------------------------------------- phrases wrap fine beside the label
check("a short phrase stays inline", !isOwnLineValue("Bani Yas Post Office"));
check("a 30-character phrase still wraps beside it", !isOwnLineValue("Domestic and international mail"));
check("but a 33-character phrase gets its own line", isOwnLineValue("Domestic and international parcels"));

// ---------------------------------------- the other unbreakable things
check("an IBAN", isOwnLineValue("AE070331234567890123456"));
check("a tracking number", isOwnLineValue("EP123456789AE") === true);
check("an application reference", isOwnLineValue("LR-54052") === false, "short enough to sit inline");

// ---------------------------------------- it never throws on odd input
check("empty", !isOwnLineValue(""));
check("whitespace only", !isOwnLineValue("    "));
check("trailing space does not inflate the length", !isOwnLineValue("CEP30-GEN   "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
