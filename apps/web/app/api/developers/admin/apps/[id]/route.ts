import { z } from "zod/v3";
import { json, readJson, requireAdmin, sameOrigin } from "@/lib/developer/api";
import { adminUpdateApp } from "@/lib/developer/admin";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ agentSlugs: z.array(z.string()).optional(), revoke: z.literal(true).optional(), name: z.string().max(80).optional() });

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const result = await adminUpdateApp(id, parsed.data, auth.dev.email);
  if ("error" in result) return json({ error: result.error }, result.error === "not_found" ? 404 : 400);
  return json(result);
}
