import { json, requireAdmin } from "@/lib/developer/api";
import { adminTask } from "@/lib/developer/admin";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const task = await adminTask(id);
  if (!task) return json({ error: "not_found" }, 404);
  return json({ task });
}
