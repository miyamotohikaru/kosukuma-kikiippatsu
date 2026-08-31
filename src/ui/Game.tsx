"use client";

// アプリの組み立てルート。3Dキャンバスの上にUIオーバーレイを重ねる。

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useGameStore } from "@/game/store";
import AudioDirector from "@/game/audio/AudioDirector";
import SpeechDirector from "@/game/speech/SpeechDirector";
import TitleScreen from "./TitleScreen";
import Hud from "./Hud";
import WaitDeck from "./WaitDeck";
import TapPop from "./TapPop";
import NameModal from "./NameModal";
import Toast from "./Toast";

const GameCanvas = dynamic(() => import("@/game/scene/GameCanvas"), {
  ssr: false,
});

// 吹き出しは3Dの共有座標(three依存)を読むので、GameCanvasと同じく遅延読み込み。
// タイトルの初回表示にthree.jsを持ち込まないための分割。
const SpeechBubble = dynamic(() => import("./SpeechBubble"), { ssr: false });

// 月の1000本にぶら下げるチャームの絵を1枚に焼く。画面の外でSVGを描いて
// カンバスへ写し取るだけなので、DOM側に置く(焼けたら自分で消える)
const CharmAtlasBuilder = dynamic(
  () => import("@/game/scene/effects/charmAtlas"),
  { ssr: false }
);

export default function Game() {
  const init = useGameStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="game-root">
      <GameCanvas />
      {/* 吹き出しは3Dの上・HUDの下(speech.css の z-index:5) */}
      <SpeechBubble />
      <Hud />
      <WaitDeck />
      <TapPop />
      <TitleScreen />
      <NameModal />
      <Toast />
      <CharmAtlasBuilder />
      <AudioDirector />
      <SpeechDirector />
    </div>
  );
}
