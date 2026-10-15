/**
 * OAuth 2.0 token endpoint, client-credentials grant (RFC 6749 §4.4).
 *
 *   POST /a2a/oauth/token
 *   Authorization: Basic base64(client_id:client_secret)      — or the two in the body
 *   Content-Type: application/x-www-form-urlencoded            — or application/json
 *   grant_type=client_credentials&scope=tasks
 *
 * Answers { access_token, token_type: "Bearer", expires_in, scope } or an
 * RFC 6749 §5.2 error. The token is what the Agent Card's oauth2 scheme asks for.
 */
import { issueAccessToken } from "@/lib/a2a/auth";
import { recordRequest } from "@/lib/a2a/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", pragma: "no-cache", ...extra } });

export async function POST(req: Request) {
  const start = Date.now();
  let clientId = "";
  let clientSecret = "";
  let grantType = "";
  let scope: string | undefined;

  const basic = /^basic\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (basic) {
    try {
      const [id, ...rest] = Buffer.from(basic, "base64").toString("utf8").split(":");
      clientId = decodeURIComponent(id ?? "");
      clientSecret = decodeURIComponent(rest.join(":"));
    } catch {
      /* fall through to the body */
    }
  }
  const type = req.headers.get("content-type") ?? "";
  try {
    if (/application\/json/i.test(type)) {
      const body = (await req.json()) as Record<string, unknown>;
      grantType = String(body.grant_type ?? "");
      clientId ||= String(body.client_id ?? "");
      clientSecret ||= String(body.client_secret ?? "");
      if (typeof body.scope === "string") scope = body.scope;
    } else {
      const form = new URLSearchParams(await req.text());
      grantType = form.get("grant_type") ?? "";
      clientId ||= form.get("client_id") ?? "";
      clientSecret ||= form.get("client_secret") ?? "";
      scope = form.get("scope") ?? undefined;
    }
  } catch {
    recordRequest(start, { method: "token", binding: "oauth", ok: false, httpStatus: 400 });
    return json({ error: "invalid_request", error_description: "The body could not be read." }, 400);
  }

  if (grantType !== "client_credentials") {
    recordRequest(start, { method: "token", binding: "oauth", ok: false, httpStatus: 400 });
    return json({ error: "unsupported_grant_type", error_description: "Only client_credentials is supported." }, 400);
  }
  const result = await issueAccessToken(clientId.trim(), clientSecret.trim(), scope);
  if ("error" in result) {
    const status = result.error === "invalid_client" ? 401 : 400;
    recordRequest(start, { method: "token", binding: "oauth", ok: false, httpStatus: status });
    return json(result, status, status === 401 ? { "www-authenticate": 'Basic realm="a2a"' } : {});
  }
  const { appId, ...tokenResponse } = result;
  recordRequest(start, { appId, method: "token", binding: "oauth", ok: true, httpStatus: 200 });
  return json(tokenResponse, 200);
}
