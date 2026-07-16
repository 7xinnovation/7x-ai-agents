/**
 * TEST-ONLY simulated UAE PASS persona for the NXN agent.
 *
 * Active only when UAE PASS mock mode is on (UAEPASS_MOCK=1): the mock callback
 * signs everyone in as "uaepass-mock-001", and this gives that persona a couple
 * of existing PO Boxes so the signed-in flows (Account Pulse, renewal, manage,
 * status) have real account data to work with instead of asking for a box
 * number. It is keyed to the mock sub, so a real signed-in customer (whose
 * userRef is their own UAE PASS sub) never sees this canned data.
 */
export const MOCK_PERSONA_SUB = "uaepass-mock-001";
export const MOCK_PERSONA_NAME = "Ahmed Al Mansoori";

export interface MockBox {
  box: string;
  emirate: string;
  branch: string;
  bundle: string;
  rate: string; // standard published annual rate
  expiry: string;
  autoRenew: boolean;
  savedCard?: string;
}

// Two boxes on purpose: one with auto-renewal OFF + no saved card (exercises the
// full renewal + save-card/auto-renew consent path), and one with auto-renewal
// ON + a saved card (exercises the "already set to auto-renew" shortcut, FB-1168).
export const MOCK_PERSONA_BOXES: MockBox[] = [
  { box: "50500", emirate: "Dubai", branch: "Al Barsha Post Office", bundle: "MyHome", rate: "AED 695 / year", expiry: "19 Aug 2026", autoRenew: false },
  { box: "33417", emirate: "Abu Dhabi", branch: "Khalidiya Post Office", bundle: "MyBox", rate: "AED 300 / year", expiry: "03 Feb 2026", autoRenew: true, savedCard: "Visa ending 4242" },
];

/**
 * System-prompt context describing the signed-in persona + its PO Boxes, so the
 * model uses the boxes on file across every authenticated flow without asking.
 */
export function mockPersonaContext(): string {
  const lines = MOCK_PERSONA_BOXES.map(
    (b, i) =>
      `${i + 1}) PO Box ${b.box}, ${b.emirate} — ${b.branch}, ${b.bundle} bundle (${b.rate}), expires ${b.expiry}, ` +
      `auto-renewal ${b.autoRenew ? "ON" : "OFF"}, ${b.savedCard ? `card on file (${b.savedCard})` : "no saved card"}.`
  ).join(" ");
  return (
    `The signed-in customer is ${MOCK_PERSONA_NAME}. PO Boxes on file: ${lines} ` +
    "This is a TEST account. For questions about THESE existing boxes — account questions, status checks, renewals of a box on file, the Account Pulse, or managing a box — treat the details above as authoritative account data (no external lookup needed) and use each box's standard annual rate as its renewal price; use these boxes immediately without asking for the box number or emirate, and when more than one applies let the customer pick. " +
    "This does NOT apply to renting a NEW box: for a new PO Box rental you MUST use the live Emirates Post tools (Rental/Bundle, Rental/BoxLocations, Rental/FreeBoxes, Rental/ExpiryDates) to fetch the real bundles, branches, available box numbers and dates — never invent them."
  );
}

/**
 * TEST-ONLY response simulation for the mock persona.
 *
 * Some real Emirates Post operations can't work for the mock persona because it
 * has no live EP backend session and its boxes aren't real staging records:
 *  - Rental/FreeBoxes needs an authenticated EP session → 401 (the agent then
 *    dead-ends asking for a one-time passcode).
 *  - Guest/Renewal/Details + Guest/Renewal/Pricing error on the fake box number,
 *    so renewal can't show a price.
 * When the mock persona is signed in we substitute realistic, self-consistent
 * responses for exactly these ops so the whole demo (new box + renewal) flows.
 * Everything else still hits the real API. Keyed to the mock persona only — a
 * real customer never gets simulated data.
 */
const MOCK_BASE_YEAR = 2026; // the mock boxes' current expiry year (see MOCK_PERSONA_BOXES)

function mockBoxByNumber(box: string): MockBox | undefined {
  return MOCK_PERSONA_BOXES.find((b) => b.box === String(box ?? "").trim());
}
function bundleIdFor(b: MockBox): string {
  return /intensive/i.test(b.bundle) ? "MYHOMEINT" : /mybox/i.test(b.bundle) ? "MYBOX1" : "MYHOME3";
}
function annualRateFor(b: MockBox): number {
  const m = b.rate.match(/(\d[\d,]*)/);
  return m ? parseInt(m[1]!.replace(/,/g, ""), 10) : 695;
}
function rateForBundleId(bundleId: string): number {
  return /intensive/i.test(bundleId) ? 995 : /mybox/i.test(bundleId) ? 300 : 695;
}
// Deterministic 5-digit box numbers (stable across refreshes; no Math.random).
function seededBoxNumbers(seed: string, n: number): string[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const base = 10000 + (Math.abs(h) % 89000);
  return Array.from({ length: n }, (_, i) => String(base + i * 13 + (i % 5)));
}

/** Simulate a mock EP response for the ops that can't hit the real API; null = not simulated. */
export function simulateNxnMockOp(
  toolName: string,
  input: Record<string, unknown>
): { result: string; isError?: boolean } | null {
  const t = toolName.toLowerCase();
  const inp = (input ?? {}) as Record<string, any>;
  const ok = (body: unknown) => ({ result: `HTTP 200 OK\n${JSON.stringify(body)}`, isError: false });

  if (t.includes("rental_freeboxes")) {
    const bundleId = String(inp.BundleId ?? inp.bundleId ?? "");
    const locationId = String(inp.LocationId ?? inp.locationId ?? "");
    const boxes = seededBoxNumbers(`${bundleId}|${locationId}`, 12);
    return ok({
      success: true, simulated: true, count: boxes.length,
      availableBoxNumbers: boxes,
      freeBoxes: boxes.map((b) => ({ boxNumber: b, available: true })),
    });
  }

  if (t.includes("guest_renewal_details")) {
    // Echo the box number the customer actually entered (guests type an arbitrary
    // box, e.g. 5200); fall back to a known mock box for the bundle/rate.
    const reqBox = String(inp.BoxNumber ?? inp.boxNumber ?? "").trim();
    const b = mockBoxByNumber(reqBox) ?? MOCK_PERSONA_BOXES[0]!;
    return ok({
      success: true, simulated: true,
      payload: {
        poBoxRenewalDetails: {
          boxNumber: reqBox || b.box,
          emirateCode: String(inp.EmirateCode ?? inp.emirateCode ?? ""),
          bundleId: bundleIdFor(b),
          bundleName: b.bundle,
          currentExpiryDate: `${MOCK_BASE_YEAR}-08-19T00:00:00`,
          isRenewable: true,
          autoRenew: b.autoRenew,
          annualPrice: annualRateFor(b),
        },
      },
    });
  }

  if (t.includes("guest_renewal_pricing")) {
    let body: any = inp.body ?? inp;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const bundleId = String(body.newBundleId ?? body.NewBundleId ?? body.bundleId ?? "");
    const expiryDate = String(body.expiryDate ?? body.ExpiryDate ?? "");
    const yr = parseInt((expiryDate.match(/(\d{4})/) ?? [])[1] ?? "0", 10);
    const years = Math.min(Math.max(yr > MOCK_BASE_YEAR ? yr - MOCK_BASE_YEAR : 1, 1), 10);
    const rate = rateForBundleId(bundleId);
    const total = rate * years;
    return ok({
      success: true, simulated: true, currency: "AED",
      numberOfYears: years, annualPrice: rate,
      totalPrice: total, price: total, amount: total, expiryDate,
    });
  }

  return null;
}
