import { NextResponse } from "next/server";
import { listConversations } from "@/lib/conversation";

export const runtime = "nodejs";

export async function GET() {
  const items = await listConversations(80);
  return NextResponse.json({ conversations: items });
}
