;;; romaji2text.lisp — ストリーミング型 ローマ字→テキスト変換エンジン (Common Lisp)
;;; ASRと同じ仕組み: 文字蓄積 → 変換 → 結果を順次送信
;;; 誤字補正(fuzzy)・部分変換・カスタム辞書対応
;;;
;;; Usage:
;;;   (load "romaji2text.lisp")
;;;   (let ((engine (romaji2text:make-engine)))
;;;     (romaji2text:on-key engine #\k) (romaji2text:on-key engine #\a))

(in-package :cl-user)
(defpackage :romaji2text
  (:use :cl)
  (:export
   #:make-engine
   #:on-key
   #:flush
   #:commit
   #:preview
   #:committed
   #:add-dict-entry
   #:reset
   #:on-event
   #:text-event
   #:event-type
   #:raw
   #:text
   #:confidence
   #:suggestion))

(in-package :romaji2text)

;; ── Types ───────────────────────────────────────────────────────────────────

(defstruct text-event
  (type       :input      :type keyword)
  (raw        ""          :type string)
  (text       ""          :type string)
  (confidence 0           :type integer)
  (suggestion nil         :type (or null string)))

;; ── Romaji Table ────────────────────────────────────────────────────────────

(defparameter *romaji-table*
  '(("sha" . "しゃ") ("shi" . "し") ("shu" . "しゅ") ("she" . "しぇ") ("sho" . "しょ")
    ("chi" . "ち") ("tchi" . "っち") ("cha" . "ちゃ") ("chu" . "ちゅ") ("che" . "ちぇ") ("cho" . "ちょ")
    ("tsu" . "つ") ("ttsu" . "っつ") ("dzu" . "づ") ("dji" . "ぢ")
    ("kya" . "きゃ") ("kyu" . "きゅ") ("kyo" . "きょ")
    ("gya" . "ぎゃ") ("gyu" . "ぎゅ") ("gyo" . "ぎょ")
    ("sya" . "しゃ") ("syu" . "しゅ") ("syo" . "しょ")
    ("zya" . "じゃ") ("zyu" . "じゅ") ("zyo" . "じょ")
    ("jya" . "じゃ") ("jyu" . "じゅ") ("jyo" . "じょ")
    ("ja" . "じゃ") ("ji" . "じ") ("ju" . "じゅ") ("je" . "じぇ") ("jo" . "じょ")
    ("tya" . "ちゃ") ("tyu" . "ちゅ") ("tyo" . "ちょ")
    ("nya" . "にゃ") ("nyu" . "にゅ") ("nyo" . "にょ")
    ("hya" . "ひゃ") ("hyu" . "ひゅ") ("hyo" . "ひょ")
    ("mya" . "みゃ") ("myu" . "みゅ") ("myo" . "みょ")
    ("rya" . "りゃ") ("ryu" . "りゅ") ("ryo" . "りょ")
    ("bya" . "びゃ") ("byu" . "びゅ") ("byo" . "びょ")
    ("pya" . "ぴゃ") ("pyu" . "ぴゅ") ("pyo" . "ぴょ")
    ("dya" . "ぢゃ") ("dyu" . "ぢゅ") ("dyo" . "ぢょ")
    ("fa" . "ふぁ") ("fi" . "ふぃ") ("fu" . "ふ") ("fe" . "ふぇ") ("fo" . "ふぉ")
    ("va" . "ゔぁ") ("vi" . "ゔぃ") ("vu" . "ゔ") ("ve" . "ゔぇ") ("vo" . "ゔぉ")
    ("thi" . "てぃ") ("tha" . "てゃ") ("thu" . "てゅ") ("tho" . "てょ")
    ("dhi" . "でぃ") ("dha" . "でゃ") ("dhu" . "でゅ") ("dho" . "でょ")
    ("ka" . "か") ("ki" . "き") ("ku" . "く") ("ke" . "け") ("ko" . "こ")
    ("ga" . "が") ("gi" . "ぎ") ("gu" . "ぐ") ("ge" . "げ") ("go" . "ご")
    ("sa" . "さ") ("si" . "し") ("su" . "す") ("se" . "せ") ("so" . "そ")
    ("za" . "ざ") ("zi" . "じ") ("zu" . "ず") ("ze" . "ぜ") ("zo" . "ぞ")
    ("ta" . "た") ("ti" . "ち") ("tu" . "つ") ("te" . "て") ("to" . "と")
    ("da" . "だ") ("di" . "ぢ") ("du" . "づ") ("de" . "で") ("do" . "ど")
    ("na" . "な") ("ni" . "に") ("nu" . "ぬ") ("ne" . "ね") ("no" . "の")
    ("ha" . "は") ("hi" . "ひ") ("hu" . "ふ") ("he" . "へ") ("ho" . "ほ")
    ("ba" . "ば") ("bi" . "び") ("bu" . "ぶ") ("be" . "べ") ("bo" . "ぼ")
    ("pa" . "ぱ") ("pi" . "ぴ") ("pu" . "ぷ") ("pe" . "ぺ") ("po" . "ぽ")
    ("ma" . "ま") ("mi" . "み") ("mu" . "む") ("me" . "め") ("mo" . "も")
    ("ya" . "や") ("yu" . "ゆ") ("yo" . "よ")
    ("ra" . "ら") ("ri" . "り") ("ru" . "る") ("re" . "れ") ("ro" . "ろ")
    ("wa" . "わ") ("wi" . "うぃ") ("we" . "うぇ") ("wo" . "を")
    ("la" . "ら") ("li" . "り") ("lu" . "る") ("le" . "れ") ("lo" . "ろ")
    ("a" . "あ") ("i" . "い") ("u" . "う") ("e" . "え") ("o" . "お")
    ("xa" . "ぁ") ("xi" . "ぃ") ("xu" . "ぅ") ("xe" . "ぇ") ("xo" . "ぉ")
    ("xtu" . "っ") ("xtsu" . "っ") ("xya" . "ゃ") ("xyu" . "ゅ") ("xyo" . "ょ")
    ("ltu" . "っ") ("ltsu" . "っ")))

(defparameter *vowels-y*
  '(#\a #\e #\i #\o #\u #\y))

;; ── Fuzzy Correction Map ────────────────────────────────────────────────────

(defparameter *fuzzy-map*
  '(("chii" . "chi") ("tssu" . "ttsu")
    ("sya" . "sha") ("syu" . "shu") ("syo" . "sho")
    ("zya" . "ja") ("zyu" . "ju") ("zyo" . "jo")
    ("tya" . "cha") ("tyu" . "chu") ("tyo" . "cho")
    ("whi" . "wi") ("v" . "b")
    ("ltu" . "っ") ("ltsu" . "っ")))

;; ── Builtin Dictionary ──────────────────────────────────────────────────────

(defparameter *builtin-dict*
  '(("じんこうちのう"    "人工知能")
    ("きかいがくしゅう"  "機械学習")
    ("せいせいえーあい"  "生成AI")
    ("えーあい"          "AI")
    ("くらうど"          "クラウド")
    ("さーばー"          "サーバー")
    ("でーたべーす"       "データベース")
    ("あぴー"            "API")
    ("ふれーむわーく"     "フレームワーク")
    ("らいぶらりー"       "ライブラリー")
    ("べくとるけんさく"    "ベクトル検索")
    ("えんべでぃんぐ"      "エンベディング")
    ("りあくと"          "React")
    ("のーどじぇいえす"    "Node.js")
    ("たいぷすくりぷと"    "TypeScript")
    ("ぱいそん"          "Python")
    ("でぷろい"          "デプロイ")
    ("りぽじとり"         "リポジトリ")
    ("こみっと"          "コミット")
    ("ぷるりくえすと"      "プルリクエスト")
    ("えーじぇんと"       "エージェント")
    ("あーきてくちゃ"      "アーキテクチャ")
    ("りふぁくたりんぐ"    "リファクタリング")
    ("ぱいぷらいん"       "パイプライン")
    ("どっかー"          "Docker")
    ("くばねてす"         "Kubernetes")
    ("せきゅりてぃ"       "セキュリティ")
    ("ふろんとえんど"      "フロントエンド")
    ("ばっくえんど"       "バックエンド")
    ("よんで"            "呼んで")
    ("つんどく"          "積んどく")
    ("ちかとし"          "地下都市")
    ("きんし"            "菌糸")
    ("きんしねっと"       "菌糸ネット")
    ("はっこうぶんめい"    "発酵文明")
    ("ねんきん"          "年金")
    ("らくご"            "落語")
    ("でぃすとぴあ"       "ディストピア")
    ("えすえふ"          "SF")
    ("とうきょう"         "東京")
    ("にほん"            "日本")
    ("かいしゃ"          "会社")
    ("しごと"            "仕事")
    ("かいぎ"            "会議")
    ("しりょう"          "資料")
    ("ほうこく"          "報告")
    ("れんらく"          "連絡")
    ("けんとう"          "検討")
    ("かくにん"          "確認")
    ("じょうほう"         "情報")
    ("でーた"            "データ")
    ("しすてむ"          "システム")
    ("うぇぶ"            "Web")
    ("あぷり"            "アプリ")
    ("かいとう"          "回答")
    ("しつもん"          "質問")
    ("ないよう"          "内容")
    ("せかい"            "世界")
    ("じかん"            "時間")
    ("にゅうりょく"       "入力")
    ("しゅつりょく"       "出力")
    ("へんかん"          "変換")
    ("せってい"          "設定")))

;; ── Helper Functions ────────────────────────────────────────────────────────

(defun %split-space (str)
  "Split string by space, removing empty parts."
  (loop for start = 0 then (1+ end)
        while (< start (length str))
        for end = (or (position #\Space str :start start) (length str))
        unless (= start end)
        collect (subseq str start end)))

(defun %is-vowel (c)
  (member c '(#\a #\e #\i #\o #\u)))

(defun convert-token (src)
  "Romaji → Hiragana conversion."
  (let ((src (string-downcase src))
        (out "")
        (i 0))
    (loop while (< i (length src)) do
      ;; 促音: 子音連続
      (if (and (< (1+ i) (length src))
               (char/= (char src i) #\n)
               (char= (char src i) (char src (1+ i)))
               (not (%is-vowel (char src i))))
          (progn (setf out (concatenate 'string out "っ"))
                 (incf i))
          ;; n + 非母音 → ん
          (if (and (char= (char src i) #\n)
                   (or (>= (1+ i) (length src))
                       (not (member (char src (1+ i)) *vowels-y*))))
              (progn (setf out (concatenate 'string out "ん"))
                     (incf i))
              ;; テーブル照合
              (let ((matched nil))
                (loop for (r . h) in *romaji-table* while (not matched) do
                  (if (and (>= (- (length src) i) (length r))
                           (string= r src :start2 i :end2 (+ i (length r))))
                      (progn
                        (setf out (concatenate 'string out h))
                        (incf i (length r))
                        (setf matched t))))
                (unless matched
                  (setf out (concatenate 'string out (string (char src i))))
                  (incf i)))))
    out))

(defun levenshtein (a b)
  "Levenshtein edit distance."
  (let* ((na (length a))
         (nb (length b))
         (matrix (make-array (list (1+ na) (1+ nb)) :initial-element 0)))
    (loop for i from 0 to na do (setf (aref matrix i 0) i))
    (loop for j from 0 to nb do (setf (aref matrix 0 j) j))
    (loop for i from 1 to na do
      (loop for j from 1 to nb do
        (let ((cost (if (char= (char a (1- i)) (char b (1- j))) 0 1)))
          (setf (aref matrix i j)
                (min (+ (aref matrix (1- i) j) 1)
                     (+ (aref matrix i (1- j)) 1)
                     (+ (aref matrix (1- i) (1- j)) cost))))))
    (aref matrix na nb)))

(defun fuzzy-score (query target)
  "Fuzzy similarity score (0-100)."
  (cond
    ((string= query target) 100)
    ((and (>= (length target) (length query))
          (string= query target :end2 (length query)))
     (+ 60 (/ (* (length query) 100) (length target) 2)))
    ((let ((qlen (length query))
           (tlen (length target)))
       (and (>= tlen qlen)
            (string= query target :start2 (- tlen qlen) :end2 tlen)))
     40)
    ((search query target) 50)
    (t
     (let* ((dist (levenshtein query target))
            (max-len (max (length query) (length target)))
            (sim (if (= max-len 0) 0 (/ (* (- max-len dist) 100) max-len))))
       (if (> sim 30) sim 0)))))

(defun fuzzy-search-dict (query dict)
  "Search dictionary with fuzzy matching. Returns (key . score) or nil."
  (let ((matches '()))
    (maphash (lambda (key _val)
               (declare (ignore _val))
               (let ((score (fuzzy-score query key)))
                 (when (> score 0)
                   (push (cons key score) matches))))
             dict)
    (when matches
      (first (sort matches #'> :key #'cdr)))))

;; ── Engine ──────────────────────────────────────────────────────────────────

(defstruct engine
  (buffer        (make-array 0 :element-type 'character :adjustable t :fill-pointer 0))
  (committed     ""          :type string)
  (dict          (let ((h (make-hash-table :test 'equal)))
                   (loop for (yomi . candidates) in *builtin-dict*
                         do (setf (gethash yomi h) (list candidates)))
                   h))
  (listeners     (make-hash-table :test 'equal))
  (debounce-ms   350         :type integer))

(defun make-engine (&key (debounce-ms 350))
  "Create a new romaji2text engine."
  (make-engine-struct :debounce-ms debounce-ms))

;; ── Events ──────────────────────────────────────────────────────────────────

(defun on-event (engine type callback)
  "Register event listener."
  (push callback (gethash type (engine-listeners engine) '())))

(defun %emit (engine event)
  "Emit event to listeners."
  (let ((cbs (gethash (text-event-type event) (engine-listeners engine) '()))
        (all (gethash "*" (engine-listeners engine) '())))
    (dolist (cb cbs) (funcall cb event))
    (dolist (cb all) (funcall cb event))))

;; ── Key Input ───────────────────────────────────────────────────────────────

(defun on-key (engine ch)
  "Process a key stroke."
  (let ((ch (char-downcase ch)))
    (cond
      ((char= ch #\Space)
       (let ((ev (flush engine)))
         (vector-push-extend #\Space (engine-buffer engine))
         ev))
      ((member ch '(#\Backspace #\Rubout))
       (let ((buf (engine-buffer engine)))
         (when (> (length buf) 0)
           (decf (fill-pointer buf))))
       (%make-input-event engine))
      ((member ch '(#\Return #\Linefeed))
       (commit engine))
      ((alpha-char-p ch)
       (let ((buf (engine-buffer engine)))
         (when (< (length buf) 500)
           (vector-push-extend ch buf)))
       (%make-input-event engine))
      (t
       (%make-input-event engine)))))

;; ── Flush / Commit ──────────────────────────────────────────────────────────

(defun flush (engine)
  "Flush buffer and convert."
  (let ((buf (engine-buffer engine)))
    (if (= (length buf) 0)
        (make-text-event :type :input :text (engine-committed engine))
        (let* ((raw (coerce buf 'string))
               (tokens (%split-space raw))
               (converted "")
               (total-conf 0)
               (suggestion nil))
          (loop for tok in tokens do
            (let* ((fixed-tok (or (cdr (assoc tok *fuzzy-map* :test 'string=)) tok)))
              (when (and (null suggestion) (string/= fixed-tok tok))
                (setf suggestion (format nil "'~a' → '~a'" tok fixed-tok)))
              (let ((hit (gethash fixed-tok (engine-dict engine)))
                    (fuzzy (fuzzy-search-dict fixed-tok (engine-dict engine))))
                (cond
                  (hit
                   (setf converted (concatenate 'string converted (car hit)))
                   (incf total-conf 95))
                  (fuzzy
                   (setf converted (concatenate 'string converted (car (gethash (car fuzzy) (engine-dict engine)))))
                   (incf total-conf (cdr fuzzy)))
                  (t
                   (let ((hira (convert-token fixed-tok)))
                     (setf converted (concatenate 'string converted hira))
                     (let ((tok-conf (if (string/= hira fixed-tok) 75 25)))
                       (incf total-conf tok-conf)
                       (when (and (< tok-conf 50) (null suggestion))
                         (setf suggestion (format nil "未登録: '~a' → '~a'" fixed-tok hira))))))))))
          (let ((conf (if tokens (truncate total-conf (length tokens)) 0)))
            (make-text-event :type :converted :raw raw :text converted :confidence conf :suggestion suggestion)))))))

(defun commit (engine)
  "Commit current buffer."
  (let ((ev (flush engine)))
    (setf (engine-committed engine)
          (concatenate 'string (engine-committed engine) (text-event-text ev)))
    (setf (fill-pointer (engine-buffer engine)) 0)
    (make-text-event :type :confirmed :text (engine-committed engine) :confidence (text-event-confidence ev))))

(defun committed (engine)
  "Get committed text."
  (engine-committed engine))

;; ── Preview ─────────────────────────────────────────────────────────────────

(defun preview (engine)
  "Preview conversion result."
  (let ((buf (engine-buffer engine)))
    (if (= (length buf) 0)
        (engine-committed engine)
        (let* ((raw (coerce buf 'string))
               (tokens (%split-space raw))
               (out (engine-committed engine)))
          (loop for tok in tokens do
            (let* ((fixed (or (cdr (assoc tok *fuzzy-map* :test 'string=)) tok))
                   (hit (gethash fixed (engine-dict engine)))
                   (fuzzy (fuzzy-search-dict fixed (engine-dict engine))))
              (cond
                (hit
                 (setf out (concatenate 'string out (car hit))))
                (fuzzy
                 (setf out (concatenate 'string out (car (gethash (car fuzzy) (engine-dict engine))))))
                (t
                 (setf out (concatenate 'string out (convert-token fixed)))))))
          out))))

;; ── Dictionary ──────────────────────────────────────────────────────────────

(defun add-dict-entry (engine yomi candidates)
  "Add custom dictionary entry."
  (setf (gethash yomi (engine-dict engine)) candidates))

;; ── Reset ───────────────────────────────────────────────────────────────────

(defun reset (engine)
  "Reset engine state."
  (setf (fill-pointer (engine-buffer engine)) 0)
  (setf (engine-committed engine) ""))

;; ── Private ─────────────────────────────────────────────────────────────────

(defun %make-input-event (engine)
  (make-text-event :type :input
                   :raw (coerce (engine-buffer engine) 'string)
                   :text (preview engine)))
