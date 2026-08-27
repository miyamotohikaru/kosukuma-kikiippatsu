"use client";

// 3Dシーンのルート。<Canvas>にシーン全要素・エフェクト・トロフィー授与式を
// マウントする。GLBのロード完了で store.setReady3d() を通知。

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { COLORS } from "@/lib/config";
import { useGameStore } from "@/game/store";
import Moon from "./Moon";
import Holes from "./Holes";
import Swords from "./Swords";
import Kosukuma from "./Kosukuma";
import SpeechAnchor from "./SpeechAnchor";
import Starfield from "./Starfield";
import Earth from "./Earth";
import CameraRig from "./CameraRig";
import EffectsRoot from "@/game/scene/effects/EffectsRoot";
import TrophyCeremony from "@/game/trophy/TrophyCeremony";

// タイトル表示中にGLBを先読みしておく
useGLTF.preload("/models/kosukuma.glb");

/** Suspense解決後(=GLB等のロード完了後)にマウントされ、storeへ通知する */
function ReadyNotifier() {
  const setReady3d = useGameStore((state) => state.setReady3d);
  useEffect(() => {
    setReady3d();
  }, [setReady3d]);
  return null;
}

export default function GameCanvas() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 45, position: [0, 2, 20], near: 0.1, far: 300 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={[COLORS.spaceDeep]} />
      {/* 薄いフォグ。月の遠端にだけ効く程度の奥行き表現 */}
      <fog attach="fog" args={[COLORS.spaceDeep, 30, 190]} />

      {/* ── ライティング: 「やわらかい玩具」に見せる3灯 ── */}
      <ambientLight color="#8890c8" intensity={0.55} />
      {/* 暖色キーライト */}
      <directionalLight position={[7, 9, 5]} color="#fff0d8" intensity={2.4} />
      {/* 青系フィル(影を冷たく起こす) */}
      <directionalLight position={[-8, -3, 6]} color="#6f7fff" intensity={0.7} />
      {/* リム(輪郭の光) */}
      <directionalLight position={[-3, 5, -9]} color="#cfe0ff" intensity={1.4} />

      <Suspense fallback={null}>
        <Starfield />
        <Earth />
        <Moon />
        <Holes />
        <Swords />
        <Kosukuma />
        {/* Kosukuma のあとに置く: 更新ずみのワールド座標をその場で投影する */}
        <SpeechAnchor />
        <EffectsRoot />
        <TrophyCeremony />
        <ReadyNotifier />
      </Suspense>
      <CameraRig />
    </Canvas>
  );
}
