import { json, requireAdmin } from "@/lib/developer/api";
import { listAllApps } from "@/lib/developer/admin";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  return json({ apps: await listAllApps(), agents: Object.values(A2A_AGENTS).map((a) => ({ key: a.key, name: a.name, sandbox: a.sandbox })) });
}
