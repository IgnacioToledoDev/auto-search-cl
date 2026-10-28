/**
 * Parsers for numbers as written on Chilean portals: dots are thousands
 * separators and the comma is the decimal separator.
 */

/** Parse a Chilean-formatted number out of free text; null when none found. */
function parseChileanNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const match = /\d[\d.]*(?:,\d+)?/.exec(input);
  if (!match) return null;
  const normalized = match[0].replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** "$12.990.000" -> 12990000 */
export function parseClp(input: string | null | undefined): number | null {
  const value = parseChileanNumber(input);
  return value === null ? null : Math.round(value);
}

/** "UF 450,5" -> 450.5 */
export function parseUf(input: string | null | undefined): number | null {
  return parseChileanNumber(input);
}

/** "85.000 km" -> 85000 */
export function parseKm(input: string | null | undefined): number | null {
  const value = parseChileanNumber(input);
  return value === null ? null : Math.round(value);
}
