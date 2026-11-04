// Letters the phonetic encoders read, as strsim's appendLetters (phonetic.go).

/** First rune covered by LATIN_FOLD. */
const LATIN_FOLD_FIRST = 0xc0;

/**
 * U+00C0–U+017F (Latin-1 Supplement letters and Latin Extended-A) as
 * uppercase ASCII. An empty entry is not a letter (× and ÷).
 */
export const LATIN_FOLD: readonly string[] = [
  'A', 'A', 'A', 'A', 'A', 'A', 'AE', 'C', // U+00C0 ÀÁÂÃÄÅÆÇ
  'E', 'E', 'E', 'E', 'I', 'I', 'I', 'I', // U+00C8 ÈÉÊËÌÍÎÏ
  'D', 'N', 'O', 'O', 'O', 'O', 'O', '', // U+00D0 ÐÑÒÓÔÕÖ×
  'O', 'U', 'U', 'U', 'U', 'Y', 'TH', 'SS', // U+00D8 ØÙÚÛÜÝÞß
  'A', 'A', 'A', 'A', 'A', 'A', 'AE', 'C', // U+00E0 àáâãäåæç
  'E', 'E', 'E', 'E', 'I', 'I', 'I', 'I', // U+00E8 èéêëìíîï
  'D', 'N', 'O', 'O', 'O', 'O', 'O', '', // U+00F0 ðñòóôõö÷
  'O', 'U', 'U', 'U', 'U', 'Y', 'TH', 'Y', // U+00F8 øùúûüýþÿ
  'A', 'A', 'A', 'A', 'A', 'A', 'C', 'C', // U+0100 ĀāĂăĄąĆć
  'C', 'C', 'C', 'C', 'C', 'C', 'D', 'D', // U+0108 ĈĉĊċČčĎď
  'D', 'D', 'E', 'E', 'E', 'E', 'E', 'E', // U+0110 ĐđĒēĔĕĖė
  'E', 'E', 'E', 'E', 'G', 'G', 'G', 'G', // U+0118 ĘęĚěĜĝĞğ
  'G', 'G', 'G', 'G', 'H', 'H', 'H', 'H', // U+0120 ĠġĢģĤĥĦħ
  'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', // U+0128 ĨĩĪīĬĭĮį
  'I', 'I', 'IJ', 'IJ', 'J', 'J', 'K', 'K', // U+0130 İıĲĳĴĵĶķ
  'K', 'L', 'L', 'L', 'L', 'L', 'L', 'L', // U+0138 ĸĹĺĻļĽľĿ
  'L', 'L', 'L', 'N', 'N', 'N', 'N', 'N', // U+0140 ŀŁłŃńŅņŇ
  'N', 'N', 'N', 'N', 'O', 'O', 'O', 'O', // U+0148 ňŉŊŋŌōŎŏ
  'O', 'O', 'OE', 'OE', 'R', 'R', 'R', 'R', // U+0150 ŐőŒœŔŕŖŗ
  'R', 'R', 'S', 'S', 'S', 'S', 'S', 'S', // U+0158 ŘřŚśŜŝŞş
  'S', 'S', 'T', 'T', 'T', 'T', 'T', 'T', // U+0160 ŠšŢţŤťŦŧ
  'U', 'U', 'U', 'U', 'U', 'U', 'U', 'U', // U+0168 ŨũŪūŬŭŮů
  'U', 'U', 'U', 'U', 'W', 'W', 'Y', 'Y', // U+0170 ŰűŲųŴŵŶŷ
  'Y', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'S', // U+0178 ŸŹźŻżŽžſ
];

const COMBINING = /\p{Mn}/u;

export interface Letters {
  /** Uppercase ASCII letters, with single spaces between words when kept. */
  text: string;
  /** Characters that were folded (to a letter) or dropped (to ''), each listed once. */
  changes: { from: string; to: string }[];
}

/**
 * The letters of s as uppercase ASCII: Latin diacritics folded, combining
 * accents and apostrophes dropped, everything else dropped too, except that
 * with keepSpaces a run of non-letters between two words becomes one space.
 */
export function letters(s: string, keepSpaces: boolean): Letters {
  let text = '';
  let gap = false;
  const changes = new Map<string, string>();
  for (const ch of s) {
    const r = ch.codePointAt(0)!;
    let fold = '';
    if ((r >= 0x41 && r <= 0x5a) || (r >= 0x61 && r <= 0x7a)) {
      fold = ch.toUpperCase();
    } else if (r >= LATIN_FOLD_FIRST && r - LATIN_FOLD_FIRST < LATIN_FOLD.length) {
      fold = LATIN_FOLD[r - LATIN_FOLD_FIRST];
      changes.set(ch, fold);
    } else if (ch === "'" || ch === '’' || (r >= 0x300 && COMBINING.test(ch))) {
      changes.set(ch, '');
      continue;
    }
    if (fold === '') {
      changes.set(ch, '');
      gap = keepSpaces;
      continue;
    }
    if (gap && text.length > 0) text += ' ';
    gap = false;
    text += fold;
  }
  return { text, changes: [...changes].map(([from, to]) => ({ from, to })) };
}
