import { renderHandover } from "../ai/handover";
import { registerAdapter } from "./registry";
import type { AdapterContext, CRMAdapter } from "./types";

/**
 * Salesforce CRM adapter (PRD: Salesforce is the system of record for cases,
 * callbacks, status tracking). Credential-activated — bind an agent's crm
 * integration to provider "salesforce" with:
 *   settings: { instanceUrl, apiVersion?, caseOrigin? }
 *   secretRefs: [SF_ACCESS_TOKEN]  (or SF_CLIENT_ID/SF_CLIENT_SECRET/SF_USERNAME/SF_PASSWORD for the OAuth flows)
 * Falls back to clear errors when not configured, so misconfig never silently
 * fabricates a reference.
 */

interface SfConfig {
  instanceUrl: string;
  apiVersion: string;
  caseOrigin: string;
  token: string;
}

async function resolveConfig(ctx: AdapterContext): Promise<SfConfig> {
  const instanceUrl = (ctx.settings.instanceUrl as string) || ctx.secrets.SF_INSTANCE_URL || "";
  const apiVersion = (ctx.settings.apiVersion as string) || "v59.0";
  const caseOrigin = (ctx.settings.caseOrigin as string) || "Dialog";
  if (!instanceUrl) throw new Error("Salesforce instanceUrl not configured");

  // Prefer a pre-provisioned access token; otherwise run the OAuth2 flow.
  let token = ctx.secrets.SF_ACCESS_TOKEN ?? "";
  if (!token) {
    const id = ctx.secrets.SF_CLIENT_ID, secret = ctx.secrets.SF_CLIENT_SECRET;
    const user = ctx.secrets.SF_USERNAME, pass = ctx.secrets.SF_PASSWORD;
    if (!id || !secret) throw new Error("Salesforce credentials not configured");
    const body = new URLSearchParams(
      user && pass
        ? { grant_type: "password", client_id: id, client_secret: secret, username: user, password: pass }
        : { grant_type: "client_credentials", client_id: id, client_secret: secret }
    );
    const loginHost = (ctx.settings.loginUrl as string) || instanceUrl;
    const res = await fetch(`${loginHost}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Salesforce auth failed: ${res.status}`);
    token = ((await res.json()) as { access_token: string }).access_token;
  }
  return { instanceUrl, apiVersion, caseOrigin, token };
}

async function sf<T = unknown>(cfg: SfConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cfg.instanceUrl}/services/data/${cfg.apiVersion}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Salesforce ${path} -> ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  return (await res.json()) as T;
}

const escapeSoql = (s: string) => s.replace(/'/g, "\\'");

export const salesforceCrm: CRMAdapter = {
  async createCase(ctx, input) {
    const cfg = await resolveConfig(ctx);
    const out = await sf<{ id: string }>(cfg, "/sobjects/Case", {
      method: "POST",
      body: JSON.stringify({
        Subject: `${input.journeyKey} request`,
        Description: JSON.stringify(input.data).slice(0, 30000),
        Origin: cfg.caseOrigin,
        ...(input.userRef ? { SuppliedName: input.userRef } : {}),
      }),
    });
    return { reference: out.id };
  },
  async getStatus(ctx, input) {
    const cfg = await resolveConfig(ctx);
    const where = input.reference ? `Id='${escapeSoql(input.reference)}'` : `SuppliedName='${escapeSoql(input.userRef)}'`;
    const q = encodeURIComponent(`SELECT Id, Status, Subject FROM Case WHERE ${where} ORDER BY CreatedDate DESC LIMIT 1`);
    const out = await sf<{ records: { Status: string; Subject: string }[] }>(cfg, `/query?q=${q}`);
    const rec = out.records[0];
    if (!rec) return null;
    return { status: rec.Status ?? "Unknown", missing: [], nextSteps: [] };
  },
  async createCallback(ctx, input) {
    const cfg = await resolveConfig(ctx);
    const out = await sf<{ id: string }>(cfg, "/sobjects/Case", {
      method: "POST",
      body: JSON.stringify({
        Subject: "Callback request",
        // The officer opens the case, not our console: the journey context goes
        // in the description under the customer's own words. See handoverContext.
        Description: input.context
          ? `${input.reason}\n\n--- Context from the assistant ---\n${renderHandover(input.context)}`
          : input.reason,
        Origin: cfg.caseOrigin,
        SuppliedName: input.name,
        SuppliedPhone: input.phone,
        SuppliedEmail: input.email ?? "",
        Priority: "High",
      }),
    });
    return { reference: out.id };
  },
  async findDuplicate(ctx, input) {
    const cfg = await resolveConfig(ctx);
    const q = encodeURIComponent(
      `SELECT Id FROM Case WHERE Subject='${escapeSoql(input.journeyKey)} request' AND IsClosed=false ORDER BY CreatedDate DESC LIMIT 1`
    );
    const out = await sf<{ records: { Id: string }[] }>(cfg, `/query?q=${q}`);
    return out.records[0] ? { reference: out.records[0].Id } : null;
  },
  async getRecord(ctx, input) {
    const cfg = await resolveConfig(ctx);
    if (!input.userRef) return null;
    const q = encodeURIComponent(`SELECT Id, AccountId, Account.Name FROM Contact WHERE Id='${escapeSoql(input.userRef)}' LIMIT 1`);
    try {
      const out = await sf<{ records: Record<string, unknown>[] }>(cfg, `/query?q=${q}`);
      return out.records[0] ?? null;
    } catch {
      return null;
    }
  },
};

export function registerSalesforceAdapter() {
  registerAdapter("crm", "salesforce", () => salesforceCrm);
}
