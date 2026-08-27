"use client";

// フェーズ駆動のカメラ演出。title/idleはOrbitControlsでユーザー操作、
// それ以外は controls を無効化して easing.damp3 でカメラを運ぶ。
// "impact" イベントと sharedRefs.requestShake() で減衰振動のカメラシェイク。
// 待ち時間(クールダウン)中の idle だけは、他の人が刺した穴へゆっくり振り向く。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { damp, damp3, dampAngle } from "maath/easing";
import { MOON_RADIUS } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { onGameEvent } from "@/game/events";
import { cameraShake, getHoleWorld, kosukumaWorldPos } from "./sharedRefs";

type ControlsImpl = ComponentRef<typeof OrbitControls>;

const DEFAULT_POS = new THREE.Vector3(0, 5.5, 17.5);
// 注視点は月中心より少し上: 月を画面下寄りにして、主役のこすくまくんを見切れさせない
const ORIGIN = new THREE.Vector3(0, 1.6, 0);
// タイトルは下から見上げるヒーローショット: 主役をロゴと重ねず画面中央帯に
const TITLE_TARGET = new THREE.Vector3(0, 4.6, 0);
const TROPHY_POS = new THREE.Vector3(0, 4.5, 14);
const TROPHY_TARGET = new THREE.Vector3(0, 3, 0);

const SHAKE_DUR = 0.4;

// ── 地球イースターエッグの爆発ショット ──────────────────
// 1000回つついたごほうびが「画面のすみで小さく光る」だけにならないよう、
// 爆発のあいだだけ地球へ寄る。Earth.tsx の position と同じ値。
const EARTH_WORLD = new THREE.Vector3(-18, 8, -28);
/** 寄ったときのカメラ〜地球の距離。半径2の地球が画面高の約30%になる */
const BOOM_CAM_DIST = 16;
const BOOM_IN = 0.32; // 寄りきるまで(秒)
const BOOM_OUT_AT = 4.2; // ここから元の絵へ戻りはじめる(秒)
const BOOM_OUT = 0.9; // 戻りにかける時間(秒)
const _bdir = new THREE.Vector3();
const _bpos = new THREE.Vector3();
const _blook = new THREE.Vector3();
/** 0..1 をなめらかに */
const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// ── 待っているあいだ、他の人が刺した穴を見に行く ──────────────
// 30秒のクールダウンで手持ちぶさたにならないように、月の裏で刺さった1本の
// ほうへ「ゆっくり」振り向く。酔わせない・主役を見失わせないのが最優先なので、
// 月を回すのではなく**カメラの周回角(方位角・極角)だけ**を補間する。
// 距離と注視点にはさわらない = ユーザーのズームと構図をそのまま残す。
/** 振り向きのなめらかさ(smoothTime)。見た目では1.2秒ほどで振り終わる */
const FOLLOW_SMOOTH = 0.8;
/** 振り向きの速度上限(rad/秒)。真裏の穴でも「ぐるん」と回さない */
const FOLLOW_MAX_RATE = 1.3;
/** 既定カメラとおなじ見下ろし角(rad)。穴の緯度をここへ少し寄せる */
const FOLLOW_EQ_PHI = 1.35;
/** 寄せる強さ(0 = 穴の真正面 / 1 = つねに既定の見下ろし角)。
 *  真下まで回り込むと北極のこすくまくんが月の裏に隠れてしまうので、
 *  穴が見える範囲(法線から70度以内)を保ったまま、少しだけ引き戻す */
const FOLLOW_TILT = 0.3;
/** 極に寄りすぎない安全マージン(rad)。OrbitControls の制限より内側に置く */
const FOLLOW_PHI_MARGIN = 0.2;
/** OrbitControls のズーム範囲。追従で使う距離もこの範囲に収める */
const MIN_DIST = 8;
const MAX_DIST = 24;
/** これ以上動いたら「ユーザーが自分で回した」とみなす(rad / units)。
 *  穴を選ぶだけのタップでも OrbitControls の start は飛んでくるので、
 *  押した/離したではなく「実際に角度か距離が動いたか」で判定する */
const MANUAL_ANGLE_EPS = 0.02;
const MANUAL_DIST_EPS = 0.15;

const _foff = new THREE.Vector3();
const _fsph = new THREE.Spherical();

/** -π..π に畳んだ角度差 */
function wrapPi(a: number): number {
  const t = (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return t - Math.PI;
}

/** 「動きを減らす」設定なら true。そのときは自動で視点を動かさない */
function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * その穴が正面に来るカメラの周回角を求めて out に書く。
 * 注視点(ORIGIN)は月の中心より少し上にあるので、「法線の延長線上に
 * カメラを置く」ためには注視点から見た極角へ直す必要がある。
 * 半径 out.radius の球と、注視点から法線方向へ伸ばした線の交点を解く。
 */
function aimAtHole(
  holeId: number,
  targetY: number,
  out: { theta: number; phi: number; radius: number }
): void {
  const n = getHoleWorld(holeId).normal;
  const nPhi = Math.acos(Math.max(-1, Math.min(1, n.y)));
  const phiC = nPhi + (FOLLOW_EQ_PHI - nPhi) * FOLLOW_TILT;
  const cos = Math.cos(phiC);
  const sin = Math.sin(phiC);
  // |r*dir - T| = radius を r について解く(T は y 軸上なので dir·T = cos*targetY)
  const dot = cos * targetY;
  const r =
    dot +
    Math.sqrt(
      Math.max(0, dot * dot - targetY * targetY + out.radius * out.radius)
    );
  out.theta = Math.atan2(n.x, n.z); // 方位角は注視点をずらしても変わらない
  out.phi = Math.min(
    Math.PI - FOLLOW_PHI_MARGIN,
    Math.max(FOLLOW_PHI_MARGIN, Math.atan2(sin * r, cos * r - targetY))
  );
}

// 3/4アングル計算用のスクラッチ
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_X = new THREE.Vector3(1, 0, 0);
const _side = new THREE.Vector3();
const _tanUp = new THREE.Vector3();
// 2ショット(穴+こすくまくん)計算用のスクラッチ
const _bis = new THREE.Vector3();
const KOSUKUMA_BASE = new THREE.Vector3(0, MOON_RADIUS + 1.6, 0);

export default function CameraRig() {
  const controlsRef = useRef<ControlsImpl>(null);
  const lookRef = useRef(new THREE.Vector3(0, 0, 0)); // 現在の注視点(補間される)
  const desired = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  const wasManual = useRef(false);
  const shakeRef = useRef(0);
  const lastHole = useRef(0); // safe中はselectedHoleが消えるので直前の穴を覚えておく
  const launchSnapped = useRef(false); // launch開始時の「引きへのカット」を1回だけ
  const launchDir = useRef(new THREE.Vector3(0, 0, 1)); // 引きショットの水平方向

  // ── 待ち時間の自動追従(クールダウン中の idle 専用) ──
  const follow = useRef({
    /** 補間中か(この待ち時間で1本でも追いはじめたか) */
    active: false,
    /** いま追いかけている刺しの目印 "holeId:startAt" */
    key: "",
    /** 目標の周回角 */
    theta: 0,
    phi: FOLLOW_EQ_PHI,
    /** 追従中は距離を固定する(勝手に寄ったり引いたりしない) */
    radius: MAX_DIST,
  });
  /** 現在の周回角。maath の damp は速度を __damp に持つので、
   *  追いはじめるたびに作り直して前の勢いを持ち込まない */
  const followAng = useRef<{ theta: number; phi: number }>({
    theta: 0,
    phi: FOLLOW_EQ_PHI,
  });
  /** この待ち時間でユーザーが自分で回したか(回したらもう自動で動かさない) */
  const userTook = useRef(false);
  /** いま指(ポインタ)が乗っているか。乗っているあいだは絶対に横取りしない */
  const dragging = useRef(false);
  /** ドラッグ開始時の (方位角, 極角, 距離) */
  const dragFrom = useRef(new THREE.Vector3());
  /** 待ち時間の切り替わりを見る目印。クールダウンごとに手動フラグを戻す */
  const seenCooldown = useRef(-1);
  const reduceMotion = useMemo(prefersReducedMotion, []);

  // 刺さった瞬間のカメラシェイク
  useEffect(
    () =>
      onGameEvent((type) => {
        if (type === "impact") shakeRef.current = SHAKE_DUR;
      }),
    []
  );

  // ── ユーザーの手動操作の検出 ──
  // 「押した瞬間」ではなく「実際に周回角か距離が動いたか」で判定する。
  // 穴を選ぶタップでも start は飛んでくるので、それで追従を止めたくない。
  const onControlsStart = useCallback(() => {
    dragging.current = true;
    const f = follow.current;
    if (f.active) {
      // 自動追従中は、こちらが最後に書いた値が正。OrbitControls の内部角は
      // 1フレーム古いので、それを基準にすると自分の動きを誤検知してしまう
      dragFrom.current.set(
        followAng.current.theta,
        followAng.current.phi,
        f.radius
      );
      return;
    }
    const c = controlsRef.current;
    if (c) {
      dragFrom.current.set(
        c.getAzimuthalAngle(),
        c.getPolarAngle(),
        c.getDistance()
      );
    }
  }, []);

  const onControlsChange = useCallback(() => {
    if (!dragging.current || userTook.current) return;
    const c = controlsRef.current;
    if (!c) return;
    const dAz = Math.abs(wrapPi(c.getAzimuthalAngle() - dragFrom.current.x));
    const dPol = Math.abs(c.getPolarAngle() - dragFrom.current.y);
    const dDist = Math.abs(c.getDistance() - dragFrom.current.z);
    if (
      dAz > MANUAL_ANGLE_EPS ||
      dPol > MANUAL_ANGLE_EPS ||
      dDist > MANUAL_DIST_EPS
    ) {
      userTook.current = true;
      follow.current.active = false;
    }
  }, []);

  const onControlsEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  useFrame((state, delta) => {
    const s = useGameStore.getState();
    const phase = s.phase;
    const cam = state.camera;
    const controls = controlsRef.current;

    if (phase !== "launch") launchSnapped.current = false;

    // ユーザー操作を許すフェーズ(それ以外はカメラ演出が運転する)
    const orbit = phase === "boot" || phase === "title" || phase === "idle";
    if (controls) {
      controls.enabled = orbit;
      controls.autoRotate = phase === "boot" || phase === "title";
      // タイトル⇄ゲームで注視点をなめらかに移す(panは無効なので安全)
      if (orbit) {
        const tgt = phase === "idle" ? ORIGIN : TITLE_TARGET;
        if (controls.target.distanceToSquared(tgt) > 1e-4) {
          damp3(controls.target, tgt, 0.6, delta);
        }
      }
    }

    const manual = !orbit;
    if (manual && !wasManual.current) {
      // OrbitControlsから注視点を引き継いでカクつきを防ぐ
      lookRef.current.copy(controls ? controls.target : ORIGIN);
    }
    if (!manual && wasManual.current && controls) {
      // 演出から操作に戻るときは注視点を基準点へリセット
      controls.target.copy(ORIGIN);
    }
    wasManual.current = manual;

    if (manual) {
      let smooth = 0.45;
      let lookSmooth = 0.25;

      switch (phase) {
        case "confirming": {
          // 穴えらびの確認はアップ: 斜め横(3/4アングル)から見る。
          // 真上からだと法線上を上がってくる剣がカメラを突き抜けて絵にならない。
          if (s.selectedHole !== null) lastHole.current = s.selectedHole;
          const h = getHoleWorld(s.selectedHole ?? lastHole.current);
          _side.crossVectors(h.normal, WORLD_UP);
          if (_side.lengthSq() < 0.04) _side.crossVectors(h.normal, WORLD_X);
          _side.normalize();
          _tanUp.crossVectors(_side, h.normal).normalize(); // 接平面上の「上」
          desired.current
            .copy(h.pos)
            .addScaledVector(h.normal, 3.1)
            .addScaledVector(_side, 3.0)
            .addScaledVector(_tanUp, 1.1);
          desiredLook.current.copy(h.pos).addScaledVector(h.normal, 1.1);
          break;
        }
        case "stabbing":
        case "suspense":
        case "safe": {
          // 刺す〜判定は「穴とこすくまくんの2ショット」: 飛ぶのか飛ばないのか
          // をその場で見届けられるように、両方が入る位置まで引く。
          if (s.selectedHole !== null) lastHole.current = s.selectedHole;
          const h = getHoleWorld(s.selectedHole ?? lastHole.current);
          // 穴の法線と北極(こすくまくん)の中間方向にカメラを置く
          _bis.set(h.normal.x, h.normal.y + 1, h.normal.z);
          if (_bis.lengthSq() < 0.05) {
            // 穴がほぼ南極(真反対)のときは少し横へ逃がす
            _bis.set(h.normal.x + 0.35, h.normal.y + 1, h.normal.z);
          }
          _bis.normalize();
          // 真正面だと剣が「点」に見えるので、横へずらして剣のシルエットを出す
          _side.crossVectors(_bis, WORLD_UP);
          if (_side.lengthSq() < 0.04) _side.copy(WORLD_X);
          _side.normalize();
          _bis.addScaledVector(_side, 0.32).normalize();
          // 離れている穴ほど大きく引く(縦視野に両方収めるには角度依存で強めに)
          const sep = Math.acos(Math.max(-1, Math.min(1, h.normal.y)));
          const dist = MOON_RADIUS + 4.2 + (sep / Math.PI) * 13;
          desired.current.copy(_bis).multiplyScalar(dist);
          // 注視点は穴とこすくまくんの間(すこしこすくまくん寄り)
          desiredLook.current
            .copy(h.pos)
            .multiplyScalar(0.46)
            .addScaledVector(KOSUKUMA_BASE, 0.54);
          smooth = phase === "stabbing" ? 0.38 : 0.4;
          lookSmooth = 0.25;
          break;
        }
        case "launch": {
          // 発射の瞬間を見せる: 白フラッシュに隠して引きのステージショットへ
          // 一発でカットし(damp補間しない)、その後は上昇を追いながらさらに引く
          const t = Math.max(0, (Date.now() - s.phaseAt) / 1000);
          if (!launchSnapped.current) {
            launchSnapped.current = true;
            launchDir.current.set(cam.position.x, 0, cam.position.z);
            if (launchDir.current.lengthSq() < 1) launchDir.current.set(0, 0, 1);
            launchDir.current.normalize();
            cam.position.set(
              kosukumaWorldPos.x + launchDir.current.x * 13,
              kosukumaWorldPos.y + 1.0,
              kosukumaWorldPos.z + launchDir.current.z * 13
            );
            lookRef.current.copy(kosukumaWorldPos);
            cam.lookAt(lookRef.current);
          }
          const pull = 1 + Math.min(1.6, t * 0.3);
          desired.current.set(
            kosukumaWorldPos.x + launchDir.current.x * 13 * pull,
            kosukumaWorldPos.y - 1.2,
            kosukumaWorldPos.z + launchDir.current.z * 13 * pull
          );
          desiredLook.current.copy(kosukumaWorldPos);
          smooth = 0.45;
          lookSmooth = 0.22;
          break;
        }
        case "name-entry":
        case "trophy":
          // 授与式は定位置で静止
          desired.current.copy(TROPHY_POS);
          desiredLook.current.copy(TROPHY_TARGET);
          smooth = 0.8;
          lookSmooth = 0.5;
          break;
        case "new-round":
        default:
          // デフォルト軌道に戻って降臨を見守る
          desired.current.copy(DEFAULT_POS);
          desiredLook.current.copy(ORIGIN);
          smooth = 0.7;
          lookSmooth = 0.4;
          break;
      }

      damp3(cam.position, desired.current, smooth, delta);
      damp3(lookRef.current, desiredLook.current, lookSmooth, delta);
      // 補間経路が月を貫通しないようにクランプ
      const minR = MOON_RADIUS + 1.2;
      if (cam.position.lengthSq() < minR * minR) cam.position.setLength(minR);
      cam.lookAt(lookRef.current);
    }

    // ── 待っているあいだ、他の人が刺した穴を見に行く ──────────
    // クールダウン中の idle だけ。ほかのフェーズではこの節に入らないので、
    // 既存のカメラ演出(カットシーン)には一切さわらない。
    if (seenCooldown.current !== s.cooldownUntil) {
      // 待ち時間が変わった = 新しい待ちの始まり。手動フラグを戻す
      seenCooldown.current = s.cooldownUntil;
      userTook.current = false;
      follow.current.active = false;
      follow.current.key = "";
    }
    const waiting = phase === "idle" && s.cooldownUntil > Date.now();
    if (!waiting) {
      follow.current.active = false;
      follow.current.key = "";
    } else if (
      controls &&
      !reduceMotion &&
      !userTook.current &&
      !dragging.current
    ) {
      const f = follow.current;
      const tgt = controls.target;

      // 最新の1本を追う。次々に届いても追従先を差し替えるだけで、
      // 補間(と勢い)はそのまま続くのでカクつかない
      let newestHole = -1;
      let newestAt = -1;
      for (const r of s.remoteStabs) {
        if (r.startAt >= newestAt) {
          newestAt = r.startAt;
          newestHole = r.holeId;
        }
      }
      if (newestHole >= 0) {
        const key = `${newestHole}:${newestAt}`;
        if (key !== f.key) {
          f.key = key;
          if (!f.active) {
            // いまの向き・いまの距離から始める(ズームは動かさない)
            _foff.subVectors(cam.position, tgt);
            _fsph.setFromVector3(_foff);
            f.radius = Math.min(MAX_DIST, Math.max(MIN_DIST, _fsph.radius));
            followAng.current = { theta: _fsph.theta, phi: _fsph.phi };
            f.active = true;
          }
          aimAtHole(newestHole, tgt.y, f);
        }
      }

      // 刺さり終わって remoteStabs が空になっても、その向きに留まる
      if (f.active) {
        // 方位角は近いほうまわり。速度上限つきなので真裏でも振り回さない
        dampAngle(
          followAng.current,
          "theta",
          f.theta,
          FOLLOW_SMOOTH,
          delta,
          FOLLOW_MAX_RATE
        );
        damp(
          followAng.current,
          "phi",
          f.phi,
          FOLLOW_SMOOTH,
          delta,
          FOLLOW_MAX_RATE
        );
        _fsph.set(f.radius, followAng.current.phi, followAng.current.theta);
        cam.position.setFromSpherical(_fsph).add(tgt);
        // OrbitControls は update() のあとに走るので、向きもここで合わせ直す
        cam.lookAt(tgt);
      }
    }

    // ── 地球の爆発中だけ、地球へ寄る(ごほうびを大きく見せる) ──
    // OrbitControls の内部状態には触らないので、重みを0に戻せば
    // ユーザーが回していた元の絵にそのまま戻る。
    // ゲーム本編のカットシーン(刺す〜授与式)は邪魔しない。
    if (s.earthBoomAt !== null && (orbit || phase === "confirming")) {
      const bt = (Date.now() - s.earthBoomAt) / 1000;
      const w = Math.min(
        smooth01(bt / BOOM_IN),
        1 - smooth01((bt - BOOM_OUT_AT) / BOOM_OUT)
      );
      if (w > 0.002) {
        // いまの視線方向を保ったまま近づく(急に振り回して酔わせない)
        _bdir.subVectors(cam.position, EARTH_WORLD);
        if (_bdir.lengthSq() < 1) _bdir.set(0, 0.25, 1);
        _bdir.normalize();
        _bpos.copy(EARTH_WORLD).addScaledVector(_bdir, BOOM_CAM_DIST);
        cam.position.lerp(_bpos, w);
        _blook.copy(orbit && controls ? controls.target : lookRef.current);
        _blook.lerp(EARTH_WORLD, w);
        cam.lookAt(_blook);
      }
    }

    // カメラシェイク(減衰振動)。位置に足すだけなので操作中でも安全
    let amp = 0;
    if (shakeRef.current > 0) {
      shakeRef.current = Math.max(0, shakeRef.current - delta);
      const k = shakeRef.current / SHAKE_DUR;
      amp = 0.16 * k * k;
    }
    // エフェクト側からの依頼(地球の爆発など)も消費する。強い方を採用して
    // 足し合わせない = 同時に来ても酔わせない
    const nowSec = performance.now() / 1000;
    if (cameraShake.endsAt > nowSec) {
      const k = (cameraShake.endsAt - nowSec) / cameraShake.dur;
      amp = Math.max(amp, cameraShake.amp * k * k);
    }
    if (amp > 0) {
      const now = state.clock.elapsedTime;
      cam.position.x += Math.sin(now * 63) * amp;
      cam.position.y += Math.cos(now * 51) * amp * 0.7;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 4.6, 0]}
      enablePan={false}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.8}
      autoRotateSpeed={0.5}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI - 0.12}
      onStart={onControlsStart}
      onChange={onControlsChange}
      onEnd={onControlsEnd}
    />
  );
}
