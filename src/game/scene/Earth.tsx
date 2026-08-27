"use client";

// 遠景の小さな地球。NASA Blue Marble(パブリックドメイン)の実写テクスチャで
// リアルに。ゆっくり自転する。
//
// ── イースターエッグ ────────────────────────────────
// つつくと ぷにっ と沈んで波紋が出る。回数が増えるほど地球は不穏になり
// (ヒビ・赤い明滅・ふるえ・火の粉)、1000回目に大爆発して、やがて再生する。
// 手ざわりのために、演出はすべて ref + useFrame で回して再レンダリングを起こさない。
// 進行状況(回数・爆発の時刻)は store が持ち、ここは読むだけ。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { EARTH_BOOM_CLICKS } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { onGameEvent } from "@/game/events";
import { requestShake } from "./sharedRefs";
import EarthBoom from "./effects/EarthBoom";
import { clamp01, easeOutCubic } from "./effects/easing";
import { makeCircleTexture, makeStarTexture } from "./effects/textures";
import {
  BOOM,
  createEarthCounter,
  createEarthCracks,
  createSparkPool,
  EARTH_HIT_RADIUS,
  EARTH_RADIUS,
  earthBoomScale,
  makeEarthRingTexture,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  type EarthCounter,
  type EarthCracks,
  type SparkPool,
} from "./effects/earthFx";

/** つついた波紋の同時表示数(連打でも足りるだけ) */
const RIPPLES = 5;
const RIPPLE_DUR = 0.62;
/** カウンタを出しはじめる回数。1〜2回では出さない(知らない人には見せない) */
const COUNTER_MIN = 3;
/** 最後につついてからカウンタを見せておく時間(秒) */
const COUNTER_HOLD = 6;
/** きらきら・火の粉の粒子プール */
const SPARK_COUNT = 220;

const NO_RAYCAST = () => undefined;

// 色(不穏さで補間する)
const HALO_CALM = new THREE.Color("#6fb0ff");
const HALO_HOT = new THREE.Color("#ff6b6b");
const CRACK_WARM = new THREE.Color("#ff7a3d");
const CRACK_HOT = new THREE.Color("#fff0b8");
const RIPPLE_CALM = new THREE.Color("#bfe9ff");
const RIPPLE_HOT = new THREE.Color("#ff8a5c");

// スクラッチ
const _hit = new THREE.Vector3();
const _col = new THREE.Color();

/** ドクン…ドクン、の2拍。x は「拍」単位の時刻 */
function heartbeat(x: number): number {
  const a = x - Math.floor(x);
  const b = a - 0.26;
  return Math.min(1, Math.exp(-15 * a) + 0.62 * Math.exp(-15 * (b < 0 ? b + 1 : b)));
}

interface EarthRig {
  fxRoot: THREE.Group;
  earthGeom: THREE.SphereGeometry;
  earthMat: THREE.MeshStandardMaterial;
  haloGeom: THREE.SphereGeometry;
  haloMat: THREE.MeshBasicMaterial;
  cracks: EarthCracks;
  counter: EarthCounter;
  sparks: SparkPool;
  ripples: THREE.Sprite[];
  rippleMats: THREE.SpriteMaterial[];
  poke: THREE.Sprite;
  pokeMat: THREE.SpriteMaterial;
  dispose: () => void;
}

function buildEarth(texture: THREE.Texture): EarthRig {
  const disposables: { dispose: () => void }[] = [];

  const earthGeom = new THREE.SphereGeometry(EARTH_RADIUS, 48, 32);
  // シーンのライトは月向けで地球には夜側が向くため、
  // emissiveMapで自発光させて「明るく輝く地球」に見せる
  const earthMat = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: new THREE.Color("#ffffff"),
    emissiveMap: texture,
    emissiveIntensity: 0.85,
    roughness: 0.9,
    metalness: 0,
  });
  const haloGeom = new THREE.SphereGeometry(EARTH_RADIUS, 32, 24);
  const haloMat = new THREE.MeshBasicMaterial({
    color: HALO_CALM,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(earthGeom, earthMat, haloGeom, haloMat);

  const cracks = createEarthCracks();
  const counter = createEarthCounter();
  disposables.push(cracks, counter);

  const starTex = makeStarTexture();
  const circleTex = makeCircleTexture();
  const ringTex = makeEarthRingTexture();
  disposables.push(starTex, circleTex, ringTex);

  const sparks = createSparkPool({
    count: SPARK_COUNT,
    map: starTex,
    drag: 2.6,
    grow: 0.35,
    fade: 1.3,
  });
  disposables.push(sparks);

  // つついた波紋(地球のふちから広がる光の輪)
  const ripples: THREE.Sprite[] = [];
  const rippleMats: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < RIPPLES; i++) {
    const m = new THREE.SpriteMaterial({
      map: ringTex,
      color: RIPPLE_CALM,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    disposables.push(m);
    const sp = new THREE.Sprite(m);
    sp.frustumCulled = false;
    sp.raycast = NO_RAYCAST;
    rippleMats.push(m);
    ripples.push(sp);
  }

  // 触った点で光る小さなポチ
  const pokeMat = new THREE.SpriteMaterial({
    map: circleTex,
    color: "#fff6df",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  disposables.push(pokeMat);
  const poke = new THREE.Sprite(pokeMat);
  poke.frustumCulled = false;
  poke.raycast = NO_RAYCAST;

  const fxRoot = new THREE.Group();
  fxRoot.add(sparks.points, poke, counter.sprite, ...ripples);

  return {
    fxRoot,
    earthGeom,
    earthMat,
    haloGeom,
    haloMat,
    cracks,
    counter,
    sparks,
    ripples,
    rippleMats,
    poke,
    pokeMat,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export default function Earth() {
  const texture = useTexture("/textures/earth.jpg");

  // テクスチャ設定は参照が変わったときだけ
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // 爆発の破片は自分の担当区画だけをUVオフセットで参照するので、
    // 経度方向(u)は繰り返しにしておく(本体はUVが[0,1]なので影響なし)
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
  }, [texture]);

  const rig = useMemo(() => buildEarth(texture), [texture]);
  useEffect(() => () => rig.dispose(), [rig]);

  const anchorRef = useRef<THREE.Group>(null);
  const shakeRef = useRef<THREE.Group>(null);
  const squashRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  // 演出の状態は全部 ref(1000回連打しても再レンダリングを起こさない)
  const fxRef = useRef({
    now: 0, // 最新の clock 秒(イベントハンドラから参照する)
    punch: 0, // ぷにっとバネの変位(正=つぶれ)
    punchVel: 0,
    spinBoost: 0, // つついた勢いで少し回る
    tapShake: 0, // つついた直後のふるえ
    lastTapAt: -99,
    counterOpacity: 0,
    shownClicks: -1, // カウンタに描いてある数
    emberAcc: 0, // 火の粉のスポーン端数
    ripple: 0, // 波紋のリングバッファ位置
    rippleAt: new Float32Array(RIPPLES).fill(-99),
    pokeAt: -99,
  });

  // 押した位置と時刻。ドラッグ(月回し)の終点で暴発しないための記録
  const down = useRef({ id: -1, x: 0, y: 0, t: 0 });
  const pendingHit = useRef(new THREE.Vector3(0, 0, EARTH_RADIUS));

  // デバッグ: ?earth=999 で初期カウントを進めて爆発をすぐ確かめられる
  // (?earth=990 なら不穏さの最終段、?earth=0 でリセット)。
  // store のコードは触らず state だけ差し替える読み取り専用の仕掛け。
  // ただし次にタップした時点で store が localStorage に保存する点に注意。
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("earth");
      if (q === null || q === "") return;
      const n = Math.floor(Number(q));
      if (!Number.isFinite(n) || n < 0) return;
      useGameStore.setState({
        earthClicks: Math.min(n, EARTH_BOOM_CLICKS - 1),
      });
    } catch {
      /* URLが読めない環境では何もしない */
    }
  }, []);

  // ドラッグの終点が地球の外だと onPointerUp が来ないので、
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

  // つついた手応え。store が受理したときだけ来る("earth-tap")ので、
  // 爆発中の空振りでは演出が出ない
  useEffect(
    () =>
      onGameEvent((type) => {
        if (type !== "earth-tap") return;
        const fx = fxRef.current;
        const now = fx.now;
        const p = clamp01(useGameStore.getState().earthClicks / EARTH_BOOM_CLICKS);
        const heat = clamp01((p - 0.25) / 0.75);
        // 色は早い段階からじわっと暖色へ寄せる(1回目と300回目で手ざわりが違う)
        const dread = 0.25 * clamp01(p / 0.3) + 0.75 * heat;

        // ぷにっと沈んで、ばねで戻る
        fx.punchVel += 3.8;
        fx.spinBoost += 0.5 + heat * 0.9;
        fx.tapShake = 1;
        fx.lastTapAt = now;

        // 波紋(不穏なほど赤くなる)
        const ri = fx.ripple;
        fx.ripple = (fx.ripple + 1) % RIPPLES;
        fx.rippleAt[ri] = now;
        rig.rippleMats[ri].color.copy(RIPPLE_CALM).lerp(RIPPLE_HOT, dread);

        // 触った点のポチ
        const hit = pendingHit.current;
        rig.poke.position.copy(hit).multiplyScalar(1.02);
        fx.pokeAt = now;

        // きらきら(表面から外向きに数個)。おだやかなうちは金、
        // 不穏になるほど赤い火の粉になる
        const sg = 0.92 - 0.42 * dread;
        const sb = 0.7 - 0.4 * dread;
        const n = 5 + Math.round(heat * 4);
        for (let i = 0; i < n; i++) {
          const spd = 1.1 + Math.random() * 1.9;
          rig.sparks.spawn(
            hit.x,
            hit.y,
            hit.z,
            hit.x * 0.5 * spd + (Math.random() - 0.5) * 1.6,
            hit.y * 0.5 * spd + (Math.random() - 0.5) * 1.6,
            hit.z * 0.5 * spd + (Math.random() - 0.5) * 1.6,
            0.22 + Math.random() * 0.26,
            0.42 + Math.random() * 0.32,
            1,
            sg,
            sb
          );
        }

        // 終盤はつつくたびに画面まで震える
        if (heat > 0.5) requestShake(0.12 + heat * 0.1, 0.015 + heat * 0.05);
      }),
    [rig]
  );

  // ── 当たり判定(見えない大きめの球) ───────────────────
  /**
   * カメラを回して地球が月の裏に来ると、月を触ったレイが奥の判定球にも当たる。
   * いちばん手前が自分でないときは触らせない(穴の操作を邪魔しないため)。
   */
  const isFrontmost = (e: ThreeEvent<PointerEvent>): boolean =>
    e.intersections.length === 0 ||
    e.intersections[0].eventObject === e.eventObject;

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isFrontmost(e)) return;
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
    if (!isFrontmost(e)) return;
    e.stopPropagation();
    // 同じ指で・ほぼ動かさず・短時間で離したときだけ「つついた」。
    // ドラッグ(月回し)の終点が地球の上でも、ここで弾かれる
    if (d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX) return;
    if (performance.now() - d.t > TAP_MAX_MS) return;

    // 判定球は本体より大きいので、当たった点を地球の表面へ落とす
    const g = anchorRef.current;
    if (g) {
      const local = g.worldToLocal(_hit.copy(e.point));
      if (local.lengthSq() > 1e-6) local.setLength(EARTH_RADIUS);
      else local.set(0, 0, EARTH_RADIUS);
      pendingHit.current.copy(local);
    }
    // 数えるのは store。演出は "earth-tap" を受けて出す
    useGameStore.getState().tapEarth();
  };

  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    if (!isFrontmost(e)) return;
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    document.body.style.cursor = "";
  };
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  useFrame((state, delta) => {
    const s = useGameStore.getState();
    const fx = fxRef.current;
    const now = state.clock.elapsedTime;
    // タブ復帰時の巨大な delta でばねが暴れないように上限をつける
    const dt = Math.min(delta, 0.05);
    fx.now = now;

    const clicks = s.earthClicks;
    const boomAt = s.earthBoomAt;
    const bt = boomAt === null ? -1 : (Date.now() - boomAt) / 1000;
    const booming = bt >= 0;
    const p = clamp01(clicks / EARTH_BOOM_CLICKS);
    // 2段の不穏さ:
    //   warm(0〜300回) = 波紋が金色に寄り、ごく小さくふるえはじめる
    //   heat(250〜1000回) = ヒビ・赤い明滅・大きなふるえ・火の粉
    const warm = clamp01(p / 0.3);
    const heat = clamp01((p - 0.25) / 0.75);
    const pulse = heartbeat(now * (0.7 + 3.2 * heat * heat));

    const body = bodyRef.current;
    const halo = haloRef.current;
    const squash = squashRef.current;
    const shake = shakeRef.current;
    const spin = spinRef.current;

    // ── 自転(不穏なほど速く、ふらつく) ──
    if (spin) {
      fx.spinBoost *= Math.exp(-3.2 * dt);
      const spinUp = booming ? 1.6 : 0.9 * p * p * p;
      spin.rotation.y += dt * (0.02 + spinUp + fx.spinBoost);
      spin.rotation.z = 0.1 * heat * Math.sin(now * 7.3);
    }

    // ── ぷにっとバネ(つついた手応え) ──
    fx.punchVel += (-190 * fx.punch - 13 * fx.punchVel) * dt;
    fx.punch += fx.punchVel * dt;
    fx.tapShake = Math.max(0, fx.tapShake - dt * 3.4);

    if (booming) {
      // ── 爆発中は本体を時間割にまかせる ──
      const bs = earthBoomScale(bt);
      if (body) body.visible = bs > 0.001;
      // 0スケールだと行列が潰れるので最小値を残す(ハロも同じ入れ子にいる)
      if (squash) squash.scale.setScalar(Math.max(bs, 0.0001));
      if (shake) shake.position.set(0, 0, 0);
      fx.punch = 0;
      fx.punchVel = 0;
      // 生まれたては白熱していて、やがて冷める
      const cool = clamp01((bt - BOOM.coreAt) / (BOOM.settle - BOOM.coreAt));
      rig.earthMat.emissive.setRGB(1, 0.86 + 0.14 * cool, 0.7 + 0.3 * cool);
      rig.earthMat.emissiveIntensity = 0.85 + 2.6 * (1 - cool);
      // ヒビ: 砕ける直前は真っ白 → 復活後は熱が引いていく
      if (bt < BOOM.swell) {
        rig.cracks.setLook(1, CRACK_HOT, 1.4, 0.55);
      } else if (bt < BOOM.coreAt) {
        rig.cracks.setLook(1, CRACK_HOT, 0, 0);
      } else {
        const heal = Math.pow(1 - cool, 1.4);
        rig.cracks.setLook(
          1 - 0.35 * cool,
          _col.copy(CRACK_HOT).lerp(CRACK_WARM, cool),
          0.95 * heal,
          0.3 * heal
        );
      }
      // ハロは吹き飛んで、再生と一緒に戻る
      if (halo) {
        const hk = clamp01((bt - BOOM.coreAt) / 1.2);
        rig.haloMat.opacity = 0.16 * hk;
        rig.haloMat.color.copy(HALO_CALM);
        halo.scale.setScalar(1.07);
      }
    } else {
      // ── ふだん/不穏 ──
      if (body) body.visible = true;
      // 終盤はゆっくり大きく息をする(いまにも はちきれそう)。
      // 脈が抜けている瞬間でも一回り大きいままにして、止め絵でも異常が分かるように
      const swell = 1 + heat * (0.03 + 0.11 * pulse);
      if (squash) {
        squash.scale.set(
          (1 + fx.punch * 0.45) * swell,
          (1 - fx.punch * 0.6) * swell,
          (1 + fx.punch * 0.45) * swell
        );
      }
      // ふるえ: 回数が増えるほど大きく、つついた直後はさらに大きく。
      // 終盤(heat≈1)は半径の12%ぶれるので、遠目でも明らかに様子がおかしい
      if (shake) {
        const amp =
          0.008 +
          0.02 * warm +
          0.24 * Math.pow(heat, 1.6) +
          fx.tapShake * (0.02 + 0.05 * heat);
        shake.position.set(
          Math.sin(now * 23.7) * amp,
          Math.cos(now * 31.3) * amp * 0.8,
          Math.sin(now * 19.1) * amp * 0.6
        );
      }
      // 赤い明滅。鼓動が抜けている瞬間も赤みを残す(止め絵で「ふつうの地球」に
      // 見えてしまうと、遠景では異常が伝わらない)
      const flash = heat * (0.45 + 0.55 * pulse);
      rig.earthMat.emissive.setRGB(1, 1 - 0.52 * flash, 1 - 0.74 * flash);
      rig.earthMat.emissiveIntensity = 0.85 + 0.6 * flash;
      // ヒビ: 30%あたりから、種から割れが伝わっていく。
      // uGlow で球全体も赤熱させ、110pxの遠景でもトーンの違いが分かるようにする
      const grow = clamp01((p - 0.3) / 0.68);
      rig.cracks.setLook(
        grow * 0.95,
        _col.copy(CRACK_WARM).lerp(CRACK_HOT, heat * (0.35 + 0.65 * pulse)),
        grow * (0.55 + 0.6 * pulse) * (0.45 + 0.55 * heat),
        heat * (0.14 + 0.3 * pulse)
      );
      // ハロは赤く大きくふくらむ(地球のまわりの警告灯)
      if (halo) {
        rig.haloMat.color.copy(HALO_CALM).lerp(HALO_HOT, heat);
        rig.haloMat.opacity = 0.16 + 0.42 * heat * (0.5 + 0.5 * pulse);
        halo.scale.setScalar(1.07 + 0.38 * heat * (0.55 + 0.45 * pulse));
      }
    }

    // ── 火の粉: 終盤は表面からたえずこぼれ落ちる ──
    if (!booming && heat > 0.45) {
      fx.emberAcc += dt * (heat - 0.45) * 130;
      while (fx.emberAcc >= 1) {
        fx.emberAcc -= 1;
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const dx = Math.cos(th) * r;
        const dz = Math.sin(th) * r;
        const spd = 0.7 + Math.random() * 1.5;
        rig.sparks.spawn(
          dx * EARTH_RADIUS,
          u * EARTH_RADIUS,
          dz * EARTH_RADIUS,
          dx * spd,
          u * spd,
          dz * spd,
          0.16 + Math.random() * 0.22,
          0.7 + Math.random() * 0.6,
          1,
          0.6 + Math.random() * 0.25,
          0.3
        );
      }
    } else {
      fx.emberAcc = 0;
    }

    // ── 波紋・ポチ・きらきら ──
    for (let i = 0; i < RIPPLES; i++) {
      const k = (now - fx.rippleAt[i]) / RIPPLE_DUR;
      const m = rig.rippleMats[i];
      if (k < 0 || k > 1) {
        m.opacity = 0;
        continue;
      }
      rig.ripples[i].scale.setScalar(4.4 + 5.6 * easeOutCubic(k));
      m.opacity = 0.9 * Math.pow(1 - k, 1.7);
    }
    const pk = (now - fx.pokeAt) / 0.24;
    if (pk >= 0 && pk <= 1) {
      rig.poke.scale.setScalar(0.5 + 1.5 * easeOutCubic(pk));
      rig.pokeMat.opacity = Math.pow(1 - pk, 1.4);
    } else {
      rig.pokeMat.opacity = 0;
    }
    rig.sparks.update(now, state.size.height * state.gl.getPixelRatio() * 0.5);

    // ── カウンタ: 何回かつついた人に、つついた直後だけ見せる ──
    const hold = COUNTER_HOLD + 6 * heat;
    const want =
      !booming && clicks >= COUNTER_MIN && now - fx.lastTapAt < hold ? 1 : 0;
    if (want > 0 && fx.shownClicks !== clicks) {
      fx.shownClicks = clicks;
      rig.counter.draw(clicks, s.earthBooms); // 数が変わったときだけ描き直す
    }
    if (fx.counterOpacity > 0.003 || Math.abs(fx.counterOpacity - want) > 0.002) {
      fx.counterOpacity += (want - fx.counterOpacity) * Math.min(1, dt * 9);
      // 残りわずか(95%以上)は鼓動に合わせて点滅させる
      rig.counter.setOpacity(
        fx.counterOpacity * (p > 0.95 ? 0.7 + 0.3 * pulse : 1)
      );
    }
  });

  return (
    <group ref={anchorRef} position={[-18, 8, -28]} rotation={[0, 0, 0.2]}>
      {/* ふるえ → ぷにっ → 自転 の順に入れ子(それぞれ独立に動かすため) */}
      <group ref={shakeRef}>
        <group ref={squashRef}>
          <group ref={spinRef}>
            <mesh
              ref={bodyRef}
              geometry={rig.earthGeom}
              material={rig.earthMat}
              raycast={NO_RAYCAST}
            />
            {/* ヒビは地表に貼りつくので自転に追従させる */}
            <primitive object={rig.cracks.mesh} />
          </group>
          {/* うっすら大気のハロ */}
          <mesh
            ref={haloRef}
            geometry={rig.haloGeom}
            material={rig.haloMat}
            scale={1.07}
            raycast={NO_RAYCAST}
          />
        </group>
      </group>

      {/* 見えない当たり判定球: 画面上では小さい地球でも つつけるように少し大きく。
          月のピッキング球(原点・半径5)からは十分離れているので邪魔しない */}
      <mesh
        onPointerDown={handleDown}
        onPointerUp={handleUp}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      >
        <sphereGeometry args={[EARTH_HIT_RADIUS, 16, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      {/* 波紋・きらきら・カウンタ(ふるえや自転の影響を受けない位置) */}
      <primitive object={rig.fxRoot} />
      <EarthBoom texture={texture} />
    </group>
  );
}
