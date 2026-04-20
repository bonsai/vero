#!/usr/bin/env node

// =============================================================
// ai_ime.mjs  —  AI-powered input assistant (Node.js / ESM)
//
// SETUP:
//   npm install clipboardy wanakana
//   export ANTHROPIC_API_KEY=sk-ant-...   (or .env)
//   node ai_ime.mjs
//
// USAGE:
//   1. Copy any text to clipboard (Ctrl+C)
//   2. The script auto-detects and shows suggestions
//   3. Press 1 / 2 / 3 → result goes back to clipboard (ready to paste)
//   4. Press q to quit
//
// ARCHITECTURE:
//   Local-first pipeline:
//     [input] → lang detect → romaji convert → local completion
//                                                   ↓ if confidence < threshold
//                                              Claude API (fallback)
//
// REQUIRES: Node 18+  (native fetch)
// =============================================================

import clipboardy from 'clipboardy';
import * as wanakana from 'wanakana';
import readline from 'readline';

// ── Config ────────────────────────────────────────────────────
const API_KEY           = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL             = 'claude-sonnet-4-20250514';
const POLL_MS           = 600;   // clipboard polling interval
const LOCAL_CONF_THRESH = 72;    // below this % → call API
const MAX_CHARS         = 300;   // context window for API
// ─────────────────────────────────────────────────────────────

// ── Local: language detection ─────────────────────────────────
const RE_HIRAGANA = /[\u3040-\u309F]/;
const RE_KATAKANA = /[\u30A0-\u30FF]/;
const RE_KANJI    = /[\u4E00-\u9FFF]/;
const RE_LATIN    = /[a-zA-Z]/;

function detectLang(text) {
  const hasJP = RE_HIRAGANA.test(text) || RE_KATAKANA.test(text) || RE_KANJI.test(text);
  const hasEN = RE_LATIN.test(text);
  const isRomaji = !hasJP && hasEN && wanakana.isRomaji(text.replace(/\s/g, ''));

  if (isRomaji)         return { lang: 'romaji',  conf: 90 };
  if (hasJP && hasEN)   return { lang: 'mixed',   conf: 80 };
  if (hasJP)            return { lang: 'ja',      conf: 95 };
  if (hasEN)            return { lang: 'en',      conf: 85 };
  return                       { lang: 'unknown', conf: 0  };
}

// ── Local: romaji → hiragana → kanji hint ────────────────────
function localConvert(text, lang) {
  if (lang !== 'romaji') return text;
  // wanakana converts romaji → hiragana
  const hira = wanakana.toHiragana(text, { passRomaji: false });
  return hira;
}

// ── Local: naive completion hints (no API) ───────────────────
const JP_ENDINGS = ['です。', 'ます。', 'ください。', 'ました。', 'ません。'];
const EN_ENDINGS = ['.', ', and ', ', so ', '—which '];

function localComplete(text, lang) {
  if (lang === 'ja' || lang === 'romaji') {
    return JP_ENDINGS.map(e => text + e);
  }
  if (lang === 'en') {
    return EN_ENDINGS.map(e => text + e);
  }
  return [];
}

// ── Claude API fallback ───────────────────────────────────────
async function apiInfer(text) {
  if (!API_KEY) return null;

  const prompt = `You are an AI input assistant for a Japanese/English bilingual user.
Respond ONLY with valid JSON, no markdown, no explanation.

Input: "${text.slice(-MAX_CHARS)}"

{
  "lang": "ja" | "en" | "mixed" | "romaji",
  "confidence": 0-100,
  "converted": "romaji→Japanese if applicable, else input as-is",
  "c1": "completion option 1 (appended to converted)",
  "c2": "completion option 2",
  "c3": "completion option 3",
  "intent": "what user is trying to express (Japanese, one sentence)"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const raw  = data?.content?.[0]?.text ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── Render result to terminal ─────────────────────────────────
const LANG_LABEL = { ja: '日本語', en: 'English', mixed: '混在', romaji: 'ローマ字', unknown: '?' };
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', gray: '\x1b[90m',
};

function render(original, result, source) {
  const { lang, confidence, converted, c1, c2, c3, intent } = result;
  const label = LANG_LABEL[lang] ?? lang;
  const src   = source === 'api' ? `${C.yellow}[API]${C.reset}` : `${C.green}[LOCAL]${C.reset}`;

  console.clear();
  console.log(`\n${C.bold}── AI IME ──${C.reset}  ${src}  ${C.cyan}${label}${C.reset}  確信度 ${confidence}%`);
  if (intent) console.log(`${C.dim}意図: ${intent}${C.reset}`);
  console.log();

  const base = converted ?? original;
  const opts = [c1, c2, c3].filter(Boolean).map(c => base + c);
  if (opts.length === 0) opts.push(base);

  opts.forEach((opt, i) => {
    const prefix = `${C.cyan}[${i + 1}]${C.reset}`;
    const display = opt.length > 60 ? opt.slice(0, 60) + '…' : opt;
    console.log(`  ${prefix}  ${display}`);
  });

  console.log(`\n${C.gray}1/2/3: クリップボードにコピー  q: 終了${C.reset}\n`);
  return opts;
}

// ── Main loop ─────────────────────────────────────────────────
let lastClip  = '';
let currentOpts = [];
let processing  = false;

async function processClip(text) {
  if (processing) return;
  processing = true;

  const trimmed = text.trim();
  const { lang, conf } = detectLang(trimmed);

  let result, source;

  if (lang === 'unknown' || conf < LOCAL_CONF_THRESH) {
    // Low confidence → API fallback
    const apiRes = await apiInfer(trimmed);
    if (apiRes) {
      result = apiRes;
      source = 'api';
    }
  }

  if (!result) {
    // Local pipeline
    const converted = localConvert(trimmed, lang);
    const completions = localComplete(converted, lang);
    const [c1 = '', c2 = '', c3 = ''] = completions.map(c => c.slice(converted.length));
    result = { lang, confidence: conf, converted, c1, c2, c3, intent: null };
    source = 'local';

    // If romaji and API available, upgrade with API in background
    if (lang === 'romaji' && API_KEY) {
      apiInfer(trimmed).then(apiRes => {
        if (apiRes) {
          currentOpts = render(trimmed, apiRes, 'api');
        }
      });
    }
  }

  currentOpts = render(trimmed, result, source);
  processing = false;
}

// clipboard polling
async function poll() {
  try {
    const clip = await clipboardy.read();
    if (clip !== lastClip && clip.trim().length > 0) {
      lastClip = clip;
      await processClip(clip);
    }
  } catch { /* clipboard unavailable, skip */ }
}

// keyboard input
function setupKeys() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on('keypress', async (ch, key) => {
    if (!key) return;

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      console.log('\n終了します。');
      process.exit(0);
    }

    const idx = parseInt(ch, 10);
    if (idx >= 1 && idx <= 3 && currentOpts[idx - 1]) {
      const chosen = currentOpts[idx - 1];
      await clipboardy.write(chosen);
      console.log(`\n${C.green}✓ クリップボードにコピーしました:${C.reset} ${chosen}\n`);
      lastClip = chosen; // prevent re-processing
    }
  });
}

// startup
console.clear();
console.log(`${C.bold}AI IME${C.reset} 起動中...`);
if (!API_KEY) console.log(`${C.yellow}※ ANTHROPIC_API_KEY 未設定 → ローカルのみで動作${C.reset}`);
console.log(`${C.dim}テキストをコピー（Ctrl+C）すると自動で解析します${C.reset}\n`);

setupKeys();
setInterval(poll, POLL_MS);
