import type { WorkerIn, WorkerOut } from './worker';
import type { BuildInfo, Request, Response } from './types';

/** Client for the worker that runs one strsim release. Requests run in order. */
export class Engine {
  private worker: Worker;
  private pending = new Map<number, (r: Response) => void>();
  private seq = 0;
  readonly ready: Promise<BuildInfo>;

  constructor(readonly version: string) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve(msg.info);
        else if (msg.type === 'failed') reject(new Error(msg.message));
        else {
          this.pending.get(msg.id)?.(JSON.parse(msg.json) as Response);
          this.pending.delete(msg.id);
        }
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        const error = e.message || `strsim ${version} crashed`;
        reject(new Error(error));
        for (const done of this.pending.values()) done({ ok: false, error });
        this.pending.clear();
      };
    });
    this.ready.catch(() => {});
    this.worker.postMessage({ type: 'init', version } satisfies WorkerIn);
  }

  run(request: Request): Promise<Response> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'run', id, request } satisfies WorkerIn);
    });
  }
}

// One worker per release, started the first time it is needed, so a visit
// downloads only the releases it uses.
const engines = new Map<string, Engine>();

export function engine(version: string): Engine {
  let e = engines.get(version);
  if (!e) {
    e = new Engine(version);
    engines.set(version, e);
  }
  return e;
}

/** Runs a request once the release has loaded; a failed load comes back as an error response. */
export async function run(version: string, request: Request): Promise<Response> {
  const e = engine(version);
  try {
    await e.ready;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return e.run(request);
}
