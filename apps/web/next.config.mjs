import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load secrets from the repo-root .env so all workspaces share one file.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspaces are consumed as TS source; let Next transpile them.
  transpilePackages: ["@dialog/config", "@dialog/core", "@dialog/db"],
  // The embed app is loaded inside a cross-origin iframe on customer sites.
  // Per-agent frame-ancestors are set in middleware from each agent's
  // allowedOrigins; the loader is served cross-origin.
  async headers() {
    return [
      {
        source: "/dialog.js",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
