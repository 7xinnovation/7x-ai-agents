import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-[#d0d5dd] bg-surface px-3.5 text-sm text-ink shadow-[var(--shadow-xs)] outline-none transition-shadow placeholder:text-muted focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)]";

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
  return <label className={cn("text-[13px] font-medium text-ink-2", className)} {...p} />;
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

const TONES: Record<string, { wrap: string; dot: string }> = {
  muted: { wrap: "text-ink-2 border-[var(--color-line)] bg-[var(--color-canvas)]", dot: "bg-[#98a2b3]" },
  live: { wrap: "text-[#067647] border-[#abefc6] bg-[#ecfdf3]", dot: "bg-[#17b26a]" },
  draft: { wrap: "text-[#b54708] border-[#fedf89] bg-[#fffaeb]", dot: "bg-[#f79009]" },
  brand: { wrap: "text-[var(--color-brand)] border-[var(--color-ring)] bg-[color-mix(in_srgb,var(--color-brand)_7%,white)]", dot: "bg-[var(--color-brand)]" },
};

export function Badge({ className, tone = "muted", dot, children, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES; dot?: boolean }) {
  const t = TONES[tone] ?? TONES.muted!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium capitalize", t.wrap, className)} {...p}>
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}
