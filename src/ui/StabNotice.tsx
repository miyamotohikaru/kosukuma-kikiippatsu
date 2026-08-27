"use client";

// 右上の「だれが刺したか」の記録。
//
// はじめは数秒で消えるポップアップにしていたが、**見ているうちに消えてしまって
// 誰がいたのか追えなかった**。ここは通知ではなく、月のできごとが流れている
// 小さな窓にする。左下のコメント欄と同じ読み方(名前・どのくらい前か)で、
// ただし置き場所と役目をはっきり分けてある:
//   ・左下 = みんなが書いたコメント(読む)
//   ・右上 = 月で起きたこと(眺める)
//
// いちばん上が最新。上から下へ古くなる(上端に貼りついた窓なので、
// 新しいものが目の高さに来る向きにしてある)。

import { useEffect, useState } from "react";
import { STAB_LOG_ROWS } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { agoLabel, feedLine, flagEmoji } from "./feedText";
import "./stabnotice.css";

export default function StabNotice() {
  const recent = useGameStore((s) => s.recent);
  const myStabs = useGameStore((s) => s.myStabs);
  const remoteStabs = useGameStore((s) => s.remoteStabs);
  const phase = useGameStore((s) => s.phase);

  // 「○びょう前」を進めるための時計。数行だけの軽い再描画
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // カットシーン中は出さない(主役の邪魔をしない)
  const on = phase === "idle" || phase === "confirming";
  if (!on || recent.length === 0) return null;

  return (
    <div
      className="stabnotice"
      aria-hidden="true"
      style={{ ["--stab-rows" as string]: STAB_LOG_ROWS }}
    >
      <div className="stabnotice-head">
        <span className="stabnotice-dot" />
        <span>月の ようす</span>
      </div>
      <div className="stabnotice-list">
        {recent.map((e) => {
          const mine = !e.win && myStabs.includes(e.holeId);
          const falling =
            !e.win && remoteStabs.some((r) => r.holeId === e.holeId);
          return (
            <div
              key={`${e.at}-${e.holeId}`}
              className={
                "stabnotice-row" +
                (e.win ? " is-win" : mine ? " is-mine" : "") +
                (falling ? " is-live" : "")
              }
            >
              <span className="stabnotice-flag">{flagEmoji(e.country)}</span>
              <span className="stabnotice-text">
                {feedLine(e, mine, falling)}
              </span>
              {/* 1000個ある穴の番号。ただの # だと何の数字か分からないので、
                  「あな」を添えておく */}
              <span className="stabnotice-hole">あな#{e.holeId}</span>
              <span className="stabnotice-ago">{agoLabel(e.at, now)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
