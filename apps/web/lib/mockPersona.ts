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
/** The Emirates ID UAE Pay's UAT accepts in its own examples — a test number, never a person's. */
export const MOCK_PERSONA_EID = "784199983926421";
// Contact details on the customer profile (Round-2 feedback FB-1374/FB-1395:
// with UAE PASS sign-in, mobile + email come from the profile — never re-asked).
export const MOCK_PERSONA_CONTACT = { mobile: "+971 50 555 0142", email: "ahmed.almansoori@example.ae" };

export interface MockBox {
  box: string;
  emirate: string;
  branch: string;
  bundle: string;
  rate: string; // standard published annual rate
  expiry: string;
  expiryIso: string; // same date, ISO — drives the simulated renewal details
  autoRenew: boolean;
  savedCard?: string;
}

// Two boxes on purpose: one active with auto-renewal OFF + no saved card
// (exercises the full renewal + save-card/auto-renew consent path), and one
// EXPIRED (Feb) with auto-renewal ON + a saved card (exercises the "already set
// to auto-renew" shortcut FB-1168 AND the grace-period expiry calculation
// FB-1427 — an expired box must still get a full year of renewal).
export const MOCK_PERSONA_BOXES: MockBox[] = [
  { box: "50500", emirate: "Dubai", branch: "Al Barsha Post Office", bundle: "MyHome", rate: "AED 695 / year", expiry: "19 Aug 2026", expiryIso: "2026-08-19", autoRenew: false },
  { box: "33417", emirate: "Abu Dhabi", branch: "Khalidiya Post Office", bundle: "MyBox", rate: "AED 300 / year", expiry: "03 Feb 2026", expiryIso: "2026-02-03", autoRenew: true, savedCard: "Visa ending 4242" },
];

/**
 * System-prompt context describing the signed-in persona + its PO Boxes, so the
 * model uses the boxes on file across every authenticated flow without asking.
 */
/**
 * `autoRenew` overrides the boxes' auto-renewal with what this conversation has
 * switched (2026-10-15). Without it the persona read "auto-renewal OFF" on every
 * turn after the customer had switched it on, and the agent switched it on
 * again on each "thanks" and "goodbye", restating the confirmation each time.
 */
export function mockPersonaContext(autoRenew?: Record<string, boolean>): string {
  const lines = MOCK_PERSONA_BOXES.map((b, i) => {
    const on = autoRenew && b.box in autoRenew ? autoRenew[b.box]! : b.autoRenew;
    return (
      `${i + 1}) PO Box ${b.box}, ${b.emirate} — ${b.branch}, ${b.bundle} bundle (${b.rate}), expires ${b.expiry}, ` +
      `auto-renewal ${on ? "ON" : "OFF"}, ${b.savedCard ? `card on file (${b.savedCard})` : "no saved card"}.`
    );
  }).join(" ");
  return (
    `The signed-in customer is ${MOCK_PERSONA_NAME}. Contact on the customer profile: mobile ${MOCK_PERSONA_CONTACT.mobile}, email ${MOCK_PERSONA_CONTACT.email} — when a journey needs a contact phone or email, record THESE with collect_field and ask the customer only to confirm them; NEVER ask them to type their mobile number or email. ` +
    `Usual branch: ${MOCK_PERSONA_BOXES[0]!.branch} — when presenting branches you may highlight it with a badge (e.g. "Your usual branch"), but never pre-select it. ` +
    `PO Boxes on file: ${lines} ` +
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

/**
 * Reserved PO Box numbers for STAGING testing.
 *
 * Emirates Post staging has no real box availability to offer: Rental/FreeBoxes
 * needs a live EP session we do not hold, and there is no inventory behind it
 * anyway. Without something to select, every rental journey stops at the box-number
 * step and cannot be tested end to end.
 *
 * These numbers are deterministic per branch + bundle, so the same branch always
 * offers the same boxes (a tester can re-run a scenario and get the same result),
 * and `page` walks further into the list so "Refresh" shows a different set.
 *
 * Staging only — the caller gates this on the agent's activeEnvironment, so it
 * disappears by itself when an agent is switched to production.
 */
export function stagingTestBoxNumbers(
  bundleId: string,
  locationId: string,
  page = 0,
  count = 10
): string[] {
  const all = seededBoxNumbers(`staging|${bundleId}|${locationId}`, count * 6);
  const start = (page * count) % Math.max(all.length - count, 1);
  return all.slice(start, start + count);
}

/** Simulate a mock EP response for the ops that can't hit the real API; null = not simulated. */
/** The last simulated renewal order, so the simulated confirm can answer for it. */
let lastSimulatedOrder: { ref: string; amount: number } | null = null;

/**
 * THE PAYABLE SANDBOX (2026-10-14).
 *
 * The simulation above was written for a laptop demo: the save points at an
 * N-Genius page nobody can pay on, and the confirm answers "paid" regardless.
 * An integrator testing the PO Box journeys over the A2A doorway needs the
 * opposite — an order whose payment can actually be made, and a confirm that
 * tells the truth about it — and needs the two Emirates Post calls that were
 * never simulated at all (Rental/Select, which reserves the box, and
 * Rental/Save, which creates the order) because a new rental stops dead
 * without them.
 *
 * So with a context the simulation becomes payable: Select returns a hold with
 * a price breakdown in Emirates Post's own shape; Save creates a `payments` row
 * and points the pay button at OUR mock checkout, which settles that row
 * through the signed webhook like a real gateway would; and the confirm reads
 * the row and answers paid only when it is. Without a context everything
 * behaves exactly as before — the demo persona keeps its demo.
 */
export interface SimulationContext {
  payable: true;
  conversationId?: string;
  agentId?: string;
  locale?: string;
  /** What this bundle rents for over `years`, from the live price book when it is known. */
  rentFor?: (bundleId: string, years: number) => number | null;
}

/** Fixed sandbox fees, stated as such in the response. */
const SANDBOX_REGISTRATION_FEE = 70;
const SANDBOX_AGENT_FEE = 50;
const SANDBOX_KEY_DELIVERY_FEE = 30;

/** The public origin, so a payment link in a tool result is complete wherever it is read. */
function publicOrigin(): string {
  const pin = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DIALOG_HOST || "";
  if (/^https?:\/\//i.test(pin)) {
    try {
      return new URL(pin).origin;
    } catch {
      /* fall through */
    }
  }
  return "";
}

function yearsUntil(iso: string | undefined): number {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return 1;
  const years = Math.round((t - Date.now()) / (365.2425 * 24 * 60 * 60 * 1000));
  return Math.min(Math.max(years, 1), 20);
}

/** A reference nobody will mistake for Emirates Post's: SBX, the time, four random characters. */
function sandboxReference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Open a payment on OUR books for a simulated order, and hand back the link the
 * pay button should carry. The row is what the mock checkout settles and what
 * the confirm reads; it is also what the receipt and the audit trail are built
 * from, so a sandbox purchase leaves the same records a real one does.
 */
async function openSandboxPayment(ctx: SimulationContext, amount: number): Promise<{ reference: string; url: string } | null> {
  if (!ctx.conversationId) return null;
  try {
    const { getCase } = await import("./conversation");
    const { getDb, payments } = await import("@dialog/db");
    const c = await getCase(ctx.conversationId);
    if (!c) return null;
    const reference = sandboxReference("SBX");
    await getDb()
      .insert(payments)
      .values({
        caseId: c.caseId,
        conversationId: ctx.conversationId,
        agentId: ctx.agentId ?? c.agentId,
        reference,
        amount,
        currency: "AED",
        status: "initiated",
        provider: "sandbox",
      });
    const lang = ctx.locale === "ar" ? "ar" : "en";
    const url = `${publicOrigin()}/api/payments/mock-checkout?ref=${encodeURIComponent(reference)}&caseId=${encodeURIComponent(c.caseId)}&lang=${lang}`;
    return { reference, url };
  } catch {
    return null;
  }
}

/** Has the sandbox payment behind this order been made? Reads the row the checkout settles. */
async function sandboxPaymentState(
  ctx: SimulationContext,
  reference: string | null
): Promise<{ reference: string; amount: number; paid: boolean } | null> {
  if (!ctx.conversationId) return null;
  try {
    const { getDb, payments } = await import("@dialog/db");
    const { and, eq, desc } = await import("drizzle-orm");
    const db = getDb();
    const rows = reference
      ? await db.select().from(payments).where(eq(payments.reference, reference)).limit(1)
      : await db
          .select()
          .from(payments)
          .where(and(eq(payments.conversationId, ctx.conversationId), eq(payments.provider, "sandbox")))
          .orderBy(desc(payments.createdAt))
          .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { reference: row.reference, amount: Number(row.amount), paid: row.status === "paid" };
  } catch {
    return null;
  }
}

export async function simulateNxnMockOp(
  toolName: string,
  input: Record<string, unknown>,
  ctx?: SimulationContext
): Promise<{ result: string; isError?: boolean; raw?: string } | null> {
  const t = toolName.toLowerCase();
  const inp = (input ?? {}) as Record<string, any>;
  const ok = (body: unknown) => ({ result: `HTTP 200 OK\n${JSON.stringify(body)}`, isError: false, raw: JSON.stringify(body) });
  const bodyOf = (): Record<string, any> => {
    let body: any = inp.body ?? inp;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    return body || {};
  };

  if (ctx?.payable) {
    // Reserve the box. Emirates Post's own field names, including their typo in
    // the expiry key, because the hold parser downstream reads exactly those.
    if (/rental_select$/i.test(t)) {
      const body = bodyOf();
      const bundleId = String(body.bundleId ?? body.BundleId ?? "").trim() || "IN";
      const expiry = String(body.poBoxExpiryDate ?? body.PoBoxExpiryDate ?? "");
      const years = yearsUntil(expiry);
      const rent = ctx.rentFor?.(bundleId, years) ?? rateForBundleId(bundleId) * years;
      const minimumAmount = rent + SANDBOX_REGISTRATION_FEE;
      const holdExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const line = (serviceType: string, totalAmount: number, serviceCriteria: string) => ({
        bundleID: bundleId,
        serviceType,
        totalAmount,
        serviceCriteria,
      });
      return ok({
        isSuccess: true,
        simulated: true,
        payload: {
          subscriptionReferenceNumber: sandboxReference("SBXHOLD"),
          subcsriptionReferenceNumberExpiryDate: holdExpiry,
          minimumAmount,
          poBoxExpiryDate: expiry || new Date(Date.now() + years * 365.2425 * 24 * 60 * 60 * 1000).toISOString(),
          uniqueBoxID: String(body.uniqueBoxID ?? body.uniqueBoxId ?? body.boxNumber ?? ""),
          priceDetails: [
            line("RENT", rent, "M"),
            line("NEW-REG", SANDBOX_REGISTRATION_FEE, "M"),
            line("AGENT", SANDBOX_AGENT_FEE, "I"),
            line("AGENT", SANDBOX_AGENT_FEE, "A"),
            line("KEY-DELIVERY", SANDBOX_KEY_DELIVERY_FEE, "A"),
          ],
        },
      });
    }
    // Create the order and open its payment — on our checkout, where it can be made.
    if (/(rental_save|guest_renewal_save)$/i.test(t)) {
      const body = bodyOf();
      const total =
        Number(body.totalAmount ?? body.amount ?? 0) ||
        rateForBundleId(String(body.newBundleId ?? body.NewBundleId ?? body.bundleId ?? ""));
      const opened = await openSandboxPayment(ctx, total);
      const ref = opened?.reference ?? sandboxReference("SBX");
      const url = opened?.url ?? `${publicOrigin()}/api/payments/mock-checkout?ref=${encodeURIComponent(ref)}`;
      lastSimulatedOrder = { ref, amount: total };
      return ok({
        isSuccess: true,
        simulated: true,
        payload: {
          orderNo: `SBX${Date.now().toString().slice(-8)}`,
          totalAmount: total,
          paymentGateWayResponse: {
            referenceNumber: ref,
            paymentUrl: url,
            niOrderResult: { _id: `urn:order:${ref}`, reference: ref, amount: { value: Math.round(total * 100), currencyCode: "AED" } },
          },
        },
      });
    }
    // Has it been paid? The truth, from the row the checkout settles.
    if (/(updatepayment|confirmpayment)/i.test(t)) {
      const body = bodyOf();
      const named =
        String(inp.paymentReferenceNo ?? inp.PaymentReferenceNo ?? body.referenceNumber ?? body.paymentReferenceNo ?? body.paymentRefNo ?? "").trim() || null;
      const state = (await sandboxPaymentState(ctx, named)) ?? (lastSimulatedOrder ? { reference: lastSimulatedOrder.ref, amount: lastSimulatedOrder.amount, paid: false } : null);
      return ok({
        isSuccess: true,
        simulated: true,
        payload: {
          isPaymentSuccess: Boolean(state?.paid),
          amountPaid: state?.paid ? state.amount : 0,
          referenceNumber: state?.reference ?? named ?? "",
          paymentDetails: state?.paid
            ? { amountPaid: state.amount, paymentRefNo: state.reference, simulated: true }
            : { simulated: true, paymentStatus: 2, note: "No payment has been made for this order yet. The customer pays on the payment page the save returned." },
        },
      });
    }
  }

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
    // box, e.g. 5200); fall back to a known mock box for the bundle/rate. A box
    // on file returns its REAL expiry (box 33417 is expired — FB-1427: the
    // grace-period rule must produce a correct, at-least-one-year new expiry).
    const reqBox = String(inp.BoxNumber ?? inp.boxNumber ?? "").trim();
    const matched = mockBoxByNumber(reqBox);
    const b = matched ?? MOCK_PERSONA_BOXES[0]!;
    const currentExpiry = matched ? matched.expiryIso : `${MOCK_BASE_YEAR}-08-19`;
    return ok({
      success: true, simulated: true,
      payload: {
        poBoxRenewalDetails: {
          boxNumber: reqBox || b.box,
          emirateCode: String(inp.EmirateCode ?? inp.emirateCode ?? ""),
          bundleId: bundleIdFor(b),
          bundleName: b.bundle,
          currentExpiryDate: `${currentExpiry}T00:00:00`,
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

  /**
   * THE SAVE AND THE CONFIRM, SIMULATED (2026-10-11), so the one-tap renewal can
   * be seen end to end on a laptop. Emirates Post's staging refuses
   * Guest/Renewal/Save for the mock boxes, and without a save there is no
   * payment page to put behind the pay button. The simulated order points at
   * N-Genius's UAT page with a code that page will not know: the card renders
   * and opens, the payment itself cannot be made here. The confirm then answers
   * paid, as a demo needs. Both are marked simulated and reach the mock persona
   * only, like everything else in this function.
   */
  if (t.includes("guest_renewal_save")) {
    let body: any = inp.body ?? inp;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const total = Number(body.totalAmount ?? body.amount ?? 0) || rateForBundleId(String(body.newBundleId ?? body.NewBundleId ?? ""));
    const ref = `sim-${Date.now().toString(36)}`;
    lastSimulatedOrder = { ref, amount: total };
    return ok({
      isSuccess: true, simulated: true,
      payload: {
        orderNo: `SIM${Date.now().toString().slice(-8)}`,
        totalAmount: total,
        paymentGateWayResponse: {
          referenceNumber: ref,
          paymentUrl: `https://paypage-uat.ngenius-payments.com/?code=${ref}`,
          niOrderResult: { _id: `urn:order:${ref}`, reference: ref, amount: { value: Math.round(total * 100), currencyCode: "AED" } },
        },
      },
    });
  }
  if (t.includes("guest_renewal_confirmpayment")) {
    const order = lastSimulatedOrder;
    return ok({
      isSuccess: true, simulated: true,
      payload: { isPaymentSuccess: true, amountPaid: order?.amount ?? 0, referenceNumber: order?.ref ?? "", paymentDetails: { simulated: true } },
    });
  }

  return null;
}
