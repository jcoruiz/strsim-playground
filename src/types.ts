// What the page sends to the Go bridge (wasm/bridge.go) and gets back, and
// the catalog of metrics and encoders.

export interface Options {
  /** Lowercase both strings with strings.ToLower before comparing. */
  ignoreCase: boolean;
  insertCost: number;
  deleteCost: number;
  replaceCost: number;
  boostThreshold: number;
  prefixSize: number;
  ngramSize: number;
  soundexLength: number;
  metaphoneLength: number;
  doubleMetaphoneLength: number;
  /** 0 means unlimited. */
  nysiisLength: number;
}

/** The values the strsim constructors use. */
export const DEFAULT_OPTIONS: Readonly<Options> = {
  ignoreCase: false,
  insertCost: 1,
  deleteCost: 1,
  replaceCost: 1,
  boostThreshold: 0.7,
  prefixSize: 4,
  ngramSize: 2,
  soundexLength: 4,
  metaphoneLength: 4,
  doubleMetaphoneLength: 4,
  nysiisLength: 6,
};

export type MetricId = 'levenshtein' | 'osa' | 'damerau' | 'lcs' | 'hamming' | 'jaro' | 'jarowinkler' | 'cosine' | 'jaccard' | 'dice' | 'overlap';
export type EncoderId = 'soundex' | 'metaphone' | 'doublemetaphone' | 'nysiis';
export type AlgoId = MetricId | EncoderId;

export type Family = 'edit' | 'match' | 'ngram' | 'phonetic';

export interface MetricInfo {
  id: MetricId;
  name: string;
  family: Exclude<Family, 'phonetic'>;
  /** Whether it also has an edit distance. */
  distance: boolean;
  about: string;
}

export interface EncoderInfo {
  id: EncoderId;
  name: string;
  family: 'phonetic';
  about: string;
}

export const METRICS: readonly MetricInfo[] = [
  { id: 'levenshtein', name: 'Levenshtein', family: 'edit', distance: true, about: 'Fewest insertions, deletions and substitutions. Costs are configurable.' },
  { id: 'osa', name: 'OSA', family: 'edit', distance: true, about: 'Optimal string alignment: Levenshtein plus swapping two adjacent characters.' },
  {
    id: 'damerau',
    name: 'Damerau-Levenshtein',
    family: 'edit',
    distance: true,
    about: 'Levenshtein plus transpositions, with edits allowed between the swapped characters.',
  },
  { id: 'lcs', name: 'LCS', family: 'edit', distance: true, about: 'Longest common subsequence: characters in the same order, gaps allowed.' },
  { id: 'hamming', name: 'Hamming', family: 'edit', distance: true, about: 'Positions that differ. Only for strings of the same length.' },
  { id: 'jaro', name: 'Jaro', family: 'match', distance: false, about: 'Characters in common within a window, and how many are out of order.' },
  { id: 'jarowinkler', name: 'Jaro-Winkler', family: 'match', distance: false, about: 'Jaro with a bonus for a common prefix. Made for short strings such as names.' },
  { id: 'cosine', name: 'Cosine', family: 'ngram', distance: false, about: 'Angle between the n-gram count vectors.' },
  { id: 'jaccard', name: 'Jaccard', family: 'ngram', distance: false, about: 'Shared n-grams over all distinct n-grams.' },
  { id: 'dice', name: 'Sørensen-Dice', family: 'ngram', distance: false, about: 'Twice the shared n-grams over the n-grams of both strings.' },
  { id: 'overlap', name: 'Overlap', family: 'ngram', distance: false, about: 'Shared n-grams over the n-grams of the shorter string.' },
];

export const ENCODERS: readonly EncoderInfo[] = [
  { id: 'soundex', name: 'Soundex', family: 'phonetic', about: 'A letter and three digits. The classic for surnames.' },
  { id: 'metaphone', name: 'Metaphone', family: 'phonetic', about: 'English pronunciation rules, one code.' },
  { id: 'doublemetaphone', name: 'Double Metaphone', family: 'phonetic', about: 'A primary and an alternate code, for names of many origins.' },
  { id: 'nysiis', name: 'NYSIIS', family: 'phonetic', about: 'New York State Identification and Intelligence System. Keeps more of the vowels.' },
];

export const ALGOS: readonly (MetricInfo | EncoderInfo)[] = [...METRICS, ...ENCODERS];

export const FAMILIES: Record<Family, string> = {
  edit: 'Edit distance',
  match: 'Character matching',
  ngram: 'N-grams',
  phonetic: 'Phonetic',
};

export const isMetric = (id: string): id is MetricId => METRICS.some((m) => m.id === id);
export const isEncoder = (id: string): id is EncoderId => ENCODERS.some((e) => e.id === id);
export const algo = (id: AlgoId) => ALGOS.find((a) => a.id === id)!;

/** Strings in a comparison, and in lists, at most (wasm/bridge.go enforces the same). */
export const MAX_COMPARE_RUNES = 500;
export const MAX_LIST_RUNES = 100;
export const MAX_LIST_LEN = 5000;

export type Request =
  | { op: 'compare'; a: string; b: string; options: Options }
  | { op: 'pairs'; pairs: [string, string][]; options: Options }
  | { op: 'rank'; query: string; candidates: string[]; metric: MetricId; topN: number; threshold: number; options: Options };

/** A float64 as the bridge encodes it: NaN and infinities become strings. */
export type Num = number | 'NaN' | '+Inf' | '-Inf';

export const toNumber = (n: Num): number => (typeof n === 'number' ? n : n === 'NaN' ? NaN : n === '+Inf' ? Infinity : -Infinity);

export interface Score {
  metric: MetricId;
  similarity: Num;
  distance?: number;
  /** What Distance or Similarity panicked with. */
  panic?: string;
}

export interface Code {
  encoder: EncoderId;
  a: string;
  b: string;
  altA?: string;
  altB?: string;
  match: boolean;
}

export interface Response {
  ok: boolean;
  error?: string;
  scores?: Score[];
  codes?: Code[];
  similarities?: Record<MetricId, Num[]>;
  matches?: Record<EncoderId, boolean[]>;
  panics?: Partial<Record<MetricId, string>>;
  ranked?: { index: number; similarity: Num }[];
}

export interface BuildInfo {
  strsim: string;
  go: string;
}
