import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { DEFAULT_SETTINGS, getSettings, settingsMeta } from "@/lib/developer/settings";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";
import { SettingsClient } from "./SettingsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/admin/settings");
  if (dev.role !== "admin") notFound();
  const [settings, meta] = await Promise.all([getSettings(), settingsMeta().catch(() => ({}))]);
  const agents = Object.values(A2A_AGENTS).map((a) => ({ key: a.key, name: a.name }));
  return <SettingsClient initial={settings} defaults={DEFAULT_SETTINGS} initialMeta={meta} agents={agents} />;
}
