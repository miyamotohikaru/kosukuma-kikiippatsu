"use client";

// 「じまんする」カード。右上のアイコンから開く。
//
// ねらいは、外に出す前にまず**自分の数字が見える**こと。
// 通算の刺し本数はHUDから外して したく引き出しへ移してあるので、
// 「いま何本刺したんだっけ」を確かめる場所がどこにも無かった。
// ここで数字を見せて、そのまま同じ文をシェアに持っていけるようにする。
//
// 送り先は端末まかせ(Web Share)。使えない端末では X とコピーに落とす。

import { useEffect, useState } from "react";
import { useGameStore } from "@/game/store";
import { useEquippedCharms } from "./SwordRack";
import "./sharecard.css";

interface ShareCardProps {
  open: boolean;
  onClose: () => void;
}

export default function ShareCard({ open, onClose }: ShareCardProps) {
  const roundNo = useGameStore((s) => s.roundNo);
  const stabCount = useGameStore((s) => s.stabCount);
  const myTotal = useGameStore((s) => s.myTotal);
  const myStabs = useGameStore((s) => s.myStabs);
  const myWins = useGameStore((s) => s.myWins);
  const nickname = useGameStore((s) => s.nickname);
  const showToast = useGameStore((s) => s.showToast);
  const hung = useEquippedCharms();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const who = nickname ? `${nickname}は` : "わたしは";
  const wonLine = myWins > 0 ? `こすくまくんを ${myWins}回 とばした！ ` : "";
  const text =
    `${who} こすくまくん危機一髪で いままでに ${myTotal.toLocaleString()}本 刺しました。` +
    ` ${wonLine}いま第${roundNo}代、みんなで${stabCount.toLocaleString()}本 ⚔️🌙`;
  const url = typeof window === "undefined" ? "" : window.location.origin;

  const share = async () => {
    // 端末のシェアシートがあればそれがいちばん早い(LINEにもXにも出せる)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text, url });
        return;
      } catch {
        /* 閉じただけ。何も言わない */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      showToast("コピーしたよ！");
    } catch {
      showToast("コピーできなかった…");
    }
  };

  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    text
  )}&url=${encodeURIComponent(url)}`;

  return (
    <>
      <div className="kk-drawer-back" onClick={onClose} aria-hidden="true" />
      <div
        className="kk-drawer sharecard"
        role="dialog"
        aria-modal="true"
        aria-label="じまんする"
      >
        <div className="kk-drawer-head">
          <span className="kk-drawer-grip" aria-hidden="true" />
          <h2 className="kk-drawer-title">きみの きろく</h2>
          <button
            type="button"
            className="kk-drawer-x"
            aria-label="とじる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="kk-drawer-body">
          {/* いちばん知りたい数字を、いちばん大きく */}
          <div className="share-hero">
            <span className="share-hero-cap">ぜんぶで</span>
            <b className="share-hero-num">{myTotal.toLocaleString()}</b>
            <span className="share-hero-unit">本 刺した</span>
          </div>

          <ul className="share-stats">
            <li>
              <span>この代</span>
              <b>{myStabs.length}本</b>
            </li>
            <li>
              <span>とばした</span>
              <b>{myWins}回</b>
            </li>
            <li>
              {/* 分母は出さない。隠しチャームが何個あるかを、ここで
                  数えられてしまう(集めていない人には全部を伏せておきたい) */}
              <span>チャーム</span>
              <b>{hung.length}こ</b>
            </li>
            <li>
              <span>みんなで</span>
              <b>{stabCount.toLocaleString()}本</b>
            </li>
          </ul>

          <p className="share-text">{text}</p>

          <div className="share-buttons">
            <button type="button" className="btn btn-stab" onClick={() => void share()}>
              {copied ? "コピーした！" : "シェアする"}
            </button>
            <a
              className="btn btn-share"
              href={xUrl}
              target="_blank"
              rel="noreferrer"
            >
              Xで じまんする
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
