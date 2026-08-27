// 月面上の剣穴の配置。
//
// 実物の黒ひげ危機一発の樽は、たがとたがのあいだに「縦長のスリット」が
// 行ごとに規則正しく並んでいる。だからここもフィボナッチ螺旋(均等だが不規則)を
// やめて、**緯度の輪(行) × その輪を等分した位置(列)** に置く。
// ジッターも入れない — 樽の穴は打ち抜きなので、きれいに揃っているのが正しい。
//
// 行の間隔と、行の中の間隔がだいたい同じになるように輪の数と各輪の個数を決める。
// 球なので緯度が上がるほど周が短くなり、1行あたりの本数はそのぶん減る。
// 1行おきに半ピッチずらして、レンガのように互い違いにする(縦の筋を作らない)。
//
// こすくまくんが刺さっている北極まわり(POLAR_CAP_DEG)は除外。
// 結果は決定的(サーバー/全クライアントで同一。index = holeId)。

import { HOLE_COUNT, MOON_RADIUS, POLAR_CAP_DEG } from "./config";

export interface HolePoint {
  /** 月中心からのローカル座標(半径 MOON_RADIUS 上) */
  position: [number, number, number];
  /** 外向き法線(単位ベクトル) */
  normal: [number, number, number];
  /** 穴の大きさの個体差。スリットは打ち抜きなので常に 1(APIは互換のため残す) */
  scale: number;
}

/** 南極まわりも少しだけ空ける(1本しか入らない輪を作らない) */
const SOUTH_CAP_DEG = 8;

let cache: HolePoint[] | null = null;

/**
 * 各輪の本数を決める。行の間隔と行内の間隔がそろう本数を出し、
 * 合計がぴったり HOLE_COUNT になるよう端数の大きい輪から1本ずつ足す。
 */
function ringCounts(thetas: number[], pitch: number): number[] {
  const raw = thetas.map(
    (t) => (2 * Math.PI * MOON_RADIUS * Math.sin(t)) / pitch
  );
  const counts = raw.map((v) => Math.max(1, Math.floor(v)));
  let total = counts.reduce((a, b) => a + b, 0);
  // 端数(切り捨てた小数)が大きい輪から順に1本ずつ足して HOLE_COUNT に合わせる
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (total < HOLE_COUNT) {
    counts[order[k % order.length].i]++;
    total++;
    k++;
  }
  // 多すぎたら、本数の多い輪から減らす(輪が消えないよう1本は残す)
  while (total > HOLE_COUNT) {
    let big = 0;
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] > counts[big]) big = i;
    }
    if (counts[big] <= 1) break;
    counts[big]--;
    total--;
  }
  return counts;
}

/** HOLE_COUNT 個の穴の位置を返す(index = holeId)。結果はモジュール内キャッシュ */
export function getHolePoints(): HolePoint[] {
  if (cache) return cache;

  const t0 = (POLAR_CAP_DEG * Math.PI) / 180; // 北のふち
  const t1 = ((180 - SOUTH_CAP_DEG) * Math.PI) / 180; // 南のふち
  const span = t1 - t0;

  // 使える帯の面積から1穴あたりの間隔を出し、そこから行数を決める
  const area =
    2 * Math.PI * MOON_RADIUS * MOON_RADIUS * (Math.cos(t0) - Math.cos(t1));
  const pitch = Math.sqrt(area / HOLE_COUNT); // 穴どうしの目標間隔
  const rows = Math.max(2, Math.round((span * MOON_RADIUS) / pitch));

  const thetas: number[] = [];
  for (let r = 0; r < rows; r++) {
    thetas.push(t0 + (span * (r + 0.5)) / rows);
  }
  const counts = ringCounts(thetas, pitch);

  const pts: HolePoint[] = [];
  for (let r = 0; r < rows; r++) {
    const theta = thetas[r];
    const n = counts[r];
    const sin = Math.sin(theta);
    const y = Math.cos(theta);
    // 1行おきに半ピッチずらす(レンガ積み)。縦にまっすぐ筋が通るのを避ける
    const offset = ((r % 2) * Math.PI) / n;
    for (let c = 0; c < n; c++) {
      const phi = offset + (2 * Math.PI * c) / n;
      const nx = Math.cos(phi) * sin;
      const nz = Math.sin(phi) * sin;
      pts.push({
        position: [nx * MOON_RADIUS, y * MOON_RADIUS, nz * MOON_RADIUS],
        normal: [nx, y, nz],
        scale: 1,
      });
    }
  }

  cache = pts;
  return pts;
}

/**
 * 穴のスリットの「縦」方向(北極を向く接ベクトル)。
 * 樽のスリットが縦に切られているのと同じで、**穴も剣もこの向きにそろえる**。
 * 3Dの穴(Holes)と剣(orientSword)が同じ答えを使うための唯一の窓口。
 */
export function slotUp(
  normal: readonly [number, number, number] | Float32Array | number[]
): [number, number, number] {
  const [nx, ny, nz] = normal as number[];
  // worldUp から法線成分を抜いたもの = 経線に沿った「上」
  let ux = -nx * ny;
  let uy = 1 - ny * ny;
  let uz = -nz * ny;
  const len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    // 極の真上(法線が±Yと平行)。経線が定義できないのでX軸へ逃がす
    return [1, 0, 0];
  }
  ux /= len;
  uy /= len;
  uz /= len;
  return [ux, uy, uz];
}
