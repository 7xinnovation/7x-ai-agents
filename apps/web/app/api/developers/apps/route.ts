import { z } from "zod/v3";
import { json, readJson, requireDeveloper, sameOrigin } from "@/lib/developer/api";
import { createApp, listApps } from "@/lib/developer/accounts";
import { audit } from "@/lib/conversation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  return json({ apps: await listApps(auth.dev.aid) });
}

const Body = z.object({ name: z.string().min(1).max(80) });

/** Create an application. The secret and the key are in THIS response only. */
export async function POST(req: Request) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const created = await createApp(auth.dev.aid, parsed.data.name);
  await audit({ actor: "system", action: "developer_app_created", payload: { by: `developer:${auth.dev.email}`, appId: created.app.id, clientId: created.app.clientId, name: created.app.name } }).catch(() => {});
  return json(created, 201);
}
