// Edit distances, written from their definitions and keeping the whole
// matrix, so the page can show the path behind each distance. Values must
// equal strsim's: test/reference.test.ts compares them with the WASM builds.

import { runes } from './text';

export type OpKind = 'match' | 'sub' | 'ins' | 'del' | 'swap';

/**
 * One step of an alignment. a and b are the characters it covers in each
 * string: one each for a match or a substitution, none on one side for an
 * insertion or a deletion, and the swapped span for a transposition (with
 * any characters Damerau-Levenshtein edits between them).
 */
export interface Op {
  kind: OpKind;
  a: string;
  b: string;
  cost: number;
}

export interface EditTrace {
  a: string[];
  b: string[];
  /** matrix[i][j]: distance between the first i characters of a and the first j of b. */
  matrix: number[][];
  /** Cells of one optimal path, from [0, 0] to [|a|, |b|]. */
  path: [number, number][];
  ops: Op[];
  distance: number;
  similarity: number;
  /** Denominator of the similarity: the longer length, times the largest cost for Levenshtein. */
  scale: number;
}

export interface Costs {
  ins: number;
  del: number;
  rep: number;
}

/** LevenshteinMetric.costs: negative costs count as 0, and all zero means unit costs. */
export function normalizeCosts(ins: number, del: number, rep: number): Costs {
  const c = { ins: Math.max(ins, 0), del: Math.max(del, 0), rep: Math.max(rep, 0) };
  return c.ins === 0 && c.del === 0 && c.rep === 0 ? { ins: 1, del: 1, rep: 1 } : c;
}

const grid = (rows: number, cols: number): number[][] => Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

function finish(a: string[], b: string[], matrix: number[][], path: [number, number][], ops: Op[], maxCost: number): EditTrace {
  const distance = matrix[a.length][b.length];
  const maxLen = Math.max(a.length, b.length);
  const scale = maxLen * maxCost;
  path.reverse();
  ops.reverse();
  return { a, b, matrix, path, ops, distance, similarity: maxLen === 0 ? 1 : 1 - distance / scale, scale };
}

/** Levenshtein distance with insertion, deletion and substitution costs. */
export function levenshtein(sa: string, sb: string, costs: Costs): EditTrace {
  const a = runes(sa);
  const b = runes(sb);
  const { ins, del, rep } = costs;
  const d = grid(a.length + 1, b.length + 1);
  for (let i = 0; i <= a.length; i++) d[i][0] = i * del;
  for (let j = 0; j <= b.length; j++) d[0][j] = j * ins;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : rep;
      d[i][j] = Math.min(d[i - 1][j] + del, d[i][j - 1] + ins, d[i - 1][j - 1] + cost);
    }
  }

  const path: [number, number][] = [[a.length, b.length]];
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && a[i - 1] === b[j - 1];
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same ? 0 : rep)) {
      ops.push({ kind: same ? 'match' : 'sub', a: a[i - 1], b: b[j - 1], cost: same ? 0 : rep });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + del) {
      ops.push({ kind: 'del', a: a[i - 1], b: '', cost: del });
      i--;
    } else {
      ops.push({ kind: 'ins', a: '', b: b[j - 1], cost: ins });
      j--;
    }
    path.push([i, j]);
  }
  return finish(a, b, d, path, ops, Math.max(ins, del, rep));
}

/** Optimal string alignment: Levenshtein plus swapping two adjacent characters, each substring edited at most once. */
export function osa(sa: string, sb: string): EditTrace {
  const a = runes(sa);
  const b = runes(sb);
  const d = grid(a.length + 1, b.length + 1);
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  const swappable = (i: number, j: number) => i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (swappable(i, j)) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
    }
  }

  const path: [number, number][] = [[a.length, b.length]];
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && a[i - 1] === b[j - 1];
    if (!same && swappable(i, j) && d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push({ kind: 'swap', a: a[i - 2] + a[i - 1], b: b[j - 2] + b[j - 1], cost: 1 });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      ops.push({ kind: same ? 'match' : 'sub', a: a[i - 1], b: b[j - 1], cost: same ? 0 : 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: 'del', a: a[i - 1], b: '', cost: 1 });
      i--;
    } else {
      ops.push({ kind: 'ins', a: '', b: b[j - 1], cost: 1 });
      j--;
    }
    path.push([i, j]);
  }
  return finish(a, b, d, path, ops, 1);
}

/**
 * Unrestricted Damerau-Levenshtein (Lowrance-Wagner): a transposition may
 * have characters inserted or deleted between the two swapped ones.
 */
export function damerau(sa: string, sb: string): EditTrace {
  const a = runes(sa);
  const b = runes(sb);
  const la = a.length;
  const lb = b.length;
  // h is the matrix with an extra border row and column holding maxDist;
  // h[i + 1][j + 1] is the distance for the first i and j characters.
  const maxDist = la + lb;
  const h = grid(la + 2, lb + 2);
  h[0][0] = maxDist;
  for (let i = 0; i <= la; i++) {
    h[i + 1][0] = maxDist;
    h[i + 1][1] = i;
  }
  for (let j = 0; j <= lb; j++) {
    h[0][j + 1] = maxDist;
    h[1][j + 1] = j;
  }
  // Where each cell came from, for the path: [kind, i0, j0] in matrix coordinates.
  const from: [OpKind, number, number][][] = Array.from({ length: la + 1 }, () => []);
  const lastRow = new Map<string, number>();
  for (let i = 1; i <= la; i++) {
    let lastCol = 0;
    for (let j = 1; j <= lb; j++) {
      const i1 = lastRow.get(b[j - 1]) ?? 0;
      const j1 = lastCol;
      let cost = 1;
      if (a[i - 1] === b[j - 1]) {
        cost = 0;
        lastCol = j;
      }
      const sub = h[i][j] + cost;
      const trans = h[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1);
      const del = h[i][j + 1] + 1;
      const ins = h[i + 1][j] + 1;
      const best = Math.min(sub, ins, del, trans);
      h[i + 1][j + 1] = best;
      if (sub === best) from[i][j] = [cost === 0 ? 'match' : 'sub', i - 1, j - 1];
      else if (trans === best) from[i][j] = ['swap', i1 - 1, j1 - 1];
      else if (del === best) from[i][j] = ['del', i - 1, j];
      else from[i][j] = ['ins', i, j - 1];
    }
    lastRow.set(a[i - 1], i);
  }

  const d = h.slice(1).map((row) => row.slice(1));
  const path: [number, number][] = [[la, lb]];
  const ops: Op[] = [];
  let i = la;
  let j = lb;
  while (i > 0 || j > 0) {
    const [kind, i0, j0] = i === 0 ? (['ins', 0, j - 1] as const) : j === 0 ? (['del', i - 1, 0] as const) : from[i][j];
    const sa2 = a.slice(i0, i).join('');
    const sb2 = b.slice(j0, j).join('');
    ops.push({ kind, a: sa2, b: sb2, cost: d[i][j] - d[i0][j0] });
    i = i0;
    j = j0;
    path.push([i, j]);
  }
  return finish(a, b, d, path, ops, 1);
}

export interface LcsTrace {
  a: string[];
  b: string[];
  matrix: number[][];
  path: [number, number][];
  /** Alignment where the matches are one longest common subsequence. */
  ops: Op[];
  length: number;
  distance: number;
  similarity: number;
}

/** Longest common subsequence: LCSDistance is |a| + |b| − 2·LCS, the similarity LCS / longer length. */
export function lcs(sa: string, sb: string): LcsTrace {
  const a = runes(sa);
  const b = runes(sb);
  const l = grid(a.length + 1, b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      l[i][j] = a[i - 1] === b[j - 1] ? l[i - 1][j - 1] + 1 : Math.max(l[i - 1][j], l[i][j - 1]);
    }
  }

  const path: [number, number][] = [[a.length, b.length]];
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'match', a: a[i - 1], b: b[j - 1], cost: 0 });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || l[i - 1][j] >= l[i][j - 1])) {
      ops.push({ kind: 'del', a: a[i - 1], b: '', cost: 1 });
      i--;
    } else {
      ops.push({ kind: 'ins', a: '', b: b[j - 1], cost: 1 });
      j--;
    }
    path.push([i, j]);
  }
  path.reverse();
  ops.reverse();
  const length = l[a.length][b.length];
  const maxLen = Math.max(a.length, b.length);
  return {
    a,
    b,
    matrix: l,
    path,
    ops,
    length,
    distance: a.length + b.length - 2 * length,
    similarity: maxLen === 0 ? 1 : length / maxLen,
  };
}

export interface HammingTrace {
  a: string[];
  b: string[];
  /** Whether the lengths are equal; Distance panics otherwise and Similarity returns 0. */
  sameLength: boolean;
  /** Positions that differ, when the lengths are equal. */
  differ: boolean[];
  distance: number | null;
  similarity: number;
}

export function hamming(sa: string, sb: string): HammingTrace {
  const a = runes(sa);
  const b = runes(sb);
  if (a.length !== b.length) return { a, b, sameLength: false, differ: [], distance: null, similarity: 0 };
  const differ = a.map((c, i) => c !== b[i]);
  const distance = differ.filter(Boolean).length;
  return { a, b, sameLength: true, differ, distance, similarity: a.length === 0 ? 1 : 1 - distance / a.length };
}
