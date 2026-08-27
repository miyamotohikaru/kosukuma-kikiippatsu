// 地球イースターエッグ専用のヘルパー。
// アセット追加は禁止なので、ヒビ・波紋・カウンタは全部 canvas で手描きし、
// 粒子は使い回しのプール(GPUで動かす Points)にまとめてある。
// 爆発の時間割(BOOM)は Earth.tsx と EarthBoom.tsx の両方が読む「正」。

import * as THREE from "three";
import { EARTH_BOOM_CLICKS } from "@/lib/config";
import { mulberry32 } from "@/lib/prng";
import { backOut, clamp01, easeOutCubic } from "./easing";

/** 地球の半径 (three.js units) */
export const EARTH_RADIUS = 2;

/**
 * 見えない当たり判定球の半径。遠景の地球は画面上で直径80pxほどしかないので、
 * 少し大きめの球をかぶせないとイースターエッグにたどり着けない。
 * (月のピッキング球は原点・半径5、地球は原点から34離れているので干渉しない)
 */
export const EARTH_HIT_RADIUS = 3.4;

/** タップと認めるドラッグ量(CSSピクセル)と押し時間(ms) */
export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 420;

// ── 爆発の時間割(秒)。T_EARTH_BOOM = 5200ms に収める ──────────
export const BOOM = {
  /** 本体がふくらんで白熱してから砕けるまで */
  swell: 0.07,
  /**
   * 閃光の立ち上がり/立ち下がり。合計0.15秒で終わらせる:
   * これ以上長いと止め絵に写り込んで「霧」や描画バグに見えてしまう。
   */
  flashRise: 0.03,
  flashFall: 0.12,
  /** 中心に「光の芽」が生まれる */
  seedAt: 2.4,
  /** 破片が戻りはじめる(個体ごとに spread だけばらつく)。
      散りきる前に戻すと「中心の塊」に見えるので、たっぷり散らしてから */
  returnAt: 2.85,
  returnSpread: 0.4,
  returnDur: 1.25,
  /** 地球本体がふくらんで戻ってくる */
  coreAt: 3.7,
  coreDur: 0.9,
  /** ここで完全に元通り(store が earthBoomAt を消すのは 5.2s) */
  settle: 5.0,
} as const;

/**
 * 「動きを減らす」設定。全画面フラッシュとカメラシェイクだけ弱める
 * (ui.css が DOM 側で同じ配慮をしているので、3D側でも合わせる)
 */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * 爆発中の地球本体のスケール。0 なら描かない。
 * 0〜swell: ふくらむ → 砕けて消える → coreAt から backOut で戻ってくる。
 */
export function earthBoomScale(t: number): number {
  if (t < BOOM.swell) return 1 + 0.2 * easeOutCubic(t / BOOM.swell);
  if (t < BOOM.coreAt) return 0;
  const k = clamp01((t - BOOM.coreAt) / BOOM.coreDur);
  return 0.18 + 0.82 * backOut(k);
}

// ── canvas ヘルパー ─────────────────────────────────
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

/** next/font はハッシュ化された family 名になるので body の計算値から拾う */
function gameFontFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  try {
    return getComputedStyle(document.body).fontFamily || "sans-serif";
  } catch {
    return "sans-serif";
  }
}

// ── 波紋・衝撃波リング ───────────────────────────────
/** 中が空いた光の輪。スプライトに貼って広げると衝撃波になる */
export function makeEarthRingTexture(size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  // 外周ぎりぎりに細い輪。内側は完全に空にして「輪」として読ませる
  g.addColorStop(0.0, "rgba(255,255,255,0)");
  g.addColorStop(0.6, "rgba(255,255,255,0)");
  g.addColorStop(0.78, "rgba(255,255,255,0.28)");
  g.addColorStop(0.9, "rgba(255,255,255,1)");
  g.addColorStop(0.96, "rgba(255,255,255,0.22)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── ヒビ ────────────────────────────────────────────
/**
 * ヒビが育ちはじめる種の位置(equirect UV)。シェーダーはここから
 * 半径を広げて「割れが伝わっていく」ように見せる。
 */
export const CRACK_SEEDS: readonly (readonly [number, number])[] = [
  [0.3, 0.44],
  [0.7, 0.6],
  [0.13, 0.68],
];

/** 1本のヒビ(枝分かれあり)を折れ線で描く */
function strokeCrack(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
  depth: number
): void {
  const steps = Math.max(3, Math.round(len / 16));
  const seg = len / steps;
  const pts: [number, number][] = [[x, y]];
  const branches: [number, number, number][] = [];
  let cx = x;
  let cy = y;
  let a = angle;
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 0.9; // ぎざぎざに曲がる
    cx += Math.cos(a) * seg;
    cy += Math.sin(a) * seg;
    pts.push([cx, cy]);
    if (depth > 0 && rng() < 0.3) {
      branches.push([cx, cy, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7)]);
    }
  }
  // 太い下地(ぼんやり) → 細い芯(くっきり)の2度塗りで光る線に見せる
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = pass === 0 ? width * 2.4 : width;
    ctx.strokeStyle = pass === 0 ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,1)";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  for (const [bx, by, ba] of branches) {
    strokeCrack(ctx, rng, bx, by, ba, len * 0.45, width * 0.62, depth - 1);
  }
}

/**
 * 地球にかぶせるヒビのマスク(equirect)。アルファだけ使い、色はシェーダー側で決める。
 * 見た目を毎回同じにしたいので固定シードの PRNG で描く。
 */
export function makeEarthCrackTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const rng = mulberry32(0x9e3779b9);
  for (const [su, sv] of CRACK_SEEDS) {
    const sx = su * W;
    const sy = sv * H;
    const n = 5 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.8;
      // 遠景(画面上110pxほど)でも「割れている」と読めるよう、線は太く。
      // 1024pxのテクスチャで太さ14 ≒ 画面上3px、下地のにじみで7px。
      // 細い線にすると止め絵ではJPEGノイズと区別がつかない
      strokeCrack(ctx, rng, sx, sy, a, 190 + rng() * 230, 14, 3);
    }
    // 種の位置は「割れの中心」なので、明るい口を開けておく
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 62);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, 62, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  // 色ではなくマスクなので sRGB 変換はかけない
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const CRACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 種からの距離でヒビを「育てる」。equirect の横つぶれを sin(θ) で補正して
// 球の上でまるく広がって見えるようにする。
const CRACK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlow;
uniform vec3 uSeed0;
uniform vec3 uSeed1;
uniform vec3 uSeed2;
varying vec2 vUv;

float reveal(vec2 uv, vec3 seed) {
  float dx = abs(uv.x - seed.x);
  dx = min(dx, 1.0 - dx) * 2.0 * sin(3.14159265 * uv.y);
  float dy = uv.y - seed.y;
  float d = sqrt(dx * dx + dy * dy);
  // 割れの先端(育ちきる直前)をいちばん明るくする
  float on = 1.0 - smoothstep(seed.z - 0.07, seed.z, d);
  float tip = smoothstep(seed.z - 0.05, seed.z - 0.005, d) * on;
  return on + tip * 1.4;
}

void main() {
  float r = max(reveal(vUv, uSeed0), max(reveal(vUv, uSeed1), reveal(vUv, uSeed2)));
  float crack = texture2D(uMap, vUv).a * min(r, 1.0) * uOpacity;
  // uGlow は割れの有無によらず球全体をじわっと赤熱させる。
  // 線だけだと遠景でトーンが変わらず「汚れたテクスチャ」に見えるため
  float alpha = crack + uGlow;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor * min(0.55 + 0.45 * r, 2.2), alpha);
}
`;

export interface EarthCracks {
  mesh: THREE.Mesh;
  /** 育ち具合 0..1・色・線の濃さ・全体の赤熱 を毎フレーム書き込む */
  setLook: (
    grow: number,
    color: THREE.Color,
    opacity: number,
    glow: number
  ) => void;
  dispose: () => void;
}

/** 地球にぴったり重ねる「ヒビ」の殻 */
export function createEarthCracks(): EarthCracks {
  const tex = makeEarthCrackTexture();
  const geom = new THREE.SphereGeometry(EARTH_RADIUS * 1.004, 48, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uColor: { value: new THREE.Color("#ff7a3d") },
      uOpacity: { value: 0 },
      uGlow: { value: 0 },
      uSeed0: { value: new THREE.Vector3(CRACK_SEEDS[0][0], CRACK_SEEDS[0][1], 0) },
      uSeed1: { value: new THREE.Vector3(CRACK_SEEDS[1][0], CRACK_SEEDS[1][1], 0) },
      uSeed2: { value: new THREE.Vector3(CRACK_SEEDS[2][0], CRACK_SEEDS[2][1], 0) },
    },
    vertexShader: CRACK_VERT,
    fragmentShader: CRACK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.visible = false;
  mesh.raycast = () => undefined;

  const u = mat.uniforms;
  // 種ごとに広がる速さを変えて、割れが順番に伝わるように見せる
  const rate = [0.92, 0.78, 0.66];
  return {
    mesh,
    setLook: (grow, color, opacity, glow) => {
      mesh.visible = opacity > 0.002 || glow > 0.002;
      if (!mesh.visible) return;
      u.uGlow.value = glow;
      (u.uSeed0.value as THREE.Vector3).z = grow * rate[0];
      (u.uSeed1.value as THREE.Vector3).z = Math.max(0, grow - 0.12) * rate[1];
      (u.uSeed2.value as THREE.Vector3).z = Math.max(0, grow - 0.24) * rate[2];
      (u.uColor.value as THREE.Color).copy(color);
      u.uOpacity.value = opacity;
    },
    dispose: () => {
      geom.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

// ── カウンタ ────────────────────────────────────────
export interface EarthCounter {
  sprite: THREE.Sprite;
  /** 数字が変わったときだけ呼ぶ(canvas の再描画が走る) */
  draw: (clicks: number, booms: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

/**
 * 地球のそばに出す小さなカウンタ。イースターエッグなので普段は出さず、
 * 何回かつついた人にだけ、つついた直後だけ見せる(表示制御は Earth.tsx)。
 */
export function createEarthCounter(): EarthCounter {
  const W = 512;
  const H = 176;
  const [canvas, ctx] = makeCanvas(W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false, // 遠景のフォグで文字がにじむと読めない
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  // 遠景なので、これくらい大きくしないと数字が読めない(画面上で約165x57px)
  sprite.scale.set(8.4, 2.89, 1);
  sprite.position.set(0, -3.6, 0); // 地球の真下
  sprite.visible = false;
  sprite.raycast = () => undefined;

  const draw = (clicks: number, booms: number) => {
    const fam = gameFontFamily();
    const p = clamp01(clicks / EARTH_BOOM_CLICKS);
    // 残りわずかは赤くして「これ、やばいな」を伝える
    const hot = p > 0.9;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = hot ? "rgba(42,8,18,0.84)" : "rgba(8,11,32,0.78)";
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 40);
    ctx.fill();
    ctx.strokeStyle = hot ? "#ff6b6b" : "#ffd93d";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `700 36px ${fam}`;
    ctx.fillStyle = hot ? "#ffd2d2" : "#cfd6ff";
    ctx.fillText(booms > 0 ? `ちきゅう ${booms + 1}こめ` : "ちきゅう", 40, 48);
    ctx.textAlign = "right";
    ctx.font = `800 66px ${fam}`;
    ctx.fillStyle = hot ? "#fff0f0" : "#fffef2";
    ctx.fillText(`${clicks} / ${EARTH_BOOM_CLICKS}`, W - 40, 104);

    // 進捗バー(あと何回かが目で分かる)
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.roundRect(40, 142, W - 80, 16, 8);
    ctx.fill();
    const w = Math.max(16, (W - 80) * p);
    const g = ctx.createLinearGradient(40, 0, W - 40, 0);
    g.addColorStop(0, "#7ce38b");
    g.addColorStop(0.6, "#ffd93d");
    g.addColorStop(1, "#ff5d5d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(40, 142, w, 16, 8);
    ctx.fill();
    tex.needsUpdate = true;
  };

  return {
    sprite,
    draw,
    setOpacity: (o) => {
      sprite.visible = o > 0.004;
      mat.opacity = o;
    },
    dispose: () => {
      mat.dispose();
      tex.dispose();
    },
  };
}

// ── 粒子プール(きらきら・火花・煙 共通) ────────────────
// スポーン時だけ属性を書き、以降は uTime から GPU 側で位置を出す。
// 連打しても JS 側の負荷が増えないようにするための作り。
const SPARK_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uDrag;
uniform vec3 uAccel;
uniform float uGrow;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aSeed;
attribute vec3 aVel;
attribute vec3 aColor;
varying vec3 vColor;
varying float vT;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  float alive = (aBirth >= 0.0 && t >= 0.0 && t < 1.0) ? 1.0 : 0.0;
  t = clamp(t, 0.0, 1.0);
  age = min(age, aLife);
  vT = t;
  vColor = aColor;
  vSeed = aSeed;
  // 指数減速の積分 + 一定加速度(たなびき)
  vec3 p = position + aVel * (1.0 - exp(-uDrag * age)) / uDrag + uAccel * age * age * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = alive * aSize * mix(1.0, uGrow, t) * uScale / max(0.1, -mv.z);
}
`;

const SPARK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uFade;
uniform float uAlpha;
varying vec3 vColor;
varying float vT;
varying float vSeed;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float a = vSeed * 6.2831 + vT * 2.4;
  float c = cos(a);
  float s = sin(a);
  uv = mat2(c, -s, s, c) * uv + 0.5;
  float alpha = texture2D(uMap, uv).a * pow(1.0 - vT, uFade) * uAlpha;
  gl_FragColor = vec4(vColor, alpha);
}
`;

export interface SparkPool {
  points: THREE.Points;
  /** 1粒スポーンする(位置・速度はワールドではなく親グループのローカル座標) */
  spawn: (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    r: number,
    g: number,
    b: number
  ) => void;
  /** 毎フレーム呼ぶ。clock秒とピクセル換算係数を渡す */
  update: (time: number, pixelScale: number) => void;
  dispose: () => void;
}

export interface SparkPoolOptions {
  count: number;
  map: THREE.Texture;
  /** 速度の指数減衰(大きいほどすぐ止まる) */
  drag?: number;
  /** 一定加速度(煙がゆるく流れる用) */
  accel?: [number, number, number];
  /** 寿命の終わりの大きさ倍率(1未満で縮む・1超で広がる) */
  grow?: number;
  /** 消え方のカーブ(大きいほど早く消える) */
  fade?: number;
  /** 全体の濃さ(煙は重ねるので薄くする) */
  alpha?: number;
  additive?: boolean;
}

/** 粒子プールを作る。用途ごとに1つずつ持たせる(火花・煙・きらきら) */
export function createSparkPool(opts: SparkPoolOptions): SparkPool {
  const n = opts.count;
  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  const vel = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  const birth = new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1);
  const life = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1);
  const size = new THREE.BufferAttribute(new Float32Array(n), 1);
  const seed = new THREE.BufferAttribute(new Float32Array(n), 1);
  for (let i = 0; i < n; i++) seed.setX(i, Math.random());
  for (const a of [pos, vel, color, birth, life, size]) a.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute("position", pos);
  geom.setAttribute("aVel", vel);
  geom.setAttribute("aColor", color);
  geom.setAttribute("aBirth", birth);
  geom.setAttribute("aLife", life);
  geom.setAttribute("aSize", size);
  geom.setAttribute("aSeed", seed);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uMap: { value: opts.map },
      uDrag: { value: opts.drag ?? 2.2 },
      uAccel: { value: new THREE.Vector3(...(opts.accel ?? [0, 0, 0])) },
      uGrow: { value: opts.grow ?? 0.4 },
      uFade: { value: opts.fade ?? 1.3 },
      uAlpha: { value: opts.alpha ?? 1 },
    },
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.raycast = () => undefined;

  let cursor = 0;
  let dirty = false;

  return {
    points,
    spawn: (x, y, z, vx, vy, vz, sz, lf, r, g, b) => {
      const i = cursor;
      cursor = (cursor + 1) % n;
      pos.setXYZ(i, x, y, z);
      vel.setXYZ(i, vx, vy, vz);
      color.setXYZ(i, r, g, b);
      size.setX(i, sz);
      life.setX(i, lf);
      birth.setX(i, mat.uniforms.uTime.value as number);
      dirty = true;
    },
    update: (time, pixelScale) => {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uScale.value = pixelScale;
      if (!dirty) return;
      dirty = false;
      // スポーンした分だけまとめて1回アップロードする
      pos.needsUpdate = true;
      vel.needsUpdate = true;
      color.needsUpdate = true;
      birth.needsUpdate = true;
      life.needsUpdate = true;
      size.needsUpdate = true;
    },
    dispose: () => {
      geom.dispose();
      mat.dispose();
    },
  };
}
