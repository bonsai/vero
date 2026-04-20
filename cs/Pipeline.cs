// Pipeline.cs — 推論パイプライン
//
// Layer ①  custom_dict.json  （ユーザー辞書、最優先）
// Layer ②  BuiltinDict       （~400語バンドル済み SKK風辞書）
// Layer ③  RomajiConverter   （ローマ字→ひらがな→漢字ルックアップ）
// Layer ④  Claude API        （確信度 < threshold のときのみ呼ぶ）

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace AiIme;

// ── 推論結果 ────────────────────────────────────────────────────────────────
record InferResult(
    string   Source,        // "custom" | "builtin" | "romaji" | "api" | "local"
    string   Lang,          // "ja" | "en" | "romaji" | "mixed" | "unknown"
    int      Confidence,
    string   Converted,     // 変換後テキスト
    string[] Completions,   // 補完候補（最大4件）
    string?  Intent         // 意図の一文（APIのみ）
);

// ─────────────────────────────────────────────────────────────────────────────
sealed class Pipeline
{
    // ── 設定 ──────────────────────────────────────────────────────────────────
    const string MODEL         = "claude-sonnet-4-20250514";
    const int    API_THRESHOLD = 55;   // 確信度がこれ未満のときのみ API を呼ぶ
    const int    MAX_CONTEXT   = 300;  // APIに送る最大文字数

    public static readonly string CustomDictPath =
        Path.Combine(AppContext.BaseDirectory, "custom_dict.json");

    static readonly HttpClient Http = new();

    static readonly string ApiKey =
        Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") ?? string.Empty;

    // ── ユーザー辞書 ──────────────────────────────────────────────────────────
    private Dictionary<string, string[]> _customDict = new();

    public Pipeline()
    {
        Http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        ReloadCustomDict();
    }

    public void ReloadCustomDict()
    {
        EnsureCustomDict();
        try
        {
            var json = File.ReadAllText(CustomDictPath);
            var doc  = JsonDocument.Parse(json);
            _customDict = doc.RootElement
                .EnumerateObject()
                .Where(p => p.Name != "_comment" && p.Value.ValueKind == JsonValueKind.Array)
                .ToDictionary(
                    p => p.Name,
                    p => p.Value.EnumerateArray()
                                .Select(e => e.GetString() ?? "")
                                .Where(s => s.Length > 0)
                                .ToArray());
        }
        catch { _customDict = new(); }
    }

    public static void EnsureCustomDict()
    {
        if (File.Exists(CustomDictPath)) return;
        var template = new JsonObject
        {
            ["_comment"]    = "よみ（ひらがな） → [候補, ...] の形式で追記してください",
            ["じぶんのなまえ"] = new JsonArray("自分の名前"),
            ["かいしゃめい"]   = new JsonArray("会社名"),
            ["よんで"]        = new JsonArray("ヨンデ"),
            ["つんどく"]       = new JsonArray("ツンドク"),
            ["こんみゃく"]     = new JsonArray("根脈"),
        };
        File.WriteAllText(CustomDictPath,
            template.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    // ── メイン推論 ────────────────────────────────────────────────────────────
    public async Task<InferResult> InferAsync(string input)
    {
        var (lang, langConf) = DetectLang(input);

        // 英語 → ローカル補完のみ
        if (lang == "en")
        {
            var completions = new[] { input + ". ", input + ", and ", input + ", but ", input + "—" };
            return new InferResult("local", "en", langConf, input, completions, null);
        }

        // ローマ字 → ひらがな変換
        var hira = lang == "romaji"
            ? RomajiConverter.ToHiragana(input)
            : input;

        // スペース区切りでセグメント辞書引き
        var (converted, dictConf, source) = SegmentedLookup(hira);

        // 確信度が十分 → ローカル返却
        if (dictConf >= API_THRESHOLD || string.IsNullOrEmpty(ApiKey))
        {
            var comps = BuildLocalCompletions(converted, lang);
            return new InferResult(source, lang, dictConf, converted, comps, null);
        }

        // API フォールバック
        var apiResult = await CallApiAsync(input);
        if (apiResult is not null) return apiResult;

        // API 失敗 → ローカル結果で返す
        return new InferResult("local-fallback", lang, dictConf, converted,
            BuildLocalCompletions(converted, lang), null);
    }

    // ── 言語検出 ──────────────────────────────────────────────────────────────
    static readonly Regex ReJP     = new(@"[\u3040-\u9FFF]");
    static readonly Regex ReEN     = new(@"[a-zA-Z]");
    static readonly Regex ReRomaji = new(@"^[a-zA-Z\s']+$");

    static (string lang, int conf) DetectLang(string text)
    {
        bool hasJP = ReJP.IsMatch(text);
        bool hasEN = ReEN.IsMatch(text);
        bool looksRomaji = !hasJP && hasEN && ReRomaji.IsMatch(text.Trim());

        if (looksRomaji)     return ("romaji",  88);
        if (hasJP && hasEN)  return ("mixed",   80);
        if (hasJP)           return ("ja",      95);
        if (hasEN)           return ("en",      85);
        return                      ("unknown",  0);
    }

    // ── 辞書引き（スペース区切りでトークン化→各語を変換→結合） ───────────────
    (string converted, int conf, string source) SegmentedLookup(string hira)
    {
        var tokens  = hira.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length == 0) return (hira, 0, "none");

        var sb      = new StringBuilder();
        int total   = 0;
        string src  = "builtin";

        foreach (var tok in tokens)
        {
            // ① カスタム辞書
            if (_customDict.TryGetValue(tok, out var customHits))
            {
                sb.Append(customHits[0]);
                total += 98;
                src    = "custom";
                continue;
            }
            // ② 組み込み辞書
            if (BuiltinDict.Data.TryGetValue(tok, out var builtinHits))
            {
                sb.Append(builtinHits[0]);
                total += 90;
                continue;
            }
            // 前方一致
            var prefix = BuiltinDict.Data.Keys.FirstOrDefault(k => k.StartsWith(tok) && k != tok);
            if (prefix is not null)
            {
                sb.Append(BuiltinDict.Data[prefix][0]);
                total += 65;
                continue;
            }
            // ミス → そのまま
            sb.Append(tok);
            total += 30;
        }

        return (sb.ToString(), total / tokens.Length, src);
    }

    // ── ローカル補完ヒント ─────────────────────────────────────────────────────
    static string[] BuildLocalCompletions(string converted, string lang)
    {
        if (lang is "ja" or "romaji")
            return new[] { converted + "は", converted + "が", converted + "を", converted + "の" };
        return new[] { converted + ". ", converted + ", and ", converted + ", but " };
    }

    // ── Claude API ────────────────────────────────────────────────────────────
    async Task<InferResult?> CallApiAsync(string input)
    {
        var ctx    = input.Length > MAX_CONTEXT ? input[^MAX_CONTEXT..] : input;
        var jsonSchema = """
{
  "lang": "ja" | "en" | "mixed" | "romaji",
  "confidence": 0-100,
  "converted": "romaji → 日本語 if applicable, else as-is",
  "c1": "completion option 1 (append to converted)",
  "c2": "completion option 2",
  "c3": "completion option 3",
  "intent": "意図（日本語一文）"
}
""";
        var prompt = $"""
You are an AI input assistant for a Japanese/English bilingual user (architecture & software domain).
Respond ONLY with valid JSON, no markdown, no explanation.

Input: "{ctx}"

Respond with JSON matching this schema:
{jsonSchema}
""";

        var body = JsonSerializer.Serialize(new
        {
            model      = MODEL,
            max_tokens = 400,
            messages   = new[] { new { role = "user", content = prompt } },
        });

        var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("x-api-key",           ApiKey);
        req.Headers.Add("anthropic-version",   "2023-06-01");

        try
        {
            var res  = await Http.SendAsync(req);
            var json = await res.Content.ReadAsStringAsync();
            var doc  = JsonDocument.Parse(json);
            var text = doc.RootElement
                          .GetProperty("content")[0]
                          .GetProperty("text")
                          .GetString() ?? "";

            // ```json フェンス除去
            text = Regex.Replace(text, @"```json|```", "").Trim();

            var r        = JsonDocument.Parse(text).RootElement;
            var lang     = r.TryGetProp("lang")      ?? "unknown";
            var confStr  = r.TryGetProp("confidence") ?? "50";
            var conv     = r.TryGetProp("converted")  ?? "";
            var c1       = r.TryGetProp("c1")         ?? "";
            var c2       = r.TryGetProp("c2")         ?? "";
            var c3       = r.TryGetProp("c3")         ?? "";
            var intent   = r.TryGetProp("intent");
            _ = int.TryParse(confStr, out var conf);

            var comps = new[] { conv, conv + c1, conv + c2, conv + c3 }
                            .Where(s => !string.IsNullOrEmpty(s))
                            .Distinct()
                            .Take(4)
                            .ToArray();

            return new InferResult("api", lang, conf, conv, comps, intent);
        }
        catch { return null; }
    }
}

// ── JsonElement 拡張 ──────────────────────────────────────────────────────────
static class JsonExt
{
    public static string? TryGetProp(this JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop))
        {
            return prop.ValueKind == JsonValueKind.Number
                ? prop.GetInt32().ToString()
                : prop.GetString();
        }
        return null;
    }
}
