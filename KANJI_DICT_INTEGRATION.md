# Kanji Dict Integration — 4-Script Conversion Layer

VERO の romaji→hiragana 変換に、`kanji_dict` (4種スクリプト漢字辞書) を乗せて
hiragana→kanji / cross-script 変換を実現する。

## データソース

`kanji_dict.sqlite` — 242字 (常用99 / 簡体87 / 繁体56)

| 言語 | バインディング | 状態 |
|------|---------------|------|
| **Rust** | `rusqlite` — `rs/` に直接組み込み | ✅ 推奨 |
| **C#** | `Microsoft.Data.Sqlite` — `cs/` 用 | ⏳ |
| **C** | `sqlite3.h` — C API | ⏳ |

## 統合ポイント

### 1. Hiragana→Kanji 変換

VERO が出力した hiragana 文字列を入力として、`kanji_dict` から候補を引く。

```rust
// 例: "じんこうちのう" → N'じんこうちのう' で onyomi 検索
SELECT char, script, onyomi, meaning_ja
FROM characters
WHERE onyomi LIKE N'%じんこうちのう%'
ORDER BY grade;  -- 常用優先
```

### 2. Cross-Script 変換

concept_id 自己結合で異字体間変換。

```rust
// concept_id ルックアップ (HashMap<int, Vec<(String, String)>>)
// 入力 "国" (joyo) → 出力 "國" (trad), "国" (simp)
```

### 3. 辞書プリロード

起動時に全エントリを `HashMap<concept_id, Vec<Entry>>` に読み込み。
メモリフットプリント: ~100KB (242字), 全常用2136字でも <1MB。

## 実装順

1. `rs/` に `kanji_dict.sqlite` 同梱 + rusqlite 接続
2. `add_dict_entry()` 拡張 — hiragana 読みから漢字候補を自動追加
3. cross-script 変換関数 (`convert_script(text, from, to)`)
4. C# / TypeScript 移植

## 関連

- DB定義: `HERMES/sakura-macros/kanji_dict.sql`
- バックアップ: `sqlite_backup.py`
- GUM連携: GUM IME Bridge 層の静的辞書としても利用可能
