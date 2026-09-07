import { lookup } from "node:dns/promises";

/**
 * Is this URL safe for the SERVER to fetch on someone's behalf?
 *
 * An admin pasting an OpenAPI URL makes this server issue a request to it. A
 * URL is not only a place on the internet: 127.0.0.1, 10.x, and above all
 * 169.254.169.254 — the cloud metadata endpoint, which on a misconfigured host
 * hands out credentials — are all reachable from inside and from nowhere else.
 * That is server-side request forgery, and the fix is to decide what may be
 * reached before reaching it.
 *
 * The name is RESOLVED before the verdict, because "internal.example.com" can
 * point at 127.0.0.1 and a check on the string alone would never know.
 */

/** Reserved ranges nothing outward-facing should ever be asked to fetch. */
function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, and the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 192 && b === 0) || // IETF protocol assignments
    a === 198 || // benchmarking + reserved documentation ranges
    (a === 203 && b === 0) || // documentation
    a >= 224 // multicast and reserved
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local, unique-local
  // IPv4 written as IPv6, which is how a loopback slips past a v6-only check.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? isPrivateV4(mapped[1]!) : false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateV6(ip) : isPrivateV4(ip);
}

export interface OutboundVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Check a URL the server is about to fetch on a user's instruction.
 *
 * `allowPrivate` exists for local development, where the spec being imported
 * genuinely is on localhost. It is off unless DIALOG_ALLOW_PRIVATE_FETCH is set,
 * so it cannot be switched on by anything arriving in a request.
 */
export async function checkOutboundUrl(raw: string): Promise<OutboundVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http and https URLs can be fetched." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "A URL with credentials in it cannot be fetched." };
  }
  const allowPrivate = process.env.DIALOG_ALLOW_PRIVATE_FETCH === "1";
  if (allowPrivate) return { ok: true };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal address needs no lookup, and must not get one: resolving it would
  // only give it back.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return isPrivateAddress(host) ? { ok: false, reason: "That address is on a private network." } : { ok: true };
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "That address is on a private network." };
  }
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return { ok: false, reason: "That host could not be resolved." };
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      return { ok: false, reason: "That host resolves to a private network address." };
    }
  } catch {
    return { ok: false, reason: "That host could not be resolved." };
  }
  return { ok: true };
}

/** fetch(), refusing anything checkOutboundUrl rejects. */
export async function safeFetch(raw: string, init?: RequestInit): Promise<Response> {
  const verdict = await checkOutboundUrl(raw);
  if (!verdict.ok) throw new Error(verdict.reason ?? "That URL cannot be fetched.");
  // Redirects are followed by fetch itself, and a redirect is a second URL that
  // nobody checked — so they are handled here, one hop at a time.
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    const next = new URL(location, url).toString();
    const ok = await checkOutboundUrl(next);
    if (!ok.ok) throw new Error(`That URL redirects somewhere that cannot be fetched: ${ok.reason}`);
    url = next;
  }
  throw new Error("That URL redirects too many times.");
}
