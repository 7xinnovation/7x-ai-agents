import { json, requireDeveloper } from "@/lib/developer/api";
import { usageSummary } from "@/lib/developer/accounts";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  return json(await usageSummary(auth.dev.aid));
}
