"use client";

// クールダウン中の残り秒ピル。減っていくリングと秒カウントダウンを描く。
//
// 待ちが明けた瞬間は、黙って消えるのではなく **一拍だけ「どうぞ」に変わって**
// から消える。同じ瞬間に3D側のこすくまくんが「はっ」と伸び上がり、鈴が鳴り、
// セリフが出るので、そちらと合図をそろえるため(`cooldown-ready` を購読する)。
//
// 残り5秒からは、その「どうぞ」への助走をつける。
// 30秒をただ減らして見せると、待っている人は途中で画面から目を離してしまう。
// 終わりが見えたところで数字が脈打ち、リングが金色へ寄っていけば、
// 「あと少しだから見ていよう」に変わる。金色に染まりきった先が is-ready。

import { useEffect, useState, type CSSProperties } from "react";
import { useGameStore } from "@/game/store";
import { onGameEvent } from "@/game/events";
import { COOLDOWN_SEC } from "@/lib/config";
import "./ui.css";

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

/** 「どうぞ」を見せている時間(ms)。長いと居座るので、ひと呼吸だけ */
const READY_MS = 1500;

/** 助走をはじめる残り秒。ここから毎秒1回、数字が脈打つ */
const RUNUP_SEC = 5;

export default function CooldownPill() {
  const cooldownUntil = useGameStore((s) => s.cooldownUntil);
  const [now, setNow] = useState(() => Date.now());
  /** 明けた合図を出している最中か(0 = 出していない) */
  const [readyAt, setReadyAt] = useState(0);
  const active = cooldownUntil > now;
  const remainMs = cooldownUntil - now;
  /** 助走に入っているか(= 数字を脈打たせる区間) */
  const runup = active && remainMs <= RUNUP_SEC * 1000;

  // 残りがあるあいだだけ時刻を進める。
  // 助走に入ったら刻みを細かくする。250msのままだと脈が最大1/4秒おくれて、
  // 「1秒に1回」が目に見えてよれてしまう
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), runup ? 60 : 250);
    return () => clearInterval(t);
  }, [active, cooldownUntil, runup]);

  // 3D側が待ちあけを見張っていて、明けた瞬間に1回だけ投げてくる
  useEffect(
    () =>
      onGameEvent((type) => {
        if (type === "cooldown-ready") setReadyAt(Date.now());
      }),
    []
  );

  // ひと呼吸おいて自分で引っこむ
  useEffect(() => {
    if (readyAt === 0) return;
    const t = setTimeout(() => setReadyAt(0), READY_MS);
    return () => clearTimeout(t);
  }, [readyAt]);

  const ready = !active && readyAt !== 0;
  if (!active && !ready) return null;

  const sec = Math.max(1, Math.ceil(remainMs / 1000));
  const frac = ready
    ? 1 // 明けた合図ではリングを満ちきらせる
    : Math.min(1, Math.max(0, remainMs / (COOLDOWN_SEC * 1000)));
  // 0 = まだ月の色 / 1 = 「どうぞ」の金色。残り5秒からの寄りぐあいを
  // CSSに渡して、色と光をぜんぶこの1つの数から作る
  const warm = ready
    ? 1
    : Math.min(1, Math.max(0, 1 - remainMs / (RUNUP_SEC * 1000)));

  return (
    <div
      className={ready ? "cooldown-pill is-ready" : "cooldown-pill"}
      style={{ "--cd-warm": warm.toFixed(3) } as CSSProperties}
      role="timer"
      aria-label={ready ? "つぎの1本が刺せるよ" : `つぎに刺せるまで あと${sec}びょう`}
    >
      <svg
        className="cooldown-ring"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        aria-hidden="true"
      >
        <circle className="ring-bg" cx="12" cy="12" r={RING_R} />
        <circle
          className="ring-fg"
          cx="12"
          cy="12"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - frac)}
          transform="rotate(-90 12 12)"
        />
      </svg>
      {ready ? (
        <span>さあ、どうぞ</span>
      ) : (
        /* 減っていくリングが「待ち」を伝えているので、スマホでは前置きを畳んで
           「あとN びょう」だけにする(読み上げ用の文は aria-label が持っている) */
        <span>
          <span className="cd-lead">つぎに刺せるまで </span>あと
          {/* key を残り秒にして数字ごと作り直す。
              同じ要素のままでは、脈のアニメが2回目から鳴らない */}
          <b key={sec} className={runup ? "cd-num is-tick" : "cd-num"}>
            {sec}
          </b>
          びょう
        </span>
      )}
    </div>
  );
}
