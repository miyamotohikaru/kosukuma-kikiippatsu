"use client";

// 手続きトロフィーの3Dメッシュ。getTrophyParams の結果から
// LatheGeometry + プリミティブ合成で組み立てる。<Canvas> 内で使うこと。
// 全高≈1unit・台座底が y=0。useMemo でキャッシュし、破棄時に dispose する。

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getTrophyParams, type TrophyParams } from "@/lib/trophy";
import { mulberry32 } from "@/lib/prng";

// ── フォント ────────────────────────────────────────
// next/font はハッシュ化された family 名になるので body の計算値から拾う
function gameFontFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  try {
    return getComputedStyle(document.body).fontFamily || "sans-serif";
  } catch {
    return "sans-serif";
  }
}

/** maxWidth に収まるフォントサイズを探す */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  maxSize: number,
  maxWidth: number
): number {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 14 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

// ── ラメ用の丸グローテクスチャ(アプリで1枚だけ使い回す) ──
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

// ── 名前プレート(金縁・紺地。日本語OKの CanvasTexture) ──
interface PlateTexture {
  texture: THREE.CanvasTexture;
  /** Webフォント読み込み後に呼ぶと描き直す */
  redraw: () => void;
}

function makePlateTexture(roundNo: number, name: string): PlateTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 224;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;

  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fam = gameFontFamily();
    ctx.clearRect(0, 0, 512, 224);
    // 紺地の角丸プレート
    ctx.fillStyle = "#131a4d";
    ctx.beginPath();
    ctx.roundRect(6, 6, 500, 212, 28);
    ctx.fill();
    // 金の縁(外・内の2重)
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(11, 11, 490, 202, 24);
    ctx.stroke();
    ctx.strokeStyle = "#8a6a1e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(24, 24, 464, 176, 18);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 「第N代」(金)
    const gen = `第${roundNo}代`;
    const genSize = fitFont(ctx, gen, fam, 700, 48, 420);
    ctx.font = `700 ${genSize}px ${fam}`;
    ctx.fillStyle = "#f2c14e";
    ctx.fillText(gen, 256, 70);
    // 名前(クリーム・大きく)
    const nameSize = fitFont(ctx, name, fam, 800, 92, 430);
    ctx.font = `800 ${nameSize}px ${fam}`;
    ctx.fillStyle = "#fffef2";
    ctx.fillText(name, 256, 150);
    texture.needsUpdate = true;
  };
  draw();
  return { texture, redraw: draw };
}

// ── トッパー各種(ローカルで高さ≈1に収める) ─────────────
function starGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.52 : 0.22;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  g.center();
  return g;
}

function moonGeometry(): THREE.BufferGeometry {
  // 外円と内円(右にずらす)の交差から三日月の輪郭を数値で作る
  const R = 0.55;
  const r2 = 0.42;
  const d = 0.26;
  const t1 = Math.acos((d * d + R * R - r2 * r2) / (2 * d * R));
  const px = R * Math.cos(t1);
  const py = R * Math.sin(t1);
  const t2 = Math.atan2(py, px - d);
  const pts: THREE.Vector2[] = [];
  // 外周を反時計回り(左まわり)に
  for (let i = 0; i <= 32; i++) {
    const a = t1 + (Math.PI * 2 - 2 * t1) * (i / 32);
    pts.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R));
  }
  // 内側のえぐれを下→上へ(内円の左側を通る)
  for (let i = 1; i < 32; i++) {
    const a = -t2 - (Math.PI * 2 - 2 * t2) * (i / 32);
    pts.push(new THREE.Vector2(d + Math.cos(a) * r2, Math.sin(a) * r2));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
  });
  g.center();
  return g;
}

function heartGeometry(): THREE.BufferGeometry {
  // three.js 定番のハート形。作った後で中心合わせ・スケール・尖りを下へ
  const s = new THREE.Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 2.4,
    bevelEnabled: true,
    bevelThickness: 0.7,
    bevelSize: 0.7,
    bevelSegments: 2,
  });
  g.center();
  g.scale(0.05, 0.05, 0.05);
  g.rotateZ(Math.PI); // 尖りを下に
  return g;
}

/** ExtrudeGeometry 系以外はプリミティブの合成で作る */
function buildTopper(
  kind: TrophyParams["topper"],
  mat: THREE.Material,
  accent: THREE.Material,
  geoms: THREE.BufferGeometry[]
): THREE.Object3D {
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geoms.push(g);
    return g;
  };
  switch (kind) {
    case "star":
      return new THREE.Mesh(track(starGeometry()), mat);
    case "moon":
      return new THREE.Mesh(track(moonGeometry()), mat);
    case "heart":
      return new THREE.Mesh(track(heartGeometry()), mat);
    case "rocket": {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.2, 0.22, 0.52, 20)),
        mat
      );
      body.position.y = -0.08;
      const nose = new THREE.Mesh(
        track(new THREE.ConeGeometry(0.2, 0.3, 20)),
        mat
      );
      nose.position.y = 0.33;
      const porthole = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.08, 12, 10)),
        accent
      );
      porthole.position.set(0, 0, 0.17);
      g.add(body, nose, porthole);
      const finGeom = track(new THREE.BoxGeometry(0.06, 0.26, 0.2));
      for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(finGeom, mat);
        const a = (i / 3) * Math.PI * 2;
        fin.position.set(Math.sin(a) * 0.22, -0.32, Math.cos(a) * 0.22);
        fin.rotation.y = a;
        g.add(fin);
      }
      return g;
    }
    case "planet": {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.4, 24, 18)),
        mat
      );
      const ring = new THREE.Mesh(
        track(new THREE.TorusGeometry(0.6, 0.05, 8, 48)),
        accent
      );
      ring.rotation.x = Math.PI / 2 - 0.35;
      ring.scale.z = 0.5;
      g.add(ball, ring);
      return g;
    }
    case "bear": {
      // くま頭(球3つ)
      const g = new THREE.Group();
      const head = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.4, 24, 18)),
        mat
      );
      const earGeom = track(new THREE.SphereGeometry(0.18, 16, 12));
      const earL = new THREE.Mesh(earGeom, mat);
      const earR = new THREE.Mesh(earGeom, mat);
      earL.position.set(-0.3, 0.32, 0);
      earR.position.set(0.3, 0.32, 0);
      g.add(head, earL, earR);
      return g;
    }
    case "diamond": {
      const mesh = new THREE.Mesh(
        track(new THREE.OctahedronGeometry(0.42, 0)),
        mat
      );
      mesh.scale.y = 1.35;
      return mesh;
    }
  }
}

// ── 組み立て ────────────────────────────────────────
interface BuiltTrophy {
  group: THREE.Group;
  dispose: () => void;
  redrawText: () => void;
}

function buildTrophy(roundNo: number, name: string): BuiltTrophy {
  const p = getTrophyParams(roundNo, name);
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const group = new THREE.Group();

  // 本体マテリアル(オーロラは iridescence で虹の干渉色)
  const mat = new THREE.MeshPhysicalMaterial({
    color: p.material.color,
    metalness: p.material.metalness,
    roughness: p.material.roughness,
    emissive: p.material.emissive,
    emissiveIntensity: p.material.emissiveIntensity,
    iridescence: p.material.iridescence,
    iridescenceIOR: 1.35,
    clearcoat: p.material.iridescence > 0 ? 0.6 : 0,
    side: THREE.DoubleSide,
  });
  mats.push(mat);
  // アクセント(惑星のリング・ロケットの窓など)
  const accent = new THREE.MeshStandardMaterial({
    color: "#ffd93d",
    metalness: 0.8,
    roughness: 0.3,
    emissive: "#7a5210",
    emissiveIntensity: 0.25,
  });
  mats.push(accent);

  // ── 台座(1〜3段) ──
  let y0 = 0;
  for (const tier of p.baseTiers) {
    const geom =
      p.baseShape === "round"
        ? new THREE.CylinderGeometry(
            tier.radius * 0.92,
            tier.radius,
            tier.height,
            40
          )
        : new THREE.BoxGeometry(tier.radius * 1.8, tier.height, tier.radius * 1.8);
    geoms.push(geom);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = y0 + tier.height / 2;
    group.add(mesh);
    y0 += tier.height;
  }

  // ── カップ(LatheGeometry) ──
  const lathe = new THREE.LatheGeometry(
    p.profile.map(([r, y]) => new THREE.Vector2(r, y)),
    p.latheSegments
  );
  geoms.push(lathe);
  const cup = new THREE.Mesh(lathe, mat);
  cup.position.y = p.cupBottomY;
  group.add(cup);

  // ── 持ち手(左右対称) ──
  if (p.handle !== "none") {
    const handleGeom =
      p.handle === "round"
        ? new THREE.TorusGeometry(p.handleRadius, p.handleTube, 10, 28)
        : new THREE.TorusGeometry(p.handleRadius, p.handleTube, 6, 4);
    geoms.push(handleGeom);
    for (const sign of [-1, 1] as const) {
      const h = new THREE.Mesh(handleGeom, mat);
      h.position.set(sign * p.handleOffsetX, p.handleY, 0);
      // 角型はひし形を45°起こして四角く見せる
      if (p.handle === "square") h.rotation.z = Math.PI / 4;
      group.add(h);
    }
  }

  // ── トッパー ──
  const topper = buildTopper(p.topper, mat, accent, geoms);
  topper.position.y = p.topperY;
  topper.scale.setScalar(p.topperScale);
  group.add(topper);

  // ── 名前プレート(台座正面) ──
  const bottomR = p.baseTiers[0].radius;
  const plateW = Math.min(Math.max(bottomR * 1.5, 0.3), 0.5);
  const plateH = Math.min(plateW * 0.42, p.baseHeight * 0.95);
  const plate = makePlateTexture(roundNo, name);
  texs.push(plate.texture);
  const plateMat = new THREE.MeshStandardMaterial({
    map: plate.texture,
    transparent: true,
    metalness: 0.4,
    roughness: 0.4,
    emissive: "#8888aa",
    emissiveIntensity: 0.5,
    emissiveMap: plate.texture,
  });
  mats.push(plateMat);
  const plateGeom = new THREE.PlaneGeometry(plateW, plateH);
  geoms.push(plateGeom);
  const plateMesh = new THREE.Mesh(plateGeom, plateMat);
  // 角台座は箱の前面(半径×0.9)に、丸台座は円柱の接面に貼る
  const plateZ = (p.baseShape === "square" ? bottomR * 0.9 : bottomR) + 0.006;
  plateMesh.position.set(0, plateH * 0.55 + 0.008, plateZ);
  group.add(plateMesh);

  // ── ラメ(オーロラ/星雲のみ): カップ表面にキラ粒を散らす ──
  if (p.material.sparkle) {
    const rng = mulberry32(p.seed ^ 0x9e3779b9);
    const count = 90;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const idx = Math.min(
        p.profile.length - 1,
        Math.floor(rng() * p.profile.length)
      );
      const [r, y] = p.profile[idx];
      const a = rng() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r * 1.02;
      positions[i * 3 + 1] = p.cupBottomY + y;
      positions[i * 3 + 2] = Math.sin(a) * r * 1.02;
    }
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geoms.push(sparkGeom);
    const sparkMat = new THREE.PointsMaterial({
      size: 0.022,
      map: getGlowTexture(),
      color: "#ffffff",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mats.push(sparkMat);
    group.add(new THREE.Points(sparkGeom, sparkMat));
  }

  return {
    group,
    redrawText: plate.redraw,
    dispose: () => {
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose(); // 共有グローは texs に入れない
    },
  };
}

// ── コンポーネント ──────────────────────────────────
export interface TrophyMeshProps {
  roundNo: number;
  name: string;
}

/**
 * <TrophyMesh roundNo={n} name={s} /> — <Canvas> 内で使う。
 * 同じ入力なら世界中で同じ形のトロフィーになる。
 */
export default function TrophyMesh({ roundNo, name }: TrophyMeshProps) {
  const built = useMemo(() => buildTrophy(roundNo, name), [roundNo, name]);

  useEffect(() => {
    // Webフォント読み込み完了後にプレートを描き直す(初回は代替フォント)
    let alive = true;
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(() => {
        if (alive) built.redrawText();
      });
    }
    return () => {
      alive = false;
      built.dispose();
    };
  }, [built]);

  return <primitive object={built.group} />;
}
