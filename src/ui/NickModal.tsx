"use client";

// ニックネームを決める小さなモーダル。
//
// タイトルに入力欄を直接置いてみたが、後ろに3Dのこすくまくんと月がいるので
// 「入力できるもの」に見えず、頭の上に字が重なって汚かった。
// 暗い幕を1枚はさむだけで読めるようになるので、モーダルにしてある。

import { useEffect, useRef, useState } from "react";
import { NAME_MAX_LEN } from "@/lib/config";
import { useGameStore } from "@/game/store";
import "./ui.css";
import "./nick.css";

interface NickModalProps {
  open: boolean;
  onClose: () => void;
}

export default function NickModal({ open, onClose }: NickModalProps) {
  const nickname = useGameStore((s) => s.nickname);
  const setNickname = useGameStore((s) => s.setNickname);
  const [name, setName] = useState(nickname ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(useGameStore.getState().nickname ?? "");
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const save = () => {
    setNickname(name);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="なまえ"
      onClick={(e) => {
        if (e.target === e.currentTarget) save();
      }}
    >
      <div className="modal-card">
        <h2 className="modal-title">なまえ</h2>
        <p className="nick-lead">
          いれると 左下の「せかいの ようす」に
          <br />
          この名前で のこるよ。
          <br />
          いれなくても あそべる。
        </p>
        <div className="nick nick-in-modal">
          <input
            ref={inputRef}
            className="nick-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={NAME_MAX_LEN}
            placeholder="ニックネーム"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // 日本語の変換確定でうっかり閉じないように
              if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
            }}
          />
          <span className="nick-preview">
            {name.trim() ? `「${name.trim()}が 刺した」と のこるよ` : " "}
          </span>
        </div>
        <button type="button" className="btn btn-primary" onClick={save}>
          {name.trim() ? "きめる" : "なまえなしで すすむ"}
        </button>
      </div>
    </div>
  );
}
