"use client";

// 1000個の剣穴。黒ひげ危機一発の樽とおなじ **縦長のスリット(打ち抜きの切り欠き)**。
// まるいクレーターではない、というのがこのファイルでいちばん大事なところ。
//
//   ・向き: 長辺は経線方向(北極を向く)。正は `slotAlignQuat()`(中身は `slotUp()`)
//     ただひとつで、剣 (`orientSword`) もまったく同じ関数から向きを取る。
//     別々に計算すると必ずズレて、剣がスリットを横切って刺さってしまう。
//   ・寸法: 「刃のいちばん太いところがちょうど通る」大きさから逆算する。
//     刃より狭いと嘘に見えるし、広すぎるとスカスカに見える。
//   ・奥ゆき: 真っ黒な板を貼るのではなく、内壁のある小さな切り欠きとして作る。
//     月(真球)は掘れないので、**月面の上に立てた低い土手**として表現し、
//     裾を球面より下へ潜らせて、つなぎ目を月そのものに隠してもらう。
//     暗さは頂点カラーに焼いたAO、ふちの明るい線は打ち抜きのバリ。
//
// 描画は InstancedMesh 1本。ホバー/選択はインスタンスカラー + わずかな拡大で見せる。

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { COLORS, HOLE_COUNT, MOON_RADIUS } from "@/lib/config";
import { getBit } from "@/lib/bitmask";
import { getHolePoints } from "@/lib/holes";
import { useGameStore } from "@/game/store";
import { slotAlignQuat, SWORD_DIMS } from "./sword/buildSword";
import { getHoleWorld } from "./sharedRefs";

// ── スリットの寸法(すべて剣の刃から逆算する) ───────────────────
// 実物の樽のスリットは「刃のいちばん太いところが通る」大きさで打ち抜かれている。
// ここでも刃を基準にすることで、剣の寸法をいじってもスリットが勝手に追従する。

/**
 * 刃のいちばん太いところ(鍔ぎわ)の幅。
 * `buildSword` は鍔の長さを「刃の最大幅の2.1倍」で作っているので、
 * 公開されている `guardHalf` から逆算できる(剣の寸法の正はあちら1か所)。
 */
const BLADE_MAX_W = (SWORD_DIMS.guardHalf * 2) / 2.1;
/** 刃の厚み。`buildSword` の BLADE_THICK(1枚板なので刃も柄も同じ厚み) */
const BLADE_THICK = 0.04;

/** スリットの長辺(経線方向)。刃の最大幅 + あそび1割 */
const SLOT_LEN = BLADE_MAX_W * 1.1;
/** スリットの短辺。刃の厚み + あそび3割(個体差で剣が8%太っても当たらない) */
const SLOT_WID = BLADE_THICK * 1.3;
/** 角のまるみ。打ち抜きなので「わずかに丸い」程度にとどめる */
const SLOT_R = SLOT_WID * 0.26;
/** 角ひとつぶんの分割数(1周 = 4×(この数+1) 点) */
const CORNER_SEG = 3;

/**
 * スリットの断面(外 → 内)。
 * `d` = 輪郭からの外向きオフセット / `y` = 理想球面からの高さ /
 * `shade` = 頂点カラー(インスタンスカラーに掛かる暗さ) /
 * `nr`,`ny` = 法線の(半径方向, 上)成分。
 *
 * 月は真球のままなので穴を掘れない。そこで **月面すれすれの低い土手** を立てて、
 * その内側を落ち込ませる。裾(いちばん外)は球面より下に沈めてあるので、
 * 月に飲み込まれて見えない = つなぎ目が出ない。
 */
const PROFILE: readonly (readonly [number, number, number, number, number])[] = [
  // d, y, shade, nr, ny
  [0.052, -0.012, 1.0, 0.35, 0.94], // 月にうもれた裾。つなぎ目かくし
  [0.03, 0.004, 1.0, 0.0, 1.0], // 月面とツライチのふち。色も法線も月と同じ = 見えない
  [0.013, 0.019, 1.12, 0.62, 0.78], // 土手の肩
  [0.004, 0.028, 1.34, 0.3, 0.95], // 打ち抜きのバリ。ここだけ細い明るい線になる
  [0.0, 0.026, 0.42, -0.55, 0.84], // 口。ここから内壁が落ちる
  [-0.001, 0.013, 0.16, -0.99, 0.16], // 内壁(AOで一気に暗くする)
  [-0.002, 0.0045, 0.085, -0.92, 0.39], // 内壁の底
];
/** 底のフタ。剣の刃はこの板を突き抜けて下(月の中)へ埋まる */
const FLOOR_D = -0.002;
const FLOOR_Y = 0.0045;
const FLOOR_SHADE = 0.07;
const FLOOR_MID_SHADE = 0.055;

// ── 色 ──────────────────────────────────────────────
// 下地はその場所の月面テクスチャから拾う。ふちを月とまったく同じ色にすることで、
// 土手が「月にあいた穴」として読める(灰色を塗ると穴だけ浮いてしまう)。
const COLOR_BASE = new THREE.Color("#9a948a"); // テクスチャ読込前のフォールバック
const COLOR_HOVER = new THREE.Color("#ffe9a0"); // ホバーで暖かく光る
const COLOR_SELECTED = new THREE.Color(COLORS.accent);
const COLOR_PULSE = new THREE.Color("#fff4b8"); // 選択中の明滅の明るい側

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpQuat = new THREE.Quaternion();

interface RingPoint {
  x: number;
  z: number;
  /** 輪郭の外向き(接平面内の単位ベクトル)。法線を組み立てるのに使う */
  ux: number;
  uz: number;
}

/**
 * 角のまるい長方形の輪郭を、外へ `d` だけふくらませた点列。
 * 角の円弧だけを刻み、直線部は円弧の端点どうしを結んで表す。
 * こうすると各点の「外向き」がそのまま円弧の法線になるので、法線を手で書ける。
 */
function ringPoints(d: number): RingPoint[] {
  const hx = SLOT_LEN / 2 + d;
  const hz = SLOT_WID / 2 + d;
  const r = Math.max(0.0005, Math.min(SLOT_R + d, hz));
  const cx = hx - r;
  const cz = hz - r;
  const corners: readonly (readonly [number, number, number])[] = [
    [cx, cz, 0],
    [-cx, cz, Math.PI / 2],
    [-cx, -cz, Math.PI],
    [cx, -cz, (3 * Math.PI) / 2],
  ];
  const out: RingPoint[] = [];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= CORNER_SEG; i++) {
      const a = a0 + (Math.PI / 2) * (i / CORNER_SEG);
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      out.push({ x: ox + ux * r, z: oz + uz * r, ux, uz });
    }
  }
  return out;
}

/**
 * スリット1個ぶんのジオメトリ(全インスタンス共通)。
 * 断面を1周ぶん押し出した帯 + 底のフタ。約208三角形。
 */
function makeSlotGeometry(): THREE.BufferGeometry {
  const rings = PROFILE.map((p) => ringPoints(p[0]));
  const P = rings[0].length;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  // 断面の各点を1周ぶん並べる。法線は断面から手で組む
  // (computeVertexNormals に任せると、月とツライチにしたいふちの法線まで
  //  土手の斜面と平均されてしまい、穴のまわりが輪っか状に明るくなる)
  for (let j = 0; j < PROFILE.length; j++) {
    const [, y, shade, nr, ny] = PROFILE[j];
    const nl = Math.hypot(nr, ny) || 1;
    for (const p of rings[j]) {
      pos.push(p.x, y, p.z);
      nor.push((nr * p.ux) / nl, ny / nl, (nr * p.uz) / nl);
      col.push(shade, shade, shade);
    }
  }
  for (let j = 0; j < PROFILE.length - 1; j++) {
    for (let i = 0; i < P; i++) {
      const i2 = (i + 1) % P;
      const a = j * P + i;
      const b = j * P + i2;
      const c = (j + 1) * P + i;
      const d = (j + 1) * P + i2;
      idx.push(a, c, d, a, d, b);
    }
  }

  // 底のフタ。内壁とは法線を分けたいので、輪をもう1周ぶん持つ
  const floor = pos.length / 3;
  for (const p of ringPoints(FLOOR_D)) {
    pos.push(p.x, FLOOR_Y, p.z);
    nor.push(0, 1, 0);
    col.push(FLOOR_SHADE, FLOOR_SHADE, FLOOR_SHADE);
  }
  const mid = pos.length / 3;
  pos.push(0, FLOOR_Y, 0);
  nor.push(0, 1, 0);
  col.push(FLOOR_MID_SHADE, FLOOR_MID_SHADE, FLOOR_MID_SHADE);
  for (let i = 0; i < P; i++) {
    idx.push(floor + i, mid, floor + ((i + 1) % P));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 月面テクスチャから各穴の位置の色を拾う(非同期)。
 * スリットの下地色になる。ふち(shade=1.0)を月とまったく同じ色にしたいので、
 * ここでは明るさをいじらずそのまま拾う。内壁の暗さは頂点カラー側が持っている。
 */
function sampleMoonColors(onReady: (colors: Float32Array) => void): () => void {
  let cancelled = false;
  const img = new Image();
  img.onload = () => {
    if (cancelled) return;
    const W = 512;
    const H = 256;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const pts = getHolePoints();
    const out = new Float32Array(HOLE_COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < HOLE_COUNT; i++) {
      const [nx, ny, nz] = pts[i].normal;
      // three.jsのSphereGeometryと同じ equirect UV (φ = atan2(z, -x))
      const u = (Math.atan2(nz, -nx) / (Math.PI * 2) + 1) % 1;
      const y = Math.acos(Math.min(1, Math.max(-1, ny))) / Math.PI; // 0=北極
      const px = Math.min(W - 1, Math.floor(u * W));
      const py = Math.min(H - 1, Math.floor(y * H));
      const o = (py * W + px) * 4;
      c.setRGB(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255)
        .convertSRGBToLinear();
      out[i * 3] = c.r;
      out[i * 3 + 1] = c.g;
      out[i * 3 + 2] = c.b;
    }
    onReady(out);
  };
  img.src = "/textures/moon_color.jpg";
  return () => {
    cancelled = true;
  };
}

export default function Holes() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const points = useMemo(() => getHolePoints(), []);

  // 各穴の基準位置・姿勢・大きさの個体差を事前計算(毎フレームの再合成用)。
  // ジオメトリ側が球面からの高さを持っているので、位置は月面ちょうどでよい
  const base = useMemo(() => {
    const pos = new Float32Array(HOLE_COUNT * 3);
    const quat = new Float32Array(HOLE_COUNT * 4);
    const size = new Float32Array(HOLE_COUNT);
    for (let i = 0; i < HOLE_COUNT; i++) {
      const p = points[i];
      pos[i * 3] = p.position[0];
      pos[i * 3 + 1] = p.position[1];
      pos[i * 3 + 2] = p.position[2];
      slotAlignQuat(p.normal[0], p.normal[1], p.normal[2], tmpQuat);
      quat[i * 4] = tmpQuat.x;
      quat[i * 4 + 1] = tmpQuat.y;
      quat[i * 4 + 2] = tmpQuat.z;
      quat[i * 4 + 3] = tmpQuat.w;
      size[i] = p.scale;
    }
    return { pos, quat, size };
  }, [points]);

  const geometry = useMemo(() => makeSlotGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff", // インスタンスカラー × 頂点カラーをそのまま見せる
        vertexColors: true, // 断面に焼いたAO(暗さ)とバリ(明るさ)
        roughness: 1, // 月と同じ質感。ふちが月から浮かないように
        metalness: 0,
      }),
    []
  );

  // アニメ管理: 現在スケールと「動いている穴」だけを毎フレーム更新する
  const scales = useRef(new Float32Array(HOLE_COUNT).fill(1));
  const active = useRef(new Set<number>());
  const prevHover = useRef<number | null>(null);
  const prevSelected = useRef<number | null>(null);
  const prevSelScale = useRef(1);
  // 月面テクスチャから拾った各穴の下地色(読込完了までnull)
  const baseColors = useRef<Float32Array | null>(null);

  useEffect(() => {
    return sampleMoonColors((colors) => {
      baseColors.current = colors;
      const mesh = meshRef.current;
      if (!mesh) return;
      for (let i = 0; i < HOLE_COUNT; i++) {
        tmpColor.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
        mesh.setColorAt(i, tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, []);

  /** 基準位置+姿勢+スケール(個体差×アニメ)で行列を書き込む */
  const writeMatrix = (mesh: THREE.InstancedMesh, id: number, sc: number) => {
    const { pos, quat, size } = base;
    tmpObj.position.set(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
    tmpObj.quaternion.set(
      quat[id * 4],
      quat[id * 4 + 1],
      quat[id * 4 + 2],
      quat[id * 4 + 3]
    );
    // 法線方向(ローカルY)の高さは変えず、口だけ広げる
    // (土手が背伸びすると、月面にイボが生えたように見えてしまう)
    const s = sc * size[id];
    tmpObj.scale.set(s, 1, s);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(id, tmpObj.matrix);
  };

  // 初期配置: 全インスタンスの行列と基本色
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < HOLE_COUNT; i++) {
      writeMatrix(mesh, i, 1);
      mesh.setColorAt(i, COLOR_BASE);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // idleを離れたらカーソルを戻す
  useEffect(() => {
    const unsub = useGameStore.subscribe((s) => {
      if (s.phase !== "idle") document.body.style.cursor = "";
    });
    return () => {
      unsub();
      document.body.style.cursor = "";
    };
  }, []);

  // 選択中の穴を指す光る枠。丸いリングだとスリットの向きと喧嘩するので、
  // スリットと相似の「角のまるい長方形の枠」にして、向きも穴とそろえる
  const markerRef = useRef<THREE.Mesh>(null);
  const markerGeom = useMemo(() => {
    const toVec = (p: RingPoint) => new THREE.Vector2(p.x, p.z);
    const shape = new THREE.Shape(ringPoints(0.085).map(toVec));
    shape.holes.push(new THREE.Path(ringPoints(0.055).map(toVec).reverse()));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // 形の(x, y) → ローカルの(X, -Z) = 長辺・短辺
    return g;
  }, []);
  const markerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COLORS.accent,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      markerGeom.dispose();
      markerMat.dispose();
    };
  }, [geometry, material, markerGeom, markerMat]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const s = useGameStore.getState();
    const hovered = s.phase === "idle" ? s.hoveredHole : null;
    const selected = s.selectedHole;
    const set = active.current;
    const time = state.clock.elapsedTime;

    // 選択中の穴の広がり。剣が入ってからも口を開けたままだと
    // 「刃がちょうど通る穴」に見えなくなるので、刺しに入ったら元の大きさへ戻す
    const selScale =
      s.phase === "idle" || s.phase === "confirming" ? 1.22 : 1;

    // ターゲット枠の表示・脈動
    const marker = markerRef.current;
    if (marker) {
      const show =
        selected !== null &&
        (s.phase === "confirming" ||
          s.phase === "stabbing" ||
          s.phase === "suspense");
      marker.visible = show;
      if (show && selected !== null) {
        const hw = getHoleWorld(selected);
        // 土手(高さ0.028)より上へ浮かせて、枠が月面に沈まないようにする
        marker.position.copy(hw.pos).addScaledVector(hw.normal, 0.05);
        slotAlignQuat(hw.normal.x, hw.normal.y, hw.normal.z, tmpQuat);
        marker.quaternion.copy(tmpQuat);
        // 刺し〜判定はカメラが引くのでマーカーを大きくして見失わせない
        const far = s.phase === "confirming" ? 1 : 2.1;
        marker.scale.setScalar(
          Math.max(1, base.size[selected]) *
            far *
            (1 + 0.07 * Math.sin(time * 5))
        );
        markerMat.opacity = 0.72 + 0.22 * Math.sin(time * 5);
      }
    }

    // 対象が変わった穴(と、選択穴の広がりが変わったとき)をアニメ対象に追加
    if (
      hovered !== prevHover.current ||
      selected !== prevSelected.current ||
      selScale !== prevSelScale.current
    ) {
      for (const id of [
        prevHover.current,
        prevSelected.current,
        hovered,
        selected,
      ]) {
        if (id !== null) set.add(id);
      }
      prevHover.current = hovered;
      prevSelected.current = selected;
      prevSelScale.current = selScale;
    }
    if (set.size === 0) return;

    const arr = scales.current;
    const done: number[] = [];
    const k = Math.min(1, delta * 14); // ばね風の追従

    for (const id of set) {
      const isSel = id === selected;
      const isHov = id === hovered;
      const target = isSel ? selScale : isHov ? 1.1 : 1;
      let sc = arr[id];
      sc += (target - sc) * k;
      // 色: インスタンスカラーは断面ぜんぶに掛かるので、
      // 明るい色を入れるとバリのふちが強く光り、中は暗いまま = 枠が光る
      if (isSel) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 7);
        tmpColor.copy(COLOR_SELECTED).lerp(COLOR_PULSE, pulse);
      } else if (isHov) {
        tmpColor.copy(COLOR_HOVER);
      } else {
        const bc = baseColors.current;
        if (bc) {
          tmpColor.setRGB(bc[id * 3], bc[id * 3 + 1], bc[id * 3 + 2]);
        } else {
          tmpColor.copy(COLOR_BASE);
        }
        if (Math.abs(sc - 1) < 0.002) {
          sc = 1;
          done.push(id);
        }
      }
      arr[id] = sc;
      writeMatrix(mesh, id, sc);
      mesh.setColorAt(id, tmpColor);
    }
    for (const id of done) set.delete(id);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  /**
   * 月面のヒット位置から最寄りの「まだ空いている」穴を返す(タップ寛容化)。
   * スリットは細いので直接当てさせず、見えない月サイズの球でレイを受けて
   * いちばん近い空き穴を選ぶ。遠すぎる(まわりが全部埋まっている)ときは null。
   */
  const pickNearest = (
    e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>
  ): number | null => {
    const p = e.point; // ピッキング球(半径MOON_RADIUS)上のワールド座標
    const mask = useGameStore.getState().mask;
    let best = -1;
    let bestD = Infinity;
    const { pos } = base;
    for (let i = 0; i < HOLE_COUNT; i++) {
      if (getBit(mask, i)) continue; // 刺さり済みは選ばせない
      const dx = pos[i * 3] - p.x;
      const dy = pos[i * 3 + 1] - p.y;
      const dz = pos[i * 3 + 2] - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // 半径0.6unit以内なら採用(穴の間隔は0.52〜0.57なので、ふつうは必ず届く)
    return bestD < 0.36 ? best : null;
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const s = useGameStore.getState();
    if (s.phase !== "idle") {
      if (s.hoveredHole !== null) s.hoverHole(null);
      return;
    }
    const id = pickNearest(e);
    s.hoverHole(id);
    document.body.style.cursor = id !== null ? "pointer" : "";
  };

  const handleOut = () => {
    useGameStore.getState().hoverHole(null);
    document.body.style.cursor = "";
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // ドラッグ(月回し)はタップ扱いにしない
    const id = pickNearest(e);
    if (id === null) return;
    useGameStore.getState().selectHole(id); // phase/cooldownの判定はstore側
  };

  return (
    <group>
      {/* 描画される1000個のスリット(レイキャストはピッキング球に任せる) */}
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, HOLE_COUNT]}
        frustumCulled={false}
      />
      {/* 選択中の穴を指す光る枠(スリットと相似形・同じ向き) */}
      <mesh
        ref={markerRef}
        geometry={markerGeom}
        material={markerMat}
        visible={false}
        raycast={() => undefined}
      />
      {/* 見えないピッキング球: 月面のどこを触っても最寄りの穴が選べる */}
      <mesh
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[MOON_RADIUS, 24, 24]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
