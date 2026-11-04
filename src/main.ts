import './style.css';
import { bestThreshold, confusion, parsePairs, predict, type Best, type Confusion, type LabeledPair, type ParseError } from './calibrate';
import { calibrateProgram, compareProgram, searchProgram } from './codegen';
import { engine, run } from './engine';
import { heading, whyEncoder, whyMetric } from './explain';
import { bar, exact, int, plural, quoted, score } from './format';
import { highlightGo } from './highlight';
import { html, mount, raw, type Html } from './html';
import { DATASETS, LISTS, PAIRS } from './presets';
import { explainEncoder, explainMetric, same } from './reference';
import { VIEWS, decode, encode, sanitizeOptions, type Snapshot, type View } from './share';
import {
  DEFAULT_OPTIONS,
  ENCODERS,
  FAMILIES,
  MAX_COMPARE_RUNES,
  MAX_LIST_LEN,
  MAX_LIST_RUNES,
  METRICS,
  algo,
  isMetric,
  toNumber,
  type AlgoId,
  type Family,
  type MetricId,
  type Options,
  type Response,
} from './types';
import { CHANGELOG, LATEST, RELEASES } from './versions';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const runes = (s: string) => [...s];
const clip = (s: string, n: number) => (runes(s).length > n ? runes(s).slice(0, n).join('') : s);

type CompareTab = 'why' | 'versions' | 'code';
type SearchTab = 'results' | 'all' | 'versions' | 'code';
type CalibrateTab = 'ranking' | 'code';

interface CalibrationRow {
  id: AlgoId;
  /** Similarity per pair (metrics only). */
  scores?: number[];
  predicted: boolean[];
  best?: Best;
  confusion: Confusion;
}

const state = {
  view: 'compare' as View,
  version: LATEST,
  options: { ...DEFAULT_OPTIONS } as Options,
  compare: {
    a: PAIRS[0].a,
    b: PAIRS[0].b,
    algo: PAIRS[0].algo as AlgoId,
    tab: 'why' as CompareTab,
    res: null as Response | null,
    versions: null as Map<string, Response> | null,
  },
  search: {
    preset: LISTS[0].key,
    query: LISTS[0].query,
    list: LISTS[0].items.join('\n'),
    metric: LISTS[0].metric as MetricId,
    mode: 'top' as 'top' | 'threshold',
    topN: 10,
    threshold: 0.8,
    tab: 'results' as SearchTab,
    candidates: [] as string[],
    ranked: null as Response | null,
    all: null as Response | null,
    versions: null as Map<string, Response> | null,
  },
  calibrate: {
    preset: DATASETS[0].key,
    text: DATASETS[0].text,
    algo: null as AlgoId | null,
    threshold: null as number | null,
    tab: 'ranking' as CalibrateTab,
    pairs: [] as LabeledPair[],
    errors: [] as ParseError[],
    rows: [] as CalibrationRow[],
    mismatches: 0,
    error: '',
  },
};

// ---------- small UI helpers ----------

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}

function banner(msg: string): void {
  const el = $('banner');
  el.textContent = msg;
  el.hidden = !msg;
}

function debounce(fn: () => void, ms = 150): () => void {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

function selectTab(group: string, tab: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`[data-tabs="${group}"] [data-tab]`)) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
}

const codeBlock = (src: string): Html =>
  html`<div class="code-actions"><button type="button" class="ghost small" data-copy>Copy</button><span class="hint">Run it with <code>go run .</code> in a module that requires strsim.</span></div>
    <pre class="go"><code>${raw(highlightGo(src))}</code></pre>`;

document.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!btn) return;
  const code = btn.parentElement?.nextElementSibling?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(code);
    toast('Copied');
  } catch {
    toast('Could not copy: select the code and copy it by hand');
  }
});

/** ✓ when Go and the TypeScript re-implementation agree, otherwise what each one says. */
function check(ok: boolean, detail = ''): Html {
  return ok
    ? html`<span class="chk ok" title="The TypeScript re-implementation computes the same value">✓</span>`
    : html`<span class="chk bad" title="${detail || 'The TypeScript re-implementation, which follows the latest release, computes a different value'}">≠</span>`;
}

const versionNote = () =>
  state.version === LATEST
    ? ''
    : `This is strsim ${state.version}; the explanations follow ${LATEST}, so values that changed since are marked ≠. See the Versions tab and the changelog.`;

// ---------- compare ----------

const tokens = { compare: 0, search: 0, calibrate: 0 };

async function refreshCompare(): Promise<void> {
  const token = ++tokens.compare;
  const { a, b } = state.compare;
  const res = await run(state.version, { op: 'compare', a, b, options: state.options });
  if (token !== tokens.compare) return;
  state.compare.res = res;
  state.compare.versions = null;
  renderCompare();
  if (state.compare.tab === 'versions') void compareVersions(token);
}

async function compareVersions(token: number): Promise<void> {
  const { a, b } = state.compare;
  const out = new Map<string, Response>();
  await Promise.all(RELEASES.map(async (r) => out.set(r.version, await run(r.version, { op: 'compare', a, b, options: state.options }))));
  if (token !== tokens.compare) return;
  state.compare.versions = out;
  renderCompareDetail();
}

function renderCompare(): void {
  renderCompareScores();
  renderCompareDetail();
}

function familyRow(f: Family, cols: number): Html {
  return html`<tr class="family"><th colspan="${cols}">${FAMILIES[f]}</th></tr>`;
}

function renderCompareScores(): void {
  const res = state.compare.res;
  const el = $('cmp-scores');
  if (!res) return mount(el, html`<p class="hint">Loading strsim ${state.version}…</p>`);
  if (!res.ok) return mount(el, html`<p class="error">${res.error}</p>`);
  const { a, b, algo: selected } = state.compare;
  const o = state.options;
  let family: Family | '' = '';
  const rows: Html[] = [];
  for (const s of res.scores!) {
    const info = algo(s.metric);
    if (info.family !== family) {
      family = info.family;
      rows.push(familyRow(family, 4));
    }
    const sim = toNumber(s.similarity);
    const ref = explainMetric(s.metric, a, b, o);
    const ok = same(sim, ref.similarity) && (ref.distance === undefined || (s.distance ?? null) === ref.distance);
    const dist = s.panic ? html`<span class="panic" title="${s.panic}">panic</span>` : s.distance ?? '';
    rows.push(html`<tr class="pick ${s.metric === selected ? 'sel' : ''}" data-algo="${s.metric}" tabindex="0">
      <td class="name">${info.name}</td>
      <td class="sim">${bar(sim)}<span class="num" title="${exact(sim)}">${score(sim)}</span></td>
      <td class="num">${dist}</td>
      <td>${check(ok, `Here: ${exact(ref.similarity)}${ref.distance !== undefined ? `, distance ${ref.distance ?? 'none'}` : ''}`)}</td>
    </tr>`);
  }
  const codeRows = res.codes!.map((c) => {
    const ref = explainEncoder(c.encoder, a, b, o);
    const dual = c.encoder === 'doublemetaphone';
    const show = (code: string, alt?: string) => (dual ? `${code || '""'} / ${alt || '""'}` : code || '""');
    const ok =
      ref.a.code === c.a && ref.b.code === c.b && (ref.a.alt ?? '') === (c.altA ?? '') && (ref.b.alt ?? '') === (c.altB ?? '') && ref.match === c.match;
    return html`<tr class="pick ${c.encoder === selected ? 'sel' : ''}" data-algo="${c.encoder}" tabindex="0">
      <td class="name">${algo(c.encoder).name}</td>
      <td class="code">${show(c.a, c.altA)}</td>
      <td class="code">${show(c.b, c.altB)}</td>
      <td class="${c.match ? 'yes' : 'no'}">${c.match ? 'match' : 'no'}</td>
      <td>${check(ok, `Here: ${show(ref.a.code, ref.a.alt)} and ${show(ref.b.code, ref.b.alt)}`)}</td>
    </tr>`;
  });
  mount(
    el,
    html`<div class="table-wrap"><table class="scores">
        <thead><tr><th>Metric</th><th>Similarity</th><th class="num">Distance</th><th><span class="sr">Checked</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table class="scores codes">
        <thead>${familyRow('phonetic', 5)}<tr><th>Encoder</th><th>A</th><th>B</th><th></th><th><span class="sr">Checked</span></th></tr></thead>
        <tbody>${codeRows}</tbody>
      </table></div>
      <p class="hint">Pick a row to see why. ✓: the TypeScript re-implementation computes the same value as strsim in Go.</p>`,
  );
}

function renderCompareDetail(): void {
  const el = $('cmp-detail');
  const { a, b, algo: id, tab, res } = state.compare;
  selectTab('compare', tab);
  if (tab === 'code') return mount(el, codeBlock(compareProgram(a, b, state.options, state.version)));
  if (tab === 'versions') return mount(el, compareVersionsTable());
  if (!res?.ok) return mount(el, html``);

  const o = state.options;
  if (isMetric(id)) {
    const x = explainMetric(id, a, b, o);
    const s = res.scores!.find((s) => s.metric === id)!;
    const sim = toNumber(s.similarity);
    const ok = same(sim, x.similarity) && (x.distance === undefined || (s.distance ?? null) === x.distance);
    const goSays = html`strsim ${state.version} returned <b>${score(sim)}</b>${s.distance !== undefined ? html`, distance <b>${s.distance}</b>` : ''}${s.panic ? html` (Distance panicked: <code>${s.panic}</code>)` : ''}.`;
    mount(
      el,
      html`${heading(id)}
        <p class="verdict ${ok ? 'ok' : 'bad'}">${goSays} ${ok ? 'The explanation below gets the same value.' : html`The explanation below follows ${LATEST} and gets ${score(x.similarity)}.`}</p>
        ${whyMetric(id, x)}`,
    );
  } else {
    const x = explainEncoder(id, a, b, o);
    const c = res.codes!.find((c) => c.encoder === id)!;
    const dual = id === 'doublemetaphone';
    const show = (code: string, alt?: string) => (dual ? `${code || '""'} / ${alt || '""'}` : code || '""');
    const ok = x.a.code === c.a && x.b.code === c.b && (x.a.alt ?? '') === (c.altA ?? '') && (x.b.alt ?? '') === (c.altB ?? '') && x.match === c.match;
    mount(
      el,
      html`${heading(id)}
        <p class="verdict ${ok ? 'ok' : 'bad'}">strsim ${state.version} returned <b>${show(c.a, c.altA)}</b> and <b>${show(c.b, c.altB)}</b>: ${c.match ? 'match' : 'no match'}. ${
          ok ? 'The explanation below gets the same codes.' : html`The explanation below follows ${LATEST} and gets ${show(x.a.code, x.a.alt)} and ${show(x.b.code, x.b.alt)}.`
        }</p>
        ${whyEncoder(id, a, b, x)}`,
    );
  }
}

function compareVersionsTable(): Html {
  const v = state.compare.versions;
  if (!v) return html`<p class="hint">Running every release…</p>`;
  const latest = v.get(LATEST)!;
  const head = html`<tr><th>Algorithm</th>${RELEASES.map((r) => html`<th>${r.version}</th>`)}</tr>`;
  const cell = (r: Response | undefined, render: (r: Response) => string): Html => {
    if (!r?.ok) return html`<td class="error">${r?.error ?? '…'}</td>`;
    const value = render(r);
    return html`<td class="${value !== render(latest) ? 'changed' : ''}">${value}</td>`;
  };
  const metricRows = METRICS.map((m) => {
    const show = (r: Response) => {
      const s = r.scores!.find((s) => s.metric === m.id)!;
      return `${score(toNumber(s.similarity))}${s.distance !== undefined ? ` (${s.distance})` : s.panic ? ' (Distance panics)' : ''}`;
    };
    return html`<tr><td class="name">${m.name}</td>${RELEASES.map((r) => cell(v.get(r.version), show))}</tr>`;
  });
  const codeRows = ENCODERS.map((e) => {
    const show = (r: Response) => {
      const c = r.codes!.find((c) => c.encoder === e.id)!;
      const pair = e.id === 'doublemetaphone' ? `${c.a}/${c.altA ?? ''} · ${c.b}/${c.altB ?? ''}` : `${c.a} · ${c.b}`;
      return `${pair} ${c.match ? '✓' : '✗'}`;
    };
    return html`<tr><td class="name">${e.name}</td>${RELEASES.map((r) => cell(v.get(r.version), show))}</tr>`;
  });
  const algos = METRICS.length + ENCODERS.length;
  return html`<p>The same pair and options on every release. Values that differ from ${LATEST} are highlighted; the <a href="${CHANGELOG}" target="_blank" rel="noopener">changelog</a> says why.</p>
    <div class="table-wrap"><table class="versions">${head}${metricRows}${codeRows}</table></div>
    <p class="hint">${plural(algos, 'algorithm')} × ${plural(RELEASES.length, 'release')}. Distances in parentheses; phonetic codes as A · B, ✓ when they match.</p>`;
}

function setupCompare(): void {
  const a = $<HTMLInputElement>('cmp-a');
  const b = $<HTMLInputElement>('cmp-b');
  const sync = () => {
    a.value = state.compare.a;
    b.value = state.compare.b;
  };
  sync();
  const changed = debounce(() => void refreshCompare(), 100);
  const onInput = () => {
    state.compare.a = clip(a.value, MAX_COMPARE_RUNES);
    state.compare.b = clip(b.value, MAX_COMPARE_RUNES);
    changed();
  };
  a.addEventListener('input', onInput);
  b.addEventListener('input', onInput);
  $('cmp-swap').addEventListener('click', () => {
    [state.compare.a, state.compare.b] = [state.compare.b, state.compare.a];
    sync();
    void refreshCompare();
  });
  mount(
    $('cmp-examples'),
    html`<span class="hint">Try</span>${PAIRS.map((p, i) => html`<button type="button" class="chip-btn" data-example="${i}" title="${p.note}">${p.a} · ${p.b}</button>`)}`,
  );
  $('cmp-examples').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-example]');
    if (!btn) return;
    const p = PAIRS[Number(btn.dataset.example)];
    Object.assign(state.compare, { a: p.a, b: p.b, algo: p.algo, tab: 'why' });
    sync();
    void refreshCompare();
  });
  const pick = (e: Event) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-algo]');
    if (!row) return;
    state.compare.algo = row.dataset.algo as AlgoId;
    state.compare.tab = 'why';
    renderCompare();
  };
  $('cmp-scores').addEventListener('click', pick);
  $('cmp-scores').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(e);
    }
  });
}

/** Opens a pair in the Compare view. */
function openPair(a: string, b: string, id: AlgoId): void {
  Object.assign(state.compare, { a: clip(a, MAX_COMPARE_RUNES), b: clip(b, MAX_COMPARE_RUNES), algo: id, tab: 'why' });
  $<HTMLInputElement>('cmp-a').value = state.compare.a;
  $<HTMLInputElement>('cmp-b').value = state.compare.b;
  setView('compare');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- search ----------

function candidates(): { list: string[]; warn: string } {
  const lines = state.search.list.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warn: string[] = [];
  let list = lines;
  if (list.length > MAX_LIST_LEN) {
    warn.push(`Only the first ${int(MAX_LIST_LEN)} of ${int(lines.length)} lines are used.`);
    list = list.slice(0, MAX_LIST_LEN);
  }
  const long = list.filter((l) => runes(l).length > MAX_LIST_RUNES).length;
  if (long) warn.push(`${plural(long, 'line')} cut to ${MAX_LIST_RUNES} characters.`);
  return { list: list.map((l) => clip(l, MAX_LIST_RUNES)), warn: warn.join(' ') };
}

async function refreshSearch(): Promise<void> {
  const token = ++tokens.search;
  const s = state.search;
  const { list, warn } = candidates();
  $('s-warn').textContent = warn;
  $('s-count').textContent = `(${int(list.length)})`;
  const query = clip(s.query, MAX_LIST_RUNES);
  const topN = s.mode === 'top' ? Math.max(1, s.topN) : 0;
  const [ranked, all] = await Promise.all([
    run(state.version, { op: 'rank', query, candidates: list, metric: s.metric, topN, threshold: s.threshold, options: state.options }),
    run(state.version, { op: 'pairs', pairs: list.map((c) => [query, c] as [string, string]), options: state.options }),
  ]);
  if (token !== tokens.search) return;
  Object.assign(s, { candidates: list, ranked, all, versions: null });
  renderSearch();
  if (s.tab === 'versions') void searchVersions(token);
}

async function searchVersions(token: number): Promise<void> {
  const s = state.search;
  const query = clip(s.query, MAX_LIST_RUNES);
  const topN = s.mode === 'top' ? Math.max(1, s.topN) : 0;
  const out = new Map<string, Response>();
  await Promise.all(
    RELEASES.map(async (r) =>
      out.set(r.version, await run(r.version, { op: 'rank', query, candidates: s.candidates, metric: s.metric, topN, threshold: s.threshold, options: state.options })),
    ),
  );
  if (token !== tokens.search) return;
  s.versions = out;
  renderSearch();
}

function phoneticBadges(i: number): Html {
  const m = state.search.all?.matches;
  if (!m) return html``;
  const hits = ENCODERS.filter((e) => m[e.id][i]);
  return html`${hits.map((e) => html`<span class="badge" title="${e.name} codes match">${e.name === 'Double Metaphone' ? 'DM' : e.name.slice(0, 1)}</span>`)}`;
}

function renderSearch(): void {
  const s = state.search;
  selectTab('search', s.tab);
  const el = $('s-detail');
  const query = clip(s.query, MAX_LIST_RUNES);
  if (s.tab === 'code') {
    return mount(
      el,
      codeBlock(searchProgram({ query, candidates: s.candidates, metric: s.metric, topN: s.mode === 'top' ? Math.max(1, s.topN) : 0, threshold: s.threshold }, state.options, state.version)),
    );
  }
  const r = s.ranked;
  if (!r) return mount(el, html`<p class="hint">Loading strsim ${state.version}…</p>`);
  if (!r.ok) return mount(el, html`<p class="error">${r.error}</p>`);
  const name = algo(s.metric).name;

  if (s.tab === 'results') {
    const ranked = r.ranked ?? [];
    let mismatches = 0;
    const rows = ranked.map((m, k) => {
      const sim = toNumber(m.similarity);
      const ok = same(sim, explainMetric(s.metric, query, s.candidates[m.index], state.options).similarity);
      if (!ok) mismatches++;
      return html`<tr class="pick" data-index="${m.index}" tabindex="0" title="Open in Compare">
        <td class="num rank">${k + 1}</td>
        <td class="name">${quoted(s.candidates[m.index])}</td>
        <td class="sim">${bar(sim)}<span class="num" title="${exact(sim)}">${score(sim)}</span></td>
        <td>${phoneticBadges(m.index)}</td>
        <td>${check(ok)}</td>
      </tr>`;
    });
    const how = s.mode === 'top' ? html`<code>FindTopN</code> with N = ${Math.max(1, s.topN)}` : html`<code>FindAboveThreshold</code> at ${s.threshold.toFixed(2)}`;
    return mount(
      el,
      html`<p>${how} and ${name}: ${plural(ranked.length, 'match', 'matches')} of ${plural(s.candidates.length, 'candidate')}. Ties keep the order of the list.</p>
        ${
          ranked.length
            ? html`<div class="table-wrap"><table class="scores ranked"><thead><tr><th>#</th><th>Candidate</th><th>Similarity</th><th>Sounds alike</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : html`<p class="hint">Nothing reaches the threshold.</p>`
        }
        <p class="hint">${
          mismatches
            ? `${plural(mismatches, 'score')} differ from the TypeScript re-implementation, which follows ${LATEST}.`
            : `All ${plural(ranked.length, 'score')} match the TypeScript re-implementation.`
        } Sounds alike: the phonetic encoders whose codes match the query (S Soundex, M Metaphone, DM Double Metaphone, N NYSIIS). Pick a row to compare it with the query.</p>`,
    );
  }

  if (s.tab === 'all') {
    const all = s.all;
    if (!all?.ok) return mount(el, html`<p class="error">${all?.error ?? ''}</p>`);
    const sims = all.similarities!;
    const order = s.candidates.map((_, i) => i).sort((x, y) => toNumber(sims[s.metric][y]) - toNumber(sims[s.metric][x]) || x - y);
    const shown = order.slice(0, 100);
    const best = Object.fromEntries(METRICS.map((m) => [m.id, Math.max(...sims[m.id].map(toNumber).filter((v) => !Number.isNaN(v)))]));
    const head = html`<tr><th>Candidate</th>${METRICS.map((m) => html`<th class="${m.id === s.metric ? 'sel' : ''}" title="${m.about}">${m.name}</th>`)}${ENCODERS.map(
      (e) => html`<th title="${e.about}">${e.name}</th>`,
    )}</tr>`;
    const rows = shown.map(
      (i) => html`<tr class="pick" data-index="${i}" tabindex="0"><td class="name">${quoted(s.candidates[i])}</td>${METRICS.map((m) => {
        const v = toNumber(sims[m.id][i]);
        return html`<td class="num heat ${v === best[m.id] && v > 0 ? 'best' : ''}" style="--v:${Number.isFinite(v) ? v : 0}">${score(v)}</td>`;
      })}${ENCODERS.map((e) => html`<td class="${all.matches![e.id][i] ? 'yes' : 'no'}">${all.matches![e.id][i] ? '✓' : ''}</td>`)}</tr>`,
    );
    return mount(
      el,
      html`<p>Every metric against the query, sorted by ${name}${s.candidates.length > shown.length ? `, first ${shown.length} of ${int(s.candidates.length)}` : ''}. The best value of each column is outlined.</p>
        <div class="table-wrap"><table class="all-metrics">${head}${rows}</table></div>`,
    );
  }

  // versions
  const v = s.versions;
  if (!v) return mount(el, html`<p class="hint">Running every release…</p>`);
  const lists = RELEASES.map((rel) => ({ version: rel.version, res: v.get(rel.version)! }));
  const latest = (v.get(LATEST)?.ranked ?? []).map((m) => m.index);
  const cols = lists.map(
    ({ version, res }) => html`<div class="version-col"><h4>${version}</h4>${
      res.ok
        ? html`<ol>${(res.ranked ?? []).map((m, k) => html`<li class="${latest[k] !== m.index ? 'changed' : ''}">${quoted(s.candidates[m.index])} <span class="num">${score(toNumber(m.similarity))}</span></li>`)}</ol>`
        : html`<p class="error">${res.error}</p>`
    }</div>`,
  );
  mount(
    el,
    html`<p>The same search on every release. Positions that differ from ${LATEST} are highlighted; the <a href="${CHANGELOG}" target="_blank" rel="noopener">changelog</a> says why.</p><div class="version-cols">${cols}</div>`,
  );
}

function setupSearch(): void {
  const s = state.search;
  const preset = $<HTMLSelectElement>('s-preset');
  preset.innerHTML = LISTS.map((l) => `<option value="${l.key}">${l.name}</option>`).join('') + '<option value="">Your own list</option>';
  const metric = $<HTMLSelectElement>('s-metric');
  metric.innerHTML = METRICS.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  const query = $<HTMLInputElement>('s-query');
  const list = $<HTMLTextAreaElement>('s-list');
  const mode = $<HTMLSelectElement>('s-mode');
  const topn = $<HTMLInputElement>('s-topn');
  const threshold = $<HTMLInputElement>('s-threshold');
  const sync = () => {
    preset.value = s.preset;
    query.value = s.query;
    list.value = s.list;
    metric.value = s.metric;
    mode.value = s.mode;
    topn.value = String(s.topN);
    threshold.value = String(s.threshold);
    $('s-threshold-out').textContent = s.threshold.toFixed(2);
    for (const el of document.querySelectorAll<HTMLElement>('#view-search [data-show]')) el.hidden = el.dataset.show !== s.mode;
  };
  sync();
  syncSearch = sync;
  const changed = debounce(() => void refreshSearch(), 200);
  preset.addEventListener('change', () => {
    const p = LISTS.find((l) => l.key === preset.value);
    if (!p) return;
    Object.assign(s, { preset: p.key, query: p.query, list: p.items.join('\n'), metric: p.metric });
    sync();
    void refreshSearch();
  });
  query.addEventListener('input', () => {
    s.query = query.value;
    changed();
  });
  list.addEventListener('input', () => {
    s.list = list.value;
    s.preset = '';
    preset.value = '';
    changed();
  });
  metric.addEventListener('change', () => {
    s.metric = metric.value as MetricId;
    void refreshSearch();
  });
  mode.addEventListener('change', () => {
    s.mode = mode.value as 'top' | 'threshold';
    sync();
    void refreshSearch();
  });
  topn.addEventListener('input', () => {
    s.topN = Math.min(MAX_LIST_LEN, Math.max(1, Math.round(Number(topn.value) || 1)));
    changed();
  });
  threshold.addEventListener('input', () => {
    s.threshold = Number(threshold.value);
    $('s-threshold-out').textContent = s.threshold.toFixed(2);
    changed();
  });
  const pick = (e: Event) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (row) openPair(clip(s.query, MAX_LIST_RUNES), s.candidates[Number(row.dataset.index)], s.metric);
  };
  $('s-detail').addEventListener('click', pick);
  $('s-detail').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pick(e);
  });
}

let syncSearch = () => {};

// ---------- calibrate ----------

async function refreshCalibrate(): Promise<void> {
  const token = ++tokens.calibrate;
  const c = state.calibrate;
  const { pairs: parsed, errors } = parsePairs(c.text);
  const pairs = parsed.slice(0, MAX_LIST_LEN).map((p) => ({ ...p, a: clip(p.a, MAX_LIST_RUNES), b: clip(p.b, MAX_LIST_RUNES) }));
  c.pairs = pairs;
  c.errors = errors;
  $('c-count').textContent = `(${int(pairs.length)})`;
  renderCalibrateErrors(parsed.length);
  if (!pairs.length) {
    c.rows = [];
    c.error = '';
    return renderCalibrate();
  }
  const res = await run(state.version, { op: 'pairs', pairs: pairs.map((p) => [p.a, p.b] as [string, string]), options: state.options });
  if (token !== tokens.calibrate) return;
  if (!res.ok) {
    c.error = res.error ?? 'strsim failed';
    c.rows = [];
    return renderCalibrate();
  }
  c.error = '';
  const labels = pairs.map((p) => p.same);
  let mismatches = 0;
  const rows: CalibrationRow[] = [];
  for (const m of METRICS) {
    const scores = res.similarities![m.id].map(toNumber);
    scores.forEach((v, i) => {
      if (!same(v, explainMetric(m.id, pairs[i].a, pairs[i].b, state.options).similarity)) mismatches++;
    });
    const best = bestThreshold(scores, labels);
    rows.push({ id: m.id, scores, best, predicted: predict(scores, best.threshold), confusion: best.confusion });
  }
  for (const e of ENCODERS) {
    const predicted = res.matches![e.id];
    predicted.forEach((v, i) => {
      if (v !== explainEncoder(e.id, pairs[i].a, pairs[i].b, state.options).match) mismatches++;
    });
    rows.push({ id: e.id, predicted, confusion: confusion(predicted, labels) });
  }
  rows.sort((x, y) => y.confusion.f1 - x.confusion.f1 || y.confusion.accuracy - x.confusion.accuracy);
  c.rows = rows;
  c.mismatches = mismatches;
  if (!c.algo || !rows.some((r) => r.id === c.algo)) {
    c.algo = rows[0].id;
    c.threshold = null;
  }
  renderCalibrate();
}

function renderCalibrateErrors(total: number): void {
  const c = state.calibrate;
  const notes: Html[] = c.errors.slice(0, 8).map((e) => html`<li>Line ${e.line}: ${e.message}</li>`);
  if (c.errors.length > 8) notes.push(html`<li>…and ${int(c.errors.length - 8)} more</li>`);
  if (total > MAX_LIST_LEN) notes.push(html`<li>Only the first ${int(MAX_LIST_LEN)} pairs are used.</li>`);
  mount($('c-errors'), notes.length ? html`<ul class="errors">${notes}</ul>` : html``);
}

const pct = (n: number) => (Number.isNaN(n) ? 'n/a' : `${(n * 100).toFixed(0)}%`);

function currentThreshold(row: CalibrationRow): number {
  const c = state.calibrate;
  if (c.threshold !== null) return c.threshold;
  return row.best && Number.isFinite(row.best.threshold) ? row.best.threshold : 1;
}

function renderCalibrate(): void {
  const c = state.calibrate;
  selectTab('calibrate', c.tab);
  const el = $('c-detail');
  if (c.error) return mount(el, html`<p class="error">${c.error}</p>`);
  if (!c.rows.length) return mount(el, html`<p class="hint">Add labeled pairs to compare the metrics.</p>`);
  const row = c.rows.find((r) => r.id === c.algo) ?? c.rows[0];
  const t = currentThreshold(row);

  if (c.tab === 'code') {
    return mount(el, codeBlock(calibrateProgram({ algo: row.id, threshold: row.scores ? t : 0, pairs: c.pairs }, state.options, state.version)));
  }

  const positives = c.pairs.filter((p) => p.same).length;
  const table = c.rows.map((r) => {
    const th = r.best ? (Number.isFinite(r.best.threshold) ? r.best.threshold.toString() : 'none') : 'match';
    const k = r.confusion;
    return html`<tr class="pick ${r.id === row.id ? 'sel' : ''}" data-algo="${r.id}" tabindex="0">
      <td class="name">${algo(r.id).name}</td>
      <td class="num">${r.best ? '≥ ' : ''}${th}</td>
      <td class="num">${pct(k.precision)}</td>
      <td class="num">${pct(k.recall)}</td>
      <td class="num f1">${bar(k.f1)}<span>${k.f1.toFixed(2)}</span></td>
      <td class="num">${k.fp + k.fn}</td>
    </tr>`;
  });
  mount(
    el,
    html`<p>${plural(c.pairs.length, 'pair')}: ${int(positives)} the same, ${int(c.pairs.length - positives)} different. Each metric at its best threshold, ranked by F1 (precision and recall together).</p>
      <div class="table-wrap"><table class="scores calib">
        <thead><tr><th>Algorithm</th><th class="num">Threshold</th><th class="num" title="Of the pairs it calls the same, how many are">Precision</th><th class="num" title="Of the pairs that are the same, how many it finds">Recall</th><th class="num">F1</th><th class="num" title="Pairs it gets wrong">Wrong</th></tr></thead>
        <tbody>${table}</tbody>
      </table></div>
      <p class="hint">${
        c.mismatches
          ? `${plural(c.mismatches, 'value')} differ from the TypeScript re-implementation, which follows ${LATEST}.`
          : `All ${int(c.pairs.length * (METRICS.length + ENCODERS.length))} values match the TypeScript re-implementation.`
      } Phonetic encoders have no threshold: their codes match or not.</p>
      <div id="c-pick">${calibrateDetail(row, t)}</div>`,
  );
}

function strip(row: CalibrationRow, t: number): Html {
  const c = state.calibrate;
  const W = 640;
  const x = (v: number) => 30 + Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * (W - 60);
  const dots = c.pairs.map((p, i) => {
    const v = row.scores![i];
    const kept = v >= t;
    const wrong = kept !== p.same;
    const jitter = (((i * 2654435761) >>> 0) % 17) - 8;
    return `<circle cx="${x(v).toFixed(1)}" cy="${(p.same ? 40 : 96) + jitter}" r="4.5" class="${wrong ? 'wrong' : p.same ? 'same' : 'diff'}" data-i="${i}"><title>${escapeXml(`${p.a} · ${p.b}: ${score(v)}`)}</title></circle>`;
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="18" y2="118" class="tick"/><text x="${x(v)}" y="134" class="tl">${v}</text>`);
  return raw(
    `<svg class="strip" viewBox="0 0 ${W} 140" role="img" aria-label="Scores of the labeled pairs">` +
      ticks.join('') +
      `<text x="30" y="14" class="lbl">Same</text><text x="30" y="72" class="lbl">Different</text>` +
      `<rect x="${x(t)}" y="18" width="${Math.max(0, x(1) - x(t))}" height="100" class="kept"/>` +
      `<line x1="${x(t)}" x2="${x(t)}" y1="16" y2="120" class="cut"/>` +
      dots.join('') +
      `</svg>`,
  );
}

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);

function calibrateDetail(row: CalibrationRow, t: number): Html {
  const c = state.calibrate;
  const labels = c.pairs.map((p) => p.same);
  const predicted = row.scores ? predict(row.scores, t) : row.predicted;
  const k = confusion(predicted, labels);
  const wrong = c.pairs.map((p, i) => ({ p, i })).filter(({ i }) => predicted[i] !== labels[i]);
  const name = algo(row.id).name;
  const control = row.scores
    ? html`<div class="strip-box">
        <label class="field"><span>Threshold <output>${t}</output>${row.best && t !== row.best.threshold ? html` <button type="button" class="ghost small" data-reset-threshold>Back to the best: ${Number.isFinite(row.best.threshold) ? row.best.threshold : 'none'}</button>` : ''}</span>
        <input type="range" id="c-threshold" min="0" max="1" step="0.005" value="${t}" aria-label="Threshold" /></label>
        ${strip(row, t)}</div>`
    : html``;
  const list = wrong.slice(0, 50).map(({ p, i }) => {
    const v = row.scores ? score(row.scores[i]) : predicted[i] ? 'match' : 'no match';
    return html`<li class="pick" data-pair="${i}" tabindex="0">${quoted(p.a)} · ${quoted(p.b)} <span class="num">${v}</span> <span class="hint">${p.same ? 'missed' : 'false match'}</span></li>`;
  });
  return html`<h3>${name}${row.scores ? html` at ≥ ${t}` : ''}</h3>
    ${control}
    <p class="stats">Precision <b>${pct(k.precision)}</b> · Recall <b>${pct(k.recall)}</b> · F1 <b>${k.f1.toFixed(2)}</b> · ${int(k.tp)} found, ${int(k.fn)} missed, ${int(k.fp)} false ${k.fp === 1 ? 'match' : 'matches'}</p>
    ${wrong.length ? html`<h4>Wrong at this threshold</h4><ul class="wrong">${list}</ul>${wrong.length > 50 ? html`<p class="hint">…and ${int(wrong.length - 50)} more.</p>` : ''}` : html`<p>Every pair is right.</p>`}
    <p class="hint">Pick a pair to see why it scores what it does. The Go code tab has a <code>same(a, b)</code> function with this ${row.scores ? 'metric and threshold' : 'encoder'}.</p>`;
}

function setupCalibrate(): void {
  const c = state.calibrate;
  const preset = $<HTMLSelectElement>('c-preset');
  preset.innerHTML = DATASETS.map((d) => `<option value="${d.key}">${d.name}</option>`).join('') + '<option value="">Your own pairs</option>';
  const text = $<HTMLTextAreaElement>('c-text');
  const sync = () => {
    preset.value = c.preset;
    text.value = c.text;
  };
  sync();
  syncCalibrate = sync;
  preset.addEventListener('change', () => {
    const d = DATASETS.find((d) => d.key === preset.value);
    if (!d) return;
    Object.assign(c, { preset: d.key, text: d.text, algo: null, threshold: null });
    sync();
    void refreshCalibrate();
  });
  const changed = debounce(() => void refreshCalibrate(), 250);
  text.addEventListener('input', () => {
    c.text = text.value;
    c.preset = '';
    preset.value = '';
    changed();
  });
  const detail = $('c-detail');
  detail.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-algo]');
    if (row) {
      c.algo = row.dataset.algo as AlgoId;
      c.threshold = null;
      return renderCalibrate();
    }
    if (target.closest('[data-reset-threshold]')) {
      c.threshold = null;
      return renderCalibrate();
    }
    const pair = target.closest<HTMLElement>('[data-pair]');
    if (pair) {
      const p = c.pairs[Number(pair.dataset.pair)];
      openPair(p.a, p.b, c.algo ?? 'jarowinkler');
    }
  });
  detail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-algo], [data-pair]')) (e.target as HTMLElement).click();
  });
  detail.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== 'c-threshold') return;
    c.threshold = Number(input.value);
    const row = c.rows.find((r) => r.id === c.algo);
    if (row) mount($('c-pick'), calibrateDetail(row, c.threshold));
    $<HTMLInputElement>('c-threshold')?.focus();
  });
}

let syncCalibrate = () => {};

// ---------- options, versions, views, sharing ----------

function setupOptions(): void {
  const form = $<HTMLFormElement>('options');
  const btn = $('btn-options');
  const sync = () => {
    for (const [k, v] of Object.entries(state.options)) {
      const input = form.elements.namedItem(k) as HTMLInputElement | null;
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = v as boolean;
      else input.value = String(v);
    }
    const changed = (Object.keys(DEFAULT_OPTIONS) as (keyof Options)[]).filter((k) => state.options[k] !== DEFAULT_OPTIONS[k]).length;
    $('options-badge').textContent = changed ? `· ${changed} changed` : '';
  };
  syncOptions = sync;
  sync();
  btn.addEventListener('click', () => {
    form.hidden = !form.hidden;
    btn.setAttribute('aria-expanded', String(!form.hidden));
  });
  const changed = debounce(() => refresh(), 150);
  form.addEventListener('input', () => {
    const raw: Record<string, unknown> = {};
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      raw[el.name] = el.type === 'checkbox' ? el.checked : el.value === '' ? undefined : Number(el.value);
    }
    state.options = sanitizeOptions(raw);
    const count = (Object.keys(DEFAULT_OPTIONS) as (keyof Options)[]).filter((k) => state.options[k] !== DEFAULT_OPTIONS[k]).length;
    $('options-badge').textContent = count ? `· ${count} changed` : '';
    changed();
  });
  $('options-reset').addEventListener('click', () => {
    state.options = { ...DEFAULT_OPTIONS };
    sync();
    refresh();
  });
}

let syncOptions = () => {};

function setupVersion(): void {
  const select = $<HTMLSelectElement>('version');
  select.innerHTML = RELEASES.map((r) => `<option value="${r.version}">${r.version}${r.version === LATEST ? ' (latest)' : ''}</option>`).join('');
  select.value = state.version;
  select.addEventListener('change', () => {
    state.version = select.value;
    void loadEngine();
    refresh();
  });
}

async function loadEngine(): Promise<void> {
  const version = state.version;
  try {
    const info = await engine(version).ready;
    if (version !== state.version) return;
    banner(versionNote());
    $('banner').classList.toggle('info', true);
    renderFooter(info.go);
  } catch (err) {
    $('banner').classList.toggle('info', false);
    banner(`strsim ${version} did not load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function renderFooter(go: string): void {
  mount(
    $('footer'),
    html`<span>strsim ${state.version} compiled with ${go} to WebAssembly. Every value is checked against an independent TypeScript re-implementation.</span>
      <a href="https://github.com/jcoruiz/strsim-playground" target="_blank" rel="noopener">Source</a>
      <a href="${CHANGELOG}" target="_blank" rel="noopener">Changelog</a>`,
  );
}

function setView(view: View): void {
  state.view = view;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.views [data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  refresh();
}

function refresh(): void {
  if (state.view === 'compare') void refreshCompare();
  else if (state.view === 'search') void refreshSearch();
  else void refreshCalibrate();
}

function setupTabs(): void {
  document.querySelector('.views')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    if (b) setView(b.dataset.view as View);
  });
  for (const nav of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
    nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
      if (!b) return;
      const tab = b.dataset.tab!;
      if (nav.dataset.tabs === 'compare') {
        state.compare.tab = tab as CompareTab;
        renderCompareDetail();
        if (tab === 'versions' && !state.compare.versions) void compareVersions(tokens.compare);
      } else if (nav.dataset.tabs === 'search') {
        state.search.tab = tab as SearchTab;
        renderSearch();
        if (tab === 'versions' && !state.search.versions) void searchVersions(tokens.search);
      } else {
        state.calibrate.tab = tab as CalibrateTab;
        renderCalibrate();
      }
    });
  }
}

function snapshot(): Snapshot {
  const snap: Snapshot = { view: state.view, version: state.version, options: state.options };
  if (state.view === 'compare') snap.compare = { a: state.compare.a, b: state.compare.b, algo: state.compare.algo };
  if (state.view === 'search') {
    const s = state.search;
    snap.search = { query: s.query, list: s.list, metric: s.metric, topN: s.mode === 'top' ? s.topN : 0, threshold: s.threshold };
  }
  if (state.view === 'calibrate') {
    const c = state.calibrate;
    snap.calibrate = { text: c.text, ...(c.algo ? { algo: c.algo } : {}), ...(c.threshold !== null ? { threshold: c.threshold } : {}) };
  }
  return snap;
}

function apply(snap: Snapshot): void {
  state.version = snap.version;
  $<HTMLSelectElement>('version').value = snap.version;
  state.options = snap.options;
  syncOptions();
  if (snap.compare) {
    Object.assign(state.compare, snap.compare, { tab: 'why' });
    $<HTMLInputElement>('cmp-a').value = snap.compare.a;
    $<HTMLInputElement>('cmp-b').value = snap.compare.b;
  }
  if (snap.search) {
    const { topN, ...rest } = snap.search;
    Object.assign(state.search, rest, { preset: LISTS.find((l) => l.items.join('\n') === rest.list)?.key ?? '', mode: topN > 0 ? 'top' : 'threshold', topN: topN || 10 });
    syncSearch();
  }
  if (snap.calibrate) {
    const c = snap.calibrate;
    Object.assign(state.calibrate, {
      text: c.text,
      algo: c.algo ?? null,
      threshold: c.threshold ?? null,
      preset: DATASETS.find((d) => d.text === c.text)?.key ?? '',
    });
    syncCalibrate();
  }
}

function setupShare(): void {
  $('btn-share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#s=${await encode(snapshot())}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      toast(url.length > 8000 ? 'Link copied. It is long: some apps may cut it.' : 'Link copied');
    } catch {
      toast('The link is in the address bar');
    }
  });
}

async function boot(): Promise<void> {
  setupOptions();
  setupVersion();
  setupCompare();
  setupSearch();
  setupCalibrate();
  setupTabs();
  setupShare();
  const m = location.hash.match(/^#s=([\w-]+)$/);
  let view: View = 'compare';
  if (m) {
    try {
      const snap = await decode(m[1]);
      apply(snap);
      view = snap.view;
    } catch {
      banner('This link could not be read. It may have been cut.');
    }
  }
  void loadEngine();
  setView(view);
}

void boot();
