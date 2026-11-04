// Page state <-> compact URL fragment, and the sanitizing that any shared
// state goes through before it touches the app.

import { DEFAULT_OPTIONS, MAX_COMPARE_RUNES, MAX_LIST_LEN, isEncoder, isMetric, type AlgoId, type MetricId, type Options } from './types';
import { LATEST, isRelease } from './versions';

export type View = 'compare' | 'search' | 'calibrate';
export const VIEWS: readonly View[] = ['compare', 'search', 'calibrate'];

export interface Snapshot {
  view: View;
  version: string;
  options: Options;
  compare?: { a: string; b: string; algo: AlgoId };
  search?: { query: string; list: string; metric: MetricId; topN: number; threshold: number };
  calibrate?: { text: string; algo?: AlgoId; threshold?: number };
}

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encode(s: Snapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  return b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decode(fragment: string): Promise<Snapshot> {
  const bytes = await pipe(fromB64url(fragment), new DecompressionStream('deflate-raw'));
  return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
}

const MAX_TEXT = MAX_LIST_LEN * 120;

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const int = (v: unknown, def: number, lo: number, hi: number) => Math.round(num(v, def, lo, hi));
const text = (v: unknown, max: number, def = '') => (typeof v === 'string' ? [...v].slice(0, max).join('') : def);
const algoId = (v: unknown, def: AlgoId): AlgoId => (typeof v === 'string' && (isMetric(v) || isEncoder(v)) ? v : def);

export function sanitizeOptions(v: unknown): Options {
  const o = obj(v);
  const d = DEFAULT_OPTIONS;
  return {
    ignoreCase: o.ignoreCase === true,
    insertCost: int(o.insertCost, d.insertCost, 0, 99),
    deleteCost: int(o.deleteCost, d.deleteCost, 0, 99),
    replaceCost: int(o.replaceCost, d.replaceCost, 0, 99),
    boostThreshold: num(o.boostThreshold, d.boostThreshold, 0, 1),
    prefixSize: int(o.prefixSize, d.prefixSize, 0, 20),
    ngramSize: int(o.ngramSize, d.ngramSize, 1, 10),
    soundexLength: int(o.soundexLength, d.soundexLength, 1, 20),
    metaphoneLength: int(o.metaphoneLength, d.metaphoneLength, 1, 20),
    doubleMetaphoneLength: int(o.doubleMetaphoneLength, d.doubleMetaphoneLength, 1, 20),
    nysiisLength: int(o.nysiisLength, d.nysiisLength, 0, 20),
  };
}

export function sanitize(input: unknown): Snapshot {
  const o = obj(input);
  const view = VIEWS.includes(o.view as View) ? (o.view as View) : 'compare';
  const snap: Snapshot = { view, version: isRelease(o.version) ? o.version : LATEST, options: sanitizeOptions(o.options) };
  if (o.compare !== undefined) {
    const c = obj(o.compare);
    snap.compare = { a: text(c.a, MAX_COMPARE_RUNES), b: text(c.b, MAX_COMPARE_RUNES), algo: algoId(c.algo, 'jarowinkler') };
  }
  if (o.search !== undefined) {
    const s = obj(o.search);
    const metric = algoId(s.metric, 'jarowinkler');
    snap.search = {
      query: text(s.query, 200),
      list: text(s.list, MAX_TEXT),
      metric: isMetric(metric) ? metric : 'jarowinkler',
      topN: int(s.topN, 10, 0, MAX_LIST_LEN),
      threshold: num(s.threshold, 0.8, 0, 1),
    };
  }
  if (o.calibrate !== undefined) {
    const c = obj(o.calibrate);
    snap.calibrate = { text: text(c.text, MAX_TEXT) };
    if (c.algo !== undefined) snap.calibrate.algo = algoId(c.algo, 'jarowinkler');
    if (typeof c.threshold === 'number') snap.calibrate.threshold = num(c.threshold, 0.8, 0, 1);
  }
  return snap;
}
