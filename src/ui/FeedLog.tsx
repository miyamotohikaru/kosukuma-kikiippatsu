"use client";

// 左下のチャットの「ぜんぶ みる」。
//
// 流れていく数行はすぐ押し流されてしまうので、読み返せる場所を用意した。
// **ここもコメントだけ**(刺しの記録は右上の通知が受け持つ)。
// live欄とちがって、こちらは**新しいものが上**にする。
// 開いた瞬間にいちばん新しいコメントが目に入るほうが、遡る動きに合う。

import { useEffect } from "react";
import { useGameStore } from "@/game/store";
import { flagEmoji } from "./feedText";
import "./ui.css";

interface FeedLogProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedLog({ open, onClose }: FeedLogProps) {
  const chat = useGameStore((s) => s.chat);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="kk-drawer-back" onClick={onClose} aria-hidden="true" />
      <div
        className="kk-drawer feedlog"
        role="dialog"
        aria-modal="true"
        aria-label="みんなの コメント"
      >
        <div className="kk-drawer-head">
          <span className="kk-drawer-grip" aria-hidden="true" />
          <h2 className="kk-drawer-title">みんなの コメント</h2>
          <button
            type="button"
            className="kk-drawer-x"
            aria-label="とじる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="kk-drawer-body">
          {chat.length === 0 ? (
            <p className="feedlog-empty">
              まだ 何も ないよ。
              <br />
              さいしょの コメントを かいてみて！
            </p>
          ) : (
            <>
              <ol className="feedlog-list">
                {chat.map((m) => (
                  <li key={m.id} className="feedlog-row is-chat">
                    <span className="feed-flag" aria-hidden="true">
                      {flagEmoji(m.country)}
                    </span>
                    <span className="feed-name">{m.name ?? "だれか"}</span>
                    <span className="feed-body">{m.body}</span>
                    <span className="feed-time">
                      {new Date(m.at).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="feedlog-note">
                新しい方から さかのぼれるよ。
                だれが 刺したかは、右上に 出るよ。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
