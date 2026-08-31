"use client";

// 「けんの したく」引き出し。完成形のプレビュー・剣ラック(いろ)・しあげ・
// チャームの棚をまとめた、下からせり上がる小さなパネル。
//
// なぜ引き出しにしたか: スマホ縦だと確認シートに全部は入らない。
// 刺す直前に必要なのは「いま選んでいる剣」と色だけなので、それだけをシートに残し、
// じっくり選ぶ/コレクションを眺めるものは、ここへ隔離した。
//
// いちばん上はプレビュー。ここは「選ぶ画面」なのに選んだ結果が見えていなかった。
// 縦が足りないときは本文がスクロールするが、プレビューだけは sticky で
// residentにして、どの棚をいじっていても完成形が目に入るようにしている。

import { useEffect, useState } from "react";
import { NAME_MAX_LEN } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { SkinRack, SwordPreview, SwordRack } from "./SwordRack";
import { CharmShelf } from "./CharmShelf";
import { Handoff } from "./Handoff";
import "./nick.css";

interface GearDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function GearDrawer({ open, onClose }: GearDrawerProps) {
  const nickname = useGameStore((s) => s.nickname);
  const setNickname = useGameStore((s) => s.setNickname);
  // 開くたびに保存済みの名前から始める。閉じるときに確定するので、
  // 打っている途中の名前が世界に出ることはない
  const [name, setName] = useState(nickname ?? "");
  useEffect(() => {
    if (open) setName(useGameStore.getState().nickname ?? "");
  }, [open]);

  // キーボードでも閉じられるように(PCでさわる人むけ)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const closeAndSave = () => {
    setNickname(name);
    onClose();
  };

  return (
    <>
      {/* 背景タップでも閉じる。3Dの操作はここで止める */}
      <div className="kk-drawer-back" onClick={closeAndSave} aria-hidden="true" />
      <div
        className="kk-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="けんの したく"
      >
        {/* 見出しは樽の赤。クリーム一色だとパネル全体が無効状態に見えてしまう */}
        <div className="kk-drawer-head">
          <span className="kk-drawer-grip" aria-hidden="true" />
          <h2 className="kk-drawer-title">けんの したく</h2>
          <button
            type="button"
            className="kk-drawer-x"
            aria-label="とじる"
            onClick={closeAndSave}
          >
            ✕
          </button>
        </div>

        <div className="kk-drawer-body">
          {/* 名前はいちばん上。下に置いていたときは、剣を見に来た人の
              目にまったく入らなかった。ここはスクロールしても残る場所なので、
              「自分の名札」として常に見えているのがいい */}
          <section className="kk-sec kk-preview-sec">
            <div className="nick nick-in-drawer">
              <div className="nick-row">
                <label className="nick-row-label" htmlFor="kk-nick-input">
                  なまえ
                </label>
                <input
                  id="kk-nick-input"
                  className="nick-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  maxLength={NAME_MAX_LEN}
                  placeholder="ニックネーム(にんい)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setNickname(name)}
                />
              </div>
              <span className="nick-preview nick-row-note">
                {name.trim()
                  ? `「${name.trim()}が 刺した」と のこるよ`
                  : "月の ようす と コメントに この名前でのこるよ"}
              </span>
            </div>
            <SwordPreview />
          </section>
          <section className="kk-sec">
            <p className="kk-sec-label kk-label-color">いろ</p>
            <SwordRack />
          </section>
          <section className="kk-sec">
            <p className="kk-sec-label kk-label-skin">しあげ</p>
            <SkinRack />
          </section>
          <section className="kk-sec">
            <CharmShelf />
          </section>
          {/* いちばん下。ふだんは要らないが、機種変えのときだけ必要になる。
              上に置くと「けんの したく」に来た人の邪魔になる */}
          <section className="kk-sec">
            <p className="kk-sec-label">ひきつぎ</p>
            <Handoff />
          </section>
        </div>
      </div>
    </>
  );
}
