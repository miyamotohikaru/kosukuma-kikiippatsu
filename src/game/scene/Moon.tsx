"use client";

// 月本体。NASA LRO(ルナー・リコネサンス・オービター)の実写カラーマップと
// 標高マップ(バンプ)でリアルな月面にする。ジオメトリは真球のまま
// (穴・剣の位置合わせのため頂点変位はさせない)。原点固定・回転しない。

import { useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { MOON_RADIUS } from "@/lib/config";

export default function Moon() {
  const [map, bump] = useTexture([
    "/textures/moon_color.jpg",
    "/textures/moon_disp.jpg",
  ]);

  // テクスチャ設定は参照が変わったときだけ
  useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
    bump.anisotropy = 4;
    bump.needsUpdate = true;
  }, [map, bump]);

  return (
    <mesh>
      <sphereGeometry args={[MOON_RADIUS, 96, 64]} />
      <meshStandardMaterial
        map={map}
        bumpMap={bump}
        bumpScale={1.6}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}
