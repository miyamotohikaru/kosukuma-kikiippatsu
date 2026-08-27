"use client";

// 発射カットシーンの演出一式:
//   (1) 発射点で広がる衝撃リング2枚
//   (2) 上昇中の kosukumaWorldPos から湧き続ける星型トレイル(加算、黄→ピンク)
//   (3) T_LAUNCH の約75%時点で花火バースト(3色×40個、少し重力)+ "fireworks" イベント発火
// "launch" イベント駆動で常駐する(観客のカットシーンでも動く)。
// 粒子は GPU 側で動かす(スポーン時だけ属性を書き、以降は uTime で移動)。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { MOON_RADIUS, T_LAUNCH } from "@/lib/config";
import { emitGameEvent, onGameEvent } from "@/game/events";
import { kosukumaWorldPos } from "@/game/scene/sharedRefs";
import { easeOutCubic } from "./easing";
import { makeCircleTexture, makeStarTexture } from "./textures";

const TRAIL_COUNT = 240;
const TRAIL_LIFE = 1.15; // 秒
const FW_COUNT = 120; // 3色 × 40個
const FW_LIFE = 1.5; // 秒
const FW_AT = 0.75; // T_LAUNCH 比の花火タイミング
const RING_DELAYS = [0, 0.18]; // 秒
const RING_DUR = 0.95; // 秒

// 花火の3色(シェーダー直書きなので sRGB 値をそのまま渡す)
const FW_PALETTE: readonly [number, number, number][] = [
  [1.0, 0.851, 0.239], // 星の黄 (#ffd93d)
  [1.0, 0.702, 0.78], // ピンク (#ffb3c7)
  [0.486, 0.89, 0.545], // ミント (#7ce38b)
];

const _axis = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

// ── シェーダー ──────────────────────────────────────
// トレイル: スポーン位置 + 速度×経過時間。星は個体ごとに回転、黄→ピンクに変色
const TRAIL_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aBirth;
attribute vec3 aVel;
attribute float aSize;
attribute float aSeed;
varying float vT;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float t = age / ${TRAIL_LIFE.toFixed(2)};
  float alive = (aBirth >= 0.0 && t >= 0.0 && t < 1.0) ? 1.0 : 0.0;
  t = clamp(t, 0.0, 1.0);
  vT = t;
  vSeed = aSeed;
  vec3 p = position + aVel * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = alive * aSize * (1.0 - 0.55 * t) * uScale / max(0.1, -mv.z);
}
`;
const TRAIL_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vT;
varying float vSeed;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float a = vSeed * 6.2831 + vT * 2.0;
  float c = cos(a);
  float s = sin(a);
  uv = mat2(c, -s, s, c) * uv + 0.5;
  float alpha = texture2D(uMap, uv).a * (1.0 - vT);
  vec3 col = mix(vec3(1.0, 0.85, 0.30), vec3(1.0, 0.62, 0.78), vT);
  gl_FragColor = vec4(col, alpha);
}
`;

// 花火: バースト中心から指数減速で放射 + 少し重力。きらきら明滅
const FW_VERT = /* glsl */ `
uniform float uTime;
uniform float uBurst;
uniform float uScale;
attribute vec3 aVel;
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
varying vec3 vColor;
varying float vT;
void main() {
  float age = uTime - uBurst;
  float t = age / ${FW_LIFE.toFixed(2)};
  float alive = (uBurst >= 0.0 && t >= 0.0 && t < 1.0) ? 1.0 : 0.0;
  t = clamp(t, 0.0, 1.0);
  vT = t;
  vColor = aColor;
  age = clamp(age, 0.0, ${FW_LIFE.toFixed(2)});
  // 指数ダンピングの積分で減速 + ちょっとだけ重力
  float k = 2.2;
  vec3 p = position + aVel * (1.0 - exp(-k * age)) / k + vec3(0.0, -0.9, 0.0) * age * age * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.75 + 0.25 * sin(uTime * 18.0 + aSeed * 40.0);
  gl_PointSize = alive * aSize * mix(1.0, 0.45, t) * tw * uScale / max(0.1, -mv.z);
}
`;
const FW_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vT;
void main() {
  float alpha = texture2D(uMap, gl_PointCoord).a * pow(1.0 - vT, 1.3);
  gl_FragColor = vec4(vColor, alpha);
}
`;

interface LaunchRig {
  root: THREE.Group;
  ringAnchor: THREE.Group;
  rings: THREE.Mesh[];
  ringMats: THREE.MeshBasicMaterial[];
  trailMat: THREE.ShaderMaterial;
  trailPos: THREE.BufferAttribute;
  trailVel: THREE.BufferAttribute;
  trailBirth: THREE.BufferAttribute;
  fwMat: THREE.ShaderMaterial;
  fwPos: THREE.BufferAttribute;
  fwVel: THREE.BufferAttribute;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  dispose: () => void;
}

function buildLaunch(): LaunchRig {
  const circleTex = makeCircleTexture();
  const starTex = makeStarTexture();
  const disposables: { dispose: () => void }[] = [circleTex, starTex];

  const root = new THREE.Group();
  root.visible = false;

  // (1) 衝撃リング ×2(白 → 黄の順で広がる)
  const ringGeom = new THREE.RingGeometry(0.42, 0.5, 48);
  disposables.push(ringGeom);
  const ringAnchor = new THREE.Group();
  const ringColors = ["#fff8dc", "#ffd93d"];
  const rings: THREE.Mesh[] = [];
  const ringMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: ringColors[i],
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    disposables.push(m);
    const mesh = new THREE.Mesh(ringGeom, m);
    mesh.position.z = 0.03 * (i + 1); // z-fight 回避
    mesh.frustumCulled = false;
    ringMats.push(m);
    rings.push(mesh);
    ringAnchor.add(mesh);
  }
  root.add(ringAnchor);

  // (2) 星のトレイル(リングバッファ。サイズ/シードは固定、位置/速度/誕生時刻だけ書き換える)
  const trailGeom = new THREE.BufferGeometry();
  const trailPos = new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3);
  const trailVel = new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3);
  const trailBirth = new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT).fill(-1), 1);
  const trailSize = new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT), 1);
  const trailSeed = new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT), 1);
  for (let i = 0; i < TRAIL_COUNT; i++) {
    trailSize.setX(i, 0.2 + Math.random() * 0.22);
    trailSeed.setX(i, Math.random());
  }
  trailPos.setUsage(THREE.DynamicDrawUsage);
  trailVel.setUsage(THREE.DynamicDrawUsage);
  trailBirth.setUsage(THREE.DynamicDrawUsage);
  trailGeom.setAttribute("position", trailPos);
  trailGeom.setAttribute("aVel", trailVel);
  trailGeom.setAttribute("aBirth", trailBirth);
  trailGeom.setAttribute("aSize", trailSize);
  trailGeom.setAttribute("aSeed", trailSeed);
  disposables.push(trailGeom);
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uMap: { value: starTex } },
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(trailMat);
  const trail = new THREE.Points(trailGeom, trailMat);
  trail.frustumCulled = false;
  root.add(trail);

  // (3) 花火(ワンショット。バースト時に位置と速度を書き込む)
  const fwGeom = new THREE.BufferGeometry();
  const fwPos = new THREE.BufferAttribute(new Float32Array(FW_COUNT * 3), 3);
  const fwVel = new THREE.BufferAttribute(new Float32Array(FW_COUNT * 3), 3);
  const fwColor = new THREE.BufferAttribute(new Float32Array(FW_COUNT * 3), 3);
  const fwSize = new THREE.BufferAttribute(new Float32Array(FW_COUNT), 1);
  const fwSeed = new THREE.BufferAttribute(new Float32Array(FW_COUNT), 1);
  for (let i = 0; i < FW_COUNT; i++) {
    const c = FW_PALETTE[i % FW_PALETTE.length];
    fwColor.setXYZ(i, c[0], c[1], c[2]);
    fwSize.setX(i, 0.24 + Math.random() * 0.3);
    fwSeed.setX(i, Math.random());
  }
  fwPos.setUsage(THREE.DynamicDrawUsage);
  fwVel.setUsage(THREE.DynamicDrawUsage);
  fwGeom.setAttribute("position", fwPos);
  fwGeom.setAttribute("aVel", fwVel);
  fwGeom.setAttribute("aColor", fwColor);
  fwGeom.setAttribute("aSize", fwSize);
  fwGeom.setAttribute("aSeed", fwSeed);
  disposables.push(fwGeom);
  const fwMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBurst: { value: -1 },
      uScale: { value: 1 },
      uMap: { value: circleTex },
    },
    vertexShader: FW_VERT,
    fragmentShader: FW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(fwMat);
  const fw = new THREE.Points(fwGeom, fwMat);
  fw.frustumCulled = false;
  root.add(fw);

  // 花火の閃光(1枚の加算スプライトをぱっと広げる)
  const flashMat = new THREE.SpriteMaterial({
    map: circleTex,
    color: "#fffbe8",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  disposables.push(flashMat);
  const flash = new THREE.Sprite(flashMat);
  flash.frustumCulled = false;
  root.add(flash);

  return {
    root,
    ringAnchor,
    rings,
    ringMats,
    trailMat,
    trailPos,
    trailVel,
    trailBirth,
    fwMat,
    fwPos,
    fwVel,
    flash,
    flashMat,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export default function LaunchFx() {
  const rig = useMemo(buildLaunch, []);
  useEffect(() => () => rig.dispose(), [rig]);

  const runRef = useRef({
    pending: false, // "launch" 受信済み・次フレームで開始
    active: false,
    start: 0, // clock 秒
    fired: false, // 花火発射済みか
    cursor: 0, // トレイルのリングバッファ位置
    flashAt: -1, // 閃光の開始時刻(clock 秒)
  });

  useEffect(
    () =>
      onGameEvent((type) => {
        if (type === "launch") runRef.current.pending = true;
      }),
    []
  );

  useFrame((state) => {
    const run = runRef.current;
    const now = state.clock.elapsedTime;

    if (run.pending) {
      // 発射開始: リングを今のこすくまくんの足元(月面)に設置
      run.pending = false;
      run.active = true;
      run.start = now;
      run.fired = false;
      run.flashAt = -1;
      rig.fwMat.uniforms.uBurst.value = -1;
      _axis.copy(kosukumaWorldPos);
      if (_axis.lengthSq() < 1e-6) _axis.set(0, 1, 0);
      _axis.normalize();
      rig.ringAnchor.position.copy(_axis).multiplyScalar(MOON_RADIUS + 0.06);
      rig.ringAnchor.quaternion.setFromUnitVectors(_Z, _axis);
      rig.root.visible = true;
    }
    if (!run.active) return;

    // gl_PointSize 換算係数(デバイスピクセル基準)
    const uScale = state.size.height * state.gl.getPixelRatio() * 0.5;
    rig.trailMat.uniforms.uTime.value = now;
    rig.trailMat.uniforms.uScale.value = uScale;
    rig.fwMat.uniforms.uTime.value = now;
    rig.fwMat.uniforms.uScale.value = uScale;

    const el = (now - run.start) * 1000; // 経過ms

    // (1) 衝撃リング: 時間差で2枚、ぱっと広がって薄れる
    for (let i = 0; i < rig.rings.length; i++) {
      const k = (now - run.start - RING_DELAYS[i]) / RING_DUR;
      const m = rig.ringMats[i];
      if (k < 0 || k > 1) {
        m.opacity = 0;
        continue;
      }
      rig.rings[i].scale.setScalar(0.4 + (9 - i * 3) * easeOutCubic(k));
      m.opacity = 0.85 * Math.pow(1 - k, 1.6);
    }

    // (2) 星のトレイル: 上昇中は毎フレーム数個ずつ湧かせる
    if (el < T_LAUNCH * 0.92) {
      for (let n = 0; n < 3; n++) {
        const i = run.cursor;
        run.cursor = (run.cursor + 1) % TRAIL_COUNT;
        rig.trailPos.setXYZ(
          i,
          kosukumaWorldPos.x + (Math.random() - 0.5) * 0.3,
          kosukumaWorldPos.y + (Math.random() - 0.5) * 0.3,
          kosukumaWorldPos.z + (Math.random() - 0.5) * 0.3
        );
        // その場に置き去りつつ、ほんの少し流れ落ちる
        rig.trailVel.setXYZ(
          i,
          (Math.random() - 0.5) * 0.8,
          -0.3 - Math.random() * 0.7,
          (Math.random() - 0.5) * 0.8
        );
        rig.trailBirth.setX(i, now);
      }
      rig.trailPos.needsUpdate = true;
      rig.trailVel.needsUpdate = true;
      rig.trailBirth.needsUpdate = true;
    }

    // (3) 花火: 75% 時点で1回だけバースト + 音チームへイベント
    if (!run.fired && el >= T_LAUNCH * FW_AT) {
      run.fired = true;
      rig.fwMat.uniforms.uBurst.value = now;
      for (let i = 0; i < FW_COUNT; i++) {
        rig.fwPos.setXYZ(i, kosukumaWorldPos.x, kosukumaWorldPos.y, kosukumaWorldPos.z);
        // 球面ランダム方向 × ランダム速度
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(1 - u * u, 0));
        const spd = 1.6 + Math.random() * 3.2;
        rig.fwVel.setXYZ(i, Math.cos(th) * r * spd, u * spd, Math.sin(th) * r * spd);
      }
      rig.fwPos.needsUpdate = true;
      rig.fwVel.needsUpdate = true;
      rig.flash.position.copy(kosukumaWorldPos);
      run.flashAt = now;
      emitGameEvent("fireworks");
    }

    // 花火の閃光(0.35秒でぱっと消える)
    if (run.flashAt >= 0) {
      const fk = (now - run.flashAt) / 0.35;
      if (fk >= 1) {
        rig.flashMat.opacity = 0;
        run.flashAt = -1;
      } else {
        rig.flash.scale.setScalar(0.6 + 5.5 * easeOutCubic(fk));
        rig.flashMat.opacity = 0.9 * (1 - fk);
      }
    }

    // 粒子が全部死んだら休眠(フェーズが先に進んでいても尾は最後まで見せる)
    if (el > T_LAUNCH + 1600) {
      run.active = false;
      rig.root.visible = false;
    }
  });

  return <primitive object={rig.root} />;
}
