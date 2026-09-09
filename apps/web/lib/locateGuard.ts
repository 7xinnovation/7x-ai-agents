/**
 * A map the assistant offers has to be a map the customer can use.
 *
 * Reported 8 September, twice in the same conversation: "You can share your
 * address or pin your location on the map", then — after the customer answered
 * "Pin" — "Please go ahead and drop a pin on the map. Once you share the
 * coordinates, I'll look up the exact delivery area for you."
 *
 * No map was rendered either time. The control exists (a ```locate block) and
 * the journey guidance names it, but nothing made the offer and the block
 * arrive together, so the customer was told to use something that was not
 * there and ended up typing an address instead. That is the whole of items 6
 * and 7 of the 8 September UAT list.
 *
 * The offer is the thing we can see in the text, so the block is added to match
 * it. The same shape as the other streaming guards: it changes what is sent
 * only when the model has already said the words.
 */

/** The offer, in either language. */
// \b is a word boundary between ASCII word characters, so it never matches
// beside Arabic script -- an Arabic offer went unrecognised until the boundaries
// came off it.
const OFFERS_MAP =
  /(drop|share|pin|place|mark)\b[^.?!]{0,60}\b(pin|location|map)\b|\bon the map\b|على الخريطة|حدد موقعك|تحديد موقعك|مشاركة الموقع/i;

/** Something that already renders a map or takes the location another way. */
const HAS_BLOCK = /```\s*(locate|map)\b/i;

/**
 * Past tense, not an offer.
 *
 * "Location shared: 2 61 Street, Al Satwa" and "That pin is in Dubai" are the
 * assistant talking ABOUT a pin the customer has already dropped. Offering them
 * another one there would be noise, and on the emirate-mismatch reply it would
 * sit under a question that is not asking for a location at all.
 */
const ALREADY_PINNED =
  /location shared|that pin\b|your pin\b|the pin you|pinned location|تم مشاركة الموقع|الموقع الذي حددته/i;

export interface LocateGuardOptions {
  /** Arabic gets the Arabic call to action. */
  locale?: string;
  /** Journeys that never take a delivery address should not offer a map. */
  enabled?: boolean;
}

/**
 * An address we already hold is not a question.
 *
 * The trade licence and the MOA carry the company's address, and it is read off
 * them and shown in the panel. Asking the applicant to drop a pin on top of that
 * asks them to supply what they have already supplied — and on 9 September the
 * street address was sitting in the panel, in Arabic, while the assistant said
 * "please confirm your company's physical location on the map".
 *
 * This is about the OFFER, not the guard: where the address is known, the map
 * should not be pushed at them at all. They can still ask for it.
 */
export function addressAlreadyKnown(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  for (const key of ["address_street", "address_geo", "delivery_address", "street_address"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length > 6) return true;
  }
  return false;
}

/** The block to append, with a label the customer will recognise. */
export function locateBlock(locale?: string): string {
  const label = locale === "ar" ? "تحديد موقعي على الخريطة" : "Pin my location on the map";
  return `\n\n\`\`\`locate\nlabel: ${label}\n\`\`\``;
}

/** Does this reply promise a map without giving one? */
export function promisesMapWithout(text: string): boolean {
  if (!text.trim()) return false;
  if (HAS_BLOCK.test(text)) return false;
  if (ALREADY_PINNED.test(text)) return false;
  return OFFERS_MAP.test(text);
}

/**
 * A streaming filter that appends the map control when the reply offered one.
 *
 * Buffers to the end rather than deciding as it goes: the block may be the very
 * last thing the model writes, and appending a second one would leave the
 * customer with two maps.
 */
export function locateGuard(opts: LocateGuardOptions = {}) {
  let seen = "";
  return {
    push(delta: string): string {
      seen += delta;
      return delta;
    },
    /** Anything to add once the reply is complete. */
    flush(): string {
      if (opts.enabled === false) return "";
      return promisesMapWithout(seen) ? locateBlock(opts.locale) : "";
    },
  };
}


/**
 * The Arabic conversation gets the Arabic enquiry page.
 *
 * The link is written by the model from its guidance, and the guidance names
 * both — so in Arabic it still reached for the English one often enough to be
 * reported. The rule is not a judgement call: an Arabic reply links to the /ar/
 * page, always. Applied to the finished text, so it catches the link wherever
 * the model put it.
 */
const ENQUIRY_EN = /https:\/\/www\.emiratespost\.ae\/contact-us\/raise-an-enquiry/g;
const ENQUIRY_AR = "https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry";

export function arabicEnquiryLink(text: string, locale?: string): string {
  if (locale !== "ar") return text;
  return text.replace(ENQUIRY_EN, ENQUIRY_AR);
}

/** The FAQ has the same pair, and the same habit. */
const FAQ_EN = /https:\/\/www\.emiratespost\.ae\/faq/g;
const FAQ_AR = "https://www.emiratespost.ae/ar/faq";

export function arabicLinks(text: string, locale?: string): string {
  if (locale !== "ar") return text;
  return text.replace(ENQUIRY_EN, ENQUIRY_AR).replace(FAQ_EN, FAQ_AR);
}


/**
 * The same rewrite, applied while the reply streams.
 *
 * A URL arrives across several deltas, so a naive per-chunk replace would miss
 * one split down the middle. The tail is held back — a little longer than the
 * longest link we rewrite — and released once it can no longer be part of one.
 */
const HOLD = 72;

export function linkGuard(locale?: string) {
  let buf = "";
  const on = locale === "ar";
  return {
    push(delta: string): string {
      if (!on) return delta;
      buf += delta;
      if (buf.length <= HOLD) return "";
      const out = arabicLinks(buf.slice(0, buf.length - HOLD), locale);
      buf = buf.slice(buf.length - HOLD);
      return out;
    },
    flush(): string {
      if (!on) return "";
      const out = arabicLinks(buf, locale);
      buf = "";
      return out;
    },
  };
}
