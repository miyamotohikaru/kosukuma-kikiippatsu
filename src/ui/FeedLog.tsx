"use client";

// 左下のフィードの「ぜんぶ みる」。
//
// 流れていく4行は「いま世界で何が起きたか」だけを見せるもので、少し前のことは
// すぐ押し流されてしまう。刺した人の名前が出るようになってからは
// 「さっき誰がいたんだっけ」を読み返したくなるので、この端末で見ていたあいだの
// 記録(store.feedLog)を、そのまま古い順に読める場所を用意した。
//
// サーバーが返すのは直近12件だけなので、ここに出るのは
// **開いているあいだに流れてきたぶん** だけ。過去ぜんぶの記録ではない。

import { useEffect } from "react";
import { useGameStore } from "@/game/store";
import { flagEmoji, feedLine } from "./feedText";
import "./ui.css";

interface FeedLogProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedLog({ open, onClose }: FeedLogProps) {
  const log = useGameStore((s) => s.feedLog);
  const myStabs = useGameStore((s) => s.myStabs);

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
        aria-label="せかいの ようす"
      >
        <div className="kk-drawer-head">
          <span className="kk-drawer-grip" aria-hidden="true" />
          <h2 className="kk-drawer-title">せかいの ようす</h2>
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
          {log.length === 0 ? (
            <p className="feedlog-empty">
              まだ 何も 流れてきていないよ。
              <br />
              しばらく 月を ながめていてね。
            </p>
          ) : (
            <>
              <ol className="feedlog-list">
                {log.map((e) => {
                  const mine = !e.win && myStabs.includes(e.holeId);
                  return (
                    <li
                      key={`${e.at}-${e.holeId}`}
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
                      <span className="feed-time">
                        {new Date(e.at).toLocaleTimeString("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="feedlog-note">
                ここに たまるのは、この画面を 開いていたあいだに
                流れてきたぶんだよ。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
