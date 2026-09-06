import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listUsers, ensureBootstrapOwner } from "@/lib/users";
import { verifySession, atLeast } from "@/lib/session";
import { UsersTable, type UserRow } from "./UsersTable";
import { getDb, agents } from "@dialog/db";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // RBAC: only admin+ may view user management.
  const claims = await verifySession((await cookies()).get("dlg_admin")?.value);
  if (!atLeast(claims?.role, "admin")) redirect("/admin");
  await ensureBootstrapOwner(); // make sure the owner exists for first-run
  const rows = (await listUsers()) as UserRow[];
  // The agents a scope can name. Sorted by name so the checkbox list is stable.
  const all = await getDb().select({ slug: agents.slug, name: agents.name }).from(agents).orderBy(asc(agents.name));
  return <UsersTable initial={rows} agents={all} />;
}
