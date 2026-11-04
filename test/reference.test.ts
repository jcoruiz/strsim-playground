// The TypeScript re-implementation must reproduce strsim exactly: it explains
// the scores on the page and flags any value the WASM build gets differently.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { encode, explainEncoder, explainMetric, prepare, same } from '../src/reference';
import { DEFAULT_OPTIONS, ENCODERS, METRICS, toNumber, type Options } from '../src/types';
import { LATEST } from '../src/versions';
import { randomPair, rng } from './random';
import { loadWasm, type Wasm } from './wasm';

const surnames = readFileSync(new URL('./fixtures/phonetic_reference.tsv', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .map((l) => l.split('\t'));

describe('phonetic encoders against Apache Commons Codec', () => {
  // The same three documented differences as strsim's TestPhoneticReference.
  const nysiisUnlimited = { ...DEFAULT_OPTIONS, nysiisLength: 0 };

  it('reads 3,000 surnames', () => expect(surnames).toHaveLength(3000));

  it('Soundex', () => {
    for (const [name, code] of surnames) expect(encode('soundex', name, DEFAULT_OPTIONS).code, name).toBe(code);
  });

  it('Metaphone, except an initial CH, which strsim always codes X', () => {
    for (const [name, , code] of surnames) {
      if (!name.toUpperCase().startsWith('CH')) expect(encode('metaphone', name, DEFAULT_OPTIONS).code, name).toBe(code);
    }
  });

  it('Double Metaphone, without the trailing space Commons Codec leaves', () => {
    for (const [name, , , pri, alt] of surnames) {
      const t = encode('doublemetaphone', name, DEFAULT_OPTIONS);
      expect([t.code, t.alt], name).toEqual([pri, alt.trimEnd()]);
    }
  });

  it('NYSIIS, except one-letter keys, which strsim keeps', () => {
    for (const [name, , , , , code] of surnames) {
      const got = encode('nysiis', name, nysiisUnlimited).code;
      if (!(code === '' && got.length === 1)) expect(got, name).toBe(code);
    }
  });
});

describe(`the re-implementation matches strsim ${LATEST}`, () => {
  let wasm: Wasm;
  beforeAll(async () => {
    wasm = await loadWasm(LATEST);
  });

  const optionSets: [string, Options][] = [
    ['default options', DEFAULT_OPTIONS],
    ['ignoring case', { ...DEFAULT_OPTIONS, ignoreCase: true }],
    [
      'other settings',
      {
        ...DEFAULT_OPTIONS,
        insertCost: 2,
        deleteCost: 0,
        replaceCost: 3,
        boostThreshold: 0.5,
        prefixSize: 6,
        ngramSize: 3,
        soundexLength: 6,
        metaphoneLength: 8,
        doubleMetaphoneLength: 6,
        nysiisLength: 0,
      },
    ],
    ['zero values', { ...DEFAULT_OPTIONS, insertCost: 0, deleteCost: 0, replaceCost: 0, boostThreshold: 0, prefixSize: 0, ngramSize: 0, soundexLength: 0, metaphoneLength: 0, doubleMetaphoneLength: 0, nysiisLength: -1 }],
  ];

  for (const [label, options] of optionSets) {
    it(`on random pairs, ${label}`, () => {
      const next = rng(label.length * 7919);
      const pairs = Array.from({ length: 1500 }, () => randomPair(next, 12));
      const res = wasm.run({ op: 'pairs', pairs, options });
      expect(res.ok, res.error).toBe(true);
      for (const m of METRICS) {
        res.similarities![m.id].forEach((v, i) => {
          const want = explainMetric(m.id, pairs[i][0], pairs[i][1], options).similarity;
          if (!same(toNumber(v), want)) expect.fail(`${m.id}(${JSON.stringify(pairs[i])}) = ${v} in Go, ${want} here`);
        });
      }
      for (const e of ENCODERS) {
        res.matches![e.id].forEach((v, i) => {
          if (v !== explainEncoder(e.id, pairs[i][0], pairs[i][1], options).match) expect.fail(`${e.id} match ${JSON.stringify(pairs[i])} = ${v} in Go`);
        });
      }
    });

    it(`on distances and codes, ${label}`, () => {
      const next = rng(label.length * 104729);
      for (let k = 0; k < 400; k++) {
        const [a, b] = randomPair(next, 16);
        const res = wasm.run({ op: 'compare', a, b, options });
        expect(res.ok, res.error).toBe(true);
        for (const s of res.scores!) {
          const want = explainMetric(s.metric, a, b, options);
          if (!same(toNumber(s.similarity), want.similarity)) expect.fail(`${s.metric}(${JSON.stringify([a, b])}) similarity`);
          if (want.distance !== undefined && (s.distance ?? null) !== want.distance) {
            expect.fail(`${s.metric}(${JSON.stringify([a, b])}) distance = ${s.distance} in Go, ${want.distance} here`);
          }
        }
        for (const c of res.codes!) {
          const want = explainEncoder(c.encoder, a, b, options);
          const got = [c.a, c.altA ?? '', c.b, c.altB ?? '', c.match];
          const expected = [want.a.code, want.a.alt ?? '', want.b.code, want.b.alt ?? '', want.match];
          if (JSON.stringify(got) !== JSON.stringify(expected)) expect.fail(`${c.encoder}(${JSON.stringify([a, b])}): Go ${got}, here ${expected}`);
        }
      }
    });
  }

  it('on the surnames, codes and matches', () => {
    for (let i = 0; i + 1 < surnames.length; i += 2) {
      const [a, b] = [surnames[i][0], surnames[i + 1][0]];
      const res = wasm.run({ op: 'compare', a, b, options: DEFAULT_OPTIONS });
      for (const c of res.codes!) {
        const want = explainEncoder(c.encoder, a, b, DEFAULT_OPTIONS);
        expect([c.a, c.altA ?? '', c.b, c.altB ?? '', c.match], `${c.encoder} ${a} ${b}`).toEqual([want.a.code, want.a.alt ?? '', want.b.code, want.b.alt ?? '', want.match]);
      }
    }
  });
});

describe('explanations are consistent', () => {
  const next = rng(42);
  const pairs = Array.from({ length: 2000 }, () => randomPair(next, 10));

  it('edit paths add up to the distance and spell both strings', () => {
    const options = { ...DEFAULT_OPTIONS, insertCost: 2, deleteCost: 1, replaceCost: 3 };
    for (const [a, b] of pairs) {
      for (const id of ['levenshtein', 'osa', 'damerau', 'lcs'] as const) {
        const { trace } = explainMetric(id, a, b, options);
        if (trace.kind !== 'edit' && trace.kind !== 'lcs') throw new Error(trace.kind);
        const t = trace.trace;
        const ctx = `${id} ${JSON.stringify([a, b])}`;
        expect(t.ops.map((o) => o.a).join(''), ctx).toBe(prepare(a, options));
        expect(t.ops.map((o) => o.b).join(''), ctx).toBe(prepare(b, options));
        if (trace.kind === 'edit') expect(t.ops.reduce((s, o) => s + o.cost, 0), ctx).toBe(trace.trace.distance);
        else expect(t.ops.filter((o) => o.kind === 'match').length, ctx).toBe(trace.trace.length);
        expect(t.path[0], ctx).toEqual([0, 0]);
        expect(t.path.at(-1), ctx).toEqual([t.a.length, t.b.length]);
      }
    }
  });

  it('phonetic steps build the code', () => {
    for (const [a] of pairs) {
      for (const e of ENCODERS) {
        const t = encode(e.id, a, { ...DEFAULT_OPTIONS, soundexLength: 99, metaphoneLength: 99, doubleMetaphoneLength: 99, nysiisLength: 0 });
        const built = t.steps.map((s) => s.out).join('');
        if (e.id === 'nysiis') continue; // the final rules trim the key
        if (e.id === 'soundex') expect(t.code.startsWith(built), `${e.id} ${a}`).toBe(true);
        else expect(built, `${e.id} ${a}`).toBe(t.code);
        if (e.id === 'doublemetaphone') expect(t.steps.map((s) => s.alt).join(''), a).toBe(t.alt);
      }
    }
  });
});
