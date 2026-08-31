"use client";

// チャーム(刺すほど増える、剣にぶら下げる かざり)の引き出しと、獲得の瞬間のお祝い。
//
// ── 絵づくりのねらい: Y2K の「キーチャーム」──────────────────
// クロム(ニッケル)の金具が主役で、そこへ つやのある樹脂のモチーフ(サイコロ・
// きのこ・アヒル)、鏡面のぷっくりハート、つや消しの8ボール、ひものタッセルが
// 長さちがいで束になってぶら下がっている、あの感じ。色数は少なく
// 「銀 + 黒 + 差し色1〜2色」。ぺたっとした単色の図形にすると一気に安く見えるので、
// 13種すべてに次の3つを必ず入れてある:
//   1. 上に小さな銀の丸カン(RingArt)。これがあるだけで「金具に付く部品」に見える
//   2. 素材ごとの陰影(chrome = 白いハイライト帯 / resin = 白い楕円のツヤ /
//      matte = 広くやわらかい光 / glass = 半透明 + 明るいふち / fabric = ひも)
//   3. 差し色 accentHex(サイコロの目・きのこの水玉・8の数字・プレートの文字・
//      アヒルのくちばし)
// 絵文字は12px前後で潰れて泥にしか見えないので使わない。全部インラインSVG。
//
// ── 引き出しとしての役目 ────────────────────────────────
// ここは「集めた記録」ではなく「つけ外しできる引き出し」。
//   **持っている ≠ つけている。** 押すと store.toggleCharm() でつく/外れる。
// 上のプレビュー(SwordRack.tsx の SwordPreview)も剣ラックも同じ
// s.equippedCharms を見ているので、押した瞬間に完成形の剣が変わる。
// 隠しチャーム「ちきゅう」は手に入れるまで DOM ごと存在しない(「?」の空き枠も
// 出さない。枠があるだけで「あと1個ある」と分かってしまい、隠しでなくなる)。

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CHARMS,
  MAX_EQUIPPED_CHARMS,
  charmLevelOf,
  NORMAL_CHARM_COUNT,
  type Charm,
  type CharmMaterial,
  type CharmShape,
} from "@/lib/config";
import { ownedCharms, useGameStore } from "@/game/store";
import { onGameEvent } from "@/game/events";

// ── 色の小道具 ────────────────────────────────────────
// 素材の陰影は「config の hex を白/黒へ寄せて作る」。こうしておくと、
// あとで hex を変えても陰影がひとりでに追従する(色を2重管理しない)。

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0) as RGB;
}
function mix(hex: string, to: RGB, t: number): string {
  const v = toRgb(hex);
  const m = v.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
/** 黒は真っ黒ではなく、すこし青い影にする(金属の影は冷たい) */
const INK: RGB = [12, 15, 26];
const WHITE: RGB = [255, 255, 255];
const lite = (hex: string, t: number) => mix(hex, WHITE, t);
const dim = (hex: string, t: number) => mix(hex, INK, t);
/** ざっくりの明るさ(0..1)。暗い素材のふちを反転するのに使う */
function luma(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 素材ごとの「上から下への光」。objectBoundingBox なので、どの形に貼っても
 * その形の高さに合う。クロムだけは stop が多い ——
 * 「上が明るい(空) → いったん暗い → 白いハイライト帯 → 暗い地平線 → 下で持ち上がる」
 * という段の重なりが、鏡面をいちばん鏡面らしく見せるため。
 */
function matStops(m: CharmMaterial, hex: string): [number, string][] {
  switch (m) {
    case "chrome":
      return [
        [0, lite(hex, 0.9)],
        [0.2, dim(hex, 0.26)],
        [0.36, lite(hex, 1)],
        [0.47, lite(hex, 0.45)],
        [0.6, dim(hex, 0.52)],
        [0.79, lite(hex, 0.4)],
        [1, dim(hex, 0.66)],
      ];
    case "resin":
      return [
        [0, lite(hex, 0.5)],
        [0.28, lite(hex, 0.12)],
        [0.7, hex],
        [1, dim(hex, 0.32)],
      ];
    case "matte":
      return [
        [0, lite(hex, 0.34)],
        [0.4, lite(hex, 0.1)],
        [1, dim(hex, 0.3)],
      ];
    case "glass":
      return [
        [0, lite(hex, 0.66)],
        [0.38, lite(hex, 0.08)],
        [0.74, dim(hex, 0.18)],
        [1, lite(hex, 0.34)],
      ];
    case "fabric":
      return [
        [0, lite(hex, 0.24)],
        [0.5, hex],
        [1, dim(hex, 0.3)],
      ];
  }
}

/**
 * 輪郭の色。8ボールのような真っ黒い素材に濃い輪郭を引くと、暗いトレイの上で
 * シルエットごと消えてしまう。明るさで反転させて、どの地色でも縁が立つようにする。
 */
function edgeOf(hex: string, m: CharmMaterial): string {
  if (luma(hex) < 0.3) return "rgba(255,255,255,.46)";
  return m === "chrome" || m === "glass"
    ? "rgba(20,26,40,.66)"
    : "rgba(34,26,16,.56)";
}

// ── 13種の輪郭(24×24の箱。y は下向き) ────────────────────
// 座標の約束:
//   ・上の y=1.3〜6.1 は丸カンの席。本体はそこへ 0.5 ほど食い込ませて、
//     「輪が通っている」ように見せる(離すと部品がバラバラに浮いて見える)
//   ・本体は x 1.5〜22.6 / y 5.3〜23.0 に収める
//   ・縦横比は形ごとにバラバラでよい。**長さの違うものが束になる**のが
//     キーチャームの可愛さなので、全部を正方形に押し込めない
// 3D(src/game/scene/sword/charmGeometry.ts)と同じ輪郭を使うこと。

type Pt = [number, number];

/** 点列を、24×24の箱の中の長方形へ写す(y を反転して SVG 座標にする) */
function fitD(pts: Pt[], x0: number, y0: number, w: number, h: number): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const kx = w / (maxX - minX || 1);
  const ky = h / (maxY - minY || 1);
  return (
    "M" +
    pts
      .map(
        ([x, y]) =>
          `${(x0 + (x - minX) * kx).toFixed(2)} ${(y0 + (maxY - y) * ky).toFixed(2)}`
      )
      .join("L") +
    "Z"
  );
}

/** 点を1点まわりに回す(サイコロを斜めに吊るのに使う) */
function rotAbout([x, y]: Pt, cx: number, cy: number, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** ほし: 5角星。頂点をひとつ真上に向ける(3Dの starPoints と同じ式) */
function starD(): string {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.47;
    pts.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  return fitD(pts, 4.1, 5.4, 15.8, 15.0);
}

/** サイコロの中心と かたむき。3Dも「まっすぐだと積み木に見える」ので傾けている */
const DICE_CX = 12;
const DICE_CY = 13.4;
const DICE_ROT = -0.2;
const DICE_HALF = 6.7;

/** サイコロ: 角のとれた正方形を、わざと斜めに吊る */
function diceD(): string {
  const r = 2.1;
  const k = DICE_HALF - r;
  const pts: Pt[] = [];
  for (const [cx, cy, a0] of [
    [k, k, 0],
    [-k, k, Math.PI / 2],
    [-k, -k, Math.PI],
    [k, -k, Math.PI * 1.5],
  ] as [number, number, number][]) {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return (
    "M" +
    pts
      .map((p) => {
        const [x, y] = rotAbout(p, 0, 0, DICE_ROT);
        return `${(DICE_CX + x).toFixed(2)} ${(DICE_CY + y).toFixed(2)}`;
      })
      .join("L") +
    "Z"
  );
}

/** サイコロの目(5の面)。本体と同じだけ傾ける */
const DICE_PIPS: Pt[] = (
  [
    [-3.5, -3.5],
    [3.5, -3.5],
    [0, 0],
    [-3.5, 3.5],
    [3.5, 3.5],
  ] as Pt[]
).map((p) => {
  const [x, y] = rotAbout(p, 0, 0, DICE_ROT);
  return [DICE_CX + x, DICE_CY + y];
});

/**
 * つばさの羽根1枚(3D の featherPoints と同じ式)を、24の箱の座標で描く。
 * 付け根がまるく、先がすっと細くなる木の葉。上下で太さが違う(下が0.62倍)。
 */
function featherD(
  rootX: number,
  rootY: number,
  len: number,
  wide: number,
  deg: number
): string {
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const N = 12;
  const top: Pt[] = [];
  const bot: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = wide * Math.sin(Math.PI * t ** 0.62) ** 0.85;
    top.push([t * len, w]);
    bot.push([t * len, -w * 0.62]);
  }
  return (
    "M" +
    [...top, ...bot.reverse()]
      .map(
        ([x, y]) =>
          `${(rootX + x * ca - y * sa).toFixed(2)} ${(rootY + x * sa + y * ca).toFixed(2)}`
      )
      .join("L") +
    "Z"
  );
}

/**
 * つばさ: 1枚板の翼にせず、羽根を5枚あおいで重ねる(3D の buildWing と同じ割りつけ)。
 * 角度も長さも3Dの specs をそのまま写した「右下へ伸びる片翼」。
 * 左右対称の一対にすると天使のマークになってしまい、キーチャームらしさが消える。
 *
 * 2つだけ2D用に変えてある:
 *  ・羽根を1.25倍ふとらせる。3Dの太さのままだと24pxでは線の束にしか見えない
 *  ・カンは付け根ではなく前縁の上に来る(3Dの anchorX は付け根だが、
 *    2Dで同じにすると翼が箱の右半分に寄って小さくなる)
 */
function wingD(): string {
  const rx = 4.6;
  const ry = 7.2;
  const K = 19; // 単位空間 → 24の箱
  const F = 1.25; // 羽根のふとらせ
  const specs: [number, number, number][] = [
    // 長さ, 半幅, 角度(度・下向きが+)。3D の [0.86,0.115,-0.16] … を写したもの
    [0.86 * K, 0.115 * K * F, 9.2],
    [0.8 * K, 0.11 * K * F, 24.1],
    [0.7 * K, 0.1 * K * F, 41.3],
    [0.58 * K, 0.092 * K * F, 58.4],
    [0.44 * K, 0.082 * K * F, 76.8],
  ];
  // 付け根の玉(羽根の根元をまとめる)
  const ball = "M2.7 7.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0Z";
  return specs.map(([l, w, d]) => featherD(rx, ry, l, w, d)).join("") + ball;
}

// ── こすくまくん(全身)──────────────────────────────────
// 300本刺した人がもらう、このゲームの主役チャーム。公式ロゴのおすわりポーズ。
// **太い黒の輪郭線がこのキャラクターの記号**なので、線は塗りのおまけではなく
// 主役として引く(accentsOf で accentHex の線を1本、共通の輪郭線の下に敷く)。
//
// 3D(charmGeometry.ts の buildBear)は、パーツごとに ひとまわり大きい黒の殻を
// 裏返して重ねた「インクアウトライン」で線を出している。つまり
// **手前のパーツに隠れた線は消える**。ここも同じ規則で線を作るので、
// 下の表は 3D と同じ数値・同じ並び順(奥 → 手前)にしておくこと。

/** 単位空間(図の高さ ≒ 1)→ 24の箱。本体が y 5.6〜22.6 に収まる倍率 */
const BEAR_S = 16.4;
const BEAR_CX = 12;
const BEAR_CY = 14.37;

interface BearLobe {
  /** まるい部品(みみ・うで・あし)か、まるい四角(あたま・おなか)か */
  round: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** まるい四角のときだけ: 上半分/下半分の丸みと、上下の広がりの差 */
  pTop?: number;
  pBot?: number;
  taper?: number;
}

/**
 * 奥 → 手前。この並びがそのまま線の重なりになる。
 * 3D で見えている重なりと同じ順(みみ → おなか → あたま → うで・あし)。
 */
const BEAR_LOBES: BearLobe[] = [
  // みみ: あたまの後ろ。あたまの線が耳の内側を横切る
  { round: true, cx: -0.268, cy: 0.4, rx: 0.135, ry: 0.135 },
  { round: true, cx: 0.268, cy: 0.4, rx: 0.135, ry: 0.135 },
  // おなか
  {
    round: false,
    cx: 0,
    cy: -0.235,
    rx: 0.31,
    ry: 0.245,
    pTop: 0.75,
    pBot: 0.45,
    taper: 0.1,
  },
  // あたま + むね。この裾の線が おなかとの境目になる
  {
    round: false,
    cx: 0,
    cy: 0.185,
    rx: 0.315,
    ry: 0.305,
    pTop: 0.85,
    pBot: 0.5,
    taper: 0.03,
  },
  // あし・うで: いちばん手前。輪郭がまるごと体の上に出るので、小さくても
  // 「あし」「うで」だと分かる(ロゴと同じ重なり)
  { round: true, cx: -0.258, cy: -0.442, rx: 0.078, ry: 0.06 },
  { round: true, cx: 0.258, cy: -0.442, rx: 0.078, ry: 0.06 },
  { round: true, cx: -0.3, cy: -0.145, rx: 0.085, ry: 0.068 },
  { round: true, cx: 0.3, cy: -0.145, rx: 0.085, ry: 0.068 },
];

/** かたまり1つの輪郭を、24の箱の点列にする(大きさと中心は呼び出し側が決める) */
function lobePoly(
  l: BearLobe,
  n: number,
  scale: number,
  ox: number,
  oy: number,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    let x: number;
    let y: number;
    if (l.round) {
      x = l.cx + c * l.rx;
      y = l.cy + s * l.ry;
    } else {
      const p = s >= 0 ? (l.pTop ?? 1) : (l.pBot ?? 1);
      x =
        l.cx +
        Math.sign(c) * Math.abs(c) ** p * l.rx * (1 + (l.taper ?? 0) * s);
      y = l.cy + Math.sign(s) * Math.abs(s) ** p * l.ry;
    }
    out.push([ox + x * scale, oy - y * scale]);
  }
  return out;
}

function bearPoly(l: BearLobe, n: number): Pt[] {
  return lobePoly(l, n, BEAR_S, BEAR_CX, BEAR_CY);
}

const BEAR_POLYS = BEAR_LOBES.map((l) => bearPoly(l, l.round ? 24 : 44));

// ── こすくまくん ふたり(ねそべり。300本のごほうび) ──────────────
// 公式ロゴそのままの構図: こちらを向いて寝そべった子の後ろに、
// 背中を向けたもう1匹が重なっている。横長なので、同じ24の箱でも
// おすわり1匹より ぐっと大きく描ける = 粒(9px)でも2匹だと分かる。
//
// **重なりの順(奥 → 手前)がそのまま線の重なり。** 奥の子の輪郭は、
// 手前の子に隠れたぶんだけ消える(3Dのインクアウトラインと同じ規則)。
const LIE_S = 21.3;
const LIE_CX = 12;
const LIE_CY = 14.26;
const LIE_LOBES: BearLobe[] = [
  // 奥の子(背中を向けている): みみ → からだ
  { round: true, cx: 0.423, cy: 0.26, rx: 0.075, ry: 0.075 },
  {
    round: false,
    cx: 0.297,
    cy: -0.017,
    rx: 0.207,
    ry: 0.29,
    pTop: 1,
    pBot: 1,
  },
  // 手前の子: みみ ふたつ → からだ
  { round: true, cx: -0.39, cy: 0.227, rx: 0.1, ry: 0.1 },
  { round: true, cx: 0.017, cy: 0.233, rx: 0.1, ry: 0.1 },
  {
    round: false,
    cx: -0.163,
    cy: 0.017,
    rx: 0.293,
    ry: 0.31,
    pTop: 1,
    pBot: 1,
  },
  // あし: いちばん手前。輪郭がまるごと体の上に出る
  { round: true, cx: 0.13, cy: -0.24, rx: 0.1, ry: 0.075 },
  { round: true, cx: -0.117, cy: -0.247, rx: 0.12, ry: 0.073 },
  { round: true, cx: -0.423, cy: -0.18, rx: 0.057, ry: 0.067 },
];
const LIE_POLYS = LIE_LOBES.map((l) =>
  lobePoly(l, l.round ? 24 : 44, LIE_S, LIE_CX, LIE_CY),
);
const LIE_EYE_R = 0.023 * LIE_S;
const LIE_EYES: Pt[] = [
  [-0.31, -0.15],
  [-0.23, -0.143],
].map(([x, y]) => [LIE_CX + x * LIE_S, LIE_CY - y * LIE_S]);
/** 鼻: 下向きの小さな三角(3Dは3面のコーンを埋めている) */
const LIE_NOSE =
  `M${(LIE_CX - 0.293 * LIE_S).toFixed(2)} ${(LIE_CY + 0.176 * LIE_S).toFixed(2)}` +
  `L${(LIE_CX - 0.249 * LIE_S).toFixed(2)} ${(LIE_CY + 0.176 * LIE_S).toFixed(2)}` +
  `L${(LIE_CX - 0.271 * LIE_S).toFixed(2)} ${(LIE_CY + 0.206 * LIE_S).toFixed(2)}Z`;
/** 奥の子の背中の ほくろ */
const LIE_MOLE: Pt = [LIE_CX + 0.387 * LIE_S, LIE_CY - 0.073 * LIE_S];
const LIE_MOLE_R = 0.032 * LIE_S;

function inPoly(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polyD(pts: Pt[], close: boolean): string {
  return (
    "M" +
    pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") +
    (close ? "Z" : "")
  );
}

/** 塗り: かたまりを全部重ねる(向きをそろえてあるので nonzero で union になる) */
function bearBodyD(): string {
  return BEAR_POLYS.map((p) => polyD(p, true)).join("");
}

function lieBodyD(): string {
  return LIE_POLYS.map((p) => polyD(p, true)).join("");
}

/**
 * 線: 手前のかたまりに隠れていない部分だけを残す。
 * 端は二分探索で詰めて、線が手前のパーツのふちでぴたりと止まるようにする
 * (ここを雑にすると、耳の弧が顔の中へ少しはみ出して にじんで見える)。
 */
function inkD(polys: Pt[][]): string {
  const out: string[] = [];
  polys.forEach((pts, li) => {
    const front = polys.slice(li + 1);
    const n = pts.length;
    const seen = (p: Pt) => !front.some((f) => inPoly(f, p[0], p[1]));
    const vis = pts.map(seen);
    if (vis.every((v) => v)) {
      out.push(polyD(pts, true));
      return;
    }
    const start = vis.findIndex((v, i) => v && !vis[(i - 1 + n) % n]);
    if (start < 0) return; // まるごと隠れている
    const edge = (a: Pt, b: Pt): Pt => {
      let lo = a; // 見えている側
      let hi = b; // 隠れている側
      for (let k = 0; k < 5; k++) {
        const m: Pt = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
        if (seen(m)) lo = m;
        else hi = m;
      }
      return lo;
    };
    let run: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (vis[i]) {
        if (run.length === 0) run.push(edge(pts[i], pts[(i - 1 + n) % n]));
        run.push(pts[i]);
      } else if (run.length > 0) {
        run.push(edge(pts[(i - 1 + n) % n], pts[i]));
        out.push(polyD(run, false));
        run = [];
      }
    }
    if (run.length > 1) out.push(polyD(run, false));
  });
  return out.join("");
}

function bearInkD(): string {
  return inkD(BEAR_POLYS);
}

function lieInkD(): string {
  return inkD(LIE_POLYS);
}

/** 目・口・ほくろ。3D の buildBear と同じ位置(単位空間 → 24の箱) */
const BEAR_EYE_R = 0.027 * BEAR_S;
const BEAR_EYES: Pt[] = [-0.073, 0.073].map((x) => [
  BEAR_CX + x * BEAR_S,
  BEAR_CY - 0.093 * BEAR_S,
]);
/** 口: 逆さの三角のような小さな点(3Dは3面のコーンを下向きに埋めている) */
const BEAR_MOUTH =
  `M${(BEAR_CX - 0.032 * BEAR_S).toFixed(2)} ${(BEAR_CY - 0.063 * BEAR_S).toFixed(2)}` +
  `L${(BEAR_CX + 0.032 * BEAR_S).toFixed(2)} ${(BEAR_CY - 0.063 * BEAR_S).toFixed(2)}` +
  `L${BEAR_CX.toFixed(2)} ${(BEAR_CY - 0.033 * BEAR_S).toFixed(2)}Z`;
const BEAR_MOLE: Pt = [BEAR_CX + 0.188 * BEAR_S, BEAR_CY + 0.325 * BEAR_S];

/**
 * 輪郭線だけ別の形にしたいときの上書き。
 * こすくまくんは「手前のパーツに隠れた線は消える」ので、塗り(union)とは
 * 別に、見えている線だけをつないだ形を持つ。
 */
const STROKE: Partial<Record<CharmShape, string>> = {
  bear: bearInkD(),
  bearlie: lieInkD(),
};

/** ハート: おなじみのハート曲線。ぷっくりさせたいので横に少し広げてある */
function heartD(): string {
  const N = 44;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push([
      16 * Math.sin(t) ** 3,
      13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t),
    ]);
  }
  return fitD(pts, 3.2, 5.4, 17.6, 17.0);
}

/**
 * きのこの軸。傘は赤・軸はクリームなので、塗り分けるために別に持っておく。
 * 3Dの軸は「上より下がすこし太い円柱」なので、こちらも裾を広げてある。
 */
const MUSHROOM_STEM =
  "M14.4 14c.2 2.6.4 5 .6 6.5.1 1.1-1.1 1.9-3 1.9s-3.1-.8-3-1.9" +
  "c.2-1.5.4-3.9.6-6.5Z";

/** かさの白い水玉(3Dの5つと同じ数・同じばらつき) */
const MUSHROOM_DOTS: [number, number, number][] = [
  [8, 10.2, 1.6],
  [14.4, 9.4, 1.85],
  [11.4, 12.4, 1.15],
  [17.6, 12.2, 1.25],
  [5.9, 12.6, 1],
];

/** タッセルの口金(上でひもを締めている筒)。3Dではここがクロム */
const TASSEL_CRIMP =
  "M9.3 6.6c0-1 1.2-1.3 2.7-1.3s2.7.3 2.7 1.3v1.9c0 .9-1.2 1.2-2.7 1.2" +
  "s-2.7-.3-2.7-1.2Z";

/**
 * ひもの束。長さをそろえないのが ふさの可愛さ(3Dの5本と同じ不ぞろい)。
 * 2つ気をつけること:
 *  ・ひもは太めに。1単位まで細くすると輪郭の線で埋まって、束が真っ黒になる
 *  ・裾は広げすぎない。まっすぐな棒が放射状に開くと、ふさではなく三脚に見える。
 *    ゆるく垂れる曲線にして、口金の幅の1.4倍までに収めてある
 */
const TASSEL_CORDS = [
  "M9.3 9.2C9 13 8.6 16.9 8.3 20.5L10.4 20.7C10.7 17 11 13.2 11.4 9.2Z",
  "M10.2 9.2C10.1 13.6 10 18.3 9.9 22.6L12 22.6C12.1 18.3 12.2 13.6 12.3 9.2Z",
  "M11.1 9.2C11.1 12.3 11.2 15.3 11.2 18.3L13.3 18.3C13.3 15.3 13.2 12.3 13.2 9.2Z",
  "M12 9.2C12.3 13 12.6 17.3 12.8 21.2L14.9 20.9C14.6 17.1 14.3 13 14.1 9.2Z",
  "M12.7 9.2C13.2 12.5 13.7 16.2 14.2 19.4L16.2 19C15.7 15.8 15.2 12.3 14.8 9.2Z",
];
/** そのうち差し色で塗る2本(3D も body 3本 / accent 2本) */
const TASSEL_DARK = [1, 4];
/** ひもの先をとめる小さな口金の置き場所(左上の角)。銀にすると三脚の足に見える */
const TASSEL_TIPS: Pt[] = [
  [8.5, 19.7],
  [10.1, 21.8],
  [11.4, 17.4],
  [12.9, 20.4],
  [14.3, 18.6],
];

const BODY: Record<CharmShape, string> = {
  // サイコロ: 角のとれた立方体。目は5(いちばん「サイコロ」に見える面)
  dice: diceD(),
  // エイトボール: まんまるの玉。白丸と数字はあとから乗せる
  eightball: "M3.8 14a8.2 8.2 0 1 0 16.4 0a8.2 8.2 0 1 0-16.4 0Z",
  // きのこ: ドーム状の傘 + 裾の広がった軸。輪郭は1本でつながっている
  mushroom:
    "M3.3 14C3.3 9 7.2 5.5 12 5.5s8.7 3.5 8.7 8.5h-6.3" +
    "c.2 2.6.4 5 .6 6.5.1 1.1-1.1 1.9-3 1.9s-3.1-.8-3-1.9" +
    "c.2-1.5.4-3.9.6-6.5Z",
  // 南京錠: つる(帯状のU字)+ 胴。つるの内側の抜きも1本の輪郭で作る
  padlock:
    "M6.7 11.4a5.3 5.3 0 0 1 10.6 0h-2.1a3.2 3.2 0 0 0-6.4 0Z" +
    "M6.6 11.4h10.8a2.6 2.6 0 0 1 2.6 2.6v5.9a2.6 2.6 0 0 1-2.6 2.6H6.6" +
    "A2.6 2.6 0 0 1 4 19.9V14a2.6 2.6 0 0 1 2.6-2.6Z",
  heart: heartD(),
  // いなずま: 3D の boltPoints と同じ折れ。細くて長いので、房の中で縦に効く
  bolt: fitD(
    [
      [0.15, 0.5],
      [-0.17, 0.05],
      [0.01, 0.05],
      [-0.12, -0.5],
      [0.19, -0.01],
      [0.01, -0.01],
    ],
    7.8,
    5.4,
    8.4,
    17.4
  ),
  wing: wingD(),
  // アヒル: あたま + ずんぐりした体 + くちばし + しっぽ
  duck:
    "M8.6 10a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0-7.6 0Z" +
    "M3.4 17.6a8 4.8 0 1 0 16 0a8 4.8 0 1 0-16 0Z" +
    "M15.6 10.4L20.4 11.6L15.6 13Z" +
    "M5 14.8L1.5 12.6L5.6 18Z",
  star: starD(),
  // ネームプレート: たてに長い犬タグ(3Dも W:H = 0.42:1.3 の細長い板)。
  // 上の穴に丸カンが通る
  plate:
    "M11.3 5.3h1.4a2.8 2.8 0 0 1 2.8 2.8v12a2.8 2.8 0 0 1-2.8 2.8h-1.4" +
    "a2.8 2.8 0 0 1-2.8-2.8v-12a2.8 2.8 0 0 1 2.8-2.8Z",
  // タッセル: 口金 + 5本のひも
  tassel: TASSEL_CRIMP + TASSEL_CORDS.join(""),
  // こすくまくん: 全身(みみ・あたま+むね・うで・おなか・あし)の union
  bear: bearBodyD(),
  // こすくまくん ふたり(ねそべり): 公式ロゴの構図
  bearlie: lieBodyD(),
  // ちきゅう(隠し): 球 + こわれて飛んだ かけら2つ(3Dの buildEarth と同じ約束)
  earth:
    "M3.8 14a8.2 8.2 0 1 0 16.4 0a8.2 8.2 0 1 0-16.4 0Z" +
    "M20.9 8.3L22.5 9.5L21.3 11.1L19.7 9.9Z" +
    "M3.3 20.3L4.7 21.3L3.7 22.7L2.3 21.7Z",
  // ながれぼし: まるい頭 + 左下へ細くなる尾 + ほどけた粒2つ。
  // 尾が細いと「虫めがねの柄」に見えてしまうので、
  // 頭のふちいっぱいの幅から出して先へ細くする
  comet:
    "M12.6 8.4a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0-8.8 0Z" +
    "M13.4 5.6L2.2 15.2L6.0 15.9L13.9 12.1Z" +
    "M4.4 18.9L6.1 20.1L4.9 21.8L3.2 20.6Z" +
    "M8.7 20.5L9.9 21.4L9.0 22.6L7.8 21.7Z",
  // ロケット: とがった機首 → 胴 → 左右のフィン → ノズル。輪郭は1本
  rocket:
    "M12 2.3c2.7 2.4 4.1 5.8 4.1 9.5v3.4l2.6 3.3v2.6l-3.4-2.3" +
    "l-.4 1.9h-5.8l-.4-1.9l-3.4 2.3v-2.6l2.6-3.3v-3.4" +
    "C7.9 8.1 9.3 4.7 12 2.3Z",
  // えいせい: 箱の本体 + 左右のパネル + アンテナ。
  // 3Dはパネルが横に張り出した形なので、2Dも箱を短くパネルを大きくとる
  satellite:
    "M9.6 9.2h4.8v7.6H9.6Z" +
    "M1.2 10.2h6.6v5.6H1.2Z" +
    "M16.2 10.2h6.6v5.6h-6.6Z" +
    "M11.6 6.6h0.8v2.6h-0.8Z" +
    "M10.2 5.4h3.6v1.4h-3.6Z",
  // ユーフォー: ドーム + 上下のあるレンズ形の円盤。
  // 光の脚は3Dに無いので出さない(シルエットが別物になってしまう)
  ufo:
    "M8.1 9.4a3.9 3.9 0 0 1 7.8 0Z" +
    "M2.6 12.9c0-2.5 4.2-4.3 9.4-4.3s9.4 1.8 9.4 4.3" +
    "s-4.2 4.3-9.4 4.3s-9.4-1.8-9.4-4.3Z",
};

/**
 * 24×24 の箱いっぱいに収めた本体の輪郭(丸カンは含まない)。
 * 剣にぶら下がる粒(SwordArt)も、まだ持っていないチャームの影も同じ形を使うので
 * 公開している(別々に描くと、棚のチャームと剣のチャームが違う形になってしまう)。
 */
export function charmPath(shape: CharmShape): string {
  return BODY[shape] ?? BODY.dice;
}

// ── 部品 ──────────────────────────────────────────────

/** 丸カン。これがあるだけで「キーホルダーの部品」に見える */
function RingArt({ ghost }: { ghost?: boolean }) {
  return (
    <g>
      <circle
        cx="12"
        cy="3.4"
        r="2.05"
        fill="none"
        stroke={ghost ? "rgba(255,255,255,.3)" : "#6d7686"}
        strokeWidth="1.5"
      />
      {!ghost && (
        /* 左上だけに走る白い弧。丸カンが「磨いた金属の輪」に見える最小の一手 */
        <path
          d="M10.14 2.53A2.05 2.05 0 0 1 11.47 1.42"
          fill="none"
          stroke="#f4f7fd"
          strokeWidth="0.75"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

/** 素材ごとの光。本体の輪郭でクリップしてから重ねる */
function sheenOf(m: CharmMaterial, d: string): ReactNode {
  switch (m) {
    case "chrome":
      // 鏡面は「空を映した上半分」「地面を映した下半分」「その境目の白い帯」。
      // 3つそろってはじめてクロムに見える(1つ欠けるとただの灰色になる)
      return (
        <>
          <rect x="0" y="12.2" width="24" height="1.6" fill="rgba(255,255,255,.5)" />
          <ellipse
            cx="8.6"
            cy="9.2"
            rx="6"
            ry="3.1"
            fill="rgba(255,255,255,.5)"
            transform="rotate(-22 8.6 9.2)"
          />
          <ellipse
            cx="15.6"
            cy="20"
            rx="7"
            ry="3.4"
            fill="rgba(10,14,26,.26)"
            transform="rotate(-13 15.6 20)"
          />
        </>
      );
    case "resin":
      // つやのある樹脂は、小さくて濃い白の楕円がひとつあれば「ぬれた」感じになる
      return (
        <ellipse
          cx="9"
          cy="9.4"
          rx="3.5"
          ry="2.2"
          fill="rgba(255,255,255,.8)"
          transform="rotate(-30 9 9.4)"
        />
      );
    case "matte":
      // つや消しは広くてぼんやりした光だけ。強い点を置くとゴム感が消える
      return (
        <ellipse cx="9.6" cy="10" rx="5.4" ry="3.6" fill="rgba(255,255,255,.13)" />
      );
    case "glass":
      return (
        <>
          {/* 透ける樹脂は「ふちが明るく、中が抜ける」。内側から縁を光らせる */}
          <path
            d={d}
            fill="none"
            stroke="rgba(255,255,255,.5)"
            strokeWidth="1.8"
          />
          <ellipse
            cx="8.8"
            cy="9.4"
            rx="3.4"
            ry="2.3"
            fill="rgba(255,255,255,.72)"
            transform="rotate(-28 8.8 9.4)"
          />
        </>
      );
    case "fabric":
      // ひもは金属光沢を持たない。上のほうがすこし明るいだけ
      return <rect x="0" y="4" width="24" height="5.4" fill="rgba(255,255,255,.2)" />;
  }
}

/**
 * 形ごとの差し色とディテール。
 * detail=false は「剣にぶら下がる粒」用(9px前後)。そこでは1px未満になる
 * 数字・目・水玉を落とし、大きな塗り分けだけ残す。
 */
function accentsOf(c: Charm, detail: boolean, clip: string): ReactNode {
  const ac = c.accentHex ?? dim(c.hex, 0.62);
  switch (c.shape) {
    case "dice":
      return detail ? (
        <g fill={ac}>
          {DICE_PIPS.map(([x, y]) => (
            <circle
              key={`${x}-${y}`}
              cx={x.toFixed(2)}
              cy={y.toFixed(2)}
              r="1.2"
            />
          ))}
        </g>
      ) : null;

    case "eightball":
      return (
        <>
          <circle cx="12.4" cy="12.6" r="3.5" fill={ac} />
          {detail && (
            <text
              x="12.4"
              y="14.6"
              textAnchor="middle"
              textLength="3.4"
              lengthAdjust="spacingAndGlyphs"
              fontSize="5.6"
              fontWeight="800"
              fill={c.hex}
              style={{ fontFamily: "var(--font-game)" }}
            >
              8
            </text>
          )}
        </>
      );

    case "mushroom":
      return (
        <>
          <path d={MUSHROOM_STEM} fill={ac} />
          {/* 傘の落ち影。軸がのっぺりした白い棒に見えるのを防ぐ */}
          <path
            d={MUSHROOM_STEM}
            fill="none"
            stroke="rgba(120,40,30,.22)"
            strokeWidth="1.6"
            clipPath={`url(#${clip})`}
          />
          {detail && (
            <g fill={ac}>
              {MUSHROOM_DOTS.map(([x, y, r]) => (
                <ellipse
                  key={`${x}-${y}`}
                  cx={x}
                  cy={y}
                  rx={r}
                  ry={r * 0.88}
                />
              ))}
            </g>
          )}
        </>
      );

    case "padlock":
      return detail ? (
        <g fill={dim(c.hex, 0.72)}>
          <circle cx="12" cy="16.2" r="1.5" />
          <path d="M11 17.2h2l.6 3.3h-3.2Z" />
        </g>
      ) : null;

    case "heart":
      // 鏡面ハートの見せ場は、まんなかを横切る強い反射。ここだけは粒でも残す
      return (
        <path
          d="M6.2 12.6c2.6 1.5 9 1.5 11.6 0"
          fill="none"
          stroke="rgba(255,255,255,.85)"
          strokeWidth="1.5"
          strokeLinecap="round"
          clipPath={`url(#${clip})`}
        />
      );

    case "wing":
      // 羽根の重なりは輪郭の線そのものが描いてくれる(BODY が5枚の別々の輪郭)。
      // ここで羽軸まで足すと、24pxでは線だらけになって銀の面が消える
      return null;

    case "duck":
      return (
        <>
          <path d="M15.6 10.4L20.4 11.6L15.6 13Z" fill={ac} />
          {detail && (
            <>
              <circle cx="13.5" cy="9.4" r="1.05" fill="#2b2620" />
              <circle cx="13.15" cy="9.05" r="0.34" fill="#fff" />
              <path
                d="M8.4 17.4c1.8-1.5 4.4-1.6 6 .2"
                fill="none"
                stroke="rgba(150,90,10,.4)"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
            </>
          )}
        </>
      );

    case "plate":
      return (
        <>
          {detail && (
            <>
              <circle cx="12" cy="8.4" r="1.05" fill={dim(c.hex, 0.76)} />
              {/* 彫られた文字。3Dも同じ "LUCKY" を横に寝かせて縦に並べている
                  (危機一髪 = lucky のしゃれ)。textLength で幅を固定するので、
                  フォントが何であってもプレートからはみ出さない */}
              <text
                transform="rotate(90 12 16)"
                x="12"
                y="17.6"
                textAnchor="middle"
                textLength="11.2"
                lengthAdjust="spacingAndGlyphs"
                fontSize="4.4"
                fontWeight="800"
                fill={ac}
                style={{ fontFamily: "var(--font-game)" }}
              >
                LUCKY
              </text>
            </>
          )}
        </>
      );

    case "tassel":
      return (
        <>
          {/* 差し色のひも2本。3Dも body 3本 / accent 2本で、束に濃淡を作る */}
          <g fill={ac}>
            {TASSEL_DARK.map((i) => (
              <path key={i} d={TASSEL_CORDS[i]} />
            ))}
          </g>
          {/* 口金は3Dではクロム。ここだけ銀に塗り替えて金具を1つ足す */}
          <path d={TASSEL_CRIMP} fill="#b8c0ce" />
          <path
            d={TASSEL_CRIMP}
            fill="none"
            stroke="rgba(255,255,255,.75)"
            strokeWidth="0.7"
            clipPath={`url(#${clip})`}
          />
          {detail && (
            <>
              {/* 巻きのしま(参考写真の白黒のひもそのもの) */}
              <g fill={ac} clipPath={`url(#${clip})`} opacity="0.7">
                <path d="M9 6.8L15 5.9V6.9L9 7.8Z" />
                <path d="M9 8.6L15 7.7V8.7L9 9.6Z" />
              </g>
              {/* ひもの先をとめる小さな口金。銀にすると三脚の足に見えるので、
                  ひもと同じ濃さの布のとめ具にとどめる */}
              <g fill={ac} opacity="0.55">
                {TASSEL_TIPS.map(([x, y]) => (
                  <rect
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    width="1.9"
                    height="1.2"
                    rx="0.4"
                  />
                ))}
              </g>
            </>
          )}
        </>
      );

    case "bear":
      return (
        <>
          {/* 太い黒の輪郭線。このキャラクターの記号なので、**粒(9px)でも描く**。
              上に重なる共通の輪郭線(半透明)と同じ形・同じ太さなので、2本が
              ぴたりと重なって、ロゴの太い線と同じ濃さになる */}
          <path
            d={STROKE.bear}
            fill="none"
            stroke={ac}
            strokeWidth="0.95"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 目・口・ほくろは 24px の絵でも1px弱。粒では落とす(LOD) */}
          {detail && (
            <g fill={ac}>
              {BEAR_EYES.map(([x, y]) => (
                <circle
                  key={x}
                  cx={x.toFixed(2)}
                  cy={y.toFixed(2)}
                  r={BEAR_EYE_R.toFixed(2)}
                />
              ))}
              <path d={BEAR_MOUTH} />
              <circle
                cx={BEAR_MOLE[0].toFixed(2)}
                cy={BEAR_MOLE[1].toFixed(2)}
                r={(0.026 * BEAR_S).toFixed(2)}
              />
            </g>
          )}
        </>
      );

    case "bearlie":
      return (
        <>
          {/* 太い黒の輪郭線。このキャラクターの記号なので、**粒(9px)でも描く** */}
          <path
            d={STROKE.bearlie}
            fill="none"
            stroke={ac}
            strokeWidth="0.85"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 目・鼻・ほくろは 24px でも1px弱。粒では落とす(LOD) */}
          {detail && (
            <g fill={ac}>
              {LIE_EYES.map(([x, y]) => (
                <circle
                  key={x}
                  cx={x.toFixed(2)}
                  cy={y.toFixed(2)}
                  r={LIE_EYE_R.toFixed(2)}
                />
              ))}
              <path d={LIE_NOSE} />
              <circle
                cx={LIE_MOLE[0].toFixed(2)}
                cy={LIE_MOLE[1].toFixed(2)}
                r={LIE_MOLE_R.toFixed(2)}
              />
            </g>
          )}
        </>
      );

    case "earth":
      return (
        <>
          <g fill={ac} clipPath={`url(#${clip})`}>
            <path d="M8.2 9.6c1.7-1 3.6-.7 4.2.5.6 1.1-.3 2.4-1.8 3-1.6.7-3.3.3-3.8-.8-.4-1 .2-2.1 1.4-2.7Z" />
            <path d="M13.6 14.4c2-.4 3.5.4 3.5 1.8 0 1.4-1.6 2.6-3.5 2.6-1.6 0-2.8-.9-2.6-2 .1-1.2 1.1-2.1 2.6-2.4Z" />
            <path d="M6.3 16.3c1.2-.2 2.1.4 2 1.3-.1.9-1.1 1.7-2.2 1.7-.9 0-1.5-.6-1.4-1.4.1-.8.7-1.4 1.6-1.6Z" />
          </g>
          {detail && (
            /* こわした証のひび(3Dの crackGeometry と同じ「正面を走る稲妻」) */
            <path
              d="M10.6 6.4L12.6 9.6L10.8 11.8L13.2 15.2L11.8 17.6L13.2 21.3"
              fill="none"
              stroke="rgba(10,20,40,.62)"
              strokeWidth="0.85"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clip})`}
            />
          )}
        </>
      );

    default:
      return null;
  }
}

/**
 * 24×24 の箱に描いた1個ぶんのチャーム(svg要素の中身だけ)。
 * 剣にぶら下がる粒(SwordArt)も棚もこれを呼ぶので、両方の絵が絶対にずれない。
 *
 * @param detail false = 粒サイズ(9px前後)。1px未満になる細部を落とす
 * @param ring   false = 丸カンを描かない(剣の房は房ぜんぶで1つの輪を持っている)
 */
export function CharmGlyph({
  index,
  detail = true,
  ring = true,
}: {
  index: number;
  detail?: boolean;
  ring?: boolean;
}) {
  // 同じページに何十個も並ぶので、グラデーションのidは実体ごとに固有にする。
  // useId の ":" は url(#..) 参照で嫌われることがあるので英数字だけに落とす
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const c = CHARMS[index];
  if (!c) return null;
  const d = charmPath(c.shape);
  const gid = `cgm${uid}`;
  const cid = `ccl${uid}`;
  return (
    <g>
      <defs>
        {/* 少しだけ斜めに流す。真上から真下だと「印刷の色帯」に見えてしまう */}
        <linearGradient id={gid} x1="0" y1="0" x2="0.16" y2="1">
          {matStops(c.material, c.hex).map(([o, col]) => (
            <stop key={o} offset={o} stopColor={col} />
          ))}
        </linearGradient>
        <clipPath id={cid}>
          <path d={d} />
        </clipPath>
      </defs>
      {ring && <RingArt />}
      <path d={d} fill={`url(#${gid})`} fillOpacity={c.material === "glass" ? 0.9 : 1} />
      <g clipPath={`url(#${cid})`}>{sheenOf(c.material, d)}</g>
      {accentsOf(c, detail, cid)}
      {/* 輪郭はいちばん上。差し色やツヤに食われず、小さくても形が読める。
          布(ひも)だけ細く: 1単位ほどの細いひもに 0.95 の線を引くと、
          ひもが線で埋まって束ぜんぶが真っ黒になってしまう */}
      <path
        d={STROKE[c.shape] ?? d}
        fill="none"
        stroke={edgeOf(c.hex, c.material)}
        strokeWidth={
          c.material === "chrome" ? 1 : c.material === "fabric" ? 0.7 : 0.95
        }
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
}

// ── 表示部品 ────────────────────────────────────────────
interface CharmIconProps {
  /** CHARMS の index */
  index: number;
  /** 一辺(px) */
  size?: number;
  /** まだ持っていない表示(形だけのシルエット) */
  ghost?: boolean;
  className?: string;
}

/**
 * 未獲得のチャームに出す「?」。実物の形を出すと何がもらえるか先に分かって
 * しまうので、伏せ字にする。**影(彫り)も ? の形**にしたいので、明るいふちを
 * 太く敷いた上に暗い本体を重ねて、台に彫られたように見せる
 * (獲得済みチャームの彫りと同じ、白40%のふち + 黒の本体)。
 */
function QuestionArt() {
  // 他のチャームと同じ高さ(24四方のうち y=7〜21)に収まる大きさ
  const hook = "M8.6 11 A3.4 3.4 0 1 1 12.6 13.6 L12 15.4 L12 16.9";
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={hook} stroke="rgba(255,255,255,.4)" strokeWidth="4.6" />
      <circle cx="12" cy="19.5" r="2" fill="rgba(255,255,255,.4)" />
      <path d={hook} stroke="rgba(0,0,0,.55)" strokeWidth="3" />
      <circle cx="12" cy="19.5" r="1.2" fill="rgba(0,0,0,.55)" />
    </g>
  );
}

export function CharmIcon({ index, size = 28, ghost, className }: CharmIconProps) {
  const c = CHARMS[index];
  if (!c) return null;
  return (
    <svg
      className={className ? `kk-charm-svg ${className}` : "kk-charm-svg"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {ghost ? (
        /* 未獲得は「?」。実物の形を出すと、何がもらえるか先に分かってしまって
           手に入れたときの驚きが消える。**影(彫り)も ? の形**にする。
           丸カンも同じ彫りで置いて、獲得済みと縦の位置がずれないようにする */
        <>
          <RingArt ghost />
          <QuestionArt />
        </>
      ) : (
        <CharmGlyph index={index} />
      )}
    </svg>
  );
}

/**
 * チャームの引き出し。持っているものを押すと つく/外れる。
 *
 * ── 見せかたの決めごと ──
 * ・ついている  : 受け皿が明るく灯り、コーラルのふちが付く(選択色と同じ意味)
 * ・外している  : くぼみに戻るが、色は残す(「持ってはいる」を消さない)
 * ・持っていない: くぼみに沈んだ影だけ。押せない
 * この3段が、明るさの順にきれいに並ぶのが大事。逆にすると、がんばって集めた
 * ものがいちばん目立たない棚になってしまう。
 *
 * ── 隠しチャームの扱い ──
 * 隠し(secret)のチャームは **手に入れるまで棚に一切出さない**。
 * 「?」の空き枠すら置かない: 枠があるだけで「あと1個ある」と分かってしまい、
 * 隠しではなくなるから。あつめた数の分母も NORMAL_CHARM_COUNT(=12)のままにして、
 * 12個そろった人には「ぜんぶ あつめた！」と言い切る。
 */
export function CharmShelf() {
  const myTotal = useGameStore((s) => s.myTotal);
  const hasEarth = useGameStore((s) => s.hasEarthCharm);
  const caughtSky = useGameStore((s) => s.caughtSky);
  const hasPoke = useGameStore((s) => s.hasPokeCharm);
  const equipped = useGameStore((s) => s.equippedCharms);
  const toggleCharm = useGameStore((s) => s.toggleCharm);
  const level = charmLevelOf(myTotal);

  const owned = useMemo(
    () => ownedCharms(myTotal, hasEarth, caughtSky, hasPoke),
    [myTotal, hasEarth, caughtSky, hasPoke]
  );
  // store の equippedCharms は端末に残るので、持っていないものが混じることが
  // ありうる(?charm= で見せた状態のあと、など)。表示は必ず「持っている」と交差させる
  const on = useMemo(() => {
    const has = new Set(owned);
    return new Set(equipped.filter((i) => has.has(i)));
  }, [equipped, owned]);
  // 上限があるので「ぜんぶ」は "つけられるだけ つけた" の意味になる
  const canWear = Math.min(owned.length, MAX_EQUIPPED_CHARMS);
  const allOn = owned.length > 0 && on.size >= canWear;

  // 一括のつけ外し。store に一括アクションが無いので順に押すが、同時に12回
  // 鳴らすと「バチッ」と割れるので少しずつずらす。見た目も順に灯って気持ちいい
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const t = timers;
    return () => {
      t.current.forEach(clearTimeout);
      t.current = [];
    };
  }, []);
  const setAll = (want: boolean) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    // つけるときは古い順(房の上から)、外すときは新しい順(房の下から)。
    // 上限があるので、つけるのは**新しい方から** MAX_EQUIPPED_CHARMS 個
    // (手に入れたばかりのものが上限で締め出されるのがいちばん がっかりする)
    const list = want
      ? owned.slice(-MAX_EQUIPPED_CHARMS)
      : [...owned].reverse();
    list.forEach((i, k) => {
      const run = () => {
        const s = useGameStore.getState();
        // 実行のたびに現在の状態を見るので、連打されても行き先は狂わない
        if (s.equippedCharms.includes(i) !== want) s.toggleCharm(i);
      };
      if (k === 0) run();
      else timers.current.push(setTimeout(run, k * 26));
    });
  };

  // 隠しは持っている人にしか存在しない。持っていない人の棚は12枠ちょうど。
  // CHARMS の index はアイコンの参照に要るので、絞り込んでも持ち歩く
  // 隠しチャームも最初から枠を出す。ただし中身は「?」のまま、
  // 何本刺せばもらえるかも出さない(条件は教えない)ので、伏せたままになる
  const slots = CHARMS.map((c, i) => ({ c, i }));
  // CHARMS[level] をそのまま使うと、12個そろった人に隠しチャームの名前と
  // 条件(Infinity本)が「つぎは…」として出てしまう。ここで必ず止める
  const next = level < NORMAL_CHARM_COUNT ? CHARMS[level] : undefined;
  const prevNeed = level > 0 ? CHARMS[level - 1].need : 0;
  const span = next ? next.need - prevNeed : 1;
  const pct = next
    ? Math.max(0, Math.min(1, (myTotal - prevNeed) / span)) * 100
    : 100;
  const remain = next ? Math.max(1, next.need - myTotal) : 0;

  return (
    <div className="kk-charms">
      <div className="kk-charms-head">
        <span className="kk-sec-label kk-label-charm">チャーム</span>
        {/* 分母は「同時につけられる数」。あつめた数は下の進捗の行が言うので、
            ここは つけ外しの手ごたえ(あと何個つけられるか)に絞る */}
        <span className="kk-charms-count">
          <b>{on.size}</b>/{MAX_EQUIPPED_CHARMS} こ ついてる
        </span>
        {owned.length > 0 && (
          <button
            type="button"
            className="kk-charms-all"
            onClick={() => setAll(!allOn)}
          >
            {allOn
              ? "ぜんぶ はずす"
              : owned.length > MAX_EQUIPPED_CHARMS
                ? `${MAX_EQUIPPED_CHARMS}こ つける`
                : "ぜんぶ つける"}
          </button>
        )}
      </div>

      {/* 13個になったら1行7枠にする。3行目を作ると棚が縦に伸びて、
          引き出しの中で下の進捗バーが押し出されてしまうため */}
      {/* 枠は隠しぶんを入れて常に13個なので、列数もつねに7(=7×2行)。
          6列だと13個目だけが3行目に取り残されて、引き出しからあふれる */}
      <ul className="kk-charms-grid wide">
        {slots.map(({ c, i }) => {
          const got = owned.includes(i);
          const isOn = got && on.has(i);
          const isNext = !c.secret && i === level;
          const cell = (
            <>
              <span className="kk-charm-cell">
                <CharmIcon
                  index={i}
                  size={got ? 24 : 20}
                  ghost={!got}
                />
              </span>
              <span className="kk-charm-need">
                {got
                  ? isOn
                    ? "ついてる"
                    : "はずした"
                  : /* 隠しは必要本数が無い(刺しては手に入らない)ので ? のまま */
                    c.secret
                    ? "？"
                    : c.need}
              </span>
            </>
          );
          return (
            <li
              key={c.name}
              className={
                `kk-charm-slot${got ? " got" : ""}` +
                `${got ? (isOn ? " on" : " off") : ""}` +
                `${isNext ? " next" : ""}${c.secret ? " secret" : ""}`
              }
            >
              {got ? (
                <button
                  type="button"
                  className="kk-charm-btn"
                  aria-pressed={isOn}
                  aria-label={`${c.name} ${isOn ? "ついてる" : "はずしてる"}`}
                  onClick={() => toggleCharm(i)}
                >
                  {cell}
                </button>
              ) : (
                <span
                  className="kk-charm-btn"
                  role="img"
                  /* 隠しだけは条件を書かない(書いた瞬間に隠しでなくなる)が、
                     そもそも持っていない隠しはこの一覧に来ない */
                  aria-label={`${c.name} ${c.need}本で もらえる`}
                >
                  {cell}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="kk-charms-next">
        {next ? (
          <>
            {/* 何がもらえるかは言わない(棚も「?」なので、ここで名前を出すと
                伏せている意味がなくなる)。本数だけ伝えて、中身は開けてのお楽しみ */}
            <p className="kk-charms-line">
              <CharmIcon index={level} size={18} className="kk-charms-line-ico" ghost />
              つぎは <b>{next.need}本</b>で ？がもらえる！ <em>あと{remain}本！</em>
            </p>
            <div className="kk-charms-bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="kk-charms-line kk-charms-done">
            {/* 13個目の枠が「?」で残っているのに「ぜんぶ」と言うと嘘になる。
                手に入れかたは教えないまま、まだ何かあることだけ匂わせる */}
            {hasEarth
              ? "ぜんぶ あつめた！ すごい！ 🎉"
              : "12こ あつめた！ ……まだ あるみたい？"}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * チャームを手に入れた瞬間のお祝い。数秒でひとりでに消える。
 * 隠しチャームのときは、通常の獲得とはっきり別物に見せる:
 *  ・見出しを「！？」にして、なにが起きたか一瞬わからなくする
 *  ・光を金から白へ、輪を二重に、粒をひとまわり大きく
 *  ・表示時間を長くして、じっくり「なにこれ」と眺めさせる
 */
export function CharmGet() {
  const clearNewCharm = useGameStore((s) => s.clearNewCharm);
  const [shown, setShown] = useState<{ id: number; index: number } | null>(null);

  // 音("charm-get")と同時に出したいのでイベント購読で起動する。
  // newCharm は store が先に立てているので、そのときの値を読めばよい。
  useEffect(
    () =>
      onGameEvent((t) => {
        if (t !== "charm-get") return;
        const i = useGameStore.getState().newCharm;
        if (i === null) return;
        setShown({ id: Date.now(), index: i });
      }),
    []
  );

  const secret = shown !== null && !!CHARMS[shown.index]?.secret;

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(
      () => {
        setShown(null);
        clearNewCharm(); // 演出しきったので store を片付ける
      },
      secret ? 4400 : 2900
    );
    return () => clearTimeout(timer);
  }, [shown, secret, clearNewCharm]);

  if (!shown) return null;
  const c = CHARMS[shown.index];
  if (!c) return null;

  return (
    <div
      className={`kk-charmget${secret ? " secret" : ""}`}
      role="status"
      key={shown.id}
    >
      <div className="kk-charmget-in">
        <div className="kk-charmget-rays" aria-hidden="true" />
        <div className="kk-charmget-ring" aria-hidden="true" />
        {secret && <div className="kk-charmget-ring2" aria-hidden="true" />}
        <CharmIcon
          index={shown.index}
          size={secret ? 98 : 78}
          className="kk-charmget-disc"
        />
        <div className="kk-charmget-title">
          {secret ? "！？" : "チャーム ゲット！"}
        </div>
        <div className="kk-charmget-name">
          {secret ? `ひみつの チャーム 「${c.name}」` : c.name}
        </div>
        {secret && (
          <div className="kk-charmget-note">だれにも ないしょだよ…</div>
        )}
      </div>
    </div>
  );
}

/** 授与式などで「1個ぶん」を見せるとき用(サイズ指定つきの薄い包み) */
export function CharmDisc({
  index,
  size = 30,
}: {
  index: number;
  size?: number;
}) {
  const style = { "--kk-charm-d": `${size}px` } as CSSProperties;
  return (
    <span className="kk-disc" style={style} aria-hidden="true">
      <CharmIcon index={index} size={size} />
    </span>
  );
}
