/**
 * A pack that does not match the catalogue strands a tester (30 October 2026).
 *
 * The failure these guard against is not a crash. It is a tester working down
 * a numbered folder, reaching a document the assistant has asked for and the
 * pack does not contain, and either giving up or -- worse -- uploading the
 * nearest thing, which gets the wrong answer recorded as a bug against the
 * agent.
 *
 * So the checks are mostly about agreement: between the pack and EPGL's
 * catalogue, between the instructions and the fee the catalogue states, and
 * between the packs themselves, which must not collide on a company.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-test-packs-2026-10-30.ts
 */
import { docsFor, documentTypesFor, productFor, readme, testingMd } from "./epgl-test-packs-2026-10-30";
import { BUILDERS, PARTNER2_DOCS, SCENARIOS } from "./lib/epglTestPacks";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

const packs = SCENARIOS.map((s) => ({ s, p: productFor(s.code), docs: docsFor(s) }));

check("there are five packs beside the 22 October one", SCENARIOS.length === 5);
check("each has its own folder", new Set(SCENARIOS.map((s) => s.dir)).size === 5);
check("...numbered from 02, because 01 is the pack testers already have",
  SCENARIOS.map((s) => s.dir.slice(0, 2)).join() === "02,03,04,05,06");

// ---- every pack holds what the catalogue asks for ----------------------------
for (const { s, p, docs } of packs) {
  const types = documentTypesFor(p);
  check(`${s.dir}: every catalogue document is drawable`, types.every((t) => Boolean(BUILDERS[t])),
    types.filter((t) => !BUILDERS[t]));
  /**
   * One file per catalogue type, plus partner 2's two, plus our own trade
   * licence where the catalogue does not name one. A pack with a file too few
   * is the failure above; a file too many sends somebody looking for a slot
   * that does not exist.
   */
  const ours = types.includes("Trade Licence") ? 0 : 1;
  check(`${s.dir}: ${types.length} catalogue documents + ${ours ? "our trade licence + " : ""}partner 2's two`,
    docs.length === types.length + PARTNER2_DOCS.length + ours, { got: docs.length, types: types.length });
  check(`${s.dir}: the files are numbered 01..${String(docs.length).padStart(2, "0")} with no gap`,
    docs.every((d, i) => d.file.startsWith(`${String(i + 1).padStart(2, "0")}-`)), docs.map((d) => d.file));
  check(`${s.dir}: no two files share a name`, new Set(docs.map((d) => d.file)).size === docs.length);
  check(`${s.dir}: every document is a PDF`, docs.every((d) => d.file.endsWith(".pdf")));
}

/**
 * OUR OWN trade licence slot is unconditioned in the journey and asked on
 * every run. The four permits name "Trade Licence" in the catalogue so the
 * file is already there; the CEP30 products name only the combined
 * "Trade Licence / Initial Name Approval", and a CEP30 pack without a plain
 * trade licence is exactly one file short -- which is how pack 02 was first
 * generated.
 */
const cep = packs.find((x) => x.s.code.startsWith("CEP30"))!;
check("a CEP30 pack carries BOTH licence documents",
  cep.docs.some((d) => /\d+-trade-licence\.pdf$/.test(d.file)) &&
  cep.docs.some((d) => d.file.includes("trade-licence-initial-name-approval")),
  cep.docs.map((d) => d.file));
for (const { s, docs } of packs.filter((x) => !x.s.code.startsWith("CEP30"))) {
  check(`${s.dir}: a permit needs only the one trade licence`,
    docs.filter((d) => d.file.includes("trade-licence")).length === 1,
    docs.filter((d) => d.file.includes("trade-licence")).map((d) => d.file));
}

// ---- the documents that must NOT be in a pack --------------------------------
/**
 * The SME licence belongs to the four SME products alone. Pack 02 is a General
 * one, and shipping an SME licence in it would teach a tester to upload a
 * document the assistant is right not to ask for -- then report its absence.
 */
const gen = packs.find((x) => x.s.code === "CEP30-GEN-INTL")!;
check("the General pack has NO SME licence", !gen.docs.some((d) => d.file.includes("sme-licence")),
  gen.docs.map((d) => d.file));
for (const { s, docs } of packs.filter((x) => !x.s.code.startsWith("CEP30"))) {
  for (const absent of ["lease", "insurance", "fleet", "sme-licence"]) {
    check(`${s.dir}: no ${absent} document — a permit asks for none`,
      !docs.some((d) => d.file.includes(absent)), docs.filter((d) => d.file.includes(absent)).map((d) => d.file));
  }
}
const food = packs.find((x) => x.s.code === "FOODMED")!;
for (const needed of ["food-safety", "pharmaceutical", "cold-chain", "storage-premises"]) {
  check(`the FOODMED pack carries its ${needed} document`, food.docs.some((d) => d.file.includes(needed)));
}

// ---- the packs must not collide in the sandbox -------------------------------
/**
 * EPGL's duplicate check works on the company, so two packs sharing a company
 * or a trade licence number would have the second application refused as a
 * duplicate of the first -- and the tester would report a bug that is ours.
 */
check("every pack applies as a different company",
  new Set(SCENARIOS.map((s) => s.company.en)).size === SCENARIOS.length);
check("...with a different trade licence number",
  new Set(SCENARIOS.map((s) => s.company.tl)).size === SCENARIOS.length);
check("...and none of them is the 22 October company",
  SCENARIOS.every((s) => !s.company.en.includes("20261022A") && s.company.tl !== "CN-1234567"));
check("every company is marked DO NOT PROCESS",
  SCENARIOS.every((s) => s.company.en.startsWith("7X TEST - DO NOT PROCESS - ")));
check("...in Arabic too", SCENARIOS.every((s) => s.company.ar.includes("لا تقم بالمعالجة")));

// ---- the documents are bilingual ---------------------------------------------
const ARABIC = /[؀-ۿ]/;
for (const { s, docs } of packs) {
  check(`${s.dir}: every document has an Arabic title`, docs.every((d) => ARABIC.test(d.titleAr)), s.dir);
  check(`${s.dir}: every line with English has Arabic beside it`,
    docs.every((d) => d.rows.every((row) => row.en.trim() === "" || row.ar.trim() !== "")),
    docs.flatMap((d) => d.rows.filter((row) => row.en.trim() !== "" && row.ar.trim() === "").map((row) => `${d.file}: ${row.en}`)));
}

// ---- the instructions agree with the catalogue -------------------------------
/**
 * The fee is the one figure a tester is told to stop the run over, so it must
 * come from the catalogue and not from somebody's memory. These re-derive it
 * and look for it in the prose.
 */
for (const { s, p, docs } of packs) {
  const md = testingMd(s, docs);
  const fee = p.fees?.[0]?.amount;
  if (typeof fee === "number" && fee > 0) {
    const printed = `AED ${fee.toLocaleString("en-AE")}`;
    check(`${s.dir}: the instructions quote the catalogue's fee (${printed})`, md.includes(printed), printed);
  } else {
    check(`${s.dir}: the instructions say there is nothing to pay`,
      md.includes("no application fee") && !/Pay with Card/.test(md));
  }
  check(`${s.dir}: every document in the folder is listed in the instructions`,
    docs.every((d) => md.includes(d.file)), docs.filter((d) => !md.includes(d.file)).map((d) => d.file));
  check(`${s.dir}: the product's own name is what it tells you to pick`,
    md.includes(p.name?.en ?? s.code));
  check(`${s.dir}: the reference number is asked for`, md.includes("LR-"));
  check(`${s.dir}: and a callback is warned against`, md.includes("Do not accept the offer"));
}

/** Above the online limit means no card at all, and the instructions have to say so. */
check("the AED 40,000 pack tells the tester the card must NOT open", (() => {
  const md = testingMd(gen.s, gen.docs);
  return md.includes("AED 40,000") && /should not let you|cannot be taken in the chat/.test(md);
})());
check("...and the no-fee pack offers no card either", (() => {
  const out = packs.find((x) => x.s.code === "OUTSOURCE")!;
  return !/4111 1111 1111 1111/.test(testingMd(out.s, out.docs));
})());

/** Conditional issuance is said BEFORE paying, or approval reads as final. */
for (const { s, p, docs } of packs.filter((x) => x.p.conditionalIssuance)) {
  check(`${s.dir}: the tester is told issuance is conditional`,
    /issued conditionally/.test(testingMd(s, docs)), s.code);
}

/**
 * The index said 11 where the folder held 12, because it counted the
 * catalogue's documents and our own trade licence is not one of them. A count
 * a tester cannot trust is worse than no count: it is what they check their
 * folder against before starting.
 */
const index = readme();
for (const { s: sc, docs } of packs) {
  check(`${sc.dir}: the index counts the files that are actually in the folder`,
    index.includes(`](${sc.dir}/TESTING.md) |`) &&
    index.split("\n").find((l) => l.includes(`${sc.dir}/TESTING.md`))!.includes(`| ${docs.length} |`),
    index.split("\n").find((l) => l.includes(`${sc.dir}/TESTING.md`)));
  check(`${sc.dir}: and its one-line summary is the scenario's own`, index.includes(sc.purpose));
}
check("the index links pack 01 as well, which this generator only copies",
  index.includes("01-cep30-sme-uae-domestic/TESTING.md"));
check("...and says every run writes to the real sandbox",
  /real write to Emirates Post's NewLaw sandbox/.test(index));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
