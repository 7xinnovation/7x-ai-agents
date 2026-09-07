import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Read a DATABASE_URL out of an env file named on the command line.
 *
 * These are operator tools: the person passing the path is the person running
 * the script, so a traversal here is someone traversing their own filesystem.
 * The audit flags every readFileSync whose argument came from outside the module
 * anyway, and it is right to — the check is cheap, and the day one of these
 * grows a trigger that is not a person at a terminal is the day the argument
 * stops being the operator's.
 *
 * So: the path is resolved, it must be a regular file of a sane size, and only
 * the DATABASE_URL is taken out of it. Nothing else about the file is returned.
 */
export function databaseUrlFrom(file: string): string {
  const path = resolve(file);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`No such env file: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
  if (stat.size > 256 * 1024) throw new Error(`Too large to be an env file: ${path}`);
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(path, "utf8"));
  if (!m) throw new Error(`No DATABASE_URL in ${path}`);
  return m[1]!;
}
