/**
 * EPGL 2.0 talks to TWO Salesforce orgs, and a reference from one is meaningless
 * in the other.
 *
 * The 2.0 journey builds its application in the **newlaw** sandbox
 * (`/services/apexrest/CompositeHandler`). The only duplicate check we have is
 * the 1.x one, which lives in **preprod2** — newlaw publishes no equivalent, so
 * the 2.0 agent still calls the old org's. That means the list of "existing
 * applications" a 2.0 customer is shown comes from a system their new
 * application will never be filed in.
 *
 * On 3 November a customer was offered **Update existing application
 * (LR-37795)** and **Check status of LR-37795**. LR-37795 is a preprod2 record
 * from 22 October. newlaw's own words:
 *
 *   applicationId__c "LR-37795" is unknown. The application id is assigned by
 *   Salesforce … | No application found for LR-37795
 *
 * Twice (1 November 16:03, 3 November 08:13) the model took that number off the
 * duplicate check and sent it to newlaw as `applicationId__c` on a create,
 * burning a round trip each time.
 *
 * Two guards, both pure, because guidance has already been tried:
 *
 *   `withoutForeignApplicationId` — a composite that CREATES an application may
 *   not name an existing one. Salesforce mints the id; anything the model
 *   supplies came from somewhere else.
 *
 *   `maskForeignApplicationRefs` — the duplicate check still runs, and its
 *   verdict is still useful ("this company already has an application"), but
 *   its references are withheld, so none can be quoted, offered as an update,
 *   or passed back as an id.
 *
 * Both die the day newlaw gets a duplicate check of its own: see
 * `duplicateCheckIsForeign` in integrations.ts, which only arms this when the
 * two tools are pointed at different hosts.
 */

import type { CompositeItem } from "./epglComposite";

/** The object the 2.0 application is created as. Its presence makes this a create. */
const LICENCE_REQUEST = /sobjects\/EPG_License_Request__c$/i;

/**
 * A composite reference — `@{NewLicenseRequest.id}` — is resolved by Salesforce
 * within this same request, so it is not a foreign id and must survive.
 */
const COMPOSITE_REF = /^@\{[^}]*\}$/;

export interface StripResult {
  input: Record<string, unknown> | undefined;
  /** The ids taken out, for the log. Empty when nothing was touched. */
  removed: string[];
}

/**
 * Take `applicationId__c` off a create.
 *
 * Scoped to a composite that posts an EPG_License_Request__c — the create. The
 * separate document composite we build ourselves (documentCompositeBody) and
 * the re-upload path both key on a real applicationId__c and carry no licence
 * request, so neither is touched.
 *
 * `null` is left alone: it is what the successful 3 November 08:16 create sent,
 * and their hook reads an absent id and a null one the same way.
 */
export function withoutForeignApplicationId(
  input: Record<string, unknown> | undefined
): StripResult {
  const body = (input?.body ?? {}) as Record<string, unknown>;
  const items = Array.isArray(body.compositeRequest) ? (body.compositeRequest as CompositeItem[]) : [];
  if (!items.some((i) => LICENCE_REQUEST.test(String(i?.url ?? "")))) return { input, removed: [] };

  const removed: string[] = [];
  const next = items.map((item) => {
    const b = item?.body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return item;
    const v = (b as Record<string, unknown>).applicationId__c;
    if (typeof v !== "string" || !v.trim() || COMPOSITE_REF.test(v.trim())) return item;
    removed.push(v.trim());
    const { applicationId__c: _dropped, ...rest } = b as Record<string, unknown>;
    return { ...item, body: rest };
  });
  if (!removed.length) return { input, removed: [] };
  return { input: { ...(input ?? {}), body: { ...body, compositeRequest: next } }, removed };
}

/**
 * IS THIS DUPLICATE CHECK PART OF A 2.0 JOURNEY?
 *
 * It has to be asked, because both EPGL agents carry both orgs' integrations —
 * the split on 2 November reverted 1.0's *definition*, not its integration rows
 * — so "this agent can reach newlaw" is true of the 1.x agent as well, and
 * masking there would take away references the 1.x submit can genuinely update.
 *
 * The call itself says which journey it belongs to, and the two shapes have
 * never overlapped in any call we have logged:
 *
 *   1.x   {"tradeLicenseNumber":"1196781","postalLicenseNumber":"377","serviceId":"S-EPG-000003"}
 *   2.0   {"tradeLicenseNumber":"CN-1234567","productCode":"CEP30-UAE-SME-DOM"}
 *
 * `serviceId` and `postalLicenseNumber` are 1.x's and belong to no 2.0 call, so
 * either one settles it outright. Otherwise a catalogue `productCode` marks it
 * as 2.0. A call carrying neither — the model dropped the product code, which
 * it has done twice — is left alone: showing a reference that may be valid
 * beats hiding one that is. The create-side guard above does not depend on this
 * and covers that case anyway.
 */
export function isTwoZeroDuplicateCheck(input: Record<string, unknown> | undefined): boolean {
  /**
   * THE FIELDS ARE IN `body`.
   *
   * A tool's arguments reach the runner as `{ body: { productCode, … } }` —
   * the audit row of every duplicate check shows exactly that. This read the
   * top level, found no product code, and decided every 2.0 call was a 1.x one,
   * so the mask shipped on 3 November never armed once: on 4 November a
   * customer was offered "Update existing application (LR-37795)" again. Read
   * both, so a flat call is still understood.
   */
  const src = ((input?.body && typeof input.body === "object" ? input.body : input) ?? {}) as Record<string, unknown>;
  const at = (k: string) => String(src[k] ?? "").trim();
  if (at("serviceId") || at("postalLicenseNumber")) return false;
  return Boolean(at("productCode"));
}

/** Keys whose values are references to records in the other org. */
const FOREIGN_KEYS = /^(matchedRequestNumber|matchedRecordIds|matchedRecordId|salesforceRecordId|requestIdentifier)$/;

/** An EPGL licence-request reference, wherever one is written in prose. */
const LR_NUMBER = /\bLR-\d+\b/g;

export interface MaskResult {
  result: string;
  /** How many references were withheld. Zero means the text is unchanged. */
  masked: number;
}

/**
 * Withhold the other org's references from a tool result.
 *
 * The verdict stays: `matchFound`, the status, the recommended action and the
 * count all survive, so the model can still tell the customer that an
 * application exists and put the choice to them. Only the identifiers go — and
 * with them the ability to quote a number that nothing downstream can look up.
 *
 * JSON first, so the shape is preserved exactly; the regex is the fallback for
 * a result that is not a single JSON document.
 */
export function maskForeignApplicationRefs(result: string): MaskResult {
  let masked = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (FOREIGN_KEYS.test(k)) {
          masked += Array.isArray(x) ? x.length : 1;
          continue;
        }
        out[k] = walk(x);
      }
      return out;
    }
    return v;
  };

  const trimmed = result.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const stripped = JSON.stringify(walk(JSON.parse(trimmed)));
      if (masked) return { result: stripped, masked };
      return { result, masked: 0 };
    } catch {
      /* not one JSON document after all — fall through */
    }
  }
  const replaced = result.replace(LR_NUMBER, () => {
    masked++;
    return "an existing application";
  });
  return masked ? { result: replaced, masked } : { result, masked: 0 };
}

/**
 * What the model is told once the references are gone, so it does not go
 * looking for them or invent one in their place.
 */
export const FOREIGN_REFS_NOTE =
  `\n\nTHE REFERENCES IN THIS ANSWER HAVE BEEN WITHHELD ON PURPOSE. This check runs against EPGL's PREVIOUS ` +
  `licensing system; the application you are about to file is created in their new one, which has never heard of these ` +
  `records. So: never quote an LR- number from this result, never offer to "check its status" (the status tool only ` +
  `knows applications created in the new system and will not find it), and NEVER put one in applicationId__c — that ` +
  `is assigned by Salesforce on the create. You may tell the customer that EPGL's records already show an application ` +
  `for this trade licence and what its status is, and put the choice to them once.`;
