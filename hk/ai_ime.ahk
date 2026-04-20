; ============================================================
;  AI IME Assistant  v1.0  (AutoHotkey v2)
;  Ctrl+Space  → 選択テキスト or 直前の入力をClaudeに送り
;               言語判定・補完・ローマ字変換をポップアップ表示
;  必要: AutoHotkey v2.0+  /  API keyを↓に貼る
; ============================================================

#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

; ── 設定 ────────────────────────────────────────────────────
ANTHROPIC_API_KEY := "sk-ant-xxxxxxxxxxxxxxxxxx"   ; ← ここにキーを貼る
MODEL             := "claude-sonnet-4-20250514"
MAX_CONTEXT_CHARS := 300   ; 送るテキストの最大文字数
HOTKEY_TRIGGER    := "^Space"   ; Ctrl+Space → 変更可
; ────────────────────────────────────────────────────────────

; トレイアイコンに状態表示
A_TrayMenu.Delete()
A_TrayMenu.Add("AI IME - 待機中", (*) => 0)
A_TrayMenu.Add("終了", (*) => ExitApp())
TraySetIcon("shell32.dll", 23)

; ホットキー登録
HotKey(HOTKEY_TRIGGER, TriggerAI)

; ── メイン処理 ───────────────────────────────────────────────
TriggerAI(*) {
    global

    ; 1) 選択テキスト取得（なければカーソル直前のテキストをクリップボードで取得）
    savedClip := ClipboardAll()
    A_Clipboard := ""
    Send("^c")
    if !ClipWait(0.3) {
        ; 選択なし → 直前テキスト取得のため Shift+Home でラインを選択して取得
        Send("+{Home}")
        Send("^c")
        ClipWait(0.3)
    }
    inputText := A_Clipboard
    A_Clipboard := savedClip

    inputText := Trim(inputText)
    if StrLen(inputText) = 0 {
        ShowTooltip("テキストを選択するか、カーソルを文章の末尾に置いてください", 2000)
        return
    }

    ; 文字数制限
    if StrLen(inputText) > MAX_CONTEXT_CHARS
        inputText := SubStr(inputText, -MAX_CONTEXT_CHARS)

    ; 2) トレイ更新 & 推論開始通知
    TraySetIcon("shell32.dll", 238)
    ShowTooltip("AI 推論中... [" SubStr(inputText,1,20) "...]", 0)

    ; 3) Claude API 呼び出し（同期）
    result := CallClaude(inputText)

    ShowTooltip("", 0)  ; tooltip消去
    TraySetIcon("shell32.dll", 23)

    if !result {
        ShowTooltip("API エラー。キーとネット接続を確認してください", 3000)
        return
    }

    ; 4) GUIポップアップ表示
    ShowResultGui(inputText, result)
}

; ── Claude API 呼び出し ──────────────────────────────────────
CallClaude(text) {
    global ANTHROPIC_API_KEY, MODEL

    prompt := '
(
You are an AI input assistant for a Japanese/English bilingual user.
Analyze the input and respond ONLY with valid JSON, no markdown, no explanation.

Input: "' text '"

JSON structure:
{
  "lang": "ja" or "en" or "mixed",
  "confidence": 0-100,
  "converted": "if romaji input, convert to Japanese kanji/kana. If already correct, return as-is.",
  "completion": "natural short continuation (up to 20 chars)",
  "alt1": "alternative completion 1",
  "alt2": "alternative completion 2",
  "intent": "one short sentence describing what the user is trying to express"
}
Rules:
- romaji like "nihon" → 日本, "uchi" → 家 or 打ち depending on context
- completions must be in the same language as detected
- intent in Japanese
)'

    body := '{"model":"' MODEL '","max_tokens":500,"messages":[{"role":"user","content":' . JSON_Encode(prompt) . '}]}'

    try {
        http := ComObject("WinHttp.WinHttpRequest.5.1")
        http.Open("POST", "https://api.anthropic.com/v1/messages", false)
        http.SetRequestHeader("Content-Type", "application/json")
        http.SetRequestHeader("x-api-key", ANTHROPIC_API_KEY)
        http.SetRequestHeader("anthropic-version", "2023-06-01")
        http.Send(body)
        resp := http.ResponseText
    } catch as e {
        return false
    }

    ; JSONパース（簡易）
    try {
        parsed := SimpleJSONParse(resp)
        ; content[0].text を取り出す
        contentText := parsed["content_text"]
        clean := RegExReplace(contentText, "```json|```", "")
        clean := Trim(clean)
        return SimpleJSONParse(clean)
    } catch {
        return false
    }
}

; ── 結果GUI ─────────────────────────────────────────────────
ShowResultGui(original, r) {
    global

    langMap := Map("ja", "🇯🇵 日本語", "en", "🇺🇸 English", "mixed", "🔀 混在")
    lang      := langMap.Has(r["lang"]) ? langMap[r["lang"]] : r["lang"]
    conf      := r.Has("confidence") ? r["confidence"] : "?"
    converted := r.Has("converted")  ? r["converted"]  : original
    completion:= r.Has("completion") ? r["completion"] : ""
    alt1      := r.Has("alt1")       ? r["alt1"]       : ""
    alt2      := r.Has("alt2")       ? r["alt2"]       : ""
    intent    := r.Has("intent")     ? r["intent"]     : ""

    full1 := converted . completion
    full2 := converted . alt1
    full3 := converted . alt2

    g := Gui("+AlwaysOnTop -Caption +ToolWindow", "AI IME")
    g.BackColor := "1a1a2e"
    g.SetFont("s11 cSilver", "Meiryo UI")

    g.Add("Text", "x10 y8 w380", lang . "  確信度 " . conf . "%")
    g.SetFont("s9 cGray")
    g.Add("Text", "x10 y28 w380", "意図: " . intent)
    g.SetFont("s11 cWhite")

    g.Add("Text", "x10 y52 w40 cAqua", "[1]")
    btn1 := g.Add("Button", "x50 y48 w340 h26", full1)
    btn1.OnEvent("Click", (*) => AcceptAndClose(g, full1, original))

    if alt1 != "" {
        g.Add("Text", "x10 y82 w40 cAqua", "[2]")
        btn2 := g.Add("Button", "x50 y78 w340 h26", full2)
        btn2.OnEvent("Click", (*) => AcceptAndClose(g, full2, original))
    }

    if alt2 != "" {
        g.Add("Text", "x10 y112 w40 cAqua", "[3]")
        btn3 := g.Add("Button", "x50 y108 w340 h26", full3)
        btn3.OnEvent("Click", (*) => AcceptAndClose(g, full3, original))
    }

    g.SetFont("s9 cGray")
    g.Add("Text", "x10 y142 w380", "1/2/3: 選択して確定  Esc: 閉じる")

    ; マウス位置の近くに表示
    CoordMode("Mouse", "Screen")
    MouseGetPos(&mx, &my)
    g.Show("x" (mx+20) " y" (my-80) " w400 NoActivate")

    ; キーボードショートカット
    HotKey("1", (*) => AcceptAndClose(g, full1, original), "On")
    if alt1 != ""
        HotKey("2", (*) => AcceptAndClose(g, full2, original), "On")
    if alt2 != ""
        HotKey("3", (*) => AcceptAndClose(g, full3, original), "On")
    HotKey("Escape", (*) => CloseGui(g), "On")

    g.OnEvent("Close", (*) => CloseGui(g))
}

AcceptAndClose(g, text, original) {
    CloseGui(g)
    ; 元テキストを選択状態にして置換
    A_Clipboard := text
    Send("^v")
}

CloseGui(g) {
    try {
        HotKey("1", "Off")
        HotKey("2", "Off")
        HotKey("3", "Off")
        HotKey("Escape", "Off")
    }
    g.Destroy()
}

; ── ユーティリティ ────────────────────────────────────────────
ShowTooltip(msg, duration) {
    ToolTip(msg, 10, 10)
    if duration > 0
        SetTimer(() => ToolTip(), -duration)
}

; 最小限JSONエンコード（文字列）
JSON_Encode(str) {
    str := StrReplace(str, "\", "\\")
    str := StrReplace(str, '"', '\"')
    str := StrReplace(str, "`n", "\n")
    str := StrReplace(str, "`r", "\r")
    str := StrReplace(str, "`t", "\t")
    return '"' str '"'
}

; 簡易JSONパーサ（Claudeレスポンス専用）
SimpleJSONParse(json) {
    result := Map()

    ; content[0].text を抽出
    if RegExMatch(json, '"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]', &m) {
        ; unescape
        txt := m[1]
        txt := StrReplace(txt, '\n', "`n")
        txt := StrReplace(txt, '\r', "")
        txt := StrReplace(txt, '\"', '"')
        result["content_text"] := txt
        return result
    }

    ; フラットJSONをキーバリューで抽出
    pos := 1
    while RegExMatch(json, '"(\w+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(\d+))', &m, pos) {
        val := m[2] != "" ? m[2] : m[3]
        val := StrReplace(val, '\n', "`n")
        val := StrReplace(val, '\"', '"')
        result[m[1]] := val
        pos := m.Pos + m.Len
    }
    return result
}
