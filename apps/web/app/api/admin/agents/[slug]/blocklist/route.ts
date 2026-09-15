import { NextRequest, NextResponse } from "next/server";
import { denyAgent } from "@/lib/scope";
import { getAgentBySlug } from "@/lib/agents";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { blocklistSummary, clearBlocklist, replaceBlocklist } from "@/lib/blocklist";
import { audit } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/** A list of companies, not a data warehouse. */
const MAX_MB = 10;

/** Who replaced the list — the audit row is the only record of that. */
async function whoIsUploading(): Promise<string | undefined> {
  try {
    const claims = await verifySession((await cookies()).get("dlg_admin")?.value);
    return claims?.email ?? undefined;
  } catch {
    return undefined;
  }
}

/** The list as it stands, and where it came from. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(await blocklistSummary(agent.id));
}

/**
 * Replace the list from an uploaded CSV or XLSX.
 *
 * Replace, never merge — see replaceBlocklist. A company Licensing has REMOVED
 * from the list must stop being blocked the moment the new file is uploaded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* not multipart */
  }
  if (!file) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  if (file.size > MAX_MB * 1024 * 1024)
    return NextResponse.json({ error: `That file is larger than ${MAX_MB} MB.` }, { status: 400 });
  if (!/\.(csv|xlsx|xls|txt)$/i.test(file.name))
    return NextResponse.json({ error: "Upload a .csv or .xlsx file." }, { status: 400 });

  const by = await whoIsUploading();
  try {
    const result = await replaceBlocklist(
      agent.id,
      file.name,
      Buffer.from(await file.arrayBuffer()),
      by
    );
    await audit({
      agentId: agent.id,
      actor: "system",
      action: "blocklist_replaced",
      payload: { fileName: result.fileName, rows: result.rowCount, skipped: result.skippedCount, by },
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (e) {
    log.error("blocklist_upload_failed", e, { agentId: agent.id, fileName: file.name });
    // The message is written for the person holding the file.
    return NextResponse.json({ error: (e as Error).message || "That file could not be read." }, { status: 400 });
  }
}

/** Remove the list. After this nobody is blocked. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const by = await whoIsUploading();
  await clearBlocklist(agent.id);
  await audit({ agentId: agent.id, actor: "system", action: "blocklist_cleared", payload: { by } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
