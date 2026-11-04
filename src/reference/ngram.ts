// N-gram similarities. Cosine counts how often each n-gram appears; Jaccard,
// Dice and Overlap only whether it appears.

import { runes } from './text';

export interface NgramTrace {
  size: number;
  /** One of the strings is empty: every score is 1 if both are, 0 otherwise. */
  empty: boolean;
  /** N-gram → count. A string no longer than the size is its own single n-gram. */
  gramsA: Map<string, number>;
  gramsB: Map<string, number>;
  /** Distinct n-grams present in both, in the order of a. */
  shared: string[];
  dot: number;
  normA: number;
  normB: number;
  cosine: number;
  jaccard: number;
  dice: number;
  overlap: number;
}

export function grams(s: string, n: number): Map<string, number> {
  const r = runes(s);
  if (r.length <= n) return new Map([[s, 1]]);
  const out = new Map<string, number>();
  for (let i = 0; i + n <= r.length; i++) {
    const g = r.slice(i, i + n).join('');
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * Whether the count vectors are proportional (dot² = |A|²·|B|²), checked
 * exactly: their cosine is 1, which the division can round to
 * 0.9999999999999998. strsim returns exactly 1 since v0.2.1.
 */
const proportional = (dot: number, normA: number, normB: number) => BigInt(dot) * BigInt(dot) === BigInt(normA) * BigInt(normB);

export function ngram(a: string, b: string, size: number): NgramTrace {
  const n = size <= 0 ? 2 : size;
  if (a === '' || b === '') {
    const v = a === b ? 1 : 0;
    return {
      size: n,
      empty: true,
      gramsA: new Map(),
      gramsB: new Map(),
      shared: [],
      dot: 0,
      normA: 0,
      normB: 0,
      cosine: v,
      jaccard: v,
      dice: v,
      overlap: v,
    };
  }

  const gramsA = grams(a, n);
  const gramsB = grams(b, n);
  const shared = [...gramsA.keys()].filter((g) => gramsB.has(g));
  let dot = 0;
  for (const g of shared) dot += gramsA.get(g)! * gramsB.get(g)!;
  let normA = 0;
  for (const c of gramsA.values()) normA += c * c;
  let normB = 0;
  for (const c of gramsB.values()) normB += c * c;

  const inter = shared.length;
  return {
    size: n,
    empty: false,
    gramsA,
    gramsB,
    shared,
    dot,
    normA,
    normB,
    cosine: proportional(dot, normA, normB) ? 1 : Math.min(dot / (Math.sqrt(normA) * Math.sqrt(normB)), 1),
    jaccard: inter / (gramsA.size + gramsB.size - inter),
    dice: (2 * inter) / (gramsA.size + gramsB.size),
    overlap: inter / Math.min(gramsA.size, gramsB.size),
  };
}
