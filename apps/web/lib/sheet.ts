import { inflateRawSync } from "node:zlib";

/**
 * Read a spreadsheet without adding a spreadsheet library.
 *
 * Licensing publish the blocked-company list as a file, and a file from a
 * licensing team is a .xlsx about as often as it is a .csv. Both are supported
 * here because asking an operator to convert a file before uploading it is the
 * kind of instruction people forget once and then work around forever.
 *
 * XLSX is a ZIP of XML, and everything needed to read one is in Node already:
 * the central directory gives the entries, `inflateRawSync` gives the bytes,
 * and the sheet is a table of `<c>` cells whose text is either inline or an
 * index into a shared-strings table. That is a hundred lines, against a
 * dependency with a history of CVEs for a file an administrator uploads.
 *
 * What this deliberately does NOT do: formulas, dates as numbers, styles,
 * multiple sheets. It reads the FIRST sheet as text, which is what a list of
 * companies is.
 */

/** A parsed sheet: the header row, then the rows, all as trimmed strings. */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

/* ------------------------------ ZIP ------------------------------------- */

/** Every entry in a ZIP, by name, decompressed. Stored and deflated only. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // The End Of Central Directory record is at the end, after an optional
  // comment, so it is found by scanning backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    // The local header repeats the name and extra fields, at its own lengths.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    try {
      out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      /* an entry we cannot read is an entry we do not need */
    }
  }
  return out;
}

/* ------------------------------ XML ------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#34": '"',
};
function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k]!;
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** The concatenated text of every <t> element in a fragment. */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

/** Column letters to a zero-based index: A→0, Z→25, AA→26. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ----------------------------- XLSX ------------------------------------- */

function readXlsx(buf: Buffer): Sheet {
  const zip = unzip(buf);
  const sharedXml = zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared: string[] = [];
  for (const m of sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1] ?? ""));

  // The first sheet by workbook order, falling back to the conventional path.
  const workbook = zip.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstId = /<sheet[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  if (firstId) {
    const target = new RegExp(`<Relationship[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheetXml = (zip.get(sheetPath) ?? zip.get("xl/worksheets/sheet1.xml"))?.toString("utf8");
  if (!sheetXml) throw new Error("no worksheet found in this file");

  const rows: string[][] = [];
  for (const rowM of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellM of rowM[1]!.matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellM[1] ?? "";
      const body = cellM[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const at = ref ? columnIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value: string;
      if (type === "s") {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        value = shared[i] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }
      if (at >= 0) {
        while (cells.length < at) cells.push("");
        cells[at] = value.trim();
      }
    }
    rows.push(cells);
  }
  return shape(rows);
}

/* ------------------------------ CSV ------------------------------------- */

/** RFC 4180, plus semicolons and tabs, because exports differ. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  // Guess the delimiter from the first line — a comma unless another separator
  // is clearly more common, which is what a European Excel export produces.
  const first = body.slice(0, body.indexOf("\n") === -1 ? undefined : body.indexOf("\n"));
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(cell.trim()); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/* ----------------------------- shared ----------------------------------- */

/** Drop leading blank rows, take the first non-empty one as the header. */
function shape(rows: string[][]): Sheet {
  const useful = rows.filter((r) => r.some((c) => c !== ""));
  if (!useful.length) return { headers: [], rows: [] };
  return { headers: useful[0]!.map((h) => h.trim()), rows: useful.slice(1) };
}

/** Read a CSV or XLSX upload into a header row and data rows. */
export function readSheet(fileName: string, bytes: Buffer): Sheet {
  // The magic number decides it, not the extension: a file named .csv that is
  // actually a workbook is a normal thing for someone to upload.
  if (bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50) return readXlsx(bytes);
  if (/\.xlsx?$/i.test(fileName) && bytes.length > 4 && bytes.readUInt16LE(0) === 0xcfd0) {
    throw new Error("This is an old .xls workbook. Please re-save it as .xlsx or .csv and upload again.");
  }
  return shape(parseCsv(bytes.toString("utf8")));
}
