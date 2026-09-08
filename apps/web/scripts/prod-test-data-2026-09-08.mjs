/**
 * What is in production, and which of it is a test.
 *
 * Dry run by default. It prints every conversation with the day it was held, how
 * many messages it has, whether it reached a payment, and the name on it — so
 * "keep the one where a purchase was actually made" is a decision made against
 * the evidence rather than the date.
 *
 * --apply deletes only what this listing marked DELETE.
 */
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const APPLY = process.argv.includes("--apply");
/**
 * Nothing after this instant is touched.
 *
 * "Conversations from yesterday" is a sentence in Gulf time, and the column is
 * UTC — 2026-09-07T22:59Z was two in the morning on the 8th in Dubai. The
 * default is midnight tonight-just-gone in the UAE, so today's conversations are
 * left alone whatever they turn out to be, and are listed separately to be
 * decided on rather than swept up.
 */
const cutArg = process.argv.indexOf("--before");
const CUT = new Date(cutArg !== -1 ? process.argv[cutArg + 1] : "2026-09-07T20:00:00Z");
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();

const { rows } = await c.query(`
  SELECT cv.id, cv.created_at, cv.authenticated, a.slug AS agent,
         (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id) AS msgs,
         (SELECT count(*)::int FROM payments p WHERE p.conversation_id = cv.id AND p.status = 'paid') AS paid,
         (SELECT coalesce(sum(p.amount),0)::numeric FROM payments p WHERE p.conversation_id = cv.id AND p.status='paid') AS amount,
         cs.state->'data' AS data, cs.state->>'reference' AS reference
  FROM conversations cv
  LEFT JOIN agents a ON a.id = cv.agent_id
  LEFT JOIN cases cs ON cs.conversation_id = cv.id
  ORDER BY cv.created_at`);

const nameOf = (d) => {
  if (!d) return "";
  for (const k of ["customer_name", "owner_name", "contact_name", "subscriber_first_name", "company_name"]) {
    if (typeof d[k] === "string" && d[k].trim()) return d[k].trim();
  }
  return "";
};

const keep = [], drop = [];
for (const r of rows) {
  // A conversation that took money is real, whoever held it. So is anything with
  // a submission reference, and anything after the cutoff.
  const real = r.paid > 0 || Boolean(r.reference) || r.created_at >= CUT;
  (real ? keep : drop).push(r);
}
console.log(`${rows.length} conversation(s) on production\n`);
const paidOrRef = rows.filter((r) => r.paid > 0 || Boolean(r.reference));
const afterCut = rows.filter((r) => r.created_at >= CUT && !(r.paid > 0 || Boolean(r.reference)));
console.log(`cutoff: nothing created on or after ${CUT.toISOString()} is touched\n`);
console.log(`KEPT because money moved or a reference exists (${paidOrRef.length}):`);
for (const r of paidOrRef)
  console.log(`  ${r.created_at.toISOString().slice(0, 16)} ${String(r.agent ?? "-").padEnd(18)} ${String(r.msgs).padStart(3)} msgs  ${r.paid ? `PAID AED ${r.amount}` : ""}${r.reference ? ` ref ${r.reference}` : ""}${nameOf(r.data) ? `  — ${nameOf(r.data)}` : ""}  ${r.id}`);
console.log(`\nKEPT because they are from TODAY and not mine to judge (${afterCut.length}):`);
const byHour = new Map();
for (const r of afterCut) {
  const h = r.created_at.toISOString().slice(0, 13);
  byHour.set(h, (byHour.get(h) ?? 0) + 1);
}
for (const [h, n] of byHour) console.log(`  ${h}:00Z  ${n} conversation(s)`);
console.log(`  longest: ${Math.max(0, ...afterCut.map((r) => r.msgs))} messages`);
console.log(`\nTO DELETE (${drop.length}) — everything before the cutoff that took no money:`);
const days = new Map();
for (const r of drop) {
  const d = r.created_at.toISOString().slice(0, 10);
  days.set(d, (days.get(d) ?? 0) + 1);
}
for (const [d, n] of days) console.log(`  ${d}  ${n} conversation(s)`);

// Anything else that is only ours.
const extras = await c.query(`
  SELECT (SELECT count(*)::int FROM analytics_events) ev,
         (SELECT count(*)::int FROM audit_log) au,
         (SELECT count(*)::int FROM escalations) es,
         (SELECT count(*)::int FROM documents) doc,
         (SELECT count(*)::int FROM document_blobs) blob,
         (SELECT count(*)::int FROM payments) pay`);
console.log("other rows:", JSON.stringify(extras.rows[0]));

if (!APPLY) { console.log("\nDry run — nothing deleted. Add --apply."); await c.end(); process.exit(0); }

const ids = drop.map((r) => r.id);
if (!ids.length) { console.log("nothing to delete."); await c.end(); process.exit(0); }

// WRITTEN OUT BEFORE IT IS TAKEN AWAY.
//
// This is production and the judgement — "a conversation that took no money is a
// test" — is a good one, not a certain one. The whole of what is about to go
// lands in a file first, so a mistake is a restore rather than an apology.
const dump = { at: new Date().toISOString(), cutoff: CUT.toISOString(), conversations: [] };
for (const id of ids) {
  const [conv, msgs, kase, aud, ev, pay, docs] = await Promise.all([
    c.query(`SELECT * FROM conversations WHERE id = $1`, [id]),
    c.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [id]),
    c.query(`SELECT * FROM cases WHERE conversation_id = $1`, [id]),
    c.query(`SELECT * FROM audit_log WHERE conversation_id = $1`, [id]),
    c.query(`SELECT * FROM analytics_events WHERE conversation_id = $1`, [id]),
    c.query(`SELECT * FROM payments WHERE conversation_id = $1`, [id]),
    c.query(`SELECT * FROM documents WHERE case_id IN (SELECT id FROM cases WHERE conversation_id = $1)`, [id]),
  ]);
  dump.conversations.push({
    conversation: conv.rows[0], messages: msgs.rows, cases: kase.rows,
    audit: aud.rows, events: ev.rows, payments: pay.rows, documents: docs.rows,
  });
}
const path = process.env.BACKUP_TO || `./prod-test-data-backup-${Date.now()}.json`;
writeFileSync(path, JSON.stringify(dump, null, 1));
console.log(`\nBacked up ${ids.length} conversation(s) and everything hanging off them to ${path}`);

await c.query("BEGIN");
try {
  // Children first, then the conversation. cases/messages cascade, but the rows
  // that merely CARRY a conversation id do not — and an orphaned audit row is
  // still the test data we were asked to clear.
  for (const [label, sql] of [
    ["analytics_events", `DELETE FROM analytics_events WHERE conversation_id = ANY($1::uuid[])`],
    ["audit_log", `DELETE FROM audit_log WHERE conversation_id = ANY($1::uuid[])`],
    ["payments", `DELETE FROM payments WHERE conversation_id = ANY($1::uuid[])`],
    ["escalations", `DELETE FROM escalations WHERE conversation_id = ANY($1::uuid[])`],
    ["document_blobs", `DELETE FROM document_blobs WHERE case_id IN (SELECT id FROM cases WHERE conversation_id = ANY($1::uuid[]))`],
    ["documents", `DELETE FROM documents WHERE case_id IN (SELECT id FROM cases WHERE conversation_id = ANY($1::uuid[]))`],
    ["conversations", `DELETE FROM conversations WHERE id = ANY($1::uuid[])`],
  ]) {
    const r = await c.query(sql, [ids]);
    console.log(`  ${label}: ${r.rowCount} row(s)`);
  }
  await c.query("COMMIT");
  console.log(`\nDeleted ${ids.length} test conversation(s). ${keep.length} kept.`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLED BACK — nothing was deleted:", String(e?.message ?? e));
  process.exitCode = 1;
}
await c.end();
