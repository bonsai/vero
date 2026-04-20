// Romaji2Text.cs — ストリーミング型 ローマ字→テキスト変換エンジン
// ASRと同じ仕組み: 文字蓄積 → debounce後に変換 → 結果を順次yield
// 誤字補正(fuzzy)・部分変換・カスタム辞書対応

using System.Collections.Concurrent;

namespace AiIme;

/// <summary>ストリーミング変換イベント</summary>
public record TextEvent(
    TextEventType Type,       // "input" | "converted" | "confirmed" | "correction"
    string        Raw,        // 生入力バッファ
    string        Text,       // 変換後テキスト
    int           Confidence, // 確信度
    string?       Suggestion  // 誤字補正ヒント(null=なし)
);

public enum TextEventType { Input, Converted, Confirmed, Correction }

// ─────────────────────────────────────────────────────────────────────────────
sealed class Romaji2Text
{
    // ── 設定 ──────────────────────────────────────────────────────────────
    public int DebounceMs    { get; set; } = 350;  // 変換開始前の待機時間(ms)
    public int MaxBufferSize { get; set; } = 500;  // 入力バッファ上限

    // ── Romaji Table (RomajiConverter.csと同じ) ───────────────────────────
    static readonly (string romaji, string hira)[] TABLE =
    [
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
    ];

    static readonly HashSet<char> VOWELS_Y = new("aeiouAEIOUyY");

    // ── Fuzzy Correction Map (typo → correct) ─────────────────────────────
    // よくある入力ミス → 正しいローマ字
    static readonly Dictionary<string, string> FUZZY_MAP = new()
    {
        // 子音入れ替え
        ["shs"] = "shi", ["shu"] = "shu", // keep correct
        ["kya"] = "kya", ["kyaa"] = "kya",
        ["chii"] = "chi", ["chh"] = "chi",
        ["tts"] = "ttsu", ["tssu"] = "ttsu",
        ["nna"] = "na",  ["mma"] = "ma",
        // 母音ミス
        ["kae"] = "ka",  ["kie"] = "ki",  ["kuu"] = "ku",
        ["see"] = "se",  ["soo"] = "so",
        ["tae"] = "ta",  ["tie"] = "ti",  ["too"] = "to",
        ["naa"] = "na",  ["nee"] = "ne",  ["noo"] = "no",
        ["haa"] = "ha",  ["hee"] = "he",  ["hoo"] = "ho",
        // 拗音ミス
        ["sya"] = "sha", ["syu"] = "shu", ["syo"] = "sho",
        ["zya"] = "ja",  ["zyu"] = "ju",  ["zyo"] = "jo",
        ["tya"] = "cha", ["tyu"] = "chu", ["tyo"] = "cho",
        // 促音関連
        ["lttu"] = "ttsu", ["kka"] = "kka",
        // 特殊
        ["whi"] = "wi",   ["wee"] = "we",
        ["nn"] = "nn",    // んん
        // 英字の近くミス (qwerty配置考慮)
        ["q"] = "",  // qはローマ字に使わない → 無視
        ["v"] = "b", // v→b（日本語にvない）
    };

    // ── 状態 ──────────────────────────────────────────────────────────────
    readonly List<char> _buffer = new();
    string _committed = "";       // 確定済みテキスト
    readonly HashSet<string> _dict;

    public Romaji2Text()
    {
        // BuiltinDictのキーを全投入
        _dict = new HashSet<string>(BuiltinDict.Data.Keys);
    }

    public void AddDictEntry(string yomi) => _dict.Add(yomi);

    // ── キーストローク受信 ────────────────────────────────────────────────
    public TextEvent OnKey(char ch)
    {
        // スペース → セパレータとして扱う
        if (ch == ' ')
        {
            var ev = Flush();
            _buffer.Add(' ');
            return ev;
        }

        // バックスペース → 最後の1文字削除
        if (ch == '\b' || ch == '\x7f')
        {
            if (_buffer.Count > 0) _buffer.RemoveAt(_buffer.Count - 1);
            return new TextEvent(TextEventType.Input, new string(_buffer.ToArray()), _committed, 0, null);
        }

        // Enter → 確定
        if (ch == '\r' || ch == '\n')
        {
            return Commit();
        }

        // 英字・スペース・アポストロフィのみ許可
        var lower = char.ToLowerInvariant(ch);
        if (lower is >= 'a' and <= 'z')
        {
            if (_buffer.Count < MaxBufferSize)
            {
                _buffer.Add(lower);
                return new TextEvent(
                    TextEventType.Input,
                    new string(_buffer.ToArray()),
                    Preview(),
                    0,
                    null
                );
            }
        }

        return new TextEvent(TextEventType.Input, new string(_buffer.ToArray()), _committed, 0, null);
    }

    // ── 現在のバッファをフラッシュ → 変換実行 ─────────────────────────────
    public TextEvent Flush()
    {
        if (_buffer.Count == 0)
            return new TextEvent(TextEventType.Input, "", _committed, 0, null);

        var raw = new string(_buffer.ToArray());
        var tokens = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var sb = new System.Text.StringBuilder();
        int totalConf = 0;
        string? correction = null;

        foreach (var tok in tokens)
        {
            // Fuzzy correction
            var fixed_tok = tok;
            if (FUZZY_MAP.TryGetValue(tok, out var mapped))
            {
                fixed_tok = mapped;
                correction = $"'{tok}' → '{mapped}'";
            }

            // Dictionary lookup (exact)
            if (_dict.TryGetValue(fixed_tok, out var hits))
            {
                sb.Append(hits[0]);
                totalConf += 95;
                continue;
            }

            // Prefix match
            var prefix = _dict.FirstOrDefault(k => k.StartsWith(fixed_tok) && k != fixed_tok);
            if (prefix != null)
            {
                sb.Append(BuiltinDict.Data[prefix][0]);
                totalConf += 60;
                continue;
            }

            // Romaji → Hiragana (fallback)
            var hira = ConvertToken(fixed_tok);
            sb.Append(hira);

            // hiraが元のtokと異なる → romaji変換成功
            var tokConf = hira != fixed_tok ? 75 : 25;
            totalConf += tokConf;

            // 未変換文字がある場合
            if (tokConf < 50 && correction == null)
                correction = $"未登録: '{fixed_tok}' → '{hira}'";
        }

        var converted = sb.ToString();
        var conf = tokens.Length > 0 ? totalConf / tokens.Length : 0;

        return new TextEvent(
            TextEventType.Converted,
            raw,
            converted,
            conf,
            correction
        );
    }

    // ── 確定 ──────────────────────────────────────────────────────────────
    public TextEvent Commit()
    {
        var ev = Flush();
        _committed += ev.Text;
        _buffer.Clear();
        return new TextEvent(
            TextEventType.Confirmed,
            "",
            _committed,
            ev.Confidence,
            null
        );
    }

    public string Committed => _committed;

    // ── プレビュー（バッファの途中結果を表示） ────────────────────────────
    string Preview()
    {
        if (_buffer.Count == 0) return _committed;
        var raw = new string(_buffer.ToArray());
        var tokens = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var sb = new System.Text.StringBuilder();

        foreach (var tok in tokens)
        {
            var fixed_tok = FUZZY_MAP.TryGetValue(tok, out var m) ? m : tok;

            if (_dict.TryGetValue(fixed_tok, out var hits)) { sb.Append(hits[0]); continue; }
            var prefix = _dict.FirstOrDefault(k => k.StartsWith(fixed_tok) && k != fixed_tok);
            if (prefix != null) { sb.Append(BuiltinDict.Data[prefix][0]); continue; }
            sb.Append(ConvertToken(fixed_tok));
        }
        return _committed + sb.ToString();
    }

    // ── Romaji → Hiragana (トークン単位) ─────────────────────────────────
    static string ConvertToken(string src)
    {
        src = src.ToLowerInvariant();
        var sb = new System.Text.StringBuilder();
        int i = 0;

        while (i < src.Length)
        {
            // 促音: 子音連続
            if (i + 1 < src.Length && src[i] != 'n' && src[i] == src[i + 1] && !"aiueo".Contains(src[i]))
            {
                sb.Append('っ'); i++; continue;
            }
            // n + 非母音/非y → ん
            if (src[i] == 'n' && (i + 1 >= src.Length || !VOWELS_Y.Contains(src[i + 1])))
            {
                sb.Append('ん'); i++; continue;
            }
            // テーブル照合
            bool matched = false;
            foreach (var (r, h) in TABLE)
            {
                if (src.Length - i >= r.Length && src.Substring(i, r.Length) == r)
                {
                    sb.Append(h); i += r.Length; matched = true; break;
                }
            }
            if (!matched) { sb.Append(src[i]); i++; }
        }
        return sb.ToString();
    }

    // ── リセット ──────────────────────────────────────────────────────────
    public void Reset()
    {
        _buffer.Clear();
        _committed = "";
    }
}
