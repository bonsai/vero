;;; test-romaji2text.lisp — デモ＆テスト

(load "romaji2text.lisp")
(in-package :romaji2text)

(defun demo ()
  (format t "~&=== AI IME Romaji2Text (Common Lisp) ===~%~%")

  ;; Basic conversion
  (let ((eng (make-engine)))
    (on-event eng :converted (lambda (ev)
                               (format t "[converted] ~a (conf: ~d%)~%" (text ev) (confidence ev))))

    (format t "--- Typing: k-a-i-s-h-a ---~%")
    (on-key eng #\k) (on-key eng #\a) (on-key eng #\i)
    (on-key eng #\s) (on-key eng #\h) (on-key eng #\a)

    (let ((ev (flush eng)))
      (format t "Result: ~a (conf: ~d%)~%~%" (text ev) (confidence ev)))

    ;; Fuzzy test
    (format t "--- Fuzzy: sya (→ sha) ---~%")
    (let ((eng2 (make-engine)))
      (on-key eng2 #\s) (on-key eng2 #\y) (on-key eng2 #\a)
      (let ((ev2 (flush eng2)))
        (format t "Result: ~a (suggestion: ~a)~%~%" (text ev2) (suggestion ev2))))

    ;; Commit test
    (format t "--- Commit: a-i-space-u-e ---~%")
    (let ((eng3 (make-engine)))
      (on-key eng3 #\a) (on-key eng3 #\i) (on-key eng3 #\Space)
      (on-key eng3 #\u) (on-key eng3 #\e)
      (commit eng3)
      (format t "Committed: ~a~%~%" (committed eng3)))

    ;; Preview test
    (format t "--- Preview: t-o-u-k-y-o-u ---~%")
    (let ((eng4 (make-engine)))
      (on-key eng4 #\t) (on-key eng4 #\o) (on-key eng4 #\u)
      (on-key eng4 #\k) (on-key eng4 #\y) (on-key eng4 #\o) (on-key eng4 #\u)
      (format t "Preview: ~a~%~%" (preview eng4)))

    ;; Fuzzy search (partial match)
    (format t "--- Fuzzy search: きんし (partial of きんしねっと) ---~%")
    (let ((eng5 (make-engine)))
      (let ((result (fuzzy-search-dict "きんし" (engine-dict eng5))))
        (if result
            (format t "Match: ~a (score: ~d)~%~%" (car result) (cdr result))
            (format t "No match~%~%"))))

    (format t "=== Demo Complete ===~%")))

(demo)
