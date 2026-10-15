import { z } from "zod/v3";
import { json, readJson, requireAdmin, sameOrigin } from "@/lib/developer/api";
import { updateAccount } from "@/lib/developer/admin";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  organization: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["developer", "admin"]).optional(),
  active: z.boolean().optional(),
});

const MESSAGES: Record<string, [number, string]> = {
  self_lockout: [409, "You cannot deactivate your own account or remove your own admin role."],
  last_admin: [409, "This is the last active admin. Make another account an admin first."],
  not_found: [404, "No such account."],
};

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const result = await updateAccount(id, parsed.data, { aid: auth.dev.aid, email: auth.dev.email });
  if ("error" in result) {
    const [status, message] = MESSAGES[result.error ?? ""] ?? [400, String(result.error)];
    return json({ error: result.error, message }, status);
  }
  return json({ ok: true });
}
