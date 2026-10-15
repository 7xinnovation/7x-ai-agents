import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { listAccounts } from "@/lib/developer/admin";
import { AccountsClient } from "./AccountsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts" };

export default async function AdminAccountsPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/admin/accounts");
  if (dev.role !== "admin") notFound();
  return <AccountsClient initial={await listAccounts()} selfId={dev.aid} />;
}
