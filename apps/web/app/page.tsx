import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Root route: straight to the product. A valid admin session lands on the
 * dashboard; everyone else goes to the login page. (The old marketing page is
 * gone — agents are reached via their /embed/<slug> URLs or the widget.)
 */
export default async function Home() {
  const token = (await cookies()).get("dlg_admin")?.value;
  const claims = await verifySession(token);
  redirect(claims ? "/admin" : "/admin/login");
}
