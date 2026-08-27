"use client";

// 月の向こうを、ときどき何かが横切る。タップするとチャームとして手に入る。
// 30秒の待ち時間に「見るものが何もない」時間を作らないための仕掛けなので、
// クールダウン中だけ間隔を詰める(SKY_GAP_WAITING_MS)。
//
// 置き場所の決め方がこのファイルの肝。idle のあいだカメラは自由に回るので、
// 飛ばすたびに **そのときのカメラの前方** へ軌道を作りなおす。ワールドに
// 固定した航路にすると、見ていない方向ばかりを飛んで誰にも気づかれない。
// 奥行きは「カメラから月の中心までの距離 + 余白」なので、どこまで寄っても
// 引いても必ず月の裏を通る = 主役のこすくまくんと剣を隠さない。
//
// 大きさは画面の高さに対する割合で決める。遠くに置いたぶん大きくしないと
// 「小さすぎて誰も気づかない」= この機能のいちばんの失敗になる。
//
// 常駐させるのは、4機ぶんのジオメトリと弾けの粒プールをフェーズが変わる
// たびに作り直さないため。出す/出さないの判断は useFrame の中でやる。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  CHARMS,
  MOON_RADIUS,
  SKY_CHARM_INDEX,
  SKY_CROSS_MS,
  SKY_GAP_MS,
  SKY_GAP_WAITING_MS,
  SKY_KINDS,
} from "@/lib/config";
import { useGameStore } from "@/game/store";
import { emitGameEvent } from "@/game/events";
import { clamp01, easeOutCubic } from "./easing";
import { makeBeamTexture, makeCircleTexture, makeStarTexture } from "./textures";

/** 月の向こう側から、さらに奥へ置く余白(three.js units) */
const DEPTH_MARGIN = 15;
/** カメラが寄りきっているときでも遠景に見せる、最低の奥行き */
const DEPTH_MIN = 30;

/** 月の北極から こすくまくんの頭のてっぺんまで(three.js units)。レーンの下限に使う */
const BEAR_HEAD = 2.8;

/** 当たり判定の半径(CSSピクセル)。直径68px = スマホの指でも狙える */
const HIT_R_PX = 34;

/** つかまえたときに弾ける粒の数と、その寿命(秒) */
const BURST = 16;
const BURST_LIFE = 0.72;

/** カットシーンが明けてから、次の1機が飛んでくるまでの最短の間(秒) */
const AFTER_CUT_HOLD = 1.4;

/**
 * 機体ごとの見え方と動き。
 * `unit` は「ローカル1単位が画面の高さの何割になるか」。奥行きが変わっても
 * 見かけの大きさが変わらないように、この割合から毎回スケールを逆算する。
 */
interface SkySpec {
  unit: number;
  /** 軌道の長さ。1 = ちょうど画面幅ぶん。大きいほど同じ時間で速く見える */
  span: number;
  /** 機体の見かけの半径(ローカル単位)。当たり判定の下限になる */
  radius: number;
}

const SPECS: readonly SkySpec[] = [
  // ながれぼし: 頭は小さいが尾が長いので、画面に出る面積はいちばん大きい
  { unit: 0.05, span: 1.6, radius: 0.85 },
  // ロケット: 縦に長い機体。ゆるい弧を描くぶん、軌道は画面幅ちょうど
  { unit: 0.036, span: 1.05, radius: 1.05 },
  // えいせい: 太陽電池パネルで横に広い。いちばん ゆっくり通る
  { unit: 0.033, span: 0.7, radius: 1.5 },
  // UFO: 止まったり進んだりするので、軌道は短めにして画面から出しきらない
  { unit: 0.046, span: 0.86, radius: 1.15 },
];

const ALL_KINDS = SKY_KINDS.map((_, i) => i);

/** SKY_KINDS の index → チャームの色(飛んでいるものと、手に入る形の色をそろえる) */
function colorsOf(kind: number): { hex: string; accent: string } {
  const charm = CHARMS[SKY_CHARM_INDEX[kind]];
  return { hex: charm.hex, accent: charm.accentHex ?? charm.hex };
}

// ── 進みかた ────────────────────────────────────────
// どれも SKY_CROSS_MS で軌道を渡りきる。「速い/おそい」の差は span(軌道の
// 長さ)で、「まっすぐ/ふらふら」の差はこの関数でつける。

/** 軌道上の進み(0..1)。t は 0..1 の時間 */
function progressOf(kind: number, t: number): number {
  switch (kind) {
    case 3: {
      // UFO: 進んでは止まる。速度 = 1 + 0.95cos(...) なので 0.05 まで落ちるが
      // 負にはならない(後ずさりすると「バグ」に見えてしまう)
      const k = 2.6;
      return t + (0.95 * Math.sin(2 * Math.PI * k * t)) / (2 * Math.PI * k);
    }
    case 1:
      // ロケット: 入りと出をほんの少しゆるめて、遠ざかる感じを出す
      return t + 0.06 * Math.sin(2 * Math.PI * t);
    default:
      return t;
  }
}

/** 軌道からの上下のずれ(画面の高さ半分に対する割合) */
function upOffsetOf(kind: number, t: number): number {
  switch (kind) {
    case 1:
      // ロケット: ゆるい弧。レーンの上下へ均等に振れるよう 0.5 を引く
      // (足すだけだと、まん中で HUD の高さまで持ち上がってしまう)
      return 0.11 * (Math.sin(Math.PI * t) - 0.5);
    case 3:
      // UFO: 上下にふらふら。周期をわざと半端にして規則性を消す
      return 0.045 * Math.sin(2 * Math.PI * 2.3 * t + 1.1) + 0.02 * Math.sin(2 * Math.PI * 5.7 * t);
    default:
      return 0;
  }
}

// ── 機体 ────────────────────────────────────────────
// 進行方向 = +X、上 = +Y で組む。呼び出し側は root に位置と姿勢を書くだけ。

interface Craft {
  /** 位置と進行方向を書く入れ物。中の機体は +X が前・+Y が上 */
  root: THREE.Group;
  /** 局所アニメ(自転・噴射のゆらぎ)。age は飛びはじめてからの秒数 */
  tick: (age: number) => void;
}

type Junk = { dispose: () => void }[];

/** 遠景で沈まないよう、自分の色で少し光る不透明マテリアル */
function solid(junk: Junk, hex: string, emissive: number, metal = 0.15): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: new THREE.Color(hex),
    emissiveIntensity: emissive,
    roughness: 0.42,
    metalness: metal,
  });
  junk.push(m);
  return m;
}

/** 加算合成の光(噴射・ランプ・かがやき) */
function glow(junk: Junk, hex: string, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  junk.push(m);
  return m;
}

function sprite(junk: Junk, map: THREE.Texture, hex: string, opacity: number): THREE.Sprite {
  const m = new THREE.SpriteMaterial({
    map,
    color: hex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  junk.push(m);
  const sp = new THREE.Sprite(m);
  sp.raycast = () => undefined;
  return sp;
}

/** ながれぼし: 光る頭 + 長い尾。速くまっすぐ */
function buildComet(junk: Junk, circleTex: THREE.Texture, starTex: THREE.Texture, beamTex: THREE.Texture): Craft {
  const { hex, accent } = colorsOf(0);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 尾: 縦グラデの筒。v=0(明るい端)が -Y なので、+Z 回りに90度ひねると
  // 明るい端がちょうど進行方向(+X)に来る。
  // 1本だけだと「とがった三角形」に見えるので、細い芯と、そのうしろに
  // ひとまわり太くて淡いにじみを重ねて、ほどけていく尾にする
  const makeTail = (wide: number, len: number, hex: string, alpha: number) => {
    const g = new THREE.CylinderGeometry(0.04, wide, len, 12, 1, true);
    g.rotateZ(Math.PI / 2);
    g.translate(-len / 2, 0, 0);
    junk.push(g);
    const m = new THREE.MeshBasicMaterial({
      map: beamTex,
      color: hex,
      transparent: true,
      opacity: alpha,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    junk.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.raycast = () => undefined;
    body.add(mesh);
    return m;
  };
  const hazeMat = makeTail(0.62, 2.5, accent, 0.3);
  const tailMat = makeTail(0.3, 3.6, hex, 0.75);

  // 頭: 芯の玉 + まわりのかがやき。ここが「つかまえる的」になる
  const coreGeo = new THREE.SphereGeometry(0.3, 14, 10);
  junk.push(coreGeo);
  const core = new THREE.Mesh(coreGeo, glow(junk, "#ffffff", 1));
  core.raycast = () => undefined;
  body.add(core);
  const halo = sprite(junk, circleTex, hex, 0.95);
  halo.scale.setScalar(1.9);
  body.add(halo);

  // 尾に散らばる粒。ただの円錐だと「光の三角」で終わってしまう
  const sparks: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const sp = sprite(junk, starTex, "#ffffff", 0.8);
    sp.position.set(-0.5 - i * 0.55, (i % 2 ? 0.11 : -0.09) * (1 + i * 0.3), (i % 3 ? -0.08 : 0.1) * (1 + i * 0.2));
    body.add(sp);
    sparks.push(sp);
  }

  return {
    root,
    tick: (age) => {
      const flick = 0.85 + 0.15 * Math.sin(age * 21);
      halo.scale.setScalar(1.9 * flick);
      tailMat.opacity = 0.62 + 0.18 * Math.sin(age * 13.7);
      hazeMat.opacity = 0.24 + 0.1 * Math.sin(age * 9.1 + 1.3);
      for (let i = 0; i < sparks.length; i++) {
        sparks[i].scale.setScalar((0.34 - i * 0.045) * (0.6 + 0.5 * Math.sin(age * 15 + i * 2.1)));
      }
    },
  };
}

/** ロケット: 小さな機体 + 噴射の光。ゆるく弧を描く */
function buildRocket(junk: Junk, circleTex: THREE.Texture): Craft {
  const { hex, accent } = colorsOf(1);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shell = solid(junk, hex, 0.5, 0.25);
  const trim = solid(junk, accent, 0.55, 0.1);

  // 胴。CylinderGeometry は +Y が軸なので、-Z 回りに90度倒して +X を機首にする
  const hull = new THREE.CylinderGeometry(0.32, 0.34, 1.2, 14);
  hull.rotateZ(-Math.PI / 2);
  hull.translate(-0.18, 0, 0);
  junk.push(hull);
  body.add(new THREE.Mesh(hull, shell));

  // 機首
  const nose = new THREE.ConeGeometry(0.32, 0.66, 14);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(0.75, 0, 0);
  junk.push(nose);
  body.add(new THREE.Mesh(nose, trim));

  // 胴の帯。豆粒でも「ロケット」と読めるのは、この赤い切れ目があるから
  const belt = new THREE.TorusGeometry(0.33, 0.055, 6, 16);
  belt.rotateY(Math.PI / 2);
  belt.translate(0.16, 0, 0);
  junk.push(belt);
  body.add(new THREE.Mesh(belt, trim));

  // フィン3枚
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.BoxGeometry(0.44, 0.42, 0.06);
    fin.translate(-0.58, 0.5, 0);
    fin.rotateX((i / 3) * Math.PI * 2);
    junk.push(fin);
    body.add(new THREE.Mesh(fin, trim));
  }

  // ノズル
  const nozzle = new THREE.CylinderGeometry(0.2, 0.3, 0.24, 12);
  nozzle.rotateZ(-Math.PI / 2);
  nozzle.translate(-0.9, 0, 0);
  junk.push(nozzle);
  body.add(new THREE.Mesh(nozzle, solid(junk, "#8f96a8", 0.25, 0.8)));

  // 噴射。円錐の先を後ろ(-X)へ向ける
  const flameGeo = new THREE.ConeGeometry(0.26, 0.95, 12);
  flameGeo.rotateZ(Math.PI / 2);
  flameGeo.translate(-1.5, 0, 0);
  junk.push(flameGeo);
  const flameMat = glow(junk, "#ffd07a", 0.9);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.raycast = () => undefined;
  body.add(flame);
  const flameGlow = sprite(junk, circleTex, "#ffb765", 0.75);
  flameGlow.position.x = -1.2;
  flameGlow.scale.setScalar(1.1);
  body.add(flameGlow);

  return {
    root,
    tick: (age) => {
      // 噴射は不規則に。等速で明滅させると機械の点滅に見えてしまう
      const f = 0.72 + 0.28 * Math.sin(age * 37) * Math.sin(age * 17.3);
      flame.scale.set(1 + 0.35 * f, 0.9 + 0.25 * f, 0.9 + 0.25 * f);
      flameMat.opacity = 0.55 + 0.45 * f;
      flameGlow.scale.setScalar(1.0 + 0.4 * f);
      body.rotation.x = age * 0.9; // ゆっくりロール
    },
  };
}

/** えいせい: 太陽電池パネル2枚 + 箱。くるくる回りながら ゆっくり */
function buildSatellite(junk: Junk): Craft {
  const { hex, accent } = colorsOf(2);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = solid(junk, hex, 0.62, 0.6);
  const cell = solid(junk, accent, 0.8, 0.2);
  const rib = solid(junk, "#2b3040", 0.05, 0.3);

  // 本体の箱
  const bus = new THREE.BoxGeometry(0.86, 0.82, 0.86);
  junk.push(bus);
  body.add(new THREE.Mesh(bus, skin));

  const panelGeo = new THREE.BoxGeometry(0.86, 0.06, 1.5);
  junk.push(panelGeo);
  const ribGeo = new THREE.BoxGeometry(0.9, 0.08, 0.05);
  junk.push(ribGeo);
  const boomGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.5, 8);
  boomGeo.rotateX(Math.PI / 2);
  junk.push(boomGeo);

  for (const s of [-1, 1]) {
    const boom = new THREE.Mesh(boomGeo, skin);
    boom.position.z = s * 0.66;
    body.add(boom);
    const panel = new THREE.Mesh(panelGeo, cell);
    panel.position.z = s * 1.66;
    body.add(panel);
    // セルの目地。板1枚のままだと、遠目に「黄色い棒」にしか見えない
    for (const d of [-0.42, 0.42]) {
      const bar = new THREE.Mesh(ribGeo, rib);
      bar.position.set(0, 0.035, s * 1.66 + d);
      body.add(bar);
    }
  }

  // パラボラアンテナ(半球を潰したもの)+ 支柱
  const dish = new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dish.scale(1, 0.45, 1);
  dish.rotateZ(-Math.PI / 2);
  dish.translate(0.58, 0.1, 0);
  junk.push(dish);
  body.add(new THREE.Mesh(dish, skin));
  const mast = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6);
  mast.rotateZ(-Math.PI / 2);
  mast.translate(0.42, 0.1, 0);
  junk.push(mast);
  body.add(new THREE.Mesh(mast, skin));

  // 赤い航法灯。まばたきがあると「動いている機械」に見える
  const lampGeo = new THREE.SphereGeometry(0.1, 8, 6);
  junk.push(lampGeo);
  const lampMat = glow(junk, "#ff6b6b", 1);
  const lamp = new THREE.Mesh(lampGeo, lampMat);
  lamp.position.set(-0.5, 0.42, 0);
  lamp.raycast = () => undefined;
  body.add(lamp);

  return {
    root,
    tick: (age) => {
      // 2軸のゆっくりした自転。1軸だけだと「回転する板」で終わる
      body.rotation.set(age * 0.55, age * 0.31, Math.sin(age * 0.4) * 0.5);
      lampMat.opacity = Math.sin(age * 4.4) > 0.6 ? 1 : 0.06;
    },
  };
}

/** UFO: 円盤 + ドーム。ふらふらして、たまに止まる */
function buildUfo(junk: Junk, circleTex: THREE.Texture): Craft {
  const { hex, accent } = colorsOf(3);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shell = solid(junk, hex, 0.6, 0.6);

  // 円盤(球を潰す)
  const disc = new THREE.SphereGeometry(1, 24, 12);
  disc.scale(1, 0.2, 1);
  junk.push(disc);
  body.add(new THREE.Mesh(disc, shell));

  // ふちの輪。シルエットの線がはっきりして「皿」に見える
  const rim = new THREE.TorusGeometry(0.97, 0.085, 6, 28);
  rim.rotateX(Math.PI / 2);
  junk.push(rim);
  body.add(new THREE.Mesh(rim, shell));

  // ドーム
  const domeGeo = new THREE.SphereGeometry(0.48, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.translate(0, 0.12, 0);
  junk.push(domeGeo);
  const domeMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: new THREE.Color(accent),
    emissiveIntensity: 1.1,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.82,
  });
  junk.push(domeMat);
  body.add(new THREE.Mesh(domeGeo, domeMat));

  // ふちのランプ。順ぐりに点いて回っているように見せる
  const lampGeo = new THREE.SphereGeometry(0.11, 8, 6);
  junk.push(lampGeo);
  const lamps: THREE.Mesh[] = [];
  const lampMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const m = glow(junk, accent, 1);
    const a = (i / 5) * Math.PI * 2;
    const lamp = new THREE.Mesh(lampGeo, m);
    lamp.position.set(Math.cos(a) * 0.78, -0.075, Math.sin(a) * 0.78);
    lamp.raycast = () => undefined;
    body.add(lamp);
    lamps.push(lamp);
    lampMats.push(m);
  }

  // 下からのあかり
  const beam = sprite(junk, circleTex, accent, 0.4);
  beam.position.y = -0.34;
  beam.scale.setScalar(1.7);
  body.add(beam);

  return {
    root,
    tick: (age) => {
      // 傾きもふらふらさせる。位置だけ揺らすと「まっすぐ滑る皿」に見える
      body.rotation.set(Math.sin(age * 1.7) * 0.2, age * 0.55, Math.sin(age * 2.3 + 0.7) * 0.22);
      for (let i = 0; i < lampMats.length; i++) {
        const k = (age * 1.9 - i * 0.2) % 1;
        lampMats[i].opacity = 0.12 + 0.88 * Math.pow(Math.max(0, 1 - k * 3), 2);
      }
      beam.material.opacity = 0.28 + 0.16 * Math.sin(age * 5.1);
    },
  };
}

// ── 弾け(つかまえた手ごたえ) ──────────────────────────

interface BurstRig {
  root: THREE.Group;
  stars: THREE.Sprite[];
  starMat: THREE.SpriteMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  vel: THREE.Vector3[];
  seed: Float32Array;
}

interface SkyRig {
  root: THREE.Group;
  crafts: Craft[];
  burst: BurstRig;
  dispose: () => void;
}

function buildRig(): SkyRig {
  const junk: Junk = [];
  const circleTex = makeCircleTexture();
  const starTex = makeStarTexture();
  const beamTex = makeBeamTexture();
  junk.push(circleTex, starTex, beamTex);

  const crafts = [
    buildComet(junk, circleTex, starTex, beamTex),
    buildRocket(junk, circleTex),
    buildSatellite(junk),
    buildUfo(junk, circleTex),
  ];

  const root = new THREE.Group();
  for (const c of crafts) {
    c.root.visible = false;
    root.add(c.root);
  }

  const burstRoot = new THREE.Group();
  burstRoot.visible = false;
  const starMat = new THREE.SpriteMaterial({
    map: starTex,
    color: "#ffffff",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const flashMat = new THREE.SpriteMaterial({
    map: circleTex,
    color: "#ffffff",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  junk.push(starMat, flashMat);
  const stars: THREE.Sprite[] = [];
  const vel: THREE.Vector3[] = [];
  const seed = new Float32Array(BURST);
  for (let i = 0; i < BURST; i++) {
    const sp = new THREE.Sprite(starMat);
    sp.raycast = () => undefined;
    sp.frustumCulled = false;
    burstRoot.add(sp);
    stars.push(sp);
    vel.push(new THREE.Vector3());
    seed[i] = 0.6 + Math.random() * 0.7;
  }
  const flash = new THREE.Sprite(flashMat);
  flash.raycast = () => undefined;
  flash.frustumCulled = false;
  burstRoot.add(flash);
  root.add(burstRoot);

  return {
    root,
    crafts,
    burst: { root: burstRoot, stars, starMat, flash, flashMat, vel, seed },
    dispose: () => junk.forEach((d) => d.dispose()),
  };
}

// ── どれを飛ばすか ──────────────────────────────────

/**
 * まだチャームが開いていない種類を優先しつつ、同じものが続かないように選ぶ。
 * `caught` は store の `caughtSky`(= 開いたチャームのビット)。
 * 「まだ持っていないもの」を多めに見せて、次のごほうびを匂わせる。
 */
function pickKind(caught: number, last: number): number {
  const missing = ALL_KINDS.filter((i) => !(caught & (1 << i)));
  // 全部そろっても空は動きつづける(「世界に何か動いている」が本題なので)
  const pool = missing.length > 0 && Math.random() < 0.78 ? missing : ALL_KINDS;
  const fresh = pool.filter((k) => k !== last);
  const use = fresh.length > 0 ? fresh : pool;
  return use[Math.floor(Math.random() * use.length)];
}

/**
 * 確認用: `?sky=ufo`(または index)でその種類だけを、短い間隔で飛ばす。
 * `?earth=` と同じ流儀で、この画面だけの読み取り専用の仕掛け。
 */
function forcedKind(): number {
  if (typeof window === "undefined") return -1;
  try {
    const q = new URLSearchParams(window.location.search).get("sky");
    if (!q) return -1;
    const byName = SKY_KINDS.indexOf(q as (typeof SKY_KINDS)[number]);
    if (byName >= 0) return byName;
    const n = Math.floor(Number(q));
    return Number.isFinite(n) && n >= 0 && n < SKY_KINDS.length ? n : -1;
  } catch {
    return -1;
  }
}

// スクラッチ
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _toMoon = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export default function SkyTraffic() {
  const rig = useMemo(buildRig, []);
  useEffect(() => () => rig.dispose(), [rig]);
  const forced = useMemo(forcedKind, []);

  const hitRef = useRef<THREE.Mesh>(null);
  const hoverRef = useRef(false);

  // 飛行の状態はすべて ref。1機ごとに再レンダリングを起こさない
  const fly = useRef({
    kind: -1, // -1 = いま飛んでいない
    last: -1,
    startAt: 0,
    dur: SKY_CROSS_MS / 1000,
    nextAt: 3,
    unit: 1,
    halfH: 1,
    origin: new THREE.Vector3(),
    travel: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    burstAt: -99,
    burstUnit: 1,
    /** 最新の clock 秒。ポインタのハンドラは自分では時計を持てないので、
     *  ここを見る(performance.now とは原点がちがう) */
    now: 0,
  });

  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  /** 軌道上の位置を out に書く */
  const posAt = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    const f = fly.current;
    return out
      .copy(f.origin)
      .addScaledVector(f.travel, progressOf(f.kind, clamp01(t)))
      .addScaledVector(f.up, upOffsetOf(f.kind, clamp01(t)) * f.halfH);
  };

  /** 次の1機までの間隔を決める。クールダウン中だけ詰める */
  const scheduleNext = (now: number) => {
    if (forced >= 0) {
      fly.current.nextAt = now + 1.2;
      return;
    }
    const waiting = useGameStore.getState().cooldownUntil > Date.now();
    const [lo, hi] = waiting ? SKY_GAP_WAITING_MS : SKY_GAP_MS;
    fly.current.nextAt = now + (lo + Math.random() * (hi - lo)) / 1000;
  };

  const endFlight = (now: number) => {
    const f = fly.current;
    if (f.kind >= 0) rig.crafts[f.kind].root.visible = false;
    f.last = f.kind;
    f.kind = -1;
    if (hitRef.current) hitRef.current.scale.setScalar(0.0001);
    scheduleNext(now);
  };

  /** つかまえた。持っている種類でも演出は同じに出す(無反応は壊れて見える) */
  const catchNow = (now: number) => {
    const f = fly.current;
    if (f.kind < 0) return;
    const kind = f.kind;
    posAt((now - f.startAt) / f.dur, _pos);

    const b = rig.burst;
    const { hex, accent } = colorsOf(kind);
    b.starMat.color.set(hex);
    b.flashMat.color.set(accent);
    for (let i = 0; i < BURST; i++) {
      b.stars[i].position.copy(_pos);
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const spd = f.unit * (2.6 + Math.random() * 3.4);
      b.vel[i].set(Math.cos(th) * r * spd, u * spd, Math.sin(th) * r * spd);
    }
    b.flash.position.copy(_pos);
    f.burstAt = now;
    f.burstUnit = f.unit;
    b.root.visible = true;

    // 音は「ポッ」だけ鳴らす。はじめての種類なら store 側が続けてチリンと鳴らす
    emitGameEvent("ui-tap");
    endFlight(now);
    useGameStore.getState().catchSky(kind);
  };

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    if (fly.current.kind < 0) return;
    // 月の裏を通っている最中は触らせない(手前の月にレイが先に当たる)
    if (e.intersections.length > 0 && e.intersections[0].eventObject !== e.eventObject) return;
    e.stopPropagation();
    catchNow(fly.current.now);
  };

  useFrame((state, delta) => {
    const s = useGameStore.getState();
    const now = state.clock.elapsedTime;
    const f = fly.current;
    const cam = state.camera as THREE.PerspectiveCamera;
    f.now = now;

    // ── 弾けの粒。フェーズが変わっても最後まで見せる ──
    const bk = (now - f.burstAt) / BURST_LIFE;
    if (bk >= 0 && bk <= 1) {
      const b = rig.burst;
      const damp = Math.exp(-3.4 * Math.min(delta, 0.05));
      for (let i = 0; i < BURST; i++) {
        b.vel[i].multiplyScalar(damp);
        b.stars[i].position.addScaledVector(b.vel[i], Math.min(delta, 0.05));
        b.stars[i].scale.setScalar(f.burstUnit * b.seed[i] * (0.7 + 1.5 * bk));
      }
      b.starMat.opacity = Math.pow(1 - bk, 1.3);
      b.flash.scale.setScalar(f.burstUnit * (2 + 7 * easeOutCubic(bk)));
      b.flashMat.opacity = 0.9 * Math.pow(1 - bk, 2.2);
    } else if (rig.burst.root.visible) {
      rig.burst.root.visible = false;
    }

    // ── 出す/出さないの判断 ──
    if (s.phase !== "idle") {
      if (f.kind >= 0) endFlight(now);
      // カットシーン明けに いきなり飛んでこないよう、少し置く
      f.nextAt = Math.max(f.nextAt, now + AFTER_CUT_HOLD);
      if (hoverRef.current) {
        hoverRef.current = false;
        document.body.style.cursor = "";
      }
      return;
    }

    if (f.kind < 0) {
      // 待ち時間に入ったら、いま数えている間隔もその場で詰める
      if (s.cooldownUntil > Date.now()) {
        f.nextAt = Math.min(f.nextAt, now + SKY_GAP_WAITING_MS[1] / 1000);
      }
      if (now < f.nextAt) return;

      // ── 飛ばす: このときのカメラの前方に軌道を作る ──
      const kind = forced >= 0 ? forced : pickKind(s.caughtSky, f.last);
      const spec = SPECS[kind];
      cam.updateMatrixWorld();
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      _up.set(0, 1, 0).applyQuaternion(cam.quaternion);

      const depth = Math.max(cam.position.length() + DEPTH_MARGIN, DEPTH_MIN);
      const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5));
      const halfH = depth * tanH;
      const halfW = halfH * cam.aspect;

      // 月と こすくまくんのシルエットの上を通す。真ん中を通すと ほとんど
      // 隠れてしまうし、主役の顔の高さを横切ると目線を取り合ってしまう
      _toMoon.copy(cam.position).negate();
      const moonHalfH = Math.max(_toMoon.dot(_fwd), 1) * tanH;
      const moonTop = (_toMoon.dot(_up) + MOON_RADIUS + BEAR_HEAD) / moonHalfH;
      // 下限 = 月にほとんど隠れない高さ / 上限 = HUDのバッジに かぶらない高さ。
      // 寄りすぎて月が画面を埋めているときは、上限で頭打ちにして
      // こすくまくんの頭のうしろをかすめさせる(手前は絶対に通さない)
      const lane = Math.min(
        Math.max(moonTop + 0.1 + (Math.random() - 0.5) * 0.12, 0.4),
        0.72
      );
      const tilt = (Math.random() - 0.5) * 0.1;

      const unit = spec.unit * halfH * 2;
      const way = Math.random() < 0.5 ? -1 : 1;
      const reach = halfW * spec.span + unit * spec.radius * 1.6;

      f.origin
        .copy(cam.position)
        .addScaledVector(_fwd, depth)
        .addScaledVector(_right, -way * reach)
        .addScaledVector(_up, (lane - tilt * 0.5) * halfH);
      f.travel.copy(_right).multiplyScalar(way * reach * 2).addScaledVector(_up, tilt * halfH);
      f.up.copy(_up);
      f.unit = unit;
      f.halfH = halfH;
      f.kind = kind;
      f.startAt = now;
      f.dur = SKY_CROSS_MS / 1000;
      rig.crafts[kind].root.visible = true;
      rig.crafts[kind].root.scale.setScalar(unit);
    }

    // ── 飛行中 ──
    const age = now - f.startAt;
    const t = age / f.dur;
    if (t >= 1) {
      endFlight(now);
      return;
    }
    const craft = rig.crafts[f.kind];
    posAt(t, _pos);
    craft.root.position.copy(_pos);

    // 姿勢: 少し前の位置との差を進行方向にする。ロケットの弧も UFO の
    // ふらつきも、これひとつで自然に機首が向く
    posAt(t - 0.006, _prev);
    _dir.subVectors(_pos, _prev);
    if (_dir.lengthSq() < 1e-10) _dir.copy(f.travel);
    _dir.normalize();
    _zAxis.crossVectors(_dir, f.up);
    if (_zAxis.lengthSq() < 1e-8) _zAxis.set(0, 0, 1);
    _zAxis.normalize();
    _yAxis.crossVectors(_zAxis, _dir);
    _basis.makeBasis(_dir, _yAxis, _zAxis);
    craft.root.quaternion.setFromRotationMatrix(_basis);
    craft.tick(age);

    // ── 当たり判定: 見た目より大きく、画面上で一定のピクセル数を保つ ──
    const hit = hitRef.current;
    if (hit) {
      const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5));
      const perPx = (2 * _pos.distanceTo(cam.position) * tanH) / Math.max(state.size.height, 1);
      hit.position.copy(_pos);
      hit.scale.setScalar(Math.max(f.unit * SPECS[f.kind].radius * 1.15, HIT_R_PX * perPx));
    }

    // 穴のホバー処理と取り合いになるので、乗っているあいだは毎フレーム押さえる
    if (hoverRef.current && document.body.style.cursor !== "pointer") {
      document.body.style.cursor = "pointer";
    }
  });

  return (
    <group>
      <primitive object={rig.root} />
      {/* 見えない当たり判定。指で狙える大きさを保つため、毎フレーム大きさを直す */}
      <mesh
        ref={hitRef}
        scale={0.0001}
        onPointerDown={handleDown}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          if (fly.current.kind < 0) return;
          if (e.intersections.length > 0 && e.intersections[0].eventObject !== e.eventObject) return;
          hoverRef.current = true;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hoverRef.current = false;
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[1, 14, 10]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
