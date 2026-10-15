import { z } from "zod/v3";
import { json, readJson, sameOrigin } from "@/lib/developer/api";
import { verifySignInCode } from "@/lib/developer/otp";
import { developerCookie, signDeveloperSession } from "@/lib/developer/session";
import { clientKey, tooManyAttempts } from "@/lib/developer/ratelimit";
import { audit } from "@/lib/conversation";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email(), code: z.string().min(6).max(12) });

/** Check the code; on success the session cookie is set. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { email, code } = parsed.data;
  if (tooManyAttempts(clientKey(req, `otp-verify:${email}`), 10)) return json({ error: "too_many_attempts" }, 429);
  const result = await verifySignInCode(email, code);
  if (!result.ok) return json({ error: result.reason }, result.reason === "too_many_attempts" ? 429 : 401);
  const { account } = result;
  await audit({ actor: "system", action: "developer_signed_in", payload: { by: `developer:${account.email}`, method: "email_code" } }).catch(() => {});
  const token = await signDeveloperSession({ aid: account.id, email: account.email, name: account.name, org: account.organization });
  const c = developerCookie(token);
  return json({ ok: true }, 200, {
    "set-cookie": `${c.name}=${encodeURIComponent(c.value)}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}`,
  });
}
