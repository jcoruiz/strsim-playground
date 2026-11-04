// How Go sees the text the page sends it.

/** The characters of s as Go's []rune(s) sees them: code points, not UTF-16 units. */
export const runes = (s: string): string[] => Array.from(s);

/**
 * Replaces lone surrogates with U+FFFD, as the UTF-8 encoding that carries
 * the text to Go does.
 */
export const wellFormed = (s: string): string =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');

/**
 * strings.ToLower: Go maps each rune on its own (simple case mapping), so
 * "İ" becomes "i" and a final "Σ" stays "σ", where String.toLowerCase
 * gives "i̇" and "ς".
 */
export function goLower(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    if (runes(lower).length === 1) out += lower;
    else out += ch === 'İ' ? 'i' : ch;
  }
  return out;
}

/** Counts runes, as utf8.RuneCountInString. */
export const runeCount = (s: string): number => runes(s).length;
