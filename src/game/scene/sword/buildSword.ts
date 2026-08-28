// 「黒ひげ危機一発」の付属剣を手続き生成する共有ビルダー。
// 月に刺さっている剣(Swords.tsx / InstancedMesh)も、自分のヒーロー剣
// (StabSword.tsx)も、降ってくる剣の演出も、ぜんぶここから作る。
//
// TOMY公式パーツ写真の実測(回転補正後)にもとづく、実物の剣の特徴:
//   ・刃も鍔も柄も柄頭も「ぜんぶ同じ色の1色成型プラスチック」(刃だけ銀にしない)
//   ・細長い「先の丸い弾丸型」の刃。剣先から鍔まで単調に太くなり鍔ぎわが最大
//   ・鍔は細長いバーの両端に丸いボス。刃の最大幅の2.1倍
//   ・握りは細い円柱ではなく、ほぼ正方形の平たい板に「はしご状の溝」が5本
//   ・柄頭は球ではなく、平たく開いた三つ葉の板
//   ・つやのある、少し安っぽくてかわいいプラスチックの照り
//
// ローカル座標の約束:
//   原点 = 月面への刺さり口 / +Y = 柄の方向 / 刃先は -Y(月の中)へ伸びる
//   scale = 1 が「月に刺さっている剣」の大きさ(月面から出る高さ = EXPOSED_H)

import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CHARMS,
  SWORD_COLORS,
  SWORD_SKINS,
  type Charm,
  type CharmMaterial,
} from "@/lib/config";
import { charmIndicesFrom } from "@/lib/style";
// 穴のスリットの向き。穴(Holes.tsx)と剣で必ず同じ答えを使うための唯一の窓口
import { slotUp } from "@/lib/holes";
import { hashString, mulberry32, randRange } from "@/lib/prng";
import { makeCharmParts, type CharmBuild, type CharmPaint } from "./charmGeometry";

// ── 寸法 ────────────────────────────────────────────
// いちばん大事なのは「実物は刃も握りも柄頭も同じ厚みの平たい1枚の板」だという
// こと。だから安く成型できるし、あの独特のシルエットになる。これを
// 「細い板 + 細い円柱 + 上に乗った球」で作ると、剣ではなく待ち針に見える。

/**
 * 月面から出る高さ。全景での剣の密度バランスがこの値で決まっているので固定。
 */
const EXPOSED_H = 0.7181;

// ── 実測は「回転補正後」の値を使うこと ────────────────────────
// 公式写真の剣は4本とも24〜29°傾いて置かれている。軸に平行なバウンディング
// ボックスで測ると、傾いたぶん幅が水増しされ長さが圧縮されるので、
// 「刃の幅 : 長さ = 0.55」のような、実物より44%太い値が出てしまう。

/** 見えている刃の長さ = 見えている剣の50%(実物の刃は剣全体の53%) */
const BLADE_TOP = EXPOSED_H * 0.5;
/** 柄まわり(鍔+握り+柄頭)の高さ */
const HILT_H = EXPOSED_H - BLADE_TOP;

/** 刃は月の中へも少し伸ばす(刺す・降ってくる演出で使う) */
const BLADE_BURY = BLADE_TOP * 0.145;
const BLADE_LEN = BLADE_TOP + BLADE_BURY;
/** 刃の半幅。回転補正した実測「刃の幅 : 刃の長さ = 0.38」を刃の全長に当てる */
const BLADE_HALF_W = (BLADE_LEN * 0.385) / 2;
const BLADE_THICK = 0.04;

const POMMEL_SINK = 0.008; // 握りへ少しめり込ませて、浮いて見せない

// 鍔: 細長いバーの両端に丸いボス。回転補正した実測「鍔の長さ = 刃の最大幅の
// 2.1倍」を保つため刃幅から導出する(刃の太さを変えても鍔が鍔に見えなくならない)
const GUARD_HALF_L = BLADE_HALF_W * 2.1;
const GUARD_HALF_H = (HILT_H * 0.185) / 2;
const GUARD_BOSS_R = GUARD_HALF_H; // いちばん高いのは端のボス
const GUARD_BAR_HALF_H = GUARD_BOSS_R * 0.7; // 中央のバーはボスより細い
const GUARD_THICK = 0.062; // 鍔だけ少し厚くして、部品として立たせる

// 握り: 円柱ではなく平たい板。はしご状の溝が入る。
// 幅は実測の見た目どおり刃よりわずかに広い程度にとどめる。ここを
// 「縦横比1.04」から逆算すると、刃の1.27倍もある巨大な板になってしまう
const GRIP_HALF_W = BLADE_HALF_W * 1.1;
const GRIP_THICK = 0.046;
const GRIP_RIB_THICK = 0.06; // はしごの桟はひと回り厚い
const GRIP_NOTCH = GRIP_HALF_W * 0.28; // 溝で細くなる量(輪郭にもはしごを出す)

// 柄頭: 球ではなく、平たく開いた三つ葉の板(球はRPGの短剣の記号で、玩具ではない)
const POMMEL_H = HILT_H * 0.3;
// 実測「柄頭の張り出し / 握り幅」。1.18 は写真のサンプル格子が柄頭のいちばん
// 広い行を外していた値で、測り直すと 1.25〜1.28。UIの剣(SwordArt)も1.25。
const POMMEL_HALF_W = GRIP_HALF_W * 1.25;
const POMMEL_LOBE_R = POMMEL_HALF_W * 0.37; // 三つ葉ひと粒の半径
const POMMEL_THICK = 0.046;

// 柄の内訳(回転補正した実測: 鍔18.5% / 握り51% / 柄頭30.5%)。
// 残りの高さを握りに割り当てるので、鍔+握り+柄頭 = HILT_H が常に成り立つ
const GRIP_LEN = HILT_H - GUARD_HALF_H * 2 - POMMEL_H + POMMEL_SINK;

const GUARD_Y = BLADE_TOP + GUARD_HALF_H; // 鍔の中心の高さ
const GRIP_Y = GUARD_Y + GUARD_HALF_H; // 握りのはじまり
const POMMEL_Y = GRIP_Y + GRIP_LEN - POMMEL_SINK; // 三つ葉板の付け根
const TOP_Y = POMMEL_Y + POMMEL_H; // = EXPOSED_H

/** チャームをぶら下げる点(鍔の端の下面)。刃に重ならないよう外側へ寄せてある */
const CHARM_ANCHOR = new THREE.Vector3(
  GUARD_HALF_L,
  BLADE_TOP, // 鍔の下面ちょうど。浮かせない
  0
);

/** 他のモジュールから位置合わせに使う寸法 */
export const SWORD_DIMS = {
  /** 刃の全長 */
  bladeLen: BLADE_LEN,
  /** 原点より下に埋まる刃の長さ(= 刺さりきったときの剣先の深さ) */
  bury: BLADE_BURY,
  /** 鍔の中心の高さ */
  guardY: GUARD_Y,
  /** 鍔の半分の長さ */
  guardHalf: GUARD_HALF_L,
  /** 柄頭のてっぺん = 刺さった剣が月面から出る高さ */
  top: TOP_Y,
  /** チャームのぶら下げ点 */
  charmAnchor: CHARM_ANCHOR,
} as const;

/** 形の細かさ。月に並ぶ1000本は "field"、近くで見る剣は "hero" */
export type SwordQuality = "field" | "hero";

// ── ジオメトリ ──────────────────────────────────────

/** 数値の組から Shape(閉じた輪郭)を作る */
function shapeFrom(xy: number[][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(xy[0][0], xy[0][1]);
  for (let i = 1; i < xy.length; i++) s.lineTo(xy[i][0], xy[i][1]);
  s.closePath();
  return s;
}

/** 平たい輪郭を押し出す(実物は全部が同じ板なので、部品はぜんぶこれで作る) */
function extrudePlate(
  shape: THREE.Shape | THREE.Shape[],
  thick: number,
  bevel: number,
  bevelSegments = 1,
  curveSegments = 2
): THREE.BufferGeometry {
  const depth = thick - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2); // 板の中心を z=0 に
  return geo;
}

/**
 * 刃の輪郭。先端からの位置 u(0=剣先, 1=鍔ぎわ)と、鍔ぎわを1とした半幅 h。
 *
 * 実物は「先の丸い長い弾丸型」= 剣先から鍔まで単調に太くなり、鍔ぎわが最大。
 * 途中に最大幅の山を作る(西洋短剣の木の葉型)と、月から出ている部分が
 * 「先端が無く真ん中がいちばん太い樽」になって、洗濯ばさみにしか見えない。
 * 先端は幅0の尖点にしない — 実物は安全基準のために丸い鼻へ変えられている。
 */
const BLADE_PROFILE: number[][] = [
  [0.0, 0.16], // 丸い鼻
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
  [1.0, 1.0], // 鍔ぎわがいちばん太い
];

/** 刃の面取り。ExtrudeGeometry の面取りは輪郭より外へ膨らむので後で差し引く */
const BLADE_BEVEL = 0.006;

/** 刃。平たく幅の広い木の葉。面取りが成型プラスチックの角のハイライトになる */
function makeBlade(q: SwordQuality): THREE.BufferGeometry {
  // 遠景はひとつ飛ばしでサンプルする(表はひとつなので形は崩れない)
  const rows =
    q === "hero" ? BLADE_PROFILE : BLADE_PROFILE.filter((_, i) => i % 2 === 0);
  const tip = -BLADE_BURY;
  // 面取りのぶん外へ太るので、輪郭はそのぶん内側に作る。
  // こうしないと出来上がりが実測比 0.55 より6%ほど太ってしまう
  const w = BLADE_HALF_W - BLADE_BEVEL;
  const right: number[][] = [];
  const left: number[][] = [];
  for (const [u, h] of rows) {
    const y = tip + BLADE_LEN * u;
    const x = w * h;
    right.push([x, y]);
    left.push([-x, y]);
  }
  // 右を剣先→鍔、左を鍔→剣先とつなぐと閉じた木の葉になる
  return extrudePlate(
    shapeFrom([...right, ...left.reverse()]),
    BLADE_THICK,
    BLADE_BEVEL,
    q === "hero" ? 2 : 1,
    1
  );
}

/** 鍔。細長いバーの両端に丸いボス。実物のいちばん分かりやすい目印 */
function makeGuard(q: SwordQuality): THREE.BufferGeometry {
  const r = GUARD_BOSS_R;
  const hy = GUARD_BAR_HALF_H;
  const cx = GUARD_HALF_L - r; // ボスの中心
  const bx = cx + Math.sqrt(r * r - hy * hy); // バーがボスから出る位置
  const a = Math.asin(hy / r);
  const shape = new THREE.Shape();
  shape.moveTo(-bx, -hy);
  shape.lineTo(bx, -hy);
  shape.absarc(cx, 0, r, -a, a, false); // 右のボス
  shape.lineTo(-bx, hy);
  shape.absarc(-cx, 0, r, Math.PI - a, Math.PI + a, false); // 左のボス
  shape.closePath();
  const geo = extrudePlate(
    shape,
    GUARD_THICK,
    q === "hero" ? 0.005 : 0,
    1,
    q === "hero" ? 8 : 4
  );
  geo.translate(0, GUARD_Y, 0);
  return geo;
}

/**
 * はしごの桟の割りつけ(輪郭の溝と、盛り上げる桟で同じ数値を使う)。
 * 溝の数は field でも実物どおり5本にする。実物でいちばん目立つ形なので、
 * 遠景で本数を減らすと剣ではなくただの棒に見えてしまう。
 */
function gripLadder() {
  const n = 5;
  const rib = GRIP_LEN / (n + 1 + n * 0.42); // 桟の高さ
  return { n, rib, gap: rib * 0.42 };
}

/**
 * 握り。細い円柱ではなく、刃とほぼ同じ幅の平たい板。
 * 左右の輪郭を段々に刻んで、遠景でも「はしご」が silhouette に出るようにする
 * (ここが無いと、実物でいちばん目立つ溝が消えてただの棒になる)。
 */
function makeGrip(q: SwordQuality): THREE.BufferGeometry {
  const { n, rib, gap } = gripLadder();
  const w = GRIP_HALF_W;
  const wn = w - GRIP_NOTCH;
  const right: number[][] = [];
  let y = GRIP_Y;
  right.push([w, y]);
  for (let i = 0; i < n; i++) {
    y += rib;
    right.push([w, y], [wn, y], [wn, y + gap]);
    y += gap;
    right.push([w, y]);
  }
  right.push([w, GRIP_Y + GRIP_LEN]);
  const left = right.map(([x, yy]) => [-x, yy]);
  return extrudePlate(
    shapeFrom([...right, ...left.reverse()]),
    GRIP_THICK,
    q === "hero" ? 0.004 : 0,
    1,
    1
  );
}

/** はしごの桟を板の表裏へ盛り上げる(近くで見る剣だけ) */
function makeGripRibs(q: SwordQuality): THREE.BufferGeometry | null {
  if (q !== "hero") return null;
  const { n, rib, gap } = gripLadder();
  const w = GRIP_HALF_W - 0.012;
  const shapes: THREE.Shape[] = [];
  let y = GRIP_Y;
  for (let i = 0; i <= n; i++) {
    const y0 = y + rib * 0.18;
    const y1 = y + rib * 0.82;
    shapes.push(
      shapeFrom([
        [-w, y0],
        [w, y0],
        [w, y1],
        [-w, y1],
      ])
    );
    y += rib + gap;
  }
  return extrudePlate(shapes, GRIP_RIB_THICK, 0.004, 1, 1);
}

/**
 * 柄頭。実物は球でも円盤でもなく「平たく開いた三つ葉の板」で、
 * これが玩具の剣の記号になっている(球にすると待ち針・画鋲に見える)。
 * 3つの円の上側の包絡線を走査して、重なった三つ葉の輪郭を作る。
 */
function makePommel(q: SwordQuality): THREE.BufferGeometry {
  const r = POMMEL_LOBE_R;
  const w = POMMEL_HALF_W;
  const cy = POMMEL_Y + (POMMEL_H - r); // 三つ葉の中心の高さ
  const cxs = [-(w - r), 0, w - r];
  const N = q === "hero" ? 22 : 11;
  const pts: number[][] = [];
  // 付け根: 握り幅から左右へ開く
  pts.push([-w, cy]);
  pts.push([-w, POMMEL_Y + 0.026]);
  pts.push([-GRIP_HALF_W * 0.8, POMMEL_Y]);
  pts.push([GRIP_HALF_W * 0.8, POMMEL_Y]);
  pts.push([w, POMMEL_Y + 0.026]);
  pts.push([w, cy]);
  // 上側: 3つの円のうち、いちばん高いものを拾っていく
  for (let i = 1; i < N; i++) {
    const x = w - (2 * w * i) / N;
    let top = cy;
    for (const cx of cxs) {
      const d = Math.abs(x - cx);
      if (d < r) top = Math.max(top, cy + Math.sqrt(r * r - d * d));
    }
    pts.push([x, top]);
  }
  return extrudePlate(
    shapeFrom(pts),
    POMMEL_THICK,
    q === "hero" ? 0.004 : 0,
    1,
    1
  );
}

/**
 * 剣1本ぶんのジオメトリ。1色成型なので刃も柄もひとつに結合できる
 * (= InstancedMesh 1本で剣まるごとを描ける)。
 */
export function makeToySwordGeometry(
  quality: SwordQuality = "hero"
): THREE.BufferGeometry {
  // ExtrudeGeometry は非インデックスなので、結合前にインデックス化しておく
  const ribs = makeGripRibs(quality);
  const parts = [
    makeBlade(quality),
    makeGuard(quality),
    makeGrip(quality),
    makePommel(quality),
    ...(ribs ? [ribs] : []),
  ].map((g) => {
    const indexed = mergeVertices(g, 1e-5);
    if (indexed !== g) g.dispose();
    return indexed;
  });
  const merged = mergeGeometries(parts);
  if (!merged) return parts[0]; // 結合できない構成にはしていないが、念のため
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * 月に刺さっている剣ぶんの、簡略化したチャーム表現。
 * 1000本ぶん3個ずつ揺らすと重いので、鍔の下の小さなビーズ1個にまとめる。
 * 剣とおなじインスタンス行列をそのまま使えるよう、位置を焼き込んである。
 */
export function makeCharmBeadGeometry(): THREE.BufferGeometry {
  // 玉だけだと1000個が剣から離れて宙に浮いて見えるので、鍔の下面へ
  // 小さな輪(短い軸)で必ずつなぐ。輪は鍔にめり込ませて隙間をゼロにする。
  const link = new THREE.CylinderGeometry(0.007, 0.007, 0.03, 4);
  link.translate(CHARM_ANCHOR.x, CHARM_ANCHOR.y - 0.012, CHARM_ANCHOR.z);
  const bead = new THREE.SphereGeometry(0.028, 6, 4);
  bead.translate(CHARM_ANCHOR.x, CHARM_ANCHOR.y - 0.048, CHARM_ANCHOR.z);
  const merged = mergeGeometries([link, bead]);
  if (!merged) return bead;
  link.dispose();
  bead.dispose();
  return merged;
}

// ── マテリアル ──────────────────────────────────────

/** にじいろ: 法線と視線のなす角で色相を回す(見る角度で色が動く) */
const IRIDESCENT_CHUNK = /* glsl */ `
	{
		vec3 iriView = normalize( vViewPosition );
		float iriEdge = 1.0 - abs( dot( normalize( normal ), iriView ) );
		float iriHue = fract( iriEdge * 1.15 + uSwordTime * 0.045 );
		vec3 iriColor = 0.5 + 0.5 * cos( 6.28318 * ( iriHue + vec3( 0.0, 0.33, 0.67 ) ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, iriColor, 0.92 );
	}
`;

// ── きらめき ────────────────────────────────────────
// ぎん・きんは「色が違うだけの剣」に見えて、他の人の画面ではノーマルと
// 区別がつかなかった。原因は、このシーンに環境マップが無いこと。
// 金属や宝石を金属らしく見せているのは **動く反射** なので、
// 環境マップの代わりに「刃を根元から先へ流れる細い光の帯」を自前で足す。
//
// 帯の位相は剣ごとにずらす(1000本が同時に光ると、画面全体が明滅して
// 何が起きたのか分からなくなる)。位相は刺さっている場所から作るので、
// 誰の画面でも同じ剣が同じタイミングで光る。
const SPARKLE_VERTEX_CHUNK = /* glsl */ `
	vSparkleY = position.y;
	#ifdef USE_INSTANCING
		vSparkleSeed = fract( sin( dot( instanceMatrix[ 3 ].xyz, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
	#else
		vSparkleSeed = 0.0;
	#endif
`;

const SPARKLE_CHUNK = /* glsl */ `
	{
		// 刃を上へ流れる細い帯。pow でとがらせて「すっと通る光」にする
		// 帯は2本。速さも幅も向きも変えて重ねると、規則正しい明滅ではなく
		// 「ときどき ぎらっと来る」金属の見え方になる。1本だと呼吸に見える
		float sparkB1 = sin( vSparkleY * 9.0 - uSwordTime * 2.4 + vSparkleSeed * 6.28318 );
		float sparkB2 = sin( vSparkleY * 17.0 + uSwordTime * 1.5 + vSparkleSeed * 11.0 );
		float sparkGlint =
			pow( max( sparkB1, 0.0 ), 13.0 ) + 0.7 * pow( max( sparkB2, 0.0 ), 26.0 );
		// ふちほど強い(金属の反射は輪郭に出る)。まん中だけ光ると板に見える
		float sparkRim = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
		// 帯が来ていないあいだも、ふちだけは常に明るくしておく。
		// これが無いと「ときどき光るだけのプラスチック」になって金属に見えない
		float sparkSheen = pow( sparkRim, 3.0 ) * 0.55;
		float sparkK = uSparkle * ( sparkGlint * ( 0.6 + 1.5 * sparkRim ) + sparkSheen );
		totalEmissiveRadiance += mix( vec3( 1.0 ), diffuseColor.rgb, 0.22 ) * sparkK;
	}
`;

/**
 * 暗い宇宙でも色が沈まないように、自分の色をそのまま少し自発光させる。
 * material.emissive ではなく diffuseColor から作るのがミソで、
 * こうするとインスタンスごとに違う色でも自発光の色がちゃんと追従する。
 */
const SELF_EMISSIVE_CHUNK = /* glsl */ `
	totalEmissiveRadiance += diffuseColor.rgb * uSwordEmissive;
`;

/** スキンとプレイヤーの色から、実際に塗る色を決める */
export function swordHexOf(skinIndex: number, colorIndex: number): string {
  const skin = SWORD_SKINS[skinIndex] ?? SWORD_SKINS[0];
  if (!skin.tinted) return skin.hex;
  return (SWORD_COLORS[colorIndex] ?? SWORD_COLORS[0]).hex;
}

/**
 * スキンに対応した剣のマテリアル。
 * @param skinIndex SWORD_SKINS の index
 * @param hex 塗る色。InstancedMesh で instanceColor を使う場合は "#ffffff" を渡す
 */
export function makeSwordMaterial(
  skinIndex: number,
  hex: string
): THREE.MeshPhysicalMaterial {
  const skin = SWORD_SKINS[skinIndex] ?? SWORD_SKINS[0];
  // このシーンには環境マップが無いので metalness=1 の面は真っ黒になる。
  // 「玩具の金属色」として読める範囲まで金属感を落とし、そのぶん自発光で起こす
  const metalness = Math.min(skin.metalness, 0.6);
  // 金属は地の明るさも上げておく。きらめきが来ていないコマで暗く沈むと、
  // 「ときどき光る灰色の剣」になってしまう
  const emissiveK = Math.max(skin.emissive, skin.metalness * 0.36);

  const mat = new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness,
    roughness: skin.roughness,
    // 成型プラスチックの「つるん」としたハイライト。金属スキンでは弱める
    clearcoat: THREE.MathUtils.lerp(1, 0.25, skin.metalness),
    clearcoatRoughness: 0.04 + skin.roughness * 0.12,
    transparent: skin.opacity < 1,
    opacity: skin.opacity,
    // 半透明でもインスタンス同士は前後にソートできないので、深度は書いて
    // チラつきを防ぐ(自分の裏側が透けないだけで、月は透けて見える)
    depthWrite: true,
    emissive: 0x000000, // 自発光は下の onBeforeCompile で「自分の色」から作る
  });

  const uSwordEmissive = { value: emissiveK };
  const uSwordTime = { value: 0 };
  const uSparkle = { value: skin.sparkle ?? 0 };
  const animated = skin.iridescent || (skin.sparkle ?? 0) > 0;
  // 毎フレーム時計を進めてほしいスキンだけ、更新先を userData に置いておく
  if (animated) mat.userData.iriTime = uSwordTime;

  const sparkly = (skin.sparkle ?? 0) > 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwordEmissive = uSwordEmissive;
    if (animated) shader.uniforms.uSwordTime = uSwordTime;
    if (sparkly) {
      shader.uniforms.uSparkle = uSparkle;
      shader.vertexShader =
        `varying float vSparkleY;\nvarying float vSparkleSeed;\n` +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n` + SPARKLE_VERTEX_CHUNK
        );
    }
    shader.fragmentShader =
      `uniform float uSwordEmissive;\n` +
      (animated ? `uniform float uSwordTime;\n` : "") +
      (sparkly
        ? `uniform float uSparkle;\nvarying float vSparkleY;\nvarying float vSparkleSeed;\n`
        : "") +
      shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        // normal と diffuseColor が両方そろっている場所へ差し込む
        `#include <normal_fragment_maps>\n` +
          (skin.iridescent ? IRIDESCENT_CHUNK : "") +
          (sparkly ? SPARKLE_CHUNK : "") +
          SELF_EMISSIVE_CHUNK
      );
  };
  // 差し込む中身がスキンで変わるので、プログラムキャッシュを分ける
  mat.customProgramCacheKey = () =>
    `toy-sword-${skin.iridescent ? "iri" : "solid"}-${sparkly ? "spk" : "flat"}`;

  return mat;
}

/** にじいろ・きらめきの時計をすすめる(毎フレーム呼ぶ)。他のスキンでは何もしない */
export function tickSwordMaterial(mat: THREE.Material, t: number): void {
  const u = mat.userData.iriTime as { value: number } | undefined;
  if (u) u.value = t;
}

// ── 刺さり姿勢(スリットに沿った、全プレイヤーで同じ向き) ────────

const _poseEuler = new THREE.Euler();
const _poseQuat = new THREE.Quaternion();
/** スリットの基底を組むスクラッチ */
const _slotX = new THREE.Vector3();
const _slotY = new THREE.Vector3();
const _slotZ = new THREE.Vector3();
const _slotBasis = new THREE.Matrix4();
/** 房のゆれ計算のスクラッチ(毎フレームの割り当てを避ける) */
const _swayEuler = new THREE.Euler();

/**
 * その穴のスリットに合わせた姿勢。
 * ローカル X = スリットの長辺(= `slotUp()`。経線方向) / Y = 外向き法線 /
 * Z = 短辺(= X × Y)。
 *
 * **穴(`Holes.tsx`)も、刺さった剣も、降ってくる剣も、向きはぜんぶここから取る。**
 * 別々に組み立てると必ずズレて、剣がスリットを横切って刺さってしまうので、
 * 実装はこの1本だけにしておくこと。
 */
export function slotAlignQuat(
  nx: number,
  ny: number,
  nz: number,
  outQuat: THREE.Quaternion
): THREE.Quaternion {
  const u = slotUp([nx, ny, nz]);
  _slotX.set(u[0], u[1], u[2]);
  _slotY.set(nx, ny, nz);
  _slotZ.crossVectors(_slotX, _slotY);
  _slotBasis.makeBasis(_slotX, _slotY, _slotZ);
  return outQuat.setFromRotationMatrix(_slotBasis);
}

/**
 * 穴の法線と holeId から、その穴に刺さる剣のワールド姿勢を組み立てる。
 *
 * 月の穴は丸ではなく **縦長のスリット**(`Holes.tsx`)。板を通している以上、
 * 剣は「刃の平らな面がスリットと同じ平面」にしか入らないので:
 *   ・ロールは `slotUp()`(スリットの長辺 = 経線方向)にきっちりそろえる。
 *     剣ローカルの ±X が刃の幅方向 = 鍔のバーの向きなので、
 *     これをスリットの長辺に合わせると、刃も鍔も縦向きにそろう。
 *   ・傾きは **スリットの面内だけ**。板にはさまれているので横にはコケない。
 *     長辺方向(南北)へ 1.2〜4.2°、holeId から決まる向きにおじぎさせる。
 *   ・半分は前後ひっくり返す(実物も裏表どちらでも刺さる)。180°回しても
 *     刃の面はスリットの中に残るので、これは嘘にならない。
 * 傾き・裏表・大きさは holeId から決定的に決まるので、だれの画面でも同じに見える。
 *
 * 向きの正は上の `slotAlignQuat()` ただ1つ。穴(`Holes.tsx`)も同じ関数を呼んでいる。
 * @returns 大きさの個体差(0.92〜1.08)
 */
export function orientSword(
  normal: THREE.Vector3,
  holeId: number,
  outQuat: THREE.Quaternion
): number {
  slotAlignQuat(normal.x, normal.y, normal.z, outQuat);

  const rng = mulberry32(hashString(`sword-${holeId}`));
  const flip = rng() < 0.5 ? Math.PI : 0; // 裏表
  const tilt =
    THREE.MathUtils.degToRad(randRange(rng, 1.2, 4.2)) *
    (rng() < 0.5 ? -1 : 1);
  // "YXZ" = Ry · Rx · Rz。ロール(Y)は裏返しだけに使い、
  // 倒すのは Z(スリットの短辺)まわり = 長辺方向へのおじぎのみ
  _poseEuler.set(0, flip, tilt, "YXZ");
  _poseQuat.setFromEuler(_poseEuler);
  outQuat.multiply(_poseQuat);
  return randRange(rng, 0.92, 1.08);
}

// ── 剣1本(Mesh版) ──────────────────────────────────

export interface ToySwordOptions {
  /** SWORD_COLORS の index(tinted なスキンのときだけ効く) */
  color: number;
  /** SWORD_SKINS の index */
  skin: number;
  /**
   * 刺して集めたチャームの数(後方互換)。`charms` を渡さないときだけ使われ、
   * 「古い方から charm 個」に読み替えられる。隠しチャームは数では表せないので、
   * 新しい呼び出し側は `charms` を使うこと。
   */
  charm: number;
  /**
   * ぶら下げるチャームを CHARMS の index で直接指定する(古い順)。
   * `src/lib/style.ts` の `charmIndicesOf()` / `charmIndicesFrom()` の返り値を
   * そのまま渡すのが正しい使い方。**上限なし**(何個でもぶら下がる)。
   */
  charms?: number[];
  /** 1 = 月に刺さっている剣と同じ大きさ */
  scale?: number;
  /** 形の細かさ(既定 hero: 単体の剣は近くで見られる) */
  quality?: SwordQuality;
}

export interface ToySword {
  /** シーンに置くルート。位置・向き・大きさは呼び出し側が自由に動かしてよい */
  root: THREE.Group;
  /**
   * opts.scale を持つ内側のグループ。剣ローカルで飾りを足したいとき用。
   * チャームの重さでほんの少し傾いているので、rotation は上書きしないこと
   */
  body: THREE.Group;
  /** 毎フレーム呼ぶ(チャームの揺れ・にじいろの更新用)。t = 経過秒 */
  update: (t: number) => void;
  dispose: () => void;
}

// ── チャームのぶら下げ方(何個でも下げられる) ──────────────
// 実物のY2Kキーチャームと同じ順番で組む:
//   鍔のはし → 親金具(右はスナップフック / 左は丸カン) → 割りカン →
//   長さのちがうチェーン → チャームのカン → チャーム本体
//
// 参考写真の可愛さは「金具でごちゃっとしている」ことなので、**金具は太く大きく**。
// 13個を1本の輪に同じ長さで下げると団子になるので、
//   1. 落差を1個ずつ深くする(チェーンの節を増やす)
//   2. 割りカンのまわりに黄金角(137.5°)で散らして、真上から見ても重ならない
//   3. 深いものほど「刃から離れる向き」へ開く。輪の内側に下げたぶんは余分に開く
//   4. 背の高いチャーム(タッセル・ネームプレート)は浅いところへ逃がして、
//      月面へめり込ませない
// **房は鍔の片はし(右)にひとつだけ。** 一時期は5個以上で左右に振り分けて
// いたが、参考写真のキーホルダーは片側の割りカン1つに全部が下がっている。
// 左右に散らすと、剣を持つ道具ではなく「両側に飾りが付いた置物」に見える。
// つけられるのは10個までなので、片側でも房が剣より大きくなることはない。
/** チャーム1個の大きさ(いちばん長い辺)。数が多いほど少し小ぶりにする */
const CHARM_SIZE_MAX = 0.088;
const CHARM_SIZE_MIN = 0.06;

// ── 金具の寸法 ──
/** 金具の色。磨いたニッケル(クロム) */
const HARDWARE_HEX = "#e7edf8";
/** 目・彫った文字・ひびに使う共通のほぼ黒 */
const DARK_HEX = "#15161a";
/** 房を吊る鍔のはしのx。鍔の先の丸いボスへ金具を通す */
const CLUSTER_X = GUARD_HALF_L - 0.008;
/**
 * スナップフックのかぎの半径。**鍔の先の断面(厚み0.062 × 高さ0.05)を
 * 通せる大きさ**が要るので、ここは見た目より先に物理で決まる。
 */
const HOOK_R = 0.052;
const HOOK_TUBE = 0.0085;
/** かぎの中心から下のカンの中心まで */
const HOOK_LEN = 0.108;
/** 金具の面を少し正面へ向ける(真横向きだと、ただの棒に見える) */
const HOOK_YAW = 0.45;
/** 左の房の親金具(丸カン)の半径。フックと同じく鍔の先を通せる大きさが要る */
const JUMP_R = 0.052;
const JUMP_TUBE = 0.0085;
/** 割りカン(二重巻きのリング)。持っている数がふえるほど大きい輪になる */
const RING_TUBE = 0.0072;
const RING_R_MIN = 0.03;
const RING_R_STEP = 0.005;
const RING_R_STEPS = 4;
/**
 * 割りカンの寝かせ具合(rad)。外側が下がるように傾ける。
 * 傾けた輪の「内側のいちばん高いところ」が親金具に引っかかるので、
 * 輪の中心は親金具より ringR*cos(RING_TILT) だけ外へずれる(下の ringCx)。
 */
const RING_TILT = 0.3;
/** チェーンの節。オーバル(縦長)の輪を90°ずつひねって重ねる */
const LINK_R = 0.0095;
const LINK_TUBE = 0.0034;
const LINK_OVAL = 1.5;
const LINK_PITCH = 0.021;
/** いちばん浅いチャームの落差(= 節ひとつぶん) */
const DROP_MIN = 0.023;
/**
 * 月面から空けておく高さ。ここより下へ垂らさない。
 * 揺れ・ゆらぎの傾き・剣自体の傾きのぶんの余裕も、この値に含めてある。
 */
const MOON_CLEAR = 0.046;
/** 房の届く範囲のうち、いちばん深いチャームに使ってよい割合 */
const DROP_REACH = 0.72;
/**
 * 開き(rad)。深いものほど大きく開く。
 * 開く向きは **割りカンの中心から見た放射方向**(= 束が下へいくほど円錐に
 * 広がる)。全部を同じ向きへ倒すと、深いチャームが浅いチャームの真下へ
 * もぐりこんでぶつかる。
 */
const CHARM_LEAN = 0.14;
const CHARM_LEAN_STEP = 0.03;
/**
 * 放射方向に混ぜる「外向き(刃と反対)」の重み。1より大きくしておくと、
 * 輪の内側に下げたチャームでも開く向きが刃側に回らない = 刃と喧嘩しない。
 */
const CHARM_LEAN_BIAS = 1.15;
/** 黄金角。何個ぶら下げても輪のまわりにきれいに散る */
const CHARM_AZ_STEP = 2.39996;
/** ちきゅうチャームの自転(rad/秒)。小さな地球が生きている感じ */
const EARTH_SPIN = 0.32;
/** 重さの演出: 全部ぶら下げても2.5°まで傾ける */
const WEIGHT_LEAN_MAX = 0.044;
/** 房のゆれが剣に返ってくる量(気づかない程度に)。上限つきで暴れさせない */
const SWAY_GAIN = 0.025;
const SWAY_MAX = 0.012;

// ── 金具のジオメトリ ─────────────────────────────────

/** インデックスをそろえてから結合する(押し出し系は非インデックスなので) */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const fixed = parts.map((g) => {
    g.deleteAttribute("uv");
    if (g.index) return g;
    const indexed = mergeVertices(g, 1e-6);
    if (indexed !== g) g.dispose();
    return indexed;
  });
  if (fixed.length === 1) return fixed[0];
  const merged = mergeGeometries(fixed);
  if (!merged) return fixed[0];
  fixed.forEach((g) => g.dispose());
  return merged;
}

/** 2点をつなぐ細い棒(スナップフックのバネ棒) */
function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  );
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      q,
      new THREE.Vector3(1, 1, 1)
    )
  );
  return g;
}

/**
 * スナップフック(親金具)。原点 = かぎの中心 = 鍔の先が通るところ。
 * ここから -Y へ体が伸び、いちばん下のカンに割りカンがぶら下がる。
 * かぎ先から背へ渡した「バネ棒」があると、ひと目でカラビナに見える。
 */
function makeSnapHook(): THREE.BufferGeometry {
  const R = HOOK_R;
  const at = (deg: number) =>
    new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(deg)) * R,
      Math.sin(THREE.MathUtils.degToRad(deg)) * R,
      0
    );
  const tip = at(205); // かぎ先(口はここから右下へ開いている)
  const pts = [
    tip,
    at(160),
    at(115),
    at(70),
    at(25),
    at(-20),
    at(-58),
    new THREE.Vector3(R * 0.52, -HOOK_LEN * 0.63, 0),
    new THREE.Vector3(R * 0.24, -HOOK_LEN * 0.88, 0),
    new THREE.Vector3(0, -HOOK_LEN, 0),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.4);
  const parts: THREE.BufferGeometry[] = [
    new THREE.TubeGeometry(curve, 36, HOOK_TUBE, 6, false),
  ];
  // 下のカン(ここに割りカンを通す)
  const eye = new THREE.TorusGeometry(R * 0.36, HOOK_TUBE * 0.85, 5, 12);
  eye.translate(0, -HOOK_LEN, 0);
  parts.push(eye);
  // バネ棒。かぎ先から背の途中へ斜めに渡す(参考写真のカラビナと同じ)
  parts.push(
    strut(tip, new THREE.Vector3(R * 0.56, -HOOK_LEN * 0.66, 0), HOOK_TUBE * 0.52)
  );
  // かぎ先の丸め(切りっぱなしだと筒の穴が見える)
  const cap = new THREE.SphereGeometry(HOOK_TUBE, 6, 4);
  cap.translate(tip.x, tip.y, tip.z);
  parts.push(cap);
  const geo = mergeAll(parts);
  geo.scale(1, 1, 0.74); // 打ち抜きの金具らしく、ほんの少し平たくする
  return geo;
}

/**
 * 割りカン(キーリング)。ふつうのトーラスだと輪ゴムに見えるので、
 * 線を2周ぶん巻いて少しずつ高さをずらす。実物のキーリングと同じ作り。
 * 輪の面は水平(= 円周にチャームをばらけさせられる)。
 */
function makeSplitRing(r: number, tube: number): THREE.BufferGeometry {
  const TURNS = 2;
  const SEG = 46;
  const RAD = 6;
  const rise = tube * 1.9; // 2周でこれだけ持ち上がる = 線が重ならない
  const pos: number[] = [];
  const nor: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const a = t * Math.PI * 2 * TURNS;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const cy = rise * (t - 0.5);
    for (let j = 0; j < RAD; j++) {
      const b = (j / RAD) * Math.PI * 2;
      const nx = cx * Math.cos(b);
      const nz = cz * Math.cos(b);
      const ny = Math.sin(b);
      pos.push(cx * r + nx * tube, cy + ny * tube, cz * r + nz * tube);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < RAD; j++) {
      const a0 = i * RAD + j;
      const a1 = i * RAD + ((j + 1) % RAD);
      const b0 = a0 + RAD;
      const b1 = a1 + RAD;
      index.push(a0, b0, b1, a0, b1, a1);
    }
  }
  // 線の切り口(2か所)にフタ。小さいが、開いていると黒い穴として目立つ
  for (const base of [0, SEG * RAD]) {
    for (let j = 1; j < RAD - 1; j++) {
      if (base === 0) index.push(base, base + j + 1, base + j);
      else index.push(base, base + j, base + j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(index);
  return geo;
}

/** チェーン1本。オーバルの節を90°ずつひねって重ねると、輪がつながって見える */
function makeChainGeometry(drop: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.round(drop / LINK_PITCH));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(LINK_R, LINK_TUBE, 5, 9);
    g.scale(1, LINK_OVAL, 1); // 縦長のオーバルにする
    if (i % 2 === 1) g.rotateY(Math.PI / 2);
    g.translate(0, -(i + 0.5) * LINK_PITCH, 0);
    parts.push(g);
  }
  return mergeAll(parts);
}

// ── 素材(ここが「クロムか樹脂か」を決める1か所) ──────────────

/**
 * 金具の「まわりが映っている」感じ。
 *
 * このシーンには環境マップが無いので、metalness=1 の面はそのままだと真っ黒に
 * 沈む(= ただの黒い金属)。PMREM を焼くにはレンダラが要るが、このビルダーは
 * 純粋な関数なので持っていない。そこで **反射ベクトルからその場で環境の色を
 * 計算して** 自発光に足す。上は星あかりの白、下は宇宙の紺、そのあいだに
 * 地平線、下からは月の照り返し。この「地平線が映り込む1本の線」が、
 * 磨いた金属に見えるかどうかを決めている。
 */
const CHARM_ENV_CHUNK = /* glsl */ `
	{
		vec3 envView = normalize( vViewPosition );
		vec3 envDir = inverseTransformDirection( reflect( -envView, normal ), viewMatrix );
		// 空と宇宙。uEnvSharp が小さいほど境目がくっきり = よく磨けている
		float envH = smoothstep( -uEnvSharp, uEnvSharp, envDir.y );
		vec3 envCol = mix( vec3( 0.07, 0.08, 0.16 ), vec3( 0.56, 0.62, 0.85 ), envH );
		// 月の照り返し(下を向いた面が黒く落ちきらないように)
		envCol += vec3( 0.32, 0.33, 0.37 ) * smoothstep( 0.15, -0.55, envDir.y );
		// キーライトとリムライトの映り込み(白くとんだ玉)
		envCol += vec3( 1.5, 1.42, 1.18 )
			* pow( max( dot( envDir, vec3( 0.55, 0.71, 0.44 ) ), 0.0 ), uEnvGloss );
		envCol += vec3( 0.5, 0.62, 0.95 )
			* pow( max( dot( envDir, vec3( -0.29, 0.47, -0.83 ) ), 0.0 ), uEnvGloss * 0.4 );
		// 金属は自分の色で映し、樹脂やガラスは白いまま映す(黒い8ボールの
		// ふちがちゃんと白く光るのはこのため)
		vec3 envTint = mix( vec3( 1.0 ), diffuseColor.rgb, metalnessFactor );
		// ふちほど強く映る(フレネル)
		float envF = pow( 1.0 - max( dot( normal, envView ), 0.0 ), 3.0 );
		totalEmissiveRadiance += envTint * envCol * uEnvK * ( 0.7 + 0.9 * envF );
	}
	totalEmissiveRadiance += diffuseColor.rgb * uCharmEmissive;
`;

/** 素材ごとの見え方。参考写真の「銀 + 黒 + 差し色」を成立させるための数値 */
interface CharmLook {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  opacity: number;
  sheen: number;
  /** 映り込みの強さ */
  env: number;
  /** 地平線のぼけ具合(小さいほどくっきり) */
  sharp: number;
  /** ハイライトの締まり(大きいほど小さく鋭い) */
  gloss: number;
  /** 自分の色で少し光る量(暗い宇宙で色が沈まないように) */
  emissive: number;
}

const CHARM_LOOKS: Record<CharmMaterial, CharmLook> = {
  // 磨いたニッケル。まわりを映すのが仕事なので env は最大、自発光は無し
  chrome: {
    metalness: 1,
    roughness: 0.15,
    clearcoat: 0,
    clearcoatRoughness: 0,
    opacity: 1,
    sheen: 0,
    env: 1,
    sharp: 0.1,
    gloss: 26,
    emissive: 0.02,
  },
  // つやのある不透明プラスチック。クリアコートの照りで「玩具の樹脂」に
  resin: {
    metalness: 0.06,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    opacity: 1,
    sheen: 0,
    env: 0.13,
    sharp: 0.45,
    gloss: 10,
    emissive: 0.3,
  },
  // 透ける樹脂。中で光が回っている感じを自発光で作る
  glass: {
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    opacity: 0.66,
    sheen: 0,
    env: 0.32,
    sharp: 0.28,
    gloss: 18,
    emissive: 0.4,
  },
  // つや消し。ただし8ボールは「つやのある黒」なので、照りは残す
  matte: {
    metalness: 0.1,
    roughness: 0.33,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    opacity: 1,
    sheen: 0,
    env: 0.24,
    sharp: 0.34,
    gloss: 14,
    emissive: 0.06,
  },
  // ひも・布。sheen で毛羽の光を出す
  fabric: {
    metalness: 0,
    roughness: 0.85,
    clearcoat: 0,
    clearcoatRoughness: 0,
    opacity: 1,
    sheen: 1,
    env: 0.1,
    sharp: 0.7,
    gloss: 5,
    emissive: 0.26,
  },
};

/** 素材と色からチャームのマテリアルを作る */
function makeCharmMaterial(
  hex: string,
  kind: CharmMaterial
): THREE.MeshPhysicalMaterial {
  const look = CHARM_LOOKS[kind] ?? CHARM_LOOKS.resin;
  const mat = new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness: look.metalness,
    roughness: look.roughness,
    clearcoat: look.clearcoat,
    clearcoatRoughness: look.clearcoatRoughness,
    transparent: look.opacity < 1,
    opacity: look.opacity,
    depthWrite: true,
    sheen: look.sheen,
    sheenRoughness: 0.7,
    emissive: 0x000000, // 自発光は下の onBeforeCompile で「自分の色」から作る
  });
  const uEnvK = { value: look.env };
  const uEnvSharp = { value: look.sharp };
  const uEnvGloss = { value: look.gloss };
  const uCharmEmissive = { value: look.emissive };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvK = uEnvK;
    shader.uniforms.uEnvSharp = uEnvSharp;
    shader.uniforms.uEnvGloss = uEnvGloss;
    shader.uniforms.uCharmEmissive = uCharmEmissive;
    shader.fragmentShader =
      `uniform float uEnvK;\nuniform float uEnvSharp;\nuniform float uEnvGloss;\nuniform float uCharmEmissive;\n` +
      shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        // normal と diffuseColor が両方そろっている場所へ差し込む
        `#include <normal_fragment_maps>\n` + CHARM_ENV_CHUNK
      );
  };
  mat.customProgramCacheKey = () => "kk-charm";
  return mat;
}

/** 剣1本ぶんのマテリアル置き場(同じ素材・同じ色なら使い回す) */
class CharmPalette {
  private readonly cache = new Map<string, THREE.MeshPhysicalMaterial>();

  get(hex: string, kind: CharmMaterial): THREE.MeshPhysicalMaterial {
    const key = `${kind}|${hex}`;
    let m = this.cache.get(key);
    if (!m) {
      m = makeCharmMaterial(hex, kind);
      // ひび(球にはりついた1枚の帯)は折り返しの角で裏返るので両面で描く。
      // ほかの部品は閉じた立体なので、両面にしても見た目は変わらない
      if (kind === "matte" && hex === DARK_HEX) m.side = THREE.DoubleSide;
      this.cache.set(key, m);
    }
    return m;
  }

  /** 塗り分け(charmGeometry の CharmPaint)から実際のマテリアルを引く */
  forPaint(charm: Charm, paint: CharmPaint): THREE.MeshPhysicalMaterial {
    switch (paint) {
      case "chrome":
        return this.get(HARDWARE_HEX, "chrome");
      case "dark":
        return this.get(DARK_HEX, "matte");
      case "accent":
        // 差し色は「地と同じ作りの樹脂」。布のチャームだけひもの色にする
        return this.get(
          charm.accentHex ?? charm.hex,
          charm.material === "fabric" ? "fabric" : "resin"
        );
      default:
        return this.get(charm.hex, charm.material);
    }
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}

// ── 房の割りつけ ────────────────────────────────────

/** 房ひとつ(鍔の片はし)の金具 */
interface CharmCluster {
  /** +1 = 鍔の右はし / -1 = 左はし */
  side: number;
  /** 親金具にスナップフックを使うか(右だけ true) */
  hook: boolean;
  /** 割りカンの半径 */
  ringR: number;
  /** 割りカンの中心。親金具に引っかかる位置から逆算した値(剣ローカル) */
  ringCx: number;
  ringCy: number;
}

/** チャーム1個ぶんの割りつけ */
interface CharmSpot {
  /** CHARMS の index */
  charmIndex: number;
  /** 形の部品(高さを見てから落差を決めるので、先に作ってある) */
  build: CharmBuild;
  cluster: CharmCluster;
  /** 支点(割りカンの上の1点)。剣ローカルの座標そのもの */
  pivot: THREE.Vector3;
  /** 割りカンのどこから下げるか(rad) */
  az: number;
  /** 吊り点からチャーム上端までの落差 */
  drop: number;
  /** 開く量(rad)と、その回転軸(水平面内。下向きベクトルを開く向きへ倒す) */
  lean: number;
  leanAxis: THREE.Vector3;
  /** 見た目のゆらぎ(整列させないための、ちょっとした傾き) */
  tilt: number;
  /** ふりこの速さ・振れ幅・位相 */
  speed: number;
  amp: number;
  phase: number;
}

/** 数が多いほど少し小ぶりにする(13個でも房が団子にならないように) */
function charmSizeFor(n: number): number {
  return THREE.MathUtils.lerp(
    CHARM_SIZE_MAX,
    CHARM_SIZE_MIN,
    THREE.MathUtils.clamp((n - 4) / 9, 0, 1)
  );
}

/**
 * チャームの index 配列(古い順)から、房の割りつけを決める。
 * 古い順に 右→左→右→… と配るので、**いちばん新しいチャームは必ず
 * 右の房のいちばん下(いちばん長いチェーン)**に来る。
 * 隠しチャーム「ちきゅう」は配列の最後に来る約束なので、自然にいちばん目立つ。
 */
function layoutCharms(
  list: number[],
  builds: CharmBuild[]
): { spots: CharmSpot[]; clusters: CharmCluster[] } {
  const sides = [1];
  // 割りカンの大きさは「その房に何個下がるか」で決まるので、まず数だけ数える
  const counts = sides.map((_, si) =>
    list.reduce((a, _c, i) => a + (i % sides.length === si ? 1 : 0), 0)
  );
  const clusters: CharmCluster[] = sides.map((side, si) => {
    const hook = side > 0;
    // 割りカンが引っかかる場所。右はスナップフックの下のカン、左は丸カンの底。
    // 右のほうが低い位置から垂れるので、左右で房の長さが自然にちがう
    const anchorY = hook ? GUARD_Y - HOOK_LEN : GUARD_Y - JUMP_R;
    const ringR = RING_R_MIN + RING_R_STEP * Math.min(counts[si] - 1, RING_R_STEPS);
    return {
      side,
      hook,
      ringR,
      // 傾いた輪の「内側のてっぺん」が anchor に来るよう、中心を外へずらす
      ringCx: ringR * Math.cos(RING_TILT),
      ringCy: anchorY - ringR * Math.sin(RING_TILT),
    };
  });

  const used = sides.map(() => 0);
  const spots: CharmSpot[] = [];
  list.forEach((charmIndex, i) => {
    const si = i % sides.length;
    const cluster = clusters[si];
    const k = used[si]++;
    const n = counts[si];
    const az = k * CHARM_AZ_STEP + (cluster.side < 0 ? 1.1 : 0);
    // 支点は傾いた割りカンの円周上。方位によって高さも少しずつちがう
    const rx = Math.cos(az) * cluster.ringR;
    const pivot = new THREE.Vector3(
      (CLUSTER_X + cluster.ringCx + rx * Math.cos(RING_TILT)) * cluster.side,
      cluster.ringCy - rx * Math.sin(RING_TILT),
      Math.sin(az) * cluster.ringR
    );
    // 落差のはしご。等間隔だと「整列」して見えるので、黄金比のあまりでゆらす
    const t = n <= 1 ? 0.5 : k / (n - 1);
    const wobble = 0.8 + 0.4 * ((k * 0.6180339887) % 1);
    // 房ぜんぶで同じはしごを使いたいので、いちばん低い支点を基準にする
    const reach = cluster.ringCy - cluster.ringR * Math.sin(RING_TILT) - MOON_CLEAR;
    const deep = Math.max(DROP_MIN, reach * DROP_REACH);
    let drop = (DROP_MIN + (deep - DROP_MIN) * t) * wobble;
    // 背の高いチャーム(タッセル・ネームプレート)は浅いところへ逃がす
    drop = THREE.MathUtils.clamp(
      Math.min(drop, pivot.y - MOON_CLEAR - builds[i].height),
      DROP_MIN,
      deep
    );
    const shallow = DROP_MIN / drop; // 1 = いちばん浅い
    // 開く向き: 割りカンの中心から見た放射方向に、外向きを混ぜたもの
    const dir = new THREE.Vector3(
      (Math.cos(az) + CHARM_LEAN_BIAS) * cluster.side,
      0,
      Math.sin(az)
    ).normalize();
    spots.push({
      charmIndex,
      build: builds[i],
      cluster,
      pivot,
      az,
      drop,
      lean: CHARM_LEAN + CHARM_LEAN_STEP * k,
      // 下向き(0,-1,0)を dir へ倒す回転の軸
      leanAxis: new THREE.Vector3(-dir.z, 0, dir.x),
      tilt: (((k * 0.7548776662) % 1) - 0.5) * 0.5,
      // ふりこは長いほど遅い。振れ幅も小さくして、深いチャーム同士が
      // ぶつからないようにしつつ「重そう」に見せる
      speed: 2.6 * Math.pow(shallow, 0.4),
      amp: 0.13 * Math.pow(shallow, 0.25),
      phase: k * 1.9 + (cluster.side < 0 ? 0.7 : 0),
    });
  });
  return { spots, clusters };
}

/**
 * 剣1本ぶんの Group を作る。原点=刺さり口、+Y=柄の方向、刃先は -Y に伸びる。
 * InstancedMesh が使えない「主役の1本」用。1000本には使わないこと。
 */
export function buildToySword(opts: ToySwordOptions): ToySword {
  const skinIndex =
    opts.skin >= 0 && opts.skin < SWORD_SKINS.length ? opts.skin : 0;
  const quality = opts.quality ?? "hero";

  const geometry = makeToySwordGeometry(quality);
  const material = makeSwordMaterial(skinIndex, swordHexOf(skinIndex, opts.color));
  const sword = new THREE.Mesh(geometry, material);

  const body = new THREE.Group();
  body.scale.setScalar(opts.scale ?? 1);
  body.add(sword);
  const root = new THREE.Group();
  root.add(body);

  // ── チャーム(持っているぶん全部。上限なし) ──
  // 何を下げるかは `src/lib/style.ts` の charmIndicesOf/From が正。
  // ここで独自に「新しい方から3個」のような間引きはしない
  // 知らない番号が混じっていても落ちないよう、ここで一度だけふるいにかける
  const list = (opts.charms ?? charmIndicesFrom(opts.charm, false)).filter(
    (i) => !!CHARMS[i]
  );

  const charmGeos: THREE.BufferGeometry[] = [];
  const palette = new CharmPalette();
  const swings: {
    pivot: THREE.Group;
    side: number;
    /** 開いた姿勢(これにふりこの揺れを掛け合わせる) */
    rest: THREE.Quaternion;
    amp: number;
    speed: number;
    phase: number;
    /** ゆれの反動を剣に返すときの重み(長くぶら下がっているほど効く) */
    weight: number;
    /** ちきゅうだけ: 自転させる本体 */
    spin: THREE.Object3D | null;
  }[] = [];

  // たくさん下げるほど、剣は房の側へほんの少しおじぎする(重そうに見せる)。
  // 左右に振り分けても、いちばん新しいチャームのある右の房がいつも1個ぶん
  // 重いので、傾く向きは常に +X。全部下げても2.5°までなので、
  // 「なんとなく重そう」で止まって刺さり方が変には見えない
  const weightLean =
    WEIGHT_LEAN_MAX * THREE.MathUtils.clamp((list.length - 1) / 12, 0, 1);

  if (list.length > 0) {
    const size = charmSizeFor(list.length);
    // 落差は「そのチャームの背の高さ」を見てから決めるので、形が先
    const builds = list.map((ci) => makeCharmParts(CHARMS[ci].shape, size));
    const { spots, clusters } = layoutCharms(list, builds);
    const chromeMat = palette.get(HARDWARE_HEX, "chrome");

    // ── 親金具 + 割りカン(房ごとに1本のジオメトリへまとめる) ──
    for (const c of clusters) {
      const parts: THREE.BufferGeometry[] = [];
      if (c.hook) {
        const hook = makeSnapHook();
        hook.rotateY(Math.PI / 2 - HOOK_YAW); // 面をすこし正面へ
        hook.translate(0, GUARD_Y, 0);
        parts.push(hook);
      } else {
        const jump = new THREE.TorusGeometry(JUMP_R, JUMP_TUBE, 6, 18);
        jump.rotateY(Math.PI / 2 - HOOK_YAW);
        jump.translate(0, GUARD_Y, 0);
        parts.push(jump);
      }
      const ring = makeSplitRing(c.ringR, RING_TUBE);
      ring.rotateZ(-RING_TILT); // 外側が下がるように寝かせる
      ring.translate(c.ringCx, c.ringCy, 0);
      parts.push(ring);
      const geo = mergeAll(parts);
      // 房ぜんぶを鍔のはしへ。左の房は Y まわりに180°回して持っていく
      // (鏡像にすると面が裏返るので、必ず回転で作ること)
      if (c.side < 0) geo.rotateY(Math.PI);
      geo.translate(CLUSTER_X * c.side, 0, 0);
      charmGeos.push(geo);
      body.add(new THREE.Mesh(geo, chromeMat));
    }

    // ── チャーム(割りカンの円周から、長さをばらして垂らす) ──
    for (const spot of spots) {
      const charm = CHARMS[spot.charmIndex];
      const c = spot.cluster;
      // 支点は割りカンの円周上の1点(傾けた輪に沿うので、高さも少しずつちがう)
      const pivot = new THREE.Group();
      pivot.position.copy(spot.pivot);

      // チャームの向き。板の面を輪の外向きにすると、ぐるりと散らばった房が
      // どの角度から見ても何個かは正面を向いている状態になる。
      // そこへ少しだけゆらぎを足して「整列していない」ようにする
      const facing = c.side * (Math.PI / 2 - spot.az) + spot.tilt * 0.6;
      const xform = new THREE.Matrix4().compose(
        new THREE.Vector3(0, -spot.drop, 0),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, facing, spot.tilt, "YXZ")
        ),
        new THREE.Vector3(1, 1, 1)
      );

      // 動かない部品はチェーンと1本に溶かして、ドローコールを増やさない
      const chrome: THREE.BufferGeometry[] = [makeChainGeometry(spot.drop)];
      const spinner = spot.build.spin ? new THREE.Group() : null;
      const byPaint = new Map<CharmPaint, THREE.BufferGeometry[]>();
      for (const part of spot.build.parts) {
        if (spot.build.spin && part.paint !== "chrome") {
          // ちきゅうは本体だけ回す(カンまで回ると、輪がくるくるして見える)
          spinner?.add(new THREE.Mesh(part.geo, palette.forPaint(charm, part.paint)));
          charmGeos.push(part.geo);
          continue;
        }
        part.geo.applyMatrix4(xform);
        if (part.paint === "chrome") chrome.push(part.geo);
        else {
          const bucket = byPaint.get(part.paint) ?? [];
          bucket.push(part.geo);
          byPaint.set(part.paint, bucket);
        }
      }
      const chromeGeo = mergeAll(chrome);
      charmGeos.push(chromeGeo);
      pivot.add(new THREE.Mesh(chromeGeo, chromeMat));
      byPaint.forEach((geos, paint) => {
        const merged = mergeAll(geos);
        charmGeos.push(merged);
        pivot.add(new THREE.Mesh(merged, palette.forPaint(charm, paint)));
      });
      if (spinner) {
        // 球なので向きはどうでもよい。位置だけチェーンの先へ
        spinner.position.set(0, -spot.drop, 0);
        pivot.add(spinner);
      }

      // 下向きを「割りカンの外へ広がる向き」へ倒す = 束が円錐に開く
      const rest = new THREE.Quaternion().setFromAxisAngle(
        spot.leanAxis,
        spot.lean
      );
      pivot.quaternion.copy(rest);
      body.add(pivot);
      swings.push({
        pivot,
        side: c.side,
        rest,
        amp: spot.amp,
        speed: spot.speed,
        phase: spot.phase,
        weight: spot.drop,
        spin: spinner,
      });
    }
  }

  if (weightLean > 0) body.rotation.z = -weightLean;

  const update = (t: number) => {
    tickSwordMaterial(material, t);
    let react = 0;
    for (const s of swings) {
      // ふりこ。前後(x)はゆっくりにして、機械的な往復に見えないようにする。
      // 長いチェーンほど遅く小さく揺れるので、13個でも位相がばらけたまま。
      // 開いた姿勢(rest)は保ったまま、その上へ小さな揺れを掛ける
      const sw = Math.sin(t * s.speed + s.phase);
      _swayEuler.set(
        s.amp * 0.75 * Math.sin(t * s.speed * 0.77 + s.phase * 1.7),
        0,
        s.side * s.amp * sw
      );
      s.pivot.quaternion
        .setFromEuler(_swayEuler)
        .multiply(s.rest);
      react += s.side * sw * s.weight;
      if (s.spin) s.spin.rotation.y = t * EARTH_SPIN; // ちきゅうの自転
    }
    if (swings.length > 0) {
      // 房のゆれの反動で剣もわずかに揺り返す(左右にそろって振れたときだけ効く)
      body.rotation.z =
        -weightLean - THREE.MathUtils.clamp(react * SWAY_GAIN, -SWAY_MAX, SWAY_MAX);
    }
  };

  return {
    root,
    body,
    update,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      charmGeos.forEach((g) => g.dispose());
      palette.dispose();
    },
  };
}
