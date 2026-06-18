"use client";

import "../admin-tw.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Space_Grotesk } from "next/font/google";
import { LayoutGrid, MessagesSquare, Inbox, Activity, BarChart3, Users, Search, ArrowUpRight, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-grotesk", display: "swap" });

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/admin/agents", label: "Agents", icon: MessagesSquare, exact: false },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox, exact: false },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, exact: false },
  { href: "/admin/activity", label: "Activity", icon: Activity, exact: true },
  { href: "/admin/users", label: "Users", icon: Users, exact: false },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  // Persist the collapsed preference so it survives navigation/reloads.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("dlg-nav-collapsed") === "1");
    setReady(true);
  }, []);
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("dlg-nav-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (pathname === "/admin/login") return <div className={cn(grotesk.variable, "tw min-h-dvh bg-[var(--color-canvas)]")}>{children}</div>;
  const on = (h: string, exact: boolean) => (exact ? pathname === h : pathname === h || pathname.startsWith(h + "/"));

  return (
    <div className={cn(grotesk.variable, "tw flex min-h-dvh gap-0 bg-[var(--color-canvas)] text-ink")}>
      {/* Floating, collapsible sidebar — detached card that hovers within the canvas. */}
      <aside
        className={cn(
          "sticky top-0 z-20 flex h-dvh shrink-0 flex-col p-3 transition-[width] duration-300 ease-out",
          collapsed ? "w-[84px]" : "w-[270px]",
          !ready && "duration-0"
        )}
      >
        <div className="flex h-full flex-col rounded-2xl border border-[var(--color-line)] bg-surface px-3 py-4 shadow-[var(--shadow-md)]">
          <div className={cn("flex items-center gap-2.5", collapsed ? "justify-center px-0" : "px-1")}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#0020f5]">
              <img src="/7xlogo.svg" alt="7X" className="h-[15px] w-auto" />
            </span>
            {!collapsed && <span className="text-[16px] font-bold tracking-tight">Dialog</span>}
            {!collapsed && (
              <button
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink"
              >
                <PanelLeftClose className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>

          {collapsed ? (
            <button
              onClick={toggle}
              aria-label="Expand sidebar"
              title="Expand"
              className="mt-4 grid h-10 w-full place-items-center rounded-lg border border-[var(--color-line)] bg-surface text-muted shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            </button>
          ) : (
            <div className="mt-5 flex h-10 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-3 text-muted shadow-[var(--shadow-xs)]">
              <Search className="h-4 w-4 shrink-0" />
              <span className="text-sm">Search</span>
              <kbd className="ml-auto rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">⌘K</kbd>
            </div>
          )}

          <nav className="mt-5 flex flex-col gap-0.5">
            {NAV.map((n) => {
              const I = n.icon;
              const active = on(n.href, n.exact);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  title={collapsed ? n.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg py-2 text-[14px] font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "px-3",
                    active ? "bg-[var(--color-line-soft)] text-ink" : "text-ink-2 hover:bg-[var(--color-line-soft)]"
                  )}
                >
                  <I className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[var(--color-brand)]" : "text-muted")} />
                  {!collapsed && n.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-line)] pt-3">
            <a
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium text-muted transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink",
                collapsed ? "justify-center px-0" : "px-3"
              )}
              href="/"
              target="_blank"
              rel="noreferrer"
              title={collapsed ? "View site" : undefined}
            >
              <ArrowUpRight className="h-4 w-4 shrink-0" />
              {!collapsed && "View site"}
            </a>
            <div className={cn("mt-1 flex items-center gap-3 rounded-lg py-2", collapsed ? "justify-center px-0" : "px-2")}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#2b46ff,#0020f5)] text-[13px] font-bold text-white">A</span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">Admin</span>
                    <span className="block truncate text-[12px] text-muted">7X Console</span>
                  </span>
                  <a href="/api/admin/logout" aria-label="Sign out" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-ink">
                    <LogOut className="h-4 w-4" />
                  </a>
                </>
              )}
            </div>
            {collapsed && (
              <a href="/api/admin/logout" aria-label="Sign out" title="Sign out" className="grid h-9 w-full place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-ink">
                <LogOut className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-10 py-8 max-w-[1280px]">{children}</main>
    </div>
  );
}
