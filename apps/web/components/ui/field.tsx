import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-[var(--color-line)] bg-surface px-3.5 text-sm text-ink outline-none transition-shadow placeholder:text-muted focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(base, "h-10", className)} {...p} />
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(base, "py-2.5 resize-y leading-relaxed", className)} {...p} />
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(base, "h-10 cursor-pointer", className)} {...p} />
);
Select.displayName = "Select";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-semibold text-ink", className)} {...p} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Badge({ className, tone = "muted", ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "live" | "draft" | "brand" }) {
  const tones: Record<string, string> = {
    muted: "text-muted border-[var(--color-line)] bg-bg",
    live: "text-emerald-700 border-emerald-200 bg-emerald-50",
    draft: "text-amber-700 border-amber-200 bg-amber-50",
    brand: "text-[var(--color-brand)] border-[var(--color-ring)] bg-[color-mix(in_srgb,var(--color-brand)_8%,white)]",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize", tones[tone], className)} {...p} />;
}
