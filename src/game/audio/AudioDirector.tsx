"use client";

// 音の指揮者。何も描画しない(return null)。
//   - onGameEvent 購読 → 対応するSFXを再生
//   - store.phase 購読 → suspense 心拍の開始/停止、title→idle の開始タップで
//     AudioContext を初期化(ユーザージェスチャ内)+アンビエント開始
//   - store.muted 購読 → マスターGainを即時 0/復帰(localStorage永続はstore側)
//   - visibilitychange → suspend/resume

import { useEffect } from "react";
import { useGameStore } from "@/game/store";
import { onGameEvent, type GameEventType } from "@/game/events";
import * as sfx from "./sfx";
import { startAmbient, stopAmbient } from "./ambient";

export default function AudioDirector() {
  useEffect(() => {
    // ── AudioContext 初期化(必ずユーザージェスチャの呼び出し中に行う) ──
    // 戻り値: この呼び出しで新規初期化したか
    const bootAudio = (): boolean => {
      if (sfx.isAudioReady()) return false;
      if (!sfx.initAudio()) return false;
      sfx.setMuted(useGameStore.getState().muted);
      startAmbient();
      return true;
    };

    // フェーズ/ミュートの変化を監視。
    // title→idle は開始ボタンのクリックハンドラ内で同期的に流れてくるので、
    // ここでの initAudio はジェスチャ文脈が保たれる。
    const unsubStore = useGameStore.subscribe((s, prev) => {
      if (s.muted !== prev.muted) sfx.setMuted(s.muted);
      if (s.phase === prev.phase) return;
      if (prev.phase === "title" && s.phase === "idle") {
        // start() は setPhase の前に ui-tap を emit するため、初回だけ鳴り損ねる。
        // 初期化に成功したこの場で鳴らして「音が出た」手応えを返す。
        if (bootAudio()) sfx.uiTap();
      }
      if (s.phase === "suspense") sfx.startSuspense();
      else if (prev.phase === "suspense") sfx.stopSuspense();
    });

    // リロード復帰(name-entry等)でtitleを経ないケースの保険:
    // 最初のポインタ操作で初期化して、その後リスナーを外す。
    const onFirstPointer = () => {
      const p = useGameStore.getState().phase;
      if (p === "boot" || p === "title") return; // タイトル中は無音のまま
      bootAudio();
      if (sfx.isAudioReady()) {
        window.removeEventListener("pointerdown", onFirstPointer, true);
      }
    };
    window.addEventListener("pointerdown", onFirstPointer, true);

    // ── 単発イベント → SFX ──
    const unsubEvents = onGameEvent((type: GameEventType) => {
      switch (type) {
        case "ui-tap":
          sfx.uiTap();
          break;
        case "hover":
          sfx.hover();
          break;
        case "sword-raise":
          sfx.swordRaise();
          break;
        case "thrust":
          sfx.thrust();
          break;
        case "impact":
          sfx.impact();
          break;
        case "suspense":
          sfx.startSuspense(); // フェーズ購読と二重でも冪等
          break;
        case "safe":
          sfx.safe();
          break;
        case "win-flash":
          sfx.winFlash();
          break;
        case "launch":
          sfx.launch();
          break;
        case "fireworks":
          sfx.fireworks();
          break;
        case "fanfare":
          sfx.fanfare();
          break;
        case "trophy":
          sfx.trophy();
          break;
        case "new-round":
          sfx.newRound();
          break;
        case "remote-stab":
          sfx.remoteStab();
          break;
        case "charm-get":
          sfx.charmGet();
          break;
        case "skin-unlock":
          sfx.skinUnlock();
          break;
        case "earth-tap":
          // 進捗でピッチを上げるため、いま何回目かを渡す。
          // store 側は set() のあとに emit するので、この値は更新済み。
          // リロードをまたいでも localStorage 由来の正しい回数になる。
          sfx.earthTap(useGameStore.getState().earthClicks);
          break;
        case "earth-boom":
          sfx.earthBoom();
          break;
        case "kosukuma-poke":
          // 連打の音階(何段目か)は sfx 側が時刻から数える。
          // storeに状態を増やさずに「押しつづけると音が育つ」を作るため
          sfx.kosukumaPoke();
          break;
        case "cooldown-ready":
          sfx.cooldownReady();
          break;
        case "error":
          sfx.error();
          break;
      }
    });

    // ── タブ非表示で止め、復帰で再開 ──
    const onVisibility = () => {
      if (document.hidden) sfx.suspendAudio();
      else sfx.resumeAudio();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubStore();
      unsubEvents();
      window.removeEventListener("pointerdown", onFirstPointer, true);
      document.removeEventListener("visibilitychange", onVisibility);
      sfx.stopSuspense();
      stopAmbient();
    };
  }, []);

  return null;
}
