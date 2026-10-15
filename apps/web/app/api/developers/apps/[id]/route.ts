import { z } from "zod/v3";
import { json, readJson, requireDeveloper, sameOrigin } from "@/lib/developer/api";
import { renameApp, revokeApp } from "@/lib/developer/accounts";
import { audit } from "@/lib/conversation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ name: z.string().min(1).max(80) });

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const app = await renameApp(auth.dev.aid, id, parsed.data.name);
  if (!app) return json({ error: "not_found" }, 404);
  return json({ app });
}

/** Revoke: the client and the key stop working at once. The record stays, for the log. */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const app = await revokeApp(auth.dev.aid, id);
  if (!app) return json({ error: "not_found" }, 404);
  await audit({ actor: "system", action: "developer_app_revoked", payload: { by: `developer:${auth.dev.email}`, appId: app.id, clientId: app.clientId } }).catch(() => {});
  return json({ app });
}
