import { json, requireAdmin } from "@/lib/developer/api";
import { adminEvents, type EventScope } from "@/lib/developer/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope");
  return json(
    await adminEvents({
      scope: scope === "sandbox" || scope === "all" ? (scope as EventScope) : "portal",
      q: q.get("q")?.slice(0, 100) || undefined,
      action: q.get("action") || undefined,
      cursor: q.get("cursor") || undefined,
      limit: Number(q.get("limit") ?? 100) || 100,
    })
  );
}
