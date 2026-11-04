import { describe, expect, it } from 'vitest';
import { bestThreshold, confusion, parsePairs, predict } from '../src/calibrate';
import { DATASETS } from '../src/presets';

describe('parsePairs', () => {
  it('reads tabs, bars, semicolons and commas, and skips comments', () => {
    const { pairs, errors } = parsePairs('# names\nJon\tJohn\tyes\nSmith | Smythe | 1\n\nAna; Anna; sí\nMark, Mary, no\n');
    expect(errors).toEqual([]);
    expect(pairs.map((p) => [p.a, p.b, p.same, p.line])).toEqual([
      ['Jon', 'John', true, 2],
      ['Smith', 'Smythe', true, 3],
      ['Ana', 'Anna', true, 5],
      ['Mark', 'Mary', false, 6],
    ]);
  });

  it('keeps commas inside values when another separator is used', () => {
    expect(parsePairs('Smith, John | John Smith | yes').pairs[0].a).toBe('Smith, John');
  });

  it('reports bad lines with their number', () => {
    const { pairs, errors } = parsePairs('a, b\na, b, maybe\na, b, yes');
    expect(pairs).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([1, 2]);
  });

  it('parses every built-in dataset', () => {
    for (const d of DATASETS) {
      const { pairs, errors } = parsePairs(d.text);
      expect(errors, d.key).toEqual([]);
      expect(pairs.some((p) => p.same) && pairs.some((p) => !p.same), d.key).toBe(true);
    }
  });
});

describe('bestThreshold', () => {
  it('separates perfectly separable scores between the two groups', () => {
    const best = bestThreshold([0.95, 0.9, 0.85, 0.4, 0.3], [true, true, true, false, false]);
    expect(best.confusion).toMatchObject({ tp: 3, fp: 0, fn: 0, tn: 2, f1: 1 });
    expect(best.threshold).toBeGreaterThan(0.4);
    expect(best.threshold).toBeLessThanOrEqual(0.85);
    expect(best.threshold).toBe(0.7);
  });

  it('keeps what it predicts consistent with FindAboveThreshold', () => {
    const scores = [0.81, 0.8, 0.8, 0.79, 0.2, NaN];
    const labels = [true, false, true, true, false, true];
    const best = bestThreshold(scores, labels);
    expect(confusion(predict(scores, best.threshold), labels)).toEqual(best.confusion);
  });

  it('never splits tied scores', () => {
    const best = bestThreshold([0.5, 0.5, 0.5], [true, false, true]);
    expect(predict([0.5, 0.5, 0.5], best.threshold)).toEqual([true, true, true]);
  });

  it('keeps nothing when no pair is the same', () => {
    expect(bestThreshold([0.3, 0.2], [false, false]).confusion.tn).toBe(2);
    expect(bestThreshold([1, 0.2], [false, false]).threshold).toBe(Infinity);
  });

  it('keeps everything down to the lowest score when all pairs are the same', () => {
    const best = bestThreshold([0.9, 0.333], [true, true]);
    expect(best.threshold).toBe(0.33);
    expect(best.confusion.recall).toBe(1);
  });
});
