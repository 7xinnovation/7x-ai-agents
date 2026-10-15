import { json, requireDeveloper } from "@/lib/developer/api";
import { recentRequests } from "@/lib/developer/accounts";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100) || 100;
  return json({ requests: await recentRequests(auth.dev.aid, limit) });
}
