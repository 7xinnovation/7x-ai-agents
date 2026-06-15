import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Locale } from "@dialog/config";
import { classifyIntent } from "@dialog/core";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

const Body = z.object({
  agentSlug: z.string(),
  message: z.string().min(1),
  locale: Locale.default("en"),
});

/** Classify a message into one of the agent's intents (used by the eval harness). */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const agent = await getAgentBySlug(parsed.data.agentSlug);
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });

  const result = await classifyIntent(agent.definition, parsed.data.message, parsed.data.locale);
  return NextResponse.json(result);
}
