/** Class strings shared by the admin pages; plain data, safe on the server and the client. */
import { cn } from "@/lib/utils";

const btnBase =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50";
export const btnPrimary = cn(btnBase, "bg-[#1330f0] text-white hover:bg-[#0f27c4]");
export const btnSecondary = cn(btnBase, "border border-[#c9cfd6] bg-white text-ink hover:border-ink");
export const btnDanger = cn(btnBase, "bg-[#b42318] text-white hover:bg-[#912018]");
/** A text action inside a table row. */
export const linkAction =
  "inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-medium text-[#1330f0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50";
export const inputCls =
  "h-9 w-full rounded-[3px] border border-[#c9cfd6] bg-white px-3 text-[13.5px] text-ink outline-none placeholder:text-muted focus:border-[#1330f0] focus:ring-4 focus:ring-[var(--color-ring)]";

export const theadCls = "border-b border-[var(--color-line)] bg-[var(--color-canvas)] text-[12.5px] font-medium text-muted";
export const rowCls = "border-b border-[var(--color-line-soft)] last:border-0";
