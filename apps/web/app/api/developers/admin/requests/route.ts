import { json, requireAdmin } from "@/lib/developer/api";
import { adminRequests } from "@/lib/developer/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const q = new URL(req.url).searchParams;
  const outcome = q.get("outcome");
  return json(
    await adminRequests({
      accountId: q.get("accountId") || undefined,
      appId: q.get("appId") || undefined,
      agent: q.get("agent") || undefined,
      method: q.get("method") || undefined,
      outcome: outcome === "ok" || outcome === "error" ? outcome : undefined,
      cursor: q.get("cursor") || undefined,
      limit: Number(q.get("limit") ?? 100) || 100,
    })
  );
}
