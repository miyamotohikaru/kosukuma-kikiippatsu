"use client";

// 左下のチャットの「ぜんぶ みる」。
//
// 流れていく数行はすぐ押し流されてしまうので、読み返せる場所を用意した。
// **ここもコメントだけ**(刺しの記録は右上の通知が受け持つ)。
// live欄とちがって、こちらは**新しいものが上**にする。
// 開いた瞬間にいちばん新しいコメントが目に入るほうが、遡る動きに合う。

import { useEffect, useRef } from "react";
import { useGameStore } from "@/game/store";
import { flagEmoji } from "./feedText";
import "./ui.css";

interface FeedLogProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedLog({ open, onClose }: FeedLogProps) {
  const chat = useGameStore((s) => s.chat);
  const hasMore = useGameStore((s) => s.chatHasMore);
  const loading = useGameStore((s) => s.chatLoadingOlder);
  const loadOlder = useGameStore((s) => s.loadOlderChat);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 開いたら、手元にあるぶんの先を1ページだけ先に取っておく。
  // 「ぜんぶ みる」と言われて30件で止まっていたら、ぜんぶではない
  useEffect(() => {
    if (open) void loadOlder();
  }, [open, loadOlder]);

  // 下まで来たら続きを取る(ボタンも残してあるので、届かなくても詰まらない)
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) void loadOlder();
  };

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

        <div className="kk-drawer-body" ref={bodyRef} onScroll={onScroll}>
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
                  <li
                    key={m.id}
                    className={
                      m.operator
                        ? "feedlog-row is-chat is-op"
                        : "feedlog-row is-chat"
                    }
                  >
                    <span className="feed-flag" aria-hidden="true">
                      {m.operator ? "📣" : flagEmoji(m.country)}
                    </span>
                    <span className="feed-name">
                      {m.operator ? "うんえい" : (m.name ?? "だれか")}
                    </span>
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
              {hasMore ? (
                <button
                  type="button"
                  className="feedlog-more"
                  disabled={loading}
                  onClick={() => void loadOlder()}
                >
                  {loading ? "よみこみちゅう…" : "もっと まえを みる"}
                </button>
              ) : (
                <p className="feedlog-note">
                  ここが いちばん さいしょの コメントだよ。
                  だれが 刺したかは、右上に 出るよ。
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
