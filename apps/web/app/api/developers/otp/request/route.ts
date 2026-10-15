import { z } from "zod/v3";
import { json, readJson, sameOrigin } from "@/lib/developer/api";
import { requestSignInCode } from "@/lib/developer/otp";
import { clientKey, tooManyAttempts } from "@/lib/developer/ratelimit";
import { originOf } from "@/lib/a2a/http";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email() });

/**
 * Send a sign-in code. The answer is the same whether or not the address has
 * an account, so this form cannot be used to find out who does. Only a
 * delivery failure for a real account is reported, because the person can do
 * something about it (ask 7X).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { email } = parsed.data;
  if (tooManyAttempts(clientKey(req, `otp-request:${email}`), 6)) return json({ error: "too_many_attempts" }, 429);
  const outcome = await requestSignInCode(email, originOf(req).origin);
  if (outcome === "send_failed") return json({ error: "send_failed" }, 502);
  return json({ ok: true, resendAfterSeconds: 60 });
}
