// PopupForm.cs — 推論結果ポップアップ
//
// キーボード操作:
//   1〜4  → 候補を確定してクリップボードへ
//   Tab   → 1番候補を確定
//   Esc   → キャンセル
//
// ShowWithoutActivation = true でフォーカスを奪わない。
// 入力中のアプリを邪魔しないのでそのまま Ctrl+V で貼り付けられる。

namespace AiIme;

sealed class PopupForm : Form
{
    public event Action<string>? Accepted;

    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x08000000; return cp; }
    }

    static readonly Color BG        = Color.FromArgb(22, 22, 34);
    static readonly Color BG2       = Color.FromArgb(34, 34, 50);
    static readonly Color FG        = Color.FromArgb(220, 220, 240);
    static readonly Color FG_DIM    = Color.FromArgb(120, 120, 155);
    static readonly Color BORDER    = Color.FromArgb(55, 55, 85);
    static readonly Color BTN_HOVER = Color.FromArgb(48, 68, 108);

    readonly string[] _options;

    public PopupForm(string original, InferResult result)
    {
        _options = result.Completions.Take(4).ToArray();

        FormBorderStyle = FormBorderStyle.None;
        BackColor       = BG;
        ShowInTaskbar   = false;
        TopMost         = true;
        KeyPreview      = true;

        var panel = new Panel { Dock = DockStyle.Fill, BackColor = BG, Padding = new Padding(12, 10, 12, 12) };
        Controls.Add(panel);

        // ── ソース・言語バッジ ──────────────────────────────────────────────────
        var srcColor = result.Source switch
        {
            "custom" or "custom-prefix"  => Color.FromArgb(90, 200, 110),
            "builtin" or "builtin-prefix"=> Color.FromArgb(90, 150, 255),
            "api"                        => Color.FromArgb(255, 195, 75),
            _                            => FG_DIM,
        };
        var langLabel = result.Lang switch
        {
            "ja"     => "日本語", "en" => "English",
            "romaji" => "ローマ字", "mixed" => "混在",
            _        => result.Lang,
        };

        int y = 10;
        Add(panel, new Label
        {
            Text      = $"[{result.Source}]  {langLabel}  {result.Confidence}%",
            ForeColor = srcColor, BackColor = Color.Transparent,
            Font      = new Font("Meiryo UI", 10),
            Location  = new Point(12, y), AutoSize = true,
        });
        y += 22;

        // 変換表示
        if (result.Converted != original && result.Converted.Length > 0)
        {
            Add(panel, new Label
            {
                Text      = $"{Cut(original, 24)}  →  {Cut(result.Converted, 28)}",
                ForeColor = FG_DIM, BackColor = Color.Transparent,
                Font      = new Font("Meiryo UI", 10),
                Location  = new Point(12, y), AutoSize = true,
            });
            y += 20;
        }

        // 意図
        if (!string.IsNullOrEmpty(result.Intent))
        {
            Add(panel, new Label
            {
                Text      = $"意図: {Cut(result.Intent, 48)}",
                ForeColor = FG_DIM, BackColor = Color.Transparent,
                Font      = new Font("Meiryo UI", 10),
                Location  = new Point(12, y), AutoSize = true,
            });
            y += 20;
        }

        // セパレータ
        y += 4;
        Add(panel, new Panel { Left = 12, Top = y, Width = 370, Height = 1, BackColor = BORDER });
        y += 10;

        // 候補ボタン
        for (int i = 0; i < _options.Length; i++)
        {
            int idx = i;
            var btn = new Button
            {
                Text      = $"[{i + 1}]  {Cut(_options[i], 48)}",
                Left      = 12, Top = y, Width = 374, Height = 30,
                FlatStyle = FlatStyle.Flat,
                BackColor = BG2, ForeColor = FG,
                Font      = new Font("Meiryo UI", 11),
                TextAlign = ContentAlignment.MiddleLeft,
                Cursor    = Cursors.Hand,
            };
            btn.FlatAppearance.BorderColor         = BORDER;
            btn.FlatAppearance.BorderSize          = 1;
            btn.FlatAppearance.MouseOverBackColor  = BTN_HOVER;
            btn.FlatAppearance.MouseDownBackColor  = Color.FromArgb(55, 85, 135);
            btn.Click += (_, _) => Choose(idx);
            Add(panel, btn);
            y += 34;
        }

        // ヒント
        y += 4;
        Add(panel, new Label
        {
            Text      = "1〜4: 確定  Tab: 1番  Esc: キャンセル",
            ForeColor = FG_DIM, BackColor = Color.Transparent,
            Font      = new Font("Meiryo UI", 9),
            Location  = new Point(12, y), AutoSize = true,
        });
        y += 20;

        ClientSize = new Size(400, y + 10);
        PositionNearCursor();
        Deactivate += (_, _) => Close();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) { Close(); return; }
        if (e.KeyCode == Keys.Tab)    { Choose(0); return; }
        int idx = e.KeyCode switch
        {
            Keys.D1 or Keys.NumPad1 => 0,
            Keys.D2 or Keys.NumPad2 => 1,
            Keys.D3 or Keys.NumPad3 => 2,
            Keys.D4 or Keys.NumPad4 => 3,
            _ => -1,
        };
        if (idx >= 0 && idx < _options.Length) Choose(idx);
    }

    void Choose(int idx)
    {
        if (idx < 0 || idx >= _options.Length) return;
        Accepted?.Invoke(_options[idx]);
        Close();
    }

    void PositionNearCursor()
    {
        var cur    = Cursor.Position;
        var screen = Screen.FromPoint(cur).WorkingArea;
        Location   = new Point(
            Math.Max(screen.Left, Math.Min(cur.X + 16, screen.Right  - Width)),
            Math.Max(screen.Top,  Math.Min(cur.Y + 16, screen.Bottom - Height)));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        ControlPaint.DrawBorder(e.Graphics, ClientRectangle,
            BORDER, 1, ButtonBorderStyle.Solid, BORDER, 1, ButtonBorderStyle.Solid,
            BORDER, 1, ButtonBorderStyle.Solid, BORDER, 1, ButtonBorderStyle.Solid);
    }

    static void Add(Panel p, Control c) => p.Controls.Add(c);
    static string Cut(string s, int n) => s.Length <= n ? s : s[..n] + "…";
}
