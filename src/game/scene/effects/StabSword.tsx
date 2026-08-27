"use client";

// 自分の剣。stabbing で「きらめきながら構え → 一気に突き刺す」、
// suspense で柄が小刻みに震え、safe の間は刺さったまま残る
// (idle に戻った瞬間に Swords の刺さり済みインスタンスへ引き継がれる)。
//
// 剣そのものは共有ビルダー(sword/buildSword)の黒ひげ剣。ここは
// 「主役の1本」なので、持っているチャームを**全部**ぶら下げて揺らす
// (月の1000本はビーズ1個に簡略化しているぶん、自分の剣だけは じまんできる)。

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { charmLevelOf, T_STAB } from "@/lib/config";
import { charmIndicesFrom } from "@/lib/style";
import { useGameStore } from "@/game/store";
import { getHoleWorld } from "@/game/scene/sharedRefs";
import {
  buildToySword,
  slotAlignQuat,
  SWORD_DIMS,
  type ToySword,
} from "@/game/scene/sword/buildSword";
import { backOut, easeInCubic, easeOutCubic } from "./easing";
import { makeCircleTexture, makeStarTexture } from "./textures";

// 自分の剣は引きの2ショットでも見えるように大きめの「ヒーローサイズ」。
// 剣そのものを月の飽和対策で小さくしたので、そのぶん倍率を上げて
// 画面での見え方(月面から出る高さ ≒ 1.9)は変えない
const HERO_SCALE = 2.6;

// 高さは「剣先の高さ」で組み立てる(構えの気持ちよさをこの値で調整してきたので)。
// ルート(=刺さり口)は剣先より刃の埋まるぶんだけ上にある。
// 突きの後半で剣が縮むので、この変換は毎フレームその時点の倍率で計算する。
const RAISE_H = 1.9; // 構えの高さ(穴の法線上)

// 刃に沿ってきらめきが走る範囲(ヒーローサイズでの world units)
const SPARKLE_FROM = -SWORD_DIMS.bury * HERO_SCALE * 0.92;
const SPARKLE_TO = (SWORD_DIMS.bladeLen - SWORD_DIMS.bury) * HERO_SCALE * 0.9;

const UP = new THREE.Vector3(0, 1, 0);
// 毎フレームの割り当てを避けるスクラッチ
const _pos = new THREE.Vector3();
const _n = new THREE.Vector3();
const _qAlign = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _eTilt = new THREE.Euler();

interface SwordRig {
  sword: ToySword;
  sparkle: THREE.Sprite;
  sparkleMat: THREE.SpriteMaterial;
  haloMat: THREE.SpriteMaterial;
  dispose: () => void;
}

/** 黒ひげ剣に、構え中のきらめきと「ここに剣がある」ハロを足す */
function buildRig(): SwordRig {
  const s = useGameStore.getState();
  // この1本を数えたあとのチャーム数(10本目の剣には、その場で手に入れた
  // チャームがもうぶら下がっている)。store.confirmStab と同じ計算
  const charm = charmLevelOf(s.myTotal + 1);
  const sword = buildToySword({
    color: s.swordColor,
    skin: s.swordSkin,
    charm,
    // 何を下げるかは charmIndicesFrom が正(隠しチャーム「ちきゅう」は
    // 刺し本数では表せないので、数ではなく index の配列で渡す)
    charms: charmIndicesFrom(charm, s.hasEarthCharm),
    scale: HERO_SCALE,
  });

  // 構え中に刃を走るきらめき(加算スプライト)
  const starTex = makeStarTexture();
  const sparkleMat = new THREE.SpriteMaterial({
    map: starTex,
    color: "#fff6c8",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparkle = new THREE.Sprite(sparkleMat);
  sparkle.scale.setScalar(0.001);

  // 引きの構図でも「ここに剣がある」と分かる、やわらかい光のハロ
  const haloTex = makeCircleTexture();
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: "#ffe9a0",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(0, SWORD_DIMS.top * HERO_SCALE * 0.45, 0);
  halo.scale.setScalar(1.85);

  // スプライトは剣の大きさに引きずられないよう root 直下へ置く
  sword.root.add(sparkle, halo);
  sword.root.visible = false;

  return {
    sword,
    sparkle,
    sparkleMat,
    haloMat,
    dispose: () => {
      sword.dispose();
      sparkleMat.dispose();
      haloMat.dispose();
      haloTex.dispose();
      starTex.dispose();
    },
  };
}

export default function StabSword() {
  // マウント時(=stabbing 開始時)の選択穴と剣の見た目を固定。
  // 演出中に store 側が変わっても保持する
  const holeId = useMemo(() => useGameStore.getState().selectedHole, []);
  const rig = useMemo(buildRig, []);
  useEffect(() => () => rig.dispose(), [rig]);

  useFrame((state) => {
    if (holeId === null) return;
    const s = useGameStore.getState();
    const hw = getHoleWorld(holeId);
    _pos.copy(hw.pos);
    _n.copy(hw.normal);
    const t = Date.now() - s.phaseAt;

    // 大きさは刺さったあともヒーローサイズのまま。
    // 一度スリットの幅に合わせて1倍まで縮めたが、**それだとチャームが小さすぎて
    // 見えなくなった**(判定待ち〜セーフは、自分の剣をいちばん眺める時間なのに)。
    // スリットとの幅の一致より、ぶら下げたチャームが見えることを優先する。
    // 引きの2ショットなので、1倍では剣そのものも豆粒になってしまう。
    const eff = HERO_SCALE;
    const shrink = 1;
    const tipBuried = -SWORD_DIMS.bury * eff; // 刺さりきった状態の剣先の高さ

    let h = tipBuried; // 剣先の高さ(法線方向)
    let yaw = 0;
    let scale = 1;
    let sparkleT = -1; // 0..1: 構え中のきらめき進行(負なら非表示)
    let tiltX = 0;
    let tiltZ = 0;

    if (s.phase === "stabbing") {
      const p = Math.min(t / T_STAB, 1);
      if (p < 0.55) {
        // 構え: ふわっと降りてきて、くるっと回りながらきらめく
        const q = p / 0.55;
        scale = backOut(Math.min(q / 0.28, 1));
        h =
          RAISE_H +
          0.6 * (1 - easeOutCubic(Math.min(q / 0.5, 1))) +
          0.05 * Math.sin(q * Math.PI * 3);
        yaw = (1 - easeOutCubic(q)) * 2.6;
        sparkleT = q;
      } else if (p < 0.68) {
        // ため: ほんの少しだけ引き上げる
        const q = (p - 0.55) / 0.13;
        h = RAISE_H + 0.35 * easeOutCubic(q);
      } else {
        // 一閃: 一気に突き刺す(p=1 で impact イベントと着地が同期)
        const q = Math.min((p - 0.68) / 0.31, 1);
        h = RAISE_H + 0.35 + (tipBuried - RAISE_H - 0.35) * easeInCubic(q);
      }
    } else if (s.phase === "suspense") {
      // 判定待ち: 柄が小刻みに震える(複数周波数の合成で機械っぽさを消す)
      const tt = t / 1000;
      tiltX = Math.sin(tt * 43) * 0.022 + Math.sin(tt * 29 + 1.3) * 0.013;
      tiltZ = Math.cos(tt * 37 + 0.5) * 0.02 + Math.sin(tt * 53) * 0.011;
    } else {
      // safe: 刺したての揺れの余韻だけ残して静止
      const settle = Math.exp(-t / 200);
      tiltX = Math.sin((t / 1000) * 32) * 0.05 * settle;
    }

    const g = rig.sword.root;
    g.visible = true;
    // 剣先の高さ h に、刃が埋まるぶんを足すと刺さり口(=ルート)の高さになる
    g.position.copy(_pos).addScaledVector(_n, h + SWORD_DIMS.bury * eff);
    // 穴がスリットになったので、剣もスリットと同じ向きで入る。
    // 月の剣(Swords)・降ってくる剣(RemoteStabs)と同じ1本の関数を使う
    slotAlignQuat(_n.x, _n.y, _n.z, _qAlign);
    _qYaw.setFromAxisAngle(UP, yaw);
    // 震えは刺さり口を支点に。刺さった剣が根元で揺れる感じになる
    _eTilt.set(tiltX, 0, tiltZ);
    _qTilt.setFromEuler(_eTilt);
    g.quaternion.copy(_qAlign).multiply(_qYaw).multiply(_qTilt);
    g.scale.setScalar(Math.max(scale, 0.001) * shrink);
    // チャームの揺れ・にじいろの色相
    rig.sword.update(state.clock.elapsedTime);

    // ハロ: 構え〜判定待ちの間ふんわり光り、セーフで消えていく
    const tSec = t / 1000;
    if (s.phase === "stabbing") {
      rig.haloMat.opacity = 0.3;
    } else if (s.phase === "suspense") {
      rig.haloMat.opacity = 0.22 + 0.14 * Math.sin(tSec * 6.5);
    } else {
      rig.haloMat.opacity = Math.max(0, 0.25 - tSec * 0.35);
    }

    // きらめき: 刃に沿って星が走る
    if (sparkleT >= 0) {
      const q = sparkleT;
      rig.sparkle.position.set(
        0.11,
        SPARKLE_FROM + (SPARKLE_TO - SPARKLE_FROM) * q,
        0.09
      );
      const tw = 0.34 * Math.sin(Math.PI * q) * (0.75 + 0.25 * Math.sin(q * 26));
      rig.sparkle.scale.setScalar(Math.max(tw, 0.001));
      rig.sparkleMat.opacity = Math.sin(Math.PI * q);
      rig.sparkleMat.rotation = q * 2.5;
    } else {
      rig.sparkleMat.opacity = 0;
    }
  });

  if (holeId === null) return null;
  return <primitive object={rig.sword.root} />;
}
