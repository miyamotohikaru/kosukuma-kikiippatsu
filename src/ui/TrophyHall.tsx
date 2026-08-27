"use client";

// トロフィーホール(宇宙の殿堂)。/api/trophies から歴代勝者を取得し、
// 自前の <Canvas> に手続き生成トロフィーを「ひな壇」に並べる。
// タップで選択→カメラが寄り、詳細カード(DOM)を表示する。
//
// ── デモ表示 ──
// `/trophies?demo=1` で、クライアント側だけで作ったダミーの勝者が並ぶ。
// 件数指定は `/trophies?demo=48`。`?demo=off` で通常表示。
// サーバーには一切問い合わせない・書き込まないので、記録は増えない。

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { TrophiesResponse, TrophyRecord } from "@/lib/types";
import { mulberry32, pick, randInt } from "@/lib/prng";
import { getTrophyParams, TROPHY_HEIGHT } from "@/lib/trophy";
import TrophyMesh from "@/game/trophy/TrophyMesh";
import "./trophies.css";

const PER_PAGE = 8;
/** カメラの垂直画角(<Canvas> の fov と必ずそろえる) */
const HALL_FOV = 42;

// ── 並べかた ────────────────────────────────────────
// 横に何体ならべるかは画面のアスペクト比で変える(スマホ縦は2列)。
// 後ろの列ほど台座を高くし、半歩よこにずらして、前の列のあいだから顔が見える。

const FRONT_Z = 0.95; // いちばん手前の列の z
const BASE_TOP = 0.55; // 最前列の台座の高さ
const ROW_LIFT = 0.58; // 1列おくへ行くたびに台座を高くする量(ひな壇の段差)
/** 台座に降りそそぐ光のすじの長さ */
const SHAFT_H = 2.6;

interface StandSpot {
  x: number;
  z: number;
  top: number;
}

/** 画面のアスペクト比から、横にならべる数を決める */
function colsForAspect(aspect: number): number {
  if (aspect >= 1.25) return 4; // PC・タブレット横
  if (aspect >= 0.82) return 3; // ほぼ正方形
  return 2; // スマホ縦
}

/** 列が少ないほど間隔をつめる(せまい画面でトロフィーを大きく見せる) */
function spacingFor(cols: number): number {
  return cols >= 4 ? 1.6 : cols === 3 ? 1.5 : 1.4;
}

/** 台座の位置をまとめて作る */
function layoutStands(count: number, cols: number): StandSpot[] {
  const rows = Math.max(1, Math.ceil(count / cols));
  const gapZ = rows <= 2 ? 2.35 : 1.95;
  const spacing = spacingFor(cols);
  const spots: StandSpot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // 端数の列は中央そろえ(最終ページが左に寄らないように)
    const inRow = Math.min(cols, count - row * cols);
    // 1列おきに半歩ずらして、後列が前列のかげに完全に隠れないようにする
    const shift = rows <= 1 ? 0 : (row % 2 === 0 ? -1 : 1) * spacing * 0.22;
    spots.push({
      x: (col - (inRow - 1) / 2) * spacing + shift,
      z: FRONT_Z - row * gapZ,
      top: BASE_TOP + row * ROW_LIFT,
    });
  }
  return spots;
}

interface HallHome {
  camY: number;
  camZ: number;
  targetY: number;
  targetZ: number;
  /** 1体に寄るときのカメラ距離 */
  focusDist: number;
  /** せまい画面か(寄ったときの構図を変える) */
  narrow: boolean;
}

/** ぜんぶが画面に収まるカメラ位置を、アスペクト比から計算する */
function fitHall(spots: StandSpot[], aspect: number): HallHome {
  const vTan = Math.tan(((HALL_FOV / 2) * Math.PI) / 180);
  const hTan = vTan * Math.max(0.3, aspect); // tan(水平半画角)
  let maxAbsX = 0.6;
  let maxTop = BASE_TOP;
  let frontZ = FRONT_Z;
  let backZ = FRONT_Z;
  for (const s of spots) {
    maxAbsX = Math.max(maxAbsX, Math.abs(s.x));
    maxTop = Math.max(maxTop, s.top);
    frontZ = Math.max(frontZ, s.z);
    backZ = Math.min(backZ, s.z);
  }
  const halfW = maxAbsX + 0.55; // トロフィー・名札の幅ぶん
  const yTop = maxTop + TROPHY_HEIGHT + 0.2; // てっぺんまでの高さ
  const centerZ = (frontZ + backZ) / 2;
  // 横は「いちばん手前の列」が、縦は「全体の中心」がはみ出さない距離
  const byWidth = frontZ + halfW / hTan;
  const byHeight = centerZ + (yTop / 2 + 0.55) / vTan;
  return {
    camZ: Math.max(byWidth, byHeight) + 0.4,
    camY: yTop * 0.92 + 0.25,
    targetY: yTop * 0.4,
    targetZ: centerZ + 0.25,
    focusDist: Math.max(1.75, 0.62 / hTan),
    narrow: aspect < 0.85,
  };
}

// ── デモ表示のダミーデータ ──────────────────────────
// 実在の人物を思わせない、ゲームらしいハンドルネームだけを組み立てる。

const DEMO_DEFAULT = 100; // ?demo=1 のときの人数(第100代までならぶ)
const DEMO_MAX = 400;

const DEMO_JA_HEAD = [
  "そら",
  "つき",
  "ほし",
  "もち",
  "ぷりん",
  "めろん",
  "たこ",
  "こんぶ",
  "まめ",
  "うさ",
  "かめ",
  "ぺんぎん",
  "くらげ",
  "かっぱ",
  "はにわ",
  "ぴよ",
  "もぐ",
  "ころ",
  "ふわ",
  "きなこ",
  "あんこ",
  "だんご",
  "わたあめ",
  "ぽんず",
] as const;
const DEMO_JA_TAIL = [
  "まる",
  "たろう",
  "のすけ",
  "ぴょん",
  "ざむらい",
  "はかせ",
  "せんぱい",
  "キング",
  "マスター",
  "ちゃん",
  "ぼう",
  "2ごう",
] as const;
const DEMO_KANA_HEAD = [
  "ムーン",
  "コメット",
  "ネビュラ",
  "ロケット",
  "オーロラ",
  "メテオ",
  "サテライト",
  "プラネット",
  "ギャラクシー",
  "ステラ",
] as const;
const DEMO_KANA_TAIL = [
  "うさぎ",
  "こぐま",
  "ねこ",
  "たまご",
  "しょうねん",
  "むすめ",
  "じいさん",
  "ボーイ",
  "ガール",
  "おじさん",
] as const;
const DEMO_EN_HEAD = [
  "Nova",
  "Comet",
  "Orbit",
  "Pixel",
  "Quasar",
  "Zenith",
  "Astra",
  "Vega",
  "Lyra",
  "Nimbus",
  "Echo",
  "Drift",
  "Ember",
  "Halo",
  "Pulsar",
  "Cosmo",
  "Kite",
  "Onyx",
  "Sable",
  "Wisp",
] as const;
const DEMO_EN_TAIL = ["", "", "", "77", "_X", "2000", "star", "9"] as const;
/** 名前に「こすくま」が入るとトッパーがくま頭になる(その見本) */
const DEMO_BEAR = [
  "こすくま2ごう",
  "こすくまLOVE",
  "こすくまだいすき",
  "ちいさなこすくま",
] as const;

/** 国旗をばらけさせる。null は「国がわからない人」 */
const DEMO_COUNTRIES: readonly (string | null)[] = [
  "JP",
  "JP",
  "JP",
  "JP",
  "US",
  "US",
  "BR",
  "FR",
  "DE",
  "KR",
  "TW",
  "IN",
  "GB",
  "CA",
  "AU",
  "MX",
  "ID",
  "TH",
  "PH",
  "SE",
  "NG",
  "EG",
  "IT",
  "ES",
  "PL",
  "VN",
  "AR",
  "ZA",
  "NZ",
  "SG",
  "TR",
  "NL",
  "FI",
  "CL",
  null,
  null,
];

function demoName(rng: () => number): string {
  const roll = rng();
  if (roll < 0.07) return pick(rng, DEMO_BEAR);
  if (roll < 0.45) return pick(rng, DEMO_JA_HEAD) + pick(rng, DEMO_JA_TAIL);
  if (roll < 0.72) return pick(rng, DEMO_KANA_HEAD) + pick(rng, DEMO_KANA_TAIL);
  return pick(rng, DEMO_EN_HEAD) + pick(rng, DEMO_EN_TAIL);
}

/**
 * デモ用のダミー勝者をクライアント側だけで作る。
 * roundNo は本物と同じ「新しい順」に振るので、トロフィーの形は
 * 本物とまったく同じアルゴリズム(getTrophyParams)で生成される。
 * 第100代=虹オーロラ / 第77代=星雲 のレア個体もそのまま出る。
 */
function buildDemoTrophies(count: number): TrophyRecord[] {
  const rng = mulberry32(0x5eed7a11); // 何度ひらいても同じ顔ぶれになるよう固定
  const used = new Set<string>();
  const out: TrophyRecord[] = [];
  let at = Date.now() - 37 * 60_000; // いちばん新しい人は37分前
  for (let i = 0; i < count; i++) {
    let name = demoName(rng);
    if (used.has(name)) {
      // かぶったら末尾に数字をつける(12文字を超えないように切る)
      name = `${Array.from(name).slice(0, 10).join("")}${randInt(rng, 9) + 2}`;
    }
    used.add(name);
    out.push({
      roundNo: count - i, // 新しい順(第count代 → 第1代)
      name,
      country: pick(rng, DEMO_COUNTRIES),
      wonAt: new Date(at).toISOString(),
      stabCount: 40 + randInt(rng, 950),
    });
    at -= (2.5 + rng() * 40) * 3_600_000; // 数時間〜2日ずつさかのぼる
  }
  return out;
}

/** ?demo= を読む。null = ふつうの表示(サーバーから取得する) */
function readDemoCount(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = new URLSearchParams(window.location.search).get("demo");
    if (raw === null) return null;
    const s = raw.trim().toLowerCase();
    if (s === "0" || s === "off" || s === "false" || s === "no") return null;
    if (s === "" || s === "1" || s === "on" || s === "true" || s === "yes") {
      return DEMO_DEFAULT;
    }
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n) || n < 1) return DEMO_DEFAULT;
    return Math.min(DEMO_MAX, n);
  } catch {
    return null;
  }
}

// ── 見た目まわりの小物 ────────────────────────────────

/** 金属を照らす環境光。外部アセットなしで RoomEnvironment を焼き込む */
function StudioEnv() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      rt.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** 簡易星空(Points)。決定的な配置 */
function StarDome() {
  const geom = useMemo(() => {
    const rng = mulberry32(20260704);
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const y = rng() * 2 - 1;
      const r = 26 + rng() * 14;
      const xz = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * xz * r;
      pos[i * 3 + 1] = Math.abs(y) * r * 0.75 - 3;
      pos[i * 3 + 2] = Math.sin(a) * xz * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <points geometry={geom}>
      <pointsMaterial
        size={0.16}
        color="#dfe4ff"
        transparent
        opacity={0.85}
        depthWrite={false}
        fog={false}
      />
    </points>
  );
}

// ── 共有テクスチャ(アプリで1枚ずつだけ作って使いまわす) ──

/** 台座に降りそそぐ光のすじ。下(台座側)がいちばん明るい縦グラデ */
let shaftTexture: THREE.CanvasTexture | null = null;
function getShaftTexture(): THREE.CanvasTexture {
  if (shaftTexture) return shaftTexture;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    // 下端 → 上端。円錐のUVは v=0 が底(台座側)なので、下端を底に合わせる
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, "rgba(255,238,190,0)"); // 底のフチは消す
    g.addColorStop(0.16, "rgba(255,238,190,0.5)");
    g.addColorStop(0.6, "rgba(255,238,190,0.15)");
    g.addColorStop(1, "rgba(255,238,190,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
  }
  shaftTexture = new THREE.CanvasTexture(c);
  shaftTexture.colorSpace = THREE.SRGBColorSpace;
  return shaftTexture;
}

/** 台座の足元にひろがる光だまり */
let poolTexture: THREE.CanvasTexture | null = null;
function getPoolTexture(): THREE.CanvasTexture {
  if (poolTexture) return poolTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.35, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}

/** 反射風の暗いグラデ円の床 + 殿堂らしい同心円のライン */
function Floor() {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, "rgba(40,48,116,0.95)");
      g.addColorStop(0.55, "rgba(14,19,58,0.75)");
      g.addColorStop(1, "rgba(5,7,26,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={[0, 0, -0.6]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[11, 48]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
      {/* 同心円のライン。床に「建物の床」らしい目盛りをあたえる */}
      {[3.1, 5.3, 7.6].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
          <ringGeometry args={[r, r + 0.035, 96]} />
          <meshBasicMaterial
            color="#7b87e8"
            transparent
            opacity={0.3}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/** 台座下のラベル「第N代 {name}」(CanvasTextureプレート) */
function makeLabelTexture(text: string): {
  texture: THREE.CanvasTexture;
  redraw: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let fam = "sans-serif";
    try {
      fam = getComputedStyle(document.body).fontFamily || fam;
    } catch {
      /* noop */
    }
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(12,17,55,0.88)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 30);
    ctx.fill();
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 112, 26);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 56;
    ctx.font = `800 ${size}px ${fam}`;
    while (size > 18 && ctx.measureText(text).width > 450) {
      size -= 2;
      ctx.font = `800 ${size}px ${fam}`;
    }
    ctx.fillStyle = "#fffef2";
    ctx.fillText(text, 256, 66);
    texture.needsUpdate = true;
  };
  draw();
  return { texture, redraw: draw };
}

interface StandProps {
  item: TrophyRecord;
  spot: StandSpot;
  selected: boolean;
  onPick: () => void;
}

/** 台座+光のすじ+トロフィー+ラベル1式 */
function TrophyStand({ item, spot, selected, onPick }: StandProps) {
  const { x, z, top } = spot;
  const spinRef = useRef<THREE.Group>(null);
  const labelRef = useRef<THREE.Group>(null);
  const speed = useRef(0.18);
  const label = useMemo(
    () => makeLabelTexture(`第${item.roundNo}代 ${item.name}`),
    [item.roundNo, item.name]
  );
  // 台座は高いほど少しだけ太く(ひょろ長く見えないように)
  const pillarR = 0.42 + (top - BASE_TOP) * 0.05;

  useEffect(() => {
    let alive = true;
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (alive) label.redraw();
      });
    }
    return () => {
      alive = false;
      label.texture.dispose();
      document.body.style.cursor = "auto";
    };
  }, [label]);

  useFrame(({ camera }, dt) => {
    // 選ばれている間はうれしそうに速く回る
    const target = selected ? 0.95 : 0.18;
    speed.current += (target - speed.current) * Math.min(1, dt * 4);
    const g = spinRef.current;
    if (g) g.rotation.y += speed.current * dt;
    // 名札はいつでもこちらを向く(端の台座でも読める)
    const l = labelRef.current;
    if (l) {
      l.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick();
  };

  return (
    <group position={[x, 0, z]}>
      {/* 足元の光だまり */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
        <circleGeometry args={[0.92, 28]} />
        <meshBasicMaterial
          map={getPoolTexture()}
          color={selected ? "#ffe9a0" : "#c8d0ff"}
          transparent
          opacity={selected ? 0.6 : 0.32}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </mesh>

      {/* 上から降りそそぐ光のすじ(スポットライト風) */}
      <mesh position={[0, top + SHAFT_H / 2, 0]}>
        <coneGeometry args={[0.68, SHAFT_H, 22, 1, true]} />
        <meshBasicMaterial
          map={getShaftTexture()}
          color={selected ? "#fff4cf" : "#ffe9b8"}
          transparent
          opacity={selected ? 0.5 : 0.28}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </mesh>

      {/* 台座 */}
      <mesh position={[0, top / 2, 0]}>
        <cylinderGeometry args={[pillarR, pillarR + 0.05, top, 36]} />
        <meshStandardMaterial color="#10163f" metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[0, top, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[pillarR, 0.018, 8, 40]} />
        <meshStandardMaterial
          color="#ffd93d"
          metalness={0.8}
          roughness={0.3}
          emissive="#7a5210"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* 選択中の足元グロー */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <circleGeometry args={[0.62, 32]} />
          <meshBasicMaterial
            color="#ffd93d"
            transparent
            opacity={0.28}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* トロフィー(ゆっくり回転) */}
      <group ref={spinRef} position={[0, top, 0]} scale={0.9}>
        <TrophyMesh roundNo={item.roundNo} name={item.name} />
      </group>

      {/* ラベル「第N代 {name}」。台座の上の方に貼り、ぐるっと回ってカメラを向く */}
      <group ref={labelRef} position={[0, Math.max(0.2, top - 0.19), 0]}>
        <mesh position={[0, 0, pillarR + 0.07]}>
          <planeGeometry args={[0.85, 0.21]} />
          <meshBasicMaterial map={label.texture} transparent />
        </mesh>
      </group>

      {/* 大きめの透明タップ判定(モバイル向け) */}
      <mesh
        position={[0, (top + 1.15) / 2, 0]}
        onClick={handleClick}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <cylinderGeometry args={[0.56, 0.56, top + 1.15, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 選択に合わせてゆったり寄る/戻るカメラ */
function HallCamera({
  home,
  focus,
}: {
  home: HallHome;
  focus: StandSpot | null;
}) {
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpTgt = useMemo(() => new THREE.Vector3(), []);
  const curTgt = useRef(new THREE.Vector3(0, home.targetY, home.targetZ));
  useFrame(({ camera, clock }, dt) => {
    const t = clock.getElapsedTime();
    if (focus) {
      // せまい画面は少し引き、被写体が画面の上半分にくるよう下を狙う
      tmpPos.set(
        focus.x * 0.72,
        focus.top + (home.narrow ? 0.92 : 0.75),
        focus.z + home.focusDist
      );
      tmpTgt.set(focus.x, focus.top + (home.narrow ? 0.16 : 0.42), focus.z);
    } else {
      // ゆらゆらと漂う定位置
      tmpPos.set(Math.sin(t * 0.25) * 0.35, home.camY, home.camZ);
      tmpTgt.set(0, home.targetY, home.targetZ);
    }
    const k = 1 - Math.exp(-3 * Math.min(dt, 0.1));
    camera.position.lerp(tmpPos, k);
    curTgt.current.lerp(tmpTgt, k);
    camera.lookAt(curTgt.current);
  });
  return null;
}

// ── DOMまわりのヘルパ ─────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** ISO 3166-1 alpha-2 → 国旗絵文字。不明なら空文字 */
function flagEmoji(cc: string | null): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  const up = cc.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + up.charCodeAt(0) - 65,
    0x1f1e6 + up.charCodeAt(1) - 65
  );
}

// ── 本体 ────────────────────────────────────────────

export default function TrophyHall() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TrophiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  // ?demo= を読み終わるまではフェッチしない(デモならサーバーにさわらない)
  const [demoCount, setDemoCount] = useState<number | null>(null);
  const [urlRead, setUrlRead] = useState(false);
  // 3Dの中だけで使う値なので、初回から実寸で読んでよい(DOMの出力は変わらない)
  const [aspect, setAspect] = useState(() =>
    typeof window === "undefined"
      ? 1.6
      : window.innerWidth / Math.max(1, window.innerHeight)
  );

  useEffect(() => {
    setDemoCount(readDemoCount());
    setUrlRead(true);
  }, []);

  // 画面のアスペクト比(並べかたとカメラ距離のもと)
  useEffect(() => {
    const onResize = () => {
      setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // デモのダミー勝者(クライアント側だけで作る)
  const demoAll = useMemo(
    () => (demoCount === null ? null : buildDemoTrophies(demoCount)),
    [demoCount]
  );

  useEffect(() => {
    if (!urlRead) return;
    if (demoCount !== null) {
      // デモ表示: /api/trophies は叩かない
      setLoading(false);
      setFailed(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetch(`/api/trophies?perPage=${PER_PAGE}&page=${page}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<TrophiesResponse>;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, retry, urlRead, demoCount]);

  // デモならダミーを、そうでなければAPIの結果をそのまま使う
  const view: TrophiesResponse | null = useMemo(() => {
    if (!demoAll) return data;
    const start = (page - 1) * PER_PAGE;
    return {
      total: demoAll.length,
      page,
      perPage: PER_PAGE,
      items: demoAll.slice(start, start + PER_PAGE),
    };
  }, [demoAll, data, page]);

  const items = useMemo(() => view?.items ?? [], [view]);
  const total = view?.total ?? 0;
  const perPage = view?.perPage ?? PER_PAGE;
  const maxPage = Math.max(1, Math.ceil(total / perPage));

  const cols = colsForAspect(aspect);
  const spots = useMemo(
    () => layoutStands(items.length, cols),
    [items.length, cols]
  );
  const home = useMemo(() => fitHall(spots, aspect), [spots, aspect]);

  const sel: TrophyRecord | undefined =
    selected !== null ? items[selected] : undefined;
  const focus = selected !== null && sel ? (spots[selected] ?? null) : null;
  const selRare = sel ? getTrophyParams(sel.roundNo, sel.name).rare : false;

  const goPage = (p: number) => {
    if (p < 1 || p > maxPage) return;
    setSelected(null);
    setPage(p);
  };

  return (
    <div className="th-root">
      <div className="th-canvas">
        <Canvas
          dpr={[1, 2]}
          camera={{
            fov: HALL_FOV,
            position: [0, home.camY, home.camZ],
            near: 0.1,
            far: 90,
          }}
          onPointerMissed={() => setSelected(null)}
        >
          <color attach="background" args={["#05071a"]} />
          <fog attach="fog" args={["#05071a", 12, 40]} />
          <StudioEnv />
          <ambientLight intensity={0.25} color="#aab3ff" />
          <directionalLight position={[3, 6, 4]} intensity={1.2} color="#fff6dd" />
          {/* 手前の金色・横のピンク・奥の青。ひな壇が深いので3灯で奥まで届かせる */}
          <pointLight position={[0, 3.4, 1.2]} intensity={9} distance={16} color="#ffd93d" />
          <pointLight position={[-3.2, 1.8, -2.4]} intensity={5} distance={13} color="#ffb3c7" />
          <pointLight position={[2.6, 2.8, -5]} intensity={5} distance={13} color="#a9c4ff" />
          <StarDome />
          <Floor />
          {items.map((it, i) => {
            const spot = spots[i];
            if (!spot) return null;
            return (
              <TrophyStand
                key={it.roundNo}
                item={it}
                spot={spot}
                selected={selected === i}
                onPick={() => setSelected(i)}
              />
            );
          })}
          <HallCamera home={home} focus={focus} />
        </Canvas>
      </div>

      {/* 画面のフチを落として、殿堂の奥ゆきと文字の読みやすさを出す */}
      <div className="th-vignette" aria-hidden="true" />

      {/* ── DOMオーバーレイ ── */}
      <header className="th-head">
        <Link href="/" className="th-back">
          ← ゲームへもどる
        </Link>
        <h1 className="th-title">🏆 トロフィーホール</h1>
        <p className="th-sub">
          これまでに <b>{total.toLocaleString("ja-JP")}</b> 人が とばした
        </p>
      </header>

      {demoCount !== null && (
        <div className="th-demo">
          <b>デモ表示</b>
          きろくでは ありません
        </div>
      )}

      {/* デモ表示のときは通信しないので、読み込み表示も出さない */}
      {loading && demoCount === null && (
        <div className="th-loading">よみこみちゅう…</div>
      )}

      {failed && !loading && (
        <div className="th-message">
          <p>つうしんエラーが おきたよ</p>
          <button
            type="button"
            className="th-btn"
            onClick={() => setRetry((n) => n + 1)}
          >
            もういちど
          </button>
        </div>
      )}

      {!loading && !failed && total === 0 && (
        <div className="th-message">
          <p>
            まだ だれも とばしていない。
            <br />
            さいしょの1人に なろう！
          </p>
          <Link href="/" className="th-btn">
            ゲームへ
          </Link>
          {/* 中身がまだ無いときでも、どんな画面になるかは見られるように */}
          <a className="th-demo-link" href="/trophies?demo=1">
            みほんを見る
          </a>
        </div>
      )}

      {sel && (
        <div className="th-card" role="dialog" aria-label="トロフィーのくわしい情報">
          <button
            type="button"
            className="th-card-close"
            aria-label="とじる"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
          <div className="th-card-gen">
            第{sel.roundNo}代{selRare && <span className="th-card-rare">✨ レア</span>}
          </div>
          <div className="th-card-name">
            {sel.name}
            {flagEmoji(sel.country) && (
              <span className="th-card-flag">{flagEmoji(sel.country)}</span>
            )}
          </div>
          <dl className="th-card-rows">
            <div>
              <dt>とばした日</dt>
              <dd>{formatDate(sel.wonAt)}</dd>
            </div>
            <div>
              <dt>その代のちょうせん回数</dt>
              <dd>{sel.stabCount.toLocaleString("ja-JP")}回</dd>
            </div>
          </dl>
        </div>
      )}

      {total > 0 && (
        <footer className="th-pager">
          <button
            type="button"
            className="th-btn"
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
          >
            ←まえ
          </button>
          <span className="th-page-no">
            {page} / {maxPage}
          </span>
          <button
            type="button"
            className="th-btn"
            disabled={page >= maxPage}
            onClick={() => goPage(page + 1)}
          >
            つぎ→
          </button>
        </footer>
      )}
    </div>
  );
}
