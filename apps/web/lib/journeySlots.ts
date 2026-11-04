/**
 * A document slot by key, taken from the case's OWN journey first.
 *
 * Built as one map over every journey, a key defined in two journeys kept
 * whichever came last. `moa`, `partner_1_passport` and `partner_1_emirates_id`
 * are in EPGL 2.0's `new_license` (with EPGL's names) and in `renewal` (without),
 * and renewal came last — so those three never reached EPGL from a 2.0
 * application. Other journeys still fill in a key the active one lacks.
 */
interface WithDocs<D> {
  key: string;
  steps: { documents: D[] }[];
}

export function slotsForJourney<D extends { key: string }>(
  journeys: WithDocs<D>[],
  journeyKey: string | null | undefined
): Map<string, D> {
  const slots = new Map<string, D>();
  const active = journeys.find((j) => j.key === journeyKey);
  for (const j of [...(active ? [active] : []), ...journeys.filter((j) => j !== active)]) {
    for (const d of j.steps.flatMap((st) => st.documents)) if (!slots.has(d.key)) slots.set(d.key, d);
  }
  return slots;
}
