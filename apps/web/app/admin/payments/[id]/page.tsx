/**
 * One transaction: what it was for, what happened, and what was said
 * (6 November 2026).
 *
 * Emirates Post: "under payment section, add more info about the transaction
 * other than the transcription — a page that has the PO Box number, the
 * transaction timeline and the transcription." And: "allow me to export the
 * transaction details" — the Export button here, and the one on the list.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { paymentDetail, statusLabel, type BoxDetails } from "@/lib/paymentDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "Asia/Dubai",
  });
const money = (n: number, ccy = "AED") =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="sa-kv">
      <span>{label}</span>
      <span className={mono ? "sa-mono" : undefined}>{value}</span>
    </div>
  );
}

/** The box rows, only when this was a PO Box transaction. */
const isBox = (b: BoxDetails) => Boolean(b.boxNumber || b.bundle || b.branch);

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await paymentDetail(id);
  if (!d) notFound();
  const { payment: p, box: b } = d;
  const tag = p.status === "paid" ? "ok" : p.status === "failed" ? "bad" : "";

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>
            {isBox(b) && b.boxNumber ? `PO Box ${b.boxNumber}` : "Transaction"}{" "}
            <span className={`sa-tag ${tag}`}>{statusLabel(p.status)}</span>
          </h1>
          <p>
            <Link href="/admin/payments">Payments</Link> / {p.agentName ?? "—"} · {b.journey ?? "—"} · {money(p.amount, p.currency)} · {when(p.createdAt)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="sa-btn primary" href={`/api/admin/payments/${p.id}/export`}>
            Export
          </a>
          {p.conversationId ? (
            <Link className="sa-btn" href={`/admin/conversations/${p.conversationId}`}>
              Full conversation
            </Link>
          ) : null}
        </div>
      </header>

      <div className="sa-cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {isBox(b) ? (
            <section className="sa-panel">
              <div className="sa-panel-head">
                <h2>PO Box</h2>
              </div>
              <Row label="PO Box number" value={b.boxNumber} />
              <Row label="Bundle" value={b.bundle} />
              <Row label="Branch" value={b.branch} />
              <Row label="Emirate" value={b.emirate} />
              <Row label="Duration" value={b.duration} />
              <Row label="Box expiry" value={b.expiry} />
              <Row label="Representative" value={b.representative} />
              <Row label="Key delivery" value={b.keyDelivery} />
              <Row label="Auto-renew" value={b.autoRenew} />
              <Row label="Card saved" value={b.saveCard} />
            </section>
          ) : null}

          <section className="sa-panel">
            <div className="sa-panel-head">
              <h2>Payment</h2>
            </div>
            <Row label="Amount" value={money(p.amount, p.currency)} />
            <Row label="Status" value={statusLabel(p.status)} />
            <Row label="Raised" value={when(p.createdAt)} />
            <Row label="Last updated" value={when(p.updatedAt)} />
            <Row label="Order / application reference" value={b.orderNumber} mono />
            <Row label="Box reservation reference" value={b.holdReference} mono />
            <Row label="Gateway" value={p.provider ?? "default"} />
            <Row label="Gateway reference" value={p.gatewayRef} mono />
            <Row label="Payment reference" value={p.reference} mono />
          </section>

          <section className="sa-panel">
            <div className="sa-panel-head">
              <h2>Customer</h2>
            </div>
            <Row label="Name" value={b.customer} />
            <Row label="Company" value={b.company} />
            <Row label="Trade licence" value={b.tradeLicence} />
            <Row label="Email" value={b.email} />
            <Row label="Phone" value={b.phone} />
            {!b.customer && !b.company && !b.email && !b.phone ? <p className="sa-empty-line">Not recorded.</p> : null}
          </section>

          <section className="sa-panel">
            <div className="sa-panel-head">
              <h2>Timeline</h2>
              <span className="sa-muted">Dubai time</span>
            </div>
            <div className="sa-feed">
              {d.timeline.map((e, i) => (
                <div className="sa-feeditem" key={i}>
                  <span className={`sa-dot ${e.kind === "error" ? "warn" : e.kind === "payment" || e.title === "Order submitted" ? "ok" : ""}`} />
                  <span className="sa-feed-main">
                    <strong>{e.title}</strong>
                    {e.detail ? <span className="sa-feed-sub">{e.detail}</span> : null}
                  </span>
                  <span className="sa-feed-time">{when(e.at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Transcript</h2>
            <span className="sa-muted">{d.messages.length} messages</span>
          </div>
          {d.messages.length === 0 ? (
            <p className="sa-empty-line">No messages.</p>
          ) : (
            <div className="sa-transcript">
              {d.messages.map((m, i) => (
                <div className={`sa-tmsg ${m.role}`} key={i}>
                  <div className="sa-tbubble">{m.content}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
