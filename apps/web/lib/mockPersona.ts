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
