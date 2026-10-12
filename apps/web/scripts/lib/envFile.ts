import { readFileSync, statSync, realpathSync } from "node:fs";
import { resolve, sep, basename, dirname, relative, join, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Read a DATABASE_URL out of an env file named on the command line.
 *
 * These are operator tools: the person passing the path is the person running
 * the script, so a traversal here is someone traversing their own filesystem.
 * The audit flags every readFileSync whose argument came from outside the module
 * anyway (Aikido, CWE-23, 7 September 2026), and it is right to — the check is
 * cheap, and the day one of these grows a trigger that is not a person at a
 * terminal is the day the argument stops being the operator's.
 *
 * So the path is confined before it is read, in the shape a traversal check
 * takes: resolved, then its real path (symlinks followed) must sit inside one
 * of a short list of roots — this repository, the operator's home directory,
 * the temp directories, or roots named in DIALOG_ENV_FILE_ROOTS — and it must
 * be named like an env file, be a regular file of a sane size, and only the
 * DATABASE_URL is taken out of it. Nothing else about the file is returned.
 */

/** The repository this module is checked into: apps/web/scripts/lib → ../../../.. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Where an env file may live. Each root is a real, absolute directory path. */
export function envFileRoots(): string[] {
  const named = (process.env.DIALOG_ENV_FILE_ROOTS ?? "").split(":").map((s) => s.trim()).filter(Boolean);
  const roots = [REPO_ROOT, homedir(), tmpdir(), "/tmp", "/private/tmp", ...named];
  const real = new Set<string>();
  for (const r of roots) {
    try { real.add(realpathSync(resolve(r))); } catch { /* a root that does not exist here confines nothing */ }
  }
  return [...real];
}

/** `.env`, `.env.local`, `stg.env`, `prod.env` — not `package.json`, not `id_rsa`. */
const ENV_NAME = /(^|\.)env(\.[\w.-]+)?$/i;

/**
 * The confined, real path of an env file the operator named — or an error that
 * says which rule it broke. Exported so the rule can be tested without a read.
 */
export function confineEnvFile(file: string): string {
  if (!file || file.includes("\0")) throw new Error("--env needs a file path");
  const requested = resolve(file);
  let path: string;
  try {
    path = realpathSync(requested);
  } catch {
    throw new Error(`No such env file: ${requested}`);
  }
  // The root it lives under, from the fixed list — or none, and it is refused.
  const root = envFileRoots().find((r) => path === r || path.startsWith(r.endsWith(sep) ? r : r + sep));
  if (!root) throw new Error(`Refusing to read ${requested}: an env file must live under this repository, your home directory or a temp directory (or a root named in DIALOG_ENV_FILE_ROOTS)`);
  // Rebuilt from that root and the part below it, and checked again the way a
  // traversal check reads: the result must still begin with the root.
  const within = relative(root, path);
  if (within.startsWith("..") || isAbsolute(within)) throw new Error(`Refusing to read ${requested}: outside ${root}`);
  const confined = join(root, within);
  if (!confined.startsWith(root + sep) && confined !== root) throw new Error(`Refusing to read ${requested}: outside ${root}`);
  if (!ENV_NAME.test(basename(confined))) throw new Error(`Refusing to read ${requested}: not named like an env file (.env, .env.local, stg.env, …)`);
  const stat = statSync(confined);
  if (!stat.isFile()) throw new Error(`Not a file: ${requested}`);
  if (stat.size > 256 * 1024) throw new Error(`Too large to be an env file: ${requested}`);
  return confined;
}

export function databaseUrlFrom(file: string): string {
  const path = confineEnvFile(file);
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(path, "utf8"));
  if (!m) throw new Error(`No DATABASE_URL in ${path}`);
  return m[1]!;
}

/**
 * The database an operator tool should act on.
 *
 * `--env <file>` names one by its env file; without it, an inherited
 * DATABASE_URL is used. The second form exists because a production URL is a
 * credential: piping it in for one command leaves nothing on disk to forget
 * about afterwards.
 */
export function databaseUrlFromArgs(argv: string[] = process.argv): string {
  const i = argv.indexOf("--env");
  if (i !== -1) return databaseUrlFrom(argv[i + 1] ?? "");
  const inherited = process.env.DATABASE_URL?.trim();
  if (inherited) return inherited;
  throw new Error("--env <file>, or a DATABASE_URL in the environment, is required");
}
