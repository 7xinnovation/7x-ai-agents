"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SquaresFour,
  ChatsCircle,
  Pulse,
  ArrowSquareOut,
  SignOut,
  Sparkle,
} from "@phosphor-icons/react";

const NAV = [
  { href: "/admin", label: "Overview", icon: SquaresFour, exact: true },
  { href: "/admin/agents", label: "Agents", icon: ChatsCircle, exact: false },
  { href: "/admin/activity", label: "Activity", icon: Pulse, exact: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Login is pre-auth and chrome-free.
  if (pathname === "/admin/login") return <>{children}</>;

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="sa">
      <aside className="sa-side">
        <div className="sa-brand">
          <span className="sa-brand-mark">
            <Sparkle size={18} weight="fill" />
          </span>
          <span className="sa-brand-text">
            Dialog
            <em>Console</em>
          </span>
        </div>

        <nav className="sa-nav">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={`sa-navlink ${isActive(n.href, n.exact) ? "on" : ""}`}>
                <Icon size={18} weight={isActive(n.href, n.exact) ? "fill" : "regular"} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="sa-side-foot">
          <a className="sa-navlink subtle" href="/" target="_blank" rel="noreferrer">
            <ArrowSquareOut size={18} /> View site
          </a>
          <a className="sa-navlink subtle" href="/api/admin/logout">
            <SignOut size={18} /> Sign out
          </a>
        </div>
      </aside>

      <div className="sa-main">{children}</div>
    </div>
  );
}
