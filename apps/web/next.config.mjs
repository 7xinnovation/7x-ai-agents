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
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          // frame-ancestors is enforced per-agent at the route level; allow all here.
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        source: "/dialog.js",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
