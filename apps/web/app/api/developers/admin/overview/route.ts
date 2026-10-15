import { json, requireAdmin } from "@/lib/developer/api";
import { adminOverview } from "@/lib/developer/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  return json(await adminOverview());
}
