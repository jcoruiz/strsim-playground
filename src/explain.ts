// "Why": how each algorithm reaches its value for the pair on screen, drawn
// from the traces of the TypeScript re-implementation.

import type { EditTrace, LcsTrace, Op, OpKind } from './reference/edit';
import type { EncoderExplanation, MetricExplanation } from './reference';
import type { JaroTrace } from './reference/jaro';
import type { NgramTrace } from './reference/ngram';
import type { PhoneticTrace } from './reference/phonetic';
import { int, plural, quoted, score, vis } from './format';
import { html, raw, type Html } from './html';
import { algo, type EncoderId, type MetricId } from './types';

const MAX_MATRIX = 30;

const SYMBOL: Record<OpKind, string> = { match: '=', sub: '~', ins: '+', del: '−', swap: '⇄' };
const NOUN: Record<Exclude<OpKind, 'match'>, string> = { sub: 'substitution', ins: 'insertion', del: 'deletion', swap: 'transposition' };

function alignment(ops: Op[]): Html {
  const cols = ops.map(
    (op) => html`<div class="col ${op.kind}" title="${op.kind === 'match' ? 'same' : NOUN[op.kind]}${op.cost ? ` (cost ${op.cost})` : ''}">
      <span>${op.a ? vis(op.a) : '–'}</span><i>${SYMBOL[op.kind]}</i><span>${op.b ? vis(op.b) : '–'}</span>
    </div>`,
  );
  return html`<div class="align-wrap"><div class="align">${cols}</div></div>
    <p class="legend-line"><span class="k match">= same</span><span class="k sub">~ substitute</span><span class="k ins">+ insert</span><span class="k del">− delete</span><span class="k swap">⇄ transpose</span></p>`;
}

/** A transposition that also inserts or deletes between the swapped characters (Damerau-Levenshtein). */
function gapSwap(op: Op): string {
  const del = [...op.a].length - 2;
  const ins = [...op.b].length - 2;
  const between = [del > 0 ? plural(del, 'deletion') : '', ins > 0 ? plural(ins, 'insertion') : ''].filter(Boolean).join(' and ');
  return `${vis(op.a)} → ${vis(op.b)}: a transposition with ${between} between the swapped characters (cost ${op.cost})`;
}

function editSummary(ops: Op[]): string {
  const counts = new Map<Exclude<OpKind, 'match'>, { n: number; cost: number }>();
  const gaps = ops.filter((op) => op.kind === 'swap' && op.cost > 1);
  if (gaps.length) {
    const rest = editSummary(ops.filter((op) => !gaps.includes(op)));
    return gaps.map(gapSwap).join('; ') + (rest.startsWith('No edits') ? '.' : `; ${rest}`);
  }
  for (const op of ops) {
    if (op.kind === 'match') continue;
    const c = counts.get(op.kind) ?? { n: 0, cost: 0 };
    c.n++;
    c.cost += op.cost;
    counts.set(op.kind, c);
  }
  if (!counts.size) return 'No edits: the strings are equal.';
  return (
    [...counts]
      .map(([kind, c]) => {
        const each = c.cost === c.n ? '' : c.cost === 0 ? ', free' : ` costing ${int(c.cost)}`;
        return plural(c.n, NOUN[kind]) + each;
      })
      .join(', ') + '.'
  );
}

function matrix(t: { a: string[]; b: string[]; matrix: number[][]; path: [number, number][] }, caption: string): Html {
  if (t.a.length > MAX_MATRIX || t.b.length > MAX_MATRIX) return html`<p class="hint">The matrix is drawn for strings up to ${MAX_MATRIX} characters.</p>`;
  const onPath = new Set(t.path.map(([i, j]) => `${i},${j}`));
  const head = html`<tr><th></th><th class="eps">ε</th>${t.b.map((c) => html`<th>${vis(c)}</th>`)}</tr>`;
  const rows = t.matrix.map(
    (row, i) => html`<tr><th class="${i ? '' : 'eps'}">${i ? vis(t.a[i - 1]) : 'ε'}</th>${row.map(
      (v, j) => html`<td class="${onPath.has(`${i},${j}`) ? 'on' : ''}">${v}</td>`,
    )}</tr>`,
  );
  return html`<figure class="matrix-wrap"><table class="matrix">${head}${rows}</table><figcaption>${caption}</figcaption></figure>`;
}

function editWhy(id: MetricId, x: MetricExplanation): Html {
  if (x.trace.kind !== 'edit') return html``;
  const t: EditTrace = x.trace.trace;
  const { ins, del, rep } = x.trace.costs;
  const maxCost = Math.max(ins, del, rep);
  const longer = Math.max(t.a.length, t.b.length);
  const formula =
    longer === 0
      ? html`Both strings are empty: similarity 1.`
      : id === 'levenshtein'
        ? html`similarity = 1 − distance ÷ (longer length × largest cost) = 1 − ${t.distance} ÷ (${longer} × ${maxCost}) = <b>${score(t.similarity)}</b>`
        : html`similarity = 1 − distance ÷ longer length = 1 − ${t.distance} ÷ ${longer} = <b>${score(t.similarity)}</b>`;
  const costs =
    id === 'levenshtein' && (ins !== 1 || del !== 1 || rep !== 1)
      ? html`<p>Costs: insert ${ins}, delete ${del}, substitute ${rep}.</p>`
      : html``;
  const swapNote =
    id === 'damerau' && t.ops.some((o) => o.kind === 'swap' && o.cost > 1)
      ? html`<p class="hint">Damerau-Levenshtein can insert or delete characters between the two it swaps; OSA cannot, which is why it may give a larger distance.</p>`
      : id === 'osa'
        ? html`<p class="hint">OSA swaps adjacent characters but never edits a substring twice, so "ca" → "abc" costs 3 here and 2 with Damerau-Levenshtein.</p>`
        : html``;
  return html`
    <p class="lead">Distance <b>${t.distance}</b>: ${editSummary(t.ops)}</p>
    ${costs}
    ${alignment(t.ops)}
    <p class="formula">${formula}</p>
    ${swapNote}
    ${matrix(t, 'Each cell is the distance between the first i characters of A (rows) and the first j of B (columns). The highlighted cells are one cheapest path.')}`;
}

function lcsWhy(x: MetricExplanation): Html {
  if (x.trace.kind !== 'lcs') return html``;
  const t: LcsTrace = x.trace.trace;
  const longer = Math.max(t.a.length, t.b.length);
  const common = t.ops.filter((o) => o.kind === 'match').map((o) => o.a);
  return html`
    <p class="lead">Longest common subsequence: ${quoted(common.join(''))}, ${plural(t.length, 'character')} that appear in both strings in the same order.</p>
    ${alignment(t.ops)}
    <p class="formula">${longer === 0 ? 'Both strings are empty: similarity 1.' : html`similarity = LCS ÷ longer length = ${t.length} ÷ ${longer} = <b>${score(t.similarity)}</b>`}</p>
    <p class="formula">distance = |A| + |B| − 2 × LCS = ${t.a.length} + ${t.b.length} − 2 × ${t.length} = <b>${t.distance}</b></p>
    ${matrix(t, 'Each cell is the LCS length of the first i characters of A and the first j of B. The highlighted cells trace one longest subsequence.')}`;
}

function hammingWhy(x: MetricExplanation): Html {
  if (x.trace.kind !== 'hamming') return html``;
  const t = x.trace.trace;
  if (!t.sameLength) {
    return html`<p class="lead">A has ${plural(t.a.length, 'character')} and B ${plural(t.b.length, 'character')}.</p>
      <p>Hamming distance only compares strings of the same length. <code>HammingSimilarity</code> returns 0, <code>Hamming</code> returns <code>ErrLengthMismatch</code> (an error in v0.1.0 too) and <code>HammingMetric.Distance</code> panics with it.</p>
      <p class="hint">For strings of different lengths, Levenshtein counts the same substitutions plus the insertions or deletions.</p>`;
  }
  const cols = t.a.map((c, i) => html`<div class="col ${t.differ[i] ? 'sub' : 'match'}"><span>${vis(c)}</span><i>${t.differ[i] ? '~' : '='}</i><span>${vis(t.b[i])}</span></div>`);
  return html`
    <p class="lead">${plural(t.distance ?? 0, 'position')} of ${t.a.length} differ.</p>
    <div class="align-wrap"><div class="align">${cols}</div></div>
    <p class="formula">${t.a.length === 0 ? 'Both strings are empty: similarity 1.' : html`similarity = 1 − differing ÷ length = 1 − ${t.distance} ÷ ${t.a.length} = <b>${score(t.similarity)}</b>`}</p>`;
}

function jaroPicture(t: JaroTrace): Html {
  const w = 30;
  const n = Math.max(t.a.length, t.b.length, 1);
  const width = n * w;
  const height = 120;
  const outOfOrder = new Set<number>();
  t.orderA.forEach((i, k) => {
    if (t.a[i] !== t.b[t.orderB[k]]) outOfOrder.add(i);
  });
  const cx = (i: number) => i * w + w / 2;
  const lines = t.matchOf.map((j, i) =>
    j < 0 ? '' : `<line x1="${cx(i)}" y1="34" x2="${cx(j)}" y2="86" class="${outOfOrder.has(i) ? 'swap' : 'match'}"/>`,
  );
  const chars = (s: string[], y: number, matched: (i: number) => boolean) =>
    s.map((c, i) => `<text x="${cx(i)}" y="${y}" class="${matched(i) ? 'on' : 'off'}">${vis(c).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!)}</text>`);
  return raw(
    `<svg class="jaro" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Matched characters">` +
      `<text x="0" y="12" class="lbl">A</text><text x="0" y="118" class="lbl">B</text>` +
      lines.join('') +
      chars(t.a, 28, (i) => t.matchOf[i] >= 0).join('') +
      chars(t.b, 102, (j) => t.matched[j]).join('') +
      `</svg>`,
  );
}

function jaroBody(t: JaroTrace): Html {
  if (t.a.length === 0 || t.b.length === 0) {
    return html`<p class="lead">${t.a.length === t.b.length ? 'Both strings are empty: similarity 1.' : 'One string is empty: similarity 0.'}</p>`;
  }
  const longer = Math.max(t.a.length, t.b.length);
  const seqA = t.orderA.map((i) => t.a[i]);
  const seqB = t.orderB.map((j) => t.b[j]);
  const seq = html`<div class="align-wrap"><div class="align">${seqA.map(
    (c, k) => html`<div class="col ${c === seqB[k] ? 'match' : 'swap'}"><span>${vis(c)}</span><i>${c === seqB[k] ? '=' : '≠'}</i><span>${vis(seqB[k])}</span></div>`,
  )}</div></div>`;
  const m = t.matches;
  return html`
    <p class="lead">${plural(m, 'character')} match: equal characters at most <b>${t.window}</b> positions apart (⌊max(${t.a.length}, ${t.b.length}) ÷ 2⌋ − 1 = ${t.window}).</p>
    <div class="svg-wrap">${jaroPicture(t)}</div>
    ${
      m === 0
        ? html`<p class="formula">No characters match: similarity 0.</p>`
        : html`<p>The matched characters, in the order each string has them. ${plural(t.halfTranspositions, 'position')} differ, so the transpositions are t = ⌊${t.halfTranspositions} ÷ 2⌋ = <b>${t.transpositions}</b>.</p>
          ${seq}
          <p class="formula">Jaro = (m ÷ |A| + m ÷ |B| + (m − t) ÷ m) ÷ 3 = (${m} ÷ ${t.a.length} + ${m} ÷ ${t.b.length} + ${m - t.transpositions} ÷ ${m}) ÷ 3 = <b>${score(t.similarity)}</b></p>
          ${longer > 3 && t.halfTranspositions % 2 === 1 ? html`<p class="hint">An odd count is halved rounding down, as Winkler's strcmp95, rapidfuzz and jellyfish do; strsim v0.1.0 kept the half.</p>` : html``}`
    }`;
}

function jaroWinklerWhy(x: MetricExplanation): Html {
  if (x.trace.kind !== 'jarowinkler') return html``;
  const t = x.trace.trace;
  const j = t.jaro.similarity;
  const prefix = t.jaro.a.slice(0, t.prefix).join('');
  const boost = t.boosted
    ? html`<p>Jaro ${score(j)} reaches the boost threshold ${t.threshold}, so the common prefix counts: ${quoted(prefix)}, ${plural(t.prefix, 'character')} (at most ${t.prefixSize}).</p>
        <p class="formula">Jaro-Winkler = Jaro + ℓ × 0.1 × (1 − Jaro) = ${score(j)} + ${t.prefix} × 0.1 × (1 − ${score(j)}) = <b>${score(t.similarity)}</b></p>
        ${t.prefix * 0.1 > 1 ? html`<p class="hint">ℓ × 0.1 is capped at 1, so the result stays within [0, 1].</p>` : html``}`
    : html`<p class="formula">Jaro ${score(j)} is below the boost threshold ${t.threshold}: no prefix bonus, Jaro-Winkler = <b>${score(t.similarity)}</b>.</p>`;
  return html`${jaroBody(t.jaro)}<h3>Prefix bonus</h3>${boost}`;
}

function chips(grams: Map<string, number>, shared: Set<string>): Html {
  return html`<div class="chips">${[...grams].map(
    ([g, c]) => html`<span class="chip ${shared.has(g) ? 'shared' : ''}">${vis(g)}${c > 1 ? html`<sub>×${c}</sub>` : ''}</span>`,
  )}</div>`;
}

function ngramWhy(id: MetricId, x: MetricExplanation): Html {
  if (x.trace.kind !== 'ngram') return html``;
  const t: NgramTrace = x.trace.trace;
  if (t.empty) return html`<p class="lead">One of the strings is empty: every n-gram similarity is 1 if both are, 0 otherwise.</p>`;
  const shared = new Set(t.shared);
  const s = t.shared.length;
  const na = t.gramsA.size;
  const nb = t.gramsB.size;
  const formulas: Record<string, Html> = {
    cosine: html`Cosine = Σ countA × countB ÷ (‖A‖ × ‖B‖) = ${t.dot} ÷ (√${t.normA} × √${t.normB}) = <b>${score(t.cosine)}</b>`,
    jaccard: html`Jaccard = shared ÷ (|A| + |B| − shared) = ${s} ÷ (${na} + ${nb} − ${s}) = <b>${score(t.jaccard)}</b>`,
    dice: html`Dice = 2 × shared ÷ (|A| + |B|) = 2 × ${s} ÷ (${na} + ${nb}) = <b>${score(t.dice)}</b>`,
    overlap: html`Overlap = shared ÷ min(|A|, |B|) = ${s} ÷ min(${na}, ${nb}) = <b>${score(t.overlap)}</b>`,
  };
  const short = (g: Map<string, number>) => g.size === 1 && [...g.values()][0] === 1 && [...g.keys()][0].length <= t.size;
  return html`
    <p class="lead">${plural(s, 'distinct n-gram')} of size ${t.size} ${s === 1 ? 'appears' : 'appear'} in both strings.</p>
    <div class="grams"><h4>A · ${plural(na, 'distinct n-gram')}</h4>${chips(t.gramsA, shared)}<h4>B · ${plural(nb, 'distinct n-gram')}</h4>${chips(t.gramsB, shared)}</div>
    ${short(t.gramsA) || short(t.gramsB) ? html`<p class="hint">A string with no more than ${t.size} characters is a single n-gram: itself.</p>` : html``}
    <p class="formula">${formulas[id]}</p>
    <p class="hint">${id === 'cosine' ? 'Cosine counts repeats (×2); Jaccard, Dice and Overlap only look at which n-grams appear.' : 'Jaccard, Dice and Overlap only look at which n-grams appear; Cosine also counts repeats.'} <code>NgramMetric.Similarity</code> is Dice.</p>
    <details class="others"><summary>The other n-gram scores</summary>${Object.entries(formulas)
      .filter(([k]) => k !== id)
      .map(([, f]) => html`<p class="formula">${f}</p>`)}</details>`;
}

function phoneticSide(label: string, raw0: string, t: PhoneticTrace, dual: boolean): Html {
  const changes = t.letters.changes.filter((c) => c.to !== '' || c.from.trim() !== '');
  const word = t.word;
  const part = (s: string) => s.replace(/ /g, '␣');
  const slice = (pos: number, len: number) =>
    html`<code class="word">${part(word.slice(0, pos))}<mark>${part(word.slice(pos, pos + len))}</mark>${part(word.slice(pos + len))}</code>`;
  const rows = t.steps.map(
    (s) => html`<tr class="${s.out || s.alt ? '' : 'silent'}"><td>${slice(s.pos, s.len)}</td><td>${s.rule}</td><td class="out">${s.out || '·'}</td>${dual ? html`<td class="out">${s.alt || '·'}</td>` : ''}</tr>`,
  );
  return html`<section class="side">
    <h4 class="side-title">${label} ${quoted(raw0)}</h4>
    <p>Letters read: <code class="word">${t.letters.text ? vis(t.letters.text) : '(none)'}</code>${
      changes.length ? html` <span class="hint">(${changes.map((c) => `${c.from} → ${c.to || 'dropped'}`).join(', ')})</span>` : ''
    }</p>
    ${t.before.length ? html`<ul class="rules">${t.before.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
    ${t.before.length && word !== t.letters.text ? html`<p>Word scanned: <code class="word">${vis(word)}</code></p>` : ''}
    ${
      t.steps.length
        ? html`<div class="table-wrap"><table class="steps"><thead><tr><th>Letters</th><th>Rule</th><th>${dual ? 'Primary' : 'Adds'}</th>${dual ? html`<th>Alternate</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div>`
        : html`<p class="hint">No letters: the code is empty.</p>`
    }
    ${t.after.length ? html`<ul class="rules">${t.after.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
    <p class="code-line">Code <b class="code">${t.code || '""'}</b>${dual ? html` · alternate <b class="code">${t.alt || '""'}</b>` : ''}</p>
  </section>`;
}

function phoneticWhy(id: EncoderId, a: string, b: string, x: EncoderExplanation): Html {
  const dual = id === 'doublemetaphone';
  let verdict: Html;
  if (dual) {
    const codesA = [x.a.code, x.a.alt ?? ''];
    const codesB = [x.b.code, x.b.alt ?? ''];
    const common = codesA.filter((c) => c !== '' && codesB.includes(c));
    verdict = x.match
      ? common.length
        ? html`They share ${quoted(common[0])}: <b>match</b>. Double Metaphone matches when any code of A equals any code of B.`
        : html`Neither has letters: <b>match</b>.`
      : html`No code in common: <b>no match</b>.`;
  } else {
    verdict = x.match ? html`Both encode to ${quoted(x.a.code)}: <b>match</b>.` : html`${quoted(x.a.code)} and ${quoted(x.b.code)} differ: <b>no match</b>.`;
  }
  return html`<p class="lead">${verdict}</p><div class="sides">${phoneticSide('A', a, x.a, dual)}${phoneticSide('B', b, x.b, dual)}</div>`;
}

export function whyMetric(id: MetricId, x: MetricExplanation): Html {
  switch (x.trace.kind) {
    case 'edit':
      return editWhy(id, x);
    case 'lcs':
      return lcsWhy(x);
    case 'hamming':
      return hammingWhy(x);
    case 'jaro':
      return jaroBody(x.trace.trace);
    case 'jarowinkler':
      return jaroWinklerWhy(x);
    case 'ngram':
      return ngramWhy(id, x);
  }
}

export function whyEncoder(id: EncoderId, a: string, b: string, x: EncoderExplanation): Html {
  return phoneticWhy(id, a, b, x);
}

export const heading = (id: MetricId | EncoderId): Html => {
  const info = algo(id);
  return html`<header class="why-head"><h3>${info.name}</h3><p class="about">${info.about}</p></header>`;
};

