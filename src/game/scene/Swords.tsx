"use client";

// 月に刺さっている全員の剣(最大1000本)。
// 剣は「1色成型のプラスチック」なので刃も柄もひとつのジオメトリに結合でき、
// 剣まるごとを InstancedMesh 1本で描ける。ただし metalness/opacity は
// インスタンスごとに変えられないので、スキンごとにメッシュを分ける
// (実際に刺さっているスキンぶんだけ出すので、ふだんは1〜2本)。
// 色はインスタンスカラー、チャームは鍔の下の小さなビーズ1個に簡略化する。
// (自分のヒーロー剣は持っているぶん全部ぶら下げるが、1000本×13個は破綻する。
//  そのかわりビーズの色を「いちばん新しいチャームの色」、大きさを「個数」に
//  対応させて、遠目にも "たくさん持っている剣" が分かるようにしてある)
// 向きは法線+prng(holeId)による決定的な傾き(全プレイヤーで同じ見た目)。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { HOLE_COUNT, SWORD_COLORS, SWORD_SKINS } from "@/lib/config";
import { getBit } from "@/lib/bitmask";
import { getHolePoints } from "@/lib/holes";
import { skinOf } from "@/lib/style";
import { useGameStore } from "@/game/store";
import { makeCircleTexture } from "@/game/scene/effects/textures";
import SwordCharms from "@/game/scene/effects/SwordCharms";
import {
  makeSwordMaterial,
  makeToySwordGeometry,
  orientSword,
  SWORD_DIMS,
  tickSwordMaterial,
} from "@/game/scene/sword/buildSword";

const tmpObj = new THREE.Object3D();
const tmpNormal = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpColor = new THREE.Color();
/** SWORD_COLORS を THREE.Color に変換したキャッシュ */
const SWORD_TINTS = SWORD_COLORS.map((c) => new THREE.Color(c.hex));

/** 自分の剣の上でふんわり光るハロ(1個分) */
function MyGlow({ holeId, colorHex }: { holeId: number; colorHex: string }) {
  const matRef = useRef<THREE.SpriteMaterial>(null);
  const texture = useMemo(() => makeCircleTexture(), []);
  const { pos, phase } = useMemo(() => {
    const p = getHolePoints()[holeId];
    return {
      pos: new THREE.Vector3(
        p.position[0] + p.normal[0] * 0.45,
        p.position[1] + p.normal[1] * 0.45,
        p.position[2] + p.normal[2] * 0.45
      ),
      phase: (holeId % 10) * 0.63, // となり同士で明滅がそろわないように
    };
  }, [holeId]);

  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  useFrame((state) => {
    const m = matRef.current;
    if (m) m.opacity = 0.3 + 0.18 * Math.sin(state.clock.elapsedTime * 2.6 + phase);
  });

  return (
    <sprite position={pos} scale={[0.62, 0.62, 0.62]} raycast={() => undefined}>
      <spriteMaterial
        ref={matRef}
        map={texture}
        color={colorHex}
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

export default function Swords() {
  const mask = useGameStore((s) => s.mask);
  const stabColors = useGameStore((s) => s.stabColors);
  const stabStyles = useGameStore((s) => s.stabStyles);
  const stabCharms = useGameStore((s) => s.stabCharms);
  const myStabs = useGameStore((s) => s.myStabs);
  const swordColor = useGameStore((s) => s.swordColor);
  const playingStabs = useGameStore((s) => s.playingStabs);

  const points = useMemo(() => getHolePoints(), []);
  const geometry = useMemo(() => makeToySwordGeometry("field"), []);

  // スキンごとの InstancedMesh。ref はスキンindexで引けるようにしておく
  const meshes = useRef(new Map<number, THREE.InstancedMesh>());

  // マテリアルは使い回す(スキンが増えても既存を作り直さない)
  const materials = useMemo(() => new Map<number, THREE.MeshPhysicalMaterial>(), []);
  const materialFor = (skin: number): THREE.MeshPhysicalMaterial => {
    let m = materials.get(skin);
    if (!m) {
      // tinted なスキンは白地にして、色はインスタンスカラーで塗る
      const s = SWORD_SKINS[skin];
      m = makeSwordMaterial(skin, s.tinted ? "#ffffff" : s.hex);
      materials.set(skin, m);
    }
    return m;
  };

  useEffect(() => {
    const geo = geometry;
    const mats = materials;
    return () => {
      geo.dispose();
      // キャッシュは空にしない(空にすると、再マウント時に描画中のメッシュと
      // マテリアルの参照がずれて、にじいろの更新先を見失う)
      mats.forEach((m) => m.dispose());
    };
  }, [geometry, materials]);

  // いま「降ってきて刺さる」演出を **実際に受け持っている** 穴だけ、ここでは
  // 描かない(二重に見せない)。順番待ちのぶんまで隠すと、混んでいるときに
  // 「どちらも描かない穴」ができて、刺さっている剣が消えて見えてしまう
  const hidden = useMemo(
    () => new Set(playingStabs),
    [playingStabs]
  );

  // この代に実在するスキンだけメッシュを出す(ふだんは ノーマル1本で済む)
  const presentSkins = useMemo(() => {
    let bits = 0;
    for (let id = 0; id < HOLE_COUNT; id++) {
      if (getBit(mask, id)) bits |= 1 << skinOf(stabStyles[id]);
    }
    const out: number[] = [];
    for (let s = 0; s < SWORD_SKINS.length; s++) {
      if (bits & (1 << s)) out.push(s);
    }
    return out;
  }, [mask, stabStyles]);

  // mask/色/スキン/演出中の穴 が変わったときだけ行列と色を再構築
  useEffect(() => {
    const counts = new Map<number, number>();

    for (let id = 0; id < HOLE_COUNT; id++) {
      if (!getBit(mask, id)) continue;
      if (hidden.has(id)) continue;
      const style = stabStyles[id];
      const skin = skinOf(style);
      const mesh = meshes.current.get(skin);
      if (!mesh) continue;

      const p = points[id];
      tmpNormal.set(p.normal[0], p.normal[1], p.normal[2]);
      const size = orientSword(tmpNormal, id, tmpQuat);
      tmpObj.position.set(p.position[0], p.position[1], p.position[2]);
      tmpObj.quaternion.copy(tmpQuat);
      tmpObj.scale.setScalar(size);
      tmpObj.updateMatrix();

      const n = counts.get(skin) ?? 0;
      mesh.setMatrixAt(n, tmpObj.matrix);
      // 色: 0=デフォルト / 1..N=選ばれた色。固定色のスキンでは塗らない
      if (SWORD_SKINS[skin].tinted) {
        const c = stabColors[id];
        tmpColor.copy(SWORD_TINTS[c > 0 && c <= SWORD_TINTS.length ? c - 1 : 0]);
        mesh.setColorAt(n, tmpColor);
      }
      counts.set(skin, n + 1);

    }

    meshes.current.forEach((mesh, skin) => {
      mesh.count = counts.get(skin) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [mask, stabColors, stabStyles, stabCharms, points, hidden, presentSkins]);

  // にじいろの色相と、金属・宝石のきらめきは時間で動く。
  // 動くスキンが刺さっている代だけ時計を進める(ノーマルだけの代はゼロコスト)
  const animatedSkins = useMemo(
    () =>
      presentSkins.filter(
        (s) => SWORD_SKINS[s].iridescent || SWORD_SKINS[s].sparkle > 0
      ),
    [presentSkins]
  );
  useFrame((state) => {
    for (const s of animatedSkins) {
      tickSwordMaterial(materialFor(s), state.clock.elapsedTime);
    }
  });

  const myColorHex = SWORD_COLORS[swordColor]?.hex ?? SWORD_COLORS[0].hex;

  return (
    <group>
      {/* 穴のホバー/タップを遮らないようレイキャスト対象から外す */}
      {presentSkins.map((skin) => (
        <instancedMesh
          key={skin}
          ref={(el) => {
            if (el) {
              el.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
              meshes.current.set(skin, el);
            } else {
              meshes.current.delete(skin);
            }
          }}
          args={[geometry, materialFor(skin), HOLE_COUNT]}
          frustumCulled={false}
          raycast={() => undefined}
        />
      ))}
      {/* チャームの房。立体をやめて、絵を貼った板を正面へ向けている
          (1000本 × 10個を立体で作ると、どうやっても持たない) */}
      <SwordCharms />
      {/* 自分の剣の目印(この端末で刺したもの)。色は刺したときの色に合わせる */}
      {myStabs.map((id) => {
        if (!getBit(mask, id)) return null;
        const c = stabColors[id];
        const hex =
          c > 0 && c <= SWORD_COLORS.length
            ? SWORD_COLORS[c - 1].hex
            : myColorHex;
        return <MyGlow key={id} holeId={id} colorHex={hex} />;
      })}
    </group>
  );
}
