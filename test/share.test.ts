import { describe, expect, it } from 'vitest';
import { decode, encode, sanitize, type Snapshot } from '../src/share';
import { DEFAULT_OPTIONS } from '../src/types';
import { LATEST, RELEASES, atLeast } from '../src/versions';
import { loadWasm } from './wasm';

describe('versions', () => {
  it('lists the newest release first', () => {
    for (const r of RELEASES.slice(1)) expect(atLeast(LATEST, r.version)).toBe(true);
    expect(atLeast('v0.1.0', 'v0.2.0')).toBe(false);
    expect(atLeast('v0.10.0', 'v0.9.1')).toBe(true);
  });

  it('really differ where the changelog says', async () => {
    const [v1, v2, v21] = await Promise.all([loadWasm('v0.1.0'), loadWasm('v0.2.0'), loadWasm('v0.2.1')]);
    expect(v21.info.strsim).toBe('v0.2.1');
    // v0.2.1: Cosine of a string with itself is exactly 1.
    const cosine = (w: typeof v1) => w.run({ op: 'compare', a: 'martha', b: 'martha', options: DEFAULT_OPTIONS }).scores!.find((s) => s.metric === 'cosine')!.similarity;
    expect([cosine(v2), cosine(v21)]).toEqual([0.9999999999999998, 1]);
    expect(v1.info.strsim).toBe('v0.1.0');
    expect(v2.info.strsim).toBe('v0.2.0');
    const compare = (a: string, b: string, options = DEFAULT_OPTIONS) => [v1, v2].map((w) => w.run({ op: 'compare', a, b, options }));
    // Double Metaphone codes no longer contain spaces.
    const [old, cur] = compare('Horwicz', 'Horowitz');
    expect(old.codes!.find((c) => c.encoder === 'doublemetaphone')!.a).toBe('HR K');
    expect(cur.codes!.find((c) => c.encoder === 'doublemetaphone')!.a).toBe('HRTS');
    // All-zero Levenshtein costs gave NaN.
    const [zero1, zero2] = compare('abc', 'abd', { ...DEFAULT_OPTIONS, insertCost: 0, deleteCost: 0, replaceCost: 0 });
    expect(zero1.scores![0].similarity).toBe('NaN');
    expect(zero2.scores![0].similarity).toBeCloseTo(2 / 3);
  });
});

describe('shared links', () => {
  const snap: Snapshot = {
    view: 'search',
    version: 'v0.1.0',
    options: { ...DEFAULT_OPTIONS, ignoreCase: true, ngramSize: 3 },
    search: { query: 'Müller', list: 'Mueller\nMuller\n😀', metric: 'cosine', topN: 0, threshold: 0.42 },
  };

  it('round-trip', async () => {
    expect(await decode(await encode(snap))).toEqual(snap);
  });

  it('fall back to safe values', () => {
    const s = sanitize({ view: 'nope', version: 'v9.9.9', options: { ngramSize: -3, boostThreshold: 'x', nysiisLength: 99 }, compare: { a: 42, algo: 'nope' } });
    expect(s.view).toBe('compare');
    expect(s.version).toBe(LATEST);
    expect(s.options.ngramSize).toBe(1);
    expect(s.options.boostThreshold).toBe(DEFAULT_OPTIONS.boostThreshold);
    expect(s.options.nysiisLength).toBe(20);
    expect(s.compare).toEqual({ a: '', b: '', algo: 'jarowinkler' });
  });

  it('cut long strings by characters, not UTF-16 units', () => {
    expect([...sanitize({ compare: { a: '😀'.repeat(600) } }).compare!.a]).toHaveLength(500);
  });
});
