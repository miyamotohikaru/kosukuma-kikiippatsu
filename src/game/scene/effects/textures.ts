// エフェクト用の CanvasTexture を自前生成するヘルパー。
// 画像アセットは追加しない方針なので、丸グラデ・星形・ビームの縦グラデを全部コードで描く。

import * as THREE from "three";

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

/** やわらかい丸グラデ(白)。土煙・花火・閃光スプライト用 */
export function makeCircleTexture(size = 64): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ふちに余白を残した5角星(白+ほのかなグロー)。トレイル・きらきら用 */
export function makeStarTexture(size = 96): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.38; // 回転サンプリングしてもはみ出さないよう余白を確保
  const inner = outer * 0.45;
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = size * 0.1;
  ctx.fillStyle = "#ffffff";
  // 2回塗ってグローを強める
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ビーム用の縦グラデ(上端は宇宙に溶けて透明、下端に向かって明るく) */
export function makeBeamTexture(): THREE.CanvasTexture {
  const w = 16;
  const h = 128;
  const [c, ctx] = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.45, "rgba(255,255,255,0.55)");
  g.addColorStop(0.85, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
