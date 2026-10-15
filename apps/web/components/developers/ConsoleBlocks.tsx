"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ReplyBlock } from "@/lib/a2a/blocks";
import { cn } from "@/lib/utils";

/**
 * The interactive blocks of an agent reply, rendered as the controls a client
 * would build from them. Every control sends exactly the text the block's
 * `reply` field describes, so what the Console does is what an integration
 * should do.
 */

export interface PaymentControls {
  reference: string | null;
  settleUrl: string | null;
  /** The task is waiting for this payment right now. */
  active: boolean;
  settling: boolean;
  onSettle: (outcome: "paid" | "failed") => void;
  onOpenCheckout: () => void;
}

export function ConsoleBlocks({ blocks, disabled, onSend, payment }: { blocks: ReplyBlock[]; disabled: boolean; onSend: (text: string) => void; payment: PaymentControls | null }) {
  if (!blocks.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {blocks.map((b, i) => (
        <Block key={i} block={b} disabled={disabled} onSend={onSend} payment={payment} />
      ))}
    </div>
  );
}

const chip =
  "inline-flex items-center rounded-full border border-[var(--color-line)] bg-surface px-3 py-1.5 text-left text-[13px] font-medium text-ink-2 shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-brand)] hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50";

function Kind({ children }: { children: React.ReactNode }) {
  return <span className="mono text-[10.5px] uppercase tracking-wide text-muted">{children}</span>;
}

function Block({ block, disabled, onSend, payment }: { block: ReplyBlock; disabled: boolean; onSend: (text: string) => void; payment: PaymentControls | null }) {
  switch (block.type) {
    case "buttons":
      return (
        <div>
          <Kind>buttons</Kind>
          <div className="mt-1 flex flex-wrap gap-2">
            {block.options.map((o) => (
              <button key={o} type="button" className={chip} disabled={disabled} onClick={() => onSend(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );

    case "select": {
      const groups = new Map<string, { label: string }[]>();
      for (const o of block.options) {
        const g = o.group ?? "";
        groups.set(g, [...(groups.get(g) ?? []), o]);
      }
      return (
        <div>
          <Kind>select</Kind>
          {block.title ? <p className="mt-0.5 text-[13.5px] font-medium text-ink">{block.title}</p> : null}
          <div className="mt-1 flex flex-col gap-2">
            {Array.from(groups.entries()).map(([g, opts]) => (
              <div key={g}>
                {g ? <p className="mb-1 text-[12px] text-muted">{g}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {opts.map((o) => (
                    <button key={o.label} type="button" className={chip} disabled={disabled} onClick={() => onSend(o.label)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "cards":
      return (
        <div>
          <Kind>cards</Kind>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {block.cards.map((c) => (
              <button
                key={c.title}
                type="button"
                disabled={disabled || c.disabled}
                onClick={() => onSend(c.title)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border border-[var(--color-line)] bg-surface p-3 text-left shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50",
                  c.disabled && "border-dashed"
                )}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{c.title}</span>
                  {c.badge ? <span className="rounded-full bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] px-2 py-0.5 text-[11px] font-semibold text-brand">{c.badge}</span> : null}
                </span>
                {c.price ? (
                  <span className="text-[13px] text-ink-2">
                    {c.price}
                    {c.priceNote ? <span className="text-muted"> · {c.priceNote}</span> : null}
                  </span>
                ) : null}
                {c.desc ? <span className="text-[12.5px] text-muted">{c.desc}</span> : null}
                {c.attrs.length ? (
                  <span className="mt-1 flex flex-col gap-0.5 text-[12px] text-muted">
                    {c.attrs.map((a) => (
                      <span key={a.label}>
                        {a.label}: <span className="text-ink-2">{a.value}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
                {c.disabled ? <span className="text-[11.5px] text-muted">Unavailable</span> : null}
              </button>
            ))}
          </div>
        </div>
      );

    case "toggles":
      return <Toggles block={block} disabled={disabled} onSend={onSend} />;

    case "summary":
      return (
        <div>
          <Kind>summary</Kind>
          <div className="mt-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-surface">
            {block.title ? <p className="border-b border-[var(--color-line-soft)] px-3 py-2 text-[13px] font-semibold text-ink">{block.title}</p> : null}
            <table className="w-full text-[13px]">
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={`${r.label}-${i}`} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="px-3 py-1.5 text-muted">{r.label}</td>
                    <td className="px-3 py-1.5 text-right text-ink">{r.value}</td>
                  </tr>
                ))}
                {block.total ? (
                  <tr className="bg-[var(--color-canvas)]">
                    <td className="px-3 py-2 font-semibold text-ink">{block.total.label}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink">{block.total.value}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      );

    case "pay":
      return <Pay block={block} payment={payment} disabled={disabled} />;

    case "map":
      return (
        <p className="text-[12.5px] text-muted">
          <Kind>map</Kind> Nearby branches in {block.emirate} for {block.bundle} were offered. They are listed by name in the text; send a branch name.
        </p>
      );

    case "locate":
      return (
        <p className="text-[12.5px] text-muted">
          <Kind>locate</Kind> {block.label ? `${block.label} ` : ""}Send an address or &ldquo;latitude, longitude&rdquo; as the next message.
        </p>
      );

    case "upload":
      return (
        <div>
          <Kind>upload</Kind>
          <p className="mt-0.5 text-[12.5px] text-muted">
            A document was requested{block.document ? ` (${block.document})` : ""}. File parts are not accepted on this doorway; say the document is not available or continue without it.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" className={chip} disabled={disabled} onClick={() => onSend("The document is not available.")}>
              The document is not available
            </button>
            <button type="button" className={chip} disabled={disabled} onClick={() => onSend("Continue without it.")}>
              Continue without it
            </button>
          </div>
        </div>
      );

    case "other":
      return (
        <div>
          <Kind>{block.kind}</Kind>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--color-canvas)] px-3 py-2 text-[12px] text-ink-2">{block.body}</pre>
        </div>
      );

    default:
      return null;
  }
}

function Toggles({ block, disabled, onSend }: { block: Extract<ReplyBlock, { type: "toggles" }>; disabled: boolean; onSend: (text: string) => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const compose = (confirm: string) => `${block.items.map((i) => `${i.label}: ${on.has(i.key) ? "Yes" : "No"}`).join(". ")}. ${confirm}.`;
  return (
    <div>
      <Kind>toggles</Kind>
      {block.title ? <p className="mt-0.5 text-[13.5px] font-medium text-ink">{block.title}</p> : null}
      <div className="mt-1 flex flex-col gap-1.5">
        {block.items.map((i) => (
          <label key={i.key} className="flex items-center gap-2.5 text-[13px] text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={on.has(i.key)} disabled={disabled} onChange={() => toggle(i.key)} />
            <span>{i.label}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {block.confirm.map((c) => (
          <button key={c} type="button" className={chip} disabled={disabled} onClick={() => onSend(compose(c))} title={compose(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11.5px] text-muted">Sends: &ldquo;{compose(block.confirm[0] ?? "Confirm")}&rdquo;</p>
    </div>
  );
}

function Pay({ block, payment, disabled }: { block: Extract<ReplyBlock, { type: "pay" }>; payment: PaymentControls | null; disabled: boolean }) {
  const canSettle = Boolean(payment?.active && payment.settleUrl);
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-surface p-3 shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Kind>pay</Kind>
          <p className="text-[15px] font-semibold text-ink">{block.amount ?? block.label ?? "Payment"}</p>
          {block.label && block.amount ? <p className="text-[12.5px] text-muted">{block.label}</p> : null}
          {payment?.reference ? <p className="mono mt-0.5 text-[11.5px] text-muted">{payment.reference}</p> : null}
        </div>
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => payment?.onOpenCheckout()}
          className={cn(chip, "gap-1.5", (!payment || !payment.active) && "opacity-70")}
          aria-disabled={!payment?.active}
        >
          Open checkout <ExternalLink size={13} />
        </a>
      </div>
      {payment ? (
        payment.active ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] pt-3">
            <button
              type="button"
              disabled={disabled || payment.settling || !canSettle}
              onClick={() => payment.onSettle("paid")}
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50"
            >
              {payment.settling ? "Settling…" : "Settle in sandbox"}
            </button>
            <button
              type="button"
              disabled={disabled || payment.settling || !canSettle}
              onClick={() => payment.onSettle("failed")}
              className="inline-flex h-8 items-center rounded-lg border border-[var(--color-line)] bg-surface px-3 text-[13px] font-medium text-ink-2 shadow-[var(--shadow-xs)] hover:bg-[var(--color-canvas)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50"
            >
              Mark failed
            </button>
            <span className="text-[11.5px] text-muted">
              {canSettle ? "POSTs the payment-request artifact's sandbox.settleUrl. No money moves." : "No settle URL on this task yet; open the checkout instead."}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-muted">This payment is no longer open on the task.</p>
        )
      ) : null}
    </div>
  );
}
