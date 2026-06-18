import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listUsers, ensureBootstrapOwner } from "@/lib/users";
import { verifySession, atLeast } from "@/lib/session";
import { UsersTable, type UserRow } from "./UsersTable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // RBAC: only admin+ may view user management.
  const claims = await verifySession((await cookies()).get("dlg_admin")?.value);
  if (!atLeast(claims?.role, "admin")) redirect("/admin");
  await ensureBootstrapOwner(); // make sure the owner exists for first-run
  const rows = (await listUsers()) as UserRow[];
  return <UsersTable initial={rows} />;
}
