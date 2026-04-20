// RomajiConverter.cs — ローマ字→ひらがな変換（テーブル方式）
// wanakana の C# 代替実装。長い組み合わせから順に照合する。

namespace AiIme;

static class RomajiConverter
{
    // 長いキーが先に来るようソート済み
    static readonly (string romaji, string hira)[] Table =
    [
        // ── 拗音・特殊 ─────────────────────────────────────────────
        ("sha", "しゃ"), ("shi", "し"),  ("shu", "しゅ"), ("she", "しぇ"), ("sho", "しょ"),
        ("chi", "ち"),   ("tchi","っち"), ("cha", "ちゃ"), ("chu", "ちゅ"), ("che", "ちぇ"), ("cho", "ちょ"),
        ("tsu", "つ"),   ("ttsu","っつ"),
        ("dzu", "づ"),   ("dji", "ぢ"),
        ("kya", "きゃ"), ("kyu", "きゅ"), ("kyo", "きょ"),
        ("gya", "ぎゃ"), ("gyu", "ぎゅ"), ("gyo", "ぎょ"),
        ("sya", "しゃ"), ("syu", "しゅ"), ("syo", "しょ"),
        ("zya", "じゃ"), ("zyu", "じゅ"), ("zyo", "じょ"),
        ("jya", "じゃ"), ("jyu", "じゅ"), ("jyo", "じょ"),
        ("ja",  "じゃ"), ("ji",  "じ"),   ("ju",  "じゅ"), ("je", "じぇ"), ("jo", "じょ"),
        ("tya", "ちゃ"), ("tyu", "ちゅ"), ("tyo", "ちょ"),
        ("nya", "にゃ"), ("nyu", "にゅ"), ("nyo", "にょ"),
        ("hya", "ひゃ"), ("hyu", "ひゅ"), ("hyo", "ひょ"),
        ("mya", "みゃ"), ("myu", "みゅ"), ("myo", "みょ"),
        ("rya", "りゃ"), ("ryu", "りゅ"), ("ryo", "りょ"),
        ("bya", "びゃ"), ("byu", "びゅ"), ("byo", "びょ"),
        ("pya", "ぴゃ"), ("pyu", "ぴゅ"), ("pyo", "ぴょ"),
        ("dya", "ぢゃ"), ("dyu", "ぢゅ"), ("dyo", "ぢょ"),
        ("fa",  "ふぁ"), ("fi", "ふぃ"),  ("fu",  "ふ"),   ("fe", "ふぇ"),  ("fo", "ふぉ"),
        ("va",  "ゔぁ"), ("vi", "ゔぃ"),  ("vu",  "ゔ"),   ("ve", "ゔぇ"),  ("vo", "ゔぉ"),
        ("thi", "てぃ"), ("tha","てゃ"),  ("thu", "てゅ"), ("tho","てょ"),
        ("dhi", "でぃ"), ("dha","でゃ"),  ("dhu", "でゅ"), ("dho","でょ"),
        ("twi", "とぅぃ"),("twu","とぅ"),
        ("dwi", "どぅぃ"),("dwu","どぅ"),
        ("whi", "うぃ"), ("whe","うぇ"),  ("who", "うぉ"),
        ("wi",  "うぃ"), ("we", "うぇ"),
        // ── 促音（次の子音を重ねる）は後処理で対応 ─────────────────
        // ── 基本 ────────────────────────────────────────────────────
        ("ka",  "か"),  ("ki",  "き"),  ("ku",  "く"),  ("ke", "け"),  ("ko", "こ"),
        ("ga",  "が"),  ("gi",  "ぎ"),  ("gu",  "ぐ"),  ("ge", "げ"),  ("go", "ご"),
        ("sa",  "さ"),  ("si",  "し"),  ("su",  "す"),  ("se", "せ"),  ("so", "そ"),
        ("za",  "ざ"),  ("zi",  "じ"),  ("zu",  "ず"),  ("ze", "ぜ"),  ("zo", "ぞ"),
        ("ta",  "た"),  ("ti",  "ち"),  ("tu",  "つ"),  ("te", "て"),  ("to", "と"),
        ("da",  "だ"),  ("di",  "ぢ"),  ("du",  "づ"),  ("de", "で"),  ("do", "ど"),
        ("na",  "な"),  ("ni",  "に"),  ("nu",  "ぬ"),  ("ne", "ね"),  ("no", "の"),
        ("ha",  "は"),  ("hi",  "ひ"),  ("hu",  "ふ"),  ("he", "へ"),  ("ho", "ほ"),
        ("ba",  "ば"),  ("bi",  "び"),  ("bu",  "ぶ"),  ("be", "べ"),  ("bo", "ぼ"),
        ("pa",  "ぱ"),  ("pi",  "ぴ"),  ("pu",  "ぷ"),  ("pe", "ぺ"),  ("po", "ぽ"),
        ("ma",  "ま"),  ("mi",  "み"),  ("mu",  "む"),  ("me", "め"),  ("mo", "も"),
        ("ya",  "や"),  ("yu",  "ゆ"),  ("yo",  "よ"),
        ("ra",  "ら"),  ("ri",  "り"),  ("ru",  "る"),  ("re", "れ"),  ("ro", "ろ"),
        ("wa",  "わ"),  ("wi",  "ゐ"),  ("we",  "ゑ"),  ("wo", "を"),
        ("la",  "ら"),  ("li",  "り"),  ("lu",  "る"),  ("le", "れ"),  ("lo", "ろ"),
        ("a",   "あ"),  ("i",  "い"),   ("u",   "う"),  ("e", "え"),   ("o", "お"),
        ("xa",  "ぁ"),  ("xi", "ぃ"),   ("xu",  "ぅ"),  ("xe","ぇ"),   ("xo","ぉ"),
        ("xtu", "っ"),  ("xtsu","っ"),  ("xya","ゃ"),   ("xyu","ゅ"),  ("xyo","ょ"),
        ("ltu", "っ"),  ("ltsu","っ"),  ("n",  "ん"),
    ];

    // n の後に母音/y が来る場合は「ん」にしない
    static readonly HashSet<char> VowelsAndY = new("aeiouAEIOUyY");

    public static string ToHiragana(string input)
    {
        // スペース区切りでトークンごとに変換
        var parts = input.Split(' ');
        return string.Join("", parts.Select(ConvertToken)).TrimStart();
    }

    static string ConvertToken(string token)
    {
        var src = token.ToLowerInvariant();
        var sb  = new System.Text.StringBuilder();
        int i   = 0;

        while (i < src.Length)
        {
            // 促音: 同じ子音が連続 (ss, kk, tt...) → っ + 残り
            if (i + 1 < src.Length
                && src[i] != 'n'
                && src[i] == src[i + 1]
                && !"aiueo".Contains(src[i]))
            {
                sb.Append('っ');
                i++;
                continue;
            }

            // n + 非母音/非y → ん
            if (src[i] == 'n' && (i + 1 >= src.Length || !VowelsAndY.Contains(src[i + 1])))
            {
                sb.Append('ん');
                i++;
                continue;
            }

            // テーブルを長いキーから照合
            bool matched = false;
            foreach (var (r, h) in Table)
            {
                if (src.Length - i >= r.Length
                    && src.AsSpan(i, r.Length).SequenceEqual(r))
                {
                    sb.Append(h);
                    i += r.Length;
                    matched = true;
                    break;
                }
            }

            if (!matched)
            {
                sb.Append(src[i]);
                i++;
            }
        }

        return sb.ToString();
    }
}
