/**
 * Fills the missing Arabic translations on the NXN `manage_po_box` journey (its
 * title, step title and two fields were English-only, so the Arabic embed showed
 * an English starter chip among Arabic ones). Idempotent.
 *
 * Run: npx tsx scripts/fix-nxn-manage-arabic.ts   (from apps/web)
 *   prod: DATABASE_URL=<Railway Postgres DATABASE_PUBLIC_URL> npx tsx scripts/fix-nxn-manage-arabic.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const AR: Record<string, string> = {
  "journey:manage_po_box": "إدارة صندوق بريد قائم",
  "step:manage": "طلب الإدارة",
  "field:po_box_number": "رقم صندوق البريد",
  "field:management_action": "الإجراء المطلوب",
};

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;
  const j = def.journeys.find((x: any) => x.key === "manage_po_box");
  if (!j) throw new Error("manage_po_box journey not found");

  const setAr = (obj: any, key: string) => {
    if (obj?.title && key.startsWith("journey")) obj.title.ar ||= AR[key];
  };
  if (j.title) j.title.ar ||= AR["journey:manage_po_box"];
  for (const s of j.steps) {
    if (s.key === "manage" && s.title) s.title.ar ||= AR["step:manage"];
    for (const f of s.fields) {
      const k = `field:${f.key}`;
      if (AR[k] && f.label) f.label.ar ||= AR[k];
    }
  }
  void setAr;

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("NXN manage_po_box Arabic filled:");
  console.log("  title.ar:", j.title.ar);
  console.log("  step.ar:", j.steps.find((s: any) => s.key === "manage")?.title.ar);
  console.log("  fields:", j.steps.flatMap((s: any) => s.fields).map((f: any) => `${f.key}=${f.label.ar}`).join(", "));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
