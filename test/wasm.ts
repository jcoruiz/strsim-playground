// Loads the real WebAssembly builds in Node, the same artifacts the page uses.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BuildInfo, Request, Response } from '../src/types';

const generated = fileURLToPath(new URL('../src/generated/', import.meta.url));

declare const Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };

export interface Wasm {
  info: BuildInfo;
  run(req: Request): Response;
}

const loaded = new Map<string, Promise<Wasm>>();

/** Loads the build of one strsim release. Several can run side by side. */
export function loadWasm(version: string): Promise<Wasm> {
  let wasm = loaded.get(version);
  if (!wasm) {
    wasm = (async () => {
      await import('../src/generated/wasm_exec.js');
      const go = new Go();
      const { instance } = await WebAssembly.instantiate(readFileSync(`${generated}strsim-${version}.wasm`), go.importObject);
      void go.run(instance);
      // Every build registers the same globals: keep this one's before the next build replaces them.
      const g = globalThis as unknown as { strsimRun(req: string): string; strsimInfo(): string };
      const run = g.strsimRun;
      return {
        info: JSON.parse(g.strsimInfo()) as BuildInfo,
        run: (req) => JSON.parse(run(JSON.stringify(req))) as Response,
      };
    })();
    loaded.set(version, wasm);
  }
  return wasm;
}
