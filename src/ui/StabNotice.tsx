"use client";

// 右上の「だれが刺したか」の通知。
//
// 左下のフィードは "世界の空気" を出すための背景で、目で追うものではない。
// こちらは逆に、届いた瞬間だけポンと出て、数秒で消える前景の通知
// (ゲームの実績ポップアップと同じ役目)。読ませたいのは名前ひとつ。
//
// 一度に何件も届くことがあるので、出すのは新しい方から MAX_SHOWN 件まで。
// 全部出すと画面の右側が通知で埋まってしまう。

import { useEffect, useRef, useState } from "react";
import type { StabEvent } from "@/lib/types";
import { useGameStore } from "@/game/store";
import { feedLine, flagEmoji } from "./feedText";
import "./stabnotice.css";

const LIFE_MS = 3800;
const MAX_SHOWN = 3;

interface Notice {
  id: string;
  flag: string;
  text: string;
  hole: number;
  win: boolean;
  mine: boolean;
}

const keyOf = (e: StabEvent) => `${e.at}-${e.holeId}`;

export default function StabNotice() {
  const recent = useGameStore((s) => s.recent);
  const phase = useGameStore((s) => s.phase);
  const [items, setItems] = useState<Notice[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = timers;
    return () => {
      t.current.forEach(clearTimeout);
      t.current = [];
    };
  }, []);

  useEffect(() => {
    // 最初のポーリングで届く12件は「さっきまでの分」なので通知しない。
    // ここで一気に3件出すと、開いた瞬間に通知が降ってきて驚かせてしまう
    if (seen.current === null) {
      seen.current = new Set(recent.map(keyOf));
      return;
    }
    const fresh = recent.filter((e) => !seen.current!.has(keyOf(e)));
    if (fresh.length === 0) return;
    for (const e of fresh) seen.current.add(keyOf(e));

    const myStabs = useGameStore.getState().myStabs;
    const added: Notice[] = fresh.slice(0, MAX_SHOWN).map((e) => {
      const mine = !e.win && myStabs.includes(e.holeId);
      return {
        id: keyOf(e),
        flag: flagEmoji(e.country),
        text: feedLine(e, mine, false),
        hole: e.holeId,
        win: e.win,
        mine,
      };
    });
    setItems((v) => [...added, ...v].slice(0, MAX_SHOWN));
    for (const n of added) {
      timers.current.push(
        setTimeout(
          () => setItems((v) => v.filter((x) => x.id !== n.id)),
          LIFE_MS
        )
      );
    }
  }, [recent]);

  // カットシーン中は出さない(主役の邪魔をしない)
  const on = phase === "idle" || phase === "confirming";
  if (!on || items.length === 0) return null;

  return (
    <div className="stabnotice" aria-hidden="true">
      {items.map((n) => (
        <div
          key={n.id}
          className={
            "stabnotice-row" +
            (n.win ? " is-win" : n.mine ? " is-mine" : "")
          }
        >
          <span className="stabnotice-flag">{n.flag}</span>
          <span className="stabnotice-text">{n.text}</span>
          <span className="stabnotice-hole">#{n.hole}</span>
        </div>
      ))}
    </div>
  );
}
