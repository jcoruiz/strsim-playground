// Jaro and Jaro-Winkler with every intermediate value kept for the page.

import { runes } from './text';

export interface JaroTrace {
  a: string[];
  b: string[];
  /** How far apart two equal characters may be and still match: max(|a|, |b|)/2 − 1. */
  window: number;
  /** For each character of a, the index of the character of b it matched, or −1. */
  matchOf: number[];
  matched: boolean[];
  matches: number;
  /** Indexes of the matched characters of a and of b, each in string order. */
  orderA: number[];
  orderB: number[];
  /** Positions of those sequences where the characters differ. */
  halfTranspositions: number;
  /** Half of halfTranspositions, rounded down, as in Winkler's strcmp95. */
  transpositions: number;
  similarity: number;
}

export function jaro(sa: string, sb: string): JaroTrace {
  const a = runes(sa);
  const b = runes(sb);
  const la = a.length;
  const lb = b.length;
  const window = Math.max(Math.floor(Math.max(la, lb) / 2) - 1, 0);
  const trace: JaroTrace = {
    a,
    b,
    window,
    matchOf: new Array<number>(la).fill(-1),
    matched: new Array<boolean>(lb).fill(false),
    matches: 0,
    orderA: [],
    orderB: [],
    halfTranspositions: 0,
    transpositions: 0,
    similarity: 0,
  };
  if (la === 0 && lb === 0) {
    trace.similarity = 1;
    return trace;
  }
  if (la === 0 || lb === 0) return trace;

  for (let i = 0; i < la; i++) {
    const hi = Math.min(lb - 1, i + window);
    for (let j = Math.max(0, i - window); j <= hi; j++) {
      if (trace.matched[j] || a[i] !== b[j]) continue;
      trace.matchOf[i] = j;
      trace.matched[j] = true;
      trace.matches++;
      break;
    }
  }
  if (trace.matches === 0) return trace;

  trace.orderA = trace.matchOf.flatMap((j, i) => (j >= 0 ? [i] : []));
  trace.orderB = trace.matched.flatMap((m, j) => (m ? [j] : []));
  trace.halfTranspositions = trace.orderA.filter((i, k) => a[i] !== b[trace.orderB[k]]).length;
  trace.transpositions = Math.floor(trace.halfTranspositions / 2);

  const m = trace.matches;
  trace.similarity = (m / la + m / lb + (m - trace.transpositions) / m) / 3;
  return trace;
}

export interface JaroWinklerTrace {
  jaro: JaroTrace;
  /** Settings in effect: a metric with both at zero uses 0.7 and 4. */
  threshold: number;
  prefixSize: number;
  /** Whether the Jaro similarity reached the threshold, so the prefix counts. */
  boosted: boolean;
  /** Length of the common prefix, up to prefixSize. */
  prefix: number;
  similarity: number;
}

export function jaroWinkler(sa: string, sb: string, boostThreshold: number, prefixSize: number): JaroWinklerTrace {
  let threshold = boostThreshold;
  let size = prefixSize;
  if (threshold === 0 && size === 0) {
    threshold = 0.7;
    size = 4;
  }
  const j = jaro(sa, sb);
  const trace: JaroWinklerTrace = { jaro: j, threshold, prefixSize: size, boosted: false, prefix: 0, similarity: j.similarity };
  if (j.similarity < threshold) return trace;

  const limit = Math.min(j.a.length, j.b.length, size);
  while (trace.prefix < limit && j.a[trace.prefix] === j.b[trace.prefix]) trace.prefix++;
  trace.boosted = true;
  trace.similarity = j.similarity + Math.min(trace.prefix * 0.1, 1) * (1 - j.similarity);
  return trace;
}
