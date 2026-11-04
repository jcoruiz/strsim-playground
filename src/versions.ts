// The strsim releases the playground ships, newest first. versions.json is
// also read by scripts/build-wasm.sh, which builds one WASM per release.
import list from '../versions.json';

export interface Release {
  version: string;
  released: string;
}

export const RELEASES: readonly Release[] = list.versions;
export const LATEST = RELEASES[0].version;
export const CHANGELOG = 'https://github.com/jcoruiz/strsim/blob/main/CHANGELOG.md';

export const isRelease = (v: unknown): v is string => RELEASES.some((r) => r.version === v);

const parts = (v: string) => v.replace(/^v/, '').split('.').map(Number);

/** Whether version a is b or newer. */
export function atLeast(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
}
