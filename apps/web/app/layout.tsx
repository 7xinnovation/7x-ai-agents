import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dialog Platform",
  description: "Multi-tenant conversational AI platform with embeddable agents and a realtime case builder.",
};

// Ensures the embed lays out at its true width (iframe / mobile), so responsive
// rules like the narrow-header collapse actually apply.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * Without this, env(safe-area-inset-*) is always 0. Android's edge-to-edge
   * WebView runs under the system navigation bar, and the composer sat behind
   * it — "the input field is cropped on Android" (12 November). The insets are
   * then honoured where they matter (the composer), and are 0 wherever the
   * page does not reach under anything.
   */
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
