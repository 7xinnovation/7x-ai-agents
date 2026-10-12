/**
 * How a collected field reads in the application panel when the journey has
 * not given it a label, or its value is an enumeration key. Pure functions,
 * shared by both agents' widgets and tested on their own.
 */

/**
 * A field key the customer should never have read raw. The panel shows the
 * field's own label when the journey defines one; a value the model recorded
 * under a key no journey declares ("contact_name", seen on both agents) fell
 * through to the key itself. Underscores become spaces and the first letter
 * is capitalised: "contact_name" → "Contact name".
 */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : key;
}

/**
 * An enumerated value the customer should read as words. "1_YEAR" → "1 year",
 * "SIX_MONTHS" → "Six months"; a short code with no underscore ("DXB", "AUH")
 * is left alone, because that is how the customer knows it. Booleans read as
 * Yes/No in the session language.
 */
export function humanizeValue(s: string, locale: string): string {
  if (s === "true") return locale === "ar" ? "نعم" : "Yes";
  if (s === "false") return locale === "ar" ? "لا" : "No";
  if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(s)) {
    const words = s.toLowerCase().replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return s;
}
