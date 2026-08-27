"use client";

// 左下のチャットの「ぜんぶ みる」。
//
// 流れていく数行はすぐ押し流されてしまうので、読み返せる場所を用意した。
// コメント(store.chat)と刺しの記録(store.feedLog)を、live欄と同じ規則で
// まぜて出す。ここは**新しいものが上**(開いた瞬間に最新が目に入る)。
//
// サーバーが一度に返すのは直近のぶんだけなので、ここに出るのは
// **この画面を開いていたあいだに流れてきたぶん** が中心になる。

import { useEffect, useMemo } from "react";
import { useGameStore } from "@/game/store";
import { flagEmoji, feedLine } from "./feedText";
import { mergeRows } from "./Feed";
import "./ui.css";

interface FeedLogProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedLog({ open, onClose }: FeedLogProps) {
  const log = useGameStore((s) => s.feedLog);
  const chat = useGameStore((s) => s.chat);
  const myStabs = useGameStore((s) => s.myStabs);
  // live欄と同じ関数でまぜて、こちらは新しい順に見せる
  const rows = useMemo(
    () => mergeRows(chat, log, 400).reverse(),
    [chat, log],
  );

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
          {rows.length === 0 ? (
            <p className="feedlog-empty">
              まだ 何も 流れてきていないよ。
              <br />
              さいしょの コメントを かいてみて！
            </p>
          ) : (
            <>
              <ol className="feedlog-list">
                {rows.map((row) => {
                  const at = new Date(row.at).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  if (row.kind === "chat") {
                    return (
                      <li key={row.key} className="feedlog-row is-chat">
                        <span className="feed-flag" aria-hidden="true">
                          {flagEmoji(row.msg.country)}
                        </span>
                        <span className="feed-name">
                          {row.msg.name ?? "だれか"}
                        </span>
                        <span className="feed-body">{row.msg.body}</span>
                        <span className="feed-time">{at}</span>
                      </li>
                    );
                  }
                  const e = row.e;
                  const mine = !e.win && myStabs.includes(e.holeId);
                  return (
                    <li
                      key={row.key}
                      className={
                        "feedlog-row" +
                        (e.win ? " feed-win" : mine ? " feed-mine" : "")
                      }
                    >
                      <span className="feed-flag" aria-hidden="true">
                        {flagEmoji(e.country)}
                      </span>
                      <span className="feed-text">
                        {feedLine(e, mine, false)}
                      </span>
                      <span className="feed-hole">#{e.holeId}</span>
                      <span className="feed-time">{at}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="feedlog-note">
                コメントは 新しい方から さかのぼれるよ。
                刺した記録は、この画面を 開いていたあいだのぶんだけ。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
