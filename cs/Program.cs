// Program.cs — AI IME  エントリポイント & システムトレイ常駐
//
// SETUP:
//   1. ソリューションに .csproj（UseWindowsForms=true, WebView2参照）を配置
//   2. ANTHROPIC_API_KEY 環境変数をセット（省略可 → ローカルのみ動作）
//   3. dotnet run  または Release ビルド後 AiIme.exe を実行
//
// USAGE:
//   テキストを Ctrl+C でコピー → Ctrl+Space → ポップアップ表示
//   1〜4 キーで候補確定 → クリップボードに書き戻し → Ctrl+V でペースト
//   タスクトレイアイコン右クリック → 設定（custom_dict.json）/ 終了

using System.Runtime.InteropServices;

namespace AiIme;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TrayApp — システムトレイ常駐 + Ctrl+Space グローバルホットキー
// ─────────────────────────────────────────────────────────────────────────────
sealed class TrayApp : ApplicationContext
{
    [DllImport("user32.dll")] static extern bool RegisterHotKey  (IntPtr hWnd, int id, uint mod, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    const int  HOTKEY_ID = 1;
    const uint MOD_CTRL  = 0x0002;
    const uint MOD_NOREP = 0x4000; // MOD_NOREPEAT
    const uint VK_SPACE  = 0x0020;

    readonly NotifyIcon   _tray;
    readonly HotkeyWindow _hkWin;
    readonly Pipeline     _pipeline;
    PopupForm?            _popup;

    public TrayApp()
    {
        _pipeline = new Pipeline();

        _tray = new NotifyIcon
        {
            Icon             = SystemIcons.Application,
            Text             = "AI IME — 待機中",
            Visible          = true,
            ContextMenuStrip = BuildMenu(),
        };

        _hkWin = new HotkeyWindow();
        _hkWin.HotkeyPressed += OnHotkey;
        RegisterHotKey(_hkWin.Handle, HOTKEY_ID, MOD_CTRL | MOD_NOREP, VK_SPACE);
    }

    ContextMenuStrip BuildMenu()
    {
        var m = new ContextMenuStrip();
        m.Items.Add("辞書を編集 (custom_dict.json)", null, (_, _) => OpenDict());
        m.Items.Add("辞書を再読込",                  null, (_, _) => { _pipeline.ReloadCustomDict(); ShowBalloon("辞書を再読込しました"); });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("終了", null, (_, _) => Exit());
        return m;
    }

    // Ctrl+Space が押されたとき
    async void OnHotkey()
    {
        _popup?.Close();
        _tray.Text = "AI IME — 推論中...";

        // STA スレッドで Clipboard 取得
        var text = string.Empty;
        var thr  = new Thread(() => text = Clipboard.GetText().Trim());
        thr.SetApartmentState(ApartmentState.STA);
        thr.Start(); thr.Join();

        if (string.IsNullOrWhiteSpace(text))
        {
            ShowBalloon("テキストをコピーしてから Ctrl+Space を押してください");
            _tray.Text = "AI IME — 待機中";
            return;
        }

        var result = await _pipeline.InferAsync(text);
        _tray.Text  = "AI IME — 待機中";

        _popup = new PopupForm(text, result);
        _popup.Accepted += chosen =>
        {
            var t = new Thread(() => Clipboard.SetText(chosen));
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            ShowBalloon($"コピー完了: {Truncate(chosen, 30)}");
        };
        _popup.Show();
    }

    void OpenDict()
    {
        Pipeline.EnsureCustomDict();
        System.Diagnostics.Process.Start("notepad.exe", Pipeline.CustomDictPath);
    }

    void ShowBalloon(string msg) =>
        _tray.ShowBalloonTip(2000, "AI IME", msg, ToolTipIcon.Info);

    static string Truncate(string s, int n) =>
        s.Length <= n ? s : s[..n] + "…";

    void Exit()
    {
        UnregisterHotKey(_hkWin.Handle, HOTKEY_ID);
        _tray.Visible = false;
        Application.Exit();
    }

    protected override void Dispose(bool d)
    {
        if (d) { _tray.Dispose(); _hkWin.Dispose(); }
        base.Dispose(d);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HotkeyWindow — WM_HOTKEY を受け取るだけの不可視ウィンドウ
// ─────────────────────────────────────────────────────────────────────────────
sealed class HotkeyWindow : NativeWindow, IDisposable
{
    const int WM_HOTKEY = 0x0312;
    public event Action? HotkeyPressed;

    public HotkeyWindow() =>
        CreateHandle(new CreateParams { Caption = "AiIme_HotkeyReceiver" });

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY) HotkeyPressed?.Invoke();
        base.WndProc(ref m);
    }

    public void Dispose() => DestroyHandle();
}
