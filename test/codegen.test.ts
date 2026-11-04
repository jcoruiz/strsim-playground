import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePairs } from '../src/calibrate';
import { calibrateProgram, compareProgram, searchProgram } from '../src/codegen';
import { DATASETS, LISTS, PAIRS } from '../src/presets';
import { DEFAULT_OPTIONS, ENCODERS, METRICS, algo, toNumber, type Options } from '../src/types';
import { RELEASES } from '../src/versions';
import { loadWasm } from './wasm';

const hasGo = (() => {
  try {
    execFileSync('go', ['version']);
    return true;
  } catch {
    return false;
  }
})();

const CUSTOM: Options = {
  ...DEFAULT_OPTIONS,
  ignoreCase: true,
  insertCost: 2,
  deleteCost: 1,
  replaceCost: 3,
  boostThreshold: 0.6,
  prefixSize: 3,
  ngramSize: 3,
  soundexLength: 6,
  metaphoneLength: 6,
  doubleMetaphoneLength: 5,
  nysiisLength: 0,
};

const COMPARE: { name: string; a: string; b: string; options: Options }[] = [
  ...PAIRS.slice(0, 5).map((p, i) => ({ name: `compare_${i}`, a: p.a, b: p.b, options: DEFAULT_OPTIONS })),
  { name: 'compare_custom', a: 'Straße "quoted"', b: 'STRASSE\tquoted', options: CUSTOM },
  { name: 'compare_hamming', a: 'karolin', b: 'kathrin', options: DEFAULT_OPTIONS },
];

function programs(version: string): [string, string][] {
  const out: [string, string][] = COMPARE.map((c) => [c.name, compareProgram(c.a, c.b, c.options, version)]);
  const list = LISTS[0];
  for (const m of METRICS) {
    for (const [mode, options] of [
      ['top', DEFAULT_OPTIONS],
      ['threshold', CUSTOM],
    ] as const) {
      out.push([
        `search_${m.id}_${mode}`,
        searchProgram({ query: list.query, candidates: list.items, metric: m.id, topN: mode === 'top' ? 5 : 0, threshold: 0.5 }, options, version),
      ]);
    }
  }
  const { pairs } = parsePairs(DATASETS[0].text);
  for (const a of [...METRICS, ...ENCODERS]) {
    out.push([`calibrate_${a.id}`, calibrateProgram({ algo: a.id, threshold: 0.75, pairs }, a.id === 'jaro' ? CUSTOM : DEFAULT_OPTIONS, version)]);
  }
  out.push(['calibrate_none', calibrateProgram({ algo: 'levenshtein', threshold: Infinity, pairs }, DEFAULT_OPTIONS, version)]);
  return out;
}

const NAMES = new Map<string, string>([...METRICS.map((m) => [m.name, m.id] as [string, string]), ...ENCODERS.map((e) => [e.name, e.id] as [string, string])]);

describe.skipIf(!hasGo)('generated Go code', () => {
  const root = mkdtempSync(join(tmpdir(), 'strsim-codegen-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  for (const { version } of RELEASES) {
    describe(`against strsim ${version}`, () => {
      const dir = join(root, version);
      mkdirSync(dir);
      writeFileSync(join(dir, 'go.mod'), `module codegen\n\ngo 1.22\n\nrequire github.com/jcoruiz/strsim ${version}\n`);
      for (const [name, src] of programs(version)) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, 'main.go'), src);
      }

      it('is gofmt-clean', () => {
        expect(execFileSync('gofmt', ['-l', '.'], { cwd: dir }).toString().trim()).toBe('');
      });

      it('compiles and passes go vet', () => {
        execFileSync('go', ['mod', 'tidy'], { cwd: dir, stdio: 'pipe' });
        execFileSync('go', ['vet', './...'], { cwd: dir, stdio: 'pipe' });
      });

      it('prints what the playground shows', async () => {
        const wasm = await loadWasm(version);
        for (const c of COMPARE) {
          const out = execFileSync('go', ['run', `./${c.name}`], { cwd: dir }).toString();
          const res = wasm.run({ op: 'compare', a: c.a, b: c.b, options: c.options });
          const seen = new Set<string>();
          for (const line of out.split('\n').filter(Boolean)) {
            const name = line.slice(0, 20).trim();
            const id = NAMES.get(name);
            if (!id) throw new Error(`unknown line ${line}`);
            seen.add(id);
            const rest = line.slice(20).trim();
            const score = res.scores!.find((s) => s.metric === id);
            if (score) {
              const sim = toNumber(score.similarity);
              const printed = rest.split(/\s+/)[0];
              if (Number.isNaN(sim)) expect(printed, `${c.name} ${name}`).toBe('NaN');
              else expect(Math.abs(Number(printed) - sim), `${c.name} ${name}: ${line}`).toBeLessThan(0.00005 + 1e-12);
              if (score.distance !== undefined) expect(rest, `${c.name} ${name}`).toContain(`distance ${score.distance}`);
            } else {
              const code = res.codes!.find((x) => x.encoder === id)!;
              const [, a, b, match] = rest.match(/^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*")\s+(true|false)$/)!;
              const dual = id === 'doublemetaphone';
              expect([a, b, match], `${c.name} ${name}`).toEqual([
                JSON.stringify(dual ? `${code.a}/${code.altA ?? ''}` : code.a),
                JSON.stringify(dual ? `${code.b}/${code.altB ?? ''}` : code.b),
                String(code.match),
              ]);
            }
          }
          expect(seen.size, c.name).toBe(METRICS.length + ENCODERS.length);
        }
      });

      it('ranks like the playground', async () => {
        const wasm = await loadWasm(version);
        const list = LISTS[0];
        for (const m of ['jarowinkler', 'cosine', 'levenshtein'] as const) {
          const out = execFileSync('go', ['run', `./search_${m}_top`], { cwd: dir }).toString().trim().split('\n');
          const res = wasm.run({ op: 'rank', query: list.query, candidates: list.items, metric: m, topN: 5, threshold: 0, options: DEFAULT_OPTIONS });
          expect(out.map((l) => l.split(/\s+/)[1]), `${algo(m).name}`).toEqual(res.ranked!.map((r) => list.items[r.index]));
        }
      });

      it('checks the labeled pairs with same()', () => {
        const out = execFileSync('go', ['run', './calibrate_soundex'], { cwd: dir }).toString();
        expect(out).toMatch(/\d+ of 40 pairs right\n$/);
      });
    });
  }
});
