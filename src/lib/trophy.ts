// 手続き生成トロフィーのパラメータ。roundNo と名前から決定的に決まり、
// 同じ入力なら世界中どこでも同じ形になる。three には依存しない純データ層。

import { hashString, mulberry32, pick, randRange } from "./prng";

/** カップ輪郭の系統 */
export type CupStyle =
  | "wine" // ワイングラス
  | "urn" // 壺
  | "angular" // 角ばった段
  | "dish" // 浅く広い皿
  | "rocket" // ロケット
  | "tulip" // チューリップ(すぼまって開く)
  | "orb" // 球をのせた台
  | "column"; // 柱(まっすぐ)
/** 持ち手の種類 */
export type HandleStyle = "none" | "round" | "square";
/** てっぺんの飾り */
export type TopperKind =
  | "star" // 星
  | "moon" // 三日月
  | "heart" // ハート
  | "rocket" // ロケット
  | "planet" // リング付き惑星
  | "bear" // くま頭(球3つ)
  | "diamond" // ダイヤ
  | "crown" // 王冠
  | "ring"; // 立てた輪(惑星の環のような)
/**
 * 素材の系統。**色はこのゲームでいちばん記憶に残るところ**なので、
 * 「金・銀・銅」の3色だけにせず、宝石や鉱物まで広げて12系統ある。
 * 並び順は「代」の順に回る番号でもある(下の FAMILY)。
 */
export type MaterialKind =
  | "silver" // ぎん
  | "gold" // きん
  | "aurora" // オーロラ(虹の干渉色 + ラメ)
  | "rose" // ローズゴールド
  | "emerald" // エメラルド
  | "bronze" // どう
  | "sapphire" // サファイア
  | "pearl" // しんじゅ(やわらかい真珠光)
  | "amethyst" // アメジスト
  | "nebula" // せいうん(深い紺 + 内側の紫 + ラメ)
  | "coral" // さんご(つや消しの珊瑚色)
  | "obsidian"; // こくようせき(黒いガラス)
/** 台座の形 */
export type BaseShape = "round" | "square";

const CUP_STYLES: readonly CupStyle[] = [
  "wine",
  "urn",
  "angular",
  "dish",
  "rocket",
  "tulip",
  "orb",
  "column",
];

// ── すでに世に出た代の姿を守るための、増やす前の並び ──────────────
// くじは `pick(rng, 配列)` なので、**選択肢を増やすと目が動く**。
// 第1〜3代はもうトロフィーホールに立っていて、その姿で覚えられているので、
// この3代だけは増やす前の並びから引く。第4代からは増えたぶんも出る。
const LEGACY_ROUNDS = 3;
const CUP_STYLES_LEGACY: readonly CupStyle[] = [
  "wine",
  "urn",
  "angular",
  "dish",
  "rocket",
];
const TOPPERS: readonly TopperKind[] = [
  "star",
  "moon",
  "heart",
  "rocket",
  "planet",
  "bear",
  "diamond",
  "crown",
  "ring",
];
const TOPPERS_LEGACY: readonly TopperKind[] = [
  "star",
  "moon",
  "heart",
  "rocket",
  "planet",
  "bear",
  "diamond",
];

/** 台座の1段(下から積む) */
export interface BaseTier {
  radius: number;
  height: number;
}

/** マテリアルの見た目(TrophyMesh が MeshPhysicalMaterial に流し込む) */
export interface TrophyMaterialParams {
  kind: MaterialKind;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  /** オーロラ(虹色)の強さ。0で無効 */
  iridescence: number;
  /** ラメ(キラキラ粒)を散らすか */
  sparkle: boolean;
}

/** トロフィー全体のパラメータ。全高≈1unit・台座底が y=0 */
export interface TrophyParams {
  seed: number;
  /** 100の倍数などのレア個体か */
  rare: boolean;
  cupStyle: CupStyle;
  /** LatheGeometry 用の輪郭点列 [半径, y][]。カップ底ローカルで下→上 */
  profile: [number, number][];
  /** 角型はローポリにするための回転分割数 */
  latheSegments: number;
  cupHeight: number;
  cupMaxRadius: number;
  cupRimRadius: number;
  /** カップ底のワールドy (= 台座の高さ) */
  cupBottomY: number;
  handle: HandleStyle;
  handleRadius: number;
  handleTube: number;
  /** 持ち手中心のワールドy */
  handleY: number;
  /** 持ち手中心の中心軸からの距離 */
  handleOffsetX: number;
  baseShape: BaseShape;
  /** 台座の段(下から) */
  baseTiers: BaseTier[];
  baseHeight: number;
  topper: TopperKind;
  topperScale: number;
  /** トッパー中心のワールドy */
  topperY: number;
  material: TrophyMaterialParams;
}

/** トロフィーの基準全高 (three.js units) */
export const TROPHY_HEIGHT = 1;

// ── カップ輪郭 ──────────────────────────────────────
// 各系統はユニット空間(y: 0..1, r: 正規化前)でキー点を作り、
// smoothProfile で曲線化 → 半径最大値で正規化する。

interface BuiltProfile {
  /** 正規化済み点列 [r(0..1), y(0..1)][] */
  points: [number, number][];
  /** 上端付近の半径(持ち手・トッパー配置の参考) */
  rim: number;
}

/** キー点間を r はsmoothstep・y は線形で補間し、なめらかな壁面にする */
function smoothProfile(
  keys: [number, number][],
  samplesPerSeg = 5
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [r0, y0] = keys[i];
    const [r1, y1] = keys[i + 1];
    for (let j = 0; j < samplesPerSeg; j++) {
      const t = j / samplesPerSeg;
      const s = t * t * (3 - 2 * t);
      out.push([r0 + (r1 - r0) * s, y0 + (y1 - y0) * t]);
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** 半径の最大値で正規化し、rim(上端半径)を測る */
function normalizeProfile(points: [number, number][]): BuiltProfile {
  let rMax = 0;
  for (const [r] of points) rMax = Math.max(rMax, r);
  const pts = points.map(([r, y]) => [r / rMax, y] as [number, number]);
  let rim = 0;
  for (const [r, y] of pts) if (y > 0.85) rim = Math.max(rim, r);
  if (rim === 0) rim = pts[pts.length - 1][0];
  return { points: pts, rim };
}

/** 系統ごとの輪郭生成。rng の消費数は同系統なら常に同じ */
function buildCupProfile(style: CupStyle, rng: () => number): BuiltProfile {
  switch (style) {
    case "wine": {
      // ワイングラス型: 細い脚 + ふくらむボウル + 開いた口
      const footR = randRange(rng, 0.42, 0.58);
      const stemR = randRange(rng, 0.1, 0.16);
      const stemH = randRange(rng, 0.24, 0.36);
      const bellyR = randRange(rng, 0.62, 0.8);
      const bellyY = stemH + (1 - stemH) * randRange(rng, 0.35, 0.5);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [footR, 0.015],
          [footR * 0.7, 0.05],
          [stemR, 0.1],
          [stemR, stemH],
          [bellyR, bellyY],
          [1, 1],
          [0.9, 0.985],
          [0.84, 0.9],
        ])
      );
    }
    case "urn": {
      // 壺型: どっしり膨らんで首がすぼまり、口が開く
      const footR = randRange(rng, 0.34, 0.46);
      const bellyY = randRange(rng, 0.34, 0.46);
      const neckR = randRange(rng, 0.42, 0.58);
      const neckY = randRange(rng, 0.7, 0.8);
      const mouthR = randRange(rng, 0.7, 0.9);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [footR, 0.02],
          [footR * 0.9, 0.07],
          [1, bellyY],
          [neckR, neckY],
          [mouthR, 1],
          [mouthR - 0.12, 0.97],
          [mouthR - 0.18, 0.9],
        ])
      );
    }
    case "angular": {
      // 角型: 直線の段差だけで構成。分割数も落としてカクカクに
      const w0 = randRange(rng, 0.5, 0.68);
      const h0 = randRange(rng, 0.07, 0.12);
      const w1 = randRange(rng, 0.24, 0.36);
      const h1 = randRange(rng, 0.26, 0.4);
      return normalizeProfile([
        [0.02, 0],
        [w0, 0],
        [w0, h0],
        [w1, h0],
        [w1, h1],
        [1, 0.96],
        [1, 1],
        [0.86, 1],
        [0.8, 0.88],
      ]);
    }
    case "dish": {
      // 星屑皿型: 細い軸の上に浅く広いお皿
      const footR = randRange(rng, 0.4, 0.55);
      const stemR = randRange(rng, 0.09, 0.14);
      const stemTop = randRange(rng, 0.45, 0.6);
      const bowlR = randRange(rng, 0.3, 0.4);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [footR, 0.02],
          [footR * 0.6, 0.06],
          [stemR, 0.14],
          [stemR, stemTop],
          [bowlR, stemTop + 0.08],
          [1, 0.92],
          [1, 1],
          [0.9, 0.98],
          [0.82, 0.88],
        ])
      );
    }
    case "tulip": {
      // チューリップ型: 足もとから一度すぼまって、口へ向かってふわりと開く
      const footR = randRange(rng, 0.44, 0.58);
      const waistR = randRange(rng, 0.26, 0.36);
      const waistY = randRange(rng, 0.24, 0.34);
      const openY = randRange(rng, 0.72, 0.82);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [footR, 0.02],
          [footR * 0.72, 0.08],
          [waistR, waistY],
          [waistR * 1.5, openY],
          [1, 1],
          [0.9, 0.99],
          [0.8, 0.92],
        ])
      );
    }
    case "orb": {
      // 球型: 短い台の上にまるい玉。ほかの系統に無い「丸だけ」の輪郭
      const footR = randRange(rng, 0.4, 0.52);
      const baseY = randRange(rng, 0.14, 0.22);
      const orbY = baseY + randRange(rng, 0.36, 0.44);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [footR, 0.02],
          [footR * 0.66, baseY],
          [0.62, orbY - 0.16],
          [1, orbY],
          [0.62, orbY + 0.16],
          [0.16, 1],
        ])
      );
    }
    case "column": {
      // 柱型: まっすぐ立った角柱に小さな笠。記念碑のような静けさ
      const shaftR = randRange(rng, 0.34, 0.44);
      const capY = randRange(rng, 0.82, 0.9);
      return normalizeProfile([
        [0.02, 0],
        [0.72, 0],
        [0.72, 0.05],
        [shaftR, 0.1],
        [shaftR, capY],
        [0.62, capY + 0.03],
        [0.62, capY + 0.08],
        [0.5, 1],
      ]);
    }
    case "rocket": {
      // ロケット型: 裾のフィンが最大径、胴からノーズへすぼまる
      const bodyR = randRange(rng, 0.5, 0.62);
      const finTop = randRange(rng, 0.14, 0.2);
      const noseY = randRange(rng, 0.66, 0.74);
      return normalizeProfile(
        smoothProfile([
          [0.02, 0],
          [1, 0],
          [0.85, 0.06],
          [bodyR, finTop],
          [bodyR * 1.02, noseY],
          [bodyR * 0.5, 0.9],
          [0.03, 1],
        ])
      );
    }
  }
}

/** 輪郭上で y に一番近い点の半径(持ち手の付け根位置に使う) */
function radiusAtY(profile: [number, number][], y: number): number {
  let best = profile[0][0];
  let bestD = Infinity;
  for (const [r, py] of profile) {
    const d = Math.abs(py - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * 素材系統ごとの見た目。数値の幅は「同じ系統でも1本ずつ少し違う」ためのゆらぎ。
 *
 * **rng を消費する回数は全系統で同じ(3回)にしておくこと。** ここで消費数が
 * 変わると、以降の乱数の並びがずれて、既にある代の**形**まで変わってしまう。
 */
interface MaterialRecipe {
  color: string;
  metal: [number, number];
  rough: [number, number];
  emissive: string;
  emissiveI: [number, number];
  /** 見る角度で色が回る(1=あり) */
  iridescence?: number;
  /** 表面のラメ */
  sparkle?: boolean;
}

const MATERIALS: Record<MaterialKind, MaterialRecipe> = {
  silver: {
    color: "#e0e7f6",
    metal: [0.9, 1],
    rough: [0.12, 0.28],
    emissive: "#4a5878",
    emissiveI: [0.1, 0.16],
  },
  gold: {
    color: "#f6c445",
    metal: [0.9, 1],
    rough: [0.18, 0.34],
    emissive: "#7a4f0e",
    emissiveI: [0.12, 0.2],
  },
  aurora: {
    // 白地に虹の干渉色 + ラメ
    color: "#eae6ff",
    metal: [0.75, 0.9],
    rough: [0.1, 0.22],
    emissive: "#8a7cff",
    emissiveI: [0.1, 0.18],
    iridescence: 1,
    sparkle: true,
  },
  rose: {
    // ローズゴールド。金より柔らかく、銅よりピンクへ寄せる
    color: "#f0a68f",
    metal: [0.88, 1],
    rough: [0.2, 0.34],
    emissive: "#7d3a2c",
    emissiveI: [0.12, 0.2],
  },
  emerald: {
    // 深い緑の宝石。金属より少し曇らせて「石」に寄せる
    color: "#1f9c6b",
    metal: [0.55, 0.72],
    rough: [0.14, 0.26],
    emissive: "#0c6b46",
    emissiveI: [0.24, 0.36],
    sparkle: true,
  },
  bronze: {
    color: "#c8803f",
    metal: [0.85, 1],
    rough: [0.3, 0.45],
    emissive: "#5e3410",
    emissiveI: [0.12, 0.2],
  },
  sapphire: {
    // 紺(nebula)と混ざらないよう、はっきり明るい青へ寄せる
    color: "#2f9ce0",
    metal: [0.6, 0.76],
    rough: [0.1, 0.2],
    emissive: "#125f9c",
    emissiveI: [0.24, 0.36],
    sparkle: true,
  },
  pearl: {
    // 真珠。ぎん・オーロラと並んでも別物に見えるよう、**暖かい象牙色**へ。
    // 金属感は低く、うっすら干渉色がのる
    color: "#fbe6c8",
    metal: [0.3, 0.45],
    rough: [0.16, 0.3],
    emissive: "#8d7f9e",
    emissiveI: [0.14, 0.22],
    iridescence: 1,
  },
  amethyst: {
    // 紺(nebula)から離すため、赤紫まで振る
    color: "#b544c6",
    metal: [0.5, 0.68],
    rough: [0.14, 0.26],
    emissive: "#4a1e8a",
    emissiveI: [0.26, 0.4],
    sparkle: true,
  },
  nebula: {
    // 深い紺 + 内側から光る青紫 + ラメ。第4代はこれ。
    // 自発光を強くすると紫へ寄って「紺」に見えなくなるので、
    // 光は青寄り・弱めにして、地の紺を残す
    color: "#17205e",
    metal: [0.62, 0.78],
    rough: [0.18, 0.28],
    emissive: "#3247c8",
    emissiveI: [0.22, 0.32],
    sparkle: true,
  },
  coral: {
    // つや消しの珊瑚色。金属だらけの棚に1本だけ「石じゃないもの」を混ぜる
    color: "#ff7f6b",
    metal: [0.12, 0.28],
    rough: [0.42, 0.58],
    emissive: "#8c2d1f",
    emissiveI: [0.16, 0.26],
  },
  obsidian: {
    // 黒いガラス。暗いホールで沈まないよう、ふちの光だけ強めに残す
    color: "#15161f",
    metal: [0.72, 0.9],
    rough: [0.06, 0.16],
    emissive: "#3b3f7a",
    emissiveI: [0.3, 0.44],
    sparkle: true,
  },
};

function buildMaterial(
  kind: MaterialKind,
  rng: () => number,
  lap = 0,
): TrophyMaterialParams {
  const r = MATERIALS[kind];
  const tint = lapTint(lap);
  return {
    kind,
    color: shiftColor(r.color, tint.deg, tint.light),
    metalness: randRange(rng, r.metal[0], r.metal[1]),
    roughness: randRange(rng, r.rough[0], r.rough[1]),
    emissive: shiftColor(r.emissive, tint.deg, tint.light),
    emissiveIntensity: randRange(rng, r.emissiveI[0], r.emissiveI[1]),
    iridescence: r.iridescence ?? 0,
    sparkle: r.sparkle ?? false,
  };
}

/**
 * 代の順に回る素材の並び。**先頭3つは動かさないこと**
 * (第1代=ぎん / 第2代=きん / 第3代=オーロラ は、もう世に出ている姿)。
 * 12系統あるので、13代で一周する。
 */
const FAMILY: readonly MaterialKind[] = [
  "silver", // 第1代
  "gold", // 第2代
  "aurora", // 第3代
  "nebula", // 第4代: 紺色 + ラメ
  "coral", // 暖色
  "emerald",
  "rose", // 暖色
  "sapphire",
  "bronze", // 暖色
  "amethyst",
  "pearl",
  "obsidian",
];

/**
 * 12系統を一周したあと(第13代〜)の振り分け。
 * **色相は少ししか回さない。** 大きく回すと「きん」が緑になってしまい、
 * 系統の名前と姿が食い違う。まわりと見分けがつけばいいので、
 * 色相を ±11°ずつ、明るさを ±1割ずつ、周回ごとに交互へ広げていく。
 * (灰・白・黒は色相を回しても変わらないので、明るさの方で差をつける)
 */
function lapTint(lap: number): { deg: number; light: number } {
  if (lap <= 0) return { deg: 0, light: 1 };
  const step = Math.ceil(lap / 2);
  const sign = lap % 2 === 1 ? 1 : -1;
  return {
    deg: sign * 11 * step,
    light: Math.min(1.3, Math.max(0.68, 1 + sign * -0.08 * step)),
  };
}

/** #rrggbb の色相と明るさをずらす(彩度はそのまま) */
function shiftColor(hex: string, deg: number, light: number): string {
  if (deg === 0 && light === 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let l = (max + min) / 2;
  const sat = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  // 無彩色(灰・白・黒)は色相を持たないので 0 のままにして、明るさだけで差をつける
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    h = (((h + deg / 360) % 1) + 1) % 1;
  }
  l = Math.min(0.97, Math.max(0.04, l * light));
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const pp = 2 * l - q;
  const ch = (t: number) => {
    let x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) x = pp + (q - pp) * 6 * x;
    else if (x < 1 / 2) x = q;
    else if (x < 2 / 3) x = pp + (q - pp) * (2 / 3 - x) * 6;
    else x = pp;
    return Math.round(x * 255);
  };
  return `#${((1 << 24) | (ch(h + 1 / 3) << 16) | (ch(h) << 8) | ch(h - 1 / 3))
    .toString(16)
    .slice(1)}`;
}

/**
 * roundNo と名前からトロフィーの全パラメータを決定的に生成する。
 * 全高≈TROPHY_HEIGHT(=1)・台座底が y=0。
 */
export function getTrophyParams(roundNo: number, name: string): TrophyParams {
  const seed = hashString(`${roundNo}:${name}`);
  const rng = mulberry32(seed);

  // ── レア判定(rng を消費しない・roundNo/名前だけで決まる) ──
  const superRare = roundNo > 0 && roundNo % 1000 === 0; // 1000の倍数: 超レア
  const rareRainbow = !superRare && roundNo > 0 && roundNo % 100 === 0; // 100の倍数: 虹オーロラ確定
  const rareNebula =
    !superRare && !rareRainbow && roundNo > 0 && roundNo % 77 === 0; // ラッキー77: 星雲確定
  const bearName =
    name.includes("こすくま") || name.toLowerCase().includes("kosukuma");

  // ── 全体プロポーションゆらぎ ──
  const widthScale = randRange(rng, 0.85, 1.12);

  // ── カップ系統 ──
  // 第1〜3代はもう立っている姿があるので、増やす前の並びから引く
  const legacy = roundNo <= LEGACY_ROUNDS;
  const cupStyle = pick(rng, legacy ? CUP_STYLES_LEGACY : CUP_STYLES);

  // ── 台座 ──
  const baseShape: BaseShape = rng() < 0.55 ? "round" : "square";
  const tierRoll = rng();
  let tierCount = tierRoll < 0.3 ? 1 : tierRoll < 0.75 ? 2 : 3;
  if (superRare) tierCount = 3; // 超レアは必ず3段
  const bottomH = randRange(rng, 0.09, 0.12);
  const upperH = randRange(rng, 0.035, 0.055);
  const baseHeight = bottomH + upperH * (tierCount - 1);

  // ── 高さ配分(合計≈1になるように予算を割る) ──
  const topperScale =
    randRange(rng, 0.13, 0.19) * (superRare ? 1.2 : 1);
  const cupHeight = TROPHY_HEIGHT - baseHeight - topperScale * 0.9 - 0.015;

  // ── 幅 ──
  const styleWidth: Record<CupStyle, number> = {
    wine: 1,
    urn: 1.05,
    angular: 0.95,
    dish: 1.3,
    rocket: 0.72,
    tulip: 1,
    orb: 0.95,
    column: 0.8,
  };
  const cupMaxRadius =
    randRange(rng, 0.17, 0.23) * widthScale * styleWidth[cupStyle];

  const baseBottomR = Math.min(
    0.34,
    Math.max(cupMaxRadius * randRange(rng, 1.2, 1.45), 0.24)
  );
  const baseTiers: BaseTier[] = [];
  for (let i = 0; i < tierCount; i++) {
    baseTiers.push({
      radius: baseBottomR * (1 - 0.18 * i),
      height: i === 0 ? bottomH : upperH,
    });
  }

  // ── カップ輪郭 → 実寸へ ──
  const built = buildCupProfile(cupStyle, rng);
  const profile: [number, number][] = built.points.map(([r, y]) => [
    r * cupMaxRadius,
    y * cupHeight,
  ]);
  const cupRimRadius = built.rim * cupMaxRadius;
  const latheSegments =
    cupStyle === "angular" ? pick(rng, [6, 8, 10] as const) : 48;

  // ── 持ち手(左右対称) ──
  const handleRoll = rng();
  let handle: HandleStyle =
    handleRoll < 0.32 ? "none" : handleRoll < 0.68 ? "round" : "square";
  if (cupStyle === "rocket" && rng() < 0.6) handle = "none";
  const handleRadius = cupHeight * randRange(rng, 0.14, 0.2);
  const handleTube = handleRadius * randRange(rng, 0.24, 0.34);
  const handleYLocal = cupHeight * randRange(rng, 0.52, 0.68);
  const handleY = baseHeight + handleYLocal;
  const handleOffsetX = radiusAtY(profile, handleYLocal) + handleRadius * 0.8;

  // ── トッパー ──
  let topper = pick(rng, legacy ? TOPPERS_LEGACY : TOPPERS);
  if (bearName) topper = "bear"; // 名前に「こすくま」が入っていたらくま確定
  if (superRare) topper = "diamond";
  // ロケット型は上が閉じているので少し高めに載せる
  const topperY =
    baseHeight + cupHeight + topperScale * (cupStyle === "rocket" ? 0.62 : 0.45);

  // ── 素材 ──
  // 系統は**代の順に回す**(FAMILY)。乱数で選んでいたときは、となり同士が
  // 同じ金属になることがあり(第2代と第3代がどちらも銅)、別のトロフィーなのに
  // 同じものが並んでいるように見えていた。順に回せば、となり合う代が
  // 同じ系統になることは起きない。
  // 素材に乱数を使わなくなったが、ここで消費をやめると以降の乱数の並びが
  // ずれて、既存のトロフィーの**形**まで変わってしまう。1つ捨てておく
  rng();
  let kind: MaterialKind =
    FAMILY[((roundNo - 1) % FAMILY.length + FAMILY.length) % FAMILY.length];
  if (rareNebula) kind = "nebula";
  if (rareRainbow || superRare) kind = "aurora";
  // 12系統を一周したら色相を回して、前の周と同じ色にならないようにする
  const lap = Math.floor(Math.max(0, roundNo - 1) / FAMILY.length);
  const material = buildMaterial(kind, rng, lap);

  return {
    seed,
    rare: superRare || rareRainbow || rareNebula,
    cupStyle,
    profile,
    latheSegments,
    cupHeight,
    cupMaxRadius,
    cupRimRadius,
    cupBottomY: baseHeight,
    handle,
    handleRadius,
    handleTube,
    handleY,
    handleOffsetX,
    baseShape,
    baseTiers,
    baseHeight,
    topper,
    topperScale,
    topperY,
    material,
  };
}
