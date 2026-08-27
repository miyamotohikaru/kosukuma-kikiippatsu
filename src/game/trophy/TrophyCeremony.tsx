"use client";

// トロフィー授与式。phase === "trophy" の間だけ、カメラ前方2.5unitに
// その回のトロフィーが台座からせり上がり、後光とキラ星をまとって回る。
// <Canvas> 内(担当CのGameCanvas)にマウントされる前提。他フェーズでは null。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGameStore } from "@/game/store";
import { T_TROPHY } from "@/lib/config";
import { mulberry32 } from "@/lib/prng";
import TrophyMesh from "./TrophyMesh";

// ── 後光(放射状の光)テクスチャ: アプリで1枚だけ生成して使い回す ──
let raysTexture: THREE.CanvasTexture | null = null;
function getRaysTexture(): THREE.CanvasTexture {
  if (raysTexture) return raysTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.translate(128, 128);
    // 中心のふわっとした光
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    core.addColorStop(0, "rgba(255,240,190,0.9)");
    core.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = core;
    ctx.fillRect(-128, -128, 256, 256);
    // 放射状の光条
    const rayCount = 12;
    for (let i = 0; i < rayCount; i++) {
      ctx.save();
      ctx.rotate((i / rayCount) * Math.PI * 2);
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, "rgba(255,225,140,0.55)");
      g.addColorStop(1, "rgba(255,225,140,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(128, -11);
      ctx.lineTo(128, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  raysTexture = new THREE.CanvasTexture(c);
  raysTexture.colorSpace = THREE.SRGBColorSpace;
  return raysTexture;
}

// ── キラ星スプライトのテクスチャ(十字の輝き) ──
let starTexture: THREE.CanvasTexture | null = null;
function getStarTexture(): THREE.CanvasTexture {
  if (starTexture) return starTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.translate(32, 32);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(-32, -32, 64, 64);
    // 縦横のスパイク(細いひし形)
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(3.2, 0);
      ctx.lineTo(0, 30);
      ctx.lineTo(-3.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  starTexture = new THREE.CanvasTexture(c);
  return starTexture;
}

// ── イージング ──
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** キラ星の点群(球殻上にばらまく)。seed で決定的に */
function makeStarPositions(seed: number, count: number): Float32Array {
  const rng = mulberry32(seed);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const y = rng() * 2 - 1;
    const r = 0.85 + rng() * 0.55;
    const xz = Math.sqrt(Math.max(0, 1 - y * y)) * r;
    arr[i * 3] = Math.cos(a) * xz;
    arr[i * 3 + 1] = 0.4 + y * r * 0.7;
    arr[i * 3 + 2] = Math.sin(a) * xz;
  }
  return arr;
}

// ── 本体 ────────────────────────────────────────────
function Ceremony() {
  const phaseAt = useGameStore((s) => s.phaseAt);
  const launchInfo = useGameStore((s) => s.launchInfo);
  const wonName = useGameStore((s) => s.wonName);
  const storeRound = useGameStore((s) => s.roundNo);

  const roundNo = launchInfo?.roundNo ?? storeRound;
  const name = wonName ?? launchInfo?.name ?? "ななし";

  const anchorRef = useRef<THREE.Group>(null);
  const stageRef = useRef<THREE.Group>(null);
  const trophyRef = useRef<THREE.Group>(null);
  const raysRef = useRef<THREE.Mesh>(null);
  const raysMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const starsMatA = useRef<THREE.PointsMaterial>(null);
  const starsMatB = useRef<THREE.PointsMaterial>(null);

  // 星の位置(回ごとに配置が変わる)とジオメトリ
  const [starGeomA, starGeomB] = useMemo(() => {
    const make = (seed: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(makeStarPositions(seed, 20), 3)
      );
      return g;
    };
    return [make(roundNo * 2 + 1), make(roundNo * 2 + 2)];
  }, [roundNo]);

  // アンマウント時にジオメトリを破棄(テクスチャは共有なので残す)
  useEffect(
    () => () => {
      starGeomA.dispose();
      starGeomB.dispose();
    },
    [starGeomA, starGeomB]
  );

  useFrame(({ camera }) => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    // カメラに追従: 常に視界の同じ場所に見える
    anchor.position.copy(camera.position);
    anchor.quaternion.copy(camera.quaternion);

    const t = (Date.now() - phaseAt) / 1000;
    // せり上がり(バネのあるease)
    const rise = easeOutBack(clamp01(t / 1.15));
    // 終わり際にきゅっと消える
    const tEnd = T_TROPHY / 1000;
    const out = clamp01((tEnd - t) / 0.35);
    const outEase = out * out * (3 - 2 * out);

    const stage = stageRef.current;
    if (stage) stage.scale.setScalar(Math.max(0.001, outEase));

    const trophy = trophyRef.current;
    if (trophy) {
      const bob = t > 1.15 ? Math.sin((t - 1.15) * 2.1) * 0.02 : 0;
      trophy.position.y = -1.1 + 1.1 * rise + bob;
      trophy.rotation.y = t * 0.7 + (1 - clamp01(t / 1.15)) * 1.2;
      const grow = 0.55 + 0.45 * clamp01(rise);
      trophy.scale.setScalar(0.85 * grow);
    }

    // 後光: ゆっくり回りながらフェードイン・脈動
    const rays = raysRef.current;
    if (rays) rays.rotation.z = t * 0.22;
    const raysMat = raysMatRef.current;
    if (raysMat) {
      const fadeIn = clamp01((t - 0.35) / 0.8);
      raysMat.opacity = fadeIn * (0.5 + 0.12 * Math.sin(t * 3.1)) * outEase;
    }

    // キラ星: 2群を位相ずらしでまたたかせる
    const twA = starsMatA.current;
    if (twA) twA.opacity = (0.3 + 0.6 * Math.abs(Math.sin(t * 2.6))) * outEase;
    const twB = starsMatB.current;
    if (twB)
      twB.opacity =
        (0.3 + 0.6 * Math.abs(Math.sin(t * 2.6 + Math.PI / 2))) * outEase;
  });

  return (
    <group ref={anchorRef}>
      {/* カメラ前方2.5unit・少し下に置く舞台 */}
      <group ref={stageRef} position={[0, -0.45, -2.5]}>
        {/* 授与式用のローカル照明(distance で周囲に漏らさない) */}
        <pointLight
          position={[0.9, 1.3, 1.2]}
          intensity={6}
          distance={5}
          color="#fff6dd"
        />
        <pointLight
          position={[-0.8, 0.6, -0.9]}
          intensity={3}
          distance={5}
          color="#ffb3c7"
        />

        {/* 後光(トロフィーの背後) */}
        <mesh ref={raysRef} position={[0, 0.45, -0.65]}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial
            ref={raysMatRef}
            map={getRaysTexture()}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* 台座(せり上がってくる円柱。中は空洞に見えないよう長め) */}
        <mesh position={[0, -0.72, 0]}>
          <cylinderGeometry args={[0.34, 0.38, 1.44, 36]} />
          <meshStandardMaterial
            color="#141a4a"
            metalness={0.3}
            roughness={0.55}
          />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.022, 10, 40]} />
          <meshStandardMaterial
            color="#ffd93d"
            metalness={0.8}
            roughness={0.3}
            emissive="#7a5210"
            emissiveIntensity={0.3}
          />
        </mesh>

        {/* トロフィー本体(台座の中からせり上がる) */}
        <group ref={trophyRef} position={[0, -1.1, 0]}>
          <TrophyMesh roundNo={roundNo} name={name} />
        </group>

        {/* キラ星(2群を位相ずらし) */}
        <points geometry={starGeomA}>
          <pointsMaterial
            ref={starsMatA}
            size={0.13}
            map={getStarTexture()}
            color="#fff3b0"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        <points geometry={starGeomB}>
          <pointsMaterial
            ref={starsMatB}
            size={0.1}
            map={getStarTexture()}
            color="#ffd7e6"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>
    </group>
  );
}

/**
 * 授与式のエントリ。トロフィーフェーズ以外では何も描画しない。
 * GameCanvas 側は常時マウントしてよい。
 */
export default function TrophyCeremony() {
  const phase = useGameStore((s) => s.phase);
  if (phase !== "trophy") return null;
  return <Ceremony />;
}
