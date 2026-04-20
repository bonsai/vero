# オープンソースIMEプロジェクトリサーチ

> bonsaiプロジェクト（GUM/IMA/azooKeyなど）に類似したオープンソースIMEの調査まとめ

---

## 1. 主要な日本語IME（基盤・本格派）

| プロジェクト | 特徴 | 類似点 | GitHub |
|--------------|------|--------|--------|
| **Mozc** (Google) | 多プラットフォーム（Windows/macOS/Linux/Android）対応の本格日本語IME。Google日本語入力のOSS版。辞書・変換精度が高い。 | 標準的な高精度日本語IMEの王道。IMAのような「本格IME」の参考に最適。 | [google/mozc](https://github.com/google/mozc) |
| **mzimeja** (katahiromz) | Windows向けIME。**Vibrato**（高性能形態素解析）で高速・高精度かな漢変換。 | 現代的なエンジン強化。IMAの「意味理解」寄りアプローチに近い。 | [katahiromz/mzimeja](https://github.com/katahiromz/mzimeja) |
| **mikan** | mecab（形態素解析）駆動の日本語入力メソッド。 | 軽量で辞書ベース変換。GUMのような補助レイヤーの参考。 | [mojyack/mikan](https://github.com/mojyack/mikan) |
| **matsuba** | Rust製軽量日本語IME（X Window向け）。かな/カタカナ/漢字変換 + データベース分離。 | Rust/WASM志向のIMAに技術的に近い。モジュール性が高い。 | [MrPicklePinosaur/matsuba](https://github.com/MrPicklePinosaur/matsuba) |

---

## 2. 特殊・実験的なIME（bonsaiに近い思想）

| プロジェクト | 特徴 | 類似点 |
|--------------|------|--------|
| **nekotsume IME** | Firefox拡張として動作する**完全ローカル・プライバシー重視**日本語IME。ブラウザ内テキスト入力にオーバーレイで変換。軽量でオフライン完結。 | GUMのような「薄く寄り添う」レイヤーに非常に近い |
| **JiBoard** | .NET製ポータブル日本語IME。シンプルでインストール容易。 | 軽量・ポータブル志向 |
| **IgoIME** | Ajax由来の軽量エンジン | nekotsumeの元 |

---

## 3. iOS/キーボード寄り（azooKey類似）

- **azooKey**自体が非常に先進的（自前変換エンジン + SwiftUI + ライブ変換 + カスタムキー）
- 類似として**KeyboardKit**（Swift/SwiftUIでカスタムiOSキーボード作成フレームワーク）があるが、IMEエンジン自体は別途必要

---

## 4. AI/RAG統合系（GUMに近い未来志向）

bonsaiの**GUM（RAGパーソナライズ）**に直接的に近いものはまだ少ない：

- 日本語特化RAGプロジェクト（Llama-Index + 多言語Embedding + Elyzaなど）
- LLM-jpなどの日本語LLMコミュニティで、IMEへのパーソナライズ適用が今後増えそう
- ブラウザ/ローカルLLMを組み合わせた実験的な入力補完ツールは散見されるが、完成形のOSS IMEはbonsaiプロジェクトが最先端クラス

---

## 全体の傾向まとめ

| カテゴリ | 代表 | 特徴 |
|----------|------|------|
| **伝統派** | Mozc | 圧倒的に完成度高く、基盤として最も参考になる |
| **現代派** | matsuba, mzimeja | Rust/Zigや形態素解析強化（Vibrato/mecab）が活発 |
| **実験派** | nekotsume | ローカル・プライバシー重視 |

---

## bonsaiの独自性

> **RAG的な個人記憶** + **Post-Detection** + **音声連携（vemo）** + **iOS完成UI**の組み合わせは、他にほとんど見当たらない独自路線

- **「完璧を目指さない優しさ」**と**「ローカル透明性」**が差別化ポイント
- パーソナライズ + ローカルLLM + 美しいUI は他プロジェクトにない強み

---

*調査日: 2026-04-20 | bonsai/vero*
