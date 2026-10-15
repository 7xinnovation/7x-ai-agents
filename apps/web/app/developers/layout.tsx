import type { Metadata } from "next";
import Link from "next/link";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "../admin-tw.css";
import "./developers.css";
import { DevHeader } from "@/components/developers/DevHeader";

const sans = Inter({ subsets: ["latin"], variable: "--font-dev-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dev-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dialog Developers | 7X", template: "%s | Dialog Developers" },
  description: "Credentials, documentation, a console and the request log for organisations integrating with Dialog agents over A2A.",
};

/**
 * The developer portal's shell. Public pages (the overview, the docs) and the
 * signed-in ones (applications, console, activity) share it; each page decides
 * for itself whether a session is needed.
 */
export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${sans.variable} ${mono.variable} tw dev`}>
      <DevHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-[var(--color-line)] bg-white">
        <div className="mx-auto grid max-w-[1200px] gap-4 px-4 py-6 text-[12.5px] text-muted sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
          <div>
            <p className="font-medium text-ink-2">7X Innovation Studio</p>
            <p>Emirates Post Group Company PJSC</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/developers/docs" className="hover:text-ink">
              Documentation
            </Link>
            <a href="/.well-known/agent-card.json" className="hover:text-ink">
              Agent Card
            </a>
            <Link href="/developers/docs#limits" className="hover:text-ink">
              Sandbox terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
