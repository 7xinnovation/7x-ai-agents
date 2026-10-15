/** Shared pieces of the portal's JSON API. */
import { developerFromRequest, type DeveloperClaims } from "./session";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

/** The signed-in developer, or a 401 the route returns as is. */
export async function requireDeveloper(req: Request): Promise<{ dev: DeveloperClaims } | { response: Response }> {
  const dev = await developerFromRequest(req);
  if (!dev) return { response: json({ error: "unauthenticated" }, 401) };
  return { dev };
}

/** Writes come from our own pages: a request with a foreign Origin is refused. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
