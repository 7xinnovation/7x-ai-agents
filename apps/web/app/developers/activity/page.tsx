import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { recentRequests, recentTasks } from "@/lib/developer/accounts";
import { ActivityClient } from "./ActivityClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

/** The account's tasks and request log, first page rendered on the server; Refresh fetches the rest. */
export default async function ActivityPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/activity");
  const [tasks, requests] = await Promise.all([recentTasks(dev.aid, 100), recentRequests(dev.aid, 200)]);
  return <ActivityClient initialTasks={tasks} initialRequests={requests} />;
}
