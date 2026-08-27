"use client";

// 刺している最中に、いま剣についているチャームを大きく出す。
//
// なぜ要るか: 3Dの剣にぶら下がっているチャームは、引きの2ショットだと
// どうしても小さい。せっかく選んだものが「刺す」といういちばんの見せ場で
// 見えないのはもったいないので、同じチャームを、同じ絵のまま大きく並べる。
// (絵は CharmIcon = 棚と剣とまったく同じ図形。別々に描くとズレる)
//
// 位置は画面の下寄り。まんなかは剣が降りてくる場所で、左下はフィードがいる。
// 出るのは「刺している〜セーフ」のあいだだけの、消えもの。

import { useGameStore } from "@/game/store";
import { CharmIcon } from "./CharmShelf";
import { useEquippedCharms } from "./SwordRack";
import "./stabcharms.css";

export default function StabCharms() {
  const phase = useGameStore((s) => s.phase);
  const hung = useEquippedCharms();

  // 出すのは剣を握っているあいだだけ。つけ外しは したく引き出しでしかできず、
  // 引き出しはこのフェーズでは閉じているので、途中で中身が変わることはない
  const on = phase === "stabbing" || phase === "suspense" || phase === "safe";
  if (!on || hung.length === 0) return null;

  return (
    <div className="stabcharms" aria-hidden="true">
      {hung.map((i, k) => (
        <span
          key={i}
          className="stabcharm"
          /* 1個ずつ遅れて降りてくる。房が上から順にほどける感じ */
          style={{ animationDelay: `${k * 70}ms` }}
        >
          <span className="stabcharm-swing">
            <CharmIcon index={i} size={52} />
          </span>
        </span>
      ))}
    </div>
  );
}
