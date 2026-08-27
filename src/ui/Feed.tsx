"use client";

// 直近の刺しイベントのフィード(最新4件)。左下に流れる。
//
// ねらいは「いま、世界で何が起きたか」が読めること。同じ文言が4行ならぶと
// 動いていないように見えるので、1行ごとに違いを出す:
//   ・国旗(どこの人か) ・穴の番号(どの穴か) ・経過時間(どれくらい前か)
//   ・名前を登録した人は「〇〇が 刺した」。ここに人の名前が出るだけで、
//     同じ「だれかが」の行列より、ずっと人がいる感じになる
//   ・自分の刺しは「きみ」、当たりは金色
//   ・いま剣が降ってきている最中の行(`store.remoteStabs`)は光らせて、
//     3Dで降ってくる剣とフィードを対応させる

import { useEffect, useState } from "react";
import { useGameStore } from "@/game/store";
import { feedLine, flagEmoji } from "./feedText";
import "./ui.css";

/** どれくらい前か。サーバーと時計がずれて未来になっても「いま」に丸める */
function agoLabel(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  if (ms < 8000) return "いま";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}びょう前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}ふん前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}じかん前`;
  return `${Math.floor(hour / 24)}にち前`;
}

/** 「いま起きたばかり」とみなす時間(ms)。この行は薄めない */
const FRESH_MS = 6000;

interface FeedProps {
  /** 「ぜんぶ みる」を押したとき。記録の一覧をひらく */
  onOpenLog: () => void;
}

export default function Feed({ onOpenLog }: FeedProps) {
  const recent = useGameStore((s) => s.recent);
  const myStabs = useGameStore((s) => s.myStabs);
  const remoteStabs = useGameStore((s) => s.remoteStabs);

  // 経過時間の表示を進めるための時計。1秒ごとの、4行だけの軽い再描画
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const items = recent.slice(0, 4);
  if (items.length === 0) return null;

  return (
    <div className="feed-wrap">
      <div className="feed-head">
        <span className="feed-live-dot" aria-hidden="true" />
        <span>せかいの ようす</span>
        {/* 4行はすぐ押し流される。読み返したい人のための逃し口 */}
        <button type="button" className="feed-all" onClick={onOpenLog}>
          ぜんぶ みる
        </button>
      </div>
      <div className="feed" aria-live="polite">
        {items.map((e) => {
          // いま3Dで降ってきている最中か(当たりの行は金色を優先するので除く)
          const falling =
            !e.win && remoteStabs.some((r) => r.holeId === e.holeId);
          const mine = !e.win && myStabs.includes(e.holeId);
          const fresh = now - Date.parse(e.at) < FRESH_MS;

          const cls = ["feed-row"];
          if (e.win) cls.push("feed-win");
          else if (falling) cls.push("feed-live");
          else if (mine) cls.push("feed-mine");
          if (fresh || falling) cls.push("feed-fresh");

          const text = feedLine(e, mine, falling);

          return (
            <div key={`${e.at}-${e.holeId}`} className={cls.join(" ")}>
              <span className="feed-flag" aria-hidden="true">
                {flagEmoji(e.country)}
              </span>
              <span className="feed-text">{text}</span>
              <span className="feed-hole">#{e.holeId}</span>
              <span className="feed-time">{agoLabel(e.at, now)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
