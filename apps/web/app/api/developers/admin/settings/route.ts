import { json, readJson, requireAdmin, sameOrigin } from "@/lib/developer/api";
import { DEFAULT_SETTINGS, getSettings, setSetting, settingsMeta, validateSetting, type PortalSettings } from "@/lib/developer/settings";
import { adminAudit } from "@/lib/developer/admin";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  return json({
    settings: await getSettings(),
    defaults: DEFAULT_SETTINGS,
    meta: await settingsMeta().catch(() => ({})),
    agents: Object.values(A2A_AGENTS).map((a) => ({ key: a.key, name: a.name })),
  });
}

/** Change one or more settings: { key: value, ... }. Each is validated; nothing is saved if any is invalid. */
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const body = (await readJson<Record<string, unknown>>(req)) ?? {};
  const before = await getSettings();
  const valid: [keyof PortalSettings, unknown][] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!(k in DEFAULT_SETTINGS)) return json({ error: "unknown_setting", key: k }, 400);
    const ok = validateSetting(k as keyof PortalSettings, v);
    if (ok === null) return json({ error: "invalid_value", key: k }, 400);
    valid.push([k as keyof PortalSettings, ok]);
  }
  for (const [k, v] of valid) {
    await setSetting(k, v as never, auth.dev.email);
    await adminAudit(auth.dev.email, "setting_changed", { key: k, from: before[k], to: v });
  }
  return json({ settings: await getSettings() });
}
