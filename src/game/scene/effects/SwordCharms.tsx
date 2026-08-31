"use client";

// 月に刺さった全員の剣に、チャームの房をぶら下げる。
//
// **立体はあきらめて、絵を貼った板を正面へ向ける(ビルボード)。**
// 1000本 × 最大10個 = 1万枚だが、板1枚を InstancedMesh で使い回すので
// 描画は1回で済む。立体で作ると1万個の部品になり、どうやっても持たない。
//
// 絵は棚や自分の剣とまったく同じ CharmGlyph を焼いたアトラス(charmAtlas.tsx)。
// 別に描き起こすと「遠くの剣だけ違うチャーム」になってしまう。
//
// 月に隠れる裏側は、月が深度を書いているので勝手に消える(自前の間引き不要)。
// 半透明ではなく**抜き**(alphaTest)にしてあるので、前後の並べ替えも要らない。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HOLE_COUNT, MAX_EQUIPPED_CHARMS } from "@/lib/config";
import { getBit } from "@/lib/bitmask";
import { getHolePoints } from "@/lib/holes";
import { charmIndicesFor } from "@/lib/style";
import { useGameStore } from "@/game/store";
import { orientSword, SWORD_DIMS } from "@/game/scene/sword/buildSword";
import { ATLAS_COLS, ATLAS_ROWS, useCharmAtlas } from "./charmAtlas";

/**
 * 板1枚の大きさ(ワールド)。
 * **実物の比率よりわざと大きい。** 月は引きで見るものなので、写真どおりの
 * 比(刃の幅の1/3)にすると1個6pxほどになり、何が下がっているのか読めない。
 * 「他の人から見て一目で分かる」を優先して、刃の幅(0.158)の2/3まで太らせた。
 */
const CHARM_SIZE = 0.14;
/** 房の割りつけ(剣ローカル)。SwordArt の房と同じ組みかたにそろえてある */
const COL_GAP = 0.098;
const ROW_GAP = 0.09;
/** 割りカンから房のいちばん上までの落差 */
const DROP = 0.095;

const MAX_INSTANCES = HOLE_COUNT * MAX_EQUIPPED_CHARMS;

function colsFor(n: number): number {
  if (n <= 3) return 1;
  if (n <= 6) return 2;
  return 3;
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _local = new THREE.Vector3();
const _mat = new THREE.Matrix4();

export default function SwordCharms() {
  const mask = useGameStore((s) => s.mask);
  const stabStyles = useGameStore((s) => s.stabStyles);
  const stabCharms = useGameStore((s) => s.stabCharms);
  const playingStabs = useGameStore((s) => s.playingStabs);
  const atlas = useCharmAtlas();

  const points = useMemo(() => getHolePoints(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // 演出中の穴は Swords と同じく描かない(降ってくる剣が自前で房を持っている)
  const hidden = useMemo(() => new Set(playingStabs), [playingStabs]);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    // インスタンスごとの「アトラスのどのマスか」と「大きさ」
    g.setAttribute(
      "aCell",
      new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 2), 2)
    );
    g.setAttribute(
      "aScale",
      new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1)
    );
    return g;
  }, []);

  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null as THREE.Texture | null } },
      // ビルボード: instanceMatrix からは位置だけ取り、向きはカメラに正対させる。
      // 剣は月のあちこちを向いているので、板を剣に合わせると裏を向く子が出る
      vertexShader: /* glsl */ `
        attribute vec2 aCell;
        attribute float aScale;
        varying vec2 vUv;
        void main() {
          vUv = uv / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0) + aCell;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          center.xy += position.xy * aScale;
          gl_Position = projectionMatrix * center;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          // 抜き。半透明にすると1万枚の並べ替えが要るので、そこは持たない
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb, 1.0);
        }
      `,
      transparent: false,
    });
    return m;
  }, []);

  useEffect(() => {
    material.uniforms.uMap.value = atlas;
    material.needsUpdate = true;
  }, [atlas, material]);

  useEffect(() => {
    const geo = geometry;
    const mat = material;
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geometry, material]);

  // 刺さり具合が変わったときだけ、房の位置を組み直す
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !atlas) return;
    const cell = geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute;
    const scale = geometry.getAttribute("aScale") as THREE.InstancedBufferAttribute;
    let n = 0;

    for (let id = 0; id < HOLE_COUNT && n < MAX_INSTANCES; id++) {
      if (!getBit(mask, id)) continue;
      if (hidden.has(id)) continue;
      const list = charmIndicesFor(stabStyles[id], stabCharms[id]);
      if (list.length === 0) continue;

      const p = points[id];
      _n.set(p.normal[0], p.normal[1], p.normal[2]);
      const size = orientSword(_n, id, _quat);
      _pos.set(p.position[0], p.position[1], p.position[2]);

      const cols = colsFor(list.length);
      const anchor = SWORD_DIMS.charmAnchor;
      for (let k = 0; k < list.length && n < MAX_INSTANCES; k++) {
        const col = k % cols;
        const row = Math.floor(k / cols);
        // 剣ローカルで「鍔の端の外側 → 下へ」。碁盤にならないよう互い違いにずらす
        _local.set(
          // 鍔のはしより外へ。刃の上に乗せると、剣の輪郭が読めなくなる
          anchor.x + 0.1 - col * COL_GAP + ((row + col) % 2 ? 0.016 : -0.016),
          anchor.y - DROP - row * ROW_GAP,
          0.03
        );
        _local.applyQuaternion(_quat).multiplyScalar(size).add(_pos);
        _mat.makeTranslation(_local.x, _local.y, _local.z);
        mesh.setMatrixAt(n, _mat);
        cell.setXY(
          n,
          (list[k] % ATLAS_COLS) / ATLAS_COLS,
          Math.floor(list[k] / ATLAS_COLS) / ATLAS_ROWS
        );
        scale.setX(n, CHARM_SIZE * size);
        n++;
      }
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    cell.needsUpdate = true;
    scale.needsUpdate = true;
  }, [mask, stabStyles, stabCharms, hidden, points, geometry, atlas]);

  if (!atlas) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
      raycast={() => undefined}
    />
  );
}
