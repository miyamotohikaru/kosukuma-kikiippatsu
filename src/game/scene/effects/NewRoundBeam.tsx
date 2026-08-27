"use client";

// 新こすくまくん降臨ビーム。new-round の間だけマウントされる。
// 北極上空から着地点へ光の柱(縦長シリンダー、加算、フェードイン/アウト)が立ち、
// ビームの中をきらきらが舞い降り、着地のタイミングで星が弾ける。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { MOON_RADIUS, T_NEW_ROUND } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { kosukumaWorldPos } from "@/game/scene/sharedRefs";
import { clamp01, easeInCubic, easeOutCubic, mod } from "./easing";
import { makeBeamTexture, makeStarTexture } from "./textures";

const BEAM_LEN = 9;
const GLITTER = 14; // ビーム内を舞い降りるきらきらの数
const BURST = 18; // 着地時に弾ける星の数
const LAND_AT = 0.58; // T_NEW_ROUND 比: このあたりで着地キラキラ
const BURST_LIFE = 0.9; // 秒

const UP = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

interface GlitterSeed {
  x: number;
  z: number;
  y0: number;
  speed: number;
  scale: number;
  phase: number;
}

interface BeamRig {
  root: THREE.Group;
  beam: THREE.Group;
  outerMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
  glitter: THREE.Sprite[];
  glitterSeed: GlitterSeed[];
  glitterMat: THREE.SpriteMaterial;
  burst: THREE.Sprite[];
  burstRoot: THREE.Group;
  burstMat: THREE.SpriteMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function buildBeam(): BeamRig {
  const beamTex = makeBeamTexture();
  const starTex = makeStarTexture();
  const disposables: { dispose: () => void }[] = [beamTex, starTex];

  const root = new THREE.Group();

  // 光の柱: 外側(淡い金)+ 芯(白)。縦グラデで上端は宇宙に溶ける
  const beam = new THREE.Group();
  const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  disposables.push(cylGeom);
  const outerMat = new THREE.MeshBasicMaterial({
    color: "#ffe9a0",
    map: beamTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    map: beamTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  disposables.push(outerMat, coreMat);
  const outer = new THREE.Mesh(cylGeom, outerMat);
  outer.scale.set(0.6, BEAM_LEN, 0.6);
  outer.position.y = BEAM_LEN / 2;
  outer.frustumCulled = false;
  const core = new THREE.Mesh(cylGeom, coreMat);
  core.scale.set(0.24, BEAM_LEN * 0.99, 0.24);
  core.position.y = BEAM_LEN / 2;
  core.frustumCulled = false;
  beam.add(outer, core);

  // ビーム内を舞い降りるきらきら(ビームのローカル座標に置く)
  const glitterMat = new THREE.SpriteMaterial({
    map: starTex,
    color: "#fff3b8",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  disposables.push(glitterMat);
  const glitter: THREE.Sprite[] = [];
  const glitterSeed: GlitterSeed[] = [];
  for (let i = 0; i < GLITTER; i++) {
    const sp = new THREE.Sprite(glitterMat);
    sp.frustumCulled = false;
    glitter.push(sp);
    beam.add(sp);
    glitterSeed.push({
      x: (Math.random() - 0.5) * 0.9,
      z: (Math.random() - 0.5) * 0.9,
      y0: Math.random() * BEAM_LEN,
      speed: 1.1 + Math.random() * 1.3,
      scale: 0.12 + Math.random() * 0.14,
      phase: Math.random() * Math.PI * 2,
    });
  }
  root.add(beam);

  // 着地の星バースト(ワールド座標)
  const burstMat = new THREE.SpriteMaterial({
    map: starTex,
    color: "#fff9dd",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  disposables.push(burstMat);
  const burstRoot = new THREE.Group();
  burstRoot.visible = false;
  const burst: THREE.Sprite[] = [];
  for (let i = 0; i < BURST; i++) {
    const sp = new THREE.Sprite(burstMat);
    sp.frustumCulled = false;
    burst.push(sp);
    burstRoot.add(sp);
  }
  root.add(burstRoot);

  // 着地の広がるリング
  const ringGeom = new THREE.RingGeometry(0.45, 0.55, 40);
  disposables.push(ringGeom);
  const ringMat = new THREE.MeshBasicMaterial({
    color: "#ffd93d",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  disposables.push(ringMat);
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.visible = false;
  ring.frustumCulled = false;
  root.add(ring);

  return {
    root,
    beam,
    outerMat,
    coreMat,
    glitter,
    glitterSeed,
    glitterMat,
    burst,
    burstRoot,
    burstMat,
    ring,
    ringMat,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export default function NewRoundBeam() {
  const rig = useMemo(buildBeam, []);
  useEffect(() => () => rig.dispose(), [rig]);

  // 着地バーストの状態(このコンポーネントは new-round のたびに作り直されるので毎回まっさら)
  const runRef = useRef({
    started: false,
    age: 0,
    vels: Array.from({ length: BURST }, () => new THREE.Vector3()),
    scales: new Float32Array(BURST),
  });

  useFrame((_, dt) => {
    const s = useGameStore.getState();
    const t = Date.now() - s.phaseAt;

    // 向き: 月中心 → 降下中のこすくまくん。未初期化なら北極
    _axis.copy(kosukumaWorldPos);
    if (_axis.lengthSq() < 1e-6) _axis.set(0, 1, 0);
    _axis.normalize();
    _ground.copy(_axis).multiplyScalar(MOON_RADIUS + 0.03);
    rig.beam.position.copy(_ground);
    _q.setFromUnitVectors(UP, _axis);
    _qYaw.setFromAxisAngle(UP, (t / 1000) * 0.7); // ゆっくり回してシマーを出す
    rig.beam.quaternion.copy(_q).multiply(_qYaw);

    // フェードイン/アウト + ゆらぎ
    const fadeIn = easeOutCubic(clamp01(t / 380));
    const fadeOut = 1 - easeInCubic(clamp01((t - (T_NEW_ROUND - 700)) / 700));
    const fade = fadeIn * fadeOut;
    const pulse = 1 + 0.13 * Math.sin((t / 1000) * 7.3);
    rig.outerMat.opacity = 0.3 * fade * pulse;
    rig.coreMat.opacity = 0.55 * fade * pulse;
    const breathe = 1 + 0.05 * Math.sin((t / 1000) * 5.1);
    rig.beam.scale.set(breathe, 1, breathe);

    // きらきら: ビームの中をループしながら降下
    rig.glitterMat.opacity = 0.85 * fade;
    for (let i = 0; i < GLITTER; i++) {
      const sd = rig.glitterSeed[i];
      const y = mod(sd.y0 - (t / 1000) * sd.speed, BEAM_LEN * 0.94);
      rig.glitter[i].position.set(sd.x, y + 0.15, sd.z);
      rig.glitter[i].scale.setScalar(
        sd.scale * (0.7 + 0.3 * Math.sin((t / 1000) * 9 + sd.phase))
      );
    }

    // 着地キラキラ: LAND_AT 時点で1回だけ弾ける
    const run = runRef.current;
    if (!run.started && t >= T_NEW_ROUND * LAND_AT) {
      run.started = true;
      run.age = 0;
      // 接平面の基底から放射方向を作る
      _t1.set(0, 1, 0);
      if (Math.abs(_axis.y) > 0.95) _t1.set(1, 0, 0);
      _t2.crossVectors(_t1, _axis).normalize();
      _t1.crossVectors(_axis, _t2);
      for (let i = 0; i < BURST; i++) {
        const th = (i / BURST) * Math.PI * 2 + Math.random() * 0.7;
        const spd = 0.7 + Math.random() * 1.2;
        run.vels[i]
          .copy(_t2)
          .multiplyScalar(Math.cos(th) * spd)
          .addScaledVector(_t1, Math.sin(th) * spd)
          .addScaledVector(_axis, 0.9 + Math.random() * 1.1);
        rig.burst[i].position.copy(_ground).addScaledVector(_axis, 0.1);
        run.scales[i] = 0.16 + Math.random() * 0.2;
      }
      rig.burstRoot.visible = true;
      rig.ring.visible = true;
    }
    if (run.started && run.age < BURST_LIFE) {
      run.age += dt;
      const k = clamp01(run.age / BURST_LIFE);
      const damp = Math.exp(-3.2 * dt);
      for (let i = 0; i < BURST; i++) {
        run.vels[i].multiplyScalar(damp);
        rig.burst[i].position.addScaledVector(run.vels[i], dt);
        rig.burst[i].scale.setScalar(run.scales[i] * (1 + 0.8 * k));
      }
      rig.burstMat.opacity = 0.95 * Math.pow(1 - k, 1.2);
      // 地面を走るリング
      const rk = clamp01(run.age / 0.7);
      rig.ring.scale.setScalar(0.5 + 2.4 * easeOutCubic(rk));
      rig.ringMat.opacity = 0.7 * Math.pow(1 - rk, 1.5);
      rig.ring.position.copy(_ground).addScaledVector(_axis, 0.04);
      rig.ring.quaternion.setFromUnitVectors(_Z, _axis);
    } else if (run.started) {
      rig.burstRoot.visible = false;
      rig.ring.visible = false;
    }
  });

  return <primitive object={rig.root} />;
}
