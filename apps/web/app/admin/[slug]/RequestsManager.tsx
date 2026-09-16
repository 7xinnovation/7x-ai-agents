"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw, Search, ExternalLink, ChevronRight, FileText, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Row {
  caseId: string;
  conversationId: string;
  reference: string | null;
  recordId: string | null;
  journey: string | null;
  subject: string | null;
  customer: string | null;
  email: string | null;
  phone: string | null;
  amount: number | null;
  currency: string;
  paymentStatus: string;
  documents: { total: number; attached: number };
  sentToRecord: "ok" | "failed" | "none";
  locale: string;
  authenticated: boolean;
  completedAt: string;
}
interface Detail extends Row {
  confirmation: { title: string | null; rows: { label: string; value: string }[]; total: string | null } | null;
  confirmationKind: "confirmation" | "latest";
  confirmationText: string | null;
  fields: { key: string; label: string; value: string }[];
  docs: { key: string; label: string; status: string; fileName: string | null; rejectionReason: string | null }[];
  calls: { at: string; action: string; tool: string | null; method: string | null; path: string | null; request: unknown; response: string | null; ok: boolean }[];
  emails: { at: string; action: string; to: string | null; subject: string | null; reason: string | null }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const money = (v: number | null, ccy: string) =>
  typeof v === "number" ? `${ccy} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const journeyName = (k: string | null) => (k ? k.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "—");

/**
 * The record of what actually completed.
 *
 * Asked for on 16 September: "a tab for EPGL and Emirates Post where it shows the
 * confirmed summaries for each request that was completed with all the details —
 * to keep track of the requests that come in through here alongside how we send
 * it to Salesforce."
 *
 * So each row carries both sides of that question. The confirmation is the card
 * the customer was actually shown, read back from the transcript rather than
 * rebuilt here; the calls are the audited requests and responses from the system
 * of record. When the two disagree — a confirmed application whose write failed —
 * the list says so without anyone opening it.
 */
export function RequestsManager({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/requests`);
      const j = await res.json();
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    let live = true;
    setDetailLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/agents/${slug}/requests?case=${encodeURIComponent(open)}`);
        if (live && res.ok) setDetail(await res.json());
      } finally {
        if (live) setDetailLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open, slug]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.reference, r.recordId, r.subject, r.customer, r.email, r.phone, r.journey]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, q]);

  const paid = filtered.filter((r) => r.paymentStatus === "paid");
  const collected = paid.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Completed requests</h3>
              <p className="mt-1 text-[12.5px] text-muted">
                Every request that reached the system of record or settled a payment — the confirmation the
                customer was shown, and what we sent onward.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
              </Button>
              <a href={`/api/admin/agents/${slug}/requests?format=csv`}>
                <Button variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV</Button>
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-[#d0d5dd] bg-surface px-3 shadow-[var(--shadow-xs)] focus-within:border-[var(--color-brand)] focus-within:ring-4 focus-within:ring-[var(--color-ring)]">
              <Search className="h-4 w-4 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Reference, company, customer, email"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </div>
            <div className="flex items-center gap-4 text-[12.5px] text-muted">
              <span><strong className="text-ink">{filtered.length}</strong> request{filtered.length === 1 ? "" : "s"}</span>
              <span><strong className="text-ink">{paid.length}</strong> paid</span>
              {collected > 0 && <span><strong className="text-ink">{money(collected, paid[0]?.currency ?? "AED")}</strong> collected</span>}
            </div>
          </div>

          {loading ? (
            <p className="py-6 text-center text-[13px] text-muted">Loading…</p>
          ) : !filtered.length ? (
            <p className="py-6 text-center text-[13px] text-muted">
              {rows.length ? "Nothing matches that search." : "No completed requests yet."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="bg-[var(--color-canvas)] text-[12px] font-semibold text-muted">
                  <tr>
                    <th className="px-3 py-2">Completed</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2">Request</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Docs</th>
                    <th className="px-3 py-2">Sent</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.caseId}
                      onClick={() => setOpen(open === r.caseId ? null : r.caseId)}
                      className={cn(
                        "cursor-pointer border-t border-[var(--color-line)] transition-colors hover:bg-[var(--color-canvas)]",
                        open === r.caseId && "bg-[var(--color-canvas)]"
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{when(r.completedAt)}</td>
                      <td className="px-3 py-2.5 font-semibold text-ink">{r.reference ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{r.subject ?? "—"}</div>
                        <div className="text-[12px] text-muted">{journeyName(r.journey)}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{r.customer ?? "—"}</div>
                        <div className="text-[12px] text-muted">{r.email ?? ""}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="font-medium text-ink">{money(r.amount, r.currency)}</div>
                        <Badge tone={r.paymentStatus === "paid" ? "live" : r.paymentStatus === "failed" ? "draft" : "muted"}>
                          {r.paymentStatus}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {r.documents.total ? `${r.documents.attached}/${r.documents.total}` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={r.sentToRecord === "ok" ? "live" : r.sentToRecord === "failed" ? "draft" : "muted"} dot>
                          {r.sentToRecord === "ok" ? "sent" : r.sentToRecord === "failed" ? "failed" : "not sent"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted">
                        <ChevronRight className={cn("h-4 w-4 transition-transform", open === r.caseId && "rotate-90")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardContent className="grid gap-5 pt-5">
            {detailLoading && !detail ? (
              <p className="py-6 text-center text-[13px] text-muted">Loading…</p>
            ) : !detail ? (
              <p className="py-6 text-center text-[13px] text-muted">That request could not be loaded.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-ink">{detail.reference ?? "Request"}</h3>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {journeyName(detail.journey)} · {when(detail.completedAt)} · {detail.locale.toUpperCase()} ·{" "}
                      {detail.authenticated ? "signed in" : "guest"}
                      {detail.recordId ? ` · record ${detail.recordId}` : ""}
                    </p>
                  </div>
                  <Link href={`/admin/conversations/${detail.conversationId}`} target="_blank">
                    <Button variant="outline"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open conversation</Button>
                  </Link>
                </div>

                {/* THE CONFIRMED SUMMARY — the card the customer was shown, as it
                    was written. Not rebuilt from the case: if the two ever differ
                    that is worth seeing, not smoothing over. */}
                {detail.confirmation ? (
                  <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
                    {/* Named for what it IS. A conversation carries on past the
                        confirmation, so the last card in a transcript is often
                        something else entirely — a branch's opening hours. */}
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {detail.confirmationKind === "confirmation" ? "Confirmed summary" : "Last summary shown (no confirmation card found)"}
                    </div>
                    {detail.confirmation.title && (
                      <div className="mt-2 text-[13.5px] font-semibold text-ink">{detail.confirmation.title}</div>
                    )}
                    <dl className="mt-2 grid gap-1.5">
                      {detail.confirmation.rows.map((row, i) => (
                        <div key={i} className="flex justify-between gap-6 border-b border-[var(--color-line)] pb-1.5 text-[13px] last:border-0">
                          <dt className="text-muted">{row.label}</dt>
                          <dd className="text-right font-medium text-ink">{row.value}</dd>
                        </div>
                      ))}
                      {detail.confirmation.total && (
                        <div className="flex justify-between gap-6 pt-1 text-[13px] font-semibold text-ink">
                          <dt>Total</dt>
                          <dd>{detail.confirmation.total}</dd>
                        </div>
                      )}
                    </dl>
                  </section>
                ) : (
                  <p className="text-[12.5px] text-muted">No summary card was shown in this conversation.</p>
                )}

                {detail.confirmationText && (
                  <details className="rounded-xl border border-[var(--color-line)] p-3">
                    <summary className="cursor-pointer text-[13px] font-semibold text-ink">Closing message</summary>
                    <pre className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{detail.confirmationText}</pre>
                  </details>
                )}

                <section>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">All collected details</div>
                  <div className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                    {detail.fields.map((f) => (
                      <div key={f.key} className="flex justify-between gap-4 border-b border-[var(--color-line)] pb-1.5 text-[13px]">
                        <span className="text-muted">{f.label}</span>
                        <span className="text-right font-medium text-ink break-all">{f.value}</span>
                      </div>
                    ))}
                    {!detail.fields.length && <span className="text-[13px] text-muted">Nothing was collected.</span>}
                  </div>
                </section>

                {detail.docs.length > 0 && (
                  <section>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Documents</div>
                    <ul className="mt-2 grid gap-1.5">
                      {detail.docs.map((d) => (
                        <li key={d.key} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <FileText className="h-3.5 w-3.5 text-muted" />
                          <span className="text-ink">{d.label}</span>
                          <span className="text-muted">{d.fileName ?? ""}</span>
                          <Badge tone={d.status === "accepted" || d.status === "uploaded" ? "live" : "muted"}>{d.status}</Badge>
                          {d.rejectionReason && <span className="text-[12px] text-[#b54708]">{d.rejectionReason}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* AND HOW IT WENT TO THE SYSTEM OF RECORD. The audited request
                    and response, so a submission can be reconciled against
                    Salesforce without anyone opening Salesforce. */}
                <section>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sent to the system of record</div>
                  {detail.calls.length ? (
                    <ul className="mt-2 grid gap-2">
                      {detail.calls.map((c, i) => (
                        <li key={i} className="rounded-xl border border-[var(--color-line)]">
                          <details>
                            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                              <Send className="h-3.5 w-3.5 text-muted" />
                              <Badge tone={c.ok ? "live" : "draft"}>{c.ok ? "ok" : "failed"}</Badge>
                              <span className="font-medium text-ink">{c.tool ?? c.action}</span>
                              <span className="text-muted">{c.method ? `${c.method} ` : ""}{c.path ?? ""}</span>
                              <span className="ml-auto text-[12px] text-muted">{when(c.at)}</span>
                            </summary>
                            <div className="grid gap-2 px-3 pb-3">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Request</div>
                                <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-[var(--color-canvas)] p-2 text-[11.5px] leading-relaxed">
{JSON.stringify(c.request ?? {}, null, 2)}
                                </pre>
                              </div>
                              {c.response && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Response</div>
                                  <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-canvas)] p-2 text-[11.5px] leading-relaxed">{c.response}</pre>
                                </div>
                              )}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[13px] text-muted">Nothing was sent — this request never reached the system of record.</p>
                  )}
                </section>

                {detail.emails.length > 0 && (
                  <section>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Confirmation email</div>
                    <ul className="mt-2 grid gap-1.5">
                      {detail.emails.map((e, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <Mail className="h-3.5 w-3.5 text-muted" />
                          <Badge tone={/sent/.test(e.action) ? "live" : "draft"}>{e.action.replace(/_/g, " ")}</Badge>
                          <span className="text-ink">{e.to ?? ""}</span>
                          <span className="text-muted">{e.subject ?? e.reason ?? ""}</span>
                          <span className="ml-auto text-[12px] text-muted">{when(e.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
