// Package romaji2text — ストリーミング型 ローマ字→テキスト変換エンジン (Go)
// ASRと同じ仕組み: 文字蓄積 → debounce後に変換 → 結果を順次送信
// 誤字補正(fuzzy)・部分変換・カスタム辞書対応
//
// Usage:
//
//	engine := romaji2text.New()
//	engine.On("converted", func(ev romaji2text.TextEvent) { fmt.Println(ev.Text) })
//	engine.OnKey("k"); engine.OnKey("a"); engine.OnKey("i")
package romaji2text

import (
	"sort"
	"strings"
	"sync"
	"time"
)

// ── Types ───────────────────────────────────────────────────────────────────

type TextEventType string

const (
	EventInput      TextEventType = "input"
	EventConverted  TextEventType = "converted"
	EventConfirmed  TextEventType = "confirmed"
	EventCorrection TextEventType = "correction"
)

type TextEvent struct {
	Type       TextEventType
	Raw        string
	Text       string
	Confidence int
	Suggestion string
}

// ── Romaji Table ────────────────────────────────────────────────────────────

var romajiTable = []struct{ R, H string }{
	{"sha", "しゃ"}, {"shi", "し"}, {"shu", "しゅ"}, {"she", "しぇ"}, {"sho", "しょ"},
	{"chi", "ち"}, {"tchi", "っち"}, {"cha", "ちゃ"}, {"chu", "ちゅ"}, {"che", "ちぇ"}, {"cho", "ちょ"},
	{"tsu", "つ"}, {"ttsu", "っつ"}, {"dzu", "づ"}, {"dji", "ぢ"},
	{"kya", "きゃ"}, {"kyu", "きゅ"}, {"kyo", "きょ"},
	{"gya", "ぎゃ"}, {"gyu", "ぎゅ"}, {"gyo", "ぎょ"},
	{"sya", "しゃ"}, {"syu", "しゅ"}, {"syo", "しょ"},
	{"zya", "じゃ"}, {"zyu", "じゅ"}, {"zyo", "じょ"},
	{"jya", "じゃ"}, {"jyu", "じゅ"}, {"jyo", "じょ"},
	{"ja", "じゃ"}, {"ji", "じ"}, {"ju", "じゅ"}, {"je", "じぇ"}, {"jo", "じょ"},
	{"tya", "ちゃ"}, {"tyu", "ちゅ"}, {"tyo", "ちょ"},
	{"nya", "にゃ"}, {"nyu", "にゅ"}, {"nyo", "にょ"},
	{"hya", "ひゃ"}, {"hyu", "ひゅ"}, {"hyo", "ひょ"},
	{"mya", "みゃ"}, {"myu", "みゅ"}, {"myo", "みょ"},
	{"rya", "りゃ"}, {"ryu", "りゅ"}, {"ryo", "りょ"},
	{"bya", "びゃ"}, {"byu", "びゅ"}, {"byo", "びょ"},
	{"pya", "ぴゃ"}, {"pyu", "ぴゅ"}, {"pyo", "ぴょ"},
	{"dya", "ぢゃ"}, {"dyu", "ぢゅ"}, {"dyo", "ぢょ"},
	{"fa", "ふぁ"}, {"fi", "ふぃ"}, {"fu", "ふ"}, {"fe", "ふぇ"}, {"fo", "ふぉ"},
	{"va", "ゔぁ"}, {"vi", "ゔぃ"}, {"vu", "ゔ"}, {"ve", "ゔぇ"}, {"vo", "ゔぉ"},
	{"thi", "てぃ"}, {"tha", "てゃ"}, {"thu", "てゅ"}, {"tho", "てょ"},
	{"dhi", "でぃ"}, {"dha", "でゃ"}, {"dhu", "でゅ"}, {"dho", "でょ"},
	{"ka", "か"}, {"ki", "き"}, {"ku", "く"}, {"ke", "け"}, {"ko", "こ"},
	{"ga", "が"}, {"gi", "ぎ"}, {"gu", "ぐ"}, {"ge", "げ"}, {"go", "ご"},
	{"sa", "さ"}, {"si", "し"}, {"su", "す"}, {"se", "せ"}, {"so", "そ"},
	{"za", "ざ"}, {"zi", "じ"}, {"zu", "ず"}, {"ze", "ぜ"}, {"zo", "ぞ"},
	{"ta", "た"}, {"ti", "ち"}, {"tu", "つ"}, {"te", "て"}, {"to", "と"},
	{"da", "だ"}, {"di", "ぢ"}, {"du", "づ"}, {"de", "で"}, {"do", "ど"},
	{"na", "な"}, {"ni", "に"}, {"nu", "ぬ"}, {"ne", "ね"}, {"no", "の"},
	{"ha", "は"}, {"hi", "ひ"}, {"hu", "ふ"}, {"he", "へ"}, {"ho", "ほ"},
	{"ba", "ば"}, {"bi", "び"}, {"bu", "ぶ"}, {"be", "べ"}, {"bo", "ぼ"},
	{"pa", "ぱ"}, {"pi", "ぴ"}, {"pu", "ぷ"}, {"pe", "ぺ"}, {"po", "ぽ"},
	{"ma", "ま"}, {"mi", "み"}, {"mu", "む"}, {"me", "め"}, {"mo", "も"},
	{"ya", "や"}, {"yu", "ゆ"}, {"yo", "よ"},
	{"ra", "ら"}, {"ri", "り"}, {"ru", "る"}, {"re", "れ"}, {"ro", "ろ"},
	{"wa", "わ"}, {"wi", "うぃ"}, {"we", "うぇ"}, {"wo", "を"},
	{"la", "ら"}, {"li", "り"}, {"lu", "る"}, {"le", "れ"}, {"lo", "ろ"},
	{"a", "あ"}, {"i", "い"}, {"u", "う"}, {"e", "え"}, {"o", "お"},
	{"xa", "ぁ"}, {"xi", "ぃ"}, {"xu", "ぅ"}, {"xe", "ぇ"}, {"xo", "ぉ"},
	{"xtu", "っ"}, {"xtsu", "っ"}, {"xya", "ゃ"}, {"xyu", "ゅ"}, {"xyo", "ょ"},
	{"ltu", "っ"}, {"ltsu", "っ"},
}

var vowelsY = map[rune]bool{
	'a': true, 'e': true, 'i': true, 'o': true, 'u': true, 'y': true,
}

// ── Fuzzy Correction Map ────────────────────────────────────────────────────

var fuzzyMap = map[string]string{
	"chii": "chi", "tssu": "ttsu",
	"sya": "sha", "syu": "shu", "syo": "sho",
	"zya": "ja", "zyu": "ju", "zyo": "jo",
	"tya": "cha", "tyu": "chu", "tyo": "cho",
	"whi": "wi", "v": "b",
	"ltu": "っ", "ltsu": "っ",
}

// ── Builtin Dictionary ──────────────────────────────────────────────────────

var builtinDict = map[string][]string{
	"じんこうちのう":   {"人工知能"},
	"きかいがくしゅう": {"機械学習"},
	"せいせいえーあい": {"生成AI"},
	"えーあい":       {"AI"},
	"くらうど":       {"クラウド"},
	"さーばー":       {"サーバー", "サーバ"},
	"でーたべーす":    {"データベース"},
	"あぴー":        {"API"},
	"ふれーむわーく":  {"フレームワーク"},
	"らいぶらりー":    {"ライブラリー", "ライブラリ"},
	"べくとるけんさく":  {"ベクトル検索"},
	"えんべでぃんぐ":   {"エンベディング"},
	"りあくと":       {"React"},
	"のーどじぇいえす":  {"Node.js"},
	"たいぷすくりぷと":  {"TypeScript"},
	"ぱいそん":       {"Python"},
	"でぷろい":       {"デプロイ"},
	"りぽじとり":      {"リポジトリ"},
	"こみっと":       {"コミット"},
	"ぷるりくえすと":   {"プルリクエスト"},
	"えーじぇんと":     {"エージェント"},
	"あーきてくちゃ":    {"アーキテクチャ"},
	"でざいんぱたーん":   {"デザインパターン"},
	"りふぁくたりんぐ":   {"リファクタリング"},
	"ぱいぷらいん":     {"パイプライン"},
	"どっかー":       {"Docker"},
	"くばねてす":      {"Kubernetes"},
	"せきゅりてぃ":     {"セキュリティ"},
	"とーくん":       {"トークン"},
	"ふろんとえんど":    {"フロントエンド"},
	"ばっくえんど":     {"バックエンド"},
	"すけーらびりてぃ":   {"スケーラビリティ"},
	"よんで":        {"呼んで"},
	"つんどく":       {"積んどく"},
	"こんみゃく":      {"絡み"},
	"ちかとし":       {"地下都市"},
	"きんし":        {"菌糸"},
	"きんしねっと":     {"菌糸ネット"},
	"はっこうぶんめい":   {"発酵文明"},
	"ねんきん":       {"年金"},
	"ねんきんこんぴゅーた": {"年金コンピュータ"},
	"らくご":        {"落語"},
	"でぃすとぴあ":     {"ディストピア"},
	"えすえふ":       {"SF"},
	"とうきょう":      {"東京"},
	"にほん":        {"日本"},
	"かいしゃ":       {"会社"},
	"しごと":        {"仕事"},
	"かいぎ":        {"会議"},
	"しりょう":       {"資料"},
	"ほうこく":       {"報告"},
	"れんらく":       {"連絡"},
	"けんとう":       {"検討"},
	"かくにん":       {"確認"},
	"じょうほう":      {"情報"},
	"でーた":        {"データ"},
	"しすてむ":       {"システム"},
	"うぇぶ":        {"Web"},
	"あぷり":        {"アプリ"},
	"かいとう":       {"回答", "解答"},
	"しつもん":       {"質問"},
	"ないよう":       {"内容"},
	"せかい":        {"世界"},
	"じかん":        {"時間"},
	"にゅうりょく":     {"入力"},
	"しゅつりょく":     {"出力"},
	"へんかん":       {"変換"},
	"せってい":       {"設定"},
}

// ── Engine ──────────────────────────────────────────────────────────────────

type Callback func(TextEvent)

type Engine struct {
	mu            sync.Mutex
	buffer        []rune
	committed     string
	dict          map[string][]string
	listeners     map[TextEventType][]Callback
	debounceTimer *time.Timer
	DebounceMs    int
}

func New() *Engine {
	dict := make(map[string][]string, len(builtinDict))
	for k, v := range builtinDict {
		dict[k] = v
	}
	return &Engine{
		dict:      dict,
		listeners: make(map[TextEventType][]Callback),
		DebounceMs: 350,
	}
}

// ── Event Listeners ─────────────────────────────────────────────────────────

func (e *Engine) On(typ TextEventType, cb Callback) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.listeners[typ] = append(e.listeners[typ], cb)
}

func (e *Engine) Off(typ TextEventType, cb Callback) {
	e.mu.Lock()
	defer e.mu.Unlock()
	arr := e.listeners[typ]
	for i, c := range arr {
		if &c == &cb {
			e.listeners[typ] = append(arr[:i], arr[i+1:]...)
			break
		}
	}
}

func (e *Engine) emit(ev TextEvent) {
	e.mu.Lock()
	cbs := append([]Callback{}, e.listeners[ev.Type]...)
	all := append([]Callback{}, e.listeners["*"]...)
	e.mu.Unlock()
	for _, cb := range cbs {
		cb(ev)
	}
	for _, cb := range all {
		cb(ev)
	}
}

// ── Key Stroke ──────────────────────────────────────────────────────────────

func (e *Engine) OnKey(ch rune) TextEvent {
	e.mu.Lock()
	defer e.mu.Unlock()

	switch ch {
	case ' ':
		ev := e.flush()
		e.buffer = append(e.buffer, ' ')
		e.scheduleDebounce()
		return ev
	case '\b', '\x7f':
		if len(e.buffer) > 0 {
			e.buffer = e.buffer[:len(e.buffer)-1]
		}
		e.resetDebounce()
		return e.makeInputEventLocked()
	case '\r', '\n':
		e.stopDebounce()
		return e.commit()
	}

	lower := ch
	if lower >= 'A' && lower <= 'Z' {
		lower += 'a' - 'A'
	}

	if lower >= 'a' && lower <= 'z' {
		if len(e.buffer) < 500 {
			e.buffer = append(e.buffer, lower)
			e.scheduleDebounce()
			return e.makeInputEventLocked()
		}
	}

	return e.makeInputEventLocked()
}

// ── Debounce ────────────────────────────────────────────────────────────────

func (e *Engine) scheduleDebounce() {
	e.stopDebounce()
	e.debounceTimer = time.AfterFunc(time.Duration(e.DebounceMs)*time.Millisecond, func() {
		ev := e.Flush()
		e.emit(ev)
	})
}

func (e *Engine) resetDebounce() {
	e.stopDebounce()
	if len(e.buffer) > 0 {
		e.scheduleDebounce()
	}
}

func (e *Engine) stopDebounce() {
	if e.debounceTimer != nil {
		e.debounceTimer.Stop()
		e.debounceTimer = nil
	}
}

// ── Flush → Convert ─────────────────────────────────────────────────────────

func (e *Engine) Flush() TextEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.flush()
}

func (e *Engine) flush() TextEvent {
	if len(e.buffer) == 0 {
		return TextEvent{Type: EventInput, Text: e.committed}
	}

	raw := string(e.buffer)
	tokens := strings.Fields(raw)

	var converted string
	var totalConf int
	var suggestion string

	for _, tok := range tokens {
		fixedTok := tok
		if m, ok := fuzzyMap[tok]; ok {
			fixedTok = m
			if suggestion == "" {
				suggestion = "'" + tok + "' → '" + m + "'"
			}
		}

		// Dictionary exact match
		if hits, ok := e.dict[fixedTok]; ok {
			converted += hits[0]
			totalConf += 95
			continue
		}

		// Prefix match (fuzzy file search style)
		prefix, pScore := fuzzySearchDict(fixedTok, e.dict)
		if prefix != "" {
			converted += e.dict[prefix][0]
			totalConf += pScore
			continue
		}

		// Romaji → Hiragana
		hira := convertToken(fixedTok)
		converted += hira
		tokConf := 75
		if hira == fixedTok {
			tokConf = 25
		}
		totalConf += tokConf

		if tokConf < 50 && suggestion == "" {
			suggestion = "未登録: '" + fixedTok + "' → '" + hira + "'"
		}
	}

	conf := 0
	if len(tokens) > 0 {
		conf = totalConf / len(tokens)
	}

	return TextEvent{
		Type:       EventConverted,
		Raw:        raw,
		Text:       converted,
		Confidence: conf,
		Suggestion: suggestion,
	}
}

// ── Fuzzy Dictionary Search (あいまいファイル検索) ─────────────────────────

// fuzzySearchDict searches the dictionary with fuzzy matching.
// Returns the best match and its confidence score.
func fuzzySearchDict(query string, dict map[string][]string) (string, int) {
	type match struct {
		key   string
		score int
	}
	var matches []match

	for k := range dict {
		score := fuzzyScore(query, k)
		if score > 0 {
			matches = append(matches, match{k, score})
		}
	}
	if len(matches) == 0 {
		return "", 0
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].score > matches[j].score
	})
	return matches[0].key, matches[0].score
}

// fuzzyScore returns a similarity score (0-100) between query and target.
// Uses a combination of prefix match, Levenshtein, and phonetic similarity.
func fuzzyScore(query, target string) int {
	if query == target {
		return 100
	}

	// Prefix match
	if strings.HasPrefix(target, query) {
		return 60 + len(query)*100/len(target)/2
	}

	// Suffix match
	if strings.HasSuffix(target, query) {
		return 40
	}

	// Contains match
	if strings.Contains(target, query) {
		return 50
	}

	// Levenshtein distance
	dist := levenshtein(query, target)
	maxLen := len(query)
	if len(target) > maxLen {
		maxLen = len(target)
	}
	if maxLen == 0 {
		return 0
	}
	similarity := (maxLen - dist) * 100 / maxLen
	if similarity > 30 {
		return similarity
	}

	return 0
}

// levenshtein calculates the edit distance between two strings.
func levenshtein(a, b string) int {
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}

	matrix := make([][]int, len(a)+1)
	for i := range matrix {
		matrix[i] = make([]int, len(b)+1)
		matrix[i][0] = i
	}
	for j := 0; j <= len(b); j++ {
		matrix[0][j] = j
	}

	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			matrix[i][j] = min3(
				matrix[i-1][j]+1,      // deletion
				matrix[i][j-1]+1,      // insertion
				matrix[i-1][j-1]+cost, // substitution
			)
		}
	}

	return matrix[len(a)][len(b)]
}

func min3(a, b, c int) int {
	if a < b && a < c {
		return a
	}
	if b < c {
		return b
	}
	return c
}

// ── Commit ──────────────────────────────────────────────────────────────────

func (e *Engine) Commit() TextEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.commit()
}

func (e *Engine) commit() TextEvent {
	ev := e.flush()
	e.committed += ev.Text
	e.buffer = nil
	return TextEvent{
		Type:       EventConfirmed,
		Text:       e.committed,
		Confidence: ev.Confidence,
	}
}

func (e *Engine) Committed() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.committed
}

// ── Preview ─────────────────────────────────────────────────────────────────

func (e *Engine) Preview() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.previewLocked()
}

func (e *Engine) previewLocked() string {
	if len(e.buffer) == 0 {
		return e.committed
	}

	raw := string(e.buffer)
	tokens := strings.Fields(raw)
	out := e.committed

	for _, tok := range tokens {
		fixed := tok
		if m, ok := fuzzyMap[tok]; ok {
			fixed = m
		}
		if hits, ok := e.dict[fixed]; ok {
			out += hits[0]
			continue
		}
		prefix, _ := fuzzySearchDict(fixed, e.dict)
		if prefix != "" {
			out += e.dict[prefix][0]
			continue
		}
		out += convertToken(fixed)
	}
	return out
}

// ── Custom Dictionary ───────────────────────────────────────────────────────

func (e *Engine) AddDictEntry(yomi string, candidates []string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.dict[yomi] = candidates
}

// ── Reset ───────────────────────────────────────────────────────────────────

func (e *Engine) Reset() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.buffer = nil
	e.committed = ""
	e.stopDebounce()
}

// ── Private Helpers ─────────────────────────────────────────────────────────

func (e *Engine) makeInputEvent() TextEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.makeInputEventLocked()
}

func (e *Engine) makeInputEventLocked() TextEvent {
	raw := string(e.buffer)
	return TextEvent{
		Type: EventInput,
		Raw:  raw,
		Text: e.previewLocked(),
	}
}

// ── Romaji → Hiragana ───────────────────────────────────────────────────────

func convertToken(src string) string {
	src = strings.ToLower(src)
	var out strings.Builder
	i := 0

	for i < len(src) {
		// 促音: 子音連続
		if i+1 < len(src) && src[i] != 'n' && src[i] == src[i+1] && !isVowel(src[i]) {
			out.WriteRune('っ')
			i++
			continue
		}
		// n + 非母音 → ん
		if src[i] == 'n' && (i+1 >= len(src) || !vowelsY[rune(src[i+1])]) {
			out.WriteRune('ん')
			i++
			continue
		}
		// テーブル照合
		matched := false
		for _, entry := range romajiTable {
			r := entry.R
			if len(src)-i >= len(r) && src[i:i+len(r)] == r {
				out.WriteString(entry.H)
				i += len(r)
				matched = true
				break
			}
		}
		if !matched {
			out.WriteByte(src[i])
			i++
		}
	}
	return out.String()
}

func isVowel(c byte) bool {
	return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u'
}
