/** Lowercase, strip accents and collapse whitespace so matching is case/accent-insensitive. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the folded haystack contains the folded needle (empty needle never matches). */
export function containsFolded(haystack: string | null | undefined, needle: string): boolean {
  const n = fold(needle);
  return n !== "" && haystack != null && fold(haystack).includes(n);
}
