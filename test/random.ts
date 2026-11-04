// Seeded random strings that reach the corners of the algorithms: accents
// in composed and decomposed form, apostrophes, spaces, case pairs that
// strings.ToLower maps on its own, and characters outside the BMP.

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  ...'aabcdeeghiklmnorsstuwyz',
  ...'ABCHKMSTWX',
  ...'áéñöüßçøÆŁ',
  'é',
  ...'İΣσ',
  "'",
  ' ',
  '-',
  '1',
  '😀',
  '中',
];
const NAMEISH = ['ch', 'sch', 'gh', 'ph', 'th', 'wr', 'kn', 'cz', 'wicz', 'mac ', 'van ', 'san ', 'ough', 'tion', 'cc', 'dg', 'jose', 'ier', 'aux'];

export function randomString(next: () => number, maxLen: number): string {
  const len = Math.floor(next() * (maxLen + 1));
  let s = '';
  while ([...s].length < len) {
    s += next() < 0.25 ? NAMEISH[Math.floor(next() * NAMEISH.length)] : ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  return s;
}

/** A string, a near copy of it (one or two edits), or an unrelated one. */
export function randomPair(next: () => number, maxLen: number): [string, string] {
  const a = randomString(next, maxLen);
  if (next() < 0.4) return [a, randomString(next, maxLen)];
  const chars = [...a];
  for (let k = 0; k < 1 + Math.floor(next() * 2); k++) {
    const i = Math.floor(next() * (chars.length + 1));
    const r = next();
    if (r < 0.3 && i < chars.length - 1) [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    else if (r < 0.55) chars.splice(i, 1);
    else if (r < 0.8) chars.splice(i, 0, ALPHABET[Math.floor(next() * ALPHABET.length)]);
    else if (i < chars.length) chars[i] = ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  return [a, chars.join('')];
}
