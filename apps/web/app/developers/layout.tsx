import type { Metadata } from "next";
import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import "../admin-tw.css";
import "./developers.css";
import { DevHeader } from "@/components/developers/DevHeader";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dialog Developers · 7X", template: "%s · Dialog Developers" },
  description: "The A2A task doorway to Dialog agents: credentials, documentation, a console and the request log for integrating organisations.",
};

/**
 * The developer portal's shell. Public pages (the overview, the docs) and the
 * signed-in ones (applications, console, activity) share it; each page decides
 * for itself whether a session is needed.
 */
export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${grotesk.variable} tw dev`}>
      <DevHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-[var(--color-line)] bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-5 text-[12.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>7X Innovation Studio · Emirates Post Group Company PJSC</span>
          <span className="flex items-center gap-4">
            <Link href="/developers/docs" className="hover:text-ink">
              Documentation
            </Link>
            <a href="/.well-known/agent-card.json" className="hover:text-ink">
              Agent Card
            </a>
            <span>A2A protocol 1.0 · sandbox</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
