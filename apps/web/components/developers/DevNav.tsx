"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const PUBLIC = [
  { href: "/developers", label: "Overview", exact: true },
  { href: "/developers/docs", label: "Docs", exact: false },
];
const PRIVATE = [
  { href: "/developers/apps", label: "Applications", exact: false },
  { href: "/developers/console", label: "Console", exact: false },
  { href: "/developers/activity", label: "Activity", exact: false },
];

export function DevNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "";
  const items = signedIn ? [...PUBLIC, ...PRIVATE] : PUBLIC;
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Portal">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors",
              active ? "bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] text-brand" : "text-ink-2 hover:bg-[var(--color-line-soft)] hover:text-ink"
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
