import { z } from "zod/v3";
import { json, readJson, sameOrigin } from "@/lib/developer/api";
import { loginDeveloper } from "@/lib/developer/accounts";
import { developerCookie, signDeveloperSession } from "@/lib/developer/session";
import { clientKey, tooManyAttempts } from "@/lib/developer/ratelimit";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { email, password } = parsed.data;
  if (tooManyAttempts(clientKey(req, email))) return json({ error: "too_many_attempts" }, 429);
  const account = await loginDeveloper(email, password);
  if (!account) return json({ error: "invalid_credentials" }, 401);
  const token = await signDeveloperSession({ aid: account.id, email: account.email, name: account.name, org: account.organization });
  const c = developerCookie(token);
  return json(
    { ok: true, account: { email: account.email, name: account.name, organization: account.organization } },
    200,
    { "set-cookie": `${c.name}=${encodeURIComponent(c.value)}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}` }
  );
}
