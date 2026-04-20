// romaji2text.mjs — ストリーミング型 ローマ字→テキスト変換エンジン (ESM/Node)
// ASRと同じ仕組み: 文字蓄積 → debounce後に変換 → 結果を順次送信
// 誤字補正(fuzzy)・部分変換・カスタム辞書対応
//
// Usage (Node):
//   import { Romaji2Text } from './romaji2text.mjs';
//   const engine = new Romaji2Text();
//   engine.on("converted", (ev) => console.log(ev.text));
//   engine.onKey("k"); engine.onKey("a"); engine.onKey("i");

// ── Romaji Table ────────────────────────────────────────────────────────────
const TABLE = [
  ["sha","しゃ"],["shi","し"],["shu","しゅ"],["she","しぇ"],["sho","しょ"],
  ["chi","ち"],["tchi","っち"],["cha","ちゃ"],["chu","ちゅ"],["che","ちぇ"],["cho","ちょ"],
  ["tsu","つ"],["ttsu","っつ"],["dzu","づ"],["dji","ぢ"],
  ["kya","きゃ"],["kyu","きゅ"],["kyo","きょ"],
  ["gya","ぎゃ"],["gyu","ぎゅ"],["gyo","ぎょ"],
  ["sya","しゃ"],["syu","しゅ"],["syo","しょ"],
  ["zya","じゃ"],["zyu","じゅ"],["zyo","じょ"],
  ["jya","じゃ"],["jyu","じゅ"],["jyo","じょ"],
  ["ja","じゃ"],["ji","じ"],["ju","じゅ"],["je","じぇ"],["jo","じょ"],
  ["tya","ちゃ"],["tyu","ちゅ"],["tyo","ちょ"],
  ["nya","にゃ"],["nyu","にゅ"],["nyo","にょ"],
  ["hya","ひゃ"],["hyu","ひゅ"],["hyo","ひょ"],
  ["mya","みゃ"],["myu","みゅ"],["myo","みょ"],
  ["rya","りゃ"],["ryu","りゅ"],["ryo","りょ"],
  ["bya","びゃ"],["byu","びゅ"],["byo","びょ"],
  ["pya","ぴゃ"],["pyu","ぴゅ"],["pyo","ぴょ"],
  ["dya","ぢゃ"],["dyu","ぢゅ"],["dyo","ぢょ"],
  ["fa","ふぁ"],["fi","ふぃ"],["fu","ふ"],["fe","ふぇ"],["fo","ふぉ"],
  ["va","ゔぁ"],["vi","ゔぃ"],["vu","ゔ"],["ve","ゔぇ"],["vo","ゔぉ"],
  ["thi","てぃ"],["tha","てゃ"],["thu","てゅ"],["tho","てょ"],
  ["dhi","でぃ"],["dha","でゃ"],["dhu","でゅ"],["dho","でょ"],
  ["ka","か"],["ki","き"],["ku","く"],["ke","け"],["ko","こ"],
  ["ga","が"],["gi","ぎ"],["gu","ぐ"],["ge","げ"],["go","ご"],
  ["sa","さ"],["si","し"],["su","す"],["se","せ"],["so","そ"],
  ["za","ざ"],["zi","じ"],["zu","ず"],["ze","ぜ"],["zo","ぞ"],
  ["ta","た"],["ti","ち"],["tu","つ"],["te","て"],["to","と"],
  ["da","だ"],["di","ぢ"],["du","づ"],["de","で"],["do","ど"],
  ["na","な"],["ni","に"],["nu","ぬ"],["ne","ね"],["no","の"],
  ["ha","は"],["hi","ひ"],["hu","ふ"],["he","へ"],["ho","ほ"],
  ["ba","ば"],["bi","び"],["bu","ぶ"],["be","べ"],["bo","ぼ"],
  ["pa","ぱ"],["pi","ぴ"],["pu","ぷ"],["pe","ぺ"],["po","ぽ"],
  ["ma","ま"],["mi","み"],["mu","む"],["me","め"],["mo","も"],
  ["ya","や"],["yu","ゆ"],["yo","よ"],
  ["ra","ら"],["ri","り"],["ru","る"],["re","れ"],["ro","ろ"],
  ["wa","わ"],["wi","うぃ"],["we","うぇ"],["wo","を"],
  ["la","ら"],["li","り"],["lu","る"],["le","れ"],["lo","ろ"],
  ["a","あ"],["i","い"],["u","う"],["e","え"],["o","お"],
  ["xa","ぁ"],["xi","ぃ"],["xu","ぅ"],["xe","ぇ"],["xo","ぉ"],
  ["xtu","っ"],["xtsu","っ"],["xya","ゃ"],["xyu","ゅ"],["xyo","ょ"],
  ["ltu","っ"],["ltsu","っ"],
];

const VOWELS_Y = new Set("aeiouy");

// ── Fuzzy Correction Map ────────────────────────────────────────────────────
const FUZZY_MAP = {
  chii: "chi", tssu: "ttsu",
  sya: "sha", syu: "shu", syo: "sho",
  zya: "ja",  zyu: "ju",  zyo: "jo",
  tya: "cha", tyu: "chu", tyo: "cho",
  whi: "wi",  v: "b",
  ltu: "っ", ltsu: "っ",
};

// ── Builtin Dictionary ──────────────────────────────────────────────────────
const BUILTIN_DICT = new Set([
  "じんこうちのう","きかいがくしゅう","せいせいえーあい","えーあい",
  "くらうど","さーばー","でーたべーす","あぴー",
  "ふれーむわーく","らいぶらりー","べくとるけんさく","えんべでぃんぐ",
  "りあくと","のーどじぇいえす","たいぷすくりぷと","ぱいそん",
  "でぷろい","りぽじとり","こみっと","ぷるりくえすと",
  "えーじぇんと","あーきてくちゃ","でざいんぱたーん",
  "りふぁくたりんぐ","ぱいぷらいん","どっかー","くばねてす",
  "せきゅりてぃ","とーくん","ふろんとえんど","ばっくえんど",
  "すけーらびりてぃ",
  "よんで","つんどく","こんみゃく","ちかとし",
  "きんし","きんしねっと","はっこうぶんめい","ねんきん",
  "ねんきんこんぴゅーた",
  "らくご","でぃすとぴあ","えすえふ",
  "とうきょう","にほん","かいしゃ","しごと","かいぎ",
  "しりょう","ほうこく","れんらく","けんとう","かくにん",
  "じょうほう","でーた","しすてむ","うぇぶ","あぷり",
  "かいとう","しつもん","ないよう","せかい","じかん",
  "にゅうりょく","しゅつりょく","へんかん","せってい",
]);

// ── Engine ──────────────────────────────────────────────────────────────────
export class Romaji2Text {
  buffer = [];
  committed = "";
  dict = new Set(BUILTIN_DICT);
  listeners = new Map();
  debounceTimer = null;
  debounceMs = 350;

  // ── イベントリスナ ──────────────────────────────────────────────────────
  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }

  off(type, cb) {
    const arr = this.listeners.get(type);
    if (arr) this.listeners.set(type, arr.filter(c => c !== cb));
  }

  emit(ev) {
    const cbs = this.listeners.get(ev.type) ?? [];
    cbs.forEach(cb => cb(ev));
    const all = this.listeners.get("*") ?? [];
    all.forEach(cb => cb(ev));
  }

  // ── キーストローク受信 ──────────────────────────────────────────────────
  onKey(ch) {
    let c;
    if (typeof ch === "string") {
      c = ch;
    } else {
      // KeyboardEvent
      if (ch.key === " ") c = " ";
      else if (ch.key === "Backspace") c = "\b";
      else if (ch.key === "Enter") c = "\r";
      else if (ch.key.length === 1) c = ch.key;
      else return this.makeInputEvent();
    }

    if (c === " ") {
      const ev = this.flush();
      this.buffer.push(" ");
      this.scheduleDebounce();
      return ev;
    }

    if (c === "\b" || c === "\x7f") {
      this.buffer.pop();
      this.resetDebounce();
      return this.makeInputEvent();
    }

    if (c === "\r" || c === "\n") {
      this.stopDebounce();
      return this.commit();
    }

    const lower = c.toLowerCase();
    if (lower >= "a" && lower <= "z") {
      if (this.buffer.length < 500) {
        this.buffer.push(lower);
        this.scheduleDebounce();
        return this.makeInputEvent();
      }
    }

    return this.makeInputEvent();
  }

  // ── Debounce (ASR-style: 入力停止後に自動変換) ──────────────────────────
  scheduleDebounce() {
    this.stopDebounce();
    this.debounceTimer = setTimeout(() => {
      if (this.buffer.length > 0) {
        const ev = this.flush();
        this.emit(ev);
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  resetDebounce() {
    this.stopDebounce();
    if (this.buffer.length > 0) this.scheduleDebounce();
  }

  stopDebounce() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ── フラッシュ → 変換 ───────────────────────────────────────────────────
  flush() {
    if (this.buffer.length === 0) {
      return { type: "input", raw: "", text: this.committed, confidence: 0, suggestion: null };
    }

    const raw = this.buffer.join("");
    const tokens = raw.split(/\s+/).filter(Boolean);

    let converted = "";
    let totalConf = 0;
    let suggestion = null;

    for (const tok of tokens) {
      let fixedTok = FUZZY_MAP[tok] ?? tok;
      if (suggestion === null && fixedTok !== tok) {
        suggestion = `'${tok}' → '${fixedTok}'`;
      }

      if (this.dict.has(fixedTok)) {
        converted += fixedTok;
        totalConf += 95;
        continue;
      }

      const prefix = [...this.dict].find(k => k.startsWith(fixedTok) && k !== fixedTok);
      if (prefix) {
        converted += prefix;
        totalConf += 60;
        continue;
      }

      const hira = this.convertToken(fixedTok);
      converted += hira;
      const tokConf = hira !== fixedTok ? 75 : 25;
      totalConf += tokConf;

      if (tokConf < 50 && suggestion === null) {
        suggestion = `未登録: '${fixedTok}' → '${hira}'`;
      }
    }

    const conf = tokens.length > 0 ? Math.round(totalConf / tokens.length) : 0;

    return { type: "converted", raw, text: converted, confidence: conf, suggestion };
  }

  // ── 確定 ────────────────────────────────────────────────────────────────
  commit() {
    const ev = this.flush();
    this.committed += ev.text;
    this.buffer = [];
    return { type: "confirmed", raw: "", text: this.committed, confidence: ev.confidence, suggestion: null };
  }

  getCommitted() { return this.committed; }

  // ── プレビュー ──────────────────────────────────────────────────────────
  preview() {
    if (this.buffer.length === 0) return this.committed;
    const raw = this.buffer.join("");
    const tokens = raw.split(/\s+/).filter(Boolean);
    let out = this.committed;

    for (const tok of tokens) {
      const fixed = FUZZY_MAP[tok] ?? tok;
      if (this.dict.has(fixed)) { out += fixed; continue; }
      const prefix = [...this.dict].find(k => k.startsWith(fixed) && k !== fixed);
      if (prefix) { out += prefix; continue; }
      out += this.convertToken(fixed);
    }
    return out;
  }

  // ── カスタム辞書 ────────────────────────────────────────────────────────
  addDictEntry(yomi) { this.dict.add(yomi); }

  // ── リセット ────────────────────────────────────────────────────────────
  reset() {
    this.buffer = [];
    this.committed = "";
    this.stopDebounce();
  }

  // ── プライベート ────────────────────────────────────────────────────────
  makeInputEvent() {
    return {
      type: "input",
      raw: this.buffer.join(""),
      text: this.preview(),
      confidence: 0,
      suggestion: null,
    };
  }

  // ── Romaji → Hiragana ───────────────────────────────────────────────────
  convertToken(src) {
    src = src.toLowerCase();
    let out = "";
    let i = 0;

    while (i < src.length) {
      // 促音: 子音連続
      if (i + 1 < src.length && src[i] !== "n" && src[i] === src[i + 1] && !"aeiou".includes(src[i])) {
        out += "っ"; i++; continue;
      }
      // n + 非母音 → ん
      if (src[i] === "n" && (i + 1 >= src.length || !VOWELS_Y.has(src[i + 1]))) {
        out += "ん"; i++; continue;
      }
      // テーブル照合
      let matched = false;
      for (const [r, h] of TABLE) {
        if (src.length - i >= r.length && src.substring(i, i + r.length) === r) {
          out += h; i += r.length; matched = true; break;
        }
      }
      if (!matched) { out += src[i]; i++; }
    }
    return out;
  }
}
