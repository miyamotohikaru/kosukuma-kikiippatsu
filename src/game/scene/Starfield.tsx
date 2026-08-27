"use client";

// 背景の星空。半径60〜90の球殻に約2500個のPointsをprngで決定的に散らし、
// シェーダーでキラキラ明滅させる。数秒おきに流れ星が1本走る。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { hashString, mulberry32, pick, randRange } from "@/lib/prng";

const STAR_COUNT = 2500;

/** 星のわずかな色味(白多め+暖色/青/ピンク少々) */
const STAR_TINTS = [
  "#ffffff",
  "#ffffff",
  "#ffffff",
  "#ffffff",
  "#ffe9c9",
  "#cfd8ff",
  "#ffd3e0",
] as const;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    // 星ごとに速度と位相をずらした明滅
    float tw = sin(uTime * (0.6 + aPhase * 1.8) + aPhase * 40.0);
    vAlpha = 0.5 + 0.5 * tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // やわらかい丸ポイント
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.08, d) * (0.35 + 0.65 * vAlpha);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/** 流れ星のトレイル用グラデーション(先頭が明るい) */
function makeTrailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,1)"); // 上=v1=進行方向の先頭
  g.addColorStop(0.3, "rgba(255,240,200,0.65)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(canvas);
}

interface ShootingState {
  active: boolean;
  timer: number; // 次の出現までの待ち(秒)
  t: number; // 経過
  dur: number; // 飛行時間
  from: THREE.Vector3;
  dir: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

export default function Starfield() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const trailMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const shooting = useRef<ShootingState>({
    active: false,
    timer: 2.5,
    t: 0,
    dur: 1,
    from: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  });

  // 星の配置はprngで決定的に(全プレイヤーで同じ夜空)
  const geometry = useMemo(() => {
    const rng = mulberry32(hashString("kosukuma-stars"));
    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);
    const color = new Float32Array(STAR_COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < STAR_COUNT; i++) {
      // 球殻(60〜90)に一様分布
      const y = randRange(rng, -1, 1);
      const th = randRange(rng, 0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      const radius = randRange(rng, 60, 90);
      pos[i * 3] = Math.cos(th) * r * radius;
      pos[i * 3 + 1] = y * radius;
      pos[i * 3 + 2] = Math.sin(th) * r * radius;
      size[i] = randRange(rng, 0.6, 2.0);
      phase[i] = rng();
      c.set(pick(rng, STAR_TINTS));
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uScale: { value: 240 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  const trailTexture = useMemo(makeTrailTexture, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      trailTexture.dispose();
    };
  }, [geometry, material, trailTexture]);

  useFrame((state, delta) => {
    // 星の明滅
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uScale.value = state.gl.getPixelRatio() * 240;

    // 流れ星(装飾なのでMath.randomでよい)
    const st = shooting.current;
    const trail = trailRef.current;
    const trailMat = trailMatRef.current;
    if (!trail || !trailMat) return;

    if (!st.active) {
      st.timer -= delta;
      trail.visible = false;
      if (st.timer <= 0) {
        // 天球上のランダムな点から接線方向へ
        const v = new THREE.Vector3().randomDirection();
        v.y *= 0.55; // 上下の端より画面に入りやすい高さへ寄せる
        v.normalize();
        st.from.copy(v).multiplyScalar(68);
        st.dir
          .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .cross(v)
          .normalize();
        st.dur = 0.9 + Math.random() * 0.6;
        st.t = 0;
        st.active = true;
      }
      return;
    }

    st.t += delta;
    const p = st.t / st.dur;
    if (p >= 1) {
      st.active = false;
      st.timer = 3 + Math.random() * 6; // 数秒おき
      trail.visible = false;
      return;
    }
    const speed = 55;
    trail.visible = true;
    trail.position
      .copy(st.from)
      .addScaledVector(st.dir, speed * st.t)
      .addScaledVector(st.dir, -3.5); // トレイルの中心を頭の後ろへ
    trail.quaternion.setFromUnitVectors(UP, st.dir);
    trailMat.opacity = Math.sin(Math.PI * p); // ふわっと現れて消える
  });

  return (
    <group>
      <points geometry={geometry} material={material} frustumCulled={false} />
      {/* 流れ星: 先端が明るい細長シリンダー(どの角度からでも見える) */}
      <mesh ref={trailRef} visible={false} frustumCulled={false}>
        <cylinderGeometry args={[0.06, 0.01, 7, 6, 1, true]} />
        <meshBasicMaterial
          ref={trailMatRef}
          map={trailTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
