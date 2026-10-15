/** A small fixed-window limiter for the portal's sign-in, per process. */
const hits = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string, limit = 10, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    return false;
  }
  cur.count += 1;
  return cur.count > limit;
}

export function clientKey(req: Request, extra = ""): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return `${ip}|${extra.toLowerCase()}`;
}
