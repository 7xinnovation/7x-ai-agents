/**
 * Show UAEPay exactly what we sent them (3 November 2026).
 *
 * Five UAEPay payments have failed and nothing in the API log says what left
 * this process: the adapter makes its calls directly, not through a tool, so
 * `api_calls` has never held a single UAEPay request. Every conversation with
 * them has therefore been about a payload neither side was holding.
 *
 * This rebuilds it. The payment row gives the reference, the amount and the
 * case; the case gives the payer; the agent's binding gives the merchant code
 * and the landing URL; and `createLinksBody` — the same function `initiate`
 * calls — composes the body. Nothing is retyped and nothing is sent: no token
 * is minted and no request leaves the machine.
 *
 * The Emirates ID and the mobile are the payer's own and are printed in full by
 * default, because that is the point of the exercise — UAEPay reject payments
 * on the format of those two fields and cannot check one they cannot see.
 * `--redact` masks them for a wider audience.
 *
 * Run from apps/web:
 *   npx tsx scripts/uaepay-payload-2026-11-03.ts --env <envfile> --reference <uuid>
 *   npx tsx scripts/uaepay-payload-2026-11-03.ts --env <envfile> --latest 3 --redact
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { desc, eq, sql } from "drizzle-orm";
import { agents, payments, cases } from "@dialog/db";
import { createLinksBody, uaePayEmiratesId, uaePayMobile } from "@dialog/core";
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const REFERENCE = arg("--reference");
const LATEST = Number(arg("--latest") ?? (REFERENCE ? 0 : 1));
const REDACT = process.argv.includes("--redact");

const mask = (s: string | undefined) =>
  !s ? s : REDACT ? `${s.slice(0, 3)}${"*".repeat(Math.max(0, s.length - 6))}${s.slice(-3)}` : s;

/** The payer, read the way payerDetails reads it. */
function payer(data: Record<string, unknown>) {
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  return {
    emiratesId: pick(["__verified_emirates_id", "emirates_id", "applicant_emirates_id", "owner_emirates_id"]),
    name: pick(["contact_name", "applicant_name", "full_name", "name"]),
    mobile: pick(["contact_phone", "applicant_phone", "mobile", "phone"]),
    email: pick(["contact_email", "email", "applicant_email"]),
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, payments, cases } });
  try {
    const rows = REFERENCE
      ? await db.select().from(payments).where(eq(payments.reference, REFERENCE))
      : await db
          .select()
          .from(payments)
          .where(sql`${payments.provider} = 'uaepay'`)
          .orderBy(desc(payments.createdAt))
          .limit(Math.max(1, LATEST));
    if (!rows.length) throw new Error(REFERENCE ? `no payment with reference ${REFERENCE}` : "no uaepay payments");

    for (const p of rows as Record<string, any>[]) {
      const [agent] = p.agentId ? await db.select().from(agents).where(eq(agents.id, p.agentId)) : [];
      const gw = (agent?.definition as any)?.integrations?.paymentGateways?.[String(p.provider)];
      const settings = gw?.settings ?? {};
      const [kase] = p.conversationId
        ? await db.select().from(cases).where(eq(cases.conversationId, p.conversationId)).limit(1)
        : [];
      const data = ((kase?.state as any)?.data ?? {}) as Record<string, unknown>;
      const who = payer(data);

      console.log("\n" + "=".repeat(78));
      console.log(`reference    ${p.reference}        (this is merchantRequestId)`);
      console.log(`agent        ${agent?.slug ?? "-"}`);
      console.log(`provider     ${p.provider}   status ${p.status}   ${p.amount} ${p.currency}`);
      console.log(`created      ${p.createdAt?.toISOString?.() ?? p.createdAt}`);
      console.log(`host         ${settings.baseUrl ?? "(unset)"}`);
      console.log("=".repeat(78));

      if (String(p.provider) !== "uaepay") {
        console.log("not a UAEPay payment — nothing to compose.");
        continue;
      }
      const eid = uaePayEmiratesId(who.emiratesId);
      if (!eid) {
        console.log(`NO VALID EMIRATES ID ON THIS CASE (${who.emiratesId ?? "absent"}) — initiate would have refused before sending.`);
        continue;
      }
      const body = createLinksBody(
        { merchantCode: String(settings.merchantCode ?? ""), returnUrl: settings.returnUrl as string | undefined },
        {
          caseId: String(kase?.id ?? ""),
          amount: Number(p.amount),
          // The model supplies this per payment and it is not kept on the row;
          // every EPGL licence payment so far has used the journey key.
          description: arg("--description") ?? "new_license",
          email: who.email,
          locale: "en",
          customer: { name: who.name, mobile: who.mobile },
        },
        String(p.reference),
        eid
      );

      // The two fields UAEPay reject on format, shown as they go on the wire.
      const init = (body.paymentInitiator ?? {}) as Record<string, unknown>;
      if (REDACT) {
        init.emiratesId = mask(String(init.emiratesId ?? ""));
        init.mobileNumber = mask(String(init.mobileNumber ?? ""));
        init.email = mask(String(init.email ?? ""));
      }

      console.log(`POST ${settings.baseUrl}/v3/payments/token/createLinks`);
      console.log("Authorization: Bearer <token from /oauth/token/client-credentials>");
      console.log("Content-Type: application/json\n");
      console.log(JSON.stringify(body, null, 2));
      console.log(`\nand the status was read with:`);
      console.log(`GET ${settings.baseUrl}/v2/inquiry/merchant/${settings.merchantCode}/txn/${p.reference}`);
      if (who.mobile && !uaePayMobile(who.mobile)) {
        console.log(`\nNOTE: the mobile on this case (${mask(who.mobile)}) does not normalise to a number they accept.`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
