import { html, type Html } from './html';

/** A similarity as the page shows it: four decimals, NaN spelled out. */
export function score(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? '+Inf' : '−Inf';
  return n.toFixed(4);
}

/** The exact float64, for tooltips and the checks. */
export const exact = (n: number): string => (Number.isNaN(n) ? 'NaN' : String(n));

export const int = (n: number): string => n.toLocaleString('en-US');

export const plural = (n: number, one: string, many = `${one}s`): string => `${int(n)} ${n === 1 ? one : many}`;

/** A character made visible: spaces as ␣, nothing as a dot. */
export function vis(s: string): string {
  return s === '' ? '·' : s.replace(/ /g, '␣');
}

/** A string as code, with spaces visible. */
export const quoted = (s: string): Html => html`<code class="str">${s === '' ? '""' : vis(s)}</code>`;

/** A bar for a similarity in [0, 1]. */
export function bar(n: number): Html {
  const w = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) * 100 : 0;
  return html`<span class="bar" aria-hidden="true"><span style="width:${w.toFixed(1)}%"></span></span>`;
}
