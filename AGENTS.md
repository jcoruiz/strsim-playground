# strsim Playground

A static page that runs strsim releases compiled to WebAssembly, explains each score and checks it against a TypeScript re-implementation. The README covers the layout and commands.

## Invariants

- `src/reference` reproduces the latest strsim release exactly: the same float64 for every similarity, not an approximation. `test/reference.test.ts` compares it with the WASM build. A mismatch is a bug in one of the two; never loosen the comparison.
- Older releases may differ from the re-implementation. The page marks those values with ≠ and points to the changelog. Don't adapt the re-implementation to them.
- Ported algorithms (`src/reference/phonetic.ts`, `fold.ts`) follow strsim's own code. When strsim changes them, port the change and keep the three Commons Codec deviations in `test/reference.test.ts` in sync with strsim's `TestPhoneticReference`.
- Text reaches Go as UTF-8: `prepare` in `src/reference/index.ts` replaces lone surrogates and lowercases rune by rune, as `strings.ToLower` does. Any new input path goes through it.
- The limits in `wasm/bridge.go` (characters per string, list length) and in `src/types.ts` must match.
- Generated Go must stay gofmt-clean and print what the page shows: `test/codegen.test.ts` runs it against every release.
- Shared links are untrusted input: everything from a URL goes through `sanitize` in `src/share.ts`, and everything rendered goes through the `html` template in `src/html.ts`, which escapes.

## Checks

```bash
npm test                       # builds the WASM, then Vitest
npx tsc --noEmit
cd wasm && go vet ./... && go test -race ./...
```

CI also runs the Go tests under `GOOS=js GOARCH=wasm` against each pinned release.

## Deploying

Amplify does not build from the repo: `scripts/deploy.sh` publishes a local build of `main` (see the README). Deploy only when asked, after the change is merged and CI is green.

# Git conventions

All git text is written in **English**: commit messages, PR titles and descriptions, branch names.

## Commits — Conventional Commits

Format: `<type>(<scope>): <subject>`

- **type** (required): `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
- **scope** (optional): the area touched, lowercase — e.g. `bridge`, `reference`, `explain`, `compare`, `search`, `calibrate`, `codegen`, `share`, `versions`, `deploy`.
- **subject**: imperative mood, lowercase start, no trailing period, ≤ 72 chars for the whole header.
- **body** (optional): blank line after the header, then 1–3 short lines or bullets explaining *what/why*. No multi-paragraph prose.
- **Breaking changes**: `feat(scope)!: ...` plus a `BREAKING CHANGE: ...` footer.
- One logical change per commit; don't mix refactors with features.
- No `Co-Authored-By` or AI attribution lines.
- Enforced locally by `scripts/hooks/commit-msg` (enabled by `npm install` through `core.hooksPath`) and in CI by the `commits` job, which runs the same hook on every pushed commit and on pull request titles. (A GitHub ruleset can't do it: this account doesn't support commit message rules.)

Examples:

```
feat(calibrate): rank metrics by F1 on labeled pairs
fix(reference): halve odd transpositions like strsim v0.2.0
feat(versions): add strsim v0.3.0
test(codegen): run the generated programs against every release
```

## Pull requests

- Title follows the same format: it becomes the squash commit, and the `commits` job checks it.
- Description: short summary of the change and how it was verified. No AI attribution.

## Branches

`<type>/<short-kebab-description>` — e.g. `feat/ngram-explanation`, `fix/share-link-limits`.
