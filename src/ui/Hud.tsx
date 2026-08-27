"use client";

// HUDオーバーレイ。バッジ・フィード・確認シート・各フェーズのバナー・
// 白フラッシュ・ヘルプまで、ゲーム中のUIはすべてここから出す。
// root は pointer-events:none で、押せる要素だけ auto(3D操作を邪魔しない)。

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CHARMS,
  charmLevelOf,
  NORMAL_CHARM_COUNT,
  SWORD_COLORS,
  SWORD_SKINS,
} from "@/lib/config";
import { useGameStore } from "@/game/store";
import { onGameEvent } from "@/game/events";
import Feed from "./Feed";
import CooldownPill from "./CooldownPill";
import HelpModal from "./HelpModal";
import SwordArt, { effectiveHex } from "./SwordArt";
import { SkinUnlockCard, SwordRack, useEquippedCharms } from "./SwordRack";
import { CharmGet } from "./CharmShelf";
import GearDrawer from "./GearDrawer";
import FeedLog from "./FeedLog";
import ShareCard from "./ShareCard";
import StabCharms from "./StabCharms";
import StabNotice from "./StabNotice";
import "./ui.css";

export default function Hud() {
  const phase = useGameStore((s) => s.phase);
  const roundNo = useGameStore((s) => s.roundNo);
  const stabCount = useGameStore((s) => s.stabCount);
  const connected = useGameStore((s) => s.connected);
  const muted = useGameStore((s) => s.muted);
  const setMuted = useGameStore((s) => s.setMuted);
  const launchInfo = useGameStore((s) => s.launchInfo);
  const wonName = useGameStore((s) => s.wonName);
  const confirmStab = useGameStore((s) => s.confirmStab);
  const cancelSelect = useGameStore((s) => s.cancelSelect);
  const swordColor = useGameStore((s) => s.swordColor);
  const swordSkin = useGameStore((s) => s.swordSkin);
  const myStabs = useGameStore((s) => s.myStabs);
  const myTotal = useGameStore((s) => s.myTotal);
  // 剣にぶら下がるのは「持っている」ではなく「つけている」ぶん
  const hung = useEquippedCharms();

  const [helpOpen, setHelpOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [flashId, setFlashId] = useState(0);
  const nickname = useGameStore((s) => s.nickname);

  // 刺しはじめたら「したく」はしまう(カットシーンの邪魔をしない)
  useEffect(() => {
    if (phase !== "idle" && phase !== "confirming") {
      setGearOpen(false);
      setLogOpen(false);
      setShareOpen(false);
    }
  }, [phase]);

  // 当たりの瞬間の白フラッシュ(単発イベントを購読して0.15秒で消す)
  useEffect(
    () =>
      onGameEvent((t) => {
        if (t === "win-flash") setFlashId(Date.now());
      }),
    []
  );

  // Xでじまんするリンク(勝者のトロフィー画面用)
  const shareUrl = useMemo(() => {
    if (!launchInfo) return "#";
    const text = `こすくまくん第${launchInfo.roundNo}代を宇宙へ飛ばしました ⚔️🌙`;
    const url = typeof window === "undefined" ? "" : window.location.origin;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text
    )}&url=${encodeURIComponent(url)}`;
  }, [launchInfo]);

  if (phase === "boot" || phase === "title") return null;

  // new-round 中は store の roundNo がまだ古いことがあるので launchInfo で補正
  const genNo =
    phase === "new-round" && launchInfo
      ? Math.max(roundNo, launchInfo.roundNo + 1)
      : roundNo;

  // フィードを出すのは月をさわれる(見ていられる)フェーズだけ
  const showFeed =
    phase === "idle" ||
    phase === "stabbing" ||
    phase === "suspense" ||
    phase === "safe";

  // ── いま持っている剣の説明(確認シートの装備バー用) ──
  const skin = SWORD_SKINS[swordSkin] ?? SWORD_SKINS[0];
  const colorName = SWORD_COLORS[swordColor]?.name ?? SWORD_COLORS[0].name;
  // 色がのるスキンは「クリスタルの みずいろ」、固有色のスキンは「ぎんの けん」
  const swordLabel = skin.tinted
    ? `${skin.name}の ${colorName}`
    : `${skin.name}の けん`;
  const charmCount = charmLevelOf(myTotal);
  // 実際に剣にぶら下がる数(= いまつけているぶん)
  const hungCount = hung.length;
  // CHARMS[charmCount] をそのまま使うと、12個そろった人の装備バーに
  // 隠しチャームの存在が「つぎまで あと…」としてもれてしまう
  const nextCharm =
    charmCount < NORMAL_CHARM_COUNT ? CHARMS[charmCount] : undefined;
  const charmSub = nextCharm
    ? `チャーム ${hungCount}こ ・ つぎまで あと${Math.max(
        1,
        nextCharm.need - myTotal
      )}本`
    : `チャーム ${hungCount}こ ・ ぜんぶ あつめた！`;

  return (
    <div className="hud">
      {/* ── 上部バー ──
          スマホでは月がいちばん大事なので、常に出すのは1枚だけにしている。
          「第N代」(いま誰がここにいるか)と「みんなで N本」(世界中が同じ月を
          つついている実感)は残し、自分の本数は したく引き出しへ移した。 */}
      <div className="hud-top">
        <div className="hud-badges">
          <div className="hud-badge hud-badge-world">
            <span className="hb-gen">
              第<b>{genNo}</b>代
            </span>
            <span className="hb-sep" aria-hidden="true" />
            <span className="hb-all">
              みんなで <b>{stabCount.toLocaleString()}</b>本
            </span>
          </div>
          {/* 自分の記録は、遊ぶのに要らない。広い画面のときだけ添える */}
          {myTotal > 0 && (
            <div className="hud-badge hud-badge-mine">
              <span
                className="my-color-dot"
                style={{ background: effectiveHex(swordColor, swordSkin) }}
              />
              きみの けん この代<b>{myStabs.length}</b>本 / 計
              <b>{myTotal.toLocaleString()}</b>回
            </div>
          )}
        </div>
        <div className="hud-top-right">
          <Link href="/trophies" className="icon-btn" aria-label="トロフィーホール">
            🏆
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label={muted ? "おとを だす" : "おとを けす"}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="きろくを みる・じまんする"
            aria-haspopup="dialog"
            onClick={() => setShareOpen(true)}
          >
            📣
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="あそびかた"
            onClick={() => setHelpOpen(true)}
          >
            ❓
          </button>
        </div>
      </div>

      {/* ── 下部: クールダウン + フィード ── */}
      {showFeed && (
        <div className="hud-bottom">
          <CooldownPill />
          <Feed onOpenLog={() => setLogOpen(true)} />
        </div>
      )}

      {/* ── けんの したく(右下のボタン → 引き出し) ── */}
      {phase === "idle" && (
        <button
          type="button"
          className="kk-fab"
          aria-label="けんの したく"
          aria-haspopup="dialog"
          onClick={() => setGearOpen(true)}
        >
          <span className="kk-fab-sword">
            <SwordArt color={swordColor} skin={swordSkin} />
          </span>
          <span className="kk-fab-label">したく</span>
          {hungCount > 0 && (
            <span className="kk-fab-badge" aria-hidden="true">
              {hungCount}
            </span>
          )}
        </button>
      )}

      {/* ── 確認シート ── */}
      {phase === "confirming" && (
        <div className="confirm-sheet" role="dialog" aria-label="かくにん">
          <p className="confirm-text">この あなに けんを 刺す…？</p>

          {/* いま持っている剣。押すと したく引き出しがひらく */}
          <button
            type="button"
            className="kk-equip"
            aria-haspopup="dialog"
            onClick={() => setGearOpen(true)}
          >
            {/* 絵文字の🗡は小さくすると暗い斜線になって画像切れに見えるので、
                実物の剣をそのまま小さく置く */}
            <span className="kk-equip-icon">
              <SwordArt
                color={swordColor}
                skin={swordSkin}
                charmIndices={hung}
              />
            </span>
            <span className="kk-equip-txt">
              <b>{swordLabel}</b>
              <small>{charmSub}</small>
            </span>
            <span className="kk-equip-go">したく</span>
          </button>

          {/* 剣ラック: つまんで えらぶ */}
          <SwordRack />

          <div className="confirm-buttons">
            <button type="button" className="btn btn-cancel" onClick={cancelSelect}>
              やめとく
            </button>
            <button
              type="button"
              className="btn btn-stab"
              onClick={() => void confirmStab()}
            >
              刺す！
            </button>
          </div>
        </div>
      )}

      {/* ── セーフ！スタンプ ── */}
      {phase === "safe" && (
        <div className="center-stage">
          {/* 全角「！」の左の余白を詰めるために、そこだけ span で分ける */}
          <div className="stamp">
            セーフ<span className="stamp-bang">！</span>
          </div>
        </div>
      )}

      {/* ── 発射バナー ── */}
      {phase === "launch" && launchInfo && (
        <div className="center-stage">
          <div className="launch-banner">
            {launchInfo.isMe ? (
              <>
                <div className="banner-big banner-hit">🎯 あたり！！</div>
                {/* 名前を入れている人は、自分の名前でとばした実感がほしい */}
                <div className="banner-sub">
                  {nickname
                    ? `${nickname}が こすくまくんを とばした！！`
                    : "こすくまくん、宇宙へ！！"}
                </div>
              </>
            ) : (
              <>
                <div className="banner-big">
                  {launchInfo.name ?? "だれか"}が とばした！
                </div>
                <div className="banner-sub">
                  第{launchInfo.roundNo}代こすくまくん、宇宙へ
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── トロフィー授与バナー ── */}
      {phase === "trophy" && launchInfo && (
        <div className="trophy-banner">
          <div className="trophy-gen">⚔️ 第{launchInfo.roundNo}代 とばした人</div>
          <div className="trophy-name">{wonName ?? launchInfo.name ?? "ななし"}</div>
          <a
            className="btn btn-share"
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
          >
            Xで じまんする
          </a>
        </div>
      )}

      {/* ── とばした人へのごほうび(新しい剣・チャーム) ── */}
      {phase === "trophy" && <SkinUnlockCard />}

      {/* ── 新ラウンド降臨バナー ── */}
      {phase === "new-round" && (
        <div className="center-stage">
          <div className="newround-banner">
            <span className="newround-gen">第{genNo}代 こすくまくん</span>
            <span className="newround-sub">あらわる！</span>
          </div>
        </div>
      )}

      {/* ── チャーム獲得のお祝い(音と同時に、こすくまくんのあたりで) ── */}
      <CharmGet />

      {/* ── 通信状態 ── */}
      {!connected && <div className="conn-warn">つうしん よわい…</div>}

      {/* ── 当たりの白フラッシュ ── */}
      {flashId !== 0 && (
        <div
          key={flashId}
          className="win-flash"
          onAnimationEnd={() => setFlashId(0)}
        />
      )}

      {/* 刺している最中の、大きなチャーム */}
      <StabCharms />

      {/* 右上「だれが刺したか」の通知 */}
      <StabNotice />

      <GearDrawer open={gearOpen} onClose={() => setGearOpen(false)} />
      <FeedLog open={logOpen} onClose={() => setLogOpen(false)} />
      <ShareCard open={shareOpen} onClose={() => setShareOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
