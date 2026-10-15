/** Server-safe pieces of the admin tables and labels: no state, no effects. */
import { cn } from "@/lib/utils";

type Tone = "ok" | "muted" | "error" | "brand" | "warn";
const TONES: Record<Tone, string> = {
  ok: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
  muted: "border-[var(--color-line)] bg-[var(--color-canvas)] text-ink-2",
  error: "border-[#fecdca] bg-[#fef3f2] text-[#b42318]",
  brand: "border-[var(--color-ring)] bg-[color-mix(in_srgb,#1330f0_7%,white)] text-[#1330f0]",
  warn: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
};

/** A small square-cornered bordered label for statuses that are not task states. */
export function Tag({ tone = "muted", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-[3px] border px-1.5 py-px text-[12px] font-medium", TONES[tone], className)}>{children}</span>;
}

export function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn("whitespace-nowrap px-4 py-2.5 font-medium first:pl-5 last:pr-5", className)}>{children}</th>;
}
export function Td({ className, children, colSpan }: { className?: string; children?: React.ReactNode; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-3 first:pl-5 last:pr-5", className)}>
      {children}
    </td>
  );
}
export const Dash = () => <span className="text-muted">-</span>;

/** The frame every admin table sits in: hairline border, scrolls sideways on a phone. */
export function TableFrame({ minWidth, children }: { minWidth: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-[var(--color-line)] bg-white">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="border border-dashed border-[var(--color-line)] bg-white px-5 py-8 text-[13.5px] text-ink-2">{text}</p>;
}

export function Json({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn("dev-code", className)}>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
