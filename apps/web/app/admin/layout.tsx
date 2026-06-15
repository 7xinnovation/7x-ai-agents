"use client";

import "../admin-tw.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Space_Grotesk } from "next/font/google";
import { LayoutGrid, MessagesSquare, Activity, Search, ArrowUpRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-grotesk", display: "swap" });

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/admin/agents", label: "Agents", icon: MessagesSquare, exact: false },
  { href: "/admin/activity", label: "Activity", icon: Activity, exact: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <div className={cn(grotesk.variable, "tw min-h-dvh bg-[var(--color-canvas)]")}>{children}</div>;
  const on = (h: string, exact: boolean) => (exact ? pathname === h : pathname === h || pathname.startsWith(h + "/"));

  return (
    <div className={cn(grotesk.variable, "tw flex min-h-dvh bg-[var(--color-canvas)] text-ink")}>
      <aside className="sticky top-0 flex h-dvh w-[262px] shrink-0 flex-col border-r border-[var(--color-line)] bg-surface px-4 py-5">
        <div className="flex items-center gap-2.5 px-1">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#0020f5]">
            <img src="/7xlogo.svg" alt="7X" className="h-[15px] w-auto" />
          </span>
          <span className="text-[16px] font-bold tracking-tight">Dialog</span>
        </div>

        <div className="mt-5 flex h-10 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-3 text-muted shadow-[var(--shadow-xs)]">
          <Search className="h-4 w-4" />
          <span className="text-sm">Search</span>
          <kbd className="ml-auto rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">⌘K</kbd>
        </div>

        <nav className="mt-5 flex flex-col gap-0.5">
          {NAV.map((n) => {
            const I = n.icon;
            const active = on(n.href, n.exact);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
                  active ? "bg-[var(--color-line-soft)] text-ink" : "text-ink-2 hover:bg-[var(--color-line-soft)]"
                )}
              >
                <I className={cn("h-[18px] w-[18px]", active ? "text-[var(--color-brand)]" : "text-muted")} /> {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-line)] pt-3">
          <a className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted hover:bg-[var(--color-line-soft)] hover:text-ink" href="/" target="_blank" rel="noreferrer">
            <ArrowUpRight className="h-4 w-4" /> View site
          </a>
          <div className="mt-1 flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(140deg,#2b46ff,#0020f5)] text-[13px] font-bold text-white">A</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-ink">Admin</span>
              <span className="block truncate text-[12px] text-muted">7X Console</span>
            </span>
            <a href="/api/admin/logout" aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-ink">
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-10 py-8 max-w-[1280px]">{children}</main>
    </div>
  );
}
