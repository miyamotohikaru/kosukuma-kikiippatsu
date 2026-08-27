"use client";

// 指のところへ「あと ○」を出す小さな数字。
// 空のものをつかまえたときと、こすくまくんをつついたときの両方で使う。
//
// 出す理由: しきい値まで何も起きないと、タップが効いているのかどうかが
// 分からない。地球の1000回は「黙って数える」ままだが、こちらは
// 狙って追いかけるものなので、目標が見えないと追いかけようがない。
//
// 位置は最後にさわったところ。押した本人の指がそこにあるので、
// 3D側から座標をもらわなくても、いちばん自然なところに出る。

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/game/store";
import "./tappop.css";

/** 出てから消えるまで(ms)。CSSのアニメと合わせること */
const LIFE_MS = 1150;

/** 強調表示(あと少し)。CSSで色と大きさを変える */
interface Pop {
  id: number;
  text: string;
  /** true = もうすぐ届く。赤く大きく出して「そろそろ来る」を伝える */
  hot?: boolean;
  x: number;
  y: number;
}

export default function TapPop() {
  const tapPop = useGameStore((s) => s.tapPop);
  const [pops, setPops] = useState<Pop[]>([]);
  const at = useRef({ x: 0, y: 0 });

  // 最後にさわったところを覚えておく(capture で、誰かが止める前に拾う)
  useEffect(() => {
    const on = (e: PointerEvent) => {
      at.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", on, true);
    return () => window.removeEventListener("pointerdown", on, true);
  }, []);

  useEffect(() => {
    if (!tapPop) return;
    const p: Pop = { ...tapPop, x: at.current.x, y: at.current.y };
    setPops((v) => [...v, p]);
    const t = setTimeout(
      () => setPops((v) => v.filter((q) => q.id !== p.id)),
      LIFE_MS,
    );
    return () => clearTimeout(t);
  }, [tapPop]);

  if (pops.length === 0) return null;

  return (
    <div className="tappop-layer" aria-hidden="true">
      {pops.map((p) => (
        <span
          key={p.id}
          className={p.hot ? "tappop is-hot" : "tappop"}
          style={{ left: `${p.x}px`, top: `${p.y}px` }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
