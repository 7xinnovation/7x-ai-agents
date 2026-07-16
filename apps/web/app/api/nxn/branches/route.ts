import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";
import { listIntegrations } from "@/lib/integrations";
import { decryptSecret, isEncrypted } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Branch list for the in-chat "Browse nearby branches" map. Proxies the real
 * Emirates Post `Rental/BoxLocations` endpoint (with the app's X-API-KEY) so the
 * map is fed accurate coordinates instead of ones the model transcribes, and
 * returns the Mapbox public token alongside so the client can render without a
 * build-time env. Query: agentSlug, emirate (AUH/DXB/…), bundle (bundle_Id).
 */
const EMIRATES = new Set(["AUH", "DXB", "SHJ", "AJM", "UAQ", "RAK", "FUJ"]);

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("agentSlug") || "nxn-dialog";
  const emirate = (req.nextUrl.searchParams.get("emirate") || "").toUpperCase();
  const bundle = req.nextUrl.searchParams.get("bundle") || "";
  if (!EMIRATES.has(emirate) || !bundle) {
    return NextResponse.json({ error: "emirate (AUH/DXB/…) and bundle are required" }, { status: 400 });
  }

  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "unknown agent" }, { status: 404 });

  const env = (agent.definition.activeEnvironment as "staging" | "production") ?? "staging";
  const integ = (await listIntegrations(agent.id)).find((i) => i.enabled && (i.environments[env] || i.environments.staging));
  const spec = integ?.environments[env] || integ?.environments.staging;
  if (!spec) return NextResponse.json({ error: "branch service not configured" }, { status: 502 });

  const apiKey = isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey;
  const url = `${spec.baseUrl}/api/Rental/BoxLocations?BundleId=${encodeURIComponent(bundle)}&EmirateCode=${emirate}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {
      headers: { Accept: "application/json", [spec.apiKeyHeader || "X-API-KEY"]: apiKey || "" },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const json = (await r.json().catch(() => ({}))) as { payload?: Record<string, unknown>[] };
    const branches = (json.payload ?? [])
      .map((o) => ({
        id: String(o.officeId ?? ""),
        name: String(o.nameEn ?? "").trim(),
        nameAr: String(o.nameAr ?? "").trim(),
        lat: Number.parseFloat(String(o.gpsLat ?? "")),
        lng: Number.parseFloat(String(o.gpsLong ?? "")),
        hours: String(o.workingTime ?? "").trim(),
        days: String(o.workingDays ?? "").trim(),
      }))
      .filter((b) => b.name && Number.isFinite(b.lat) && Number.isFinite(b.lng));
    return NextResponse.json({ branches, mapboxToken: process.env.MAPBOX_TOKEN || "" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 502 });
  }
}
