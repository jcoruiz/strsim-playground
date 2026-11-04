package main

import (
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jcoruiz/strsim"
)

// Limits keep one request from freezing the page. The edit distances are
// quadratic, so list entries are shorter than the two strings of a comparison.
const (
	maxCompareRunes = 500
	maxListRunes    = 100
	maxListLen      = 5000
)

// Options mirrors the configurable fields of the strsim metrics and encoders.
// The page always sends every field; a zero means zero, as in Go.
type Options struct {
	IgnoreCase            bool    `json:"ignoreCase"`
	InsertCost            int     `json:"insertCost"`
	DeleteCost            int     `json:"deleteCost"`
	ReplaceCost           int     `json:"replaceCost"`
	BoostThreshold        float64 `json:"boostThreshold"`
	PrefixSize            int     `json:"prefixSize"`
	NgramSize             int     `json:"ngramSize"`
	SoundexLength         int     `json:"soundexLength"`
	MetaphoneLength       int     `json:"metaphoneLength"`
	DoubleMetaphoneLength int     `json:"doubleMetaphoneLength"`
	NYSIISLength          int     `json:"nysiisLength"`
}

// Request is one call from the page.
//
//   - compare: every metric and encoder on A and B.
//   - pairs: every metric and encoder on each pair.
//   - rank: FindTopN (TopN > 0) or FindAboveThreshold with one metric.
type Request struct {
	Op         string      `json:"op"`
	A          string      `json:"a"`
	B          string      `json:"b"`
	Pairs      [][2]string `json:"pairs"`
	Query      string      `json:"query"`
	Candidates []string    `json:"candidates"`
	Metric     string      `json:"metric"`
	TopN       int         `json:"topN"`
	Threshold  float64     `json:"threshold"`
	Options    Options     `json:"options"`
}

// Num is a float64 that survives JSON when it is NaN or infinite, which
// older releases can return.
type Num float64

func (n Num) MarshalJSON() ([]byte, error) {
	f := float64(n)
	switch {
	case math.IsNaN(f):
		return []byte(`"NaN"`), nil
	case math.IsInf(f, 1):
		return []byte(`"+Inf"`), nil
	case math.IsInf(f, -1):
		return []byte(`"-Inf"`), nil
	}

	return strconv.AppendFloat(nil, f, 'g', -1, 64), nil
}

// Score is one metric on one pair.
type Score struct {
	Metric     string `json:"metric"`
	Similarity Num    `json:"similarity"`
	// Distance is set for the edit distances, unless it panicked.
	Distance *int `json:"distance,omitempty"`
	// Panic is the value Distance or Similarity panicked with.
	Panic string `json:"panic,omitempty"`
}

// Code is one phonetic encoder on both strings of a pair.
type Code struct {
	Encoder string `json:"encoder"`
	A       string `json:"a"`
	B       string `json:"b"`
	AltA    string `json:"altA,omitempty"`
	AltB    string `json:"altB,omitempty"`
	Match   bool   `json:"match"`
}

// Ranked is one result of FindTopN or FindAboveThreshold.
type Ranked struct {
	Index      int `json:"index"`
	Similarity Num `json:"similarity"`
}

// Response carries the result of one request.
type Response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`

	// compare
	Scores []Score `json:"scores,omitempty"`
	Codes  []Code  `json:"codes,omitempty"`

	// pairs: one entry per pair, by metric or encoder.
	Similarities map[string][]Num  `json:"similarities,omitempty"`
	Matches      map[string][]bool `json:"matches,omitempty"`
	// Panics holds the first panic of each metric over the pairs.
	Panics map[string]string `json:"panics,omitempty"`

	// rank
	Ranked []Ranked `json:"ranked,omitempty"`
}

// metric is a similarity, plus a distance for the edit distances.
type metric struct {
	name       string
	similarity func(a, b string) float64
	distance   func(a, b string) int
}

func (m metric) Similarity(a, b string) float64 { return m.similarity(a, b) }

func metrics(o Options) []metric {
	lev := &strsim.LevenshteinMetric{InsertCost: o.InsertCost, DeleteCost: o.DeleteCost, ReplaceCost: o.ReplaceCost}
	osa := strsim.NewOSA()
	dl := strsim.NewDamerauLevenshtein()
	lcs := strsim.NewLCS()
	ham := strsim.NewHamming()
	jw := &strsim.JaroWinklerMetric{BoostThreshold: o.BoostThreshold, PrefixSize: o.PrefixSize}
	ng := &strsim.NgramMetric{Size: o.NgramSize}

	return []metric{
		{"levenshtein", lev.Similarity, lev.Distance},
		{"osa", osa.Similarity, osa.Distance},
		{"damerau", dl.Similarity, dl.Distance},
		{"lcs", lcs.Similarity, lcs.Distance},
		{"hamming", ham.Similarity, ham.Distance},
		{"jaro", strsim.NewJaro().Similarity, nil},
		{"jarowinkler", jw.Similarity, nil},
		{"cosine", ng.Cosine, nil},
		{"jaccard", ng.Jaccard, nil},
		{"dice", ng.Dice, nil},
		{"overlap", ng.Overlap, nil},
	}
}

// encoder encodes one string; alt is empty except for Double Metaphone.
type encoder struct {
	name   string
	encode func(s string) (code, alt string)
	match  func(a, b string) bool
}

func single(e strsim.Encoder) func(string) (string, string) {
	return func(s string) (string, string) { return e.Encode(s), "" }
}

func encoders(o Options) []encoder {
	sx := &strsim.SoundexEncoder{MaxLength: o.SoundexLength}
	mp := &strsim.MetaphoneEncoder{MaxLength: o.MetaphoneLength}
	dm := &strsim.DoubleMetaphoneEncoder{MaxLength: o.DoubleMetaphoneLength}
	ny := &strsim.NYSIISEncoder{MaxLength: o.NYSIISLength}

	return []encoder{
		{"soundex", single(sx), sx.Match},
		{"metaphone", single(mp), mp.Match},
		{"doublemetaphone", dm.Encode, dm.Match},
		{"nysiis", single(ny), ny.Match},
	}
}

// try runs f and turns a panic into a message, so one failing metric does
// not hide the others.
func try[T any](f func() T) (v T, panicked string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = fmt.Sprint(r)
		}
	}()

	return f(), ""
}

func handle(req Request) Response {
	prep := func(s string) string {
		if req.Options.IgnoreCase {
			return strings.ToLower(s)
		}
		return s
	}

	switch req.Op {
	case "compare":
		if err := limit("a", req.A, maxCompareRunes); err != nil {
			return fail(err)
		}
		if err := limit("b", req.B, maxCompareRunes); err != nil {
			return fail(err)
		}
		return compare(prep(req.A), prep(req.B), req.Options)

	case "pairs":
		if len(req.Pairs) > maxListLen {
			return fail(fmt.Errorf("at most %d pairs", maxListLen))
		}
		pairs := make([][2]string, len(req.Pairs))
		for i, p := range req.Pairs {
			for k := range p {
				if err := limit(fmt.Sprintf("pair %d", i+1), p[k], maxListRunes); err != nil {
					return fail(err)
				}
				pairs[i][k] = prep(p[k])
			}
		}
		return scorePairs(pairs, req.Options)

	case "rank":
		if len(req.Candidates) > maxListLen {
			return fail(fmt.Errorf("at most %d candidates", maxListLen))
		}
		if err := limit("query", req.Query, maxListRunes); err != nil {
			return fail(err)
		}
		candidates := make([]string, len(req.Candidates))
		for i, c := range req.Candidates {
			if err := limit(fmt.Sprintf("candidate %d", i+1), c, maxListRunes); err != nil {
				return fail(err)
			}
			candidates[i] = prep(c)
		}
		return rank(prep(req.Query), candidates, req)
	}

	return fail(fmt.Errorf("unknown op %q", req.Op))
}

func compare(a, b string, o Options) Response {
	res := Response{OK: true}

	for _, m := range metrics(o) {
		sim, p := try(func() float64 { return m.similarity(a, b) })
		s := Score{Metric: m.name, Similarity: Num(sim), Panic: p}
		if m.distance != nil && p == "" {
			d, p := try(func() int { return m.distance(a, b) })
			if p == "" {
				s.Distance = &d
			}
			s.Panic = p
		}
		res.Scores = append(res.Scores, s)
	}

	for _, e := range encoders(o) {
		c := Code{Encoder: e.name, Match: e.match(a, b)}
		c.A, c.AltA = e.encode(a)
		c.B, c.AltB = e.encode(b)
		res.Codes = append(res.Codes, c)
	}

	return res
}

func scorePairs(pairs [][2]string, o Options) Response {
	res := Response{
		OK:           true,
		Similarities: map[string][]Num{},
		Matches:      map[string][]bool{},
		Panics:       map[string]string{},
	}

	for _, m := range metrics(o) {
		out := make([]Num, len(pairs))
		for i, p := range pairs {
			sim, msg := try(func() float64 { return m.similarity(p[0], p[1]) })
			if msg != "" {
				sim = math.NaN()
				if res.Panics[m.name] == "" {
					res.Panics[m.name] = msg
				}
			}
			out[i] = Num(sim)
		}
		res.Similarities[m.name] = out
	}

	for _, e := range encoders(o) {
		out := make([]bool, len(pairs))
		for i, p := range pairs {
			out[i] = e.match(p[0], p[1])
		}
		res.Matches[e.name] = out
	}

	return res
}

func rank(query string, candidates []string, req Request) Response {
	var m strsim.Metric
	for _, x := range metrics(req.Options) {
		if x.name == req.Metric {
			m = x
		}
	}
	if m == nil {
		return fail(fmt.Errorf("unknown metric %q", req.Metric))
	}

	matches, p := try(func() []strsim.Match {
		if req.TopN > 0 {
			return strsim.FindTopN(query, candidates, req.TopN, m)
		}
		return strsim.FindAboveThreshold(query, candidates, req.Threshold, m)
	})
	if p != "" {
		return fail(fmt.Errorf("panic: %s", p))
	}

	res := Response{OK: true, Ranked: []Ranked{}}
	for _, match := range matches {
		res.Ranked = append(res.Ranked, Ranked{Index: match.Index, Similarity: Num(match.Similarity)})
	}

	return res
}

func limit(what, s string, runes int) error {
	if n := utf8.RuneCountInString(s); n > runes {
		return fmt.Errorf("%s has %d characters; the limit is %d", what, n, runes)
	}

	return nil
}

func fail(err error) Response {
	return Response{Error: err.Error()}
}

// handleJSON is the whole bridge: request JSON in, response JSON out.
func handleJSON(in string) string {
	var req Request
	if err := json.Unmarshal([]byte(in), &req); err != nil {
		return encode(fail(fmt.Errorf("bad request: %w", err)))
	}

	return encode(handle(req))
}

func encode(r Response) string {
	out, err := json.Marshal(r)
	if err != nil {
		out, _ = json.Marshal(fail(err))
	}

	return string(out)
}

// BuildInfo says which strsim release and Go toolchain the binary holds.
type BuildInfo struct {
	Strsim string `json:"strsim"`
	Go     string `json:"go"`
}

func info() BuildInfo {
	bi := BuildInfo{Strsim: "unknown", Go: runtime.Version()}
	if b, ok := debug.ReadBuildInfo(); ok {
		for _, d := range b.Deps {
			if d.Path == "github.com/jcoruiz/strsim" {
				bi.Strsim = d.Version
			}
		}
	}

	return bi
}
