import { z } from "zod/v3";
import { json, readJson, requireAdmin, sameOrigin } from "@/lib/developer/api";
import { createAccount, listAccounts } from "@/lib/developer/admin";
import { sendEmail, textToHtml } from "@/lib/email";
import { OTP_EMAIL_TENANT } from "@/lib/developer/otp";
import { originOf } from "@/lib/a2a/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  return json({ accounts: await listAccounts() });
}

const Body = z.object({
  organization: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(["developer", "admin"]).default("developer"),
  /** Email the person a link to the sign-in page. No code is sent until they ask for one there. */
  notify: z.boolean().default(false),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "bad_request", details: parsed.error.flatten() }, 400);
  const result = await createAccount(parsed.data, auth.dev.email);
  if ("error" in result) return json({ error: result.error }, 409);
  const { account } = result;
  const origin = originOf(req).origin;
  const signInUrl = `${origin}/developers/login?email=${encodeURIComponent(account.email)}`;
  let notified: boolean | null = null;
  if (parsed.data.notify) {
    const text =
      `Hello ${account.name},\n\n` +
      `An account has been created for ${account.organization} on Dialog Developers, 7X's portal for integrating with Dialog agents over A2A.\n\n` +
      `Sign in with this email address. A one-time code will be sent to you; no password is needed:\n${signInUrl}\n\n` +
      `7X Innovation Studio`;
    const sent = await sendEmail({
      tenant: OTP_EMAIL_TENANT,
      to: account.email,
      subject: "Your Dialog Developers account",
      text,
      html: textToHtml(text, "Your Dialog Developers account", { name: "7X Dialog Developers", logoUrl: null, baseUrl: origin }),
    });
    notified = sent.ok;
  }
  return json({ account: { id: account.id, email: account.email }, signInUrl, notified }, 201);
}
