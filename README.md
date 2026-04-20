# VERO — Streaming Romaji→Text Engine

ASR-style romaji-to-Japanese-text converter. Accumulates keystrokes, debounces, then auto-converts with dictionary lookup + fuzzy typo correction.

## Structure

```
VERO/
├── rs/  romaji2text.rs   — Rust  (mpsc streaming loop, tests)
├── cs/  Romaji2Text.cs   — C#    (.NET 8, Windows Forms ready)
└── ts/  romaji2text.ts   — TypeScript (browser + Node)
```

## How It Works

```
keystroke → buffer → [debounce 350ms] → auto-convert → emit TextEvent
```

Like speech recognition: characters stream in, conversion fires after input pauses.

### Pipeline
1. **Language detection** — romaji / ja / en / mixed
2. **Fuzzy correction** — `sya→sha`, `tya→cha`, `v→b`, etc.
3. **Dictionary lookup** — ~400 built-in entries (SKK-style)
4. **Romaji→Hiragana** — longest-match table conversion
5. **Prefix fallback** — partial match when exact entry missing

### Controls
| Key | Action |
|---|---|
| a-z | Accumulate romaji |
| Space | Flush (force convert + separator) |
| Enter | Commit (finalize) |
| Esc | Reset |
| Backspace | Delete last char |

## Quick Start

### Rust
```bash
cd rs
# Add to your Cargo.toml: just copy romaji2text.rs into src/
cargo test
```

### C# (.NET 8)
```bash
cd cs
# Drop Romaji2Text.cs into any UseWindowsForms project
# Requires: BuiltinDict.cs, RomajiConverter.cs (same dir)
```

### TypeScript (browser)
```html
<script type="module">
  import { Romaji2Text } from "./romaji2text.ts";
  const engine = new Romaji2Text();
  engine.on("converted", ev => console.log(ev.text));
  engine.onKey("k"); engine.onKey("a"); engine.onKey("i");
</script>
```

### TypeScript (Node)
```bash
npx tsc romaji2text.ts --module nodenext
const { Romaji2Text } = require("./romaji2text.js");
```

## License

MIT
