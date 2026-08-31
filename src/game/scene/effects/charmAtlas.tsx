"use client";

// 月に刺さった1000本ぶんのチャームを描くための「絵の一枚板」(テクスチャアトラス)。
//
// なぜ要るか: チャームを立体で作ると 1000本 × 10個 = 1万個の部品になり、
// どうやっても持たない。**遠くの剣のチャームだけ立体をやめて、
// 板に絵を貼って正面へ向ける**(ビルボード)なら、1回の描画で全部出せる。
//
// 絵は棚や自分の剣とまったく同じ CharmGlyph をそのまま焼く。
// 別に描き起こすと「遠くの剣だけ違うチャーム」になってしまうので、
// 画面の外にSVGを並べて、それを1枚のカンバスへ写し取っている。

import { useEffect, useState } from "react";
import * as THREE from "three";
import { CHARMS } from "@/lib/config";
import { CharmGlyph } from "@/ui/CharmShelf";

/** アトラスの列数。18個なら 6×3 に収まる */
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = Math.ceil(CHARMS.length / ATLAS_COLS);
/** 1マスの大きさ(px)。遠景の粒なので128で足りる */
const CELL = 128;

let atlas: THREE.CanvasTexture | null = null;
let building = false;
const listeners = new Set<() => void>();

function publish() {
  for (const fn of listeners) fn();
}

/** 焼き上がったアトラス(まだなら null)。3D側はこれを購読する */
export function useCharmAtlas(): THREE.CanvasTexture | null {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return atlas;
}

/** index → アトラス上の左上UV(0..1)。シェーダへ渡す */
export function atlasCell(index: number): [number, number] {
  return [(index % ATLAS_COLS) / ATLAS_COLS, Math.floor(index / ATLAS_COLS) / ATLAS_ROWS];
}

/**
 * 画面の外にチャームのSVGを並べて、1枚のアトラスへ焼く部品。
 * DOM側(Game.tsx)に1つだけ置く。焼き上がったら自分を消す。
 */
export default function CharmAtlasBuilder() {
  const [done, setDone] = useState(atlas !== null);

  useEffect(() => {
    if (atlas || building) return;
    building = true;
    let alive = true;

    // React が描いたSVGを、1つずつ画像にして写し取る。
    // 描き終わるのを待つため、レイアウト後の次フレームで取りにいく
    const run = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = ATLAS_COLS * CELL;
      canvas.height = ATLAS_ROWS * CELL;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      for (let i = 0; i < CHARMS.length; i++) {
        const el = document.getElementById(`kk-atlas-${i}`);
        if (!el) continue;
        const markup = new XMLSerializer().serializeToString(el);
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        const img = new Image();
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res(); // 1個抜けても他は焼く
          img.src = url;
        });
        if (!alive) return;
        const x = (i % ATLAS_COLS) * CELL;
        const y = Math.floor(i / ATLAS_COLS) * CELL;
        ctx.drawImage(img, x, y, CELL, CELL);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      atlas = tex;
      publish();
      if (alive) setDone(true);
    };

    // requestAnimationFrame は裏のタブだと止まる。焼くのに描画は要らない
    // (SVGはこの effect の時点でDOMにある)ので、タイマーで走らせる
    const id = setTimeout(() => void run(), 0);
    return () => {
      alive = false;
      clearTimeout(id);
      // 開発中は effect が二度走る(StrictMode)。焼き終わる前に片付けられたら
      // 「焼いている最中」の札を戻しておかないと、二度目が門前払いされて
      // いつまでも焼き上がらない
      if (!atlas) building = false;
    };
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {CHARMS.map((_, i) => (
        <svg
          key={i}
          id={`kk-atlas-${i}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={CELL}
          height={CELL}
        >
          <CharmGlyph index={i} detail ring />
        </svg>
      ))}
    </div>
  );
}
