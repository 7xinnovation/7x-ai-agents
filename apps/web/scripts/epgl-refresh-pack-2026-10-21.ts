/**
 * Take a Salesforce EPGL pack into scripts/fixtures, with the credentials out.
 *
 * Salesforce email their API pack with the sandbox's consumer key and secret
 * pre-filled into the `example` fields of every spec — twice now, on 19 and 21
 * October. A credential in a repository is a credential published, so the copy
 * that lands in the repo has them replaced by the names of the environment
 * variables we actually read.
 *
 * Doing it as a script rather than by hand means the next pack costs one
 * command, and the redaction is the same every time rather than as careful as
 * whoever was copying felt that morning.
 *
 * Refuses to write if anything secret-shaped survives the pass — better to stop
 * than to quietly commit the one file the pattern missed.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-refresh-pack-2026-10-21.ts <pack-dir> [--apply]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures");
const APPLY = process.argv.includes("--apply");
const packDir = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : "";

if (!packDir || !existsSync(packDir)) {
  console.error("Usage: npx tsx scripts/epgl-refresh-pack-2026-10-21.ts <pack-dir> [--apply]");
  process.exit(1);
}

/** What a credential looks like, independent of the value we happen to know. */
const SECRET_SHAPES: { name: string; re: RegExp }[] = [
  { name: "Salesforce consumer key", re: /\b3MVG9[A-Za-z0-9._]{20,}/g },
  { name: "32+ hex secret", re: /\b[0-9A-Fa-f]{32,}\b/g },
];

/** The two fields Salesforce pre-fill, replaced by what we actually read. */
function redact(spec: unknown): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) out[k] = walk(v);
      if (typeof out.example === "string") {
        // The property's own name is the only reliable signal: the value is
        // just a long string, and so are plenty of legitimate examples.
        if (out.__key === "client_id") out.example = "EPGL_NEWLAW_CLIENT_ID (read from the environment)";
        if (out.__key === "client_secret") out.example = "EPGL_NEWLAW_CLIENT_SECRET (read from the environment)";
      }
      delete out.__key;
      return out;
    }
    return node;
  };
  // Tag each property with its own key so `example` can see what it describes.
  const tag = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => tag(n));
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const out: Record<string, unknown> = key ? { __key: key } : {};
      for (const [k, v] of Object.entries(o)) out[k] = tag(v, k);
      return out;
    }
    return node;
  };
  return walk(tag(spec));
}

function leaks(text: string): string[] {
  const found: string[] = [];
  for (const { name, re } of SECRET_SHAPES) {
    for (const m of text.match(re) ?? []) {
      // A Salesforce record id is 15 or 18 chars and is not a secret; so is a
      // sha256 we put there ourselves. Only flag what is long enough to be one.
      if (/^[0-9A-Fa-f]{32,}$/.test(m) && m.length < 32) continue;
      found.push(`${name}: ${m.slice(0, 12)}… (${m.length} chars)`);
    }
  }
  return found;
}

const specs = readdirSync(packDir).filter((f) => /^EPG-Licensing-.*\.openapi\.json$/.test(f)).sort();
if (!specs.length) {
  console.error(`No EPG-Licensing-*.openapi.json in ${packDir}`);
  process.exit(1);
}

let blocked = 0;
const writes: { to: string; body: string; note: string }[] = [];

for (const f of specs) {
  const raw = readFileSync(join(packDir, f), "utf8");
  const before = leaks(raw).length;
  const cleaned = JSON.stringify(redact(JSON.parse(raw)), null, 2) + "\n";
  const after = leaks(cleaned);
  const existed = existsSync(join(FIXTURES, f));
  if (after.length) {
    console.error(`REFUSING ${f} — ${after.length} secret-shaped value(s) survived:`);
    for (const a of after) console.error("    " + a);
    blocked++;
    continue;
  }
  writes.push({ to: join(FIXTURES, f), body: cleaned, note: `${existed ? "update" : "NEW   "}  ${f}  (${before} credential(s) redacted)` });
}

// The catalogue travels with the pack as a fixture too, when one is beside it.
for (const f of readdirSync(packDir).filter((f) => /catalogue.*\.json$/i.test(f))) {
  const raw = readFileSync(join(packDir, f), "utf8");
  if (leaks(raw).length) { console.error(`REFUSING ${f} — secret-shaped values`); blocked++; continue; }
  writes.push({ to: join(FIXTURES, basename(f)), body: raw, note: `catalogue  ${f}` });
}

for (const w of writes) console.log(w.note);
if (blocked) { console.error(`\n${blocked} file(s) refused. Nothing written.`); process.exit(1); }
if (!APPLY) { console.log(`\nDry run — ${writes.length} file(s) would be written. Add --apply.`); process.exit(0); }
for (const w of writes) writeFileSync(w.to, w.body);
console.log(`\nWrote ${writes.length} file(s) into scripts/fixtures.`);
