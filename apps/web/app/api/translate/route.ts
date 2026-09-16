import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, classifierModel, withModelFallback } from "@dialog/core";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Display-only translation of the on-screen transcript when the customer switches
 * language mid-conversation. The team's design keeps forward turns in the new
 * language (see the LANGUAGE CHANGED directive in api/chat); this lets the
 * messages ALREADY on screen follow too, so a switch translates everything.
 *
 * Best-effort: on any failure the caller keeps the original text, so a translation
 * problem can never blank a message or break the card/button flow. The structure
 * is preserved verbatim — fenced ```cards / ```buttons / ```summary / ```toggles
 * blocks keep their fence lines and key names; only human-readable text is
 * translated, and numbers, dates, references, box/licence numbers, emails, URLs
 * and masked values (with asterisks) are left exactly as they are.
 */
export async function POST(req: NextRequest) {
  let texts: string[] = [];
  let to = "en";
  try {
    const body = (await req.json()) as { texts?: unknown; to?: unknown };
    if (Array.isArray(body.texts)) texts = body.texts.filter((t): t is string => typeof t === "string");
    if (body.to === "ar" || body.to === "en") to = body.to;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!texts.length) return NextResponse.json({ texts: [] });
  // Cap the batch so one switch can't fan out into a huge request.
  if (texts.length > 40) texts = texts.slice(0, 40);

  const target = to === "ar" ? "Arabic" : "English";
  const instruction =
    `Translate each message in the JSON array into ${target}, for a UAE postal/government-service chat. ` +
    "Return ONLY a JSON array of the translated strings, same length and order.\n" +
    "Rules:\n" +
    `- Translate all human-readable text (prose, and inside fenced blocks the VALUES after a colon and the button/card/summary labels) into ${target}, in natural, correct phrasing.\n` +
    "- PRESERVE STRUCTURE EXACTLY: keep every fenced block's opening/closing ``` lines and the key names before a colon (title:, price:, desc:, badge:, confirm:, key:, total:, etc.) unchanged — translate only the value after the colon. Keep markdown (**, ###, -, >, tables, links) intact.\n" +
    "- DO NOT translate or alter: numbers, prices, dates, reference numbers, box numbers, licence numbers, emails, phone numbers, URLs, document keys inside ```upload blocks, or masked values that contain asterisks (leave the stars and spacing exactly as-is).\n" +
    "- If a message is already fully in " + target + ", return it unchanged.\n" +
    "- Never add, remove, summarise, or comment — translate 1:1.";

  try {
    const client = getAnthropic();
    const res = await withModelFallback(classifierModel(), (model) => client.messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: `${instruction}\n\nMESSAGES:\n${JSON.stringify(texts)}` }],
    }, { timeout: 15000, maxRetries: 1 }));
    const raw = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end < start) return NextResponse.json({ texts });
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== texts.length) return NextResponse.json({ texts });
    const out = parsed.map((v, i) => (typeof v === "string" && v.trim() ? v : texts[i]));
    return NextResponse.json({ texts: out });
  } catch (e) {
    log.warn?.("translate_failed", { to, count: texts.length, reason: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ texts }); // best-effort: originals on failure
  }
}
