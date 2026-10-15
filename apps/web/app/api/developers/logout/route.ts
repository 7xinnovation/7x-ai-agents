import { json } from "@/lib/developer/api";
import { DEV_COOKIE } from "@/lib/developer/session";

export const runtime = "nodejs";

export async function POST() {
  return json({ ok: true }, 200, { "set-cookie": `${DEV_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
}
