import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";

/** Sign a webhook body exactly like a real gateway would, so the mock keeps
 * working when PAYMENT_WEBHOOK_SECRET (HMAC verification) is enabled. */
function sign(body: string): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return "";
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Mock payment gateway checkout page. Stands in for the Network International
 * hosted page: the customer "pays" and the page posts to our webhook (the real
 * gateway would call the webhook server-to-server).
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  // Pre-compute the signed payloads server-side (the secret never reaches the page).
  const bodyPaid = JSON.stringify({ reference: ref, outcome: "paid" });
  const bodyFailed = JSON.stringify({ reference: ref, outcome: "failed" });
  const sigs = JSON.stringify({ paid: sign(bodyPaid), failed: sign(bodyFailed) });
  const bodies = JSON.stringify({ paid: bodyPaid, failed: bodyFailed });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Secure Payment</title>
<style>
  body{font-family:-apple-system,Segoe UI,system-ui,sans-serif;background:#f6f8fc;color:#0b1020;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e7eaf3;border-radius:18px;padding:28px;max-width:380px;width:90%;box-shadow:0 16px 40px rgba(16,24,40,.08)}
  h1{font-size:18px;margin:0 0 6px} p{color:#69728a;font-size:14px;margin:0 0 18px}
  code{font-family:ui-monospace,monospace;font-size:12px;color:#1330f0}
  button{width:100%;height:46px;border:none;border-radius:10px;font:inherit;font-weight:600;font-size:15px;cursor:pointer;margin-top:8px}
  .pay{background:linear-gradient(140deg,#3a52ff,#1330f0);color:#fff}
  .cancel{background:#fff;border:1px solid #e7eaf3;color:#0b1020}
  .done{display:none;text-align:center;color:#0f7a45;font-weight:600;margin-top:14px}
</style></head><body>
<div class="card">
  <h1>Secure Payment</h1>
  <p>Network International (mock gateway)<br>Transaction <code>${ref}</code></p>
  <button class="pay" onclick="finish('paid')">Pay now</button>
  <button class="cancel" onclick="finish('failed')">Cancel payment</button>
  <div class="done" id="done"></div>
</div>
<script>
var SIGS=${sigs}, BODIES=${bodies};
async function finish(outcome){
  var headers={'Content-Type':'application/json'};
  if(SIGS[outcome]) headers['x-dialog-signature']=SIGS[outcome];
  await fetch('/api/payments/webhook',{method:'POST',headers:headers,body:BODIES[outcome]});
  document.querySelectorAll('button').forEach(b=>b.style.display='none');
  var d=document.getElementById('done');d.style.display='block';
  d.textContent = outcome==='paid' ? '✓ Payment successful. Returning you to the chat\\u2026' : 'Payment cancelled. Returning you to the chat\\u2026';
  // Opened as a popup from the chat — hand control back automatically.
  setTimeout(function(){ window.close(); }, 1400);
}
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
