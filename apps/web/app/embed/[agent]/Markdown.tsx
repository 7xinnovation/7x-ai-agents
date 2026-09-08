import React from "react";
import { UploadSimple, Camera, DeviceMobile, CheckCircle, ArrowClockwise, FileText, Warning, LockSimple, CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { tr, type LocalizedString, type Locale } from "@dialog/config";
import { ChatMap } from "./ChatMap";
import { ChatLocate } from "./ChatLocate";
import { openExternal, onNativeEvent, type ExternalWindow } from "./nativeBridge";

/**
 * Context the chat needs to render an inline upload widget (feedback: keep the
 * upload in the conversation, one document at a time). Built in Experience and
 * threaded into assistant-message markdown; a ```upload block names the doc key.
 */
export interface UploadDocMeta {
  label: LocalizedString;
  requirement: "mandatory" | "conditional" | "optional";
  acceptedFormats: string[];
  maxSizeMb: number;
}
export interface UploadCtx {
  locale: Locale;
  docs: Record<string, UploadDocMeta>;
  statuses: Record<string, { status: string; fileName?: string; rejectionReason?: string }>;
  // Every upload currently in flight — overlapping uploads each show their
  // own spinner instead of one clobbering the other.
  uploadingKeys: Set<string>;
  // Active journey's documents still awaiting an upload (condition satisfied) —
  // the safety net when an ```upload block names no resolvable key: rather than
  // rendering NOTHING (feedback FB-1425: "AI says upload slots appeared but no
  // upload fields display"), the pending documents' widgets render instead.
  pendingDocs?: string[];
  // Cap on upload controls rendered per assistant message (FB-1565). Undefined
  // = no cap, for agents that pair blocks deliberately (EID front + back).
  maxUploads?: number;
  onUpload: (key: string, file: File) => void;
  onQr: () => void;
  strings: {
    upload: string; uploading: string; replace: string; optional: string;
    upTo: string; takePhoto: string; fromPhone: string; uploaded: string;
  };
}

/**
 * Resolve the document keys an ```upload block refers to. Tolerant by design
 * (FB-1425 — a mis-emitted block must not silently render nothing):
 *  - accepts any number of `key: <docKey>` lines (front + back in one block);
 *  - accepts `- <docKey>` bullets and bare `<docKey>` lines;
 *  - strips backticks/quotes and fuzzy-matches unknown keys against the known
 *    document keys (case/punctuation-insensitive);
 *  - if nothing resolves, falls back to the journey's still-pending documents.
 */
export function resolveUploadKeys(body: string[], ctx: UploadCtx): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known = new Map(Object.keys(ctx.docs).map((k) => [norm(k), k]));
  const out: string[] = [];
  for (const raw of body) {
    const line = raw.replace(/^\s*(?:key\s*:|-)\s*/i, "").replace(/[`'"]/g, "").trim();
    if (!line || /\s.{24,}/.test(line)) continue; // skip prose lines
    const hit = known.get(norm(line));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  if (!out.length && ctx.pendingDocs?.length) out.push(...ctx.pendingDocs.slice(0, 2));
  return out;
}

/**
 * Clear the input before the picker opens.
 *
 * A file input fires `change` only when the selection CHANGES. Replace a
 * document with the same file -- which is exactly what someone does after being
 * told the wrong one went into a slot, or when a first attempt seemed not to
 * register -- and the picker opens, they choose the file, and nothing happens at
 * all. The button looks broken because from the outside it is.
 */
function resetFileInput(e: React.MouseEvent<HTMLInputElement>) {
  (e.currentTarget as HTMLInputElement).value = "";
}

/** Inline, in-conversation upload control for a single document (by key). */
function ChatUpload({ dkey, ctx }: { dkey: string; ctx: UploadCtx }) {
  const doc = ctx.docs[dkey];
  if (!doc) return null;
  const st = ctx.statuses[dkey];
  const uploaded = st?.status === "uploaded" || st?.status === "accepted";
  const busy = ctx.uploadingKeys.has(dkey);
  const accept = doc.acceptedFormats.map((f) => "." + f).join(",");
  const t = ctx.strings;
  return (
    <div className={`dlg-chat-upload${uploaded ? " is-done" : ""}`}>
      <div className="dlg-chat-upload-head">
        <FileText size={15} weight="regular" />
        <span className="dlg-chat-upload-name">
          {tr(doc.label, ctx.locale)}
          {doc.requirement === "optional" ? <em> ({t.optional})</em> : null}
        </span>
        {uploaded ? (
          <span className="dlg-chat-upload-status">
            <CheckCircle size={13} weight="fill" /> {t.uploaded}
          </span>
        ) : null}
      </div>
      {uploaded ? (
        <div className="dlg-chat-upload-file">
          <span className="fname">{st?.fileName}</span>
          {/* Replace showed no sign of working. The label never changed, so a
              replacement that took several seconds to read looked identical to a
              dead button -- and people clicked it again, which is why it read as
              broken even on the runs where it worked. */}
          <label className={`dlg-upload ghost ${busy ? "busy" : ""}`}>
            {busy ? (
              <>
                <ArrowClockwise size={13} weight="bold" className="spin" /> {t.uploading}
              </>
            ) : (
              t.replace
            )}
            <input type="file" hidden disabled={busy} accept={accept} onClick={resetFileInput} onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
        </div>
      ) : (
        <div className="dlg-chat-upload-actions">
          <label className="dlg-upload cam" title={t.takePhoto} aria-label={t.takePhoto}>
            <Camera size={14} weight="bold" />
            <input type="file" hidden disabled={busy} accept="image/*" capture="environment" onClick={resetFileInput} onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
          <button type="button" className="dlg-upload-phone" onClick={ctx.onQr} title={t.fromPhone}>
            <DeviceMobile size={14} weight="bold" /> {t.fromPhone}
          </button>
          <label className={`dlg-upload ${busy ? "busy" : ""}`}>
            {busy ? (
              <>
                <ArrowClockwise size={14} weight="bold" className="spin" /> {t.uploading}
              </>
            ) : (
              <>
                <UploadSimple size={14} weight="bold" /> {t.upload}
              </>
            )}
            <input type="file" hidden disabled={busy} accept={accept} onClick={resetFileInput} onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
        </div>
      )}
      {st?.status === "rejected" && st?.rejectionReason ? (
        <div className="dlg-docslot-error">
          <Warning size={13} weight="fill" /> {st.rejectionReason}
        </div>
      ) : (
        <div className="dlg-chat-upload-hint">
          {doc.acceptedFormats.join(", ").toUpperCase()} · {t.upTo} {doc.maxSizeMb}MB
        </div>
      )}
    </div>
  );
}

/** Inline action buttons (a ```buttons block). Tapping sends the label as the reply. */
function ChatButtons({ labels, onSelect }: { labels: string[]; onSelect: (text: string) => void }) {
  if (!labels.length) return null;
  return (
    <div className="dlg-chat-buttons">
      {labels.map((l, i) => (
        <button key={i} type="button" className={`dlg-chat-btn${i === 0 ? " primary" : ""}`} onClick={() => onSelect(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Inline toggle switches (a ```toggles block) plus a confirm button — for
 * capturing on/off choices (e.g. save card, auto-renewal) without a text Q&A.
 * On confirm it sends a readable summary of the switches so the agent records
 * each choice and continues. With `style: checkbox` the switches render as
 * acknowledgment checkboxes (e.g. EPGL Declaration & Undertaking) and the
 * confirm button stays disabled until every box is ticked.
 */
/**
 * A payment that happens on the BACKEND's own hosted page.
 *
 * The internal checkout renders a PaymentCard driven by a payment_initiated
 * event, and polls our own gateway for the result. A rental is paid on Emirates
 * Post's N-Genius page instead, so there is no event and nothing of ours to poll
 * — but the customer should still get a button that opens a popup over the chat,
 * not a bare link that throws them into a new tab and loses the conversation.
 */
/**
 * The hosts a pay button may open.
 *
 * The URL inside a ```pay block is rewritten server-side to the one the payment
 * gateway issued for THIS order (lib/payFence), so in the flows that take money
 * it is never the model's to choose. This is the second lock: a button that
 * navigates the customer somewhere is worth constraining at the point it
 * navigates, not only at the point it was written.
 *
 * A new gateway goes here. Refusing to open an unknown host is the failure we
 * want — a payment page that does not open is recoverable, a customer sent to
 * someone else's is not.
 */
const PAY_HOSTS = ["ngenius-payments.com", "network.ae"];

export function isPaymentUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return PAY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function ChatPay({
  url,
  amount,
  label,
  onSelect,
}: {
  url: string;
  amount?: string;
  label?: string;
  onSelect?: (text: string) => void;
}) {
  const [opened, setOpened] = React.useState(false);
  const [returned, setReturned] = React.useState(false);
  const win = React.useRef<ExternalWindow | null>(null);
  const [everOpened, setEverOpened] = React.useState(false);

  // A closed window is not a completed payment. Whether the customer paid or gave
  // up, the button has to come back — it sat on "Checking your payment…" for good,
  // with no way to reopen the page.
  React.useEffect(() => {
    if (!opened) return;
    const t = setInterval(() => {
      if (win.current && win.current.closed) {
        win.current = null;
        setOpened(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [opened]);

  // The chat asks the backend whether the money arrived; that answer lands in the
  // conversation below, so this card stops speaking for it after a moment. What it
  // must NOT do is go back to "Pay now" — a customer who has just paid reads that
  // as the payment not having happened.
  React.useEffect(() => {
    if (!returned) return;
    const t = setTimeout(() => setReturned(false), 20000);
    return () => clearTimeout(t);
  }, [returned]);

  // The return page tells us the customer came back; it does NOT tell us they
  // paid, because only the backend can say that. So close the window and let the
  // conversation ask — rather than leaving them on a page wondering, or making
  // them type "I paid" to a chat that already knows they returned.
  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as { source?: string; action?: string };
      if (m?.source !== "dialog-extpay" || m.action !== "returned" || returned) return;
      setReturned(true);
      try {
        win.current?.close();
      } catch {
        /* already gone */
      }
      win.current = null;
      setOpened(false);
      onSelect?.("I have completed the payment on the Emirates Post page. Please verify it and confirm my booking.");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onSelect, returned]);

  // The native host reports the customer back from the payment page; a browser
  // reports it by postMessage from the return page. Both end up here.
  React.useEffect(
    () =>
      onNativeEvent((e) => {
        if (e.action !== "returned" || returned) return;
        setReturned(true);
        win.current = null;
        setOpened(false);
        onSelect?.("I have completed the payment on the Emirates Post page. Please verify it and confirm my booking.");
      }),
    [onSelect, returned]
  );

  const open = () => {
    // Checked again here: everything below navigates the customer away, and a
    // URL that is not a payment page has no business doing that.
    if (!isPaymentUrl(url)) return;
    const opened = openExternal(url, { name: "dlg-extpay", kind: "payment" });
    // Nothing opened: a same-tab navigation still gets them there, which beats a
    // button that silently does nothing.
    if (!opened) window.location.assign(url);
    else {
      win.current = opened;
      setOpened(true);
      setEverOpened(true);
    }
  };
  return (
    <div className="dlg-paycard ready">
      <div className="dlg-paycard-head">
        <span className="dlg-paycard-icon">
          <LockSimple size={15} weight="fill" />
        </span>
        <span className="dlg-paycard-title">{label || "Secure payment"}</span>
        {amount ? <span className="dlg-paycard-amount">{amount}</span> : null}
      </div>
      <div className="dlg-paycard-body">
        <button className="dlg-paybtn" onClick={open} disabled={returned}>
          {returned
            ? "Checking your payment…"
            : opened
              ? "Reopen payment page"
              : everOpened
                ? "Open the payment page again"
                : "Pay now"}
        </button>
        {opened && !returned ? (
          <div className="dlg-paycard-note">Finish in the payment window — I will pick it up from there.</div>
        ) : null}
        {!opened && !returned && everOpened ? (
          <div className="dlg-paycard-note">
            The payment window closed. If your payment went through, I confirm it in the chat below — reopen this only
            if you did not finish.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A long list of cards, as a dropdown.
 *
 * Twenty-one Dubai branches rendered as cards filled several screens, and the
 * customer had to scroll past all of them to reach the question. Below the
 * threshold cards are better — three bundles, ten box numbers — so this only
 * takes over when the list is genuinely long, and it keeps everything the card
 * carried: the badge, the hours, and whether the option can be chosen at all.
 */
/** Above this many buttons the list stops being a set of choices and becomes a pile. */
const BUTTON_LIST_MAX = 12;

const SELECT_STR = {
  en: { count: (n: number) => `${n} to choose from`, search: "Search", empty: "Nothing matches that." },
  ar: { count: (n: number) => `${n} خيارات متاحة`, search: "بحث", empty: "لا توجد نتائج مطابقة." },
} as const;

function ChatCardSelect({
  cards,
  locale,
  onSelect,
}: {
  cards: OptionCard[];
  locale?: string;
  onSelect: (text: string) => void;
}) {
  const t = SELECT_STR[locale === "ar" ? "ar" : "en"];
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? cards.filter((c) =>
        [c.title, c.desc, c.badge, ...c.attrs.map((a) => `${a.label} ${a.value}`)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : cards;
  const available = cards.filter((c) => !c.disabled).length;

  return (
    <div className={`dlg-cardselect${open ? " is-open" : ""}`} ref={boxRef}>
      <button type="button" className="dlg-cardselect-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{t.count(available)}</span>
        <CaretDown size={14} weight="bold" className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <div className="dlg-cardselect-panel">
          <div className="dlg-cardselect-search">
            <MagnifyingGlass size={14} weight="bold" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              placeholder={t.search}
              aria-label={t.search}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="dlg-cardselect-list">
            {shown.length ? (
              shown.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className={`dlg-cardselect-row${c.disabled ? " is-disabled" : ""}`}
                  disabled={c.disabled}
                  onClick={() => { if (!c.disabled) { setOpen(false); onSelect(c.title); } }}
                >
                  <span className="dlg-cardselect-name">
                    {c.title}
                    {c.badge ? <span className="dlg-cardselect-badge">{c.badge}</span> : null}
                  </span>
                  {c.desc ? <span className="dlg-cardselect-desc">{c.desc}</span> : null}
                  {c.price ? <span className="dlg-cardselect-price">{c.price}</span> : null}
                  {c.priceNote ? <span className="dlg-cardselect-pricenote">{c.priceNote}</span> : null}
                </button>
              ))
            ) : (
              <div className="dlg-cardselect-row is-empty">{t.empty}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A dropdown, for a list too long to be buttons.
 *
 * The corporate journey asks which authority issued the trade licence, and there
 * are around sixty of them. Rendered as chips they filled the screen twice over
 * before the customer had read the question — so the whole list loaded, pushed
 * the conversation off the top, and asked them to hunt. A native <select> is one
 * line, groups by emirate, and on a phone opens the platform's own picker with
 * type-ahead already in it.
 */
function ChatSelect({
  options, title, placeholder, confirmLabel, onSelect,
}: {
  options: { label: string; group?: string }[];
  title?: string;
  placeholder: string;
  confirmLabel: string;
  onSelect: (text: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const [sent, setSent] = React.useState(false);
  if (!options.length) return null;
  // Preserve the order the groups arrived in; an alphabetical re-sort would
  // separate an emirate's authorities from its heading.
  const groups: { name: string; items: string[] }[] = [];
  for (const o of options) {
    const name = o.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(o.label);
    else groups.push({ name, items: [o.label] });
  }
  const grouped = groups.some((g) => g.name);
  return (
    <div className="dlg-select">
      {title ? <div className="dlg-select-title">{title}</div> : null}
      <div className="dlg-select-row">
        <select
          className="dlg-select-input"
          value={value}
          disabled={sent}
          onChange={(e) => setValue(e.target.value)}
          aria-label={title ?? placeholder}
        >
          <option value="">{placeholder}</option>
          {grouped
            ? groups.map((g) =>
                g.name ? (
                  <optgroup key={g.name} label={g.name}>
                    {g.items.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </optgroup>
                ) : (
                  g.items.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))
                )
              )
            : options.map((o) => (
                <option key={o.label} value={o.label}>{o.label}</option>
              ))}
        </select>
        <button
          type="button"
          className="dlg-select-confirm"
          disabled={!value || sent}
          onClick={() => { setSent(true); onSelect(value); }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function ChatToggles({
  items, title, confirmLabel, variant, defaultOn, onSelect,
}: {
  items: { key: string; label: string; variant?: "switch" | "checkbox" }[];
  title?: string;
  confirmLabel: string;
  variant?: "switch" | "checkbox";
  defaultOn?: boolean;
  onSelect: (text: string) => void;
}) {
  const checkbox = variant === "checkbox";
  /**
   * Style per ITEM, not per block.
   *
   * Payment preferences are switches and the Terms acceptance is a tickbox --
   * different kinds of thing, and merging them into one list made the switches
   * look like consent tickboxes. Splitting them into two blocks instead gave the
   * customer TWO confirm buttons for one decision. They belong in one block,
   * rendered differently.
   */
  const isCheck = (it: { variant?: "switch" | "checkbox" }) => (it.variant ?? variant) === "checkbox";
  /** Only acknowledgments gate the button; a preference left off is an answer. */
  const required = items.filter(isCheck);
  // Switches may start on when the journey opts in (a preference the customer is
  // expected to want, which they can still turn off before confirming).
  // CHECKBOXES NEVER DO: that variant is the terms-and-conditions acknowledgment,
  // and a pre-ticked acknowledgment is not an acknowledgment.
  const [on, setOn] = React.useState<Record<string, boolean>>(() =>
    defaultOn ? Object.fromEntries(items.filter((it) => !isCheck(it)).map((it) => [it.key, true])) : {}
  );
  if (!items.length) return null;
  const allOn = (required.length ? required : items).every((it) => on[it.key]);
  // The button is not offered until the acknowledgment is made. Disabled was not
  // enough: a greyed-out "Proceed to payment" still reads as the next step, and
  // the customer taps it and nothing happens. Where there is nothing to
  // acknowledge, the button is simply there.
  const showConfirm = required.length === 0 || allOn;
  const submit = () => {
    // Strip markdown links from labels (e.g. the T&C link) so the sent reply
    // reads clean.
    const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const summary = items.map((it) => `${plain(it.label)}: ${on[it.key] ? "Yes" : "No"}`).join(". ");
    onSelect(`${summary}. ${confirmLabel}.`);
  };
  return (
    <div className={`dlg-toggles${checkbox ? " is-checkbox" : ""}`}>
      {title ? <div className="dlg-toggles-title">{title}</div> : null}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role={isCheck(it) ? "checkbox" : "switch"}
          aria-checked={!!on[it.key]}
          className={`dlg-toggle${on[it.key] ? " is-on" : ""}${isCheck(it) ? " is-checkbox-row" : ""}`}
          onClick={() => setOn((s) => ({ ...s, [it.key]: !s[it.key] }))}
        >
          {isCheck(it) ? (
            <span className="dlg-checkbox-box" aria-hidden="true">
              {on[it.key] ? (
                <svg viewBox="0 0 12 12" fill="none">
                  <path d="M2.4 6.3l2.2 2.2 5-5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </span>
          ) : null}
          {/* A link inside the label (e.g. Terms & Conditions) must open without
              flipping the switch the row-button controls. */}
          <span
            className="dlg-toggle-label"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
            }}
          >
            {renderInline(it.label)}
          </span>
          {isCheck(it) ? null : (
            <span className="dlg-toggle-track" aria-hidden="true"><span className="dlg-toggle-thumb" /></span>
          )}
        </button>
      ))}
      {showConfirm ? (
        <button type="button" className="dlg-toggles-confirm" onClick={submit}>{confirmLabel}</button>
      ) : null}
    </div>
  );
}

/**
 * A premium review card (a ```summary block) for confirming collected details —
 * a PO Box's details, a pre-payment summary. Labeled rows with an optional
 * emphasised total footer; cleaner and more considered than a raw markdown table.
 */
function ChatSummary({
  title, rows, total,
}: {
  title?: string;
  rows: { label: string; value: string }[];
  total?: { label: string; value: string };
}) {
  if (!rows.length && !total) return null;
  return (
    <div className="dlg-summary">
      {title ? <div className="dlg-summary-title">{title}</div> : null}
      {rows.length ? (
        <div className="dlg-summary-rows">
          {rows.map((r, i) => (
            <div className="dlg-summary-row" key={i}>
              <span className="dlg-summary-k">{renderInline(r.label)}</span>
              <span className="dlg-summary-v">{renderInline(r.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {total ? (
        <div className="dlg-summary-total">
          <span className="dlg-summary-k">{renderInline(total.label)}</span>
          <span className="dlg-summary-v">{renderInline(total.value)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Minimal, dependency-free Markdown renderer for assistant messages: paragraphs,
 * bullet lists, **bold**, *italic* / _italic_, `code`, and [links](url). Builds
 * React elements (no raw HTML) so it's XSS-safe. Tolerant of partial markdown
 * mid-stream (unmatched tokens render as plain text until they complete).
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const push = (n: React.ReactNode) => out.push(<React.Fragment key={key++}>{n}</React.Fragment>);

  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => React.ReactNode }[] = [
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => (
      <a href={m[2]} target="_blank" rel="noopener noreferrer" className="dlg-md-link">{m[1]}</a>
    ) },
    { re: /\*\*([^*]+)\*\*/, make: (m) => <strong>{renderInline(m[1]!)}</strong> },
    { re: /`([^`]+)`/, make: (m) => <code className="dlg-md-code">{m[1]}</code> },
    // A MASKED VALUE is literal text, not emphasis. Guest results star out the
    // holder's name (FB-1323: "O*** A****** ******m"), and those runs of
    // asterisks were being consumed as italic markers — the customer saw a
    // mangled name like "O* A**** ****m" and could no longer recognise their
    // own. Any run of two or more asterisks is therefore emitted verbatim.
    // Placed after **bold** so a genuine bold span, which matches at the same
    // position, still wins; single-asterisk italics are unaffected because this
    // needs two in a row.
    { re: /[A-Za-z0-9؀-ۿ*]*\*{2,}[A-Za-z0-9؀-ۿ*]*/, make: (m) => m[0] },
    { re: /_([^_]+)_|\*([^*\s][^*]*)\*/, make: (m) => <em>{m[1] ?? m[2]}</em> },
  ];

  while (rest.length) {
    let best: RegExpMatchArray | null = null;
    let bestAt = Infinity;
    let bestMake: ((m: RegExpMatchArray) => React.ReactNode) | null = null;
    for (const p of patterns) {
      const m = rest.match(p.re);
      if (m && m.index !== undefined && m.index < bestAt) { best = m; bestAt = m.index; bestMake = p.make; }
    }
    if (!best || !bestMake) { push(rest); break; }
    if (bestAt > 0) push(rest.slice(0, bestAt));
    push(bestMake(best));
    rest = rest.slice(bestAt + best[0].length);
  }
  return out;
}

/** A row of `| a | b |` markdown split into trimmed cells (outer pipes dropped). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Split on unescaped pipes.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
const isTableRow = (line: string) => /\|/.test(line) && line.trim().length > 0;

/**
 * Parse a ```cards fenced block into selectable option cards (PRD/feedback
 * FB-1169: show products or options to choose from as visual cards, not tables).
 * Each card is a `- ` item followed by `key: value` lines; recognised keys —
 * title, price, desc/subtitle, badge, meta — get dedicated styling, anything
 * else renders as a labeled attribute row.
 */
interface OptionCard {
  title: string;
  price?: string;
  /**
   * A small line UNDER the price — what else the customer will pay.
   *
   * Without it the registration fee had nowhere to go, so the model put it in
   * `badge`, which renders as a large pill at the TOP of the card: a fee shouted
   * above the product name and the price it qualifies. It belongs beneath the
   * number it modifies, in the quieter type a footnote gets.
   */
  priceNote?: string;
  desc?: string;
  badge?: string;
  /** Shown, but not choosable — a branch with no boxes left, say. */
  disabled?: boolean;
  attrs: { label: string; value: string }[];
}
function parseCards(body: string[]): OptionCard[] {
  const cards: OptionCard[] = [];
  let cur: OptionCard | null = null;
  for (const raw of body) {
    const item = raw.match(/^\s*-\s+(.*)$/);
    const kv = raw.match(/^\s*([A-Za-z][\w ]*?):\s*(.*)$/);
    if (item) {
      if (cur) cards.push(cur);
      cur = { title: "", attrs: [] };
      const inline = item[1]!.match(/^([A-Za-z][\w ]*?):\s*(.*)$/);
      if (inline) applyCardKey(cur, inline[1]!, inline[2]!);
      else cur.title = item[1]!.trim();
    } else if (kv && cur) {
      applyCardKey(cur, kv[1]!, kv[2]!);
    }
  }
  if (cur) cards.push(cur);
  return cards.filter((c) => c.title || c.desc || c.attrs.length);
}
function applyCardKey(card: OptionCard, key: string, value: string) {
  const k = key.trim().toLowerCase();
  const v = value.trim();
  if (k === "title" || k === "name") card.title = v;
  else if (k === "price" || k === "cost") card.price = v;
  else if (k === "pricenote" || k === "price_note" || k === "fee" || k === "feenote") card.priceNote = v;
  else if (k === "desc" || k === "description" || k === "subtitle") card.desc = v;
  else if (k === "badge" || k === "tag") card.badge = v;
  else if (k === "disabled" || k === "unavailable") card.disabled = !/^(no|false|0)$/i.test(v);
  else if (!card.title) card.title = v;
  else card.attrs.push({ label: key.trim(), value: v });
}

/**
 * Reveals assistant text with a smooth typewriter effect, decoupled from the
 * network: SSE deltas grow `text`, and this animates the visible slice up to it
 * at a steady pace, accelerating to catch up after a burst (e.g. text resuming
 * after a tool round) so it never lags far behind. When `animate` is false
 * (completed / resumed messages) it renders in full immediately.
 */
export function TypewriterMarkdown({ text, animate, onSelect, uploadCtx }: { text: string; animate: boolean; onSelect?: (text: string) => void; uploadCtx?: UploadCtx }) {
  const [shown, setShown] = React.useState(animate ? 0 : text.length);
  const shownRef = React.useRef(shown);
  const textRef = React.useRef(text);
  textRef.current = text;

  React.useEffect(() => {
    if (!animate) {
      shownRef.current = textRef.current.length;
      setShown(textRef.current.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const BASE_CPS = 260; // steady typing speed
    const tick = (now: number) => {
      const dt = Math.min(now - last, 60) / 1000;
      last = now;
      const target = textRef.current.length;
      let cur = shownRef.current;
      if (cur < target) {
        const gap = target - cur;
        // Type steadily; speed up (up to ~7x) the further behind the buffer runs.
        const cps = BASE_CPS * (1 + Math.min(gap / 55, 6));
        cur = Math.min(target, cur + cps * dt);
        if (Math.floor(cur) !== shownRef.current) {
          shownRef.current = Math.floor(cur);
          setShown(shownRef.current);
        } else {
          shownRef.current = cur;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  // When the turn ends, make sure nothing is left half-revealed.
  React.useEffect(() => {
    if (!animate) setShown(text.length);
  }, [animate, text]);

  // Cards/uploads are interactive only once the reply has fully rendered.
  return <Markdown text={animate ? text.slice(0, Math.floor(shown)) : text} onSelect={animate ? undefined : onSelect} uploadCtx={animate ? undefined : uploadCtx} />;
}

export function Markdown({ text, onSelect, uploadCtx }: { text: string; onSelect?: (text: string) => void; uploadCtx?: UploadCtx }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  // Collapse a paragraph that exactly repeats the one right before it — the model
  // sometimes re-emits the same sentence across a tool round (they arrive as two
  // identical paragraphs), which reads as a stutter.
  let lastPara = "";
  // Upload controls already rendered for THIS message (see uploadCtx.maxUploads).
  let uploadsShown = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced blocks: ```cards (choice cards) or ```upload (in-chat upload widget).
    const fence = line.match(/^\s*```\s*(cards|upload|buttons|toggles|summary|map|locate|pay|select)?\s*$/);
    if (fence) {
      const isCards = fence[1] === "cards";
      const isUpload = fence[1] === "upload";
      const isButtons = fence[1] === "buttons";
      const isToggles = fence[1] === "toggles";
      const isSummary = fence[1] === "summary";
      const isMap = fence[1] === "map";
      const isLocate = fence[1] === "locate";
      const isPay = fence[1] === "pay";
      const isSelect = fence[1] === "select";
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) { body.push(lines[i]!); i++; }
      i++; // closing fence
      if (isUpload) {
        // Body names which document(s) to upload; parsing is tolerant and falls
        // back to the journey's pending documents so the block never renders as
        // nothing once the message is complete (FB-1425).
        if (uploadCtx) {
          for (const dkey of resolveUploadKeys(body, uploadCtx)) {
            // FB-1565: one ask at a time. An agent that declares a per-message
            // cap shows at most that many upload controls, however many blocks
            // the model emitted; the extra documents are requested next turn.
            if (uploadCtx.maxUploads !== undefined && uploadsShown >= uploadCtx.maxUploads) break;
            uploadsShown++;
            nodes.push(<ChatUpload key={k++} dkey={dkey} ctx={uploadCtx} />);
          }
        }
        // No ctx (still streaming) → render nothing for the block yet.
        continue;
      }
      if (isPay) {
        // `url:` (required), optional `amount:` and `label:`.
        const get = (k: string) => body.map((l) => l.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, "i"))).find(Boolean)?.[1];
        const purl = get("url");
        // A payment page is somewhere else by definition. Our own origin here means
        // the return URL -- the page the gateway sends the customer BACK to -- which
        // opens, reports them returned, and closes before they can pay.
        const external = (u: string) => {
          try { return new URL(u).origin !== window.location.origin; } catch { return false; }
        };
        if (purl && external(purl) && isPaymentUrl(purl))
          nodes.push(<ChatPay key={k++} url={purl} amount={get("amount")} label={get("label")} onSelect={onSelect} />);
        continue;
      }
      if (isLocate) {
        // Optional `label: <cta text>` line; confirms send the pinned location.
        const labelLine = body.map((l) => l.match(/^\s*label\s*:\s*(.+?)\s*$/i)).find(Boolean);
        if (onSelect)
          nodes.push(
            <ChatLocate
              key={k++}
              label={labelLine ? labelLine[1] : undefined}
              locale={uploadCtx?.locale}
              onSelect={onSelect}
            />
          );
        continue;
      }
      if (isSelect) {
        // `title:` / `placeholder:` / `confirm:` lines, `group: <heading>` to open
        // a section, and `- Label` for each option.
        let sTitle: string | undefined;
        let sPlaceholder = "Choose an option";
        let sConfirm = "Continue";
        let sGroup: string | undefined;
        const sOptions: { label: string; group?: string }[] = [];
        for (const l of body) {
          const item = l.match(/^\s*-\s+(.*\S)\s*$/);
          const meta = l.match(/^\s*(title|placeholder|confirm|group)\s*:\s*(.+?)\s*$/i);
          if (item) sOptions.push({ label: item[1]!.trim(), group: sGroup });
          else if (meta) {
            const v = meta[2]!.trim();
            if (/^title$/i.test(meta[1]!)) sTitle = v;
            else if (/^placeholder$/i.test(meta[1]!)) sPlaceholder = v;
            else if (/^group$/i.test(meta[1]!)) sGroup = v;
            else sConfirm = v;
          }
        }
        if (onSelect && sOptions.length)
          nodes.push(
            <ChatSelect
              key={k++}
              options={sOptions}
              title={sTitle}
              placeholder={sPlaceholder}
              confirmLabel={sConfirm}
              onSelect={onSelect}
            />
          );
        continue;
      }
      if (isButtons) {
        // Each `- Label` line is an action button; tapping sends that label.
        const labels = body.map((l) => l.match(/^\s*-\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m![1]!.trim());
        // The same wall the cards had. Sixty licensing authorities as chips
        // filled the screen twice and pushed the question out of sight, so a
        // long run of buttons collapses into the searchable dropdown too — the
        // customer types two letters instead of hunting through the pile.
        if (onSelect && labels.length > BUTTON_LIST_MAX) {
          nodes.push(
            <ChatCardSelect
              key={k++}
              cards={labels.map((l) => ({ title: l, attrs: [] }))}
              locale={uploadCtx?.locale}
              onSelect={onSelect}
            />
          );
          continue;
        }
        if (onSelect && labels.length) nodes.push(<ChatButtons key={k++} labels={labels} onSelect={onSelect} />);
        continue;
      }
      if (isToggles) {
        // `title:` / `confirm:` / `style:` lines, and `- key: label` lines for
        // each switch. `style: checkbox` renders acknowledgment checkboxes.
        let tTitle: string | undefined;
        let tConfirm = "Confirm";
        let tVariant: "switch" | "checkbox" = "switch";
        let tDefaultOn = false;
        const tItems: { key: string; label: string; variant?: "switch" | "checkbox" }[] = [];
        let tCheckKeys = new Set<string>();
        for (const l of body) {
          const item = l.match(/^\s*-\s+([\w.-]+)\s*:\s*(.+?)\s*$/);
          const meta = l.match(/^\s*(title|confirm|style|default|checkboxes)\s*:\s*(.+?)\s*$/i);
          if (item) tItems.push({ key: item[1]!.trim(), label: item[2]!.trim() });
          else if (meta) {
            if (/^title$/i.test(meta[1]!)) tTitle = meta[2]!.trim();
            else if (/^style$/i.test(meta[1]!)) tVariant = /checkbox/i.test(meta[2]!) ? "checkbox" : "switch";
            else if (/^default$/i.test(meta[1]!)) tDefaultOn = /^(on|yes|true)$/i.test(meta[2]!.trim());
            else if (/^checkboxes$/i.test(meta[1]!)) tCheckKeys = new Set(meta[2]!.split(",").map((x) => x.trim()).filter(Boolean));
            else tConfirm = meta[2]!.trim();
          }
        }
        for (const it of tItems) if (tCheckKeys.has(it.key)) it.variant = "checkbox";
        if (onSelect && tItems.length) nodes.push(<ChatToggles key={k++} items={tItems} title={tTitle} confirmLabel={tConfirm} variant={tVariant} defaultOn={tDefaultOn} onSelect={onSelect} />);
        continue;
      }
      if (isSummary) {
        // A review card: `title:` line, `- Label: Value` rows, and an optional
        // `total: <amount>` line rendered as the emphasised footer.
        let sTitle: string | undefined;
        let sTotal: { label: string; value: string } | undefined;
        const sRows: { label: string; value: string }[] = [];
        for (const l of body) {
          const meta = l.match(/^\s*(title|total)\s*:\s*(.+?)\s*$/i);
          const row = l.match(/^\s*-\s+(.+?)\s*:\s*(.+?)\s*$/);
          if (meta && /^title$/i.test(meta[1]!)) sTitle = meta[2]!.trim();
          else if (meta) {
            const t = meta[2]!.trim();
            const split = t.match(/^(.+?)\s*:\s*(.+)$/);
            sTotal = split ? { label: split[1]!.trim(), value: split[2]!.trim() } : { label: "Total", value: t };
          } else if (row) sRows.push({ label: row[1]!.trim(), value: row[2]!.trim() });
        }
        if (sRows.length || sTotal) nodes.push(<ChatSummary key={k++} title={sTitle} rows={sRows} total={sTotal} />);
        continue;
      }
      if (isMap) {
        // `emirate: <code>` + `bundle: <bundleId>` — the in-chat nearby-branches map.
        let mEmirate = "";
        let mBundle = "";
        for (const l of body) {
          const m = l.match(/^\s*(emirate|bundle)\s*:\s*(.+?)\s*$/i);
          if (m && /^emirate$/i.test(m[1]!)) mEmirate = m[2]!.trim().toUpperCase();
          else if (m) mBundle = m[2]!.trim();
        }
        if (onSelect && mEmirate && mBundle) nodes.push(<ChatMap key={k++} emirate={mEmirate} bundle={mBundle} onSelect={onSelect} locale={uploadCtx?.locale} />);
        continue;
      }
      if (isCards) {
        const cards = parseCards(body);
        // Above this many, cards stop being a way to compare options and start
        // being a wall to scroll past. Ten box numbers still read well as cards;
        // twenty-one branches do not.
        if (cards.length > 12 && onSelect) {
          nodes.push(<ChatCardSelect key={k++} cards={cards} locale={uploadCtx?.locale} onSelect={onSelect} />);
          continue;
        }
        if (cards.length) {
          nodes.push(
            <div className="dlg-cards" key={k++}>
              {cards.map((c, ci) => {
                const selected = !!c.badge && /^\s*selected\s*$/i.test(c.badge);
                // A tappable card sends its title as the customer's choice, so the
                // user can pick by tapping instead of typing. The already-selected
                // card and any card rendered without a handler stay inert.
                const tappable = !!onSelect && !selected && !c.disabled;
                const cls =
                  `dlg-card-opt${selected ? " is-selected" : ""}${tappable ? " is-tappable" : ""}` +
                  (c.disabled ? " is-disabled" : "");
                const inner = (
                  <>
                    <div className="dlg-card-opt-head">
                      <span className="dlg-card-opt-title">{renderInline(c.title)}</span>
                      {c.badge ? (
                        <span className={`dlg-card-opt-badge${selected ? " is-selected" : ""}`}>
                          {selected ? (
                            <>
                              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2.4 6.3l2.2 2.2 5-5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Selected
                            </>
                          ) : (
                            c.badge
                          )}
                        </span>
                      ) : null}
                    </div>
                    {c.desc ? <p className="dlg-card-opt-desc">{renderInline(c.desc)}</p> : null}
                    {c.attrs.length ? (
                      <div className="dlg-card-opt-attrs">
                        {c.attrs.map((a, ai) => (
                          <span className="dlg-card-opt-attr" key={ai}>
                            <span className="k">{a.label}</span>
                            <span className={`v${a.value.length > 32 ? " long" : ""}`}>{renderInline(a.value)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {c.price ? <div className="dlg-card-opt-price">{c.price}</div> : null}
                    {c.priceNote ? <div className="dlg-card-opt-pricenote">{renderInline(c.priceNote)}</div> : null}
                  </>
                );
                return tappable ? (
                  <button type="button" className={cls} key={ci} onClick={() => onSelect!(c.title)} aria-label={`Choose ${c.title}`}>
                    {inner}
                  </button>
                ) : (
                  <div className={cls} key={ci}>
                    {inner}
                  </div>
                );
              })}
            </div>
          );
        }
      } else {
        // Plain fenced code block.
        nodes.push(<pre className="dlg-md-pre" key={k++}><code>{body.join("\n")}</code></pre>);
      }
      continue;
    }
    // Table: a header row followed by a |---|---| separator, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!) && !isTableSep(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      nodes.push(
        <div className="dlg-md-tablewrap" key={k++}>
          <table className="dlg-md-table">
            <thead>
              <tr>{header.map((h, j) => <th key={j}>{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => <td key={ci}>{renderInline(r[ci] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    // Horizontal rule: --- / *** on its own line (not a table separator — those
    // are consumed by the table branch above).
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      nodes.push(<hr key={k++} className="dlg-md-hr" />);
      i++;
      continue;
    }
    // Headings: #..#### — rendered as compact section titles inside the bubble.
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) {
      nodes.push(
        <div key={k++} className={`dlg-md-h dlg-md-h${h[1]!.length}`}>
          {renderInline(h[2]!)}
        </div>
      );
      i++;
      continue;
    }
    // Blockquote: consecutive "> " lines grouped into one quote block.
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      nodes.push(
        <blockquote key={k++} className="dlg-md-quote">
          {quote.map((q, j) => (
            <React.Fragment key={j}>{j > 0 ? <br /> : null}{renderInline(q)}</React.Fragment>
          ))}
        </blockquote>
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={k++} className="dlg-md-list">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      // A paragraph ends at the next block, INCLUDING a fence. Without the fence
      // test a line like "1. Current trade / postal licence" followed straight by
      // ```upload (no blank line) swallowed the whole block, so the upload widget
      // rendered as literal backticks and `key: updated_trade_license` lost its
      // underscores to italics.
      const isBlock = (l: string) =>
        /^\s*```/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l) || /^\s*#{1,4}\s+/.test(l) || /^\s*>\s?/.test(l);
      // The first line is ALWAYS consumed, so this branch can never fail to
      // advance `i`. It reaches here having matched no earlier branch, which
      // includes a fence the block matcher rejected — a half-typed one mid-stream
      // (```s … ```sum) or an unrecognised type (```json). Testing isBlock before
      // taking anything left those spinning forever and locked up the tab.
      const para: string[] = [lines[i]!];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "" && !isBlock(lines[i]!)) {
        para.push(lines[i]!);
        i++;
      }
      const paraText = para.join("\n").trim();
      // Skip a paragraph identical to the previous one (a cross-round re-emit).
      if (paraText && paraText === lastPara) continue;
      lastPara = paraText;
      nodes.push(
        <p key={k++} className="dlg-md-p">
          {para.map((pl, j) => (
            <React.Fragment key={j}>{j > 0 ? <br /> : null}{renderInline(pl)}</React.Fragment>
          ))}
        </p>
      );
    }
  }
  return <>{nodes}</>;
}
