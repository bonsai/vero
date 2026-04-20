package main

import (
	"fmt"
	romaji2text "github.com/bonsai/vero/go/romaji2text"
)

func main() {
	engine := romaji2text.New()

	// Event listener
	engine.On("converted", func(ev romaji2text.TextEvent) {
		fmt.Printf("[converted] %s (conf: %d%%)\n", ev.Text, ev.Confidence)
	})
	engine.On("confirmed", func(ev romaji2text.TextEvent) {
		fmt.Printf("[confirmed] %s\n", ev.Text)
	})

	// Type romaji
	fmt.Println("=== Typing: k-a-i-s-h-a ===")
	engine.OnKey('k')
	engine.OnKey('a')
	engine.OnKey('i')
	engine.OnKey('s')
	engine.OnKey('h')
	engine.OnKey('a')

	// Flush
	ev := engine.Flush()
	fmt.Printf("Result: %s (conf: %d%%, suggestion: %s)\n", ev.Text, ev.Confidence, ev.Suggestion)

	// Fuzzy test
	fmt.Println("\n=== Fuzzy: きんしねっと (partial input) ===")
	engine2 := romaji2text.New()
	engine2.OnKey('k')
	engine2.OnKey('i')
	engine2.OnKey('n')
	engine2.OnKey('s')
	engine2.OnKey('h')
	engine2.OnKey('i')
	ev2 := engine2.Flush()
	fmt.Printf("Result: %s (conf: %d%%)\n", ev2.Text, ev2.Confidence)

	// Commit
	fmt.Println("\n=== Commit test ===")
	engine3 := romaji2text.New()
	engine3.OnKey('a')
	engine3.OnKey('i')
	engine3.OnKey(' ')
	engine3.OnKey('u')
	engine3.OnKey('e')
	engine3.Commit()
	fmt.Printf("Committed: %s\n", engine3.Committed())
}
