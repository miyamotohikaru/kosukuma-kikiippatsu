// チャーム(剣にぶら下げる小さなかざり)の形。
// 狙いは **Y2Kのキーチャーム**。クロムの金具が主役で、そこへ つやのある樹脂の
// モチーフが混ざり、長さのちがうものが束になって ちょっとごちゃっとしている。
// 画像アセットを足さない方針なので、13種すべてを数式・回転体・丸めた箱で組む。
//
// いちばん大事なのは「ぺたっとした板にしない」こと。輪郭を押し出しただけの形は
// 小さくすると ただの色の点になってしまう。ふくらませた枕(inflate)・球・
// 丸めた箱で **立体** として作り、面取りのハイライトに素材をしゃべらせる。
//
// 座標の約束:
//   原点 = ぶら下げ点(= てっぺんのカンの上端)。チャームは原点から下(-Y)へ
//   垂れ、正面は +Z。呼び出し側はチェーンの先へ置くだけで正しくぶら下がる。
//
// 色は付けない。ここが返すのは「どの塗り分けに属する形か」までで、
// 実際の質感(クロム/樹脂/ガラス/つや消し/布)は buildSword.ts が決める。

import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CharmShape } from "@/lib/config";

// ── 部品の塗り分け ────────────────────────────────────

/**
 * 部品をどの色で塗るか。
 * - `body`   … チャームの地の色(config の hex)
 * - `accent` … 差し色(config の accentHex。水玉・くちばし・大陸など)
 * - `dark`   … 共通のほぼ黒(目・鼻・彫った文字・8の数字・ひび)
 * - `chrome` … 共通のクロム(カン・口金・石突きなどの金具)
 */
export type CharmPaint = "body" | "accent" | "dark" | "chrome";

export interface CharmPart {
  geo: THREE.BufferGeometry;
  paint: CharmPaint;
}

export interface CharmBuild {
  /** 塗り分けごとに1本にまとめた部品(呼び出し側でそのまま Mesh にできる) */
  parts: CharmPart[];
  /** 原点から下へどれだけ垂れるか。月にぶつけないための見積もりに使う */
  height: number;
  /**
   * true = ゆっくり自転させる(ちきゅうだけ)。
   * **回すのは `chrome` 以外の部品だけ**。カンまで一緒に回すと、
   * チェーンにつながっている輪がくるくる回って見えてしまう。
   */
  spin: boolean;
}

/** 組み立て中の部品置き場 */
type Bag = { geo: THREE.BufferGeometry; paint: CharmPaint }[];

function put(
  bag: Bag,
  geo: THREE.BufferGeometry,
  paint: CharmPaint = "body"
): THREE.BufferGeometry {
  bag.push({ geo, paint });
  return geo;
}

// ── 形づくりの小道具 ──────────────────────────────────

const _obj = new THREE.Object3D();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

/** ジオメトリを置く。回転はラジアン、s は倍率(数値ひとつなら等倍) */
function xf(
  geo: THREE.BufferGeometry,
  p?: [number, number, number],
  r?: [number, number, number],
  s?: [number, number, number] | number
): THREE.BufferGeometry {
  _obj.position.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0);
  _obj.rotation.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0);
  if (typeof s === "number") _obj.scale.setScalar(s);
  else _obj.scale.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1);
  _obj.updateMatrix();
  geo.applyMatrix4(_obj.matrix);
  return geo;
}

/** 球の表面 dir の位置へ、+Y を法線に合わせて貼りつける(水玉・目・鼻) */
function onSphere(
  geo: THREE.BufferGeometry,
  dir: THREE.Vector3,
  radius: number
): THREE.BufferGeometry {
  const d = dir.clone().normalize();
  _quat.setFromUnitVectors(_up, d);
  _obj.position.copy(d).multiplyScalar(radius);
  _obj.quaternion.copy(_quat);
  _obj.scale.setScalar(1);
  _obj.updateMatrix();
  geo.applyMatrix4(_obj.matrix);
  return geo;
}

/** マージできる形にそろえる(uvは使わないので捨てる。無いと結合が失敗する) */
function prep(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute("uv");
  geo.deleteAttribute("uv1");
  geo.deleteAttribute("uv2");
  if (geo.index) return geo;
  const indexed = mergeVertices(geo, 1e-6);
  if (indexed !== geo) geo.dispose();
  return indexed;
}

/** 球。小さい部品なので分割は控えめ */
function ball(r: number, seg = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)));
}

/** 平たい水玉(球を潰したもの)。乗せる面の法線が +Y になる向きで返す */
function stud(r: number, flat = 0.4): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 6);
  g.scale(1, flat, 1);
  return g;
}

/** 角の丸い箱。サイコロ・南京錠の本体・ネームプレートの土台に使う */
function roundedBox(
  w: number,
  h: number,
  d: number,
  r: number,
  seg = 2
): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - r;
  const y = h / 2 - r;
  s.moveTo(-x, -h / 2);
  s.lineTo(x, -h / 2);
  s.absarc(x, -y, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, y);
  s.absarc(x, y, r, 0, Math.PI / 2, false);
  s.lineTo(-x, h / 2);
  s.absarc(-x, y, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -y);
  s.absarc(-x, -y, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  const bt = Math.min(r * 0.9, d * 0.34);
  const depth = d - bt * 2;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bt,
    bevelSegments: seg,
    curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** 数値の組から点列へ(見た目の座標をそのまま書けるように) */
function v2(xy: number[][]): THREE.Vector2[] {
  return xy.map(([x, y]) => new THREE.Vector2(x, y));
}

/** 閉じた点列の符号つき面積。向き(左回り/右回り)をそろえるのに使う */
function signedArea(pts: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 閉じた点列を、周の長さで n 等分に取りなおす(ふくらませる前の下ごしらえ) */
function resample(pts: THREE.Vector2[], n: number): THREE.Vector2[] {
  const N = pts.length;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const d = pts[i].distanceTo(pts[(i + 1) % N]);
    segs.push(d);
    total += d;
  }
  const out: THREE.Vector2[] = [];
  let seg = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < N - 1 && acc + segs[seg] < target) {
      acc += segs[seg];
      seg++;
    }
    const t = segs[seg] > 1e-9 ? (target - acc) / segs[seg] : 0;
    out.push(new THREE.Vector2().lerpVectors(pts[seg], pts[(seg + 1) % N], t));
  }
  return out;
}

/**
 * 閉じた2D輪郭を「空気を入れた枕」にする。**このゲームのチャームの背骨**。
 *
 * 輪郭をだんだん重心へ縮めながら持ち上げていくので、押し出した板とちがって
 * まんなかが山になり、ふちが丸くなる。ぷっくりハート・ぷっくり星・
 * いなずま・つばさの羽根は、ぜんぶこれ1本で作る。
 *
 * @param halfThick 片側のふくらみ(輪郭の座標系での高さ)
 * @param rings ふくらみの分割。3で十分まるい
 * @param power 小さいほど「ふちまでパンパン」、大きいほど「なで肩」
 */
function inflate(
  src: THREE.Vector2[],
  halfThick: number,
  rings = 3,
  power = 0.55
): THREE.BufferGeometry {
  const pts = signedArea(src) < 0 ? [...src].reverse() : src;
  const N = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= N;
  cy /= N;

  const pos: number[] = [];
  const index: number[] = [];
  const push = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };

  const edge: number[] = pts.map((p) => push(p.x, p.y, 0));
  for (const side of [1, -1]) {
    let prev = edge;
    for (let r = 1; r < rings; r++) {
      const a = (r / rings) * Math.PI * 0.5;
      const k = Math.pow(Math.cos(a), power);
      const z = side * halfThick * Math.sin(a);
      const cur = pts.map((p) =>
        push(cx + (p.x - cx) * k, cy + (p.y - cy) * k, z)
      );
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        // 左回りの輪郭なので、+Z側は (外, 外の次, 内の次) が表向きになる
        if (side > 0) {
          index.push(prev[i], prev[j], cur[j], prev[i], cur[j], cur[i]);
        } else {
          index.push(prev[i], cur[j], prev[j], prev[i], cur[i], cur[j]);
        }
      }
      prev = cur;
    }
    const pole = push(cx, cy, side * halfThick);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (side > 0) index.push(prev[i], prev[j], pole);
      else index.push(prev[j], prev[i], pole);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// ── 輪郭 ────────────────────────────────────────────

/** ほし: 5角星。頂点をひとつ真上に向ける */
function starPoints(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * 0.47;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}

/** ハート: おなじみのハート曲線。上の谷が真上に来る */
function heartPoints(n = 40): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    pts.push(new THREE.Vector2((x / 16) * 0.5, (y / 16) * 0.5));
  }
  return pts;
}

/** いなずま: 上の角から一度左へ折れ、段をつけて下の先へ落ちる */
function boltPoints(): THREE.Vector2[] {
  return v2([
    [0.15, 0.5],
    [-0.17, 0.05],
    [0.01, 0.05],
    [-0.12, -0.5],
    [0.19, -0.01],
    [0.01, -0.01],
  ]);
}

/** つばさの羽根1枚。付け根がまるく、先がすっと細くなる木の葉 */
function featherPoints(len: number, wide: number, n = 14): THREE.Vector2[] {
  const top: THREE.Vector2[] = [];
  const bottom: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = wide * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85);
    top.push(new THREE.Vector2(t * len, w));
    bottom.push(new THREE.Vector2(t * len, -w * 0.62));
  }
  return [...top, ...bottom.reverse()];
}

/** 角の丸い長方形の輪郭(ネームプレート用) */
function roundedRectPoints(
  w: number,
  h: number,
  r: number,
  per = 4
): THREE.Vector2[] {
  const x = w / 2 - r;
  const y = h / 2 - r;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [x, y, 0],
    [-x, y, Math.PI / 2],
    [-x, -y, Math.PI],
    [x, -y, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = a0 + (i / per) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return pts;
}

// ── 13種の組み立て ───────────────────────────────────
// どれも「単位空間」(いちばん長い辺 ≒ 1)で作り、finish() で size 倍する。

/** サイコロ: 白い樹脂の丸い角のキューブに、黒い目がぷつぷつ乗っている */
function buildDice(bag: Bag): void {
  const S = 0.86;
  const half = S / 2;
  put(bag, roundedBox(S, S, S, S * 0.17), "body");

  // 目。正面(+Z)に5・右(+X)に3・上(+Y)に1。3面見えるように後で傾ける
  const pip = (x: number, y: number, z: number, axis: "x" | "y" | "z") => {
    const g = stud(S * 0.105, 0.42);
    if (axis === "z") xf(g, [x, y, z], [Math.PI / 2, 0, 0]);
    else if (axis === "x") xf(g, [x, y, z], [0, 0, -Math.PI / 2]);
    else xf(g, [x, y, z]);
    put(bag, g, "accent");
  };
  const d = half * 0.98;
  const o = S * 0.26;
  // 5(正面)
  for (const [px, py] of [
    [-o, o],
    [o, o],
    [0, 0],
    [-o, -o],
    [o, -o],
  ])
    pip(px, py, d, "z");
  // 3(右)
  for (const [py, pz] of [
    [o, -o],
    [0, 0],
    [-o, o],
  ])
    pip(d, py, pz, "x");
  // 1(上)
  pip(0, d, 0, "y");

  // わざと斜めに吊る(まっすぐだと積み木に見える)
  for (const it of bag) xf(it.geo, undefined, [0.3, -0.42, 0.16]);
}

/** ほし: ぷっくりふくらんだクロムの星。参考写真の銀の星と同じ肉づき */
function buildStar(bag: Bag): void {
  const pts = resample(starPoints(), 45);
  put(bag, inflate(pts, 0.19, 3, 0.5), "body");
}

/** ハート: 鏡になるくらい磨いた、ぷっくりのクロムハート(このセットの主役) */
function buildHeart(bag: Bag): void {
  const pts = resample(heartPoints(), 44);
  put(bag, inflate(pts, 0.235, 4, 0.5), "body");
}

/** きのこ: 赤いかさに白い水玉、白い軸。Y2Kの定番 */
function buildMushroom(bag: Bag): void {
  const R = 0.46;
  // かさ(半球を少し潰す)
  const cap = new THREE.SphereGeometry(R, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.82, 1);
  put(bag, cap, "body");
  // かさの裏(開けっぱなしだと中が見えるのでフタをする)
  const under = new THREE.CircleGeometry(R, 18);
  put(bag, xf(under, [0, 0, 0], [Math.PI / 2, 0, 0]), "accent");
  // 軸
  const stem = new THREE.CylinderGeometry(R * 0.42, R * 0.52, R * 0.95, 12);
  put(bag, xf(stem, [0, -R * 0.44, 0]), "accent");
  // 水玉
  const dots: [number, number, number, number][] = [
    [0.1, 0.9, 0.42, 0.115],
    [-0.62, 0.62, 0.48, 0.095],
    [0.6, 0.5, -0.62, 0.085],
    [-0.2, 0.42, -0.88, 0.08],
    [0.88, 0.34, 0.34, 0.075],
  ];
  for (const [dx, dy, dz, r] of dots) {
    const g = stud(R * r * 2.2, 0.34);
    onSphere(g, new THREE.Vector3(dx, dy * 1.22, dz), R * 0.99);
    g.scale(1, 0.82, 1); // かさを潰したぶんに合わせる
    put(bag, g, "accent");
  }
}

/** エイトボール: つやのある黒い球に、白い丸と黒い「8」 */
function buildEightBall(bag: Bag): void {
  const R = 0.46;
  put(bag, ball(R, 18), "body");
  // 白い丸(球にちょっと めり込ませた平たいドーム)
  const disc = stud(R * 0.44, 0.55);
  onSphere(disc, new THREE.Vector3(0, 0, 1), R * 0.9);
  put(bag, disc, "accent");
  // 「8」は輪をふたつ重ねるだけで読める。白い丸へ半分うずめて「印刷」に見せる
  for (const [y, r] of [
    [0.052, 0.072],
    [-0.055, 0.086],
  ]) {
    const ring = new THREE.TorusGeometry(r, 0.024, 4, 12);
    put(bag, xf(ring, [0, y, 0.505]), "dark");
  }
}

/** 南京錠: つるんとしたクロムの本体 + 太いつる + 鍵穴 */
function buildPadlock(bag: Bag): void {
  const W = 0.62;
  const H = 0.54;
  const D = 0.3;
  put(bag, roundedBox(W, H, D, 0.1), "body");
  // つる(半分のトーラス)。両足を本体へ差し込む
  const shR = W * 0.31;
  const tube = 0.048;
  const arc = new THREE.TorusGeometry(shR, tube, 6, 14, Math.PI);
  put(bag, xf(arc, [0, H * 0.42, 0]), "body");
  for (const s of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(tube, tube, H * 0.42, 7);
    put(bag, xf(leg, [s * shR, H * 0.25, 0]), "body");
  }
  // 鍵穴(丸 + 下へ広がるスリット)
  const hole = new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10);
  put(bag, xf(hole, [0, 0.03, D * 0.47], [Math.PI / 2, 0, 0]), "dark");
  const slit = new THREE.BoxGeometry(0.055, 0.13, 0.05);
  put(bag, xf(slit, [0, -0.06, D * 0.47]), "dark");
}

/** アヒル: おふろの黄色いアヒル。丸をつなぐだけで、あの形になる */
function buildDuck(bag: Bag): void {
  const body = ball(0.36, 14);
  put(bag, xf(body, [0, -0.06, -0.02], undefined, [1, 0.84, 1.12]), "body");
  const head = ball(0.24, 14);
  put(bag, xf(head, [0, 0.32, 0.09]), "body");
  // しっぽ(ぴんと立てる)
  const tail = new THREE.ConeGeometry(0.15, 0.3, 8);
  put(bag, xf(tail, [0, 0.06, -0.38], [1.1, 0, 0]), "body");
  // くちばし。おふろのアヒルの目印なので、大きめにはっきり出す
  const bill = new THREE.ConeGeometry(0.135, 0.26, 7);
  put(bag, xf(bill, [0, 0.27, 0.28], [Math.PI / 2 + 0.3, 0, 0], [1.5, 1, 0.62]), "accent");
  // 目(あたまの球の表面へ半分うずめる)
  for (const s of [-1, 1]) {
    const eye = ball(0.033, 8);
    put(bag, xf(eye, [s * 0.104, 0.402, 0.269]), "dark");
  }
}

/** いなずま: 面取りの効いた金属のいなずま。ふくらみは控えめで角を立てる */
function buildBolt(bag: Bag): void {
  const pts = resample(boltPoints(), 34);
  put(bag, inflate(pts, 0.085, 2, 0.8), "body");
}

/** つばさ: 羽根を5枚あおいで重ねる。1枚板の翼にしないのがコツ */
function buildWing(bag: Bag): void {
  const specs: [number, number, number, number][] = [
    // 長さ, 幅, 角度(rad), 前後のずらし
    [0.86, 0.115, -0.16, 0.0],
    [0.8, 0.11, -0.42, -0.016],
    [0.7, 0.1, -0.72, -0.03],
    [0.58, 0.092, -1.02, -0.042],
    [0.44, 0.082, -1.34, -0.052],
  ];
  for (const [len, wide, ang, dz] of specs) {
    const g = inflate(resample(featherPoints(len, wide), 26), 0.032, 2, 0.7);
    put(bag, xf(g, [0, 0, dz], [0, 0, ang]), "body");
  }
  // 付け根の玉(羽根の根元をまとめて、カンを付ける場所にする)
  put(bag, xf(ball(0.1, 12), [0.02, 0.02, 0], undefined, [1, 1, 0.72]), "body");
}

/** ネームプレートの文字。太い棒(始点→終点)の組み合わせだけで書く */
const LETTER_STROKES: Record<string, number[][]> = {
  L: [
    [-0.26, 0.5, -0.26, -0.5],
    [-0.3, -0.46, 0.3, -0.46],
  ],
  U: [
    [-0.3, 0.5, -0.3, -0.2],
    [-0.3, -0.24, -0.08, -0.47],
    [-0.1, -0.47, 0.1, -0.47],
    [0.08, -0.47, 0.3, -0.24],
    [0.3, -0.2, 0.3, 0.5],
  ],
  C: [
    [0.3, 0.3, 0.06, 0.5],
    [0.1, 0.5, -0.26, 0.28],
    [-0.26, 0.32, -0.26, -0.32],
    [-0.26, -0.28, 0.1, -0.5],
    [0.06, -0.5, 0.3, -0.3],
  ],
  K: [
    [-0.28, 0.5, -0.28, -0.5],
    [-0.3, 0.0, 0.28, 0.5],
    [-0.3, 0.0, 0.3, -0.5],
  ],
  Y: [
    [-0.3, 0.5, 0.0, 0.02],
    [0.3, 0.5, 0.0, 0.02],
    [0.0, 0.06, 0.0, -0.5],
  ],
};

/**
 * ネームプレート: 銀の板に文字を彫ったやつ。参考写真の "Lucky" と同じ
 * 「横に寝かせた文字が縦に並ぶ」置き方にする(危機一髪 = lucky のしゃれ)。
 */
function buildPlate(bag: Bag): void {
  const W = 0.42;
  const H = 1.3;
  const half = 0.062;
  put(bag, inflate(roundedRectPoints(W, H, 0.16, 4), half, 2, 0.7), "body");

  const word = "LUCKY";
  const cell = 0.235; // 板の縦方向に1文字が使う幅
  const tall = 0.3; // 板の横方向(= 文字の背の高さ)
  const stroke = 0.062;
  const top = ((word.length - 1) / 2) * cell;
  word.split("").forEach((ch, i) => {
    const strokes = LETTER_STROKES[ch];
    if (!strokes) return;
    for (const [x0, y0, x1, y1] of strokes) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const bar = new THREE.BoxGeometry(len + stroke, stroke, 1);
      // 文字ローカル → 板の上(90°寝かせる)→ 縦に並べる
      xf(bar, [(x0 + x1) / 2, (y0 + y1) / 2, 0], [0, 0, Math.atan2(dy, dx)]);
      xf(
        bar,
        [0, top - i * cell, half * 0.72],
        [0, 0, -Math.PI / 2],
        [cell * 0.92, tall, 0.05]
      );
      put(bag, bar, "accent"); // 彫った溝に入れた黒(config の accentHex)
    }
  });
}

/** タッセル: 靴ひものふさ。口金とひもの先の金具がクロムで、束だけが布 */
function buildTassel(bag: Bag): void {
  // 口金(上でひもを締めている筒)
  const crimp = new THREE.CylinderGeometry(0.14, 0.16, 0.24, 10);
  put(bag, xf(crimp, [0, -0.12, 0]), "chrome");
  const band = new THREE.TorusGeometry(0.15, 0.022, 4, 10);
  put(bag, xf(band, [0, -0.19, 0], [Math.PI / 2, 0, 0]), "chrome");

  const cords: [number, number, number, CharmPaint][] = [
    // 角度, 開き, 長さ, 塗り。長さをそろえないのがふさの可愛さ
    [0.4, 0.2, 1.42, "body"],
    [2.0, 0.26, 1.18, "accent"],
    [3.4, 0.17, 1.58, "body"],
    [4.6, 0.3, 1.02, "body"],
    [5.6, 0.22, 1.3, "accent"],
  ];
  for (const [a, spread, len, paint] of cords) {
    const dx = Math.cos(a) * spread;
    const dz = Math.sin(a) * spread;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.2, 0),
      new THREE.Vector3(dx * 0.45, -0.2 - len * 0.34, dz * 0.45),
      new THREE.Vector3(dx * 0.92, -0.2 - len * 0.72, dz * 0.92),
      new THREE.Vector3(dx, -0.2 - len, dz),
    ]);
    put(bag, new THREE.TubeGeometry(curve, 9, 0.036, 5, false), paint);
    // ひもの先の金具(参考写真の靴ひもと同じ)
    const tip = new THREE.CylinderGeometry(0.045, 0.042, 0.11, 7);
    const t = curve.getTangentAt(1);
    _quat.setFromUnitVectors(_up, t);
    _obj.position.copy(curve.getPointAt(1)).addScaledVector(t, 0.03);
    _obj.quaternion.copy(_quat);
    _obj.scale.setScalar(1);
    _obj.updateMatrix();
    tip.applyMatrix4(_obj.matrix);
    put(bag, tip, "chrome");
  }
}

// ── こすくまくん(全身)──────────────────────────────
// 300本刺した人がもらう、このゲームの主役チャーム。公式ロゴのおすわりポーズを
// そのまま「成型された樹脂のフィギュア」にする。
//
// **太い黒の輪郭線がこのキャラクターの記号**なので、ここだけ特別な作りをする。
// パーツごとに ひとまわり大きい黒の殻をかぶせ、その **面を裏返して** 重ねる
// (インクアウトライン)。表を向いた面はカリングで消えるので、殻は本体から
// はみ出したふちだけが残る = それがそのまま輪郭線になる。
// 殻の塗り分けは `accent`(config の accentHex = ほぼ黒の樹脂)。
// `dark` は共通マテリアルが両面描画なので、裏返しの殻には**使えない**。
//
// 奥行き(z)の並べ方が線の出かたを決める。手前のパーツの **中心z** が、
// 重なる奥のパーツの **表面z** より前に来ていること(殻のふちは中心zの高さに
// 出るので、これを崩すと境目の線が本体に食われて消える)。
// ロゴの線の重なりに合わせて、こう並べる:
//   みみ(-0.09) → おなか(-0.06) → うで・あし(+0.05) → あたま+むね(+0.07)
// みみだけ後ろ = あたまの線が耳の内側を横切る(ロゴと同じ)。
// うで・あしは おなかより前 = 輪郭がまるごと体の上に出るので、小さくても
// 「うで」「あし」だと分かる。ふくらんだ面はあたまの裾の線より前に来るので、
// 見た目の重なりは みみ → おなか → あたま → うで・あし の順になる。
//
// 座標は「図の高さ = 1」の単位空間。**2D(src/ui/CharmShelf.tsx の BEAR_LOBES)と
// 同じ表**なので、片方だけ動かさないこと。

/** 輪郭線の太さ。26pxで約1px、9pxでもシルエットが締まる。ここが生命線 */
const BEAR_INK = 0.04;
/** 組み上がったあと背を 1 にそろえる倍率(ロゴの縦横比 0.77 は保つ) */
const BEAR_FIT = 0.9;
/** あたま+むね: 中心z と ふくらみ(片側) */
const BEAR_HEAD_Z = 0.07;
const BEAR_HEAD_T = 0.105;
/** おなか: 中心z と ふくらみ(片側) */
const BEAR_BELLY_Z = -0.06;
const BEAR_BELLY_T = 0.1;
/** うで・あし の 中心z(おなかより前に出して、輪郭をまるごと見せる) */
const BEAR_LIMB_Z = 0.05;

/**
 * まるい四角(スーパー楕円)の輪郭。ロゴの胴は「丸でも四角でもない おむすび」。
 * 上はドーム、下は肩の張った箱、というふうに上下で丸みがちがうので、
 * べき乗を上下で別に持つ。
 * @param pTop 上半分の丸み。小さいほど四角(1で楕円)
 * @param pBot 下半分の丸み
 * @param taper 上がひろく下がすぼまる量
 */
function squirclePoints(
  cx: number,
  cy: number,
  a: number,
  b: number,
  pTop: number,
  pBot: number,
  taper: number,
  n = 64
): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const p = s >= 0 ? pTop : pBot;
    const x = Math.sign(c) * Math.pow(Math.abs(c), p) * a * (1 + taper * s);
    const y = Math.sign(s) * Math.pow(Math.abs(s), p) * b;
    pts.push(new THREE.Vector2(cx + x, cy + y));
  }
  return pts;
}

/** 左回りの閉じた輪郭を、外へ w だけ太らせる(黒い殻の輪郭) */
function offsetPoints(pts: THREE.Vector2[], w: number): THREE.Vector2[] {
  const n = pts.length;
  const edgeN = (i: number) => {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    return new THREE.Vector2(dy / l, -dx / l); // 左回りなら (dy,-dx) が外向き
  };
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = edgeN((i - 1 + n) % n);
    const b = edgeN(i);
    const m = new THREE.Vector2().addVectors(a, b);
    m.normalize();
    // 角でも幅が細らないように 1/cos で伸ばす(伸びすぎは止める)
    const k = Math.min(1 / Math.max(m.dot(b), 0.4), 2.2);
    out.push(new THREE.Vector2(pts[i].x + m.x * w * k, pts[i].y + m.y * w * k));
  }
  return out;
}

/** 面と法線を裏返す。表側が消えるので、本体からはみ出したふちだけが見える */
function invertFaces(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geo.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
  }
  const nrm = geo.getAttribute("normal");
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) {
      nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    }
    nrm.needsUpdate = true;
  }
  return geo;
}

/**
 * ふくらんだ かたまり ひとつ(本体 + 黒い殻)。あたまとおなかに使う。
 * 殻は rings=2 = ふちから頂点までひと息の円錐にしてある。こうすると
 * 「はみ出した帯」がほぼ中心zの高さに並ぶので、前後のパーツに食われにくい。
 */
function bearLobe(
  bag: Bag,
  outline: THREE.Vector2[],
  z: number,
  thick: number,
  nBody: number,
  nInk: number
): void {
  const body = inflate(resample(outline, nBody), thick, 3, 0.75);
  put(bag, xf(body, [0, 0, z]), "body");
  const ink = inflate(
    offsetPoints(resample(outline, nInk), BEAR_INK),
    thick * 0.7,
    2,
    2.5
  );
  put(bag, invertFaces(xf(ink, [0, 0, z])), "accent");
}

/**
 * まるい部品ひとつ(本体 + 黒い殻)。みみ・うで・あし はぜんぶこれ。
 * 経度は必ず8分割にする。4の倍数だと真横(x = ±r)に頂点が来るので、
 * 正面から見た輪郭の幅がぶれない = 黒い線の太さが均一になる。
 * 太さのばらつきは、分割を増やすより先に効く。
 */
function bearBlob(
  bag: Bag,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  seg: number,
  inkSeg: number
): void {
  const body = new THREE.SphereGeometry(1, 8, seg);
  put(bag, xf(body, [cx, cy, cz], undefined, [rx, ry, rz]), "body");
  const ink = xf(new THREE.SphereGeometry(1, 8, inkSeg), [cx, cy, cz], undefined, [
    rx + BEAR_INK,
    ry + BEAR_INK,
    rz + BEAR_INK * 0.6,
  ]);
  put(bag, invertFaces(ink), "accent");
}

/** こすくまくん: 公式ロゴの全身。おすわりポーズのクリーム色の樹脂 */
function buildBear(bag: Bag): void {
  for (const s of [-1, 1]) {
    // みみ(あたまの後ろへ。あたまの線が耳の内側を横切る形になる)
    bearBlob(bag, s * 0.268, 0.4, -0.09, 0.135, 0.135, 0.055, 6, 5);
    // うで(短く、左右へちょこんと出る)
    bearBlob(bag, s * 0.3, -0.145, BEAR_LIMB_Z, 0.085, 0.068, 0.055, 5, 4);
    // あし(おすわりなので、おなかの裾から少しはみ出すだけ)
    bearBlob(bag, s * 0.258, -0.442, BEAR_LIMB_Z, 0.078, 0.06, 0.05, 4, 3);
  }
  // おなか
  bearLobe(
    bag,
    squirclePoints(0, -0.235, 0.31, 0.245, 0.75, 0.45, 0.1),
    BEAR_BELLY_Z,
    BEAR_BELLY_T,
    18,
    14
  );
  // あたま + むね(この裾の線がおなかとの境目になる)
  bearLobe(
    bag,
    squirclePoints(0, 0.185, 0.315, 0.305, 0.85, 0.5, 0.03),
    BEAR_HEAD_Z,
    BEAR_HEAD_T,
    22,
    16
  );
  // 目。ロゴより気持ち大きいのは、26pxでも点として残すため(これ以上は別人になる)
  for (const s of [-1, 1]) {
    put(
      bag,
      xf(ball(0.027, 6), [s * 0.073, 0.093, BEAR_HEAD_Z + BEAR_HEAD_T * 0.94]),
      "accent"
    );
  }
  // 口。逆さの三角のような小さな点なので、3面のコーンを下向きに埋める
  const mouth = new THREE.ConeGeometry(0.032, 0.03, 3);
  put(
    bag,
    xf(
      mouth,
      [0, 0.048, BEAR_HEAD_Z + BEAR_HEAD_T * 0.92],
      [0, 0, Math.PI],
      [1, 1, 0.5]
    ),
    "accent"
  );
  // おなかの右下のほくろ
  put(
    bag,
    xf(ball(0.026, 6), [0.188, -0.325, BEAR_BELLY_Z + BEAR_BELLY_T * 0.8]),
    "accent"
  );
  // ここまでロゴの比率のまま組んだので、最後に背を 1 へそろえる
  for (const it of bag) xf(it.geo, undefined, undefined, BEAR_FIT);
}

/**
 * こすくまくん ふたり(ねそべり)。300本のごほうび = 公式ロゴの構図。
 * こちらを向いて寝そべった子の後ろに、背中を向けたもう1匹が重なっている。
 * 横長なので、おすわり1匹より ぐっと大きく描ける = 遠目でも2匹だと分かる。
 *
 * **奥から手前の順に積むこと。** 黒い殻(インクアウトライン)は
 * 手前のパーツに隠れた線が消える仕組みなので、順番がそのまま絵になる。
 * 数値は 2D(CharmShelf.tsx の LIE_LOBES)とまったく同じ。
 */
const LIE_FIT = 1.05;
/** 奥の子(背中を向けている)の板の中心と厚み */
const LIE_BACK_Z = -0.05;
const LIE_BACK_T = 0.09;
/** 手前の子の板の中心と厚み */
const LIE_FRONT_Z = 0.05;
const LIE_FRONT_T = 0.105;

function buildBearLie(bag: Bag): void {
  // 奥の子: みみ(さらに奥) → からだ
  bearBlob(bag, 0.423, 0.26, -0.13, 0.075, 0.075, 0.045, 5, 4);
  bearLobe(
    bag,
    squirclePoints(0.297, -0.017, 0.207, 0.29, 1, 1, 0),
    LIE_BACK_Z,
    LIE_BACK_T,
    20,
    15
  );
  // 手前の子: みみ ふたつ → からだ
  bearBlob(bag, -0.39, 0.227, -0.005, 0.1, 0.1, 0.05, 6, 5);
  bearBlob(bag, 0.017, 0.233, -0.005, 0.1, 0.1, 0.05, 6, 5);
  bearLobe(
    bag,
    squirclePoints(-0.163, 0.017, 0.293, 0.31, 1, 1, 0),
    LIE_FRONT_Z,
    LIE_FRONT_T,
    22,
    16
  );
  // あし: いちばん手前
  bearBlob(bag, 0.13, -0.24, 0.1, 0.1, 0.075, 0.05, 5, 4);
  bearBlob(bag, -0.117, -0.247, 0.1, 0.12, 0.073, 0.05, 5, 4);
  bearBlob(bag, -0.423, -0.18, 0.1, 0.057, 0.067, 0.045, 4, 3);

  // 顔(手前の子の表面へ)
  const faceZ = LIE_FRONT_Z + LIE_FRONT_T * 0.94;
  for (const [x, y] of [
    [-0.31, -0.15],
    [-0.23, -0.143],
  ]) {
    put(bag, xf(ball(0.023, 6), [x, y, faceZ]), "accent");
  }
  // 鼻。下向きの小さな三角なので、3面のコーンを逆さに埋める
  put(
    bag,
    xf(
      new THREE.ConeGeometry(0.026, 0.028, 3),
      [-0.271, -0.188, LIE_FRONT_Z + LIE_FRONT_T * 0.92],
      [0, 0, Math.PI],
      [1, 1, 0.5]
    ),
    "accent"
  );
  // 奥の子の背中の ほくろ(手前の子とは重ならない位置なので、これで見える)
  put(
    bag,
    xf(ball(0.032, 6), [0.387, 0.073, LIE_BACK_Z + LIE_BACK_T * 0.85]),
    "accent"
  );

  for (const it of bag) xf(it.geo, undefined, undefined, LIE_FIT);
}

// ── 隠しチャーム「ちきゅう」────────────────────────────────
// 地球を1000回つついて こわした人だけが手に入れる。
// ただの青い玉だと何だか分からないので、**小さな地球そのもの** にして、
// 「こわした証」を3つの記号で見せる:
//   1. ギザギザのひびが正面を走っている
//   2. かけらがふたつ、ちょこんと浮いている(戻せなくなった感じ)
//   3. ゆっくり自転する(呼び出し側が回す。生きてはいる)
// 割れて中身が見えたりはしない。こわれたけど元気、がこのゲームのトーン。
// 質感だけ新しくして、すりガラスの惑星として金具の束になじませる。

/** 大陸/ひびを球の表面から浮かせる量(1 = 海の半径)。Zファイトを避ける */
const EARTH_LAND_LIFT = 1.035;
const EARTH_CRACK_LIFT = 1.055;

/** 単位ベクトルに直交する2軸(接平面の基底)。(t1, t2, d) が右手系になる */
function tangentBasis(d: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const t1 = new THREE.Vector3(0, 1, 0);
  if (Math.abs(d.y) > 0.9) t1.set(1, 0, 0);
  t1.cross(d).normalize();
  const t2 = new THREE.Vector3().crossVectors(d, t1);
  return [t1, t2];
}

/** 位置をそのまま法線にする(球にはりつく面は、球と同じ陰影になってほしい) */
function normalsFromPosition(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    n[i * 3] = x / l;
    n[i * 3 + 1] = y / l;
    n[i * 3 + 2] = z / l;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(n, 3));
}

/**
 * 球の上にはりつく大陸ひとつ。中心 dir から角半径 ang ぶんの円を、
 * ふちをゆらして描く(まん丸だと水玉模様に見えてしまう)。
 *
 * 中心から縁へ一気に三角形を張ると、三角形は平らなので弦が球の中へもぐり、
 * 大陸のまんなかから海が突きぬけてしまう。同心の輪に分けて細かく張ること。
 */
function continentGeometry(
  dir: THREE.Vector3,
  radius: number,
  ang: number,
  seed: number
): THREE.BufferGeometry {
  const N = 20; // 円周の分割
  const RINGS = 3; // 中心から縁までの分割
  const [t1, t2] = tangentBasis(dir);
  const p = new THREE.Vector3();
  const pos: number[] = [dir.x * radius, dir.y * radius, dir.z * radius];
  const index: number[] = [];
  for (let r = 1; r <= RINGS; r++) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const edge =
        ang * (1 + 0.3 * Math.sin(3 * a + seed) + 0.17 * Math.sin(5 * a + seed * 1.7));
      const rr = (edge * r) / RINGS;
      p.copy(dir)
        .multiplyScalar(Math.cos(rr))
        .addScaledVector(t1, Math.cos(a) * Math.sin(rr))
        .addScaledVector(t2, Math.sin(a) * Math.sin(rr))
        .normalize()
        .multiplyScalar(radius);
      pos.push(p.x, p.y, p.z);
    }
  }
  const at = (r: number, i: number) => 1 + (r - 1) * N + (i % N);
  for (let i = 0; i < N; i++) {
    // まんなかは扇。外から見て反時計回り = 表向き
    index.push(0, at(1, i), at(1, i + 1));
    for (let r = 1; r < RINGS; r++) {
      index.push(at(r, i), at(r + 1, i), at(r, i + 1));
      index.push(at(r, i + 1), at(r + 1, i), at(r + 1, i + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  normalsFromPosition(geo);
  return geo;
}

/** 三角波 (-1..1)。ひびのジグザグに使う */
function triWave(x: number): number {
  return 4 * Math.abs(x - Math.floor(x + 0.5)) - 1;
}

/**
 * 球の表面を走るギザギザのひび。極角θを上から下へ流しながら、
 * 経度φを三角波で折り返して稲妻状にする。両端は細くすぼめる。
 */
function crackGeometry(radius: number): THREE.BufferGeometry {
  const N = 26;
  // 単位球での半幅。太いと「ひび」ではなく「模様」になるので、
  // 遠目に線として読める最小限にとどめる
  const HALF_W = 0.055;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const th = 0.5 + t * 2.0; // 上のほうから下のほうへ
    // 正面(+Z)まわりで折り返す。折り返しを増やしすぎると角で帯が自分と
    // 重なってしまうので、回数は少なめ・振れ幅は大きめにする
    const ph = 0.42 * triWave(t * 1.6);
    pts.push(
      new THREE.Vector3(
        Math.sin(th) * Math.sin(ph),
        Math.cos(th),
        Math.sin(th) * Math.cos(ph)
      )
    );
  }
  const pos: number[] = [];
  const index: number[] = [];
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const p = pts[i];
    tan.copy(pts[Math.min(i + 1, N)]).sub(pts[Math.max(i - 1, 0)]);
    side.crossVectors(p, tan).normalize(); // 接平面のなかで、進行方向と直角
    const w = HALF_W * (0.3 + 0.7 * Math.sin(Math.PI * (i / N)));
    for (const s of [-1, 1]) {
      v.copy(p).addScaledVector(side, w * s).normalize().multiplyScalar(radius);
      pos.push(v.x, v.y, v.z);
    }
    if (i > 0) {
      // 帯の表を外向きにする巻き方(逆にすると、暗いひびが裏返って消える)
      const a = (i - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  normalsFromPosition(geo);
  return geo;
}

/** ちきゅう: ひびの入った小さな地球 + 飛び散ったかけら */
function buildEarth(bag: Bag): void {
  const r = 0.46;
  const chips: THREE.BufferGeometry[] = [new THREE.SphereGeometry(r, 20, 14)];
  const chipAt = (th: number, ph: number, k: number, spin: number) => {
    const g = new THREE.OctahedronGeometry(r * k, 0);
    g.scale(1, 0.6, 0.8); // 平たくして「かけら」に見せる
    g.rotateZ(spin);
    // 球からちょっとだけ離す。離しすぎると、ただの点が浮いているだけに見える
    const lift = r * 1.2;
    g.translate(
      Math.sin(th) * Math.sin(ph) * lift,
      Math.cos(th) * lift,
      Math.sin(th) * Math.cos(ph) * lift
    );
    return g;
  };
  chips.push(chipAt(1.75, 0.95, 0.17, 0.6));
  chips.push(chipAt(2.25, -0.42, 0.12, -0.9));
  for (const g of chips) put(bag, g, "body");

  for (const [dir, ang, seed] of [
    [new THREE.Vector3(0.42, 0.5, 0.76), 0.62, 0.4],
    [new THREE.Vector3(-0.72, -0.24, 0.65), 0.5, 2.1],
    [new THREE.Vector3(-0.1, -0.72, -0.68), 0.44, 3.6],
  ] as [THREE.Vector3, number, number][]) {
    put(bag, continentGeometry(dir.normalize(), r * EARTH_LAND_LIFT, ang, seed), "accent");
  }
  put(bag, crackGeometry(r * EARTH_CRACK_LIFT), "dark");
}

// ── 空を横切るものをつかまえて手に入れる4種 ──────────────
// 剣にぶら下がると豆粒になるので、どれも **シルエットひとつで種類が分かる**
// ことを最優先にしてある(頭+尾 / とがった機首とフィン / 横に張った板 /
// つばの広い皿)。作りと密度は上の12種とそろえた。

/** ながれぼし: 光る頭 + 引きずる尾。頭から吊るので、尾が斜め下へ流れる */
function buildComet(bag: Bag): void {
  const HEAD = new THREE.Vector3(0.2, 0.22, 0);
  const R = 0.25;
  put(bag, xf(ball(R, 16), [HEAD.x, HEAD.y, HEAD.z]), "body");

  // 尾。円錐の底を頭へ埋めて、先を左下へ伸ばす
  const streak = (dx: number, dy: number, len: number, wide: number, dz = 0) => {
    const d = new THREE.Vector3(dx, dy, 0).normalize();
    const g = new THREE.ConeGeometry(wide, len, 10);
    // 円錐は +Y が先端。進みたい向きへ倒してから、底を頭の中心へ置く
    _quat.setFromUnitVectors(_up, d);
    _obj.position.copy(HEAD).addScaledVector(d, len * 0.5 - R * 0.55);
    _obj.position.z += dz;
    _obj.quaternion.copy(_quat);
    _obj.scale.setScalar(1);
    _obj.updateMatrix();
    g.applyMatrix4(_obj.matrix);
    put(bag, g, "accent");
    return _obj.position.clone().addScaledVector(d, len * 0.5);
  };
  const tip = streak(-0.62, -0.72, 0.96, 0.225);
  // 2本目は少し手前(+Z)へずらす。同じ面に置くと1本目に食われて見えない
  streak(-0.9, -0.34, 0.52, 0.085, 0.075);

  // ちぎれて遅れる粒。尾を1本の三角で終わらせない
  for (const [k, r] of [
    [0.26, 0.055],
    [0.52, 0.036],
  ] as [number, number][]) {
    const d = tip.clone().sub(HEAD).normalize();
    put(
      bag,
      xf(ball(r, 8), [
        tip.x + d.x * k * 0.4 + 0.05,
        tip.y + d.y * k * 0.4 - 0.02,
        0,
      ]),
      "body"
    );
  }
}

/** ロケット: とがった機首 + フィン3枚 + ノズル。まっすぐ立てて吊る */
function buildRocket(bag: Bag): void {
  // 胴
  const hull = new THREE.CylinderGeometry(0.2, 0.215, 0.58, 14);
  put(bag, xf(hull, [0, 0, 0]), "body");
  // 機首(差し色。ここが赤いだけで、遠目にもロケットだと分かる)
  const nose = new THREE.ConeGeometry(0.2, 0.34, 14);
  put(bag, xf(nose, [0, 0.46, 0]), "accent");
  // 胴の帯
  const belt = new THREE.TorusGeometry(0.205, 0.032, 5, 16);
  put(bag, xf(belt, [0, 0.16, 0], [Math.PI / 2, 0, 0]), "accent");
  // フィン3枚。板を押し出さず、ふくらませて面取りの照りを出す
  const finPts = resample(
    v2([
      [0, 0.02],
      [0.25, -0.31],
      [0, -0.31],
    ]),
    20
  );
  for (let i = 0; i < 3; i++) {
    const fin = inflate(finPts, 0.024, 2, 0.8);
    xf(fin, [0.15, 0, 0]);
    xf(fin, undefined, [0, (i / 3) * Math.PI * 2, 0]);
    put(bag, fin, "accent");
  }
  // ノズル
  const nozzle = new THREE.CylinderGeometry(0.13, 0.185, 0.13, 12);
  put(bag, xf(nozzle, [0, -0.35, 0]), "chrome");
  // まる窓(クロムの縁 + 黒いガラス)
  const ring = new THREE.TorusGeometry(0.075, 0.026, 5, 14);
  put(bag, xf(ring, [0, 0.05, 0.185], [0.35, 0, 0]), "chrome");
  const pane = new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10);
  put(bag, xf(pane, [0, 0.05, 0.185], [Math.PI / 2 - 0.35, 0, 0]), "dark");
}

/** えいせい: 太陽電池パネル2枚 + 箱。横にぴんと張った形がそのまま目印 */
function buildSatellite(bag: Bag): void {
  // 本体の箱
  put(bag, xf(roundedBox(0.3, 0.4, 0.3, 0.055), [0, -0.02, 0]), "body");

  for (const s of [-1, 1]) {
    // 支柱
    const boom = new THREE.CylinderGeometry(0.026, 0.026, 0.12, 6);
    put(bag, xf(boom, [s * 0.21, -0.02, 0], [0, 0, Math.PI / 2]), "body");
    // パネル。**面は正面(+Z)へ向ける**。寝かせると、正面から見たとき
    // 厚みしか見えず「黄色い棒」になってしまう
    const panel = new THREE.BoxGeometry(0.34, 0.26, 0.042);
    put(bag, xf(panel, [s * 0.44, -0.02, 0]), "accent");
    // セルの目地。1枚の板のままだと、小さくすると ただの色の面に見える
    for (const d of [-0.11, 0.11]) {
      const bar = new THREE.BoxGeometry(0.024, 0.26, 0.05);
      put(bag, xf(bar, [s * 0.44 + d, -0.02, 0]), "dark");
    }
  }

  // 前を向いたパラボラアンテナ
  const dish = new THREE.SphereGeometry(0.088, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dish.scale(1, 0.5, 1);
  put(bag, xf(dish, [0, 0.03, 0.17], [Math.PI / 2, 0, 0]), "chrome");
  // 上に立てたアンテナ(先の玉まで入れて「衛星」の記号になる)
  const mast = new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6);
  put(bag, xf(mast, [0, 0.25, 0]), "chrome");
  put(bag, xf(ball(0.042, 8), [0, 0.32, 0]), "chrome");
}

/** UFO: つばの広い円盤 + ドーム。まる窓は下のふちに並べる */
function buildUfo(bag: Bag): void {
  // 円盤(球を潰す)
  const saucer = ball(0.5, 22);
  saucer.scale(1, 0.22, 1);
  put(bag, saucer, "body");
  // ふちの輪。これがあると、真横から見ても「皿」だと分かる
  const rim = new THREE.TorusGeometry(0.455, 0.055, 5, 22);
  put(bag, xf(rim, [0, 0, 0], [Math.PI / 2, 0, 0]), "body");
  // ドーム
  const dome = new THREE.SphereGeometry(0.235, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  put(bag, xf(dome, [0, 0.07, 0]), "accent");
  // まる窓。ふちの下側に等間隔で埋める
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = stud(0.042, 0.6);
    onSphere(g, new THREE.Vector3(Math.cos(a), -0.42, Math.sin(a)), 0.47);
    g.scale(1, 0.5, 1);
    put(bag, g, "dark");
  }
}

// ── 仕上げ ──────────────────────────────────────────

/** カン(いちばん上の輪)の大きさ。単位空間での半径 */
const BAIL_R = 0.115;

/**
 * 単位空間で組んだ部品を、契約どおりの姿にそろえる。
 *   1. 指定の x を真下に、上端がカンの下に来るよう動かす
 *   2. size 倍する
 *   3. てっぺんにクロムのカンを足す(ここへチェーンの最後の輪が通る)
 *   4. 塗り分けごとに1本のジオメトリへまとめる
 */
function finish(
  bag: Bag,
  size: number,
  opts: { anchorX?: number; spin?: boolean; bail?: number } = {}
): CharmBuild {
  const bailR = opts.bail ?? BAIL_R;
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const it of bag) {
    it.geo.computeBoundingBox();
    if (it.geo.boundingBox) box.union(tmp.copy(it.geo.boundingBox));
  }
  const dx = -(opts.anchorX ?? (box.min.x + box.max.x) / 2);
  const dy = -box.max.y - bailR * 1.55; // カンの下端に本体の上端を少し食い込ませる
  const dz = -(box.min.z + box.max.z) / 2;
  for (const it of bag) it.geo.translate(dx, dy, dz);
  const height = -(box.min.y + dy); // 原点から下端まで(= 垂れ下がる高さ)

  // カン。上端がぴたり原点に来る位置に置く
  const bail = new THREE.TorusGeometry(bailR, bailR * 0.33, 5, 12);
  put(bag, xf(bail, [0, -bailR, 0]), "chrome");

  for (const it of bag) it.geo.scale(size, size, size);

  // 塗り分けごとにまとめる(1チャームあたりのドローコールを最大4本に抑える)
  const parts: CharmPart[] = [];
  for (const paint of ["body", "accent", "dark", "chrome"] as CharmPaint[]) {
    const geos = bag.filter((it) => it.paint === paint).map((it) => prep(it.geo));
    if (geos.length === 0) continue;
    if (geos.length === 1) {
      parts.push({ geo: geos[0], paint });
      continue;
    }
    const merged = mergeGeometries(geos);
    if (merged) {
      geos.forEach((g) => g.dispose());
      parts.push({ geo: merged, paint });
    } else {
      // 結合できない構成にはしていないが、念のため個別に返す
      for (const g of geos) parts.push({ geo: g, paint });
    }
  }
  return { parts, height: Math.max(height * size, size * 0.4), spin: opts.spin ?? false };
}

/**
 * CharmShape から立体の部品一式を作る。
 * @param shape かたち
 * @param size 見かけの大きさ(いちばん長い辺のめやす。three.js units)
 * @returns 原点 = ぶら下げ点(カンの上端)、下へ垂れる部品と、その高さ
 */
export function makeCharmParts(shape: CharmShape, size = 0.085): CharmBuild {
  const bag: Bag = [];
  switch (shape) {
    case "dice":
      buildDice(bag);
      return finish(bag, size);
    case "star":
      buildStar(bag);
      return finish(bag, size);
    case "heart":
      buildHeart(bag);
      return finish(bag, size);
    case "mushroom":
      buildMushroom(bag);
      return finish(bag, size);
    case "eightball":
      buildEightBall(bag);
      return finish(bag, size);
    case "padlock":
      buildPadlock(bag);
      return finish(bag, size);
    case "duck":
      buildDuck(bag);
      return finish(bag, size);
    case "bolt":
      // いなずまは上の角から吊る(重心の真上ではない = 斜めにぶら下がる)
      buildBolt(bag);
      return finish(bag, size, { anchorX: 0.15, bail: 0.09 });
    case "wing":
      // 羽根は付け根から扇に広がるので、付け根の真上から吊る
      buildWing(bag);
      return finish(bag, size, { anchorX: 0.02, bail: 0.09 });
    case "plate":
      buildPlate(bag);
      return finish(bag, size, { bail: 0.09 });
    case "tassel":
      buildTassel(bag);
      return finish(bag, size, { anchorX: 0, bail: 0.1 });
    case "bear":
      buildBear(bag);
      return finish(bag, size);
    case "bearlie":
      // 横長なので、ぶら下げ点は真ん中でいい(重心の真上)
      buildBearLie(bag);
      return finish(bag, size, { bail: 0.09 });
    case "earth":
      buildEarth(bag);
      return finish(bag, size * 1.06, { spin: true });
    case "comet":
      // 頭から吊る(重心の真上ではない = 尾が斜め下へ流れる)
      buildComet(bag);
      return finish(bag, size, { anchorX: 0.2, bail: 0.09 });
    case "rocket":
      buildRocket(bag);
      return finish(bag, size, { bail: 0.095 });
    case "satellite":
      buildSatellite(bag);
      return finish(bag, size, { bail: 0.095 });
    case "ufo":
      buildUfo(bag);
      return finish(bag, size, { bail: 0.1 });
    default:
      buildDice(bag);
      return finish(bag, size);
  }
}
