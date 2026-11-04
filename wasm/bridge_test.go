package main

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

var defaults = Options{
	InsertCost: 1, DeleteCost: 1, ReplaceCost: 1,
	BoostThreshold: 0.7, PrefixSize: 4,
	NgramSize:     2,
	SoundexLength: 4, MetaphoneLength: 4, DoubleMetaphoneLength: 4, NYSIISLength: 6,
}

// response is Response as the page reads it, with numbers as raw JSON.
type response struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error"`
	Scores []struct {
		Metric     string          `json:"metric"`
		Similarity json.RawMessage `json:"similarity"`
		Distance   *int            `json:"distance"`
		Panic      string          `json:"panic"`
	} `json:"scores"`
	Codes        []Code                       `json:"codes"`
	Similarities map[string][]json.RawMessage `json:"similarities"`
	Matches      map[string][]bool            `json:"matches"`
	Panics       map[string]string            `json:"panics"`
	Ranked       []struct {
		Index int `json:"index"`
	} `json:"ranked"`
}

func call(t *testing.T, req Request) response {
	t.Helper()
	in, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var res response
	if err := json.Unmarshal([]byte(handleJSON(string(in))), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

func TestCompare(t *testing.T) {
	res := call(t, Request{Op: "compare", A: "kitten", B: "sitting", Options: defaults})
	if !res.OK {
		t.Fatal(res.Error)
	}
	if len(res.Scores) != 11 || len(res.Codes) != 4 {
		t.Fatalf("got %d scores and %d codes, want 11 and 4", len(res.Scores), len(res.Codes))
	}

	want := map[string]int{"levenshtein": 3, "osa": 3, "damerau": 3, "lcs": 5}
	for _, s := range res.Scores {
		if d, ok := want[s.Metric]; ok && (s.Distance == nil || *s.Distance != d) {
			t.Errorf("%s distance = %v, want %d", s.Metric, s.Distance, d)
		}
		if s.Metric == "hamming" && (s.Distance != nil || !strings.Contains(s.Panic, "length")) {
			t.Errorf("hamming on unequal lengths: distance %v, panic %q", s.Distance, s.Panic)
		}
		if s.Metric == "jaro" && s.Distance != nil {
			t.Errorf("jaro has no distance")
		}
	}
}

func TestCompareCodes(t *testing.T) {
	res := call(t, Request{Op: "compare", A: "Robert", B: "Rupert", Options: defaults})
	for _, c := range res.Codes {
		if c.Encoder == "soundex" && (c.A != "R163" || c.B != "R163" || !c.Match) {
			t.Errorf("soundex: %+v", c)
		}
	}
}

func TestIgnoreCase(t *testing.T) {
	opts := defaults
	opts.IgnoreCase = true
	got := call(t, Request{Op: "compare", A: "MARTHA", B: "Martha", Options: opts})
	want := call(t, Request{Op: "compare", A: "martha", B: "martha", Options: defaults})
	for i, s := range got.Scores {
		if string(s.Similarity) != string(want.Scores[i].Similarity) {
			t.Errorf("%s = %s, want %s", s.Metric, s.Similarity, want.Scores[i].Similarity)
		}
	}
}

func TestPairs(t *testing.T) {
	res := call(t, Request{Op: "pairs", Pairs: [][2]string{{"Smith", "Smyth"}, {"abc", "abcd"}}, Options: defaults})
	if !res.OK {
		t.Fatal(res.Error)
	}
	for _, name := range []string{"levenshtein", "jarowinkler", "overlap"} {
		if len(res.Similarities[name]) != 2 {
			t.Errorf("%s: %d values", name, len(res.Similarities[name]))
		}
	}
	if m := res.Matches["soundex"]; len(m) != 2 || !m[0] {
		t.Errorf("soundex matches = %v", m)
	}
	if string(res.Similarities["hamming"][1]) != "0" {
		t.Errorf("hamming on unequal lengths = %s, want 0", res.Similarities["hamming"][1])
	}
}

func TestRankKeepsIndexes(t *testing.T) {
	candidates := []string{"python", "golang", "gopher", "gold"}
	res := call(t, Request{Op: "rank", Query: "goland", Candidates: candidates, Metric: "jarowinkler", TopN: 2, Options: defaults})
	if !res.OK || len(res.Ranked) != 2 || res.Ranked[0].Index != 1 {
		t.Fatalf("ranked = %+v (%s)", res.Ranked, res.Error)
	}

	res = call(t, Request{Op: "rank", Query: "goland", Candidates: candidates, Metric: "levenshtein", Threshold: 2, Options: defaults})
	if !res.OK || len(res.Ranked) != 0 {
		t.Fatalf("threshold above 1 ranked %+v", res.Ranked)
	}
}

func TestLimits(t *testing.T) {
	long := strings.Repeat("ñ", maxListRunes+1)
	for _, req := range []Request{
		{Op: "compare", A: strings.Repeat("a", maxCompareRunes+1)},
		{Op: "pairs", Pairs: [][2]string{{"a", long}}},
		{Op: "rank", Query: "a", Candidates: []string{long}, Metric: "jaro"},
		{Op: "rank", Query: "a", Candidates: []string{"a"}, Metric: "nope"},
		{Op: "nope"},
	} {
		if res := call(t, req); res.OK || res.Error == "" {
			t.Errorf("%s: want an error", req.Op)
		}
	}
	if !strings.Contains(handleJSON("{"), "bad request") {
		t.Error("malformed JSON should be a bad request")
	}
}

func TestNum(t *testing.T) {
	for f, want := range map[float64]string{
		0.5:          "0.5",
		1:            "1",
		1e-7:         "1e-07",
		math.NaN():   `"NaN"`,
		math.Inf(1):  `"+Inf"`,
		math.Inf(-1): `"-Inf"`,
	} {
		out, err := json.Marshal(Num(f))
		if err != nil || string(out) != want {
			t.Errorf("Num(%v) = %s, %v; want %s", f, out, err, want)
		}
	}
}

func TestInfo(t *testing.T) {
	if info().Go == "" {
		t.Error("missing Go version")
	}
}
