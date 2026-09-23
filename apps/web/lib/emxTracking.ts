import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

/**
 * Shipment tracking, over Emirates Post's EMX gateway.
 *
 * THE SECOND MOST COMMON THING ANYONE ASKS THIS ASSISTANT, and until now the one
 * thing it could only apologise for. `lib/metrics.ts` has carried the note for
 * weeks: `shipment.lookup` was "emitted by a tool that does not exist", and the
 * KPI counted the DEMAND instead — 42 of thirty days' intents on production.
 * Every one of those people was handed a link to a web page.
 *
 *   GET {baseUrl}/tracking/api/Tracking?awbNumber=CP175823258AE
 *   X-API-KEY: <per-environment key>
 *
 * Unlike the PO Box APIs, this one has a REAL production endpoint and key, so
 * production tracking is genuinely live rather than pointed at staging.
 *
 * As with lib/gsbLookup and lib/epglRead, the request is templated HERE and the
 * model supplies one validated value. An operation the model composes freely is
 * a prompt-injection surface, and this one reaches somebody's parcel.
 */

const INTEGRATION_NAME = /emx|tracking/i;

/**
 * What a tracking number may look like, being generous.
 *
 * The UPU's S10 standard is two letters, nine digits, two letters — RR020059668AE
 * and CP175823258AE are both that. Emirates Post also carry domestic and partner
 * references that are not, so this bounds the input rather than describing the
 * format: letters and digits, nothing else, a length that cannot be a sentence.
 * The point is that nothing but an identifier reaches their gateway.
 */
const AWB = /^[A-Z0-9]{8,24}$/;
/**
 * AND IT HAS TO HAVE DIGITS IN IT.
 *
 * Removing the spaces is what lets "CP 175823258 AE" through, and it is also
 * what turns "where is my parcel" into WHEREISMYPARCEL — fifteen letters, a
 * perfectly good match for the shape above, and a question sent to Emirates
 * Post as a consignment number. Every tracking reference carries digits; no
 * sentence does.
 */
const HAS_DIGITS = /(?:\D*\d){4}/;

/** Spaces and dashes are how people read a number back, not part of it. */
export function normaliseAwb(raw: string): string | null {
  const bare = String(raw ?? "").toUpperCase().replace(/[\s\-_/]+/g, "");
  return AWB.test(bare) && HAS_DIGITS.test(bare) ? bare : null;
}

export interface TrackingEvent {
  /** DD-MM-YYYY, the format every date in this product is shown in. */
  date: string;
  /** HH:MM, 24-hour, UAE time — see the note on timestamps below. */
  time: string;
  statusEn: string;
  statusAr: string;
  locationEn?: string;
  locationAr?: string;
}

export interface Tracking {
  trackingNumber: string;
  statusEn: string;
  statusAr: string;
  /** Newest first, as their gateway returns them. */
  events: TrackingEvent[];
}

export class TrackingNotConfiguredError extends Error {
  constructor() {
    super("EMX_NO_CREDENTIAL");
  }
}

async function credentials(agentId: string, env: EnvKey): Promise<{ baseUrl: string; apiKey: string; header: string }> {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.enabled && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  const key = isEncrypted(spec?.apiKey) ? decryptSecret(spec!.apiKey!) : spec?.apiKey;
  if (!spec?.baseUrl || !key) throw new TrackingNotConfiguredError();
  return {
    baseUrl: String(spec.baseUrl).replace(/\/$/, ""),
    apiKey: String(key),
    header: spec.apiKeyHeader || "X-API-KEY",
  };
}

/**
 * THEIR TIMESTAMPS ARE DAY-FIRST, AND LOCAL.
 *
 * "28/02/2026 09:09:00 AM" settles the first half: 28 is not a month. Read as
 * MM/DD it would have been silently wrong for every parcel whose day is 12 or
 * under, which is most of them — the kind of bug that shows a customer a
 * delivery three months early and is never reported because it looks plausible.
 *
 * The second half is an assumption, stated rather than hidden: the times are
 * taken as UAE local, NOT as UTC to be shifted. A parcel received at a Dubai
 * counter at 08:04 and delivered at 08:03 the same morning reads as local time,
 * and every location in the sample is a UAE facility. If Emirates Post confirm
 * these are UTC, the fix is one line here — and it is far better to be told than
 * to add four hours to a number that was already right.
 */
const STAMP = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

export function parseStamp(raw: unknown): { date: string; time: string } | null {
  const m = STAMP.exec(String(raw ?? "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hRaw, min, , ampm] = m;
  let h = Number(hRaw);
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || Number(min) > 59 || Number(mm) > 12 || Number(dd) > 31) return null;
  return { date: `${dd}-${mm}-${yyyy}`, time: `${String(h).padStart(2, "0")}:${min}` };
}

/**
 * WHOSE PARCEL THIS IS STAYS OUT OF THE ANSWER.
 *
 * A tracking number is the only thing anyone has to present, exactly as on every
 * public tracking page — so whoever types one gets whatever we print. Their
 * gateway returns rather more than a public page would: the sender's full name,
 * a receiver, and, inside the status text itself, the name of the person who
 * signed for it ("Delivered - Received  by :  CHELLIA SAMIRA").
 *
 * None of that is needed to answer "where is my parcel", and all of it is
 * somebody's. It is removed HERE rather than in the prompt, because a name the
 * model never sees is a name it cannot be talked into repeating.
 *
 * If Emirates Post would rather the recipient's name were shown — their own page
 * may well show it — deleting this is a small change. Guessing the other way
 * round is not.
 */
const SIGNED_BY = [
  // "Delivered - Received  by :  CHELLIA SAMIRA". A colon is optional after
  // "by", because "delivered by" is only ever followed by a person.
  /\s*[-–—]?\s*(received|signed|delivered|collected)\s+by\b\s*[:：]?\s*\S.*$/i,
  // "to" needs the colon. Without it, "Delivered to Post Office" is a STATUS,
  // and a rule that ate it would break tracking to protect nobody.
  /\s*[-–—]?\s*(received|signed|delivered|collected)\s+to\b\s*[:：]\s*\S.*$/i,
];

export function withoutNames(status: string): string {
  let out = String(status ?? "").replace(/\s+/g, " ").trim();
  for (const re of SIGNED_BY) {
    // KEEP THE VERB WHEN THE VERB IS THE WHOLE STATUS. "Delivered by JOHN SMITH"
    // has to become "Delivered", not nothing: cutting from the start would have
    // left an empty status, and the guard below would then have restored the
    // name it had just removed.
    out = out.replace(re, (m: string, verb: string, offset: number) => (offset === 0 ? verb : ""));
  }
  out = out.replace(/[\s:：,\-–—]+$/, "").trim();
  // Never return nothing: a status we could not read past is still a status.
  return out || String(status ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The Arabic side of the same event, cut at its colon when the English half
 * turned out to carry a name.
 *
 * Every Arabic description in the samples is a short phrase with no colon in it,
 * so this only fires where their gateway has appended something — and it fires
 * only when we already know THIS event names a person, which keeps it from
 * trimming an ordinary Arabic status that happens to be punctuated.
 */
function arabicWithoutNames(ar: string, englishWasCut: boolean): string {
  const clean = String(ar ?? "").replace(/\s+/g, " ").trim();
  if (!englishWasCut) return clean;
  /**
   * A COLON, OR THE DASH THAT STANDS IN FOR ONE.
   *
   * Production's gateway words this event differently from staging's:
   * "تم التسليم - تم الاستلام من جانب CHELLIA SAMIRA" — delivered, dash,
   * "received by", then the name. Cutting at the colon alone removed the name
   * (there is none to find) and left "تم التسليم - تم الاستلام من جانب": a
   * sentence ending on a preposition with nothing after it, which reads as
   * though the wording were broken.
   *
   * The part before the dash is the status; everything after it was about the
   * person. This runs ONLY on an event whose English half we already know named
   * someone, so an ordinary Arabic status that happens to be punctuated is
   * never touched.
   */
  const head = clean.split(/[:：]/)[0]!.split(/\s+[-–—]\s+/)[0]!;
  const cut = head.replace(/[\s,\-–—]+$/, "").trim();
  return cut || clean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
/** Their gateway writes the string "NULL" where it means nothing. */
const real = (v: unknown): string | undefined => {
  const s = str(v);
  return s && s.toUpperCase() !== "NULL" ? s : undefined;
};

interface RawEvent {
  timeStamp?: unknown;
  status?: { descriptionEn?: unknown; descriptionAr?: unknown };
  locationEn?: unknown;
  locationAr?: unknown;
}

export function normalise(body: unknown, awb: string): Tracking | null {
  const rows = Array.isArray(body) ? body : body ? [body] : [];
  const row = rows.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
  if (!row) return null;

  const last = (row.lastStatus ?? {}) as { descriptionEn?: unknown; descriptionAr?: unknown };
  const events = (Array.isArray(row.events) ? (row.events as RawEvent[]) : [])
    .map((e) => {
      const when = parseStamp(e?.timeStamp);
      const rawEn = str(e?.status?.descriptionEn);
      const statusEn = withoutNames(rawEn);
      const statusAr = arabicWithoutNames(str(e?.status?.descriptionAr), statusEn !== rawEn);
      if (!when || (!statusEn && !statusAr)) return null;
      const ev: TrackingEvent = { ...when, statusEn, statusAr };
      const locationEn = real(e?.locationEn);
      const locationAr = real(e?.locationAr);
      if (locationEn) ev.locationEn = locationEn;
      if (locationAr) ev.locationAr = locationAr;
      return ev;
    })
    .filter((e): e is TrackingEvent => e !== null);

  const lastRawEn = str(last.descriptionEn);
  const statusEn = withoutNames(lastRawEn) || events[0]?.statusEn || "";
  const statusAr = arabicWithoutNames(str(last.descriptionAr), statusEn !== lastRawEn) || events[0]?.statusAr || "";
  if (!statusEn && !statusAr && !events.length) return null;

  /**
   * THE WEIGHT IS NOT WHY ANYONE IS ASKING.
   *
   * Their gateway returns it and the first version passed it through, so a
   * customer asking where their parcel was got a card reading "Status:
   * Delivered / Weight: 77 Grams". Dropped on 23 September: it answers a
   * question nobody asked, and it is the only row competing with the status for
   * the eye. Removed HERE rather than asked not to be shown — a field the model
   * never sees is a field it cannot decide to render.
   */
  return {
    trackingNumber: real(row.trackingNumber) ?? real(row.trackingReferenceNo) ?? awb,
    statusEn,
    statusAr,
    events,
  };
}

/** Their gateway is in front of a postal backend; a chat turn cannot wait on it. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Look one shipment up. `null` means the number is not known to them, which is a
 * real answer and not a failure — a number typed with a digit wrong looks exactly
 * like one that has not been scanned yet, and both deserve the same plain reply.
 */
export async function trackShipment(agentId: string, env: EnvKey, awbRaw: string): Promise<Tracking | null> {
  const awb = normaliseAwb(awbRaw);
  if (!awb) return null;
  const { baseUrl, apiKey, header } = await credentials(agentId, env);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/tracking/api/Tracking?awbNumber=${encodeURIComponent(awb)}`, {
      headers: { [header]: apiKey, Accept: "application/json, text/plain" },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // 404 is their way of saying they have never heard of it.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Emirates Post tracking returned HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  return normalise(body, awb);
}
