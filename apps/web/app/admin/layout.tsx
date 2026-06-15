"use client";

import "../admin-tw.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, MessagesSquare, Activity, Sparkles, ArrowUpRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/admin/agents", label: "Agents", icon: MessagesSquare, exact: false },
  { href: "/admin/activity", label: "Activity", icon: Activity, exact: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <div className="tw min-h-dvh bg-bg">{children}</div>;
  const on = (h: string, exact: boolean) => (exact ? pathname === h : pathname === h || pathname.startsWith(h + "/"));

  return (
    <div className="tw flex min-h-dvh bg-bg [background-image:radial-gradient(110%_70%_at_100%_-5%,rgba(19,48,240,.06),transparent_55%),radial-gradient(90%_60%_at_-5%_100%,rgba(19,48,240,.045),transparent_50%)]">
      <aside className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r border-[var(--color-line)] bg-white/80 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-2 pb-5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[linear-gradient(140deg,var(--color-brand-2),var(--color-brand))] text-white shadow-[0_8px_22px_-6px_rgba(19,48,240,.6)]">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[16px] font-extrabold tracking-tight">Dialog</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Console</span>
          </span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const I = n.icon;
            const active = on(n.href, n.exact);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-brand)_13%,white),color-mix(in_srgb,var(--color-brand)_5%,white))] text-[var(--color-brand)]"
                    : "text-muted hover:bg-bg hover:text-ink"
                )}
              >
                {active && <span className="absolute -left-4 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,var(--color-brand-2),var(--color-brand))] shadow-[0_0_10px_rgba(19,48,240,.6)]" />}
                <I className="h-[18px] w-[18px]" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-line)] pt-3">
          <a className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-muted hover:bg-bg hover:text-ink" href="/" target="_blank" rel="noreferrer"><ArrowUpRight className="h-4 w-4" /> View site</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-muted hover:bg-bg hover:text-ink" href="/api/admin/logout"><LogOut className="h-4 w-4" /> Sign out</a>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8 max-w-[1240px]">{children}</main>
    </div>
  );
}
