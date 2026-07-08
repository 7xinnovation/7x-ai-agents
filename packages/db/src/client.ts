import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema";

// In Node (scripts, server runtime) the WS transport needs a polyfill; in edge
// it's native. Lazily wire it so importing this module never throws in browsers.
declare const WebSocket: unknown;
if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  neonConfig.webSocketConstructor = require("ws");
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (_db) return _db;
  const pool = new Pool({
    connectionString,
    // Prune idle sockets quickly and fail fast on connect: a WebSocket that died
    // while idle (network blip, Neon idle timeout) must not poison later queries.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxUses: 500,
  });
  // Errors on IDLE pooled clients surface here (not on any query). Without a
  // handler they become unhandled ErrorEvents that crash the request/process;
  // logging + letting the pool discard the client lets the next query reconnect.
  pool.on("error", (err) => {
    console.warn("[db] idle pool client error (client discarded):", err?.message ?? err);
  });
  _db = drizzle(pool, { schema });
  return _db;
}

export { schema };
export type Db = ReturnType<typeof getDb>;
