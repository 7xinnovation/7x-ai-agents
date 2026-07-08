import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

// In Node (scripts, server runtime) the WS transport needs a polyfill; in edge
// it's native. Lazily wire it so importing this module never throws in browsers.
declare const WebSocket: unknown;
if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  neonConfig.webSocketConstructor = require("ws");
}

// Both drivers expose the same drizzle query API; type as node-postgres and let
// the Neon instance structurally conform.
export type Db = NodePgDatabase<typeof schema>;

let _db: Db | null = null;

/**
 * Driver-agnostic Postgres client:
 *  - *.neon.tech URLs → Neon serverless driver (their WebSocket proxy protocol).
 *  - anything else (Railway, RDS, local Postgres…) → node-postgres.
 * Pool settings mirror each other: prune idle sockets quickly and fail fast on
 * connect so a connection that died idle can't poison later queries; idle-client
 * errors are logged and the pool discards the client so the next query reconnects.
 */
export function getDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (_db) return _db;

  const poolOpts = {
    connectionString,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
  const onIdleError = (err: unknown) => {
    console.warn("[db] idle pool client error (client discarded):", err instanceof Error ? err.message : err);
  };

  if (/\.neon\.tech[/:]?/.test(connectionString)) {
    const pool = new NeonPool({ ...poolOpts, maxUses: 500 });
    pool.on("error", onIdleError);
    _db = drizzleNeon(pool, { schema }) as unknown as Db;
  } else {
    const pool = new PgPool(poolOpts);
    pool.on("error", onIdleError);
    _db = drizzlePg(pool, { schema });
  }
  return _db;
}

export { schema };
