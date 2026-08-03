/**
 * Probe: does the Emirates Post staging gateway validate the BEARER VALUE on its
 * guest/rental reads, or only that some Authorization header is present?
 *
 * This distinguishes "a real EP session token is required" from "any bearer
 * satisfies the gateway" — which decides whether the missing stored token is a
 * client-side credential problem or an integration-config problem.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { buildApiTools } from "../lib/integrations";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");

  const cases: [string, { sessionToken?: string; uaePassToken?: string }][] = [
    ["no bearer at all", {}],
    ["a meaningless backend session", { sessionToken: "not-a-real-session-token-xxxxxxxxxxxxxxxxxxxx" }],
    // The signed-in customer's path: the UAE PASS identity token must now be sent
    // as the bearer (the integration declares uaepass_live), and a rejection must
    // read as an expired UAE PASS session rather than a service-credential fault.
    ["a UAE PASS identity token", { uaePassToken: "not-a-real-uaepass-token-xxxxxxxxxxxxxxxxxxxx" }],
  ];
  for (const [label, tokens] of cases) {
    const { tools, exec } = await buildApiTools(agent.id, "staging", { authenticated: false, ...tokens });
    for (const needle of ["FreeBoxes", "Guest_Renewal_Details"]) {
      const tool = tools.find((t) => t.name.toLowerCase().includes(needle.toLowerCase()));
      if (!tool) continue;
      const input = needle === "FreeBoxes"
        ? { BundleId: "MYHOME3", LocationId: "201" }
        : { boxNumber: "50500", BoxNumber: "50500", EmirateCode: "DXB", emirateCode: "DXB" };
      const r = await exec(tool.name, input);
      console.log(`\n[${label}] ${needle}: ${r.isError ? "ERROR" : "OK"}`);
      console.log(`   ${r.result.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
