// 剣の「スキン + チャーム」を穴ごとに2バイトへ詰める。
// Uint16Array(HOLE_COUNT) を base64 で配るので、1000穴で2000バイト。
// ほとんどの穴が 0 なので gzip 後は実質ほとんど増えない。
//
//   bit 0-2   : skin  (0..7)   SWORD_SKINS の index
//   bit 3-6   : 刺して集めたチャームの数 (0..15)
//   bit 7     : 隠しチャーム(地球をこわした人)を持っているか
//   bit 8-11  : 空を横切るものをつかまえたチャーム(SKY_KINDS の順にフラグ)
//   bit 12-15 : 予備
//
// 隠しチャームも空のチャームも刺し本数と無関係に手に入るので、「数」では
// 表せない。そのため独立したフラグに割いてある。
// 0 は「情報なし = デフォルトのプラスチック剣・チャームなし」を意味する。
// 過去の刺しは 0 のままなので、詰め方を変えると見た目が変わってしまう。
//
// 1バイトだった頃の値は下位8ビットがそのままなので、そのまま読める。

import {
  CHARMS,
  EARTH_CHARM_INDEX,
  NORMAL_CHARM_COUNT,
  SKY_CHARM_INDEX,
  SKY_KINDS,
  SWORD_SKINS,
} from "./config";

export const SKIN_MAX = 7; // 3bit
/** 刺して集めたチャーム数の上限(4bit)。CHARMS の通常ぶんはこれ以下であること */
export const CHARM_MAX = 15;
/** 隠しチャームのビット */
export const EARTH_CHARM_BIT = 0b1000_0000;
/** 空のチャームのビットが始まる位置 */
export const SKY_CHARM_SHIFT = 8;
/** 空のチャームぶんのマスク(SKY_KINDS の数だけ立てられる) */
export const SKY_CHARM_MASK = ((1 << SKY_KINDS.length) - 1) << SKY_CHARM_SHIFT;

/** スキンindex・チャーム数・隠し・空のチャームを2バイトへ。範囲外は丸める */
export function packStyle(
  skin: number,
  charm: number,
  earthCharm = false,
  skyCharms = 0,
): number {
  const s = Math.min(Math.max(Math.trunc(skin) || 0, 0), SKIN_MAX);
  const c = Math.min(Math.max(Math.trunc(charm) || 0, 0), CHARM_MAX);
  const k = (Math.trunc(skyCharms) || 0) & ((1 << SKY_KINDS.length) - 1);
  return (
    (s & 0b111) |
    ((c & 0b1111) << 3) |
    (earthCharm ? EARTH_CHARM_BIT : 0) |
    (k << SKY_CHARM_SHIFT)
  );
}

/** バイトからスキンindex(存在しない番号なら0=プラスチック) */
export function skinOf(style: number): number {
  const s = style & 0b111;
  return s < SWORD_SKINS.length ? s : 0;
}

/** バイトから「刺して集めたチャームの数」(0..NORMAL_CHARM_COUNT) */
export function charmOf(style: number): number {
  return Math.min((style >> 3) & 0b1111, NORMAL_CHARM_COUNT);
}

/** バイトから「隠しチャームを持っているか」 */
export function hasEarthCharm(style: number): boolean {
  return (style & EARTH_CHARM_BIT) !== 0;
}

/** バイトから「つかまえた空のチャーム」のフラグ(SKY_KINDS の順) */
export function skyCharmsOf(style: number): number {
  return (style & SKY_CHARM_MASK) >> SKY_CHARM_SHIFT;
}

/**
 * その剣にぶら下がるチャームを CHARMS の index 配列で返す(古い順)。
 * **3D も UI もこの1本の関数を使うこと。** 上限は設けない
 * (「チャームは何個でもつけられる」がこのゲームの仕様)。
 */
export function charmIndicesOf(style: number): number[] {
  const out: number[] = [];
  const n = charmOf(style);
  for (let i = 0; i < n && i < CHARMS.length; i++) {
    if (!CHARMS[i].secret) out.push(i);
  }
  if (hasEarthCharm(style) && EARTH_CHARM_INDEX >= 0) {
    out.push(EARTH_CHARM_INDEX);
  }
  const sky = skyCharmsOf(style);
  for (let i = 0; i < SKY_KINDS.length; i++) {
    if (sky & (1 << i)) {
      const ci = SKY_CHARM_INDEX[i];
      if (ci >= 0) out.push(ci);
    }
  }
  return out;
}

/** 手持ちの状態(刺し数・隠しの有無・つかまえたもの)から、同じ index 配列を作る */
export function charmIndicesFrom(
  charm: number,
  earthCharm: boolean,
  skyCharms = 0,
): number[] {
  return charmIndicesOf(packStyle(0, charm, earthCharm, skyCharms));
}
