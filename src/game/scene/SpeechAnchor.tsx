"use client";

// こすくまくんの「頭のてっぺん」を、毎フレーム スクリーン座標へ投影して
// sharedRefs.speechAnchor に書き込むだけのコンポーネント(何も描画しない)。
// DOM側の SpeechBubble がこれを rAF で読んで吹き出しを置く。
//
// 位置は Kosukuma が描いているモデル(useGLTF のキャッシュは同じ実体)の
// matrixWorld からとる。こうすると safe のホップ(py+0.6)・伸び(sy 1.22)や
// launch の stretch(sy 1.45)・降臨の落下が、ぜんぶ自動で乗ってくる。
// 足元からの固定値でとると、伸びた体に追いつけず吹き出しが体に潜り込む。
//
// zustand を通すと毎フレーム再レンダリングになるので、共有オブジェクトへ直書きする。

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { T_LAUNCH } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { kosukumaWorldPos, speechAnchor } from "./sharedRefs";

/** この距離のとき scale=1.0(既定カメラ位置からこすくまくんまでの距離) */
const REF_DIST = 18;

/** 少しはみ出しても吹き出し側が引き寄せるので、可視判定はNDCより気持ち広く取る */
const NDC_MARGIN = 1.35;

/** モデルが測れなかったときの保険(DESIGN.md: 高さ2units・原点足元) */
const FALLBACK_TOP = 2;
const FALLBACK_HALF = 0.42;

const _crown = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _child = new THREE.Matrix4();
const _box = new THREE.Box3();
const _sub = new THREE.Box3();

/** 8隅の投影に使う作業用ベクトル */
const _corner = new THREE.Vector3();

interface Dims {
  /** モデルローカルの頭のてっぺんの高さ */
  topY: number;
  /** モデルローカルのバウンディングボックス(8隅を毎フレーム投影して実寸を出す) */
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * モデルの寸法をローカル空間で1回だけ測る。
 * scene 自身の matrix(=Kosukuma がかけている SCALE)は含めない。
 * あとで matrixWorld をかけるので、二重にかからないようにするため。
 */
function measureLocal(scene: THREE.Object3D): Dims {
  _box.makeEmpty();
  const walk = (o: THREE.Object3D, parent: THREE.Matrix4) => {
    o.updateMatrix();
    const cur = new THREE.Matrix4().multiplyMatrices(parent, o.matrix);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) {
        _sub.copy(bb).applyMatrix4(cur);
        _box.union(_sub);
      }
    }
    for (const c of o.children) walk(c, cur);
  };
  _child.identity();
  for (const c of scene.children) walk(c, _child);
  if (_box.isEmpty() || !Number.isFinite(_box.max.y) || _box.max.y <= 0) {
    return {
      topY: FALLBACK_TOP,
      min: new THREE.Vector3(-FALLBACK_HALF, 0, -FALLBACK_HALF),
      max: new THREE.Vector3(FALLBACK_HALF, FALLBACK_TOP, FALLBACK_HALF),
    };
  }
  return { topY: _box.max.y, min: _box.min.clone(), max: _box.max.clone() };
}

export default function SpeechAnchor() {
  // Kosukuma.tsx と同じキャッシュ実体。<primitive> で描かれている当人なので
  // matrixWorld にフェーズ演出の結果がそのまま入っている
  const { scene } = useGLTF("/models/kosukuma.glb");
  const dimsRef = useRef<Dims | null>(null);

  useFrame((state) => {
    const s = useGameStore.getState();
    const phase = s.phase;

    // こすくまくんが画面にいないフェーズ(Kosukuma.tsx の visible と揃える)。
    // 授与式のあいだは飛んでいって不在なので、吹き出しも出さない。
    const t = (Date.now() - s.phaseAt) / 1000;
    const gone =
      phase === "name-entry" ||
      phase === "trophy" ||
      (phase === "launch" && t > (T_LAUNCH / 1000) * 0.78);

    if (!dimsRef.current) dimsRef.current = measureLocal(scene);
    const dims = dimsRef.current;

    // Kosukuma.tsx が今フレームに動かした結果を、ここで確定させる
    scene.updateWorldMatrix(true, false);
    _mat.copy(scene.matrixWorld);
    _crown.set(0, dims.topY, 0).applyMatrix4(_mat);
    _foot.set(0, 0, 0).applyMatrix4(_mat);
    // 縮みきった(launch終盤)等で潰れていたら、共有の足元座標へ逃がす
    if (_crown.distanceToSquared(_foot) < 1e-6) {
      _foot.copy(kosukumaWorldPos);
      _crown.copy(kosukumaWorldPos).setY(kosukumaWorldPos.y + FALLBACK_TOP);
    }

    const cam = state.camera;
    // CameraRig より先に呼ばれてもズレないよう、投影前に行列を作り直す
    cam.updateMatrixWorld();
    const dist = cam.position.distanceTo(_crown);

    _crown.project(cam);

    // カメラの後ろの点は project で符号が反転する。z が [-1,1] の外なら前にいない
    const inFront = _crown.z > -1 && _crown.z < 1;
    const { width, height } = state.size;
    const cx = (_crown.x * 0.5 + 0.5) * width;
    const cy = (-_crown.y * 0.5 + 0.5) * height;

    speechAnchor.x = cx;
    speechAnchor.y = cy;

    // 画面上の見た目の大きさ。バウンディングボックスの8隅をそのまま投影して
    // 実測する(ローカル比からの換算だと、寄りカメラで耳が張り出したぶんを
    // 取りこぼして、吹き出しが体にくっついてしまう)
    if (inFront) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        _corner
          .set(
            i & 1 ? dims.max.x : dims.min.x,
            i & 2 ? dims.max.y : dims.min.y,
            i & 4 ? dims.max.z : dims.min.z
          )
          .applyMatrix4(_mat)
          .project(cam);
        const px = (_corner.x * 0.5 + 0.5) * width;
        const py = (-_corner.y * 0.5 + 0.5) * height;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      // 頭のてっぺんを中心に見た、左右それぞれの張り出しのうち大きいほう
      const half = Math.max(cx - minX, maxX - cx, 0);
      speechAnchor.bodyW = Math.min(width * 2, half * 2);
      speechAnchor.bodyH = Math.min(height * 2, Math.max(maxY - minY, 0));
    }

    speechAnchor.visible =
      !gone &&
      inFront &&
      Math.abs(_crown.x) < NDC_MARGIN &&
      Math.abs(_crown.y) < NDC_MARGIN;
    // 遠いほど小さく(ただし読めなくならないよう、DOM側でさらにゆるめる)
    speechAnchor.scale = Math.min(
      1.15,
      Math.max(0.6, REF_DIST / Math.max(dist, 0.001))
    );
  });

  return null;
}
