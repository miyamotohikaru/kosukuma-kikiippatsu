"use client";

// 黒ひげ危機一発の「1色成型のプラスチック剣」をインラインSVGで描く共通部品。
// 画像アセットを増やせない制約があるので、剣もチャームのビーズも全部ベクタで作る。
//
// ── 形の正は 3D(src/game/scene/sword/buildSword.ts)。ここはその2D版 ──
// UIの剣と3Dの剣が別物だと「ネジを選んだのに短剣が刺さる」不一致になる。
// なので座標を手で置くのをやめ、3Dが公式パーツ写真(**回転補正ずみ**)から
// 出した比率をそのまま組み立てて形を作る。写真の剣は24〜29°傾いて置かれて
// いるので、軸平行のバウンディングボックスで測ると幅が水増しされる。
// ここの数値は補正後の値なので、写真を測り直して上書きしないこと。
//
//   刃の幅 / 刃の長さ       0.385  (3D: BLADE_HALF_W = BLADE_LEN * 0.385 / 2)
//   鍔の長さ / 刃の最大幅   2.10   (3D: GUARD_HALF_L = BLADE_HALF_W * 2.1)
//   刃 / 剣全体             0.534  (3D: BLADE_LEN / (BLADE_LEN + HILT_H))
//   握り幅 / 刃の最大幅     1.10   (3D: GRIP_HALF_W = BLADE_HALF_W * 1.1)
//   柄頭幅 / 握り幅         1.25
//   握り板 縦÷横           1.30   (3Dの1.108より縦長。実物はこの比)
//   刃の最大幅の位置        鍔ぎわ(単調増加。途中に山を作らない)
//
// ── 9倍に拡大したとき「冠ナット付きのネジ」に見えていた4つの原因と対処 ──
//  1. 桟5本 + 溝4本 = 25単位の握りに等間隔9本の横縞 → ねじ山。
//     溝はシルエットの切り欠き(3Dの makeGrip と同じ5か所)へ戻し、
//     塗りだけの溝(旧 GROOVE_Y)は廃止。塗りは切り欠きの中を弱く沈めるだけ。
//  2. 柄頭が「離れた小さな粒3つ + 丸棒」= 王冠/城の狭間。
//     3Dどおり握りの下でいったんくびれ(握り幅の0.8倍)、そこから開く。
//     粒は半径を柄頭半幅の0.37倍まで大きくして互いに重ねる(峰が繋がる)。
//  3. 鍔のバーが細く両端の丸しか出ない = ネジの耳。
//     バーは握りの1.80倍の長さにして、丸いボスはその端の膨らみにする。
//  4. 鍔の下の刃が1/3ほど平行 = 口紅のケース。
//     3Dの BLADE_PROFILE をそのまま写して、剣先から鍔まで単調に太らせる。
//
// 向きは「ラックに挿さっている姿」= 柄頭が上・剣先が下。
// 陰影は「白と黒の半透明を重ねる」だけなので、どの hex が来ても破綻しない
// (SWORD_COLORS の彩度を上げても、色計算を持たないぶん勝手に馴染む)。

import { useId } from "react";
import { CHARMS, SWORD_COLORS, SWORD_SKINS } from "@/lib/config";
import { charmIndicesFrom } from "@/lib/style";
import { CharmGlyph } from "./CharmShelf";

// ── 寸法(全部いちど比率から組み立てる) ────────────────────────
/** 剣の座標系。鍔の張り出し 41.4 が入る幅 */
const VB_W = 44;
const VB_H = 102;
const CX = VB_W / 2;

/** 剣の全長(柄頭のてっぺん〜剣先) */
const TOTAL = 96;
const TOP_Y = 3;

/**
 * 輪郭(stroke)はパスの外へ半分はみ出す。比率を測られるのは「塗り上がりの
 * シルエット」なので、パスの寸法からこのぶんを先に差し引いておく。
 * 引かないと9倍に拡大して測ったとき刃が4〜8%太って出る。
 * 3D側も同じ考えで、面取りのぶんを輪郭から引いている(BLADE_BEVEL)。
 */
const EDGE_NOMINAL = 1.1;

const BLADE_LEN = TOTAL * 0.534; // 51.264
const HILT_H = TOTAL - BLADE_LEN; // 44.736

/** ここが「実測される」寸法(輪郭を塗ったあとの幅) */
const BLADE_W_ART = BLADE_LEN * 0.385; // 19.737 = 刃の最大幅(鍔ぎわ)
const GUARD_L_ART = BLADE_W_ART * 2.1; // 41.447
const GRIP_W_ART = BLADE_W_ART * 1.1; // 21.710
const POMMEL_W_ART = GRIP_W_ART * 1.25; // 27.138

/** パスに与える寸法 = 実測される寸法 − 輪郭 */
const BLADE_HW = (BLADE_W_ART - EDGE_NOMINAL) / 2;
const GUARD_HL = (GUARD_L_ART - EDGE_NOMINAL) / 2;
const GRIP_HW = (GRIP_W_ART - EDGE_NOMINAL) / 2;
const POMMEL_HW = (POMMEL_W_ART - EDGE_NOMINAL) / 2;

/** 柄の内訳。3Dと同じく鍔は柄の18.5%。残りを握り(縦横比1.30)と柄頭で分ける。
 *  握りは上下を柄頭と鍔に食われるので、そのぶん(輪郭の半分×2)を足しておく */
const GRIP_H = GRIP_W_ART * 1.3 + EDGE_NOMINAL * 0.55; // 28.83
const GUARD_H = HILT_H * 0.185; // 8.276
const POMMEL_H = HILT_H - GUARD_H - GRIP_H; // 7.63

/** 上から: 柄頭 → 握り → 鍔 → 刃 */
const GRIP_TOP = TOP_Y + POMMEL_H; // 11.24 = 柄頭のくびれ
const GUARD_TOP = GRIP_TOP + GRIP_H; // 39.46
const GUARD_BOT = GUARD_TOP + GUARD_H; // 47.74 = 刃のはじまり
const TIP_Y = GUARD_BOT + BLADE_LEN; // 99.00 = 剣先
const GUARD_CY = GUARD_TOP + GUARD_H / 2;

/** 鍔: 細長いバーの両端に丸いボス(3D makeGuard と同じ組み立て) */
const BOSS_R = GUARD_H / 2;
const BAR_HH = BOSS_R * 0.7; // 中央のバーはボスより細い
const BOSS_DX = GUARD_HL - BOSS_R;
const BAR_HL = BOSS_DX + Math.sqrt(BOSS_R * BOSS_R - BAR_HH * BAR_HH); // 19.54

/** 柄頭: くびれ(握りの0.8倍)から開く三つ葉。粒は重なる大きさにする */
const LOBE_R = POMMEL_HW * 0.37; // 5.02(粒どうしが1.49ぶん重なる)
const LOBE_DX = POMMEL_HW - LOBE_R;
const WAIST_HW = GRIP_HW * 0.8;

/** はしごの割りつけ(3D gripLadder と同じ式)。桟6・切り欠き5 */
const LADDER_N = 5;
const RIB = GRIP_H / (LADDER_N + 1 + LADDER_N * 0.42);
const GAP = RIB * 0.42;
const NOTCH = GRIP_HW * 0.28; // 切り欠きの深さ(輪郭にはしごを出す)

/** 部品どうしの継ぎ目が線に見えないよう、うしろへ差し込む量 */
const BLADE_TUCK = 3.4;
const GRIP_TUCK = 1.4;

/**
 * 刃の輪郭。3D buildSword.ts の BLADE_PROFILE をそのまま写したもの。
 * u = 0 が剣先 / 1 が鍔ぎわ。h = 鍔ぎわを1とした半幅。
 * 途中に最大幅の山を作ると「先端の無い樽」= 洗濯ばさみに見えるので単調増加。
 * 先端は幅0の尖点にしない(実物は安全基準で丸い鼻になっている)。
 */
const BLADE_PROFILE: [number, number][] = [
  [0.0, 0.16],
  [0.015, 0.3],
  [0.04, 0.44],
  [0.075, 0.555],
  [0.12, 0.65],
  [0.175, 0.725],
  [0.245, 0.79],
  [0.33, 0.85],
  [0.43, 0.9],
  [0.54, 0.94],
  [0.67, 0.97],
  [0.82, 0.99],
  [1.0, 1.0],
];

const n2 = (v: number) => Number(v.toFixed(2));
const pt = (x: number, y: number) => `${n2(CX + x)} ${n2(y)}`;
const poly = (pts: number[][]) =>
  "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z";

/** 剣先からの割合 u での刃の半幅(輪郭表の線形補間。3Dも折れ線なので同じ形) */
function bladeHalf(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  for (let i = 1; i < BLADE_PROFILE.length; i++) {
    const [u1, h1] = BLADE_PROFILE[i];
    if (t <= u1) {
      const [u0, h0] = BLADE_PROFILE[i - 1];
      const k = u1 === u0 ? 0 : (t - u0) / (u1 - u0);
      return (h0 + (h1 - h0) * k) * BLADE_HW;
    }
  }
  return BLADE_HW;
}
const bladeY = (u: number) => TIP_Y - BLADE_LEN * u;

/** 刃。上端は鍔のバーのうしろへ差し込むので、見えている長さは BLADE_LEN */
const D_BLADE = (() => {
  const right: number[][] = [];
  const left: number[][] = [];
  for (const [u, h] of BLADE_PROFILE) {
    right.push([BLADE_HW * h, bladeY(u)]);
    left.push([-BLADE_HW * h, bladeY(u)]);
  }
  const tuck = GUARD_BOT - BLADE_TUCK;
  return poly([
    ...right,
    [BLADE_HW, tuck],
    [-BLADE_HW, tuck],
    ...left.reverse(),
  ]);
})();

/** 握り。左右の輪郭を段々に刻んで、シルエットに「はしご」を出す */
const GRIP_BUILD = (() => {
  const right: number[][] = [[GRIP_HW, GUARD_TOP + GRIP_TUCK]];
  const notches: number[][] = []; // 切り欠きの帯 [top, bottom]
  let y = GUARD_TOP;
  for (let i = 0; i < LADDER_N; i++) {
    y -= RIB;
    right.push([GRIP_HW, y], [GRIP_HW - NOTCH, y], [GRIP_HW - NOTCH, y - GAP]);
    notches.push([y - GAP, y]);
    y -= GAP;
    right.push([GRIP_HW, y]);
  }
  right.push([GRIP_HW, GRIP_TOP]);
  const left = right.map(([x, yy]) => [-x, yy]).reverse();
  return { d: poly([...right, ...left]), notches };
})();
const D_GRIP = GRIP_BUILD.d;
const GRIP_NOTCHES = GRIP_BUILD.notches;

/**
 * 柄頭。握りの下でいったんくびれてから、平たい三つ葉板へ開く。
 * 3つの円の上側の包絡線を走査するので、粒どうしが重なって峰が繋がる
 * (離すと城の狭間 = 王冠に見える)。
 */
const D_POMMEL = (() => {
  const cy = TOP_Y + LOBE_R;
  const cxs = [-LOBE_DX, 0, LOBE_DX];
  const pts: number[][] = [
    [-WAIST_HW, GRIP_TOP],
    [-POMMEL_HW, cy],
  ];
  const N = 26;
  for (let i = 1; i < N; i++) {
    const x = -POMMEL_HW + (POMMEL_HW * 2 * i) / N;
    let top = cy;
    for (const c of cxs) {
      const d = Math.abs(x - c);
      if (d < LOBE_R) top = Math.min(top, cy - Math.sqrt(LOBE_R * LOBE_R - d * d));
    }
    pts.push([x, top]);
  }
  pts.push([POMMEL_HW, cy], [WAIST_HW, GRIP_TOP]);
  return poly(pts);
})();

/** 鍔のすぐ下のU字の浮き彫り(実物にあるのはこれ。刃を縦断する樋ではない) */
const EMB_HW = 4.8;
const EMB_TOP = GUARD_BOT + 0.9;
const EMB_BOT = EMB_TOP + 7.4;
const D_EMBOSS =
  `M${pt(-EMB_HW, EMB_TOP)}L${pt(-EMB_HW, EMB_BOT - EMB_HW)}` +
  `A${EMB_HW} ${EMB_HW} 0 0 0 ${pt(EMB_HW, EMB_BOT - EMB_HW)}` +
  `L${pt(EMB_HW, EMB_TOP)}`;

/**
 * 握りの中央を縦に走る稲妻の浮き彫り。実物のパーツに彫られている飾りで、
 * 「横縞しかない筒」= ねじ を断ち切ってくれる縦の要素でもある。
 */
const D_BOLT = (() => {
  const top = GRIP_TOP + GRIP_H * 0.13;
  const bot = GRIP_TOP + GRIP_H * 0.89;
  const d = bot - top;
  return poly([
    [0, top],
    [1.7, top + d * 0.3],
    [0.55, top + d * 0.46],
    [1.5, top + d * 0.55],
    [0, bot],
    [-1.5, top + d * 0.55],
    [-0.55, top + d * 0.46],
    [-1.7, top + d * 0.3],
  ]);
})();

/** 刃の左肩に入るツヤ。輪郭に沿わせて、剣先へ向かって細くする */
const D_GLOSS = (() => {
  const us = [0.16, 0.3, 0.45, 0.6, 0.74, 0.85];
  const outer = us.map((u) => [-bladeHalf(u) + 1.8, bladeY(u)]);
  const inner = us
    .map((u) => [-bladeHalf(u) + 1.8 + (1.0 + 1.9 * u), bladeY(u)])
    .reverse();
  return poly([...outer, ...inner]);
})();

/** クリスタルの「光の芯」(透明樹脂の中を通る明るい線) */
const D_CORE = (() => {
  const us = [0.22, 0.45, 0.68, 0.86];
  const outer = us.map((u) => [-0.4 - 1.5 * u, bladeY(u)]);
  const inner = us.map((u) => [1.1 + 1.4 * u, bladeY(u)]).reverse();
  return poly([...outer, ...inner]);
})();

// ── チャームの束 ──────────────────────────────────────
// 「チャームは何個でもつけられる」が仕様なので、**上限は設けない**(最大13個)。
// ただの縦一列にすると13個で剣の3倍の長さになって viewBox からはみ出すので、
// キーホルダーの房のように「輪から何本かの糸で束ねる」形にしてある。
//
//   ・持つほど列が増え、粒がすこし小さくなる(13個でも房の背丈は変わらない)
//   ・房の右端は viewBox の内側で止める(切れると「壊れた絵」に見える)
//   ・房の下端は y≈74 までに収める。したくのプレビューは下を切って
//     台に挿さって見せるので、そこで房が切れないようにするため
//   ・粒どうしは軽く重なる。離すと「点が散っている」だけに見えて房にならない

/**
 * チャームをぶら下げる点(鍔の右のボスの下)。8個までは刃にまったく重ならない。
 * 9個以上で3列になると左の列が刃のふちに1.6ほどかかるが、刃の幅18.6に対して
 * 8%なので輪郭は読めたまま。実物のキーホルダーも刃の前に垂れるので違和感は無い。
 */
const CHARM_X = BOSS_DX;
const CHARM_TOP = GUARD_CY + BOSS_R * 0.6;
/** キーホルダーの輪。ここから糸が分かれて房になる */
const RING_CY = CHARM_TOP + 2.6;
const RING_R = 1.5;

/** 個数から房の割りつけを決める。3個までは1列(いままでと同じ見え方) */
function charmPack(n: number) {
  if (n <= 3) return { cols: 1, r: 2.95, colGap: 0, rowGap: 6.8 };
  if (n <= 8) return { cols: 2, r: 2.55, colGap: 5.4, rowGap: 5.3 };
  return { cols: 3, r: 2.15, colGap: 4.2, rowGap: 4.6 };
}

interface CharmBead {
  /** CHARMS の index */
  i: number;
  /** CX からの相対x */
  x: number;
  y: number;
}

/** 房の座標を組み立てる。古い順に上から、いちばん新しいものが房の底に来る */
function layoutCharms(indices: number[]) {
  const n = indices.length;
  const { cols, r, colGap, rowGap } = charmPack(n);
  const rows = Math.ceil(n / cols);
  // 右へはみ出すと viewBox に切られるので、房の右端で止める。
  // 1.6 は隠しチャームの光の輪(r+0.9・線0.6)がはみ出さないための余白
  const limit = VB_W / 2 - 1.6 - r;
  const right = Math.min(CHARM_X + ((cols - 1) * colGap) / 2, limit);
  const colX: number[] = [];
  for (let c = 0; c < cols; c++) colX.push(right - (cols - 1 - c) * colGap);
  const top = RING_CY + RING_R + r + 1.2;
  // 端数は1行目に置く。下の行ほど詰まっていると、房が下に向かって広がって見える
  const head = n - (rows - 1) * cols;
  const beads: CharmBead[] = [];
  let k = 0;
  for (let row = 0; row < rows; row++) {
    const cnt = row === 0 ? head : cols;
    const off = Math.round((cols - cnt) / 2);
    for (let c = 0; c < cnt; c++) {
      beads.push({ i: indices[k++], x: colX[off + c], y: top + row * rowGap });
    }
  }
  // 糸は「輪 → その列のいちばん下の粒」を1本ずつ。粒のうしろに敷く
  const strands = colX.map((x) => {
    let bottom = top;
    for (const b of beads) if (b.x === x && b.y > bottom) bottom = b.y;
    return { x, bottom };
  });
  return { beads, strands, r };
}

// ── 仕上げ ────────────────────────────────────────────
/** 仕上げの見た目は4種類に集約する(3Dのマテリアル値からUI表現へ翻訳) */
type Finish = "plastic" | "metal" | "crystal" | "iri";

function finishOf(skin: number): Finish {
  const s = SWORD_SKINS[skin] ?? SWORD_SKINS[0];
  if (s.iridescent) return "iri";
  if (s.opacity < 1) return "crystal";
  if (s.metalness > 0.6) return "metal";
  return "plastic";
}

/** 横方向の陰影(0=左端 1=右端)。白黒の半透明なので下地の色を選ばない */
const SHADE: Record<Finish, [number, string][]> = {
  // 実物は「マット寄りの成型樹脂」。ツヤは広くやわらかく、彩度の高い色でも飛ばさない
  plastic: [
    [0, "rgba(255,255,255,.4)"],
    [0.2, "rgba(255,255,255,.13)"],
    [0.5, "rgba(255,255,255,0)"],
    [0.78, "rgba(0,0,0,.14)"],
    [1, "rgba(0,0,0,.35)"],
  ],
  // 金属は「細く強いハイライト帯」が2本走るのが要点
  metal: [
    [0, "rgba(0,0,0,.34)"],
    [0.08, "rgba(255,255,255,.12)"],
    [0.26, "rgba(255,255,255,.95)"],
    [0.38, "rgba(255,255,255,.18)"],
    [0.58, "rgba(0,0,0,.22)"],
    [0.74, "rgba(255,255,255,.66)"],
    [0.87, "rgba(0,0,0,.05)"],
    [1, "rgba(0,0,0,.44)"],
  ],
  // 透明樹脂は「ふちが明るく中が抜ける」。下地じたいも氷色に寄せてある
  crystal: [
    [0, "rgba(255,255,255,.9)"],
    [0.2, "rgba(255,255,255,.06)"],
    [0.46, "rgba(255,255,255,.42)"],
    [0.74, "rgba(0,0,0,.07)"],
    [1, "rgba(255,255,255,.8)"],
  ],
  iri: [
    [0, "rgba(255,255,255,.4)"],
    [0.3, "rgba(255,255,255,.06)"],
    [0.56, "rgba(255,255,255,.6)"],
    [0.8, "rgba(0,0,0,.08)"],
    [1, "rgba(0,0,0,.3)"],
  ],
};

/**
 * ふちの色と太さ。ぎん(#e8eefc)・きん(#ffd06a)はクリーム地のカードに置くと
 * 塗りだけでは 1.4:1 前後しか出ず、実質見えない。金属だけふちを濃く太くして、
 * どの地色でもシルエットが 4:1 以上で読めるようにする。
 */
const EDGE: Record<Finish, [string, number]> = {
  plastic: ["rgba(26,22,10,.34)", 1.1],
  metal: ["rgba(38,32,18,.62)", 1.55],
  crystal: ["rgba(26,48,86,.45)", 1.25],
  iri: ["rgba(26,22,10,.4)", 1.25],
};

/**
 * にじいろの下地。3D同様に「見る場所で色が動く」感じを出す。
 * 横方向のグラデにすると、幅24pxまで縮んだとき刃が gradient の中央付近しか
 * 拾わず「緑〜黄の一色」になってしまう。剣の長さ方向へ斜めに流して、
 * 柄頭〜剣先のあいだで必ず一周させる(userSpaceOnUse なので部品をまたぐ)。
 */
const IRI_STOPS: [number, string][] = [
  [0, "#ff8fcf"],
  [0.16, "#b98cff"],
  [0.34, "#57c7ff"],
  [0.52, "#67efb9"],
  [0.68, "#ffe066"],
  [0.84, "#ff9f7a"],
  [1, "#f58fd0"],
];

/** クリスタルが寄っていく氷の色(config の hex #bfe9ff に合わせた冷たい白) */
const ICE = [223, 244, 255];

/** hex を氷色へ寄せる。t=1 で完全に氷色 */
function toIce(hex: string, t: number): string {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const v = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0);
  const m = v.map((c, i) => Math.round(c + (ICE[i] - c) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

/**
 * バッジなど「1色だけ欲しい」場所むけ。tinted なスキンは選んだ色、
 * そうでなければスキン固有色を返す(にじいろは中間色でごまかす)。
 */
export function effectiveHex(color: number, skin: number): string {
  const sk = SWORD_SKINS[skin] ?? SWORD_SKINS[0];
  if (sk.iridescent) return "#c4b6ff";
  const c = SWORD_COLORS[color] ?? SWORD_COLORS[0];
  return sk.tinted ? c.hex : sk.hex;
}

/** きらめきの4方向スター(金属・クリスタル・にじいろの見せ場) */
function sparkle(x: number, y: number, s: number): string {
  const q = s * 0.26;
  return [
    `M${x} ${y - s}`,
    `Q${x + q} ${y - q} ${x + s} ${y}`,
    `Q${x + q} ${y + q} ${x} ${y + s}`,
    `Q${x - q} ${y + q} ${x - s} ${y}`,
    `Q${x - q} ${y - q} ${x} ${y - s}`,
    "Z",
  ].join(" ");
}

export interface SwordArtProps {
  /** SWORD_COLORS の index */
  color: number;
  /** SWORD_SKINS の index */
  skin: number;
  /** 刺して集めたチャームの数(0でなし)。他の人の剣はこの「数」しか分からない */
  charms?: number;
  /** 隠しチャーム「ちきゅう」を持っているか。持っていれば房の底に増える */
  earthCharm?: boolean;
  /**
   * ぶら下げるチャームを CHARMS の index で名ざしする(古い順)。
   * **自分の剣はこちらを使うこと。** 持っている ≠ つけている なので、
   * 「数」では「3個持っていて2個だけつけている」を表せない。
   * 渡されたときは charms / earthCharm より優先する。
   */
  charmIndices?: number[];
  /**
   * true = チャームを丸ビーズではなく「そのチャームの形」で描く。
   * 剣を35px幅で描くと粒は3pxしかなく、形はつぶれてただの汚れになる。
   * したくのプレビューのように大きく見せる場所だけ true にすること。
   */
  charmShapes?: boolean;
  /**
   * viewBox の下端。既定は剣先まで(102)。小さい値にすると刃の下が切れるので、
   * 台に挿さっているように見せたいとき(プレビュー)に使う。
   * 切ると縦横比が変わり、同じ幅でも剣を大きく描ける。
   */
  cropY?: number;
  className?: string;
}

export default function SwordArt({
  color,
  skin,
  charms = 0,
  earthCharm = false,
  charmIndices,
  charmShapes = false,
  cropY,
  className,
}: SwordArtProps) {
  // 同じページに何本も並ぶので、グラデーションのidは実体ごとに固有にする。
  // useId の ":" は url(#..) 参照で嫌われることがあるので英数字だけに落とす。
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fin = finishOf(skin);
  const base = effectiveHex(color, skin);
  // 名ざしが来ていればそれ(= 自分がいまつけているチャーム)。
  // 来ていない他人の剣は、3Dと同じ1本の関数で「数」から組み立てる
  // (ここで独自に数えると「UIには5個・月の剣には3個」のような食い違いが出る)
  const { beads, strands, r: beadR } = layoutCharms(
    charmIndices ?? charmIndicesFrom(charms, earthCharm)
  );

  const body =
    fin === "iri"
      ? `url(#ki${uid})`
      : fin === "crystal"
        ? `url(#kc${uid})`
        : base;
  const shade = `url(#ks${uid})`;
  // 透けは「ほんの少し」でよい。0.86 まで落とすとカードの地色と混ざって
  // にごる(濃紺のカードの上で、きいろのクリスタルがオリーブ色になっていた)
  const bodyOpacity = fin === "crystal" ? 0.95 : 1;
  const [edge, edgeW] = EDGE[fin];

  /** 成型パーツ1つぶん = 下地 + 同じ形の陰影。パーツごとに丸く見える */
  const part = (el: (fill: string, outline: boolean) => React.ReactNode) => (
    <>
      {el(body, true)}
      {el(shade, false)}
    </>
  );

  return (
    <svg
      className={className ? `kk-svg ${className}` : "kk-svg"}
      viewBox={`0 0 ${VB_W} ${cropY ?? VB_H}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`ks${uid}`} x1="0" y1="0" x2="1" y2="0">
          {SHADE[fin].map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
        {fin === "iri" && (
          <linearGradient
            id={`ki${uid}`}
            gradientUnits="userSpaceOnUse"
            x1={CX - 9}
            y1={TOP_Y}
            x2={CX + 11}
            y2={TIP_Y}
          >
            {IRI_STOPS.map(([o, c]) => (
              <stop key={o} offset={o} stopColor={c} />
            ))}
          </linearGradient>
        )}
        {fin === "crystal" && (
          // 透明樹脂は「ふちが白く、芯にだけ色が溜まる」。均一に塗ると
          // ただの不透明なプラスチックになってしまう
          <linearGradient id={`kc${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={toIce(base, 0.82)} />
            <stop offset="0.34" stopColor={toIce(base, 0.24)} />
            <stop offset="0.62" stopColor={toIce(base, 0.58)} />
            <stop offset="1" stopColor={toIce(base, 0.4)} />
          </linearGradient>
        )}
      </defs>

      {/* ── チャーム: 鍔の右のボスから、キーホルダーの房のように垂らす ── */}
      {beads.length > 0 && (
        <g className="kk-svg-charms">
          {/* 輪までの短いひも */}
          <path
            d={`M${pt(CHARM_X, CHARM_TOP)}L${pt(CHARM_X, RING_CY - RING_R + 0.3)}`}
            fill="none"
            stroke="rgba(0,0,0,.34)"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          {/* 列ごとの糸。粒のうしろに敷くので、玉が糸に通って見える */}
          {strands.map((s) => (
            <path
              key={s.x}
              d={`M${pt(CHARM_X, RING_CY)}L${pt(s.x, s.bottom)}`}
              fill="none"
              stroke="rgba(0,0,0,.3)"
              strokeWidth="0.75"
              strokeLinecap="round"
            />
          ))}
          <circle
            cx={n2(CX + CHARM_X)}
            cy={n2(RING_CY)}
            r={n2(RING_R)}
            fill="none"
            stroke="rgba(255,255,255,.7)"
            strokeWidth="0.85"
          />
          {beads.map((b) => {
            const c = CHARMS[b.i];
            if (!c) return null;
            const cx = CX + b.x;
            return (
              <g key={b.i}>
                {/* 隠しチャームだけ、白い薄い光の輪をまとわせる。
                    房のどこに紛れても「1個だけ違う」と分かるようにするため */}
                {c.secret && (
                  <circle
                    cx={n2(cx)}
                    cy={n2(b.y)}
                    r={n2(beadR + 0.9)}
                    fill="none"
                    stroke="rgba(255,255,255,.62)"
                    strokeWidth="0.6"
                  />
                )}
                {charmShapes ? (
                  // 棚とまったく同じ絵(CharmGlyph)を粒の大きさへ縮めて置く。
                  // 丸カンは描かない: 房は房ぜんぶで1つの輪を持っているので、
                  // 粒ごとに輪があると金具だらけになる。
                  // 24の箱のうち本体が使うのは y 5〜23 の19ぶんなので、
                  // その19が粒の直径になるよう合わせる(でないと粒が痩せて見える)
                  <g
                    transform={`translate(${n2(cx - 12 * (beadR * 2) / 19)} ${n2(
                      b.y - 14 * (beadR * 2) / 19
                    )}) scale(${((beadR * 2) / 19).toFixed(4)})`}
                  >
                    <CharmGlyph index={b.i} detail={false} ring={false} />
                  </g>
                ) : (
                  <>
                    <circle
                      cx={n2(cx)}
                      cy={n2(b.y)}
                      r={n2(beadR)}
                      fill={c.hex}
                      stroke="rgba(0,0,0,.34)"
                      strokeWidth="0.85"
                    />
                    <circle
                      cx={n2(cx - beadR * 0.3)}
                      cy={n2(b.y - beadR * 0.34)}
                      r={n2(beadR * 0.34)}
                      fill="rgba(255,255,255,.85)"
                    />
                  </>
                )}
              </g>
            );
          })}
        </g>
      )}

      <g opacity={bodyOpacity}>
        {/* ── 柄頭(くびれてから開く三つ葉板) ── */}
        {part((f, o) => (
          <path
            key={o ? "b" : "s"}
            d={D_POMMEL}
            fill={f}
            stroke={o ? edge : "none"}
            strokeWidth={edgeW}
            strokeLinejoin="round"
          />
        ))}

        {/* ── はしご状の握り(切り欠きは輪郭そのものに入っている) ── */}
        {part((f, o) => (
          <path
            key={o ? "b" : "s"}
            d={D_GRIP}
            fill={f}
            stroke={o ? edge : "none"}
            strokeWidth={edgeW}
            strokeLinejoin="round"
          />
        ))}
        {/* 切り欠きの中だけ弱く沈める。ここを濃くすると横縞が9本に見えて
            ねじ山になるので、桟側にはハイライトを足さない(暗い線5本だけ) */}
        {GRIP_NOTCHES.map(([y0, y1]) => (
          <rect
            key={y0}
            x={n2(CX - (GRIP_HW - NOTCH))}
            y={n2(y0)}
            width={n2((GRIP_HW - NOTCH) * 2)}
            height={n2(y1 - y0)}
            fill="rgba(0,0,0,.15)"
          />
        ))}
        {/* 稲妻の浮き彫り。暗い形の上に明るい形をずらして「盛り上がり」に見せる */}
        <path d={D_BOLT} fill="rgba(0,0,0,.16)" />
        <path
          d={D_BOLT}
          fill="rgba(255,255,255,.3)"
          transform="translate(-0.55 -0.55)"
        />

        {/* ── 刃(下向き。上端は鍔のうしろに隠れる) ── */}
        <path
          d={D_BLADE}
          fill={body}
          stroke={edge}
          strokeWidth={edgeW}
          strokeLinejoin="round"
        />
        <path d={D_BLADE} fill={shade} />
        {fin === "crystal" && (
          <path d={D_CORE} fill="rgba(255,255,255,.55)" />
        )}
        <path d={D_GLOSS} fill="rgba(255,255,255,.34)" />
        {/* U字の浮き彫り: 明るい線をずらして「盛り上がり」に見せる */}
        <path
          d={D_EMBOSS}
          fill="none"
          stroke="rgba(0,0,0,.2)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d={D_EMBOSS}
          fill="none"
          stroke="rgba(255,255,255,.34)"
          strokeWidth="1.1"
          strokeLinecap="round"
          transform="translate(-0.7 -0.7)"
        />

        {/* ── 鍔(握りの1.80倍の長いバー + 両はしの丸いボス) ── */}
        {part((f, o) => (
          <rect
            key={o ? "b" : "s"}
            x={n2(CX - BAR_HL)}
            y={n2(GUARD_CY - BAR_HH)}
            width={n2(BAR_HL * 2)}
            height={n2(BAR_HH * 2)}
            rx={n2(BAR_HH)}
            fill={f}
            stroke={o ? edge : "none"}
            strokeWidth={edgeW}
          />
        ))}
        {[-BOSS_DX, BOSS_DX].map((dx) => (
          <g key={dx}>
            <circle
              cx={n2(CX + dx)}
              cy={n2(GUARD_CY)}
              r={n2(BOSS_R)}
              fill={body}
              stroke={edge}
              strokeWidth={edgeW}
            />
            <circle cx={n2(CX + dx)} cy={n2(GUARD_CY)} r={n2(BOSS_R)} fill={shade} />
            {/* ボスの真ん中のくぼみ(実物のドーナツ状のディテール) */}
            <circle
              cx={n2(CX + dx)}
              cy={n2(GUARD_CY)}
              r={n2(BOSS_R * 0.41)}
              fill="rgba(0,0,0,.22)"
              stroke="rgba(255,255,255,.25)"
              strokeWidth="0.7"
            />
          </g>
        ))}
        <rect
          x={n2(CX - BAR_HL + 2.6)}
          y={n2(GUARD_CY - BAR_HH + 0.9)}
          width={n2((BAR_HL - 2.6) * 2)}
          height="1.7"
          rx="0.85"
          fill="rgba(255,255,255,.34)"
        />
      </g>

      {/* ── 仕上げのきらめき ── */}
      {(fin === "metal" || fin === "crystal") && (
        <>
          <path d={sparkle(CX + 3.8, 79, 4)} fill="rgba(255,255,255,.92)" />
          <path d={sparkle(CX - 3.6, 65, 2.6)} fill="rgba(255,255,255,.7)" />
        </>
      )}
      {fin === "iri" && (
        <>
          <path d={sparkle(CX + 4.2, 75, 3.7)} fill="rgba(255,255,255,.85)" />
          <path d={sparkle(CX - 3.4, 58, 2.4)} fill="rgba(255,255,255,.7)" />
        </>
      )}
    </svg>
  );
}
