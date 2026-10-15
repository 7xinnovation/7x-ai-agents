import { json, requireDeveloper, sameOrigin } from "@/lib/developer/api";
import { appForAccount } from "@/lib/developer/accounts";
import { tokenForApp } from "@/lib/a2a/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** A one-hour access token for the Console, so the application's secret never reaches the browser. */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const app = await appForAccount(auth.dev.aid, id);
  if (!app || app.revokedAt) return json({ error: "not_found" }, 404);
  const token = await tokenForApp(app.id);
  if (!token) return json({ error: "not_found" }, 404);
  return json({ ...token, token_type: "Bearer", clientId: app.clientId, agentSlugs: app.agentSlugs ?? [] });
}
