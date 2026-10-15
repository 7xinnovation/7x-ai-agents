import { z } from "zod/v3";
import { json, readJson, sameOrigin } from "@/lib/developer/api";
import { acceptDeveloperInvite, accountByInviteToken, MIN_PASSWORD_LENGTH } from "@/lib/developer/accounts";
import { developerCookie, signDeveloperSession } from "@/lib/developer/session";

export const runtime = "nodejs";

/** Who an invitation is for, so the accept page can say so. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const account = await accountByInviteToken(token);
  if (!account) return json({ error: "invalid_or_expired" }, 404);
  return json({ ok: true, email: account.email, name: account.name, organization: account.organization });
}

const Body = z.object({ token: z.string().min(20), password: z.string().min(MIN_PASSWORD_LENGTH) });

/** Set the password; the invitation is spent. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request", minPasswordLength: MIN_PASSWORD_LENGTH }, 400);
  const account = await acceptDeveloperInvite(parsed.data.token, parsed.data.password);
  if (!account) return json({ error: "invalid_or_expired" }, 404);
  const token = await signDeveloperSession({ aid: account.id, email: account.email, name: account.name, org: account.organization });
  const c = developerCookie(token);
  return json({ ok: true }, 200, {
    "set-cookie": `${c.name}=${encodeURIComponent(c.value)}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}`,
  });
}
