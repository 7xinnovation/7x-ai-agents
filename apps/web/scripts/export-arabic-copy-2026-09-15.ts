/**
 * Every Arabic string the customer can see, in one file, for review.
 *
 * FB-1725: "All Arabic text and messages in the Agentic AI journey need to be
 * reviewed and refined by the Arabic copywriting team."
 *
 * That is not a change we can make — it is a review somebody else has to do, and
 * they cannot do it while the strings are scattered across two agent
 * definitions, four journeys, a widget, a map and a notice. So this collects
 * them, with the English beside each one and a note of where it appears, into a
 * document a copywriter can mark up and hand back.
 *
 * The English is included deliberately: a reviewer needs to know what the line
 * is FOR. Several of these are constrained — a button label has a width, a
 * status badge sits on a card, and the box-hall notice is a legal warning whose
 * meaning may not drift — so the constraint is noted where there is one.
 *
 * What is NOT here, and should not be: the knowledge-base articles. They are
 * whole documents in their own right, they are EPGL's and Emirates Post's own
 * published answers rather than our wording, and reviewing them is a different
 * job from reviewing interface copy.
 *
 * Run from apps/web:
 *   npx tsx scripts/export-arabic-copy-2026-09-15.ts --env <file> [--out <file.md>]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const OUT = arg("--out") ?? "../../../docs/ARABIC-COPY-FOR-REVIEW-2026-09-15.md";
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { writeFileSync } from "node:fs";
import { STR } from "../app/embed/[agent]/Experience";
import { MAP_STR } from "../app/embed/[agent]/ChatMap";
import { poBoxHallNotice } from "../lib/branchList";

interface Row { where: string; en: string; ar: string; note?: string }

const rows: Row[] = [];
const add = (where: string, en: unknown, ar: unknown, note?: string) => {
  const e = typeof en === "string" ? en : "";
  const a = typeof ar === "string" ? ar : "";
  if (!a.trim()) return;
  rows.push({ where, en: e, ar: a, note });
};

/** A localized label, however the definition spells it. */
const pair = (v: unknown): { en: string; ar: string } =>
  v && typeof v === "object"
    ? { en: String((v as Record<string, unknown>).en ?? ""), ar: String((v as Record<string, unknown>).ar ?? "") }
    : { en: String(v ?? ""), ar: "" };

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    // ── the widget's own words ──────────────────────────────────────────────
    for (const [key, en] of Object.entries(STR.en as Record<string, unknown>)) {
      const ar = (STR.ar as Record<string, unknown>)[key];
      if (typeof en === "function" || typeof ar === "function") continue;
      if (typeof en === "object" && en !== null) {
        for (const k of Object.keys(en as Record<string, unknown>)) {
          add(`widget · ${key}.${k}`, (en as Record<string, unknown>)[k], (ar as Record<string, unknown>)?.[k]);
        }
        continue;
      }
      add(`widget · ${key}`, en, ar, "interface label — keep it short");
    }
    for (const [key, en] of Object.entries(MAP_STR.en as Record<string, unknown>)) {
      const ar = (MAP_STR.ar as Record<string, unknown>)[key];
      if (typeof en === "function" || typeof ar === "function") continue;
      add(`branch map · ${key}`, en, ar, "interface label — keep it short");
    }
    add(
      "branch notice · P.O. Box hall",
      poBoxHallNotice("<branch>", "en"),
      poBoxHallNotice("<branch>", "ar"),
      "A WARNING the customer must accept before choosing a box hall. The meaning may not drift — it is shown word for word."
    );

    // ── every journey's own words ───────────────────────────────────────────
    for (const slug of ["nxn-dialog", "epgl-dialog"]) {
      const [row] = await db.select().from(agents).where(eq(agents.slug, slug));
      if (!row) continue;
      const def = row.definition as Record<string, any>;
      const g = pair(def.greeting);
      add(`${slug} · greeting`, g.en, g.ar, "the first thing anybody reads; the button labels inside it are choices");
      for (const i of def.intents ?? []) {
        const d = pair(i.description);
        add(`${slug} · intent ${i.key}`, d.en, d.ar, "what the service is called");
      }
      for (const j of def.journeys ?? []) {
        const t = pair(j.title);
        add(`${slug} · ${j.key} · title`, t.en, t.ar, "shown as the application's name in the panel");
        for (const s of j.steps ?? []) {
          const st = pair(s.title);
          add(`${slug} · ${j.key} · step ${s.key}`, st.en, st.ar, "section heading");
          for (const f of s.fields ?? []) {
            const l = pair(f.label);
            add(`${slug} · ${j.key} · field ${f.key}`, l.en, l.ar, "panel row label");
            for (const o of f.options ?? []) {
              const ol = pair(o.label);
              add(`${slug} · ${j.key} · field ${f.key} · option ${o.value}`, ol.en, ol.ar, "button label — keep it short");
            }
          }
          for (const d of s.documents ?? []) {
            const l = pair(d.label);
            add(`${slug} · ${j.key} · document ${d.key}`, l.en, l.ar, "upload slot label");
            const desc = pair(d.description);
            if (desc.ar) add(`${slug} · ${j.key} · document ${d.key} · hint`, desc.en, desc.ar, "the line under the slot");
          }
        }
      }
      const disc = pair(def.documentsDisclaimer);
      if (disc.ar) add(`${slug} · documents disclaimer`, disc.en, disc.ar, "shown above the upload slots");
    }

    // ── the document ────────────────────────────────────────────────────────
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const head = r.where.split(" · ")[0]!;
      groups.set(head, [...(groups.get(head) ?? []), r]);
    }
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    const out: string[] = [
      "# Arabic copy for review",
      "",
      "**FB-1725** · generated " + new Date().toISOString().slice(0, 10) + " from the live staging configuration.",
      "",
      `${rows.length} strings. The English is beside each one so you can see what the line is for; the note says where it appears and any constraint on it.`,
      "",
      "**How to hand it back:** edit the Arabic column in place, or add a column with your preferred wording. Anything you leave alone stays as it is.",
      "",
      "**Please do not change:** the `<branch>` and `<...>` placeholders, which are filled in at runtime, and the meaning of the P.O. Box hall notice, which is a condition the customer accepts.",
      "",
      "> Not included: the knowledge-base articles. Those are Emirates Post's and EPGL's own published answers rather than our interface copy, and they are whole documents — a separate review.",
      "",
    ];
    for (const [head, list] of groups) {
      out.push(`## ${head}`, "", "| Where | English | Arabic | Note |", "|---|---|---|---|");
      for (const r of list) out.push(`| \`${esc(r.where)}\` | ${esc(r.en)} | ${esc(r.ar)} | ${esc(r.note ?? "")} |`);
      out.push("");
    }
    writeFileSync(new URL(OUT, import.meta.url), out.join("\n"));
    console.log(`${rows.length} Arabic strings -> ${OUT}`);
  } finally {
    await pool.end();
  }
}

import { eq } from "drizzle-orm";
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
