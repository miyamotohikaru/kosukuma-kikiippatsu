"use client";

// 授与式の紙吹雪。trophy の間だけマウントされ、カメラ前方のローカル空間で
// カラフルな板ポリ30枚が回転しながら舞い落ちる(下端に出たら上へループ)。

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { T_TROPHY } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { hashString, mulberry32, pick, randRange } from "@/lib/prng";
import { clamp01, easeOutCubic, mod } from "./easing";

const COUNT = 30;
const AREA_H = 5.6; // ループする高さ(ローカル)
const CONFETTI_COLORS = [
  "#ffd93d", // 星の黄
  "#ffb3c7", // ピンク
  "#7ce38b", // ミント
  "#8bd3ff", // 空色
  "#fffef2", // クリーム
  "#ff9d6b", // オレンジ
] as const;

const _dummy = new THREE.Object3D();

interface ConfettiSeed {
  x: number;
  y0: number;
  z: number;
  speed: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  r1: number;
  r2: number;
  p1: number;
  p2: number;
  scale: number;
}

interface ConfettiRig {
  root: THREE.Group;
  mesh: THREE.InstancedMesh;
  mat: THREE.MeshBasicMaterial;
  seeds: ConfettiSeed[];
  dispose: () => void;
}

function buildConfetti(): ConfettiRig {
  // 決定的な乱数で毎回同じ「良い散らばり」にする
  const rng = mulberry32(hashString("kosukuma-confetti"));
  const geom = new THREE.PlaneGeometry(0.14, 0.09);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const color = new THREE.Color();
  const seeds: ConfettiSeed[] = [];
  for (let i = 0; i < COUNT; i++) {
    seeds.push({
      x: randRange(rng, -2.3, 2.3),
      y0: randRange(rng, -2.8, 2.8),
      z: randRange(rng, -6, -3.2), // カメラの少し前
      speed: randRange(rng, 0.55, 1.25),
      swayAmp: randRange(rng, 0.15, 0.5),
      swayFreq: randRange(rng, 1.2, 2.6),
      swayPhase: randRange(rng, 0, Math.PI * 2),
      r1: randRange(rng, 2, 5.5),
      r2: randRange(rng, 1, 3.2),
      p1: randRange(rng, 0, Math.PI * 2),
      p2: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.7, 1.4),
    });
    mesh.setColorAt(i, color.set(pick(rng, CONFETTI_COLORS)));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const root = new THREE.Group();
  root.add(mesh);
  return {
    root,
    mesh,
    mat,
    seeds,
    dispose: () => {
      geom.dispose();
      mat.dispose();
    },
  };
}

export default function TrophyConfetti() {
  const rig = useMemo(buildConfetti, []);
  useEffect(() => () => rig.dispose(), [rig]);

  useFrame((state) => {
    const s = useGameStore.getState();
    const t = Date.now() - s.phaseAt;
    const time = state.clock.elapsedTime;

    // カメラに追従(前方ローカル空間で舞わせる)
    rig.root.position.copy(state.camera.position);
    rig.root.quaternion.copy(state.camera.quaternion);

    // 授与式の頭とお尻でふわっと出入りする
    const fadeIn = easeOutCubic(clamp01(t / 400));
    const fadeOut = 1 - clamp01((t - (T_TROPHY - 450)) / 450);
    rig.mat.opacity = 0.95 * fadeIn * fadeOut;

    for (let i = 0; i < COUNT; i++) {
      const sd = rig.seeds[i];
      // 落下(下端でループ) + 横揺れ + 2軸回転のひらひら
      const fall = mod(2.8 - sd.y0 + time * sd.speed, AREA_H);
      const y = 2.8 - fall;
      const x = sd.x + Math.sin(time * sd.swayFreq + sd.swayPhase) * sd.swayAmp;
      _dummy.position.set(x, y, sd.z);
      _dummy.rotation.set(time * sd.r1 + sd.p1, time * sd.r2 + sd.p2, 0);
      _dummy.scale.setScalar(sd.scale);
      _dummy.updateMatrix();
      rig.mesh.setMatrixAt(i, _dummy.matrix);
    }
    rig.mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={rig.root} />;
}
