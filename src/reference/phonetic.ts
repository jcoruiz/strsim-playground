// The four phonetic encoders, ported from strsim v0.2.0 with the rule behind
// every step recorded. test/reference.test.ts checks them against Apache
// Commons Codec (test/fixtures/phonetic_reference.tsv) and the WASM builds.

import { letters, type Letters } from './fold';

export interface PhoneticStep {
  /** Position in word where the rule starts, and how many letters it reads. */
  pos: number;
  len: number;
  rule: string;
  /** What the step added to the code; alt is Double Metaphone's alternate code. */
  out: string;
  alt?: string;
}

export interface PhoneticTrace {
  letters: Letters;
  /** The word the steps point into, after the rules in before. */
  word: string;
  /** Rules that rewrite the whole word before the letter-by-letter scan. */
  before: string[];
  steps: PhoneticStep[];
  /** Rules applied to the finished code. */
  after: string[];
  code: string;
  /** Double Metaphone's alternate code. */
  alt?: string;
}

const trace = (l: Letters): PhoneticTrace => ({ letters: l, word: l.text, before: [], steps: [], after: [], code: '' });

// ---------- Soundex ----------

const SOUNDEX = '01230120022455012623010202';
const SOUNDEX_GROUP: Record<string, string> = { '1': 'B F P V', '2': 'C G J K Q S X Z', '3': 'D T', '4': 'L', '5': 'M N', '6': 'R' };

export function soundex(s: string, maxLength: number): PhoneticTrace {
  const length = maxLength <= 0 ? 4 : maxLength;
  const t = trace(letters(s, false));
  const w = t.word;
  if (w === '') return t;

  const digit = (ch: string) => SOUNDEX[ch.charCodeAt(0) - 65];
  let code = w[0];
  let prev = digit(w[0]);
  t.steps.push({ pos: 0, len: 1, rule: 'First letter: kept as it is', out: w[0] });

  let i = 1;
  for (; i < w.length && code.length < length; i++) {
    const ch = w[i];
    const c = digit(ch);
    if (c === '0') {
      if (ch === 'H' || ch === 'W') {
        t.steps.push({ pos: i, len: 1, rule: 'H and W: not coded, and they do not separate equal digits', out: '' });
      } else {
        prev = '0';
        t.steps.push({ pos: i, len: 1, rule: 'Vowel or Y: not coded, but it separates equal digits', out: '' });
      }
      continue;
    }
    if (c !== prev) {
      code += c;
      prev = c;
      t.steps.push({ pos: i, len: 1, rule: `${SOUNDEX_GROUP[c]} → ${c}`, out: c });
    } else {
      t.steps.push({ pos: i, len: 1, rule: `Same digit (${c}) as the letter before: skipped`, out: '' });
    }
  }
  if (i < w.length) t.after.push(`Stopped at ${length} characters`);
  if (code.length < length) {
    t.after.push(`Padded with zeros to ${length} characters`);
    code = code.padEnd(length, '0');
  }
  t.code = code;
  return t;
}

// ---------- Metaphone ----------

const isVowel = (ch: string) => ch === 'A' || ch === 'E' || ch === 'I' || ch === 'O' || ch === 'U';
const isFrontVowel = (ch: string) => ch === 'E' || ch === 'I' || ch === 'Y';
const hasAt = (w: string, pos: number, ...subs: string[]) => pos >= 0 && subs.some((sub) => pos + sub.length <= w.length && w.startsWith(sub, pos));

export function metaphone(s: string, maxLength: number): PhoneticTrace {
  const maxLen = maxLength <= 0 ? 4 : maxLength;
  const t = trace(letters(s, false));
  let w = t.word;
  if (w.length <= 1) {
    if (w) t.steps.push({ pos: 0, len: 1, rule: 'A single letter is its own code', out: w });
    t.code = w;
    return t;
  }

  if ((w[1] === 'N' && 'GKP'.includes(w[0])) || (w[0] === 'A' && w[1] === 'E') || (w[0] === 'W' && w[1] === 'R')) {
    t.before.push(`Initial ${w.slice(0, 2)}: the ${w[0]} is silent`);
    w = w.slice(1);
  } else if (w[0] === 'W' && w[1] === 'H') {
    t.before.push('Initial WH → W');
    w = 'W' + w.slice(2);
  } else if (w[0] === 'X') {
    t.before.push('Initial X → S');
    w = 'S' + w.slice(1);
  }
  t.word = w;

  const n = w.length;
  const at = (k: number) => (k >= 0 && k < n ? w[k] : '');
  let code = '';
  let i = 0;
  for (; i < n && code.length < maxLen; i++) {
    const ch = w[i];
    const pos = i;
    if (ch !== 'C' && i > 0 && w[i - 1] === ch) {
      t.steps.push({ pos, len: 1, rule: 'Same letter twice: the second is skipped', out: '' });
      continue;
    }
    const prev = at(i - 1);
    const next = at(i + 1);
    let out = '';
    let rule = '';
    switch (ch) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
        if (i === 0) [out, rule] = [ch, 'Vowel at the start: kept'];
        else rule = 'Vowel after the start: dropped';
        break;
      case 'B':
        if (i < n - 1 || prev !== 'M') [out, rule] = ['B', 'B → B'];
        else rule = 'Final MB ("dumb"): the B is silent';
        break;
      case 'C':
        if (prev === 'S' && isFrontVowel(next)) rule = 'SCE, SCI, SCY: the C is silent';
        else if (hasAt(w, i, 'CIA')) [out, rule] = ['X', 'CIA → X'];
        else if (isFrontVowel(next)) [out, rule] = ['S', 'C before E, I or Y → S'];
        else if (prev === 'S' && next === 'H') [out, rule] = ['K', 'SCH → SK'];
        else if (next === 'H') [out, rule] = ['X', 'CH → X'];
        else [out, rule] = ['K', 'C → K'];
        break;
      case 'D':
        if (next === 'G' && isFrontVowel(at(i + 2))) {
          [out, rule] = ['J', 'DGE, DGI, DGY → J'];
          i += 2;
        } else [out, rule] = ['T', 'D → T'];
        break;
      case 'G':
        if (next === 'H' && !isVowel(at(i + 2))) rule = 'GH at the end or before a consonant: silent';
        else if (i > 0 && next === 'N') rule = 'GN: the G is silent';
        else if (isFrontVowel(next)) [out, rule] = ['J', 'G before E, I or Y → J'];
        else [out, rule] = ['K', 'G → K'];
        break;
      case 'H':
        if (isVowel(next) && !(prev !== '' && 'CSPTG'.includes(prev))) [out, rule] = ['H', 'H before a vowel: kept'];
        else rule = 'H not before a vowel, or after C, S, P, T or G: silent';
        break;
      case 'F':
      case 'J':
      case 'L':
      case 'M':
      case 'N':
      case 'R':
        [out, rule] = [ch, `${ch} → ${ch}`];
        break;
      case 'K':
        if (prev !== 'C') [out, rule] = ['K', 'K → K'];
        else rule = 'CK: the K is silent';
        break;
      case 'P':
        if (next === 'H') [out, rule] = ['F', 'PH → F'];
        else [out, rule] = ['P', 'P → P'];
        break;
      case 'Q':
        [out, rule] = ['K', 'Q → K'];
        break;
      case 'S':
        if (next === 'H' || hasAt(w, i, 'SIO', 'SIA')) [out, rule] = ['X', 'SH, SIO, SIA → X'];
        else [out, rule] = ['S', 'S → S'];
        break;
      case 'T':
        if (hasAt(w, i, 'TIA', 'TIO')) [out, rule] = ['X', 'TIA, TIO → X'];
        else if (hasAt(w, i, 'TCH')) rule = 'TCH: the T is silent';
        else if (next === 'H') [out, rule] = ['0', 'TH → 0 (the "th" sound)'];
        else [out, rule] = ['T', 'T → T'];
        break;
      case 'V':
        [out, rule] = ['F', 'V → F'];
        break;
      case 'W':
      case 'Y':
        if (isVowel(next)) [out, rule] = [ch, `${ch} before a vowel: kept`];
        else rule = `${ch} not before a vowel: silent`;
        break;
      case 'X':
        [out, rule] = ['KS', 'X → KS'];
        break;
      case 'Z':
        [out, rule] = ['S', 'Z → S'];
        break;
    }
    code += out;
    t.steps.push({ pos, len: i - pos + 1, rule, out });
  }
  if (i < n) t.after.push(`Stopped at ${maxLen} characters`);
  if (code.length > maxLen) {
    t.after.push(`Cut to ${maxLen} characters`);
    code = code.slice(0, maxLen);
  }
  t.code = code;
  return t;
}

// ---------- NYSIIS ----------

const PREFIXES: [string, string][] = [
  ['MAC', 'MCC'],
  ['KN', 'NN'],
  ['K', 'C'],
  ['PH', 'FF'],
  ['PF', 'FF'],
  ['SCH', 'SSS'],
];

export function nysiis(s: string, maxLength: number): PhoneticTrace {
  const maxLen = maxLength < 0 ? 6 : maxLength;
  const t = trace(letters(s, false));
  let w = t.word;
  if (w === '') return t;

  const prefix = PREFIXES.find(([p]) => w.startsWith(p));
  if (prefix) {
    t.before.push(`Initial ${prefix[0]} → ${prefix[1]}`);
    w = prefix[1] + w.slice(prefix[0].length);
  }
  if (w.endsWith('EE') || w.endsWith('IE')) {
    t.before.push(`Final ${w.slice(-2)} → Y`);
    w = w.slice(0, -2) + 'Y';
  } else if (['DT', 'RT', 'RD', 'NT', 'ND'].some((x) => w.endsWith(x))) {
    t.before.push(`Final ${w.slice(-2)} → D`);
    w = w.slice(0, -2) + 'D';
  }
  t.word = w;

  let key = w[0];
  t.steps.push({ pos: 0, len: 1, rule: 'First letter: kept as it is', out: w[0] });
  // Appends each letter unless it repeats the last one of the key.
  const append = (chars: string) => {
    let out = '';
    for (const ch of chars) {
      if (key[key.length - 1] !== ch) {
        key += ch;
        out += ch;
      }
    }
    return out;
  };
  const step = (pos: number, len: number, rule: string, chars: string) => {
    const out = append(chars);
    const repeated = out === '' && chars !== '' ? ', not repeated' : '';
    t.steps.push({ pos, len, rule: rule + repeated, out });
  };

  const n = w.length;
  let i = 1;
  while (i < n) {
    const ch = w[i];
    const next = i + 1 < n ? w[i + 1] : '';
    if (ch === 'E' && next === 'V') {
      step(i, 2, 'EV → AF', 'AF');
      i += 2;
      continue;
    }
    if (isVowel(ch)) {
      step(i, 1, 'Vowel → A', 'A');
      i++;
      continue;
    }
    switch (ch) {
      case 'Q':
        step(i, 1, 'Q → G', 'G');
        break;
      case 'Z':
        step(i, 1, 'Z → S', 'S');
        break;
      case 'M':
        step(i, 1, 'M → N', 'N');
        break;
      case 'K':
        if (next === 'N') step(i, 1, 'K before N → N', 'N');
        else step(i, 1, 'K → C', 'C');
        break;
      case 'S':
        if (next === 'C' && i + 2 < n && w[i + 2] === 'H') {
          step(i, 3, 'SCH → SSS', 'SSS');
          i += 3;
          continue;
        }
        step(i, 1, 'S → S', 'S');
        break;
      case 'P':
        if (next === 'H') {
          step(i, 2, 'PH → FF', 'FF');
          i += 2;
          continue;
        }
        step(i, 1, 'P → P', 'P');
        break;
      case 'H': {
        const last = key[key.length - 1];
        if (!isVowel(last) || !isVowel(next)) step(i, 1, 'H not between vowels: takes the letter before', last);
        else step(i, 1, 'H between vowels: kept', 'H');
        break;
      }
      case 'W': {
        const last = key[key.length - 1];
        if (isVowel(last)) step(i, 1, 'W after a vowel: takes the vowel', last);
        else step(i, 1, 'W → W', 'W');
        break;
      }
      default:
        step(i, 1, `${ch} → ${ch}`, ch);
    }
    i++;
  }

  let code = key;
  if (code.length > 1 && code.endsWith('S')) {
    t.after.push('Final S: removed');
    code = code.slice(0, -1);
  }
  if (code.length > 2 && code.endsWith('AY')) {
    t.after.push('Final AY → Y');
    code = code.slice(0, -2) + 'Y';
  }
  if (code.length > 1 && code.endsWith('A')) {
    t.after.push('Final A: removed');
    code = code.slice(0, -1);
  }
  if (maxLen > 0 && code.length > maxLen) {
    t.after.push(`Cut to ${maxLen} characters`);
    code = code.slice(0, maxLen);
  }
  t.code = code;
  return t;
}

// ---------- Double Metaphone ----------

const dmVowel = (ch: string) => isVowel(ch) || ch === 'Y';

/** Double Metaphone's Slavo-Germanic test: a W, a K or CZ anywhere. */
const slavoGermanic = (w: string) => /W|K|CZ/.test(w);

class DoubleMetaphone {
  pri = '';
  alt = '';
  rule = '';
  readonly slavo: boolean;

  constructor(
    readonly w: string,
    readonly max: number,
  ) {
    this.slavo = slavoGermanic(w);
  }

  at(i: number): string {
    return i >= 0 && i < this.w.length ? this.w[i] : '';
  }

  has(pos: number, ...subs: string[]): boolean {
    return hasAt(this.w, pos, ...subs);
  }

  add(p: string, a: string, rule: string): void {
    this.pri += p.slice(0, Math.max(this.max - this.pri.length, 0));
    this.alt += a.slice(0, Math.max(this.max - this.alt.length, 0));
    this.rule = rule;
  }

  both(s: string, rule: string): void {
    this.add(s, s, rule);
  }

  why(rule: string): void {
    this.rule = rule;
  }

  skip(i: number, ch: string): number {
    return this.at(i + 1) === ch ? i + 2 : i + 1;
  }

  encode(t: PhoneticTrace): void {
    let i = 0;
    if (this.has(0, 'GN', 'KN', 'PN', 'WR', 'PS')) {
      t.before.push(`Initial ${this.w.slice(0, 2)}: the ${this.w[0]} is silent`);
      i = 1;
    }
    while (i < this.w.length && (this.pri.length < this.max || this.alt.length < this.max)) {
      const p0 = this.pri.length;
      const a0 = this.alt.length;
      this.rule = '';
      const next = this.letter(i);
      t.steps.push({ pos: i, len: Math.min(next, this.w.length) - i, rule: this.rule, out: this.pri.slice(p0), alt: this.alt.slice(a0) });
      i = next;
    }
    if (i < this.w.length) t.after.push(`Stopped: both codes have ${this.max} characters`);
  }

  letter(i: number): number {
    const ch = this.w[i];
    switch (ch) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
      case 'Y':
        if (i === 0) this.both('A', 'Vowel at the start → A');
        else this.why('Vowel after the start: dropped');
        return i + 1;
      case 'B':
        this.both('P', this.at(i + 1) === 'B' ? 'BB → P' : 'B → P');
        return this.skip(i, 'B');
      case 'C':
        return this.c(i);
      case 'D':
        return this.d(i);
      case 'F':
      case 'K':
      case 'N':
        this.both(ch, this.at(i + 1) === ch ? `${ch}${ch} → ${ch}` : `${ch} → ${ch}`);
        return this.skip(i, ch);
      case 'G':
        return this.g(i);
      case 'H':
        return this.h(i);
      case 'J':
        return this.j(i);
      case 'L':
        return this.l(i);
      case 'M':
        if (this.at(i + 1) === 'M') {
          this.both('M', 'MM → M');
          return i + 2;
        }
        if (this.has(i - 1, 'UMB') && (i + 1 === this.w.length - 1 || this.has(i + 2, 'ER'))) {
          this.both('M', 'UMB at the end or before ER ("dumb", "thumber"): the B is silent');
          return i + 2;
        }
        this.both('M', 'M → M');
        return i + 1;
      case 'P':
        return this.p(i);
      case 'Q':
        this.both('K', this.at(i + 1) === 'Q' ? 'QQ → K' : 'Q → K');
        return this.skip(i, 'Q');
      case 'R':
        return this.r(i);
      case 'S':
        return this.s(i);
      case 'T':
        return this.t(i);
      case 'V':
        this.both('F', this.at(i + 1) === 'V' ? 'VV → F' : 'V → F');
        return this.skip(i, 'V');
      case 'W':
        return this.wch(i);
      case 'X':
        return this.x(i);
      case 'Z':
        return this.z(i);
    }
    this.why('Space between words: skipped');
    return i + 1;
  }

  isGermanicCH(i: number): boolean {
    if (this.has(i, 'CHIA')) return true;
    if (i <= 1 || dmVowel(this.at(i - 2)) || !this.has(i - 1, 'ACH')) return false;
    const c = this.at(i + 2);
    return (c !== 'I' && c !== 'E') || this.has(i - 2, 'BACHER', 'MACHER');
  }

  c(i: number): number {
    if (this.isGermanicCH(i)) {
      this.both('K', 'Germanic -ACH- or Italian CHIA: CH → K');
      return i + 2;
    }
    if (i === 0 && this.has(i, 'CAESAR')) {
      this.both('S', 'Initial CAESAR: C → S');
      return i + 2;
    }
    if (this.has(i, 'CH')) return this.ch(i);
    if (this.has(i, 'CZ') && !this.has(i - 2, 'WICZ')) {
      this.add('S', 'X', 'CZ → S, or X ("Czerny")');
      return i + 2;
    }
    if (this.has(i + 1, 'CIA')) {
      this.both('X', 'CCIA → X ("focaccia")');
      return i + 3;
    }
    if (this.has(i, 'CC') && (i !== 1 || this.at(0) !== 'M')) {
      if (this.has(i + 2, 'I', 'E', 'H') && !this.has(i + 2, 'HU')) {
        if ((i === 1 && this.at(0) === 'A') || this.has(i - 1, 'UCCEE', 'UCCES')) this.both('KS', 'CC before I or E → KS ("accident", "succeed")');
        else this.both('X', 'CC before I, E or H → X ("bacci", "bertucci")');
        return i + 3;
      }
      this.both('K', 'CC → K');
      return i + 2;
    }
    if (this.has(i, 'CK', 'CG', 'CQ')) {
      this.both('K', `${this.w.slice(i, i + 2)} → K`);
      return i + 2;
    }
    if (this.has(i, 'CI', 'CE', 'CY')) {
      if (this.has(i, 'CIO', 'CIE', 'CIA')) this.add('S', 'X', 'Italian CIO, CIE, CIA → S, or X');
      else this.both('S', 'C before I, E or Y → S');
      return i + 2;
    }
    if (this.has(i + 1, ' C', ' Q', ' G')) {
      this.both('K', 'C → K, and the C, Q or G of the next word is skipped ("Mac Gregor")');
      return i + 3;
    }
    if (this.has(i + 1, 'C', 'K', 'Q') && !this.has(i + 1, 'CE', 'CI')) {
      this.both('K', `C${this.at(i + 1)} → K`);
      return i + 2;
    }
    this.both('K', 'C → K');
    return i + 1;
  }

  ch(i: number): number {
    if (i > 0 && this.has(i, 'CHAE')) this.add('K', 'X', 'CHAE → K, or X ("Michael")');
    else if (
      i === 0 &&
      (this.has(i + 1, 'HARAC', 'HARIS') || this.has(i + 1, 'HOR', 'HYM', 'HIA', 'HEM')) &&
      !this.has(0, 'CHORE')
    )
      this.both('K', 'Initial CH of a Greek root → K ("chemistry", "chorus")');
    else if (
      this.has(0, 'VAN ', 'VON ', 'SCH') ||
      this.has(i - 2, 'ORCHES', 'ARCHIT', 'ORCHID') ||
      this.has(i + 2, 'T', 'S') ||
      ((i === 0 || this.has(i - 1, 'A', 'O', 'U', 'E')) &&
        (this.has(i + 2, 'L', 'R', 'N', 'M', 'B', 'H', 'F', 'V', 'W', ' ') || i + 1 === this.w.length - 1))
    )
      this.both('K', 'Germanic or Greek CH → K');
    else if (i > 0 && this.has(0, 'MC')) this.both('K', 'CH in a MC name → K ("McHugh")');
    else if (i > 0) this.add('X', 'K', 'CH → X, or K');
    else this.both('X', 'CH → X');
    return i + 2;
  }

  d(i: number): number {
    if (this.has(i, 'DG')) {
      if (this.has(i + 2, 'I', 'E', 'Y')) {
        this.both('J', 'DGE, DGI, DGY → J ("edge")');
        return i + 3;
      }
      this.both('TK', 'DG → TK ("Edgar")');
      return i + 2;
    }
    if (this.has(i, 'DT', 'DD')) {
      this.both('T', `${this.w.slice(i, i + 2)} → T`);
      return i + 2;
    }
    this.both('T', 'D → T');
    return i + 1;
  }

  g(i: number): number {
    const next = this.at(i + 1);
    if (next === 'H') return this.gh(i);
    if (next === 'N') {
      if (i === 1 && dmVowel(this.at(0)) && !this.slavo) this.add('KN', 'N', 'GN after an initial vowel → KN, or N');
      else if (!this.has(i + 2, 'EY') && !this.slavo) this.add('N', 'KN', 'GN → N, or KN');
      else this.both('KN', 'GN → KN');
      return i + 2;
    }
    if (this.has(i + 1, 'LI') && !this.slavo) {
      this.add('KL', 'L', 'GLI → KL, or L ("tagliaro")');
      return i + 2;
    }
    if (i === 0 && (next === 'Y' || this.has(i + 1, 'ES', 'EP', 'EB', 'EL', 'EY', 'IB', 'IL', 'IN', 'IE', 'EI', 'ER'))) {
      this.add('K', 'J', 'Initial GE-, GI-, GY- → K, or J');
      return i + 2;
    }
    if (
      (this.has(i + 1, 'ER') || next === 'Y') &&
      !this.has(0, 'DANGER', 'RANGER', 'MANGER') &&
      !this.has(i - 1, 'E', 'I') &&
      !this.has(i - 1, 'RGY', 'OGY')
    ) {
      this.add('K', 'J', 'GER, GY → K, or J');
      return i + 2;
    }
    if (this.has(i + 1, 'E', 'I', 'Y') || this.has(i - 1, 'AGGI', 'OGGI')) {
      if (this.has(0, 'VAN ', 'VON ', 'SCH') || this.has(i + 1, 'ET')) this.both('K', 'Germanic G before E or I → K');
      else if (this.has(i + 1, 'IER')) this.both('J', 'GIER → J');
      else this.add('J', 'K', 'G before E, I or Y → J, or K ("biaggi")');
      return i + 2;
    }
    this.both('K', this.at(i + 1) === 'G' ? 'GG → K' : 'G → K');
    return this.skip(i, 'G');
  }

  gh(i: number): number {
    if (i > 0 && !dmVowel(this.at(i - 1))) this.both('K', 'GH after a consonant → K');
    else if (i === 0) {
      if (this.at(i + 2) === 'I') this.both('J', 'Initial GHI → J ("Ghislane")');
      else this.both('K', 'Initial GH → K ("ghost")');
    } else if ((i > 1 && this.has(i - 2, 'B', 'H', 'D')) || (i > 2 && this.has(i - 3, 'B', 'H', 'D')) || (i > 3 && this.has(i - 4, 'B', 'H')))
      this.why('GH after B, H or D: silent ("Hugh", "bough", "Broughton")');
    else if (i > 2 && this.at(i - 1) === 'U' && this.has(i - 3, 'C', 'G', 'L', 'R', 'T')) this.both('F', 'UGH after C, G, L, R or T → F ("laugh", "tough")');
    else if (this.at(i - 1) !== 'I') this.both('K', 'GH → K');
    else this.why('IGH: silent');
    return i + 2;
  }

  h(i: number): number {
    if ((i === 0 || dmVowel(this.at(i - 1))) && dmVowel(this.at(i + 1))) {
      this.both('H', 'H at the start or between vowels: kept');
      return i + 2;
    }
    this.why('H not before a vowel, or after a consonant: silent');
    return i + 1;
  }

  j(i: number): number {
    if (this.has(i, 'JOSE') || this.has(0, 'SAN ')) {
      if ((i === 0 && this.at(i + 4) === ' ') || this.w.length === 4 || this.has(0, 'SAN ')) this.both('H', 'Spanish J ("Jose", "San Jacinto") → H');
      else this.add('J', 'H', 'Spanish JOSE → J, or H');
      return i + 1;
    }
    if (i === 0) this.add('J', 'A', 'Initial J → J, or A ("Jankelowicz" / "Yankelovich")');
    else if (dmVowel(this.at(i - 1)) && !this.slavo && (this.at(i + 1) === 'A' || this.at(i + 1) === 'O')) this.add('J', 'H', 'J between vowels → J, or H (Spanish "bajador")');
    else if (i === this.w.length - 1) this.add('J', '', 'Final J → J, or nothing');
    else if (!this.has(i + 1, 'L', 'T', 'K', 'S', 'N', 'M', 'B', 'Z') && !this.has(i - 1, 'S', 'K', 'L')) this.both('J', 'J → J');
    else this.why('J next to L, T, K, S, N, M, B or Z: silent');
    return this.skip(i, 'J');
  }

  l(i: number): number {
    if (this.at(i + 1) !== 'L') {
      this.both('L', 'L → L');
      return i + 1;
    }
    const n = this.w.length;
    if ((i === n - 3 && this.has(i - 1, 'ILLO', 'ILLA', 'ALLE')) || ((this.has(n - 2, 'AS', 'OS') || this.has(n - 1, 'A', 'O')) && this.has(i - 1, 'ALLE')))
      this.add('L', '', 'Spanish LL → L, or nothing ("Cabrillo", "Gallegos")');
    else this.both('L', 'LL → L');
    return i + 2;
  }

  p(i: number): number {
    if (this.at(i + 1) === 'H') {
      this.both('F', 'PH → F');
      return i + 2;
    }
    if (this.has(i + 1, 'P', 'B')) {
      this.both('P', `P${this.at(i + 1)} → P ("Campbell")`);
      return i + 2;
    }
    this.both('P', 'P → P');
    return i + 1;
  }

  r(i: number): number {
    if (i === this.w.length - 1 && !this.slavo && this.has(i - 2, 'IE') && !this.has(i - 4, 'ME', 'MA')) this.add('', 'R', 'French final -IER: R silent in the primary code ("Rogier")');
    else this.both('R', this.at(i + 1) === 'R' ? 'RR → R' : 'R → R');
    return this.skip(i, 'R');
  }

  s(i: number): number {
    if (this.has(i - 1, 'ISL', 'YSL')) {
      this.why('ISL, YSL: the S is silent ("island", "Carlysle")');
      return i + 1;
    }
    if (i === 0 && this.has(i, 'SUGAR')) {
      this.add('X', 'S', 'Initial SUGAR → X, or S');
      return i + 1;
    }
    if (this.has(i, 'SH')) {
      if (this.has(i + 1, 'HEIM', 'HOEK', 'HOLM', 'HOLZ')) this.both('S', 'Germanic SHEIM, SHOEK, SHOLM, SHOLZ → S');
      else this.both('X', 'SH → X');
      return i + 2;
    }
    if (this.has(i, 'SIO', 'SIA', 'SIAN')) {
      if (this.slavo) this.both('S', 'SIO, SIA in a Slavo-Germanic name → S');
      else this.add('S', 'X', 'Italian and Armenian SIO, SIA → S, or X');
      return i + 3;
    }
    if ((i === 0 && this.has(i + 1, 'M', 'N', 'L', 'W')) || this.has(i + 1, 'Z')) {
      this.add('S', 'X', this.has(i + 1, 'Z') ? 'SZ → S, or X (Slavic)' : 'Initial SM, SN, SL, SW → S, or X ("Smith" and "Schmidt")');
      return this.skip(i, 'Z');
    }
    if (this.has(i, 'SC')) return this.sc(i);
    if (i === this.w.length - 1 && this.has(i - 2, 'AI', 'OI')) this.add('', 'S', 'French final -AIS, -OIS: S silent in the primary code');
    else this.both('S', this.has(i + 1, 'S', 'Z') ? `S${this.at(i + 1)} → S` : 'S → S');
    return this.has(i + 1, 'S', 'Z') ? i + 2 : i + 1;
  }

  sc(i: number): number {
    if (this.at(i + 2) === 'H') {
      if (this.has(i + 3, 'ER', 'EN')) this.add('X', 'SK', 'SCHER, SCHEN → X, or SK ("Schenker")');
      else if (this.has(i + 3, 'OO', 'UY', 'ED', 'EM')) this.both('SK', 'Dutch SCHOO, SCHUY, SCHED, SCHEM → SK ("school")');
      else if (i === 0 && !dmVowel(this.at(3)) && this.at(3) !== 'W') this.add('X', 'S', 'Initial SCH before a consonant → X, or S');
      else this.both('X', 'SCH → X');
    } else if (this.has(i + 2, 'I', 'E', 'Y')) this.both('S', 'SCI, SCE, SCY → S');
    else this.both('SK', 'SC → SK');
    return i + 3;
  }

  t(i: number): number {
    if (this.has(i, 'TION', 'TIA', 'TCH')) {
      this.both('X', `${this.w.slice(i, i + 3)} → X`);
      return i + 3;
    }
    if (this.has(i, 'TH', 'TTH')) {
      if (this.has(i + 2, 'OM', 'AM') || this.has(0, 'VAN ', 'VON ', 'SCH')) this.both('T', 'TH → T ("Thomas", "Thames", Germanic)');
      else this.add('0', 'T', 'TH → 0 (the "th" sound), or T');
      return i + 2;
    }
    if (this.has(i + 1, 'T', 'D')) {
      this.both('T', `T${this.at(i + 1)} → T`);
      return i + 2;
    }
    this.both('T', 'T → T');
    return i + 1;
  }

  wch(i: number): number {
    if (this.has(i, 'WR')) {
      this.both('R', 'WR → R');
      return i + 2;
    }
    if (i === 0 && dmVowel(this.at(i + 1))) this.add('A', 'F', 'Initial W before a vowel → A, or F ("Wasserman" and "Vasserman")');
    else if (i === 0 && this.at(i + 1) === 'H') this.both('A', 'Initial WH → A');
    else if ((i === this.w.length - 1 && dmVowel(this.at(i - 1))) || this.has(i - 1, 'EWSKI', 'EWSKY', 'OWSKI', 'OWSKY') || this.has(0, 'SCH'))
      this.add('', 'F', 'Final W after a vowel, or Polish -OWSKI: silent, or F ("Arnow" and "Arnoff")');
    else if (this.has(i, 'WICZ', 'WITZ')) {
      this.add('TS', 'FX', `Polish ${this.w.slice(i, i + 4)} → TS, or FX ("Filipowicz")`);
      return i + 4;
    } else this.why('W: silent');
    return i + 1;
  }

  x(i: number): number {
    if (i === 0) {
      this.both('S', 'Initial X → S');
      return i + 1;
    }
    if (i === this.w.length - 1 && (this.has(i - 3, 'IAU', 'EAU') || this.has(i - 2, 'AU', 'OU'))) this.why('French final -AUX, -OUX: silent ("Breaux")');
    else this.both('KS', 'X → KS');
    return this.has(i + 1, 'C', 'X') ? i + 2 : i + 1;
  }

  z(i: number): number {
    if (this.at(i + 1) === 'H') {
      this.both('J', 'ZH → J (Chinese "Zhao")');
      return i + 2;
    }
    if (this.has(i + 1, 'ZO', 'ZI', 'ZA') || (this.slavo && i > 0 && this.at(i - 1) !== 'T')) this.add('S', 'TS', 'Z → S, or TS');
    else this.both('S', this.at(i + 1) === 'Z' ? 'ZZ → S' : 'Z → S');
    return this.skip(i, 'Z');
  }
}

export function doubleMetaphone(s: string, maxLength: number): PhoneticTrace {
  const maxLen = maxLength <= 0 ? 4 : maxLength;
  const t = trace(letters(s, true));
  t.alt = '';
  if (t.word === '') return t;
  const dm = new DoubleMetaphone(t.word, maxLen);
  if (dm.slavo) t.before.push('Slavo-Germanic (has W, K or CZ): some rules change');
  dm.encode(t);
  t.code = dm.pri;
  t.alt = dm.alt;
  return t;
}

/** DoubleMetaphoneEncoder.Match: the strings share a code, or neither has letters. */
export function doubleMetaphoneMatch(a: PhoneticTrace, b: PhoneticTrace): boolean {
  const emptyA = a.code === '' && a.alt === '';
  const emptyB = b.code === '' && b.alt === '';
  if (emptyA || emptyB) return emptyA && emptyB;
  return a.code === b.code || a.code === b.alt || a.alt === b.code || a.alt === b.alt;
}
