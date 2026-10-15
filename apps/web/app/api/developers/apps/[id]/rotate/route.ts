import { json, requireDeveloper, sameOrigin } from "@/lib/developer/api";
import { rotateApp } from "@/lib/developer/accounts";
import { audit } from "@/lib/conversation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** New secret and key; the old ones, and every token issued before now, stop working. */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const rotated = await rotateApp(auth.dev.aid, id);
  if (!rotated) return json({ error: "not_found" }, 404);
  await audit({ actor: "system", action: "developer_app_rotated", payload: { by: `developer:${auth.dev.email}`, appId: rotated.app.id, clientId: rotated.app.clientId } }).catch(() => {});
  return json(rotated);
}
