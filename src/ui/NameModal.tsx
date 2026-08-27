"use client";

// 勝者の名前入力モーダル(phase: name-entry)。
// Enterでも送信できる(日本語IMEの変換確定は除外)。

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/game/store";
import { NAME_MAX_LEN } from "@/lib/config";
import "./ui.css";

export default function NameModal() {
  const phase = useGameStore((s) => s.phase);
  const submitName = useGameStore((s) => s.submitName);
  const nickname = useGameStore((s) => s.nickname);
  // タイトルで名前を入れている人は、ここでもう一度打たせない
  const [name, setName] = useState(() => nickname ?? "");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const open = phase === "name-entry";

  // 開いたら入力欄へフォーカス(モバイルはキーボードも開く)
  useEffect(() => {
    if (!open) return;
    setSending(false);
    setName((v) => v || (useGameStore.getState().nickname ?? ""));
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (sending) return;
    setSending(true);
    await submitName(name);
    // 成功時はフェーズが進んで隠れる。失敗時(トースト表示)は再入力に戻す
    setSending(false);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="なまえ入力"
    >
      <div className="modal-card">
        <div className="modal-emoji">🏆</div>
        <h2 className="modal-title">
          トロフィーに
          <br />
          なまえを きざもう
        </h2>
        <input
          ref={inputRef}
          className="name-input"
          type="text"
          value={name}
          maxLength={NAME_MAX_LEN}
          placeholder="なまえ"
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          disabled={sending}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // IMEの変換確定のEnterでは送信しない
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-engrave"
          disabled={sending}
          onClick={() => void submit()}
        >
          {sending ? "きざんでいる…" : "きざむ！"}
        </button>
        <p className="modal-note">※なまえは せかいじゅうから 見えるよ</p>
      </div>
    </div>
  );
}
