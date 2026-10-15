/**
 * A pg pool for a script, with the Azure Postgres hostname pinned to an address.
 *
 * This Mac resolves the Azure hosts unreliably; the scripts that run against
 * staging and production resolve them through public DNS first and keep the
 * hostname only for TLS. A Neon URL is used as it is.
 */
import dns from "node:dns/promises";
import pg from "pg";

export async function poolFor(url: string): Promise<pg.Pool> {
  const u = new URL(url);
  if (/neon\.tech$/i.test(u.hostname)) return new pg.Pool({ connectionString: url });
  let host = u.hostname;
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
    host = (await dns.resolve4(u.hostname))[0] ?? host;
  } catch {
    /* keep the hostname */
  }
  return new pg.Pool({
    host,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { servername: u.hostname, rejectUnauthorized: false },
  });
}
