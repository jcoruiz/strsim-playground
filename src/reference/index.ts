// The TypeScript re-implementation of strsim: it explains every score on the
// page and checks every value the WASM build returns.

import type { EncoderId, MetricId, Options } from '../types';
import { damerau, hamming, lcs, levenshtein, normalizeCosts, osa, type Costs, type EditTrace, type HammingTrace, type LcsTrace } from './edit';
import { jaro, jaroWinkler, type JaroTrace, type JaroWinklerTrace } from './jaro';
import { ngram, type NgramTrace } from './ngram';
import { doubleMetaphone, doubleMetaphoneMatch, metaphone, nysiis, soundex, type PhoneticTrace } from './phonetic';
import { goLower, wellFormed } from './text';

/** The string Go receives: well-formed UTF-8, lowercased when the options say so. */
export const prepare = (s: string, o: Options): string => (o.ignoreCase ? goLower(wellFormed(s)) : wellFormed(s));

export type NgramMetricId = 'cosine' | 'jaccard' | 'dice' | 'overlap';

export type MetricTrace =
  | { kind: 'edit'; metric: 'levenshtein' | 'osa' | 'damerau'; trace: EditTrace; costs: Costs }
  | { kind: 'lcs'; trace: LcsTrace }
  | { kind: 'hamming'; trace: HammingTrace }
  | { kind: 'jaro'; trace: JaroTrace }
  | { kind: 'jarowinkler'; trace: JaroWinklerTrace }
  | { kind: 'ngram'; metric: NgramMetricId; trace: NgramTrace };

export interface MetricExplanation {
  similarity: number;
  /** Edit distance; null when Distance panics (Hamming on different lengths). */
  distance?: number | null;
  trace: MetricTrace;
}

const UNIT: Costs = { ins: 1, del: 1, rep: 1 };

export function explainMetric(id: MetricId, rawA: string, rawB: string, o: Options): MetricExplanation {
  const a = prepare(rawA, o);
  const b = prepare(rawB, o);
  switch (id) {
    case 'levenshtein': {
      const costs = normalizeCosts(o.insertCost, o.deleteCost, o.replaceCost);
      const t = levenshtein(a, b, costs);
      return { similarity: t.similarity, distance: t.distance, trace: { kind: 'edit', metric: id, trace: t, costs } };
    }
    case 'osa':
    case 'damerau': {
      const t = id === 'osa' ? osa(a, b) : damerau(a, b);
      return { similarity: t.similarity, distance: t.distance, trace: { kind: 'edit', metric: id, trace: t, costs: UNIT } };
    }
    case 'lcs': {
      const t = lcs(a, b);
      return { similarity: t.similarity, distance: t.distance, trace: { kind: 'lcs', trace: t } };
    }
    case 'hamming': {
      const t = hamming(a, b);
      return { similarity: t.similarity, distance: t.distance, trace: { kind: 'hamming', trace: t } };
    }
    case 'jaro': {
      const t = jaro(a, b);
      return { similarity: t.similarity, trace: { kind: 'jaro', trace: t } };
    }
    case 'jarowinkler': {
      const t = jaroWinkler(a, b, o.boostThreshold, o.prefixSize);
      return { similarity: t.similarity, trace: { kind: 'jarowinkler', trace: t } };
    }
    case 'cosine':
    case 'jaccard':
    case 'dice':
    case 'overlap': {
      const t = ngram(a, b, o.ngramSize);
      return { similarity: t[id], trace: { kind: 'ngram', metric: id, trace: t } };
    }
  }
}

export interface EncoderExplanation {
  a: PhoneticTrace;
  b: PhoneticTrace;
  match: boolean;
}

export function encode(id: EncoderId, raw: string, o: Options): PhoneticTrace {
  const s = prepare(raw, o);
  switch (id) {
    case 'soundex':
      return soundex(s, o.soundexLength);
    case 'metaphone':
      return metaphone(s, o.metaphoneLength);
    case 'doublemetaphone':
      return doubleMetaphone(s, o.doubleMetaphoneLength);
    case 'nysiis':
      return nysiis(s, o.nysiisLength);
  }
}

export function explainEncoder(id: EncoderId, rawA: string, rawB: string, o: Options): EncoderExplanation {
  const a = encode(id, rawA, o);
  const b = encode(id, rawB, o);
  return { a, b, match: id === 'doublemetaphone' ? doubleMetaphoneMatch(a, b) : a.code === b.code };
}

/** Whether two values from Go and from here agree: NaN equals NaN. */
export const same = (x: number, y: number): boolean => x === y || (Number.isNaN(x) && Number.isNaN(y));
