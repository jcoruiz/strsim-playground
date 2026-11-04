# strsim Playground

Try [strsim](https://github.com/jcoruiz/strsim), a string similarity library for Go, in your browser.

The library is compiled to WebAssembly and runs in a Web Worker on your machine. There is no backend: the text you type never leaves the page.

The latest release runs by default. Older releases stay available, so you can see what changed between them.

## What you can do

- **Compare two strings** with all 15 algorithms at once: Levenshtein (with custom costs), OSA, Damerau-Levenshtein, LCS, Hamming, Jaro, Jaro-Winkler, the n-gram Cosine, Jaccard, Dice and Overlap, and the Soundex, Metaphone, Double Metaphone and NYSIIS codes.
- **See why each one scores what it does.** For edit distances, the alignment and the matrix with the cheapest path. For Jaro and Jaro-Winkler, the matched characters, the transpositions and the prefix bonus. For n-grams, the shared n-grams. For phonetic encoders, every rule applied, letter by letter. Every formula is shown with the real numbers.
- **Check every value independently.** A TypeScript re-implementation produces the explanations and recomputes every score, distance and code that Go returns. A ✓ means both agree.
- **Search a list** with `FindTopN` or `FindAboveThreshold`. See the ranking under every metric, and which candidates sound like the query.
- **Find a threshold**: paste pairs labeled as the same thing or not. For each metric, the page finds the threshold that separates them best, ranks the metrics by F1 and lists the pairs each one gets wrong.
- **Compare releases**: the Versions tab runs the same input on each strsim release and highlights what changed.
- **Get the Go code** that does the same thing with the same settings, ready for `go run`.
- **Share** the current view as a link. The state is compressed into the URL fragment.

## How it works

```
versions.json  strsim releases in the playground, newest (the default) first
wasm/          Go bridge: JSON in, JSON out, compiled with GOOS=js GOARCH=wasm
  bridge.go      compare, pairs and rank requests → strsim
  main_js.go     registers strsimRun() for JavaScript
  main_cli.go    same request natively: go run ./wasm < request.json
  versions/      one go.mod and go.sum per release
src/
  reference/     the TypeScript re-implementation, with a trace of every step
  explain.ts     renders those traces ("Why")
  calibrate.ts   labeled pairs → best threshold per metric
  codegen.ts     current view → Go program
  worker.ts      loads one release's WASM in a Web Worker
test/          Vitest, running the real WASM builds in Node
```

The same bridge builds against every release. `scripts/build-wasm.sh` compiles it once per entry of `versions.json` with `go build -modfile=versions/<version>.mod`, because one Go binary cannot hold two versions of a module. The page starts a worker per release the first time it needs one, so a visit only downloads the releases it uses.

The re-implementation follows the latest release. `npm test` checks it in three ways:

- Against the latest WASM build, on thousands of random pairs and four sets of options. The pairs include accents in composed and decomposed form, case pairs that `strings.ToLower` maps on its own, and characters outside the BMP.
- Against Apache Commons Codec, on 3,000 surnames.
- Against itself: each alignment must spell both strings and add up to the distance.

## Development

Requires Go 1.22+ (CI and deployment use 1.27) and Node 22.

```bash
npm ci
npm run dev        # builds the WASM, then starts Vite
npm test           # re-implementation vs WASM and Commons Codec; generated Go through gofmt, go vet and go run
npm run build      # production build in dist/
```

Go tests, natively and as WebAssembly, against one release (`wasm/go.mod` is the latest):

```bash
cd wasm
go test -race -modfile=versions/v0.1.0.mod ./...
PATH="$(go env GOROOT)/lib/wasm:$PATH" GOOS=js GOARCH=wasm go test -modfile=versions/v0.1.0.mod ./...
```

To add a strsim release, run `scripts/add-version.sh vX.Y.Z`. It pins the release in `wasm/versions`, makes it the default in `versions.json` and the module version of `wasm/go.mod`. Then run `npm test`. If the release changes results, `test/reference.test.ts` fails until `src/reference` follows it.

## Deployment

AWS Amplify Hosting builds `main` on every push with `amplify.yml`: Go 1.27 for the WASM, Node 22 for Vite. `customHttp.yml` sets the security headers and long caching for hashed assets.

## License

[MIT](LICENSE)
