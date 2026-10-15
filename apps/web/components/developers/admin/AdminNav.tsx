"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/developers/admin", label: "Overview", exact: true },
  { href: "/developers/admin/accounts", label: "Accounts", exact: false },
  { href: "/developers/admin/applications", label: "Applications", exact: false },
  { href: "/developers/admin/logs", label: "Logs", exact: false },
  { href: "/developers/admin/settings", label: "Settings", exact: false },
];

/** The admin pages' own tabs, under the page title; the current one carries the 2px blue rule. */
export function AdminNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Administration" className="mt-6 overflow-x-auto border-b border-[var(--color-line)]">
      <ul className="flex min-w-max gap-6">
        {ITEMS.map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                  active ? "border-[#1330f0] font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                )}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Title, one line under it, optional actions on the right, then the admin tabs. */
export function AdminHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold text-ink">{title}</h1>
          <p className="mt-1 max-w-[70ch] text-[14px] text-muted">{subtitle}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <AdminNav />
    </div>
  );
}
