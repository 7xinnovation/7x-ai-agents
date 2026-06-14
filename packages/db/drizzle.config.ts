import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { resolve } from "node:path";

// Load the repo-root .env so DATABASE_URL is available to the CLI.
config({ path: resolve(process.cwd(), "../../.env") });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // pgvector lives in the public schema; let drizzle manage our tables.
  verbose: true,
  strict: true,
});
