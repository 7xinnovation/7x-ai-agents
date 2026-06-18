import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listUsers, createUser, updateUser, getUserByEmail } from "@/lib/users";

export const runtime = "nodejs";

// Access is gated to admin+ by middleware (path-based RBAC).

export async function GET() {
  return NextResponse.json({ users: await listUsers() });
}

const CreateBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(["owner", "admin", "editor", "viewer"]).default("viewer"),
});

export async function POST(req: NextRequest) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (await getUserByEmail(parsed.data.email)) return NextResponse.json({ error: "email_exists" }, { status: 409 });
  const u = await createUser(parsed.data);
  return NextResponse.json({ id: u.id, email: u.email, role: u.role });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  active: z.boolean().optional(),
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
});

export async function PATCH(req: NextRequest) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, ...patch } = parsed.data;
  await updateUser(id, patch);
  return NextResponse.json({ ok: true });
}
