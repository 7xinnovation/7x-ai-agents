/**
 * Fields of EPGL's application status that are theirs, not the applicant's.
 *
 * `getApplicationStatus` returns `operationalSlaDue` — EPGL's own internal
 * working target for the current step. On 5 November the assistant put it in
 * the applicant's status card as "Operational SLA Due: 05-11-2026 at 12:16" and
 * told them to "expect an update by then": a staff deadline presented as a
 * promise to the customer, and one that moves every time the step does.
 *
 * Removed from the response before the model reads it, so it cannot be shown
 * however the card is composed. The statutory deadline is left alone — it is
 * the regulator's commitment rather than an internal target.
 */
const INTERNAL = new Set(["operationalSlaDue"]);

export function withoutInternalStatusFields(result: string): { result: string; removed: number } {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (INTERNAL.has(k)) { removed++; continue; }
        out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  // The tool result is "HTTP 200 OK\n{...}" or the bare JSON, with guidance
  // sometimes appended after it: rewrite the JSON part and keep the rest.
  const start = result.indexOf("{");
  if (start === -1) return { result, removed: 0 };
  for (let end = result.lastIndexOf("}"); end > start; end = result.lastIndexOf("}", end - 1)) {
    try {
      const parsed = JSON.parse(result.slice(start, end + 1));
      const cleaned = JSON.stringify(walk(parsed));
      if (!removed) return { result, removed: 0 };
      return { result: result.slice(0, start) + cleaned + result.slice(end + 1), removed };
    } catch {
      /* try the next closing brace back */
    }
  }
  // Not parseable: take the key out of the text itself.
  const replaced = result.replace(/"operationalSlaDue"\s*:\s*("[^"]*"|null)\s*,?/g, () => { removed++; return ""; });
  return { result: replaced, removed };
}
