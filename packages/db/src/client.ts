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
  const pool = new Pool({ connectionString });
  _db = drizzle(pool, { schema });
  return _db;
}

export { schema };
export type Db = ReturnType<typeof getDb>;
