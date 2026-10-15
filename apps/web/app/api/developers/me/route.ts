import { json, requireDeveloper } from "@/lib/developer/api";
import { usageSummary } from "@/lib/developer/accounts";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  const { dev } = auth;
  return json({ account: { id: dev.aid, email: dev.email, name: dev.name, organization: dev.org }, usage: await usageSummary(dev.aid) });
}
