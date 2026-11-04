// Runs one strsim release off the main thread. The first message names the
// release to load; every later one is a request for the Go bridge.
import './generated/wasm_exec.js';
import type { BuildInfo, Request } from './types';

declare const Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };

export type WorkerIn = { type: 'init'; version: string } | { type: 'run'; id: number; request: Request };
export type WorkerOut = { type: 'ready'; info: BuildInfo } | { type: 'failed'; message: string } | { type: 'result'; id: number; json: string };

interface Api {
  run(request: string): string;
  info(): string;
}

// One build per release, ./generated/strsim-v0.2.0.wasm and so on. Only the
// URLs are bundled; a worker downloads just the release it runs.
const builds = import.meta.glob<string>('./generated/strsim-*.wasm', { query: '?url', import: 'default', eager: true });

const post = (msg: WorkerOut) => self.postMessage(msg);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function load(version: string): Promise<Api> {
  const url = builds[`./generated/strsim-${version}.wasm`];
  if (!url) throw new Error(`strsim ${version} is not part of this build`);
  const go = new Go();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download strsim ${version} (${res.status})`);
  // instantiateStreaming needs Content-Type application/wasm; fall back if a
  // host serves something else.
  const { instance } = res.headers.get('Content-Type')?.startsWith('application/wasm')
    ? await WebAssembly.instantiateStreaming(res, go.importObject)
    : await WebAssembly.instantiate(await res.arrayBuffer(), go.importObject);
  // run() resolves only when Go exits. main() registers its functions
  // before it parks, so they exist as soon as run() returns.
  void go.run(instance);
  const g = globalThis as unknown as { strsimRun: Api['run']; strsimInfo: Api['info'] };
  return { run: g.strsimRun, info: g.strsimInfo };
}

let api: Promise<Api> = Promise.reject(new Error('strsim was not started'));
api.catch(() => {});

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    api = load(msg.version);
    api.then(
      (a) => post({ type: 'ready', info: JSON.parse(a.info()) as BuildInfo }),
      (err: unknown) => post({ type: 'failed', message: message(err) }),
    );
    return;
  }
  let json: string;
  try {
    json = (await api).run(JSON.stringify(msg.request));
  } catch (err) {
    json = JSON.stringify({ ok: false, error: `strsim did not load: ${message(err)}` });
  }
  post({ type: 'result', id: msg.id, json });
};
