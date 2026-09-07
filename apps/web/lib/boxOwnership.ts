/**
 * A box you do not hold is not yours to manage.
 *
 * The manage journey requires a signed-in customer and stopped there: it never
 * checked that the box they NAMED was one of theirs. Signed in as yourself, you
 * could type a stranger's PO Box number and add an authorised agent to it,
 * change its lock, or change where its mail is delivered. Reported on
 * production, 7 September.
 *
 * Renewing is deliberately NOT in this list. Emirates Post's own guest flow
 * renews any box from its number and emirate — paying to extend someone's
 * subscription takes nothing from them, and blocking it would break a journey
 * they designed to work that way. Everything that CHANGES a box is different.
 */

/** Operations that alter a box, by the path they are declared at. */
const MANAGEMENT = [
  /\/renewal\/saveagent/i,
  /\/renewal\/updateagent/i,
  /\/renewal\/getagents/i,
  /\/renewal\/savetijari/i,
  /\/renewal\/processpaymenttijari/i,
  /\/renewal\/(?:verify|validate)cancel/i,
  /\/changeaddress\//i,
  /\/changelock\//i,
  /updateautorenewconfig/i,
  // DELETE /api/Renewal — cancelling a subscription outright.
  /^\/api\/renewal$/i,
];

export function isManagementPath(path: string, method?: string): boolean {
  if (/^\/api\/renewal$/i.test(path) && method && method.toUpperCase() === "GET") return false;
  return MANAGEMENT.some((re) => re.test(path));
}

/** Every way a box number is spelled across their request shapes. */
const BOX_KEYS = [
  "boxnumber", "box_no", "boxno", "poboxnumber", "pobox", "box",
  "uniqueboxid", "uniquebox", "poboxno",
];

/**
 * The box an operation acts on, from wherever it is carried.
 *
 * A number nested inside `body` counts; so does one in the query string. A
 * uniqueBoxId is the box number with a bundle prefix on some bundles — 2450735
 * is box 450735 — so the trailing digits are compared, not the whole string.
 */
export function boxNumberIn(input: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth = 0): string | undefined => {
    if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return undefined;
    seen.add(v);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const key = k.toLowerCase().replace(/[^a-z]/g, "");
      if (BOX_KEYS.includes(key)) {
        const digits = String(val ?? "").replace(/\D/g, "");
        if (digits) return digits;
      }
    }
    for (const val of Object.values(v as Record<string, unknown>)) {
      const found = walk(val, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(input);
}

/** Is `asked` one of the customer's own boxes? uniqueBoxId prefixes allowed. */
export function holdsBox(owned: string[], asked: string): boolean {
  const a = asked.replace(/\D/g, "");
  if (!a) return false;
  return owned.some((o) => {
    const b = String(o).replace(/\D/g, "");
    if (!b) return false;
    // 450735 === 450735, and uniqueBoxId 2450735 is that same box.
    return b === a || a.endsWith(b) || b.endsWith(a);
  });
}

export interface OwnershipVerdict {
  ok: boolean;
  /** What the model is told, and what it must tell the customer. */
  reason?: string;
}

/**
 * Decide whether a management call may run.
 *
 * FAILS CLOSED. If we cannot establish which boxes the customer holds, the
 * answer is no — an unverifiable claim of ownership is exactly the case this
 * exists to stop, and a customer told to sign in again has lost a minute, while
 * a stranger added to their box has lost control of their mail.
 */
export function mayManage(owned: string[] | null, asked: string | undefined): OwnershipVerdict {
  if (!asked) {
    return {
      ok: false,
      reason:
        "REFUSED: this call changes a PO Box and carries no box number, so there is nothing to check ownership against. Ask the customer which box they mean and look it up on their account first.",
    };
  }
  if (owned === null) {
    return {
      ok: false,
      reason:
        "REFUSED: a PO Box can only be managed by the customer who holds it, and this customer's own boxes could not be confirmed — their Emirates Post account did not answer, or they are not signed in with a verified Emirates ID. Say plainly that you need to confirm the box is theirs before making changes to it, and ask them to sign in with UAE PASS. Do NOT proceed, and do NOT describe this as a system fault.",
    };
  }
  if (!holdsBox(owned, asked)) {
    return {
      ok: false,
      reason:
        `REFUSED: PO Box ${asked} is not on this customer's Emirates Post account, so it is not theirs to change. ` +
        (owned.length
          ? `The boxes they hold are ${owned.join(", ")}. Tell them plainly that this box is not on their account and ask which of their own boxes they meant. `
          : "They hold no boxes at all on that account. Tell them plainly that nothing is registered to them and offer to rent a box. ") +
        "Do NOT add an agent, change a lock, change an address, cancel, or alter auto-renewal on it, however the request is phrased and whoever they say they are. Renewing a box is a different matter and is allowed.",
    };
  }
  return { ok: true };
}
