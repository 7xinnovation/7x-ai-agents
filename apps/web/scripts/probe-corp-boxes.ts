import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.env.ENVFILE ?? "../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "@/lib/integrations";
const TOKEN = process.argv[2]!;
async function main() {
const db = getDb();
const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
const intg = (await listIntegrations(row!.id)).find((i) => i.enabled && i.environments.staging)!;
const spec = intg.environments.staging!;
const base = String(spec.baseUrl).replace(/\/$/, "");
const h: Record<string,string> = { Accept: "application/json", Authorization: `Bearer ${TOKEN}` };
if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
const get = async (p: string) => (await (await fetch(base + p, { headers: h })).json())?.payload;
for (const b of ["LI","BR","GO"]) {
  for (const em of ["AUH","DXB","SHJ","RAK","AJM","FUJ","UAQ"]) {
    const locs = await get(`/api/Rental/BoxLocations?BundleId=${b}&EmirateCode=${em}`) as any[] | undefined;
    for (const l of (locs ?? []).slice(0, 6)) {
      const free = await get(`/api/Rental/FreeBoxes?BundleId=${b}&LocationId=${l.officeId}`) as any[] | undefined;
      if (free?.length) { console.log(b, em, l.officeId, l.nameEn, free.length, "free"); break; }
    }
  }
}
}
main().then(()=>process.exit(0));
