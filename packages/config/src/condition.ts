/**
 * The document `condition` evaluator — one copy, shared.
 *
 * It used to live in the engine with two hand-written mirrors: one in the embed
 * widget and one on the mobile upload page. The mirrors were never finished.
 * Both handled `key == 'v'`, `key != 'v'` and a bare truthy key, and NEITHER
 * handled the numeric form — so `partner_count >= 2` fell through to
 * `Boolean(data["partner_count >= 2"])`, which is false, always. The server
 * counted a partner's passport and Emirates ID among the requirements and the
 * widget did not, so the readiness bar in front of the customer and the
 * readiness the submission enforced were different numbers.
 *
 * The grammar is deliberately tiny and there is no code execution anywhere in
 * it: a journey definition is data, and data that can run is not data.
 *
 *   key == 'value'      string equality
 *   key != 'value'      string inequality
 *   key >= 2            numeric (also <= < > == !=)
 *   key                 truthy
 *   !key                empty — nothing has filled it
 *   a && b              every part holds
 */

/**
 * What a condition compares when it compares a number.
 *
 * An ARRAY counts as its length, which is what makes "partners >= 2" work
 * against a repeating group: the second partner's passport is required when
 * there is a second partner, and the count is the group itself, not a separate
 * field someone has to remember to keep in step with it.
 */
function numericValue(raw: unknown): number | null {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Conjunction, because one requirement can depend on two facts.
 *
 * A partner's Emirates ID is needed when there IS that partner and when that
 * partner is resident in the UAE. EPGL raised the second half on 11 September: a
 * non-resident owner has no Emirates ID to give, and the application stopped
 * dead on a document that does not exist for them. Neither half is enough on its
 * own -- `partner_count >= 2` asks a non-resident for a card they cannot have,
 * and `partner_2_residence != 'Non Resident'` asks for partner 2's card when
 * there is no partner 2 -- so `&&` is the smallest thing that expresses it.
 *
 * Only `&&`. `||` would let a requirement be satisfied by either of two facts,
 * and a document requirement that can be waived two different ways is one nobody
 * can reason about from reading the journey.
 */
export function evalCondition(expr: string | undefined, data: Record<string, unknown>): boolean {
  if (!expr) return true;
  if (expr.includes("&&")) return expr.split("&&").every((part) => evalCondition(part, data));

  const eq = expr.match(/^\s*([\w.]+)\s*(==|!=)\s*'([^']*)'\s*$/);
  if (eq) {
    const [, key, op, val] = eq;
    const actual = String(data[key!] ?? "");
    return op === "==" ? actual === val : actual !== val;
  }

  // Numeric comparison, for requirements that scale with a count -- one passport
  // and one Emirates ID per partner, where the number of partners is read off
  // the trade licence rather than fixed in the journey.
  const num = expr.match(/^\s*([\w.]+)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (num) {
    const [, key, op, rhs] = num;
    const actual = numericValue(data[key!]);
    // A missing or unreadable count is NOT zero. Treating it as zero would drop
    // every per-partner document the moment extraction failed to find a number,
    // and the application would look complete with nothing uploaded.
    if (actual === null) return false;
    const want = Number(rhs);
    switch (op) {
      case ">=": return actual >= want;
      case "<=": return actual <= want;
      case ">": return actual > want;
      case "<": return actual < want;
      case "==": return actual === want;
      default: return actual !== want;
    }
  }

  /**
   * A REQUIREMENT THE DOCUMENT ALREADY ANSWERED IN THE OTHER SCRIPT.
   *
   * ECONOMIC ADVANTAGE INFORMATION TECHNOLOGY CONSULTANTS, 16 September: the
   * trade licence prints its address in Arabic only, so the Arabic address
   * field was filled from the document and the English one — required, and with
   * nothing on the licence to fill it — was still outstanding. The applicant
   * was asked to produce an English street address their own licence does not
   * carry, and offered a map pin for it.
   *
   * `!key` is how a journey says "needed only if nothing else supplied this".
   * Deliberately not `||`: the requirement still has exactly one condition and
   * one reading, and the field that waives it is named in the journey rather
   * than inferred.
   */
  const negated = expr.match(/^\s*!\s*([\w.]+)\s*$/);
  if (negated) {
    const v = data[negated[1]!];
    return Array.isArray(v) ? v.length === 0 : !v;
  }

  return Boolean(data[expr.trim()]);
}
