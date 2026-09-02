/**
 * What actually goes out on the Emirates Post saves (2026-09-02).
 *
 * Four things the customer gave us and we were not sending: the trade licence on
 * a corporate rental, the agent's ID pages, a key-delivery address in the shape
 * their courier reads, and — on the guest renewal — the subscriber details that
 * their own flow asks for before it will take a payment. The guest save answered
 * 500 without them, and a 500 names nothing.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-nxn-save-payload-2026-09-02.ts
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
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const SAVE = "nxnstaging__post_api_Rental_Save";
const GUEST_SAVE = "nxnstaging__post_api_Guest_Renewal_Save";

const [row] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
if (!row) throw new Error("nxn-dialog not found");

const hold = {
  reference: "260611719", amount: 370, uniqueBoxId: "2450063", bundleId: "IN",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), services: ["RENT"],
};
const FILES = [
  { key: "trade_license", fileName: "Postal GSI.pdf", fileFormat: ".pdf", base64: "AAAA" },
  { key: "agent_eid_front", fileName: "front.jpg", fileFormat: ".jpg", base64: "BBBB" },
  { key: "agent_eid_back", fileName: "back.jpg", fileFormat: ".jpg", base64: "CCCC" },
];

/** Run a tool with the network stubbed, and return what went out. */
async function sent(tool: string, input: unknown, opts: Record<string, unknown> = {}) {
  const real = globalThis.fetch;
  let body: Record<string, any> | null = null;
  globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
    const url = String(a[0]);
    if (url.includes("box-stg")) {
      body = JSON.parse(String((a[1] as RequestInit)?.body ?? "{}"));
      return new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(...a);
  }) as typeof fetch;
  const t = await buildApiTools(row!.id, "staging", { sessionToken: "test-session", ...opts });
  const r = await t.exec(tool, input as Record<string, unknown>);
  globalThis.fetch = real;
  return { body: body as Record<string, any> | null, result: r };
}

// 1. A corporate rental carries the trade licence; the agent carries their ID.
{
  const { body } = await sent(SAVE, {
    body: {
      totalAmount: 370, subscriptionReferenceNumber: hold.reference,
      userProfile: { customerNameEN: "Emre Karayalcin", email: "e@x.ae", mobileNumber: "0553708000" },
      mainCorporateProfile: { companyNameEn: "GULF SYSTEM", tradeLicenseNo: "1068994", emirateCode: "DXB" },
      listBoxAgentDetail: [{ emailId: "a@x.ae", emiratesId: "784199983926421" }],
      paymentProperties: { paymentReturnUrl: "https://x.invalid" },
    },
  }, { initialHold: hold, rentalAttachments: async () => FILES });

  const corp = body?.mainCorporateProfile?.attachments ?? [];
  check("the trade licence is attached to the company", corp.length === 1 && corp[0].attachmentName === "Postal GSI.pdf", corp);
  check("with the type their portal uses for a licence", corp[0]?.attachmentType === 3, corp[0]);
  check("and the file itself", corp[0]?.attachment === "AAAA" && corp[0]?.fileFormat === ".pdf", corp[0]);

  const ag = body?.listBoxAgentDetail?.[0]?.attachments ?? [];
  check("both sides of the agent's ID are attached", ag.length === 2, ag);
  check("front is 1 and back is 2", ag[0]?.attachmentType === 1 && ag[1]?.attachmentType === 2, ag.map((x: any) => x.attachmentType));
}

// 2. Nothing to attach must not invent anything.
{
  const { body } = await sent(SAVE, {
    body: {
      totalAmount: 370, subscriptionReferenceNumber: hold.reference,
      userProfile: { customerNameEN: "A B", email: "e@x.ae" },
      mainCorporateProfile: { companyNameEn: "X" },
      paymentProperties: {},
    },
  }, { initialHold: hold, rentalAttachments: async () => [] });
  check("no files means no attachments key", body?.mainCorporateProfile?.attachments === undefined, body?.mainCorporateProfile);
}

// 3. The key delivery address is composed from the parts, not left as typed.
{
  const { body } = await sent(SAVE, {
    body: {
      totalAmount: 370, subscriptionReferenceNumber: hold.reference,
      userProfile: {
        customerNameEN: "Emre Karayalcin", email: "e@x.ae", mobileNumber: "0553708000",
        customersAddress: { regionName: "Al Barsha 1", streetOrLandmark: "Casablanca 01 street", villaOrApartmentNo: "21", buildingName: "221", emirateCode: "DXB" },
      },
      keyDeliveryAddress: { deliveryAddress: "Al Barsha" },
      paymentProperties: {},
    },
  }, { initialHold: { ...hold, services: ["RENT", "KEY-DELIVERY"] } });
  const kd = body?.keyDeliveryAddress;
  check("the address is built from its parts",
    kd?.deliveryAddress === "Al Barsha 1, Casablanca 01 street, No:21, 221", kd?.deliveryAddress);
  check("the emirate, name and mobile are filled in",
    kd?.emirateCode === "DXB" && kd?.name === "Emre Karayalcin" && kd?.mobileNo === "0553708000", kd);
}

// 4. A fuller address the customer wrote out is never replaced by a shorter one.
{
  const written = "Villa 12, Street 4, Al Barsha 1, near the Mall of the Emirates, Dubai";
  const { body } = await sent(SAVE, {
    body: {
      totalAmount: 370, subscriptionReferenceNumber: hold.reference,
      userProfile: { customerNameEN: "A B", customersAddress: { regionName: "Al Barsha 1", villaOrApartmentNo: "12" } },
      keyDeliveryAddress: { deliveryAddress: written },
      paymentProperties: {},
    },
  }, { initialHold: { ...hold, services: ["RENT", "KEY-DELIVERY"] } });
  check("a fuller written address is kept", body?.keyDeliveryAddress?.deliveryAddress === written, body?.keyDeliveryAddress);
}

// 4b. A bundle that does not price key courier loses the address with the line.
{
  const { body } = await sent(SAVE, {
    body: {
      totalAmount: 370, subscriptionReferenceNumber: hold.reference,
      userProfile: { customerNameEN: "A B" },
      keyDeliveryAddress: { deliveryAddress: "somewhere" },
      paymentProperties: {},
    },
  }, { initialHold: { ...hold, services: ["RENT"] } });
  check("an unpriced key courier takes its address with it", body?.keyDeliveryAddress === undefined, body?.keyDeliveryAddress);
}

// 5. The guest renewal is refused without the subscriber, not sent and 500'd.
{
  const { body, result } = await sent(GUEST_SAVE, {
    body: { boxNumber: 1234, emirateCode: "DXB", expiryDate: "2032-12-20T00:00:00", totalAmount: 995, renewedBy: "19147" },
  });
  check("an incomplete guest renewal is refused", result.isError === true, result.result?.slice(0, 90));
  check("and never reaches Emirates Post", body === null);
  check("the refusal names what is missing", /first name.*last name.*mobile.*email/is.test(result.result), result.result?.slice(0, 200));
}

// 6. With the subscriber, it goes — with billing completed and no account extras.
{
  const { body } = await sent(GUEST_SAVE, {
    body: {
      boxNumber: 1234, emirateCode: "DXB", expiryDate: "2032-12-20T00:00:00", totalAmount: 995, renewedBy: "19147",
      customerKYC: { firstName: "Emre", lastName: "Karayalcin", email: "e@x.ae", mobileNumber: "0553708000", area: "Al Barsha" },
      paymentProperties: { saveCreditCard: true, isAutomaticSubscriptionEnabled: true },
    },
  }, { paymentReturnUrl: "https://7xagents.7x-lab.com/api/payments/ext-return" });
  const bd = body?.paymentProperties?.billingDetail;
  check("billing detail is completed, all six fields",
    bd && bd.firstName === "Emre" && bd.lastName === "Karayalcin" && bd.emailAddress === "e@x.ae" &&
      bd.address && bd.cityName && bd.countryName, bd);
  check("the return URL is set for us", body?.paymentProperties?.paymentReturnUrl?.includes("ext-return"), body?.paymentProperties);
  check("a guest is never signed up to save a card",
    body?.paymentProperties?.saveCreditCard === false && body?.paymentProperties?.isAutomaticSubscriptionEnabled === false,
    body?.paymentProperties);
}

// 7. The total is Emirates Post's arithmetic, not the model's.
//
// minimumAmount 370 already covers rent, registration and the FIRST agent --
// its AGENT line comes back marked Inclusive. One agent plus courier is 400,
// not 450, and the backend refuses anything else with MISMATCH_IN_AMOUNT.
{
  const priced = { ...hold, amount: 370, services: ["AGENT", "RENT", "KEY-DELIVERY", "NEW-REG"], agentExtraPrice: 50, keyDeliveryPrice: 30 };
  const base = {
    subscriptionReferenceNumber: hold.reference,
    userProfile: { customerNameEN: "A B", email: "e@x.ae" },
    paymentProperties: {},
  };

  const one = await sent(SAVE, { body: { ...base, totalAmount: 450, listBoxAgentDetail: [{ emailId: "a@x.ae" }], keyDeliveryAddress: { deliveryAddress: "x" } } }, { initialHold: priced });
  check("one agent plus courier is 370 + 30", one.body?.totalAmount === 400, one.body?.totalAmount);

  const two = await sent(SAVE, { body: { ...base, totalAmount: 0, listBoxAgentDetail: [{ emailId: "a@x.ae" }, { emailId: "b@x.ae" }], keyDeliveryAddress: { deliveryAddress: "x" } } }, { initialHold: priced });
  check("a second agent adds its own fee", two.body?.totalAmount === 450, two.body?.totalAmount);

  const none = await sent(SAVE, { body: { ...base, totalAmount: 999 } }, { initialHold: priced });
  check("no agent and no courier is the minimum", none.body?.totalAmount === 370, none.body?.totalAmount);

  // serviceCriteria off priceDetails is "M"/"A"/"I"; the save's enum is
  // Mandatory/Additional/Inclusive. Copying one into the other 400s.
  const dirty = await sent(SAVE, {
    body: {
      ...base, totalAmount: 400, listBoxAgentDetail: [{ emailId: "a@x.ae" }], keyDeliveryAddress: { deliveryAddress: "x" },
      additionalServiceDetailList: [
        { serviceType: "AGENT", quantity: 1, serviceCriteria: "I", price: 50 },
        { serviceType: "RENT", quantity: 1, serviceCriteria: "M" },
      ],
    },
  }, { initialHold: priced });
  const list = dirty.body?.additionalServiceDetailList ?? [];
  check("the extras list is rebuilt, not corrected",
    list.length === 2 && list.every((x: any) => Object.keys(x).sort().join() === "quantity,serviceType"), list);
  check("and it names only what was chosen",
    list.map((x: any) => x.serviceType).sort().join() === "AGENT,KEY-DELIVERY", list.map((x: any) => x.serviceType));
}

// 8. A card Emirates Post already holds is sent with the order.
{
  const priced = { ...hold, amount: 370, services: ["RENT"], agentExtraPrice: 50, keyDeliveryPrice: 30 };
  const card = { cardToken: "dG9rZW4=", maskedPan: "*****1111", expiry: "2030-12", scheme: "VISA", cardholderName: "Test Card" };
  // A fresh body each time: the save patches paymentProperties in place, so a
  // shared literal would carry the first test's card into the next.
  const base = () => ({ subscriptionReferenceNumber: hold.reference, userProfile: { customerNameEN: "A B", email: "e@x.ae" }, paymentProperties: {} });

  const withCard = await sent(SAVE, { body: { ...base(), totalAmount: 370 } }, { initialHold: priced, savedCard: async () => card });
  const sc = withCard.body?.paymentProperties?.savedCard;
  check("the saved card rides along with the order", sc?.cardToken === card.cardToken, sc);
  check("with what the payment page needs to show it",
    sc?.maskedPan === "*****1111" && sc?.scheme === "VISA" && sc?.expiry === "2030-12", sc);

  const noCard = await sent(SAVE, { body: { ...base(), totalAmount: 370 } }, { initialHold: priced, savedCard: async () => null });
  check("no card on file means none is sent", noCard.body?.paymentProperties?.savedCard === undefined, noCard.body?.paymentProperties);

  const guest = await sent(SAVE, { body: { ...base(), totalAmount: 370 } }, { initialHold: priced });
  check("a guest never has one attached", guest.body?.paymentProperties?.savedCard === undefined, guest.body?.paymentProperties);

  const chosen = { ...card, cardToken: "theirs" };
  const already = await sent(SAVE, { body: { ...base(), totalAmount: 370, paymentProperties: { savedCard: chosen } } }, { initialHold: priced, savedCard: async () => card });
  check("a card already on the payload is not replaced",
    already.body?.paymentProperties?.savedCard?.cardToken === "theirs", already.body?.paymentProperties?.savedCard);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
