import type { AgentDefinition } from "@dialog/config";

/**
 * Whether the agent is currently within configured business hours. No config =
 * always open. Evaluated in the agent's timezone (PRD: working-hours routing).
 */
export function isBusinessOpen(agent: AgentDefinition, now = new Date()): boolean {
  const bh = agent.businessHours;
  if (!bh || bh.days.length === 0) return true;
  // Resolve day-of-week + HH:MM in the configured timezone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: bh.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[wd];
  const cur = `${hh}:${mm}`;
  const rule = bh.days.find((d) => d.day === day);
  if (!rule) return false;
  return cur >= rule.open && cur < rule.close;
}
