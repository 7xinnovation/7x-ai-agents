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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
