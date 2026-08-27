"use client";

// 地球を1000回つついた人へのごほうび = 大爆発と、そのあとの再生。
// Earth.tsx の中(地球のローカル座標)にマウントされる。時間の正は
// store の earthBoomAt(epoch ms)で、Earth.tsx とまったく同じ t を使う。
//
// 段取り(t秒):
//   0.00  地球を中心にした丸い閃光(0.15秒) / 本体がふくらんで白熱 → 砕ける
//   0.00  地殻の破片150枚が射出(t=0では地球の形に並んでいる)/ 火花 / 煙
//   0.00〜 衝撃波リング3枚が時間差で広がる、カメラシェイク
//   2.20  中心に「光の芽」がともる
//   2.55〜 破片が波のように吸い戻される
//   3.55〜 地球本体が backOut でふくらんで復活、破片は着地して星になって消える
//   5.00  完全に元通り(store は 5.2s で earthBoomAt を消す)

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGameStore } from "@/game/store";
import { requestShake } from "@/game/scene/sharedRefs";
import { clamp01, easeOutCubic } from "./easing";
import { makeCircleTexture, makeStarTexture } from "./textures";
import {
  BOOM,
  createSparkPool,
  EARTH_RADIUS,
  makeEarthRingTexture,
  prefersReducedMotion,
  type SparkPool,
} from "./earthFx";

/** 破片の枚数。多すぎると重いので150枚まで */
const DEBRIS = 150;
/** 破片1枚の角半径(rad)。0.24 で球を2.7重に覆えるので殻が透けない */
const PIECE_HALF = 0.24;
/**
 * 破片の速度の指数減衰。飛距離 = 速度/K。
 * 初速を大きく・減衰も強くして、最初の0.2秒で一気にバラける
 * (ゆっくり出すと「中心に固まった塊」に見えてしまう)。
 */
const FLIGHT_K = 0.8;

const EMBER_COUNT = 240;
const SMOKE_COUNT = 80;

/** 行きも帰りもなめらかに(飛んで、止まって、引き返す) */
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// 火花の色(やわらかい玩具の宇宙なので、血なまぐさくない暖色+ピンク)
const EMBER_COLORS: readonly [number, number, number][] = [
  [1.0, 0.96, 0.82], // クリーム
  [1.0, 0.85, 0.24], // 星の黄
  [1.0, 0.62, 0.3], // オレンジ
  [1.0, 0.7, 0.78], // ピンク
];
// 煙はパステル。黒煙にすると世界観から浮く
const SMOKE_COLORS: readonly [number, number, number][] = [
  [1.0, 0.92, 0.79],
  [0.8, 0.72, 0.91],
  [1.0, 0.78, 0.85],
  [0.72, 0.79, 0.95],
];

// 衝撃波リング(遅れて出るほど大きく、色は白→金→桃)
interface RingSpec {
  at: number;
  dur: number;
  to: number;
  color: string;
  opacity: number;
}
// (リングの半径 = スケール×0.45。テクスチャの輪が0.9の位置にあるため)
const RINGS: readonly RingSpec[] = [
  { at: 0.0, dur: 0.95, to: 30, color: "#fffaf0", opacity: 1.0 },
  { at: 0.14, dur: 1.1, to: 42, color: "#ffd93d", opacity: 0.8 },
  { at: 0.32, dur: 1.35, to: 54, color: "#ffb3c7", opacity: 0.6 },
  // 復活のときに一枚だけ、やさしい水色の波紋
  { at: BOOM.coreAt + 0.5, dur: 0.9, to: 14, color: "#bfe9ff", opacity: 0.75 },
];

// 閃光: クリップ空間に板を1枚置き、地球の画面位置を中心にした
// 丸いグラデで光らせる。画面全体を一律に持ち上げると星が消えて
// 「霧」に見えてしまうので、隅(=爆発と無関係な場所)には一切かけない。
const FLASH_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uRadius;
varying vec2 vNdc;
void main() {
  vec2 d = vNdc - uCenter;
  d.x *= uAspect;
  float f = 1.0 - smoothstep(0.0, uRadius, length(d));
  float a = uAlpha * f * f;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

// スクラッチ
const _v = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _view = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _obj = new THREE.Object3D();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

interface BoomRig {
  root: THREE.Group;
  debris: THREE.InstancedMesh;
  debrisMat: THREE.MeshStandardMaterial;
  embers: SparkPool;
  smoke: SparkPool;
  rings: THREE.Sprite[];
  ringMats: THREE.SpriteMaterial[];
  core: THREE.Sprite;
  coreMat: THREE.SpriteMaterial;
  seed: THREE.Sprite;
  seedMat: THREE.SpriteMaterial;
  flash: THREE.Mesh;
  flashMat: THREE.ShaderMaterial;
  /** 破片ごとの固定データ */
  dir: Float32Array;
  homeR: Float32Array;
  homeQ: Float32Array;
  vel: Float32Array;
  spinAxis: Float32Array;
  spinRate: Float32Array;
  delay: Float32Array;
  landed: Uint8Array;
  dispose: () => void;
}

function buildBoom(texture: THREE.Texture): BoomRig {
  const disposables: { dispose: () => void }[] = [];
  const root = new THREE.Group();
  root.visible = false;

  // ── 破片: 球から切り出した「地殻のかけら」 ──────────────
  // 1枚のジオメトリを使い回し、UVを instance ごとにずらすことで
  // 「その破片が本来あった場所の地球の絵」が各破片に乗る。
  const geom = new THREE.SphereGeometry(
    EARTH_RADIUS,
    6,
    5,
    -PIECE_HALF,
    PIECE_HALF * 2,
    Math.PI / 2 - PIECE_HALF,
    PIECE_HALF * 2
  );
  geom.translate(EARTH_RADIUS, 0, 0); // かけらの中心を原点へ
  // 部分球のUVは[0,1]に正規化されてしまうので、地球全体のequirectに戻す
  const uvAttr = geom.getAttribute("uv") as THREE.BufferAttribute;
  const uBase = -PIECE_HALF / (Math.PI * 2);
  const uSpan = (PIECE_HALF * 2) / (Math.PI * 2);
  const thetaStart = Math.PI / 2 - PIECE_HALF;
  const vBase = 1 - (thetaStart + PIECE_HALF * 2) / Math.PI;
  const vSpan = (PIECE_HALF * 2) / Math.PI;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, uBase + uvAttr.getX(i) * uSpan, vBase + uvAttr.getY(i) * vSpan);
  }
  disposables.push(geom);

  const dir = new Float32Array(DEBRIS * 3);
  const homeR = new Float32Array(DEBRIS);
  const homeQ = new Float32Array(DEBRIS * 4);
  const vel = new Float32Array(DEBRIS * 3);
  const spinAxis = new Float32Array(DEBRIS * 3);
  const spinRate = new Float32Array(DEBRIS);
  const delay = new Float32Array(DEBRIS);
  const landed = new Uint8Array(DEBRIS);
  const uvOff = new Float32Array(DEBRIS * 2);

  // フィボナッチ球で均等に配る = 戻ったときに穴のない殻になる
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DEBRIS; i++) {
    const y = 1 - (2 * i + 1) / DEBRIS;
    const theta = Math.acos(Math.max(-1, Math.min(1, y)));
    const phi = i * GOLDEN;
    const st = Math.sin(theta);
    dir[i * 3] = -Math.cos(phi) * st;
    dir[i * 3 + 1] = Math.cos(theta);
    dir[i * 3 + 2] = Math.sin(phi) * st;
    // 少しずつ高さを変えて、重なった破片のZファイトを避ける
    homeR[i] = EARTH_RADIUS * (1 + Math.random() * 0.045);
    // かけらの基準姿勢は(θ=π/2, φ=0)。そこから目的地へ運ぶ回転
    _q.setFromAxisAngle(AXIS_Y, phi);
    _qs.setFromAxisAngle(AXIS_Z, theta - Math.PI / 2);
    _q.multiply(_qs);
    homeQ[i * 4] = _q.x;
    homeQ[i * 4 + 1] = _q.y;
    homeQ[i * 4 + 2] = _q.z;
    homeQ[i * 4 + 3] = _q.w;
    // 回転に合わせてUVもずらす(=その場所の地球の絵になる)
    uvOff[i * 2] = phi / (Math.PI * 2);
    uvOff[i * 2 + 1] = 0.5 - theta / Math.PI;
    // 外向きに飛び散る + すこし横ぶれ(飛距離は 6.9〜17.5 units = 地球半径の3.5〜9倍)
    const spd = 5.5 + Math.random() * 8.5;
    const ju = Math.random() * 2 - 1;
    const jt = Math.random() * Math.PI * 2;
    const jr = Math.sqrt(Math.max(0, 1 - ju * ju)) * spd * 0.28;
    vel[i * 3] = dir[i * 3] * spd + Math.cos(jt) * jr;
    vel[i * 3 + 1] = dir[i * 3 + 1] * spd + ju * spd * 0.28;
    vel[i * 3 + 2] = dir[i * 3 + 2] * spd + Math.sin(jt) * jr;
    // でたらめな軸でくるくる回る
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    spinAxis[i * 3] = _v.x;
    spinAxis[i * 3 + 1] = _v.y;
    spinAxis[i * 3 + 2] = _v.z;
    spinRate[i] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 8);
    delay[i] = Math.random() * BOOM.returnSpread;
  }
  geom.setAttribute("aUvOffset", new THREE.InstancedBufferAttribute(uvOff, 2));

  // 平面シェーディングだと「紺色の三角形」に見えてしまうので、なめらかに。
  // 自発光を本体より強めにして、暗い宇宙でも「地球のかけら」と分かるようにする
  const debrisMat = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: new THREE.Color("#ffffff"),
    emissiveMap: texture,
    emissiveIntensity: 1.25,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide, // 薄い殻なので裏からも見える
  });
  // instance ごとのUVずらしを差し込む(map と emissiveMap の両方に効かせる)
  debrisMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aUvOffset;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv += aUvOffset;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv += aUvOffset;
        #endif`
      );
  };
  disposables.push(debrisMat);
  const debris = new THREE.InstancedMesh(geom, debrisMat, DEBRIS);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.frustumCulled = false;
  debris.raycast = () => undefined;
  root.add(debris);

  // ── 火花と煙 ──────────────────────────────────────
  const starTex = makeStarTexture();
  const circleTex = makeCircleTexture();
  const ringTex = makeEarthRingTexture();
  disposables.push(starTex, circleTex, ringTex);

  const embers = createSparkPool({
    count: EMBER_COUNT,
    map: starTex,
    drag: 1.7,
    grow: 0.3,
    fade: 1.4,
  });
  const smoke = createSparkPool({
    count: SMOKE_COUNT,
    map: circleTex,
    drag: 1.1,
    grow: 2.2,
    fade: 2.0,
    alpha: 0.5, // 重ねるので薄く。濃いと破片が隠れてしまう
    additive: false,
  });
  root.add(embers.points, smoke.points);
  disposables.push(embers, smoke);

  // ── 衝撃波リング ──────────────────────────────────
  const rings: THREE.Sprite[] = [];
  const ringMats: THREE.SpriteMaterial[] = [];
  for (const spec of RINGS) {
    const m = new THREE.SpriteMaterial({
      map: ringTex,
      color: spec.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    disposables.push(m);
    const sp = new THREE.Sprite(m);
    sp.frustumCulled = false;
    sp.raycast = () => undefined;
    ringMats.push(m);
    rings.push(sp);
    root.add(sp);
  }

  // ── 爆心の閃光 と 再生の光の芽 ────────────────────────
  const coreMat = new THREE.SpriteMaterial({
    map: circleTex,
    color: "#fff6df",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  disposables.push(coreMat);
  const core = new THREE.Sprite(coreMat);
  core.frustumCulled = false;
  core.raycast = () => undefined;
  root.add(core);

  const seedMat = new THREE.SpriteMaterial({
    map: circleTex,
    color: "#bfe9ff",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  disposables.push(seedMat);
  const seed = new THREE.Sprite(seedMat);
  seed.frustumCulled = false;
  seed.raycast = () => undefined;
  root.add(seed);

  // ── 閃光(画面いっぱいの板に、地球を中心にした丸グラデを描く) ──
  const flashGeom = new THREE.PlaneGeometry(2, 2);
  disposables.push(flashGeom);
  const flashMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#fffaf0") },
      uAlpha: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uAspect: { value: 1 },
      uRadius: { value: 1.0 },
    },
    vertexShader: FLASH_VERT,
    fragmentShader: FLASH_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(flashMat);
  const flash = new THREE.Mesh(flashGeom, flashMat);
  flash.frustumCulled = false;
  flash.renderOrder = 10000; // いちばん手前に焼き付ける
  flash.visible = false;
  flash.raycast = () => undefined;
  root.add(flash);

  return {
    root,
    debris,
    debrisMat,
    embers,
    smoke,
    rings,
    ringMats,
    core,
    coreMat,
    seed,
    seedMat,
    flash,
    flashMat,
    dir,
    homeR,
    homeQ,
    vel,
    spinAxis,
    spinRate,
    delay,
    landed,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

interface Props {
  /** 地球のテクスチャ(破片にもそのまま貼る) */
  texture: THREE.Texture;
}

export default function EarthBoom({ texture }: Props) {
  const rig = useMemo(() => buildBoom(texture), [texture]);
  useEffect(() => () => rig.dispose(), [rig]);

  const run = useRef({
    active: false,
    /** 再生の合図(揺れ)を1回だけ出すためのフラグ */
    regenShook: false,
  });

  useFrame((state) => {
    const s = useGameStore.getState();
    const boomAt = s.earthBoomAt;
    const now = state.clock.elapsedTime;
    const pixelScale = state.size.height * state.gl.getPixelRatio() * 0.5;
    // 粒子の時計は爆発していなくても進めておく(スポーン時刻の基準になるので、
    // ここを止めると次の爆発で「生まれた瞬間に寿命切れ」になってしまう)
    rig.embers.update(now, pixelScale);
    rig.smoke.update(now, pixelScale);

    if (boomAt === null) {
      if (run.current.active) {
        run.current.active = false;
        rig.root.visible = false;
      }
      return;
    }

    const t = (Date.now() - boomAt) / 1000;

    // ── 一発目: 破片・火花・煙をまとめて射出 ──
    if (!run.current.active) {
      run.current.active = true;
      run.current.regenShook = false;
      rig.root.visible = true;
      rig.landed.fill(0);
      const soft = prefersReducedMotion();
      requestShake(1.15, soft ? 0.14 : 0.46);

      for (let i = 0; i < EMBER_COUNT; i++) {
        // 中心の小さな球からランダム方向へ
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const dx = Math.cos(th) * r;
        const dz = Math.sin(th) * r;
        const spd = 5 + Math.random() * 11;
        const c = EMBER_COLORS[i % EMBER_COLORS.length];
        rig.embers.spawn(
          dx * 0.8,
          u * 0.8,
          dz * 0.8,
          dx * spd,
          u * spd,
          dz * spd,
          0.42 + Math.random() * 0.55,
          0.7 + Math.random() * 0.9,
          c[0],
          c[1],
          c[2]
        );
      }
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const dx = Math.cos(th) * r;
        const dz = Math.sin(th) * r;
        const spd = 1.6 + Math.random() * 2.6;
        const c = SMOKE_COLORS[i % SMOKE_COLORS.length];
        rig.smoke.spawn(
          dx * 1.4,
          u * 1.4,
          dz * 1.4,
          dx * spd,
          u * spd,
          dz * spd,
          1.1 + Math.random() * 1.4,
          2.2 + Math.random() * 1.2,
          c[0],
          c[1],
          c[2]
        );
      }
      // 書き込んだ属性をこのフレームのうちに送る(1フレーム遅れると
      // 爆発の頭が欠けて見える)
      rig.embers.update(now, pixelScale);
      rig.smoke.update(now, pixelScale);
    }

    // ── 閃光(地球の画面位置を中心にした丸い光。0.15秒で終わる) ──
    const peak = prefersReducedMotion() ? 0.22 : 0.62;
    let fa = 0;
    if (t < BOOM.flashRise) fa = peak * (t / BOOM.flashRise);
    else if (t < BOOM.flashRise + BOOM.flashFall) {
      fa = peak * Math.pow(1 - (t - BOOM.flashRise) / BOOM.flashFall, 1.6);
    }
    if (fa > 0.003) {
      // 地球のスクリーン座標(NDC)を毎フレーム求める。カメラの後ろに
      // 回ったときは光らせない(無関係な場所が明るくなるのを防ぐ)
      rig.root.getWorldPosition(_wp);
      _view.copy(_wp).applyMatrix4(state.camera.matrixWorldInverse);
      if (_view.z > -0.1) {
        fa = 0;
      } else {
        _wp.project(state.camera);
        const u = rig.flashMat.uniforms;
        (u.uCenter.value as THREE.Vector2).set(_wp.x, _wp.y);
        u.uAspect.value = state.size.width / Math.max(1, state.size.height);
        u.uAlpha.value = fa;
      }
    }
    rig.flash.visible = fa > 0.003;

    // ── 爆心の閃光(全画面ではなく、地球のまわりだけを照らす主役の光) ──
    const ck = clamp01(t / 0.62);
    rig.core.scale.setScalar(2 + 36 * easeOutCubic(ck));
    rig.coreMat.opacity = ck < 1 ? Math.pow(1 - ck, 1.4) : 0;

    // ── 衝撃波リング ──
    for (let i = 0; i < rig.rings.length; i++) {
      const spec = RINGS[i];
      const k = (t - spec.at) / spec.dur;
      if (k < 0 || k > 1) {
        rig.ringMats[i].opacity = 0;
        continue;
      }
      rig.rings[i].scale.setScalar(1.5 + spec.to * easeOutCubic(k));
      rig.ringMats[i].opacity = spec.opacity * Math.pow(1 - k, 1.7);
    }

    // ── 再生の「光の芽」: 中心にともって、本体が戻るころに消える ──
    const sk = (t - BOOM.seedAt) / (BOOM.coreAt + BOOM.coreDur - BOOM.seedAt);
    if (sk > 0 && sk < 1.25) {
      const puls = 1 + 0.18 * Math.sin(t * 11);
      rig.seed.scale.setScalar((0.5 + 3.4 * easeOutCubic(clamp01(sk))) * puls);
      rig.seedMat.opacity = 0.95 * Math.sin(Math.PI * clamp01(sk * 0.85));
    } else {
      rig.seedMat.opacity = 0;
    }

    // ── 破片: 飛び散る → 波のように吸い戻される → 着地して星になる ──
    const damp = (1 - Math.exp(-FLIGHT_K * t)) / FLIGHT_K;
    let anyDebris = false;
    for (let i = 0; i < DEBRIS; i++) {
      const w = clamp01((t - (BOOM.returnAt + rig.delay[i])) / BOOM.returnDur);
      const ew = w <= 0 ? 0 : easeInOut(w);
      const dx = rig.dir[i * 3];
      const dy = rig.dir[i * 3 + 1];
      const dz = rig.dir[i * 3 + 2];
      // 殻は原寸に戻る(本体はその内側でふくらんで復活する)
      const hr = rig.homeR[i];
      // 飛んでいる位置(指数減速)と、家の位置を混ぜる
      const fx = dx * hr + rig.vel[i * 3] * damp;
      const fy = dy * hr + rig.vel[i * 3 + 1] * damp;
      const fz = dz * hr + rig.vel[i * 3 + 2] * damp;
      _obj.position.set(
        fx + (dx * hr - fx) * ew,
        fy + (dy * hr - fy) * ew,
        fz + (dz * hr - fz) * ew
      );
      // 姿勢: 転がりながら → 元の向きへ戻る
      _q.set(rig.homeQ[i * 4], rig.homeQ[i * 4 + 1], rig.homeQ[i * 4 + 2], rig.homeQ[i * 4 + 3]);
      _v.set(rig.spinAxis[i * 3], rig.spinAxis[i * 3 + 1], rig.spinAxis[i * 3 + 2]);
      _qs.setFromAxisAngle(_v, rig.spinRate[i] * damp);
      _qs.multiply(_q);
      _obj.quaternion.copy(_qs).slerp(_q, ew);
      // 着地したらすっと吸い込まれて消える(そのとき星をひとつこぼす)
      const sc = 1 - clamp01((w - 0.86) / 0.14);
      _obj.scale.setScalar(sc);
      _obj.updateMatrix();
      rig.debris.setMatrixAt(i, _obj.matrix);
      if (sc > 0.001) anyDebris = true;
      if (w > 0.9 && rig.landed[i] === 0) {
        rig.landed[i] = 1;
        rig.embers.spawn(
          dx * hr,
          dy * hr,
          dz * hr,
          dx * 0.9,
          dy * 0.9,
          dz * 0.9,
          0.5,
          0.55,
          1,
          0.98,
          0.85
        );
      }
    }
    rig.debris.instanceMatrix.needsUpdate = true;
    rig.debris.visible = anyDebris;
    // 飛び出した直後は白熱、やがて冷める
    rig.debrisMat.emissiveIntensity = 1.25 + 3.2 * Math.pow(1 - clamp01(t / 0.9), 2);

    // 殻が閉じるころに、もう一度だけ小さく揺らす(戻ってきた合図)
    if (!run.current.regenShook && t > BOOM.coreAt + BOOM.coreDur * 0.5) {
      run.current.regenShook = true;
      requestShake(0.35, prefersReducedMotion() ? 0.03 : 0.1);
    }
  });

  return <primitive object={rig.root} />;
}
