// romaji2text.rs — ストリーミング型 ローマ字→テキスト変換エンジン (Rust)
// ASRと同じ仕組み: 文字蓄積 → debounce後に変換 → 結果を順次送信
// 誤字補正(fuzzy)・部分変換対応
//
// Usage:
//   let mut engine = Romaji2Text::new();
//   for ch in "kikai gakushuu".chars() {
//       let ev = engine.on_key(ch);
//       println!("{:?}", ev);
//   }

use std::collections::{HashMap, HashSet};
use std::time::Instant;

// ── イベント ────────────────────────────────────────────────────────────────
#[derive(Debug, Clone)]
pub enum TextEventType { Input, Converted, Confirmed, Correction }

#[derive(Debug, Clone)]
pub struct TextEvent {
    pub r#type: TextEventType,
    pub raw: String,
    pub text: String,
    pub confidence: u8,
    pub suggestion: Option<String>,
}

// ── Romaji Table ────────────────────────────────────────────────────────────
fn build_table() -> Vec<(String, String)> {
    vec![
        ("sha","しゃ"),("shi","し"),("shu","しゅ"),("she","しぇ"),("sho","しょ"),
        ("chi","ち"),("tchi","っち"),("cha","ちゃ"),("chu","ちゅ"),("che","ちぇ"),("cho","ちょ"),
        ("tsu","つ"),("ttsu","っつ"),("dzu","づ"),("dji","ぢ"),
        ("kya","きゃ"),("kyu","きゅ"),("kyo","きょ"),
        ("gya","ぎゃ"),("gyu","ぎゅ"),("gyo","ぎょ"),
        ("sya","しゃ"),("syu","しゅ"),("syo","しょ"),
        ("zya","じゃ"),("zyu","じゅ"),("zyo","じょ"),
        ("jya","じゃ"),("jyu","じゅ"),("jyo","じょ"),
        ("ja","じゃ"),("ji","じ"),("ju","じゅ"),("je","じぇ"),("jo","じょ"),
        ("tya","ちゃ"),("tyu","ちゅ"),("tyo","ちょ"),
        ("nya","にゃ"),("nyu","にゅ"),("nyo","にょ"),
        ("hya","ひゃ"),("hyu","ひゅ"),("hyo","ひょ"),
        ("mya","みゃ"),("myu","みゅ"),("myo","みょ"),
        ("rya","りゃ"),("ryu","りゅ"),("ryo","りょ"),
        ("bya","びゃ"),("byu","びゅ"),("byo","びょ"),
        ("pya","ぴゃ"),("pyu","ぴゅ"),("pyo","ぴょ"),
        ("dya","ぢゃ"),("dyu","ぢゅ"),("dyo","ぢょ"),
        ("fa","ふぁ"),("fi","ふぃ"),("fu","ふ"),("fe","ふぇ"),("fo","ふぉ"),
        ("va","ゔぁ"),("vi","ゔぃ"),("vu","ゔ"),("ve","ゔぇ"),("vo","ゔぉ"),
        ("thi","てぃ"),("tha","てゃ"),("thu","てゅ"),("tho","てょ"),
        ("dhi","でぃ"),("dha","でゃ"),("dhu","でゅ"),("dho","でょ"),
        ("ka","か"),("ki","き"),("ku","く"),("ke","け"),("ko","こ"),
        ("ga","が"),("gi","ぎ"),("gu","ぐ"),("ge","げ"),("go","ご"),
        ("sa","さ"),("si","し"),("su","す"),("se","せ"),("so","そ"),
        ("za","ざ"),("zi","じ"),("zu","ず"),("ze","ぜ"),("zo","ぞ"),
        ("ta","た"),("ti","ち"),("tu","つ"),("te","て"),("to","と"),
        ("da","だ"),("di","ぢ"),("du","づ"),("de","で"),("do","ど"),
        ("na","な"),("ni","に"),("nu","ぬ"),("ne","ね"),("no","の"),
        ("ha","は"),("hi","ひ"),("hu","ふ"),("he","へ"),("ho","ほ"),
        ("ba","ば"),("bi","び"),("bu","ぶ"),("be","べ"),("bo","ぼ"),
        ("pa","ぱ"),("pi","ぴ"),("pu","ぷ"),("pe","ぺ"),("po","ぽ"),
        ("ma","ま"),("mi","み"),("mu","む"),("me","め"),("mo","も"),
        ("ya","や"),("yu","ゆ"),("yo","よ"),
        ("ra","ら"),("ri","り"),("ru","る"),("re","れ"),("ro","ろ"),
        ("wa","わ"),("wi","うぃ"),("we","うぇ"),("wo","を"),
        ("la","ら"),("li","り"),("lu","る"),("le","れ"),("lo","ろ"),
        ("a","あ"),("i","い"),("u","う"),("e","え"),("o","お"),
        ("xa","ぁ"),("xi","ぃ"),("xu","ぅ"),("xe","ぇ"),("xo","ぉ"),
        ("xtu","っ"),("xtsu","っ"),("xya","ゃ"),("xyu","ゅ"),("xyo","ょ"),
        ("ltu","っ"),("ltsu","っ"),
    ].into_iter().map(|(a,b)| (a.into(), b.into())).collect()
}

fn build_fuzzy_map() -> HashMap<String, String> {
    [
        ("chii","chi"),("tssu","ttsu"),("sya","sha"),("syu","shu"),("syo","sho"),
        ("zya","ja"),("zyu","ju"),("zyo","jo"),
        ("tya","cha"),("tyu","chu"),("tyo","cho"),
        ("whi","wi"),("v","b"),
    ].into_iter().map(|(a,b)| (a.into(), b.into())).collect()
}

// Minimal builtin dictionary
fn build_dict() -> HashSet<String> {
    [
        "じんこうちのう","きかいがくしゅう","あい","えーあい","でぷろい",
        "りぽじとり","こみっと","えーじぇんと","あーきてくちゃ",
        "とうきょう","にほん","かいしゃ","しごと","かいぎ",
        "じょうほう","しすてむ","うぇぶ","あぷり",
        "せかい","じかん","へんかん","せってい",
        "でざいんぱたーん","りふぁくたりんぐ","ぱいぷらいん",
        "ふろんとえんど","ばっくえんど",
    ].into_iter().map(String::from).collect()
}

// ── Vowels+Y for "n" handling ───────────────────────────────────────────────
fn is_vowel_or_y(c: char) -> bool {
    matches!(c, 'a'|'e'|'i'|'o'|'u'|'y'|'A'|'E'|'I'|'O'|'U'|'Y')
}

// ── Engine ──────────────────────────────────────────────────────────────────
pub struct Romaji2Text {
    table: Vec<(String, String)>,
    fuzzy: HashMap<String, String>,
    dict: HashSet<String>,
    buffer: Vec<char>,
    committed: String,
}

impl Romaji2Text {
    pub fn new() -> Self {
        Self {
            table: build_table(),
            fuzzy: build_fuzzy_map(),
            dict: build_dict(),
            buffer: Vec::new(),
            committed: String::new(),
        }
    }

    pub fn add_dict_entry(&mut self, yomi: &str) {
        self.dict.insert(yomi.to_string());
    }

    // ── キーストローク受信 ────────────────────────────────────────────────
    pub fn on_key(&mut self, ch: char) -> TextEvent {
        match ch {
            ' '  => self.flush(),
            '\x08' | '\x7f' => {
                if !self.buffer.is_empty() { self.buffer.pop(); }
                TextEvent {
                    r#type: TextEventType::Input,
                    raw: self.buffer.iter().collect(),
                    text: self.committed.clone(),
                    confidence: 0,
                    suggestion: None,
                }
            }
            '\r' | '\n' => self.commit(),
            c if c.is_ascii_alphabetic() => {
                let lower = c.to_ascii_lowercase();
                if self.buffer.len() < 500 {
                    self.buffer.push(lower);
                    TextEvent {
                        r#type: TextEventType::Input,
                        raw: self.buffer.iter().collect(),
                        text: self.preview(),
                        confidence: 0,
                        suggestion: None,
                    }
                } else {
                    self.make_input_event()
                }
            }
            _ => self.make_input_event(),
        }
    }

    // ── フラッシュ → 変換 ─────────────────────────────────────────────────
    pub fn flush(&mut self) -> TextEvent {
        if self.buffer.is_empty() {
            return TextEvent {
                r#type: TextEventType::Input,
                raw: String::new(),
                text: self.committed.clone(),
                confidence: 0,
                suggestion: None,
            };
        }

        let raw: String = self.buffer.iter().collect();
        let tokens: Vec<&str> = raw.split_whitespace().collect();

        let mut converted = String::new();
        let mut total_conf: i32 = 0;
        let mut correction: Option<String> = None;

        for &tok in &tokens {
            let fixed_tok = self.fuzzy.get(tok)
                .cloned()
                .unwrap_or_else(|| tok.to_string());

            if correction.is_none() && fixed_tok != tok {
                correction = Some(format!("'{}' → '{}'", tok, fixed_tok));
            }

            if self.dict.contains(fixed_tok.as_str()) {
                converted.push_str(fixed_tok.as_str());
                total_conf += 95;
                continue;
            }

            let prefix = self.dict.iter()
                .find(|k| k.starts_with(fixed_tok) && *k != fixed_tok)
                .cloned();
            if let Some(p) = prefix {
                converted.push_str(&p);
                total_conf += 60;
                continue;
            }

            let hira = self.convert_token(&fixed_tok);
            converted.push_str(&hira);
            let tok_conf = if hira != fixed_tok { 75 } else { 25 };
            total_conf += tok_conf as i32;
        }

        let conf = if !tokens.is_empty() {
            (total_conf as f32 / tokens.len() as f32) as u8
        } else { 0 };

        TextEvent {
            r#type: TextEventType::Converted,
            raw,
            text: converted,
            confidence: conf,
            suggestion: correction,
        }
    }

    // ── 確定 ──────────────────────────────────────────────────────────────
    pub fn commit(&mut self) -> TextEvent {
        let ev = self.flush();
        self.committed.push_str(&ev.text);
        self.buffer.clear();
        TextEvent {
            r#type: TextEventType::Confirmed,
            raw: String::new(),
            text: self.committed.clone(),
            confidence: ev.confidence,
            suggestion: None,
        }
    }

    pub fn committed(&self) -> &str { &self.committed }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.committed.clear();
    }

    // ── プレビュー ────────────────────────────────────────────────────────
    fn preview(&self) -> String {
        if self.buffer.is_empty() { return self.committed.clone(); }
        let raw: String = self.buffer.iter().collect();
        let tokens: Vec<&str> = raw.split_whitespace().collect();
        let mut out = self.committed.clone();

        for &tok in &tokens {
            let fixed = self.fuzzy.get(tok).map(|s| s.as_str()).unwrap_or(tok);
            if self.dict.contains(fixed) {
                out.push_str(fixed);
                continue;
            }
            let prefix = self.dict.iter()
                .find(|k| k.starts_with(fixed) && *k != fixed)
                .cloned();
            if let Some(p) = prefix {
                out.push_str(&p);
                continue;
            }
            out.push_str(&self.convert_token(fixed));
        }
        out
    }

    fn make_input_event(&self) -> TextEvent {
        TextEvent {
            r#type: TextEventType::Input,
            raw: self.buffer.iter().collect(),
            text: self.committed.clone(),
            confidence: 0,
            suggestion: None,
        }
    }

    // ── Romaji → Hiragana (token単位) ─────────────────────────────────────
    fn convert_token(&self, src: &str) -> String {
        let src = src.to_ascii_lowercase();
        let mut out = String::new();
        let chars: Vec<char> = src.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            // 促音
            if i + 1 < len && chars[i] != 'n' && chars[i] == chars[i + 1] && !"aeiou".contains(chars[i]) {
                out.push('っ'); i += 1; continue;
            }
            // n + 非母音 → ん
            if chars[i] == 'n' && (i + 1 >= len || !is_vowel_or_y(chars[i + 1])) {
                out.push('ん'); i += 1; continue;
            }
            // テーブル照合
            let mut matched = false;
            for (r, h) in &self.table {
                if len - i >= r.len() && &src[i..i + r.len()] == r.as_str() {
                    out.push_str(h); i += r.len(); matched = true; break;
                }
            }
            if !matched {
                out.push(chars[i]); i += 1;
            }
        }
        out
    }
}

// ── ASR-style streaming loop with debounce ──────────────────────────────────
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

pub fn stream_loop(
    key_rx: mpsc::Receiver<char>,
    mut engine: Romaji2Text,
    debounce_ms: u64,
    callback: impl Fn(TextEvent) + Send + 'static,
) {
    let debounce = Duration::from_millis(debounce_ms);
    let mut last_input = Instant::now() - debounce;

    thread::spawn(move || {
        loop {
            let elapsed = last_input.elapsed();

            if elapsed >= debounce {
                // タイムアウト → フラッシュ
                let ev = engine.flush();
                if !ev.text.is_empty() {
                    callback(ev);
                }
                last_input = Instant::now();
            }

            // キー受信待ち (短めのtimeoutでポーリング)
            if let Ok(ch) = key_rx.recv_timeout(Duration::from_millis(50)) {
                let ev = engine.on_key(ch);
                callback(ev);
                last_input = Instant::now();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_romaji_to_hiragana() {
        let mut engine = Romaji2Text::new();
        let ev = engine.on_key('k');
        assert_eq!(ev.r#type, TextEventType::Input);

        for ch in "kai".chars() { engine.on_key(ch); }
        let ev = engine.on_key(' ');
        assert!(ev.text.contains("か"));
    }

    #[test]
    fn test_dict_lookup() {
        let mut engine = Romaji2Text::new();
        for ch in "じんこうちのう".chars() { engine.on_key(ch); }
        let ev = engine.commit();
        assert_eq!(ev.text, "じんこうちのう"); // 辞書キーなのでそのまま
    }

    #[test]
    fn test_fuzzy_correction() {
        let mut engine = Romaji2Text::new();
        for ch in "sya".chars() { engine.on_key(ch); }
        let ev = engine.flush();
        assert!(ev.suggestion.is_some());
    }
}
