/**
 * Portal settings an admin changes from the portal (2026-10-15).
 *
 * Every setting has a default here, so a fresh database behaves exactly as the
 * code did before settings existed. Values are cached per process for thirty
 * seconds; a change made from the admin page clears this process's cache at
 * once and reaches the others within that half minute.
 */
import { getDb, portalSettings } from "@dialog/db";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";

export interface PortalSettings {
  /** Off: every call on the A2A doorway answers 503 with -32013. The portal stays up. */
  doorwayEnabled: boolean;
  /** Calls per application per minute on the doorway; 0 means no limit. */
  rateLimitPerMinute: number;
  /** How long a sign-in code lasts. */
  codeTtlMinutes: number;
  /** Wrong codes allowed before a new one must be requested. */
  codeMaxAttempts: number;
  /** Agents a newly created application may call. */
  defaultAgents: string[];
  /** The line in the dark strip at the top of every portal page. */
  bannerText: string;
}

export const DEFAULT_SETTINGS: PortalSettings = {
  doorwayEnabled: true,
  rateLimitPerMinute: 120,
  codeTtlMinutes: 10,
  codeMaxAttempts: 5,
  defaultAgents: Object.values(A2A_AGENTS)
    .filter((a) => a.sandbox)
    .map((a) => a.key),
  bannerText: "Test data only. No box is rented and no payment is taken.",
};

/** What each setting accepts. Anything else is refused by the admin route. */
export function validateSetting<K extends keyof PortalSettings>(key: K, value: unknown): PortalSettings[K] | null {
  switch (key) {
    case "doorwayEnabled":
      return (typeof value === "boolean" ? value : null) as PortalSettings[K] | null;
    case "rateLimitPerMinute": {
      const n = Number(value);
      return (Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : null) as PortalSettings[K] | null;
    }
    case "codeTtlMinutes": {
      const n = Number(value);
      return (Number.isInteger(n) && n >= 2 && n <= 60 ? n : null) as PortalSettings[K] | null;
    }
    case "codeMaxAttempts": {
      const n = Number(value);
      return (Number.isInteger(n) && n >= 1 && n <= 20 ? n : null) as PortalSettings[K] | null;
    }
    case "defaultAgents":
      return (Array.isArray(value) && value.every((v) => typeof v === "string" && v in A2A_AGENTS) ? [...new Set(value as string[])] : null) as
        | PortalSettings[K]
        | null;
    case "bannerText":
      return (typeof value === "string" && value.trim().length <= 200 ? value.trim() : null) as PortalSettings[K] | null;
    default:
      return null;
  }
}

let cache: { at: number; value: PortalSettings } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<PortalSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value: PortalSettings = { ...DEFAULT_SETTINGS };
  try {
    const rows = await getDb().select().from(portalSettings);
    for (const r of rows) {
      const k = r.key as keyof PortalSettings;
      if (!(k in DEFAULT_SETTINGS)) continue;
      const v = validateSetting(k, r.value);
      if (v !== null) (value as unknown as Record<string, unknown>)[k] = v;
    }
  } catch {
    /* no table yet, or the database is unreachable: the defaults are the behaviour */
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setSetting<K extends keyof PortalSettings>(key: K, value: PortalSettings[K], by: string): Promise<void> {
  await getDb()
    .insert(portalSettings)
    .values({ key, value, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({ target: portalSettings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  cache = null;
}

export async function settingsMeta(): Promise<Record<string, { updatedBy: string | null; updatedAt: string }>> {
  const rows = await getDb().select().from(portalSettings);
  return Object.fromEntries(rows.map((r) => [r.key, { updatedBy: r.updatedBy, updatedAt: r.updatedAt.toISOString() }]));
}
