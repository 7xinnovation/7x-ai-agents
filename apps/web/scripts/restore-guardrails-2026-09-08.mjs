/**
 * Put nxn-dialog's guardrails back.
 *
 * `guardrails` is a CONFIG OBJECT — refusalTopics, goalThresholds,
 * escalationOffer, intentThresholds, confidenceThreshold,
 * requireGroundedAnswers — and a script of mine treated it as prose and wrote
 * String(object) into it. The definition then failed its zod validation, and
 * every page that loads the agent answered 500. Staging was down for about
 * fifteen minutes.
 *
 * Production was never run against, so it still holds the real object. This
 * copies that one field across and touches nothing else.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const url = (f) => /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(f, "utf8"))[1];
const [fromFile, toFile] = process.argv.slice(2);
const from = new pg.Client({ connectionString: url(fromFile) });
const to = new pg.Client({ connectionString: url(toFile) });
await from.connect(); await to.connect();

const good = (await from.query(`SELECT definition->'guardrails' g FROM agents WHERE slug='nxn-dialog'`)).rows[0]?.g;
if (!good || typeof good !== "object") throw new Error("the source's guardrails are not an object either — stopping");

const cur = (await to.query(`SELECT definition FROM agents WHERE slug='nxn-dialog'`)).rows[0]?.definition;
if (!cur) throw new Error("nxn-dialog not found in the target");
console.log("target guardrails were:", typeof cur.guardrails === "string" ? `a string: ${String(cur.guardrails).slice(0, 60)}…` : "already an object — nothing to do");
if (typeof cur.guardrails === "object" && cur.guardrails !== null) process.exit(0);

cur.guardrails = good;
await to.query(`UPDATE agents SET definition = $1 WHERE slug='nxn-dialog'`, [cur]);
console.log("restored:", Object.keys(good).join(", "));
await from.end(); await to.end();
