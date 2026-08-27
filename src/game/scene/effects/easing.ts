// エフェクト共通の小さなイージング/数学ヘルパー。

/** [0,1] に丸める */
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** 3次 ease-out(すっと止まる) */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** 3次 ease-in(ぐっと加速する) */
export const easeInCubic = (t: number): number => t * t * t;

/** 少し行き過ぎて戻る back-out。ポップイン用 */
export const backOut = (t: number): number => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** 正の剰余(ループアニメ用) */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
