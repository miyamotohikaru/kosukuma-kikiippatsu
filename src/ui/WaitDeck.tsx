"use client";

// 待っているあいだの「つぎの けん」への誘い。
//
// 30秒は、ただ月を見ているには長い。ここでいちばんやりたくなるのは
// 剣のしたくなので、待ちに入ってひと呼吸おいてから、そこへ小さく誘う。
//
// **自動では開かない。** 引き出しは画面の下2/3を占める。勝手にせり上がると
// 月もこすくまくんも隠れて、待ち時間がもっと退屈になってしまう。
// 開けるかどうかは、待っている人が決めること。
//
// 引き出しの開閉スイッチは Hud の「したく」ボタンが持っていて、そこには
// 手が届かない。なので同じ GearDrawer をここでも1つ持つ。選んだ剣も
// チャームもストアにあるので、どちらから開いても中身は同じものが見える。

import { useEffect, useState, type CSSProperties } from "react";
import { useGameStore } from "@/game/store";
import GearDrawer from "./GearDrawer";
import SwordArt from "./SwordArt";
import "./ui.css";

/**
 * 待ちに入ってから誘いを出すまで(ms)。
 * 刺した直後は「セーフ！」の余韻を見ているので、そこへ重ねない。
 */
const INVITE_DELAY_MS = 2500;

/** 誘いの上げ幅を測る相手。下に置かれているものは、これで全部 */
const BELOW_SELECTORS = [".hud-bottom", ".kk-fab"];

export default function WaitDeck() {
  const cooldownUntil = useGameStore((s) => s.cooldownUntil);
  const phase = useGameStore((s) => s.phase);
  const swordColor = useGameStore((s) => s.swordColor);
  const swordSkin = useGameStore((s) => s.swordSkin);

  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  /** この待ちのあいだは、もう誘わない(押した/ことわった) */
  const [done, setDone] = useState(false);
  /** この待ちが始まった時刻(0 = 待っていない) */
  const [waitFrom, setWaitFrom] = useState(0);
  /** 下にあるものの高さ(px)。測れるまでは出さない */
  const [lift, setLift] = useState<number | null>(null);

  const active = cooldownUntil > now;

  // 待っているあいだだけ時計を進める。ピルほど細かくなくていい
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, [active, cooldownUntil]);

  // 待ちの始まりを覚えておく。とちゅうでサーバー判定のずれが直っても
  // 数えなおしにはしない(誘いが出たり消えたりして落ちつかなくなる)
  useEffect(() => {
    if (active) {
      setWaitFrom((v) => (v === 0 ? Date.now() : v));
    } else {
      setWaitFrom(0);
      setDone(false);
    }
  }, [active]);

  // 刺しはじめ・カットシーンに入ったら引き出しはしまう(Hud側と同じふるまい)
  useEffect(() => {
    if (phase !== "idle" && phase !== "confirming") setOpen(false);
  }, [phase]);

  const wantInvite =
    active &&
    !done &&
    !open &&
    // 刺した直後の「……」や「セーフ！」の最中には出さない。
    // 月をまた さわれるようになってから、はじめて声をかける
    phase === "idle" &&
    waitFrom !== 0 &&
    now - waitFrom >= INVITE_DELAY_MS;

  // 下に置かれているものの高さを測って、そのすぐ上に出す。
  // フィードは行数で伸び縮みするので、決め打ちの位置だと重なる。
  // pop-in の途中は transform で縮んでいるから、rect ではなく
  // offsetHeight と算出済みの bottom で測る(拡大縮小に左右されない)。
  useEffect(() => {
    if (!wantInvite) return;
    const measure = () => {
      let top = 0;
      for (const sel of BELOW_SELECTORS) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) continue;
        const bottom = parseFloat(getComputedStyle(el).bottom) || 0;
        top = Math.max(top, bottom + el.offsetHeight);
      }
      setLift(Math.round(top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const sel of BELOW_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [wantInvite]);

  const invite = wantInvite && lift !== null;
  if (!invite && !open) return null;

  return (
    <div className="wait-deck">
      {invite && (
        <div
          className="wd-invite"
          style={{ "--wd-lift": `${lift}px` } as CSSProperties}
        >
          <button
            type="button"
            className="wd-invite-go"
            aria-haspopup="dialog"
            onClick={() => {
              setDone(true);
              setOpen(true);
            }}
          >
            {/* 絵文字の🗡は小さくすると暗い斜線になるので、
                いま持っている剣そのものを小さく置く */}
            <span className="wd-invite-sword" aria-hidden="true">
              <SwordArt color={swordColor} skin={swordSkin} />
            </span>
            <span className="wd-invite-txt">
              まってる あいだに、
              <br />
              つぎの けんを えらんでおく？
            </span>
            <span className="wd-invite-arrow" aria-hidden="true">
              ▸
            </span>
          </button>
          {/* ことわる道をそえておく。押した人にも、ことわった人にも、
              この待ちのあいだは二度と声をかけない */}
          <button
            type="button"
            className="wd-invite-x"
            aria-label="いまは いい"
            onClick={() => setDone(true)}
          >
            ✕
          </button>
        </div>
      )}
      <GearDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
