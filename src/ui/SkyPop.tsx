"use client";

// 空のものをつかまえたとき、指のところへ「あと ○」を出す小さな数字。
//
// 出す理由: しきい値まで何も起きないと、タップが効いているのかどうかが
// 分からない。地球の1000回と同じ「黙って数える」でもよかったが、
// 空のものは狙って当てにいくものなので、目標が見えないと追いかけられない。
//
// 位置は最後にさわったところ。つかまえた本人の指がそこにあるので、
// 3D側から座標をもらわなくても、いちばん自然なところに出る。

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/game/store";
import "./skypop.css";

/** 出てから消えるまで(ms)。CSSのアニメと合わせること */
const LIFE_MS = 1150;

interface Pop {
  id: number;
  text: string;
  x: number;
  y: number;
}

export default function SkyPop() {
  const skyPop = useGameStore((s) => s.skyPop);
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
    if (!skyPop) return;
    const p: Pop = { ...skyPop, x: at.current.x, y: at.current.y };
    setPops((v) => [...v, p]);
    const t = setTimeout(
      () => setPops((v) => v.filter((q) => q.id !== p.id)),
      LIFE_MS,
    );
    return () => clearTimeout(t);
  }, [skyPop]);

  if (pops.length === 0) return null;

  return (
    <div className="skypop-layer" aria-hidden="true">
      {pops.map((p) => (
        <span
          key={p.id}
          className="skypop"
          style={{ left: `${p.x}px`, top: `${p.y}px` }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
