/**
 * Runs the insights aggregation against whatever DATABASE_URL points at and
 * prints every section, so the queries are proved against real rows rather than
 * only typechecked. Read-only.
 */
import { loadInsights } from "../lib/insights";

const AGENTS: Record<string, string> = {
  "epgl-dialog": "d77d37ce-57a8-47df-904b-76eb261dc966",
  "nxn-dialog": "84ab0421-440b-434d-b7c6-49e20acffe14",
};

async function main() {
  for (const [slug, id] of Object.entries(AGENTS)) {
    const d = await loadInsights("all", id);
    console.log(`\n================ ${slug} (${d.agent?.name}) ================`);
    console.log("headline      ", JSON.stringify(d.headline));
    console.log("journeyKeys   ", d.journeyKeys, d.journeyLabel);
    console.log("daily days    ", d.daily.length, "with data:", d.daily.filter((x) => x.total).map((x) => `${x.day}=${x.total}`).join(" "));
    console.log("journeys      ", JSON.stringify(d.journeys));
    console.log("funnel        ");
    for (const f of d.funnel) console.log(`   ${f.step.padEnd(20)} ${String(f.now).padStart(5)}  prior ${String(f.prior).padStart(5)}  ${f.loss ?? "—"}%`);
    console.log("facets        ", d.facets.map((f) => `${f.label}: ${f.rows.map((r) => `${r.value}=${r.count}`).join(", ")}`).join(" | "));
    console.log("payments      ", JSON.stringify(d.payments));
    console.log("intents       ", JSON.stringify(d.intents));
    console.log("unknownRate   ", JSON.stringify(d.unknownRate));
    console.log("escalations   ", JSON.stringify(d.escalations));
    console.log("knowledge     ", JSON.stringify(d.knowledge));
    console.log("quality       ", JSON.stringify(d.quality));
    console.log("continuity    ", JSON.stringify(d.continuity));
    console.log("languages     ", JSON.stringify(d.languages));
    console.log("convs/day     ", d.conversationsPerDay.length, "days");
    console.log("sla           ", JSON.stringify(d.sla));
  }
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
