import { json, requireAdmin } from "@/lib/developer/api";
import { adminTasks } from "@/lib/developer/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const q = new URL(req.url).searchParams;
  return json(
    await adminTasks({
      accountId: q.get("accountId") || undefined,
      appId: q.get("appId") || undefined,
      state: q.get("state") || undefined,
      cursor: q.get("cursor") || undefined,
      limit: Number(q.get("limit") ?? 50) || 50,
    })
  );
}
