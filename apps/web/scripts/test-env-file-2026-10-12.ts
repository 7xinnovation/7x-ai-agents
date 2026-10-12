/**
 * The operator tools' env-file reader is confined (Aikido CWE-23, issues
 * 644714585/644714586, 12 October 2026). Run from apps/web:
 *   npx tsx scripts/test-env-file-2026-10-12.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { confineEnvFile, databaseUrlFrom, envFileRoots } from "./lib/envFile";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, detail ?? ""); }
}
function refuses(fn: () => unknown, why: RegExp): boolean {
  try { fn(); return false; } catch (e) { return why.test(e instanceof Error ? e.message : String(e)); }
}

const tmp = mkdtempSync(join(tmpdir(), "dlg-envfile-"));
try {
  writeFileSync(join(tmp, "stg.env"), 'FOO=1\nDATABASE_URL="postgres://u:p@h/db"\n');
  writeFileSync(join(tmp, "notes.txt"), "DATABASE_URL=postgres://x\n");
  mkdirSync(join(tmp, "dir.env"));
  symlinkSync("/etc/hosts", join(tmp, "hosts.env"));

  console.log("\nWhat is read");
  check("an env file in a temp directory, by absolute path", databaseUrlFrom(join(tmp, "stg.env")) === "postgres://u:p@h/db");
  check("the repository's own .env, by the relative path the scripts use", (() => { try { return typeof databaseUrlFrom(resolve(process.cwd(), "../../.env")) === "string"; } catch (e) { return /No DATABASE_URL|No such env file/.test(String(e)); } })());
  check("the roots are real absolute directories, the repository among them", envFileRoots().every((r) => r.startsWith("/")) && envFileRoots().some((r) => resolve(process.cwd(), "../..").startsWith(r)));

  console.log("\nWhat is refused");
  check("a system file outside every root", refuses(() => confineEnvFile("/etc/passwd"), /Refusing to read .*must live under/));
  check("a traversal that climbs out of the roots", refuses(() => confineEnvFile(join(tmp, "..", "..", "..", "..", "etc", "passwd")), /Refusing to read|No such env file/));
  check("a symlink inside a root that points outside it", refuses(() => confineEnvFile(join(tmp, "hosts.env")), /Refusing to read .*must live under/));
  check("a file not named like an env file", refuses(() => confineEnvFile(join(tmp, "notes.txt")), /not named like an env file/));
  check("a directory", refuses(() => confineEnvFile(join(tmp, "dir.env")), /Not a file/));
  check("a missing file", refuses(() => confineEnvFile(join(tmp, "missing.env")), /No such env file/));
  check("an empty argument and a NUL byte", refuses(() => confineEnvFile(""), /needs a file path/) && refuses(() => confineEnvFile("a\0.env"), /needs a file path/));

  console.log("\nThe names that count as env files");
  const re = /(^|\.)env(\.[\w.-]+)?$/i;
  check("accepted: .env .env.local .env.production stg.env prod.env", [".env", ".env.local", ".env.production", "stg.env", "prod.env"].every((n) => re.test(n)));
  check("refused: package.json id_rsa environment.txt envelope", ["package.json", "id_rsa", "environment.txt", "envelope"].every((n) => !re.test(n)));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
