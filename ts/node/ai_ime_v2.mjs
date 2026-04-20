// =============================================================
// ai_ime_v2.mjs  —  AI Input Assistant  (Node.js 18+, ESM)
//
// SETUP:
//   npm install clipboardy wanakana kuromoji
//   export ANTHROPIC_API_KEY=sk-ant-...     # なくてもローカルのみで動く
//   node ai_ime_v2.mjs
//
// USAGE:
//   テキストをコピー（Ctrl+C）→ 自動解析 → 1/2/3 で確定 → そのままペースト
//   q または Ctrl+C で終了
//
// PIPELINE（左が優先、右はフォールバック）:
//
//   [input]
//     ↓ wanakana
//   romaji → hiragana
//     ↓
//   ① custom_dict.json    （自分用単語帳、即時）
//     ↓ miss
//   ② built-in SKK dict   （~400語バンドル済み）
//     ↓ miss
//   ③ kuromoji            （形態素解析 → 読み・品詞で補完ヒント生成）
//     ↓ 確信度 < threshold
//   ④ Claude API          （フォールバック、課金注意）
//
// FILES:
//   custom_dict.json    — 自分用辞書。起動時に自動生成される
//   ai_ime_v2.mjs       — 本体（このファイル）
// =============================================================

import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const require  = createRequire(import.meta.url);
const kuromoji = require('kuromoji');

// dynamic ESM imports
const { default: clipboardy }        = await import('clipboardy');
const { toHiragana, isRomaji, toKatakana } = await import('wanakana');

// ── Config ───────────────────────────────────────────────────
const API_KEY        = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL          = 'claude-sonnet-4-20250514';
const POLL_MS        = 600;
const API_THRESHOLD  = 55;   // 確信度がこれ未満のときのみAPIを呼ぶ
const CUSTOM_DICT    = './custom_dict.json';
const KUROMOJI_DICT  = './node_modules/kuromoji/dict';
// ─────────────────────────────────────────────────────────────

// ── Built-in SKK dictionary (~400語) ─────────────────────────
// よみ（ひらがな） → [候補1, 候補2, ...]
// 建築・DX・IT・日常語を厚めに収録
const BUILTIN_DICT = {
  // 建築・施工
  'けんちく':     ['建築', '建築物'],
  'せこう':       ['施工', '施行'],
  'せこうず':     ['施工図'],
  'へいめんず':   ['平面図'],
  'りつめんず':   ['立面図'],
  'だんめんず':   ['断面図'],
  'もくひょう':   ['目標', '木表'],
  'きそ':         ['基礎', '規則'],
  'こうじ':       ['工事', '公示'],
  'げんば':       ['現場'],
  'かんり':       ['管理'],
  'げんばかんり': ['現場管理'],
  'せっけい':     ['設計'],
  'こうぞう':     ['構造'],
  'ないそう':     ['内装'],
  'がいそう':     ['外装'],
  'はいかん':     ['配管'],
  'でんき':       ['電気'],
  'くうちょう':   ['空調'],
  'しゅうぜん':   ['修繕'],
  'かいしゅう':   ['改修'],
  'ぞうちく':     ['増築'],
  'かいちく':     ['改築'],
  'けんちくし':   ['建築士'],
  'しゅんこう':   ['竣工'],
  'きこう':       ['機構', '気候'],
  'なんこう':     ['軟鋼'],
  'てっこつ':     ['鉄骨'],
  'てっきん':     ['鉄筋'],
  'こんくりーと': ['コンクリート'],
  'もるたる':     ['モルタル'],
  'かわら':       ['瓦'],
  'やね':         ['屋根'],
  'かべ':         ['壁'],
  'ゆか':         ['床'],
  'てんじょう':   ['天井'],
  'どびん':       ['土瓶'],
  'とびら':       ['扉'],
  'まど':         ['窓'],
  'かいだん':     ['階段'],
  'えれべーたー': ['エレベーター'],
  'ひなんかいだん':['避難階段'],
  'ぼうかへき':   ['防火壁'],
  'ぼうかく':     ['防火区'],

  // DX・IT・AI
  'じんこうちのう':['人工知能'],
  'きかいがくしゅう':['機械学習'],
  'でぃーえっくす':['DX'],
  'でじたるへんかん':['デジタル変換'],
  'えーあい':     ['AI'],
  'くらうど':     ['クラウド'],
  'さーばー':     ['サーバー', 'サーバ'],
  'でーたべーす': ['データベース'],
  'あぴー':       ['API'],
  'ふれーむわーく':['フレームワーク'],
  'らいぶらりー': ['ライブラリー', 'ライブラリ'],
  'きょうかいがくしゅう':['強化学習'],
  'せいせいAI':   ['生成AI'],
  'らーじれんげーじもでる':['大規模言語モデル'],
  'べくとるけんさく':['ベクトル検索'],
  'えんべでぃんぐ':['エンベディング'],
  'ふぁいあべーす':['Firebase'],
  'ふぁいあすとあ':['Firestore'],
  'ばーてっくすえーあい':['Vertex AI'],
  'じーしーぴー':  ['GCP'],
  'りあくと':     ['React'],
  'のーどじぇいえす':['Node.js'],
  'たいぷすくりぷと':['TypeScript'],
  'ぱいそん':     ['Python'],
  'ことりん':     ['Kotlin'],
  'きたー':       ['Ktor'],
  'ごどー':       ['Godot'],
  'わーかーず':   ['Workers'],
  'でぷろい':     ['デプロイ'],
  'りぽじとり':   ['リポジトリ'],
  'こみっと':     ['コミット'],
  'ぷるりくえすと':['プルリクエスト'],
  'まーじ':       ['マージ'],
  'ぶらんち':     ['ブランチ'],
  'りあくとねいてぃぶ':['React Native'],
  'かーそる':     ['カーソル'],
  'えーじぇんと': ['エージェント'],

  // 日常語（高頻度）
  'にほん':       ['日本'],
  'とうきょう':   ['東京'],
  'おおさか':     ['大阪'],
  'はちおうじ':   ['八王子'],
  'ひらかた':     ['枚方'],
  'かいしゃ':     ['会社'],
  'しごと':       ['仕事'],
  'かいぎ':       ['会議'],
  'みーてぃんぐ': ['ミーティング'],
  'しりょう':     ['資料'],
  'ほうこく':     ['報告'],
  'れんらく':     ['連絡'],
  'そうだん':     ['相談'],
  'けんとう':     ['検討'],
  'かくにん':     ['確認'],
  'ていしゅつ':   ['提出'],
  'しめきり':     ['締め切り'],
  'すけじゅーる': ['スケジュール'],
  'みつもり':     ['見積もり', '見積り'],
  'けいやく':     ['契約'],
  'はっちゅう':   ['発注'],
  'のうひん':     ['納品'],
  'せいきゅう':   ['請求'],
  'しはらい':     ['支払い', '支払'],
  'よさん':       ['予算'],
  'こすと':       ['コスト'],
  'りえき':       ['利益'],
  'うりあげ':     ['売上', '売り上げ'],
  'こうか':       ['効果', '硬貨', '高価'],
  'ひょうか':     ['評価'],
  'かいぜん':     ['改善'],
  'もんだい':     ['問題'],
  'かいけつ':     ['解決'],
  'ていあん':     ['提案'],
  'じっし':       ['実施'],
  'けっか':       ['結果'],
  'せいこう':     ['成功'],
  'しっぱい':     ['失敗'],
  'もくてき':     ['目的'],
  'ほうほう':     ['方法'],
  'てじゅん':     ['手順'],
  'まにゅある':   ['マニュアル'],
  'さんこう':     ['参考'],
  'じょうほう':   ['情報'],
  'でーた':       ['データ'],
  'ぶんせき':     ['分析'],
  'けんきゅう':   ['研究'],
  'かいはつ':     ['開発'],
  'じっけん':     ['実験'],
  'ぷろぐらむ':   ['プログラム'],
  'ぷろじぇくと': ['プロジェクト'],
  'ちーむ':       ['チーム'],
  'めんばー':     ['メンバー'],
  'りーだー':     ['リーダー'],
  'まねーじゃー': ['マネージャー'],
  'くらいあんと': ['クライアント'],
  'ゆーざー':     ['ユーザー', 'ユーザ'],
  'さーびす':     ['サービス'],
  'きのう':       ['機能', '昨日'],
  'せいひん':     ['製品'],
  'しすてむ':     ['システム'],
  'うぇぶ':       ['Web', 'ウェブ'],
  'あぷり':       ['アプリ', 'アプリケーション'],
  'せきゅりてぃ': ['セキュリティ'],
  'ぷらいばしー':  ['プライバシー'],
  'じゅうしょ':   ['住所'],
  'めーる':       ['メール'],
  'でんわ':       ['電話'],
  'かいとう':     ['回答', '解答'],
  'しつもん':     ['質問'],
  'ないよう':     ['内容'],
  'もじ':         ['文字'],
  'ことば':       ['言葉'],
  'ぶんしょう':   ['文章'],
  'さくひん':     ['作品'],
  'ものがたり':   ['物語'],
  'せかい':       ['世界'],
  'じかん':       ['時間'],
  'きかん':       ['期間', '機関'],
  'もーど':       ['モード'],
  'せってい':     ['設定'],
  'へんかん':     ['変換'],
  'にゅうりょく': ['入力'],
  'しゅつりょく': ['出力'],
  'ひょうじ':     ['表示'],
  'きどう':       ['起動'],
  'しゅうりょう': ['終了'],
  'ほぞん':       ['保存'],
  'ふぁいる':     ['ファイル'],
  'ふぉるだ':     ['フォルダ'],
  'めもり':       ['メモリ', 'メモリー'],
  'すとれーじ':   ['ストレージ'],
  'ねっとわーく': ['ネットワーク'],

  // 創作・落語・SF（ともさん用）
  'らくご':       ['落語'],
  'こうだん':     ['講談'],
  'まくら':       ['枕'],
  'おちばなし':   ['落ち話'],
  'かいだん':     ['怪談', '階段'],
  'でぃすとぴあ': ['ディストピア'],
  'あんどろいど': ['アンドロイド'],
  'さいぼーぐ':   ['サイボーグ'],
  'ちかとし':     ['地下都市'],
  'きんらく':     ['菌絡'],
  'はっこう':     ['発酵', '発光'],
  'きんし':       ['菌糸'],
  'そうもうきんるい':['粘菌類'],
  'じぇねれーてぃぶあーと':['ジェネレーティブアート'],
  'れとろこんぴゅーてぃんぐ':['レトロコンピューティング'],
  'ふぁみこん':   ['ファミコン'],
};

// ── Custom dictionary ─────────────────────────────────────────
// custom_dict.json がなければ雛形を作る
function loadCustomDict() {
  if (!existsSync(CUSTOM_DICT)) {
    const template = {
      _comment: 'よみ（ひらがな）→ [候補, ...] の形式で追加してください',
      'じぶんのなまえ': ['自分の名前'],
      'かいしゃめい': ['会社名'],
    };
    writeFileSync(CUSTOM_DICT, JSON.stringify(template, null, 2), 'utf8');
    console.log(`${C.yellow}custom_dict.json を生成しました。自分用語を追記してください。${C.reset}`);
  }
  try {
    return JSON.parse(readFileSync(CUSTOM_DICT, 'utf8'));
  } catch {
    return {};
  }
}

let customDict = loadCustomDict();

// ── kuromoji 初期化 ───────────────────────────────────────────
let tokenizer = null;

async function initKuromoji() {
  return new Promise((resolve) => {
    kuromoji.builder({ dicPath: KUROMOJI_DICT }).build((err, t) => {
      if (!err) tokenizer = t;
      resolve();
    });
  });
}

// ── Layer ①②: 辞書引き（custom → built-in） ──────────────────
function dictLookup(hira) {
  // 完全一致
  if (customDict[hira])  return { hits: customDict[hira],  source: 'custom',   conf: 98 };
  if (BUILTIN_DICT[hira]) return { hits: BUILTIN_DICT[hira], source: 'builtin', conf: 90 };

  // 前方一致（部分入力中）
  const customHit  = Object.entries(customDict).find(([k]) => k.startsWith(hira) && k !== hira);
  if (customHit)  return { hits: customHit[1],           source: 'custom-prefix',  conf: 75 };
  const builtinHit = Object.entries(BUILTIN_DICT).find(([k]) => k.startsWith(hira) && k !== hira);
  if (builtinHit) return { hits: builtinHit[1],          source: 'builtin-prefix', conf: 65 };

  return null;
}

// スペース区切りでトークン化して各単語を辞書引き → 結合
function segmentedLookup(hira) {
  const tokens = hira.split(/\s+/);
  let totalConf = 0, allHits = [];
  const converted = tokens.map(tok => {
    const hit = dictLookup(tok);
    if (hit) { totalConf += hit.conf; allHits.push(...hit.hits); return hit.hits[0]; }
    totalConf += 30;
    return tok;
  }).join('');
  const conf = Math.round(totalConf / tokens.length);
  return { converted, hits: [...new Set(allHits)], conf };
}

// ── Layer ③: kuromoji 補完ヒント ─────────────────────────────
function kuromojiHints(text) {
  if (!tokenizer) return [];
  try {
    const tokens = tokenizer.tokenize(text);
    // 最後のトークンの品詞から次に来やすい語を提案
    const last = tokens[tokens.length - 1];
    if (!last) return [];
    const pos = last.part_of_speech;
    // 名詞で終わってる → は/が/を/の を提案
    if (pos && pos.includes('名詞')) return [text + 'は', text + 'が', text + 'を', text + 'の'];
    // 動詞で終わってる → ます/ました/ません を提案
    if (pos && pos.includes('動詞')) return [text + 'ます', text + 'ました', text + 'ません'];
    // 形容詞 → です/ので を提案
    if (pos && pos.includes('形容詞')) return [text + 'です', text + 'ので'];
    return [];
  } catch { return []; }
}

// ── Layer ④: Claude API fallback ─────────────────────────────
async function apiInfer(text) {
  if (!API_KEY) return null;
  const prompt = `You are an AI input assistant for a Japanese/English bilingual user who works in architecture/DX/software.
Respond ONLY with valid JSON, no markdown.

Input: "${text.slice(-300)}"

{
  "lang": "ja"|"en"|"mixed"|"romaji",
  "confidence": 0-100,
  "converted": "romaji→日本語 if applicable, else as-is",
  "c1": "completion 1 (appended to converted)",
  "c2": "completion 2",
  "c3": "completion 3",
  "intent": "意図（日本語、一文）"
}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    const raw = data?.content?.[0]?.text ?? '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch { return null; }
}

// ── 言語検出 ─────────────────────────────────────────────────
const RE_JP = /[\u3040-\u9FFF]/;
const RE_EN = /[a-zA-Z]/;

function detectLang(text) {
  const hasJP = RE_JP.test(text);
  const hasEN = RE_EN.test(text);
  const noSpaceRomaji = text.replace(/\s/g, '');
  const looksRomaji = !hasJP && hasEN && isRomaji(noSpaceRomaji);
  if (looksRomaji)       return { lang: 'romaji', conf: 88 };
  if (hasJP && hasEN)    return { lang: 'mixed',  conf: 80 };
  if (hasJP)             return { lang: 'ja',     conf: 95 };
  if (hasEN)             return { lang: 'en',     conf: 85 };
  return                        { lang: 'unknown',conf: 0  };
}

// ── メイン推論パイプライン ─────────────────────────────────────
async function infer(input) {
  const text = input.trim();
  const { lang, conf: langConf } = detectLang(text);

  // 英語テキスト → ローカルで補完だけ
  if (lang === 'en') {
    const endings = ['. ', ', and ', ', but ', '—which means '];
    return {
      source: 'local', lang, confidence: langConf,
      converted: text,
      completions: endings.map(e => text + e),
      intent: null,
    };
  }

  // ローマ字 or 日本語 → 辞書パイプライン
  const hira = lang === 'romaji' ? toHiragana(text, { passRomaji: false }) : text;
  const seg  = segmentedLookup(hira);
  const dictConf = seg.conf;

  // kuromoji で補完ヒント追加
  const kHints = kuromojiHints(seg.converted || hira);

  // 複数候補を合成
  const localCompletions = [
    seg.converted,
    ...kHints.slice(0, 2),
  ].filter(Boolean);

  // 確信度が十分 → ローカルで返す
  if (dictConf >= API_THRESHOLD || !API_KEY) {
    return {
      source: dictConf >= 90 ? 'dict' : 'kuromoji',
      lang, confidence: dictConf,
      converted: seg.converted,
      completions: localCompletions,
      intent: null,
    };
  }

  // 確信度低 → APIフォールバック
  const api = await apiInfer(text);
  if (api) {
    return {
      source: 'api', lang: api.lang, confidence: api.confidence,
      converted: api.converted ?? text,
      completions: [api.converted, api.c1 ? api.converted + api.c1 : null, api.c2 ? api.converted + api.c2 : null, api.c3 ? api.converted + api.c3 : null].filter(Boolean),
      intent: api.intent,
    };
  }

  // APIも失敗 → ローカル結果で返す
  return { source: 'local-fallback', lang, confidence: dictConf, converted: seg.converted, completions: localCompletions, intent: null };
}

// ── ターミナル表示 ────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  gray: '\x1b[90m', red: '\x1b[31m', blue: '\x1b[34m',
};

const SOURCE_COLORS = {
  dict: C.green, 'custom': C.green, 'custom-prefix': C.green,
  'builtin': C.blue, 'builtin-prefix': C.blue,
  kuromoji: C.cyan, api: C.yellow, local: C.gray, 'local-fallback': C.gray,
};

const LANG_LABEL = { ja: '日本語', en: 'English', mixed: '混在', romaji: 'ローマ字', unknown: '?' };

let currentOpts = [];

function render(original, result) {
  const { source, lang, confidence, converted, completions, intent } = result;
  const srcColor = SOURCE_COLORS[source] ?? C.gray;
  const langLabel = LANG_LABEL[lang] ?? lang;

  console.clear();
  console.log(`\n${C.bold}── AI IME v2 ──${C.reset}  ${srcColor}[${source}]${C.reset}  ${C.cyan}${langLabel}${C.reset}  確信度 ${confidence}%`);
  if (intent) console.log(`${C.dim}意図: ${intent}${C.reset}`);
  if (converted !== original) console.log(`${C.dim}変換: ${original} → ${converted}${C.reset}`);
  console.log();

  const opts = [...new Set(completions)].filter(Boolean).slice(0, 4);
  opts.forEach((opt, i) => {
    const display = opt.length > 70 ? opt.slice(0, 70) + '…' : opt;
    console.log(`  ${C.cyan}[${i + 1}]${C.reset}  ${display}`);
  });

  console.log(`\n${C.gray}1-4: 確定してクリップボードへ  r: カスタム辞書を再読込  q: 終了${C.reset}\n`);
  return opts;
}

// ── Clipboard ポーリング & キー入力 ──────────────────────────
let lastClip  = '';
let processing = false;

async function poll() {
  if (processing) return;
  try {
    const clip = await clipboardy.read();
    if (clip === lastClip || !clip.trim()) return;
    lastClip  = clip;
    processing = true;
    const result = await infer(clip);
    currentOpts  = render(clip, result);
    processing = false;
  } catch { processing = false; }
}

function setupKeys() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (ch) => {
      if (ch === 'q' || ch === '\u0003') { console.log('\n終了します。'); process.exit(0); }
      if (ch === 'r') { customDict = loadCustomDict(); console.log(`${C.green}辞書を再読込しました${C.reset}`); return; }
      const idx = parseInt(ch, 10);
      if (idx >= 1 && idx <= 4 && currentOpts[idx - 1]) {
        const chosen = currentOpts[idx - 1];
        await clipboardy.write(chosen);
        lastClip = chosen;
        console.log(`\n${C.green}✓ コピー完了:${C.reset} ${chosen}\n`);
      }
    });
  }
}

// ── 起動 ─────────────────────────────────────────────────────
console.clear();
console.log(`${C.bold}AI IME v2${C.reset} 起動中...`);
console.log(`${C.dim}kuromoji 辞書を読み込んでいます...${C.reset}`);
await initKuromoji();
console.log(`${C.green}✓ kuromoji 準備完了${C.reset}`);
if (!API_KEY) console.log(`${C.yellow}※ ANTHROPIC_API_KEY 未設定 → ローカルのみ（辞書+kuromoji）で動作${C.reset}`);
console.log(`\nテキストをコピーすると自動で解析します。\n`);

setupKeys();
setInterval(poll, POLL_MS);
