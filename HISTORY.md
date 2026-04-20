# HISTORY.md — AI IME / vero

> ローマ字→日本語変換エンジン。多言語で書き、同じ心臓を共有する。

---

## 起源

- **発端**: wanakana.js を使ったローマ字変換
- **転機**: 「AI IME」としてクリップボード連携IMEをNode.jsで構築
- **展開**: TypeScript → C# → Rust → Go → Lisp と言語横断へ

---

## 言語別実装

### Node.js (`ts/node/`)
- `ai_ime.mjs` — クリップボード監視型IME (ESM)
- `ai_ime_v2.mjs` — kuromoji + wanakana + Claude APIフォールバック
- `custom_dict.json` — ユーザー辞書

### Browser (`ts/browser/`)
- `romaji2text.ts` — TypeScript純正ストリーミングエンジン
- `romaji2text.mjs` — ESM変換版
- `romaji2text_demo.html` — デモ
- `test.html` — テスト

### C# (`cs/`)
- `Romaji2Text.cs` — ストリーミングエンジン
- `RomajiConverter.cs` — ローマ字変換テーブル
- `BuiltinDict.cs` — 組み込み辞書
- `AiIme.csproj` — プロジェクト定義

### Rust (`rs/`)
- `romaji2text.rs` — Rust実装

### Go (`go/romaji2text/`)
- `romaji2text.go` — ストリーミングエンジン + あいまいファイル検索
- `cmd/main.go` — テスト
- `go.mod` — モジュール定義

### Common Lisp (`lisp/`)
- `romaji2text.lisp` — ストリーミングエンジン + あいまい検索
- `test-romaji2text.lisp` — デモ＆テスト

### AutoHotkey (`hk/`)
- `ai_ime.ahk` — AHK版IME

---

## 進化のポイント

### v1 — wanakana依存
- Node.js + wanakana でローマ字変換
- クリップボードベースのIME

### v2 — ローカル辞書強化
- kuromoji + built-in SKT辞書
- カスタム辞書システム
- Claude APIフォールバック

### v3 — 多言語展開
- TypeScript純正エンジン (ブラウザ対応)
- C# (.NET Desktop IME)
- Rust (パフォーマンス)
- Go (あいまい検索統合)
- Common Lisp (関数型アプローチ)

### v4 — あいまいファイル検索
- 全言語でLevenshtein距離 + prefix/suffixマッチ
- 部分入力で即変換候補提示

---

## 共通アーキテクチャ

```
[input] → romaji buffer → debounce → [pipeline]
                                          ↓
                          ① custom dict (exact)
                          ② builtin dict (exact/prefix)
                          ③ fuzzy search (Levenshtein)
                          ④ romaji→hiragana (table)
                                          ↓
                          TextEvent { type, text, confidence, suggestion }
```

### TextEvent
| field | type | desc |
|-------|------|------|
| `type` | keyword | `input` / `converted` / `confirmed` / `correction` |
| `raw` | string | 生入力バッファ |
| `text` | string | 変換後テキスト |
| `confidence` | int | 確信度 0-100 |
| `suggestion` | string|null | 誤字補正ヒント |

---

## ファイル構造

```
vero/
├── ts/
│   ├── node/          # Node.js IME
│   ├── browser/       # TS/ESM + デモ
│   ├── custom_dict.json
│   └── node_modules/
├── cs/                # C# (.NET)
├── rs/                # Rust
├── go/romaji2text/    # Go
│   ├── romaji2text.go
│   ├── cmd/main.go
│   └── go.mod
├── lisp/              # Common Lisp
│   ├── romaji2text.lisp
│   └── test-romaji2text.lisp
└── hk/                # AutoHotkey
```

---

*制定: 2026-04-20 | bonsai/vero*
