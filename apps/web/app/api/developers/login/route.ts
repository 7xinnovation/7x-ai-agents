import { json } from "@/lib/developer/api";

export const runtime = "nodejs";

/** Passwords were retired on 15 October 2026: sign-in is by emailed code (/api/developers/otp/*). */
export async function POST() {
  return json({ error: "password_sign_in_retired", use: "/api/developers/otp/request" }, 410);
}
