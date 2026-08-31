"use client";

// 「ひきつぎ」— 記録をべつの端末・べつのブラウザへ持っていくための小さな窓。
//
// なぜ要るか: 剣も本数もチャームも、引き当てているのは fp という1つの鍵だけ。
// 鍵は端末のメモに置いてあるので、
//   ・Safari は「スクリプトが書いた保存」を7日で消す
//   ・履歴を消せば当然消える
//   ・**別のドメインは別のメモ**(kosukuma.com と *.vercel.app は別扱い)
// のどれかで、記録にたどり着けなくなる。
// サーバーには記録が残ったままなので、**鍵さえ人が持ち運べれば戻せる。**
// その鍵を、読める形で見せて/入れられるようにしたのがここ。
//
// 見た目を「コード」と呼んでいるが中身は鍵そのもの。だから
// **人に見せたら、その人が自分の記録として使えてしまう。**注意書きを添える。

import { useState } from "react";
import { getMyCode, useGameStore } from "@/game/store";
import "./handoff.css";

export function Handoff() {
  const adoptCode = useGameStore((s) => s.adoptCode);
  const showToast = useGameStore((s) => s.showToast);

  // 開いている間に乗り換えると自分のコードも変わるので、state で持つ
  const [code, setCode] = useState(() => getMyCode() ?? "");
  const [shown, setShown] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    const mine = getMyCode();
    if (!mine) return;
    try {
      await navigator.clipboard.writeText(mine);
      showToast("コードを コピーしたよ");
    } catch {
      // クリップボードを断られる場面(古いSafari・非HTTPS)がある。
      // そのときは隠さず出して、手で選べるようにするのがいちばん確実
      setShown(true);
      showToast("えらんで コピーしてね");
    }
  };

  const adopt = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await adoptCode(input);
    setBusy(false);
    if (ok) {
      setInput("");
      setCode(getMyCode() ?? "");
      setShown(false);
    }
  };

  return (
    <div className="ho">
      <p className="ho-lead">
        きろくは この コードで つながっているよ。
        <br />
        べつの きたい や ブラウザでも、これを 入れれば もどるよ。
      </p>

      <div className="ho-block">
        <div className="ho-row">
          <code className={`ho-code${shown ? "" : " is-hidden"}`}>
            {code ? (shown ? code : "•".repeat(Math.min(code.length, 21))) : "—"}
          </code>
          <button
            type="button"
            className="ho-btn"
            onClick={() => setShown((v) => !v)}
            disabled={!code}
          >
            {shown ? "かくす" : "見る"}
          </button>
          <button
            type="button"
            className="ho-btn ho-btn-main"
            onClick={copy}
            disabled={!code}
          >
            コピー
          </button>
        </div>
        <p className="ho-note">
          ⚠️ 人に わたすと、その人が あなたの きろくを つかえるよ。
        </p>
      </div>

      <div className="ho-block">
        <label className="ho-label" htmlFor="kk-handoff-input">
          コードを 入れて ひきつぐ
        </label>
        <div className="ho-row">
          <input
            id="kk-handoff-input"
            className="ho-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="コードを はりつけ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            className="ho-btn ho-btn-main"
            onClick={adopt}
            disabled={busy || input.trim().length === 0}
          >
            {busy ? "…" : "ひきつぐ"}
          </button>
        </div>
        <p className="ho-note">
          いまの きろくは 消えないよ。おおきい ほうが のこる。
        </p>
      </div>
    </div>
  );
}
