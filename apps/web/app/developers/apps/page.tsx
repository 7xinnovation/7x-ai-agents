import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { listApps } from "@/lib/developer/accounts";
import { AppsClient } from "./AppsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Applications" };

/** The account's applications, loaded here so the list is on the page before any script runs. */
export default async function AppsPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/apps");
  const apps = await listApps(dev.aid);
  return <AppsClient initial={apps} />;
}
