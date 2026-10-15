"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const PUBLIC = [
  { href: "/developers", label: "Overview", exact: true },
  { href: "/developers/docs", label: "Documentation", exact: false },
];
const PRIVATE = [
  { href: "/developers/apps", label: "Applications", exact: false },
  { href: "/developers/console", label: "Console", exact: false },
  { href: "/developers/activity", label: "Activity", exact: false },
];

/** Tabs on the product bar; the current one carries a 2px blue rule, like the printed brief. */
export function DevNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "";
  const items = signedIn ? [...PUBLIC, ...PRIVATE] : PUBLIC;
  return (
    <nav className="hidden h-full items-stretch gap-6 md:flex" aria-label="Portal">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center border-b-2 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              active ? "border-[#1330f0] font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
