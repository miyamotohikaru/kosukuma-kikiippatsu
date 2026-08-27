"use client";

// 刺さった瞬間の土煙。"impact" イベントで穴の位置から月面(接平面)に沿って
// 淡いスプライトを放射し、減速しながら 0.6 秒でフェードする。常駐・イベント駆動。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { onGameEvent } from "@/game/events";
import { useGameStore } from "@/game/store";
import { getHoleWorld } from "@/game/scene/sharedRefs";
import { makeCircleTexture } from "./textures";

const COUNT = 15;
const LIFE = 0.6; // 秒

// スクラッチ(接平面の基底計算用)
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _axis = new THREE.Vector3();

interface DustRig {
  root: THREE.Group;
  sprites: THREE.Sprite[];
  mat: THREE.SpriteMaterial;
  dispose: () => void;
}

function buildDust(): DustRig {
  const tex = makeCircleTexture();
  // 月の土(淡いラベンダーグレー)。通常ブレンドでほこりっぽく
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: "#d9def0",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const root = new THREE.Group();
  root.visible = false;
  const sprites: THREE.Sprite[] = [];
  for (let i = 0; i < COUNT; i++) {
    const sp = new THREE.Sprite(mat);
    sp.frustumCulled = false;
    sprites.push(sp);
    root.add(sp);
  }
  return {
    root,
    sprites,
    mat,
    dispose: () => {
      mat.dispose();
      tex.dispose();
    },
  };
}

export default function ImpactDust() {
  const rig = useMemo(buildDust, []);
  useEffect(() => () => rig.dispose(), [rig]);

  // バースト状態は全部 ref(React ステートは使わない)
  const runRef = useRef({
    active: false,
    age: 0,
    vels: Array.from({ length: COUNT }, () => new THREE.Vector3()),
    baseScale: new Float32Array(COUNT),
  });

  useEffect(
    () =>
      onGameEvent((type) => {
        if (type !== "impact") return;
        // impact 時点では selectedHole がまだ残っている(store は判定後に null にする)
        const holeId = useGameStore.getState().selectedHole;
        if (holeId === null) return;
        const hw = getHoleWorld(holeId);
        const run = runRef.current;
        // 法線に直交する接平面の基底を作る
        _axis.set(0, 1, 0);
        if (Math.abs(hw.normal.y) > 0.95) _axis.set(1, 0, 0);
        _t1.crossVectors(_axis, hw.normal).normalize();
        _t2.crossVectors(hw.normal, _t1);
        for (let i = 0; i < COUNT; i++) {
          const th = (i / COUNT) * Math.PI * 2 + Math.random() * 0.9;
          const spd = 1.1 + Math.random() * 1.6;
          run.vels[i]
            .copy(_t1)
            .multiplyScalar(Math.cos(th) * spd)
            .addScaledVector(_t2, Math.sin(th) * spd)
            .addScaledVector(hw.normal, 0.35 + Math.random() * 0.7);
          rig.sprites[i].position
            .copy(hw.pos)
            .addScaledVector(hw.normal, 0.06)
            .addScaledVector(run.vels[i], 0.03);
          run.baseScale[i] = 0.22 + Math.random() * 0.26;
        }
        run.age = 0;
        run.active = true;
        rig.root.visible = true;
      }),
    [rig]
  );

  useFrame((_, dt) => {
    const run = runRef.current;
    if (!run.active) return;
    run.age += dt;
    const k = Math.min(run.age / LIFE, 1);
    if (k >= 1) {
      run.active = false;
      rig.root.visible = false;
      return;
    }
    // 放射 → 指数減速しつつ、広がりながら薄くなる
    const damp = Math.exp(-5.5 * dt);
    for (let i = 0; i < COUNT; i++) {
      const sp = rig.sprites[i];
      run.vels[i].multiplyScalar(damp);
      sp.position.addScaledVector(run.vels[i], dt);
      sp.scale.setScalar(run.baseScale[i] * (1 + 1.8 * k));
    }
    rig.mat.opacity = 0.55 * Math.pow(1 - k, 1.4);
  });

  return <primitive object={rig.root} />;
}
