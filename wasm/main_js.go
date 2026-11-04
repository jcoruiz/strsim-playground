//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
)

// main exposes the bridge to JavaScript and parks. The page calls
// strsimRun(requestJSON) from a Web Worker, so a long list never blocks the
// UI thread.
func main() {
	js.Global().Set("strsimRun", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return `{"ok":false,"error":"strsimRun expects one JSON string"}`
		}
		return handleJSON(args[0].String())
	}))
	js.Global().Set("strsimInfo", js.FuncOf(func(js.Value, []js.Value) any {
		out, _ := json.Marshal(info())
		return string(out)
	}))
	select {}
}
