#!/usr/bin/env bash
# Compiles the Go bridge to WebAssembly once per strsim version listed in
# versions.json, each against its pinned module file (wasm/versions/<v>.mod
# and .sum), and copies the wasm_exec.js shipped with the same Go toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."

GO="${GO:-go}"
out=src/generated
mkdir -p "$out"
rm -f "$out"/strsim-*.wasm

versions=$(node -p "require('./versions.json').versions.map(v => v.version).join(' ')")
latest=${versions%% *}

# wasm/go.mod is the module file for local development and tests: keep it
# on the newest version.
if ! cmp -s wasm/go.mod "wasm/versions/$latest.mod"; then
  echo "wasm/go.mod does not match wasm/versions/$latest.mod: run scripts/add-version.sh $latest" >&2
  exit 1
fi

for v in $versions; do
  if [ ! -f "wasm/versions/$v.mod" ]; then
    echo "missing wasm/versions/$v.mod: run scripts/add-version.sh $v" >&2
    exit 1
  fi
  (cd wasm && GOOS=js GOARCH=wasm "$GO" build -trimpath -ldflags="-s -w" -mod=readonly \
    -modfile="versions/$v.mod" -o "../$out/strsim-$v.wasm" .)
  echo "wasm $v: $(du -h "$out/strsim-$v.wasm" | cut -f1)"
done

# Go 1.24 moved wasm_exec.js from misc/wasm to lib/wasm.
root=$("$GO" env GOROOT)
for dir in lib/wasm misc/wasm; do
  if [ -f "$root/$dir/wasm_exec.js" ]; then
    # install, not cp: a toolchain from the module cache is read-only.
    install -m 0644 "$root/$dir/wasm_exec.js" "$out/wasm_exec.js"
    break
  fi
done
echo "built with $("$GO" version | cut -d' ' -f3)"
