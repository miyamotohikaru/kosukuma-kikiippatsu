"use client";

// 月の北極に腰まで刺さった「こすくまくん」。フェーズ駆動アニメは
// すべて useFrame + ref(setState禁止)。毎フレーム kosukumaWorldPos を更新する。
//
// ── さわり心地(2026-08-26 追加) ──────────────────────────
//
// 1. **つつくと ぷるんと揺れる**
//    ぷにっと沈む(squash)・押された向きへ傾く(lean)・軸から外れた力でねじれる
//    (twist)の3本の減衰バネで作る。減衰バネなので連打しても揺れは足し算に
//    ならず、上限(MAX_*)と「もう揺れているときは効きを弱める」で頭打ちにする。
//    押される向きは**指から遠ざかる向き**(横っ腹をつけば横へ倒れ、おなかの
//    まんなかをつけば奥へ、頭をつけば下へ沈む)。つついた高さで てこ が変わる。
//
// 2. **ドラッグ(月回し)との誤爆防止**
//    地球のイースターエッグ(Earth.tsx)とまったく同じ作法。pointerdown と
//    pointerup が「同じ指・TAP_SLOP_PX 以内・TAP_MAX_MS 以内」のときだけタップ。
//    判定はカプセルの当たり判定で受け、いちばん手前が自分のときだけ反応して
//    stopPropagation する(奥にある月のピッキング球に穴を選ばせない)。
//
// 3. **待ち時間(クールダウン)の見どころ**
//    つぎに刺せるまでの30秒は、ひまそうな しぐさ(のび/あくび/抜けようとする/
//    見まわす)を数秒おきに1つだけ演じる。UIは増やさず、待ち時間の主役は
//    この子にやってもらう、という判断。待ちが明けた瞬間は「はっ」と伸びて
//    "cooldown-ready" を投げる(音とセリフはそれぞれの演出家が受ける)。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  MOON_RADIUS,
  T_LAUNCH,
  T_NEW_ROUND,
  T_SAFE,
  T_STAB,
  T_SUSPENSE,
} from "@/lib/config";
import { useGameStore, type Phase } from "@/game/store";
import { emitGameEvent } from "@/game/events";
import { kosukumaWorldPos } from "./sharedRefs";
import { clamp01 } from "./effects/easing";
import {
  prefersReducedMotion,
  TAP_MAX_MS,
  TAP_SLOP_PX,
} from "./effects/earthFx";

/** モデルスケール(高さ2units・足元原点のGLBを1.7倍) */
const SCALE = 1.7;
/** 埋まり深さ(スケール後の高さ3.4のうち約32%=太ももまで。腕は月面の上に出す) */
const BURY = SCALE * 2 * 0.32;
/** スケール後の全高(足元=0 → 頭のてっぺん) */
const BODY_TOP = SCALE * 2;

// ── つつく当たり判定(見えないカプセル) ─────────────────────
// モデルの最大半径は約1.29。指には少しだけ甘くしておく。
// 月のピッキング球(原点・半径5)とは、いちばん近い穴(北極から34°=2.8離れ)
// まで2.8あるので干渉しない。
const HIT_R = 1.3;
/** カプセルの円柱部。上下のふくらみと合わせて高さ3.7ぶんを覆う */
const HIT_LEN = 1.1;
/** カプセルの中心の高さ(月面から出ている胴のまんなか) */
const HIT_Y = (BURY + BODY_TOP) / 2;

// ── 揺れのバネ ──────────────────────────────────────
// かたさ(K)と減衰(C)。K が大きいほど速く、C が小さいほど長く揺れる。
/** ぷにっと沈み。速く戻したいので固め(周期0.43秒・2回ほど跳ねて収まる) */
const SQUASH_K = 210;
const SQUASH_C = 13;
/** かたむき。いちばん目に見える「ぷるん」なので、少し長く残す(周期0.64秒) */
const LEAN_K = 95;
const LEAN_C = 7.2;
/** ねじれ。かたむきよりさらにゆっくり戻す */
const TWIST_K = 70;
const TWIST_C = 6.6;
/** 揺れの上限。連打で揺れが積み上がって暴れないための最後の砦 */
const MAX_SQUASH = 0.3;
const MAX_LEAN = 0.3; // rad(≈17°)
const MAX_TWIST = 0.42;
/** つついた瞬間に足す速度(=手ごたえの強さ) */
const POKE_SQUASH = 3.4;
const POKE_LEAN = 2.8;
const POKE_TWIST = 2.2;
/** 待ちが明けた「はっ」。squash を負に蹴ると伸び上がる */
const READY_STRETCH = 3.2;
const READY_TWIST = 1.1;

// ── 待ち時間の しぐさ ────────────────────────────────
/** 0=のび 1=あくび 2=抜けようとする 3=見まわす。値は再生時間(秒) */
const ACT_DUR = [2.2, 2.4, 2.0, 2.6] as const;
/** しぐさと しぐさ のあいだ(秒)。詰めるとうるさいので たっぷり空ける */
const ACT_GAP_MIN = 3.6;
const ACT_GAP_MAX = 6.4;
/** 待ちに入ってから最初の しぐさ までの間(秒)。セーフ演出の余韻を邪魔しない */
const ACT_FIRST = 2.4;

/** 「動きを減らす」設定のときの、揺れ・しぐさの倍率 */
const SOFT_AMP = 0.4;

const NO_RAYCAST = () => undefined;

// スクラッチ(毎フレーム/毎タップの確保を避ける)
const _hit = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
/** バネ1ステップの戻り値置き場 */
const _sp = { x: 0, v: 0 };

/**
 * 減衰バネを1ステップ進めて `_sp` に書く。
 * 上限に当たったら、そこから先へ押し込む速度だけを捨てる(戻る力は残す)。
 */
function spring(
  x: number,
  v: number,
  k: number,
  c: number,
  max: number,
  dt: number
): void {
  v += (-k * x - c * v) * dt;
  x += v * dt;
  if (x > max) {
    x = max;
    if (v > 0) v = 0;
  } else if (x < -max) {
    x = -max;
    if (v < 0) v = 0;
  }
  _sp.x = x;
  _sp.v = v;
}

/** つついてよいフェーズか(カットシーン中と、まだ月にいない間は反応しない) */
function canPoke(phase: Phase): boolean {
  return (
    phase !== "boot" &&
    phase !== "title" &&
    phase !== "launch" &&
    phase !== "name-entry" &&
    phase !== "trophy"
  );
}

export default function Kosukuma() {
  const { scene } = useGLTF("/models/kosukuma.glb");
  const rootRef = useRef<THREE.Group>(null); // 傾きを含む基準フレーム(動かさない)
  const animRef = useRef<THREE.Group>(null); // フェーズアニメ用(位置/回転/スケール)
  const spinRef = useRef(0); // launch中のスピン蓄積
  const soft = useMemo(prefersReducedMotion, []);

  // つつきの揺れ。すべて ref(連打しても再レンダリングを起こさない)
  const wob = useRef({
    squash: 0, // 正 = 縦につぶれる / 負 = 伸び上がる
    squashV: 0,
    leanX: 0, // +X 方向へ倒れている量(rad)
    leanXV: 0,
    leanZ: 0, // +Z 方向へ倒れている量(rad)
    leanZV: 0,
    twist: 0, // Y軸まわりのねじれ(rad)
    twistV: 0,
  });

  // 待ち時間の しぐさ。kind<0 は「何もしていない」
  const act = useRef({ kind: -1, at: 0, nextAt: 0 });
  // クールダウンを見張る。armed = 「いま待たされている最中」
  const cool = useRef({ armed: false });

  // 押した位置と時刻。ドラッグ(月回し)の終点で暴発しないための記録
  const down = useRef({ id: -1, x: 0, y: 0, t: 0 });

  // レンダリング側の設定は一度だけ
  useEffect(() => {
    scene.traverse((o) => {
      o.frustumCulled = false; // 発射で画面外へ飛んでもポップしない
      // 当たり判定はカプセル1つに任せる。9000頂点のモデルを毎ポインタ移動で
      // レイキャストしないで済むうえ、腕や耳が判定から はみ出す事故も防げる
      o.raycast = NO_RAYCAST;
    });
  }, [scene]);

  // ドラッグの終点が体の外だと onPointerUp が来ないので、
  // ジェスチャの終わりで押下記録を必ず捨てる(取り残しの誤爆防止)
  useEffect(() => {
    const clear = () => {
      down.current = { id: -1, x: 0, y: 0, t: 0 };
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    []
  );

  /**
   * カメラを回すと、体の奥に月のピッキング球が重なる。
   * いちばん手前が自分でないときは触らせない(穴の操作を邪魔しないため)。
   */
  const isFrontmost = (
    e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>
  ): boolean =>
    e.intersections.length === 0 ||
    e.intersections[0].eventObject === e.eventObject;

  /**
   * つつける状態か。カットシーン中(発射〜授与式)は こすくまくんを
   * 非表示にしているが、three.js のレイキャストは visible を見ないので、
   * ここで当たり判定そのものを無かったことにする。
   */
  const pokeable = () => canPoke(useGameStore.getState().phase);

  /** つつかれた。当たった点と指の向きから、揺れの初速を作る */
  const poke = (e: ThreeEvent<PointerEvent>) => {
    const root = rootRef.current;
    const w = wob.current;
    if (!root) return;

    // 当たった点と指の向きを、傾きを取り除いた基準フレームへ持ち込む。
    // (アニメ中の group ではなく、動かない外側で測る = 揺れている最中に
    //  つついても、体のどのあたりを触ったかが素直に出る)
    const p = root.worldToLocal(_hit.copy(e.point));
    root.getWorldQuaternion(_quat).invert();
    _dir.copy(e.ray.direction).applyQuaternion(_quat);

    // カプセルの中心から見た向き = 指が触れた面の法線
    let nx = p.x;
    let ny = p.y - HIT_Y;
    let nz = p.z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // 押される向きは法線の逆 = **指から遠ざかる向き**。
    // 右の端をつつけば左へ、おなかのまんなかをつつけば奥へ倒れる。
    // (「つついた側へ倒れる」ではない。減衰バネなので、戻りで手前へも振れる)
    const side = Math.hypot(nx, nz); // 1 = 真横 / 0 = 頭のてっぺん
    let dx: number;
    let dz: number;
    if (side > 0.08) {
      dx = -nx / side;
      dz = -nz / side;
    } else {
      // 真上。横向きの成分が無いので、指の進む向きを借りる
      const dl = Math.hypot(_dir.x, _dir.z) || 1;
      dx = _dir.x / dl;
      dz = _dir.z / dl;
    }

    // てこ: 高いところをつつくほど大きく傾く(足もとは月に埋まっていて動かない)
    const lever = 0.35 + 0.65 * clamp01((p.y - BURY) / (BODY_TOP - BURY));
    // 沈み: 上からつぶすほど深く。真横からだと半分ほど
    const sink = 0.45 + 0.55 * Math.max(0, ny) + 0.2 * Math.max(0, -_dir.y);
    // ねじれ: 体の軸から外れた点を押した分だけ回る(τ = r × F の Y成分)
    const torque = Math.max(-1, Math.min(1, p.z * _dir.x - p.x * _dir.z));

    const amp = soft ? SOFT_AMP : 1;
    // すでに大きく揺れているときは効きを落とす。連打しても暴れない
    const room = (cur: number, max: number) => 1 - 0.72 * clamp01(Math.abs(cur) / max);

    w.squashV += POKE_SQUASH * sink * amp * room(w.squash, MAX_SQUASH);
    const lean = POKE_LEAN * Math.max(0.25, side) * lever * amp;
    w.leanXV += lean * dx * room(w.leanX, MAX_LEAN);
    w.leanZV += lean * dz * room(w.leanZ, MAX_LEAN);
    w.twistV += POKE_TWIST * torque * lever * amp * room(w.twist, MAX_TWIST);

    // しぐさの途中なら畳む(つついた手ごたえを のび や あくび で濁らせない)
    act.current.kind = -1;

    emitGameEvent("kosukuma-poke");
    // つついた回数は store が数える(1万回で隠しチャームが開く)。
    // 条件はどこにも書かない — 地球のイースターエッグと同じ約束
    useGameStore.getState().pokeKosukuma();
  };

  // ── ポインタ操作(作法は Earth.tsx のイースターエッグと同じ) ──
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    if (!pokeable() || !isFrontmost(e)) return;
    e.stopPropagation();
    down.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    };
  };

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = { id: -1, x: 0, y: 0, t: 0 };
    if (!pokeable() || !isFrontmost(e)) return;
    e.stopPropagation();
    // 同じ指で・ほぼ動かさず・短時間で離したときだけ「つついた」。
    // ドラッグ(月回し)の終点が体の上でも、ここで弾かれる
    if (d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX) return;
    if (performance.now() - d.t > TAP_MAX_MS) return;
    poke(e);
  };

  /**
   * click は pointerup とは別に飛んでくる。ここで止めないと、
   * 奥の月のピッキング球が「穴をえらんだ」と受け取ってしまう。
   */
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (pokeable() && isFrontmost(e)) e.stopPropagation();
  };

  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    if (!pokeable() || !isFrontmost(e)) return;
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    document.body.style.cursor = "";
  };

  useFrame((state, delta) => {
    const anim = animRef.current;
    if (!anim) return;
    const s = useGameStore.getState();
    const phase = s.phase;
    const t = Math.max(0, (Date.now() - s.phaseAt) / 1000);
    const time = state.clock.elapsedTime;
    // タブ復帰時の巨大な delta でバネが暴れないように上限をつける
    const dt = Math.min(delta, 0.05);
    const w = wob.current;
    const a = act.current;
    const amp = soft ? SOFT_AMP : 1;

    let px = 0;
    let py = 0;
    let pz = 0;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let visible = true;

    /** ゆっくり呼吸(体積を保つsquash&stretch) */
    const breathe = (speed: number, amount: number) => {
      const b = Math.sin(time * speed);
      sy *= 1 + amount * b;
      const k = 1 - amount * 0.6 * b;
      sx *= k;
      sz *= k;
    };

    if (phase !== "launch") spinRef.current = 0;

    // ── 待ち時間の見張り ────────────────────────────
    // クールダウンが明けた瞬間に一度だけ知らせる。カットシーン中に明けた
    // ときは armed のままにして、月に戻ってきてから鳴らす
    const nowMs = Date.now();
    const waiting = phase === "idle" && s.cooldownUntil > nowMs;
    if (s.cooldownUntil > nowMs) {
      cool.current.armed = true;
    } else if (cool.current.armed && phase === "idle") {
      cool.current.armed = false;
      emitGameEvent("cooldown-ready");
      // 「はっ」と伸び上がって、こちらを向く
      w.squashV -= READY_STRETCH * amp;
      w.twistV += READY_TWIST * amp;
      a.kind = -1;
    }

    // ── 待ち時間の しぐさ を進める ──────────────────
    if (a.kind >= 0 && time - a.at >= ACT_DUR[a.kind]) {
      a.kind = -1;
      a.nextAt = time + ACT_GAP_MIN + Math.random() * (ACT_GAP_MAX - ACT_GAP_MIN);
    }
    if (a.kind < 0) {
      if (!waiting) a.nextAt = 0; // 待ちが明けたら予約を捨てる
      else if (a.nextAt <= 0) a.nextAt = time + ACT_FIRST;
      else if (time >= a.nextAt) {
        a.kind = Math.floor(Math.random() * ACT_DUR.length);
        a.at = time;
      }
    }

    switch (phase) {
      case "suspense": {
        // 小刻みプルプル。時間経過で振幅が増える
        const k = Math.min(1, t / (T_SUSPENSE / 1000));
        const shiver = 0.008 + 0.03 * k;
        px = Math.sin(time * 52) * shiver;
        pz = Math.cos(time * 47) * shiver * 0.8;
        rz = Math.sin(time * 61) * (0.02 + 0.05 * k);
        breathe(9, 0.012 + 0.02 * k);
        break;
      }

      case "safe": {
        // 安堵の2段バウンス(高→低)+着地squash
        const u = Math.min(1, t / (T_SAFE / 1000));
        const hop = (a0: number, b: number, h: number) =>
          u < a0 || u > b ? 0 : Math.sin(((u - a0) / (b - a0)) * Math.PI) * h;
        py = hop(0.06, 0.38, 0.6) + hop(0.46, 0.7, 0.26);
        const air = Math.min(1, py * 2.2);
        const squash = (c: number, wd: number, amt: number) => {
          const d = Math.abs(u - c);
          return d > wd ? 0 : Math.cos((d / wd) * Math.PI * 0.5) * amt;
        };
        const sq =
          squash(0.02, 0.04, 0.18) + // ほっとして一度沈む
          squash(0.42, 0.05, 0.26) + // 1回目の着地
          squash(0.73, 0.05, 0.16); // 2回目の着地
        sy = 1 + 0.22 * air - sq;
        const wide = 1 - 0.12 * air + sq * 0.8;
        sx = wide;
        sz = wide;
        ry = Math.sin(u * Math.PI) * 0.5; // うれしさのひねり
        break;
      }

      case "launch": {
        const T = T_LAUNCH / 1000;
        if (t < 0.3) {
          // タメ: 0.3秒の沈み込み
          const p = t / 0.3;
          py = -0.4 * Math.sin(p * Math.PI * 0.5);
          sy = 1 - 0.25 * p;
          sx = 1 + 0.16 * p;
          sz = sx;
        } else {
          // 加速上昇+緩スピン+stretch
          const tt = t - 0.3;
          py = 1.55 * tt * tt;
          spinRef.current += delta * (0.6 + tt * 0.5);
          ry = spinRef.current;
          const st = Math.min(0.45, tt * 0.19);
          sy = 1 + st;
          sx = 1 / Math.sqrt(1 + st);
          sz = sx;
          // 80%以降は縮んで星になって消える(光の演出はエフェクト側)
          const fade = (t - T * 0.8) / (T * 0.2);
          if (fade > 0) {
            const shrink = Math.max(0, 1 - fade);
            sx *= shrink;
            sy *= shrink;
            sz *= shrink;
            if (fade >= 1) visible = false;
          }
        }
        break;
      }

      case "name-entry":
      case "trophy":
        visible = false;
        break;

      case "new-round": {
        // 上空から降下 → 着地squash → ぷるんと復帰
        const D = Math.min(2.4, (T_NEW_ROUND / 1000) * 0.7);
        if (t < D) {
          const p = t / D;
          const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
          py = 26 * (1 - e);
          ry = (1 - e) * Math.PI * 4; // くるくる回りながら
          sy = 1.05;
          sx = 0.97;
          sz = 0.97;
        } else {
          const p = Math.min(1, (t - D) / 0.6);
          const k = Math.exp(-3.5 * p) * Math.cos(p * Math.PI * 2.4);
          sy = 1 - 0.3 * k;
          const wide = 1 / Math.sqrt(Math.max(0.5, sy));
          sx = wide;
          sz = wide;
          breathe(1.7, 0.015);
        }
        break;
      }

      // boot / title / idle / confirming / stabbing = 通常(呼吸+ゆらぎ)
      default: {
        breathe(1.7, 0.02);
        rz = Math.sin(time * 0.8) * 0.02;
        ry = Math.sin(time * 0.33) * 0.05;
        if (phase === "stabbing") {
          // 刺される予感でちょっと身構える
          const k = Math.min(1, t / (T_STAB / 1000));
          sy *= 1 - 0.04 * k;
          sx *= 1 + 0.02 * k;
          sz *= 1 + 0.02 * k;
        }
        break;
      }
    }

    // ── 待ち時間の しぐさ(フェーズのアニメに重ねる) ──
    if (a.kind >= 0) {
      const u = clamp01((time - a.at) / ACT_DUR[a.kind]);
      switch (a.kind) {
        case 0: {
          // のび: ぐーっと伸び上がって、ゆっくり戻る
          const e = Math.sin(Math.min(1, u * 1.25) * Math.PI);
          sy *= 1 + 0.13 * e * amp;
          const k = 1 - 0.06 * e * amp;
          sx *= k;
          sz *= k;
          py += 0.1 * e * amp;
          rz += -0.07 * e * amp; // すこし反る
          break;
        }
        case 1: {
          // あくび: ふくらんで、ぱたっとしぼむ
          const up = Math.sin(Math.min(1, u * 1.6) * Math.PI);
          const drop = u > 0.62 ? Math.sin(((u - 0.62) / 0.38) * Math.PI) : 0;
          const f = 1 + (0.07 * up - 0.09 * drop) * amp;
          sy *= f;
          const k = 1 / Math.sqrt(Math.max(0.5, f));
          sx *= k;
          sz *= k;
          ry += 0.12 * Math.sin(u * Math.PI * 2) * amp;
          break;
        }
        case 2: {
          // 抜けようとして、あきらめる
          const fade = 1 - u;
          ry += 0.2 * Math.sin(u * Math.PI * 5.5) * fade * amp;
          py += 0.05 * Math.max(0, Math.sin(u * Math.PI * 3)) * fade * amp;
          if (u > 0.78) {
            const d = Math.sin(((u - 0.78) / 0.22) * Math.PI);
            sy *= 1 - 0.06 * d * amp;
            const k = 1 + 0.035 * d * amp;
            sx *= k;
            sz *= k;
          }
          break;
        }
        default: {
          // ぐるっと見まわす
          ry += 0.55 * Math.sin(u * Math.PI * 2) * amp;
          rz += 0.035 * Math.sin(u * Math.PI) * amp;
          break;
        }
      }
    }

    // ── つつきの揺れ(減衰バネ)──────────────────────
    spring(w.squash, w.squashV, SQUASH_K, SQUASH_C, MAX_SQUASH, dt);
    w.squash = _sp.x;
    w.squashV = _sp.v;
    spring(w.leanX, w.leanXV, LEAN_K, LEAN_C, MAX_LEAN, dt);
    w.leanX = _sp.x;
    w.leanXV = _sp.v;
    spring(w.leanZ, w.leanZV, LEAN_K, LEAN_C, MAX_LEAN, dt);
    w.leanZ = _sp.x;
    w.leanZV = _sp.v;
    spring(w.twist, w.twistV, TWIST_K, TWIST_C, MAX_TWIST, dt);
    w.twist = _sp.x;
    w.twistV = _sp.v;

    if (canPoke(phase)) {
      // 体積を保ったまま つぶす/伸ばす(基点は足もと=月の中なので、
      // つぶれると腰から下へ沈み込む。押されて めり込む感じになる)
      sy *= 1 - w.squash;
      const wide = 1 + w.squash * 0.55;
      sx *= wide;
      sz *= wide;
      py -= w.squash * 0.06;
      // Z軸まわりの正回転は -X へ倒れるので、符号を反転して足す
      rz += -w.leanX;
      rx += w.leanZ;
      ry += w.twist;
      // かたむきの回転軸を、足もとではなく**腰(=月面の高さ BURY)**へ移す。
      // 足もとを軸にすると、埋まっているはずの下半身が月から出てきてしまう。
      // 平行移動で軸をずらすだけなので、小さい角度なら近似で十分。
      px += -BURY * w.leanX;
      pz += -BURY * w.leanZ;
    }

    anim.visible = visible;
    anim.position.set(px, py, pz);
    anim.rotation.set(rx, ry, rz);
    anim.scale.set(sx, sy, sz);

    // 非表示中も基準位置(北極)を提供し続ける
    anim.getWorldPosition(kosukumaWorldPos);
  });

  return (
    // 北極に腰まで埋め、8°ほど傾ける(x/zの複合でカメラ側へ)
    <group
      ref={rootRef}
      position={[0, MOON_RADIUS - BURY, 0]}
      rotation={[0.1, 0, 0.09]}
    >
      <group ref={animRef}>
        <primitive object={scene} scale={SCALE} />
        {/* つつく当たり判定。揺れに追従させたいので anim の中に置く。
            見えないが、指には少し大きめ(遠景でも狙える) */}
        <mesh
          position={[0, HIT_Y, 0]}
          onPointerDown={handleDown}
          onPointerUp={handleUp}
          onClick={handleClick}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          <capsuleGeometry args={[HIT_R, HIT_LEN, 4, 12]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
