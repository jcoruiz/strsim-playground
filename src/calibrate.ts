// Finding the threshold that best separates pairs labeled as the same thing
// from pairs that are not.

export interface LabeledPair {
  a: string;
  b: string;
  same: boolean;
  /** 1-based line in the pasted text. */
  line: number;
}

export interface ParseError {
  line: number;
  message: string;
}

const YES = new Set(['1', 'yes', 'y', 'true', 'same', 'match', 'sí', 'si', '✓']);
const NO = new Set(['0', 'no', 'n', 'false', 'different', 'diff', 'distinct', '✗']);

/**
 * Reads one pair per line: a, b and a label, separated by tabs, "|", ";" or
 * commas (the first of those the line contains). Blank lines and lines
 * starting with # are skipped.
 */
export function parsePairs(text: string): { pairs: LabeledPair[]; errors: ParseError[] } {
  const pairs: LabeledPair[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, k) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const sep = ['\t', '|', ';', ','].find((s) => line.includes(s)) ?? ',';
    const cols = line.split(sep).map((c) => c.trim());
    if (cols.length !== 3) {
      errors.push({ line: k + 1, message: `expected 3 columns (a, b, yes or no), found ${cols.length}` });
      return;
    }
    const label = cols[2].toLowerCase();
    if (!YES.has(label) && !NO.has(label)) {
      errors.push({ line: k + 1, message: `"${cols[2]}" is not a label: use yes or no` });
      return;
    }
    pairs.push({ a: cols[0], b: cols[1], same: YES.has(label), line: k + 1 });
  });
  return { pairs, errors };
}

export interface Confusion {
  /** Same pairs predicted same, different pairs predicted same, and so on. */
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** NaN when nothing is predicted same (precision) or nothing is labeled same (recall). */
  precision: number;
  recall: number;
  /** 0 when precision or recall is undefined or zero. */
  f1: number;
  accuracy: number;
}

function stats(tp: number, fp: number, fn: number, tn: number): Confusion {
  const precision = tp + fp ? tp / (tp + fp) : NaN;
  const recall = tp + fn ? tp / (tp + fn) : NaN;
  const f1 = precision > 0 && recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const total = tp + fp + fn + tn;
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : NaN };
}

export function confusion(predicted: boolean[], labels: boolean[]): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  predicted.forEach((p, i) => {
    if (p && labels[i]) tp++;
    else if (p) fp++;
    else if (labels[i]) fn++;
    else tn++;
  });
  return stats(tp, fp, fn, tn);
}

/** What FindAboveThreshold keeps: score ≥ threshold. NaN is never kept. */
export const predict = (scores: number[], threshold: number): boolean[] => scores.map((s) => s >= threshold);

export interface Best {
  /** Infinity when keeping nothing scores best. */
  threshold: number;
  confusion: Confusion;
}

/**
 * The shortest decimal in (lo, hi], so the threshold reads well and keeps
 * the same pairs as any value in between.
 */
function between(lo: number, hi: number): number {
  for (let digits = 1; digits <= 6; digits++) {
    const f = 10 ** digits;
    const t = Math.ceil(((lo + hi) / 2) * f) / f;
    if (t > lo && t <= hi) return t;
  }
  return hi;
}

/**
 * The threshold with the best F1 (then accuracy) over the labeled pairs.
 * Only thresholds that change the outcome are tried, one between each two
 * consecutive scores.
 */
export function bestThreshold(scores: number[], labels: boolean[]): Best {
  const order = scores.map((_, i) => i).filter((i) => !Number.isNaN(scores[i]));
  order.sort((x, y) => scores[y] - scores[x]);
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;

  // Keeping nothing.
  const top = order.length ? scores[order[0]] : 0;
  let best: Best = { threshold: top < 1 ? between(top, 1) : Infinity, confusion: stats(0, 0, positives, negatives) };
  if (!order.length) return best;

  let tp = 0;
  let fp = 0;
  for (let k = 0; k < order.length; k++) {
    if (labels[order[k]]) tp++;
    else fp++;
    const s = scores[order[k]];
    // Only cut between distinct scores: ties are kept together.
    if (k + 1 < order.length && scores[order[k + 1]] === s) continue;
    const c = stats(tp, fp, positives - tp, negatives - fp);
    if (c.f1 > best.confusion.f1 || (c.f1 === best.confusion.f1 && c.accuracy > best.confusion.accuracy)) {
      best = { threshold: k + 1 < order.length ? between(scores[order[k + 1]], s) : Math.floor(s * 100) / 100, confusion: c };
    }
  }
  return best;
}
