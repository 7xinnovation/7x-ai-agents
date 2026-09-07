import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { listUsers, createUser, updateUser, getUserByEmail, scopeApplies, inviteUser, INVITE_TTL_MS } from "@/lib/users";
import { verifySession } from "@/lib/session";
import { sendInviteEmail } from "@/lib/inviteEmail";
import { emailConfigured } from "@/lib/email";
import { getDb, agents } from "@dialog/db";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";

// Access is gated to admin+ by middleware (path-based RBAC).

export async function GET() {
  return NextResponse.json({ users: await listUsers() });
}

/** Agent SLUGS this account may see. Empty (or absent) means all of them. */
const AgentScope = z.array(z.string().min(1).max(64)).max(50).optional();

const CreateBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  // Optional, because an invited account has no password until its owner
  // chooses one. Exactly one of `password` or `invite` decides which it is.
  password: z.string().min(6).optional(),
  invite: z.boolean().optional(),
  role: z.enum(["owner", "admin", "editor", "viewer"]).default("viewer"),
  agentScope: AgentScope,
});

/** Where the invitation link points. */
function consoleOrigin(req: NextRequest): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DIALOG_HOST;
  return (configured || req.nextUrl.origin).replace(/\/$/, "");
}

/** The agent NAMES behind a scope, so the email reads as a person would say it. */
async function agentNames(scope: string[]): Promise<string[]> {
  if (!scope.length) return [];
  const rows = await getDb().select({ slug: agents.slug, name: agents.name }).from(agents).where(inArray(agents.slug, scope));
  return scope.map((s) => rows.find((r) => r.slug === s)?.name ?? s);
}

/** Open an invitation and send it. The account exists either way. */
async function invite(req: NextRequest, user: { id: string; email: string; name: string; role: string; agentScope?: string[] | null }) {
  const claims = await verifySession((await cookies()).get("dlg_admin")?.value);
  const token = await inviteUser(user.id, claims?.email ?? null);
  const link = `${consoleOrigin(req)}/admin/invite/${token}`;
  const result = await sendInviteEmail({
    to: user.email,
    name: user.name,
    link,
    role: user.role === "viewer" ? "viewer (read-only)" : user.role,
    agents: await agentNames(user.agentScope ?? []),
    invitedBy: claims?.email ?? null,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  // The link is returned ONLY when no mail provider is configured, so a console
  // with no email set up is still usable and an admin can pass the link on
  // themselves. With email working it never leaves the server.
  return { sent: result.ok, reason: result.reason, link: emailConfigured() ? undefined : link };
}

export async function POST(req: NextRequest) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (await getUserByEmail(parsed.data.email)) return NextResponse.json({ error: "email_exists" }, { status: 409 });
  const data = parsed.data;
  if (!data.invite && !data.password) return NextResponse.json({ error: "password_or_invite_required" }, { status: 400 });
  if (!scopeApplies(data.role)) data.agentScope = [];
  const u = await createUser({ ...data, password: data.invite ? undefined : data.password });
  if (!data.invite) return NextResponse.json({ id: u.id, email: u.email, role: u.role });
  const sent = await invite(req, { ...u, agentScope: data.agentScope });
  return NextResponse.json({ id: u.id, email: u.email, role: u.role, ...sent });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  /** Send (or re-send) this account's invitation. */
  invite: z.boolean().optional(),
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  active: z.boolean().optional(),
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  agentScope: AgentScope,
});

export async function PATCH(req: NextRequest) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, invite: resend, ...patch } = parsed.data;
  // A scope on an owner or admin would be theatre: they can lift it themselves.
  // Clear it rather than storing a restriction that does not restrict.
  if (patch.role && !scopeApplies(patch.role)) patch.agentScope = [];
  await updateUser(id, patch);
  if (!resend) return NextResponse.json({ ok: true });
  const user = (await listUsers()).find((u) => u.id === id);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...(await invite(req, user)) });
}
