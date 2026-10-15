"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/developers/logout", { method: "POST" });
        } finally {
          window.location.assign("/developers");
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink disabled:opacity-50"
    >
      <LogOut size={14} strokeWidth={2} />
      Sign out
    </button>
  );
}
