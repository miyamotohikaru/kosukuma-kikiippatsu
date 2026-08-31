"use client";

// 剣えらび。おもちゃの箱に付いている「たるの横のカラフルな剣ラック」そのもの。
// 丸ドットではなく剣が横一列に立っていて、えらんだ1本だけスッと持ち上がる。
//
// - SwordPreview  : いま選んでいる1本の完成形(したく引き出しのいちばん上)
// - SwordRack     : 8色の剣ラック(確認シート/したく引き出しの両方で使う)
// - SkinRack      : 仕上げ(ノーマル/ぎん/きん/クリスタル/にじいろ)の陳列棚
// - SkinUnlockCard: とばした人へのスキン解放のお祝い(trophyフェーズ)
//
// 剣の絵は SwordArt(インラインSVG)。ラックの木/樹脂の厚み・スロットの穴・
// 落ち影は CSS で作っていて、剣先はラックの前板に隠れる = 挿さって見える。

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CHARMS,
  MAX_EQUIPPED_CHARMS,
  SWORD_COLORS,
  SWORD_SKINS,
} from "@/lib/config";
import { ownedCharms, useGameStore, unlockedSkins } from "@/game/store";
import SwordArt, { effectiveHex } from "./SwordArt";
import { CharmDisc, CharmIcon } from "./CharmShelf";

/**
 * いま剣についているチャーム(CHARMS の index、古い順)。
 * **持っている ≠ つけている。** 端末に残った設定に、いまは持っていないものが
 * 混じっていることがあるので、必ず「持っている」と交差させてから使う。
 * したく引き出しでチャームを押した瞬間にここが変わり、
 * プレビューも剣ラックも同じフレームで描き変わる = つけ外しの手ごたえになる。
 */
export function useEquippedCharms(): number[] {
  const myTotal = useGameStore((s) => s.myTotal);
  const hasEarth = useGameStore((s) => s.hasEarthCharm);
  const caughtSky = useGameStore((s) => s.caughtSky);
  const hasPoke = useGameStore((s) => s.hasPokeCharm);
  const equipped = useGameStore((s) => s.equippedCharms);
  return useMemo(() => {
    const has = new Set(ownedCharms(myTotal, hasEarth, caughtSky, hasPoke));
    // 端末に残った設定が上限より長いことがあるので、ここでも必ず切る
    return equipped
      .filter((i) => has.has(i))
      .sort((a, b) => a - b)
      .slice(0, MAX_EQUIPPED_CHARMS);
  }, [equipped, myTotal, hasEarth, caughtSky, hasPoke]);
}

/** 選んでいない剣にはチャームを付けない。毎回 [] を作ると無駄に描き直すので固定 */
const EMPTY: number[] = [];

/**
 * 南京錠のバッジ。絵文字の🔒は12〜14pxだと潰れて泥になるので、形は自前で描く。
 * 剣の上に大きく重ねると「何が手に入るのか」が見えなくなるので、カードの角に置く。
 */
function LockMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.1 5.4 V4 a1.9 1.9 0 0 1 3.8 0 V5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <rect x="2.5" y="5.2" width="7" height="5.3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * 「けんの したく」のいちばん上に置く、いま選んでいる1本の完成形。
 *
 * なぜ要るか: いろ・しあげ・チャームを別々に選べるのに、それを全部あわせた
 * 「結果」がどこにも出ていなかった。選んでいる最中に完成形が見えないと、
 * 何をどう変えたのか手ごたえがない。
 *
 * 見せかたの都合:
 *  ・剣は縦横比が 44:102 とかなり縦長なので、まともな大きさで出すと
 *    引き出しの高さを食いつぶす。刃の下を切って(cropY)台に挿さっている
 *    姿にすると、同じ高さでも剣を1.3倍ほど大きく描ける。
 *  ・剣にぶら下がる粒はどうしても小さい(9px前後)ので、横のあいた場所に
 *    ついているチャームを大きいまま並べる。「どんな感じか」が両方で分かる。
 *  ・引き出しをスクロールしても消えないよう、CSS側で sticky にしてある。
 */
export function SwordPreview() {
  const swordColor = useGameStore((s) => s.swordColor);
  const swordSkin = useGameStore((s) => s.swordSkin);
  const myTotal = useGameStore((s) => s.myTotal);
  const myStabs = useGameStore((s) => s.myStabs);
  const hasEarth = useGameStore((s) => s.hasEarthCharm);
  const caughtSky = useGameStore((s) => s.caughtSky);
  const hasPoke = useGameStore((s) => s.hasPokeCharm);
  const hung = useEquippedCharms();
  const owned = ownedCharms(myTotal, hasEarth, caughtSky, hasPoke).length;

  const skin = SWORD_SKINS[swordSkin] ?? SWORD_SKINS[0];
  const colorName = SWORD_COLORS[swordColor]?.name ?? SWORD_COLORS[0].name;
  const label = skin.tinted ? `${skin.name}の ${colorName}` : `${skin.name}の けん`;
  // 台のうしろのあかりを、いま選んでいる色に合わせる。色を変えた手ごたえになる
  const stageStyle = {
    "--kk-glow": effectiveHex(swordColor, swordSkin),
  } as CSSProperties;

  return (
    <div className="kk-preview" style={stageStyle}>
      <div className="kk-preview-stage">
        <span className="kk-preview-glow" aria-hidden="true" />
        <span className="kk-preview-sword">
          <SwordArt
            color={swordColor}
            skin={swordSkin}
            charmIndices={hung}
            charmShapes
            charmDetail
            cropY={77}
          />
        </span>
        <span className="kk-preview-base" aria-hidden="true" />
      </div>

      <div className="kk-preview-txt">
        {/* ここはもともと「いまの きみの けん」という見出しだったが、引き出しの
            題が すでに「けんの したく」で、絵も剣なので言い直しになっていた。
            スマホのHUDから外した自分の記録を、その1行に引っ越してある
            (遊ぶのに要らない数字は、開いたときだけ見せる) */}
        <span className="kk-preview-cap">
          {myTotal > 0 ? (
            <>
              この代 <b>{myStabs.length}</b>本 ・ ぜんぶで{" "}
              <b>{myTotal.toLocaleString()}</b>回
            </>
          ) : (
            "いまの きみの けん"
          )}
        </span>
        <b className="kk-preview-name">{label}</b>
        {hung.length > 0 ? (
          <>
            {/* 灰色の丸に入れると、キーホルダーではなく「UIのアイコン」に
                見えてしまう。上に金具のバーを1本通して、そこから
                ぶら下がっている並びにする(剣についている姿と同じ読み方) */}
            <ul className="kk-preview-charms">
              {hung.map((i) => (
                <li
                  key={i}
                  className={CHARMS[i]?.secret ? "secret" : undefined}
                  title={CHARMS[i]?.name}
                >
                  <CharmIcon index={i} size={26} />
                </li>
              ))}
            </ul>
            <span className="kk-preview-sub">
              チャーム <b>{hung.length}</b>こ ついてる
            </span>
          </>
        ) : owned > 0 ? (
          /* 持ってはいるのに全部はずしている状態。「まだ1個も無い」と
             同じ文言にすると、はずしたことが伝わらない */
          <span className="kk-preview-sub">
            チャームは <b>ぜんぶ</b> はずしてるよ
          </span>
        ) : (
          <span className="kk-preview-sub">
            10本 刺すと チャームが ぶら下がるよ
          </span>
        )}
      </div>
    </div>
  );
}

/** 8色の剣が立っているラック。選んだ1本が持ち上がり、チャームがぶら下がる */
export function SwordRack() {
  const swordColor = useGameStore((s) => s.swordColor);
  const setSwordColor = useGameStore((s) => s.setSwordColor);
  const swordSkin = useGameStore((s) => s.swordSkin);
  const hung = useEquippedCharms();

  return (
    <div className="kk-rack">
      {/* ラックの土台(剣の後ろ) */}
      <div className="kk-rack-bar" aria-hidden="true" />
      <div className="kk-rack-row" role="radiogroup" aria-label="けんの いろ">
        {SWORD_COLORS.map((c, i) => {
          const sel = swordColor === i;
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${c.name}の けん`}
              className={`kk-slot${sel ? " sel" : ""}`}
              onClick={() => setSwordColor(i)}
            >
              <span className="kk-slot-hole" aria-hidden="true" />
              <span className="kk-slot-shadow" aria-hidden="true" />
              <span className="kk-slot-sword">
                {/* チャームは「いまつけているぶん」。35px幅では1粒が3px
                    しかないので形では描かず、色つきの丸ビーズの房で見せる
                    (形を見たいときは上のプレビューが引き受ける) */}
                {/* 写真の陳列と同じで、ラックの剣にもチャームの「形」を
                    ぶら下げる。35px では細部はつぶれるので輪郭だけ */}
                <SwordArt
                  color={i}
                  skin={swordSkin}
                  charmIndices={sel ? hung : EMPTY}
                  charmShapes
                />
              </span>
            </button>
          );
        })}
      </div>
      {/* ラックの前板(剣先を隠して「挿さっている」ように見せる) */}
      <div className="kk-rack-lip" aria-hidden="true" />
    </div>
  );
}

/** 仕上げの陳列棚。未解放は鍵つきで、押すと store がトーストを出す */
export function SkinRack() {
  const swordSkin = useGameStore((s) => s.swordSkin);
  const setSwordSkin = useGameStore((s) => s.setSwordSkin);
  const swordColor = useGameStore((s) => s.swordColor);
  const myWins = useGameStore((s) => s.myWins);
  const unlocked = new Set(unlockedSkins(myWins));
  const hasLocked = unlocked.size < SWORD_SKINS.length;

  return (
    <div className="kk-skins-wrap">
      <div className="kk-skins" role="radiogroup" aria-label="けんの しあげ">
        {SWORD_SKINS.map((s, i) => {
          const open = unlocked.has(i);
          const sel = swordSkin === i;
          return (
            <button
              key={s.name}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-disabled={!open}
              aria-label={
                open
                  ? `${s.name}の けん`
                  : `${s.name}の けん(こすくまくんを とばすと つかえるよ)`
              }
              className={`kk-skin${sel ? " sel" : ""}${open ? "" : " lock"}`}
              // 未解放でも押させる: store がトーストで理由を教えてくれる
              onClick={() => setSwordSkin(i)}
            >
              {/* 未解放でも剣は等倍・フルカラーのまま見せる。
                  何が手に入るのか見えないと欲しくならないし、暗く落とすと
                  クリスタルがオリーブ色・にじいろが灰青の塊になってしまう。
                  鍵は右上の小さなバッジにして、剣の視認をじゃましない */}
              {!open && <LockMark className="kk-skin-lock" />}
              {/* stage = くぼんだ陳列スロット。ぎん/きんがクリーム地で消える
                  問題をここで断つ(地色を落として 7:1 以上を確保する) */}
              <span className="kk-skin-stage">
                <span className="kk-skin-sword">
                  <SwordArt color={swordColor} skin={i} />
                </span>
              </span>
              <span className="kk-skin-name">{s.name}</span>
              <span className="kk-skin-sub">
                {open ? (sel ? "えらんでる" : "") : `${s.needWins}かい とばす`}
              </span>
            </button>
          );
        })}
      </div>
      {/* 解放の条件と、いままでの手がら。どちらも「誇らしさ」の材料 */}
      <div className="kk-skins-foot">
        {myWins > 0 && (
          <span className="kk-wins">
            とばした <b>{myWins}</b>かい
          </span>
        )}
        <span className="kk-skins-hint">
          {hasLocked ? (
            <>
              <LockMark className="kk-hint-lock" />
              こすくまくんを <b>とばすと</b> つかえるよ
            </>
          ) : (
            <>ぜんぶ つかえる！ さいこう！</>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * とばした人へのごほうび発表(phase === "trophy")。
 * 授与式の下のほうに、手に入れた剣を実物で見せる。
 * 同時にチャームがたまっていた場合(当たりの1本がちょうど10本目など)は
 * ここでまとめてお祝いして、演出済みとして store の newCharm を片付ける。
 */
export function SkinUnlockCard() {
  const newSkins = useGameStore((s) => s.newSkins);
  const newCharm = useGameStore((s) => s.newCharm);
  const swordColor = useGameStore((s) => s.swordColor);
  const clearNewCharm = useGameStore((s) => s.clearNewCharm);
  // 表示中に store が片付いても消えないよう、マウント時の値を握っておく。
  // 隠しチャームだけはここで受け取らない: 授与式のついでに小さく出すと、
  // せっかくの「なにこれ!?」が普通のごほうびに見えてしまう(CharmGet に任せる)
  const [charm] = useState(
    newCharm !== null && CHARMS[newCharm]?.secret ? null : newCharm
  );

  useEffect(() => {
    if (charm !== null) clearNewCharm();
  }, [charm, clearNewCharm]);

  if (newSkins.length === 0 && charm === null) return null;

  const names = newSkins.map((i) => SWORD_SKINS[i]?.name ?? "").filter(Boolean);

  return (
    <div className="kk-unlock" role="status">
      <div className="kk-unlock-glow" aria-hidden="true" />
      {names.length > 0 && (
        <>
          <p className="kk-unlock-title">
            <b>{names.join(" と ")}</b>のけんを てにいれた！
          </p>
          <div className="kk-unlock-row">
            {newSkins.map((i) => (
              <span key={i} className="kk-unlock-sword">
                {/* 色がのるスキン(クリスタル)は、その人がいつも使っている色で見せる */}
                <SwordArt color={swordColor} skin={i} />
              </span>
            ))}
          </div>
        </>
      )}
      {charm !== null && (
        <p className="kk-unlock-charm">
          <CharmDisc index={charm} size={30} />
          <span>
            チャーム <b>{CHARMS[charm]?.name}</b> も てにいれた！
          </span>
        </p>
      )}
      <p className="kk-unlock-note">けんの したくから えらべるよ</p>
    </div>
  );
}
