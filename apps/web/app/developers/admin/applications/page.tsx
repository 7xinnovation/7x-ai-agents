import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { listAllApps } from "@/lib/developer/admin";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";
import { ApplicationsClient } from "./ApplicationsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Applications" };

export default async function AdminApplicationsPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/admin/applications");
  if (dev.role !== "admin") notFound();
  const agents = Object.values(A2A_AGENTS).map((a) => ({ key: a.key, name: a.name, sandbox: a.sandbox }));
  return <ApplicationsClient initial={await listAllApps()} agents={agents} />;
}
