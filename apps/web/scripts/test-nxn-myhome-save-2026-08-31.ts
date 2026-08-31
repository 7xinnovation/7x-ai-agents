/**
 * The MyHome save, exercised without touching Emirates Post (2026-08-31).
 *
 * Three things have to hold: an area the backend does not know is refused BEFORE
 * the call rather than after it (the customer keeps their hold and their money),
 * a recognised area is rewritten to the code the backend matches on, and the
 * branch officeId survives the emirate rewrite that the MyHome box lookup needs.
 *
 * Run from apps/web:  npx tsx scripts/test-nxn-myhome-save-2026-08-31.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { buildApiTools } from "@/lib/integrations";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${label}` : `FAIL ${label}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const SAVE = "nxnstaging__post_api_Rental_Save";
const FREEBOXES = "nxnstaging__get_api_Rental_FreeBoxes";

const profile = {
  customerNameEN: "Admin PECME Global",
  email: "admin@pecmeglobal.com",
  mobileNumber: "0553708000",
  idNumber: "784199983926421",
  idType: "EmiratesID",
};

function saveBody(area: string) {
  return {
    body: {
      totalAmount: 1770,
      subscriptionReferenceNumber: "260611716",
      userProfile: profile,
      requestSource: "PoBoxAIBot",
      myHomeProfile: {
        emailID: profile.email,
        mobileNo: profile.mobileNumber,
        myHomeAddress: { emirateCode: "DXB", regionName: area, detailedAddress: "Sobha Hartland" },
      },
      keyDeliveryAddress: { name: profile.customerNameEN, mobileNo: profile.mobileNumber, emirateCode: "DXB", deliveryAddress: "Sobha Hartland" },
      paymentProperties: { paymentReturnUrl: "https://example.invalid/return", saveCreditCard: true, isAutomaticSubscriptionEnabled: true },
    },
  };
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");

  const hold = {
    reference: "260611716",
    amount: 1745,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    uniqueBoxId: "987022",
    bundleId: "MYHOME3",
    // What Emirates Post priced for this box. MyHome has no KEY-DELIVERY line:
    // the key comes with the box, and asking for courier returns 223.
    services: ["RENT", "REGISTRATION"],
  };

  // 1. An area Emirates Post does not deliver to never reaches the network.
  {
    const real = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      if (String(a[0]).includes("box-stg")) called = true;
      return real(...a);
    }) as typeof fetch;
    const t = await buildApiTools(row.id, "staging", { initialHold: hold, sessionToken: "test-session" });
    const res = await t.exec(SAVE, saveBody("Sobha Hartland"));
    globalThis.fetch = real;
    check("unknown area is refused", res.isError === true, res.result?.slice(0, 120));
    check("nothing is sent to Emirates Post", called === false);
    check("the refusal says the customer is not charged", /NOT been charged/i.test(res.result));
    check("nothing close by is not padded out with guesses", !/DXB-\d+ = /.test(res.result));

    // A community name Emirates Post has never heard of, next to a district it
    // has, should surface the district rather than a shrug.
    const t2 = await buildApiTools(row.id, "staging", { initialHold: hold, sessionToken: "test-session" });
    const near = await t2.exec(SAVE, saveBody("Sobha Hartland, Nad Al Sheeba"));
    check("a partial match offers real areas to pick from", /DXB-84 = Nad Al Sheeba 1/.test(near.result), near.result?.slice(0, 400));
    check("it does not dump all 400 areas", (near.result.match(/DXB-\d+ = /g) ?? []).length <= 12);
  }

  // 2. A recognised area goes out as the CODE, with the branch attached.
  {
    const real = globalThis.fetch;
    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      const url = String(a[0]);
      if (url.includes("Rental/FreeBoxes")) {
        // The lookup the officeId has to survive.
        return new Response(JSON.stringify({ payload: [{ boxId: "987022", uniqueBoxId: "987022" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("Rental/Save")) {
        sent = JSON.parse(String((a[1] as RequestInit)?.body ?? "{}"));
        return new Response(JSON.stringify({ payload: { orderNo: "1", paymentGateWayResponse: { referenceNumber: "x", paymentUrl: "https://p" } } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return real(...a);
    }) as typeof fetch;

    const t = await buildApiTools(row.id, "staging", { initialHold: hold, sessionToken: "test-session" });
    await t.exec(FREEBOXES, { BundleId: "MYHOME3", LocationId: "201" });
    await t.exec(SAVE, saveBody("Nad Al Sheeba 1"));
    globalThis.fetch = real;

    const mh = (sent as Record<string, any> | null)?.myHomeProfile;
    check("the area goes out as its code", mh?.myHomeAddress?.regionName === "DXB-84", mh?.myHomeAddress);
    check("the address in the customer's words is kept", mh?.myHomeAddress?.detailedAddress === "Sobha Hartland");
    check("the branch survives the emirate rewrite", mh?.deliveryOfficeID === "201", mh?.deliveryOfficeID);
    const extras = (sent as Record<string, any> | null)?.additionalServiceDetailList;
    check("an extra this bundle was never priced for is not sent", extras === undefined, extras);
    check("and the address for it goes with it", (sent as Record<string, any> | null)?.keyDeliveryAddress === undefined);
    check("the branch id the model invented is overwritten", mh?.deliveryOfficeID === "201");
  }

  // 2b. A bundle that DOES price key delivery gets the line the portal sends.
  {
    const real = globalThis.fetch;
    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      const url = String(a[0]);
      if (url.includes("Rental/Save")) {
        sent = JSON.parse(String((a[1] as RequestInit)?.body ?? "{}"));
        return new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(...a);
    }) as typeof fetch;
    const t = await buildApiTools(row.id, "staging", {
      initialHold: { ...hold, bundleId: "IN", services: ["RENT", "KEY-DELIVERY"] },
      sessionToken: "test-session",
    });
    await t.exec(SAVE, { body: { ...saveBody("DXB-161").body, myHomeProfile: undefined } });
    globalThis.fetch = real;
    const extras = (sent as Record<string, any> | null)?.additionalServiceDetailList ?? [];
    check("a priced extra IS declared, not just charged for",
      extras.some((e: any) => e.serviceType === "KEY-DELIVERY" && e.quantity === 1), extras);
  }

  // 3. A code the customer picked is passed through untouched.
  {
    const real = globalThis.fetch;
    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      const url = String(a[0]);
      if (url.includes("Rental/Save")) {
        sent = JSON.parse(String((a[1] as RequestInit)?.body ?? "{}"));
        return new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(...a);
    }) as typeof fetch;
    const t = await buildApiTools(row.id, "staging", { initialHold: hold, sessionToken: "test-session" });
    await t.exec(SAVE, saveBody("DXB-161"));
    globalThis.fetch = real;
    check("a code the customer picked is left alone",
      (sent as Record<string, any> | null)?.myHomeProfile?.myHomeAddress?.regionName === "DXB-161");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
