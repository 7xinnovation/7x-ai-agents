import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { scopeOf } from "@/lib/users";

/**
 * Which agents the person making THIS request may see.
 *
 * null means every agent — owners, admins, and anyone below them who has not
 * been given a scope. A list means exactly those slugs and nothing else.
 *
 * Server-side only, and deliberately one call: every admin surface that lists
 * agents, conversations or events asks this and narrows what it reads, so a
 * scope cannot be defeated by finding a page that forgot to ask.
 */
export async function currentScope(): Promise<string[] | null> {
  // Outside a request — a script, a background job — there is no cookie store
  // and nobody to scope. Reading it throws there, so ask carefully.
  let token: string | undefined;
  try {
    token = (await cookies()).get("dlg_admin")?.value;
  } catch {
    return null;
  }
  return scopeOf(await verifySession(token));
}

/** Narrow a list of agents to the scope, leaving it alone when there is none. */
export function withinScope<T extends { slug: string }>(list: T[], scope: string[] | null): T[] {
  return scope ? list.filter((a) => scope.includes(a.slug)) : list;
}

/**
 * Resolve the `?agent=` parameter against what the caller may see.
 *
 * A scoped account gets no "all agents" view: aggregating across agents would
 * aggregate across ones they cannot see, so the first agent they CAN see is
 * selected instead. A slug outside the scope resolves the same way rather than
 * falling back to everything.
 */
export function selectAgent<T extends { slug: string }>(
  list: T[],
  param: string | undefined,
  scope: string[] | null
): T | undefined {
  const chosen = param ? list.find((a) => a.slug === param) : undefined;
  if (chosen) return chosen;
  return scope ? list[0] : undefined;
}

/**
 * Guard for an admin route handler that acts on one agent: returns a 404
 * response when the caller's scope does not include it, and null when it does.
 * 404 rather than 403 — an agent they may not see should not be confirmed to
 * exist by the shape of the error.
 */
export async function denyAgent(slug: string): Promise<Response | null> {
  const scope = await currentScope();
  if (scope && !scope.includes(slug)) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
