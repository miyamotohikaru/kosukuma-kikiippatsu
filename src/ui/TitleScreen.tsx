"use client";

// タイトル画面。後ろに3Dの月が見えるよう背景は透過。
// ロゴは1文字ずつ跳ねて登場し、「危機一髪」は赤系で強調する。

import { useEffect, useState } from "react";
import { useGameStore } from "@/game/store";
import NickModal from "./NickModal";
import "./ui.css";
import "./nick.css";

/** ロゴ1行分。offset は全体を通した文字番号(アニメの時差用) */
function LogoLine({
  text,
  offset,
  danger = false,
}: {
  text: string;
  offset: number;
  danger?: boolean;
}) {
  return (
    <div className="logo-line">
      {[...text].map((ch, i) => {
        const n = offset + i;
        return (
          <span
            key={i}
            className={danger ? "logo-char logo-char-danger" : "logo-char"}
            style={{
              // 1つ目: 登場ポップ / 2つ目: その後のぴょこぴょこ(ずらして波にする)
              animationDelay: `${0.06 * n}s, ${1.2 + 0.09 * n}s`,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

export default function TitleScreen() {
  const phase = useGameStore((s) => s.phase);
  const ready3d = useGameStore((s) => s.ready3d);
  const start = useGameStore((s) => s.start);
  const nickname = useGameStore((s) => s.nickname);
  const [nickOpen, setNickOpen] = useState(false);
  // 名前は localStorage から来るので、サーバーでは必ず空。
  // 最初の描画で名前を出すと、ハイドレーションで食い違って警告になる
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shownNick = mounted ? nickname : null;

  if (phase !== "boot" && phase !== "title") return null;

  // サーバー状態(boot→title)と3Dアセットの両方が揃ったら遊べる
  const ready = phase === "title" && ready3d;

  return (
    <div className="title-screen">
      <div className="title-head">
        <h1 className="title-logo">
          <LogoLine text="こすくまくん" offset={0} />
          <LogoLine text="危機一髪" offset={6} danger />
        </h1>
        <p className="title-copy">
          月にささった こすくまくんを
          <br />
          たすけて…いや、飛ばして！
        </p>
      </div>
      <div className="title-bottom">
        {/* 名前は任意。コピーの下に置くとこすくまくんの顔に重なるので、
            月の無地なところ = 「はじめる」のすぐ上に置く。
            入力欄そのものは出さず、押した人にだけモーダルを開く */}
        <button
          type="button"
          className={shownNick ? "nick-chip is-set" : "nick-chip"}
          onClick={() => setNickOpen(true)}
        >
          {shownNick ? `なまえ: ${shownNick}` : "なまえを つける（にんい）"}
        </button>
        <button
          type="button"
          className="btn btn-start"
          disabled={!ready}
          onClick={start}
        >
          {ready ? "はじめる" : "よみこみちゅう…"}
        </button>
        <p className="title-note">⚔️ 1000のあなの どれか1つが あたり</p>
      </div>
      <NickModal open={nickOpen} onClose={() => setNickOpen(false)} />
    </div>
  );
}
