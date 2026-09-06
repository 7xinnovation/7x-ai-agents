import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listUsers, createUser, updateUser, getUserByEmail, scopeApplies } from "@/lib/users";

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
  password: z.string().min(6),
  role: z.enum(["owner", "admin", "editor", "viewer"]).default("viewer"),
  agentScope: AgentScope,
});

export async function POST(req: NextRequest) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (await getUserByEmail(parsed.data.email)) return NextResponse.json({ error: "email_exists" }, { status: 409 });
  const data = parsed.data;
  if (!scopeApplies(data.role)) data.agentScope = [];
  const u = await createUser(data);
  return NextResponse.json({ id: u.id, email: u.email, role: u.role });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  active: z.boolean().optional(),
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  agentScope: AgentScope,
});

export async function PATCH(req: NextRequest) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, ...patch } = parsed.data;
  // A scope on an owner or admin would be theatre: they can lift it themselves.
  // Clear it rather than storing a restriction that does not restrict.
  if (patch.role && !scopeApplies(patch.role)) patch.agentScope = [];
  await updateUser(id, patch);
  return NextResponse.json({ ok: true });
}
