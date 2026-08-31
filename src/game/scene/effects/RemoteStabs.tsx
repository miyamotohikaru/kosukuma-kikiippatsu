"use client";

// 「他の人が刺した瞬間」。ポーリングで `store.remoteStabs` に積まれた他プレイヤーの
// 刺しを、剣が宇宙から降ってきて月面に刺さるところまで演じる。
// 遠くの出来事なので、自分の1本(StabSword)より小さく・短く・音も控えめにする。
//
// いちばん大事なのは `Swords` への「引き渡し」。落ち着いた瞬間の位置・向き・大きさが、
// `Swords` が InstancedMesh に書く行列と完全に同じでないと、剣がワープして台無しになる。
// そのため:
//   ・姿勢は `Swords` と同じ `orientSword()` から作る(自前で回転を組まない)
//   ・形は `Swords` と同じ `makeToySwordGeometry("field")`
//   ・色は「白マテリアル × インスタンスカラー」と同じ結果になる直塗り
//   ・チャームも `Swords` と同じ「鍔の下のビーズ1個」(ぶら下げ3個の hero 表現にしない)
//   ・着弾の余韻(沈み込み・ふるえ・squash)は q=1 でぴたりと 0 に戻る窓関数を掛ける
//
// 引き渡しの瞬間に「1フレームの欠け」も「二重描画」も作らない仕組み:
//   演出の最後に `endRemoteStab()` を呼ぶ → `remoteStabs` が変わる →
//   `Swords` の行列再構築(useEffect)と、こちらの「剣をしまう」(useEffect)が
//   **同じコミットの passive effect** で走る。どちらもフレームとフレームのあいだに
//   起きるので、描画されるのは常にどちらか片方だけになる。
//   (useFrame の中で剣を消してしまうと、React の再レンダリングが次フレームに
//    ずれ込んだときに「どちらも描かない1フレーム」が生まれてしまう)

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  CHARMS,
  REMOTE_MAX,
  REMOTE_STAGGER,
  T_REMOTE_STAB,
} from "@/lib/config";
import { emitGameEvent } from "@/game/events";
import { useGameStore, type RemoteStab } from "@/game/store";
import { getHoleWorld } from "@/game/scene/sharedRefs";
import {
  makeCharmBeadGeometry,
  makeSwordMaterial,
  makeToySwordGeometry,
  orientSword,
  SWORD_DIMS,
  swordHexOf,
  tickSwordMaterial,
} from "@/game/scene/sword/buildSword";
import { clamp01, easeOutCubic } from "./easing";
import { makeCircleTexture } from "./textures";

// ── 演出のパラメータ ────────────────────────────────────
/** 剣・エフェクトのプール本数。store 側の同時上限 + 予備2
 *  (引き渡し待ちのスロットが残っていても、次の1本がすぐ始められるように) */
const POOL = REMOTE_MAX + 2;

/** 降ってきて刺さるまで(秒)。store のキュー間隔とそろえるので config が正 */
const FALL_S = T_REMOTE_STAB / 1000;
/** 着弾してから完全に静止するまで(秒)。この終わりで Swords へ引き渡す */
const SETTLE_S = 0.3;
/** 着弾エフェクト(土煙・国旗)が消えるまで(秒)。スロットの再利用可否に使う */
const FX_LIFE = 1.15;

/** 剣が現れる高さ(月面からの units)。月の半径5に対して控えめに */
const FALL_H = 3.6;
/** 着弾で沈み込む深さ(剣の大きさ比)。overshoot & settle の「ぐっ」。
 *  settleWave の山は 0.24 くらいなので、実際の沈みは剣の丈の1割弱になる */
const SINK = 0.26;
/** 落下の尾の長さ(剣ローカル units) */
const TRAIL_LEN = 1.6;

const DUST_N = 12;
const DUST_LIFE = 0.55;
const RING_LIFE = 0.4;
const FLASH_LIFE = 0.22;
const FLAG_LIFE = 1.0;
/** 国旗を出す高さ(月面から。剣の全高0.72より上) */
const FLAG_Y = 1.1;

/** 「出遅れ」とみなす猶予(ms)。カットシーン明けはこれを超えるので並べ直す */
const LATE_MS = 400;

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color("#ffffff");

// 毎フレームの割り当てを避けるスクラッチ
const _v = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

/** 動きを減らす設定なら true(落下距離・回転・尾をおとなしくする) */
function reducedMotion(): boolean {
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
 * 着弾の余韻の波。q=0 で 0 から始まり、揺れながら減衰して **q=1 でぴたりと 0**。
 * 端が厳密に 0 なので、演出の終わりの姿勢が最終姿勢と1ピクセルもズレない。
 */
function settleWave(q: number, cycles: number): number {
  const decay = (1 - q) * (1 - q);
  return Math.sin(q * Math.PI * cycles) * decay * Math.exp(-2.2 * q);
}

// ── 国旗のテクスチャ(手続き生成・国コードでキャッシュ) ─────────
// 絵文字が出ない環境では2文字がそのまま出るが、それでも「どこの誰か」は伝わる。
const FLAG_CACHE = new Map<string, THREE.CanvasTexture>();
const FLAG_CACHE_MAX = 24;

function flagTexture(country: string): THREE.CanvasTexture | null {
  if (country.length !== 2) return null;
  const up = country.toUpperCase();
  const a = up.charCodeAt(0) - 65;
  const b = up.charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return null;

  const hit = FLAG_CACHE.get(up);
  if (hit) return hit;

  const w = 128;
  const h = 84;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 月の上でも読めるように、暗い角丸のチップに載せる
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(6 + r, 6);
  ctx.arcTo(w - 6, 6, w - 6, h - 6, r);
  ctx.arcTo(w - 6, h - 6, 6, h - 6, r);
  ctx.arcTo(6, h - 6, 6, 6, r);
  ctx.arcTo(6, 6, w - 6, 6, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(5,7,26,0.74)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,254,242,0.34)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // canvas の font は CSS の font ショートハンドしか受け付けない
  // (var() を混ぜると代入そのものが無視されて 10px になる)
  ctx.font =
    '46px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fffef2";
  ctx.fillText(String.fromCodePoint(0x1f1e6 + a, 0x1f1e6 + b), w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  // 際限なくためない(国が増えても古い方から捨てる)
  if (FLAG_CACHE.size >= FLAG_CACHE_MAX) {
    const oldest = FLAG_CACHE.keys().next().value;
    if (oldest !== undefined) {
      FLAG_CACHE.get(oldest)?.dispose();
      FLAG_CACHE.delete(oldest);
    }
  }
  FLAG_CACHE.set(up, tex);
  return tex;
}

// ── 共有ジオメトリ/テクスチャ ───────────────────────────

/** 落下の尾。加算合成なので、上へいくほど黒くして宇宙に溶かす */
function makeTrailGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.085, 1, 7, 4, true);
  geo.translate(0, 0.5, 0); // 底(=剣側)を原点、先端を +Y へ
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const f = Math.pow(1 - clamp01(pos.getY(i)), 1.7);
    col[i * 3] = f;
    col[i * 3 + 1] = f;
    col[i * 3 + 2] = f;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Shared {
  sword: THREE.BufferGeometry;
  bead: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  trail: THREE.BufferGeometry;
  circle: THREE.CanvasTexture;
  dispose: () => void;
}

function makeShared(): Shared {
  // 剣の形は Swords とまったく同じ "field" 品質にする(引き渡しでシルエットを変えない)
  const sword = makeToySwordGeometry("field");
  const bead = makeCharmBeadGeometry();
  const ring = new THREE.RingGeometry(0.8, 1, 32);
  ring.rotateX(-Math.PI / 2); // 月面(接平面)に寝かせる
  const trail = makeTrailGeometry();
  const circle = makeCircleTexture();
  return {
    sword,
    bead,
    ring,
    trail,
    circle,
    dispose: () => {
      sword.dispose();
      bead.dispose();
      ring.dispose();
      trail.dispose();
      circle.dispose();
    },
  };
}

// ── スロット(剣1本ぶんの使い回しユニット) ──────────────

interface Slot {
  /** このスロットの表示物ぜんぶ。ワールド原点のまま動かさない */
  root: THREE.Group;
  /** 剣の姿勢。ここに書く行列が、そのまま Swords の行列と一致する */
  pose: THREE.Group;
  sword: THREE.Mesh;
  bead: THREE.Mesh;
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  beadMat: THREE.MeshPhysicalMaterial;
  /** スキンごとの剣マテリアル(色は塗り替えるので、スロット専有にしてある) */
  swordMats: Map<number, THREE.MeshPhysicalMaterial>;

  /** 着弾エフェクト置き場。穴に固定して法線に合わせる */
  fx: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  flag: THREE.Sprite;
  flagMat: THREE.SpriteMaterial;
  dust: THREE.Points;
  dustMat: THREE.PointsMaterial;
  dustPos: Float32Array;
  dustVel: THREE.Vector3[];

  // ── 再生状態 ──
  /** 演出中の穴。-1 = 剣は使っていない */
  holeId: number;
  /** 再生開始時刻(epoch ms) */
  t0: number;
  /** 着弾時刻(epoch ms) */
  impactAt: number;
  /** エフェクトが終わる時刻(epoch ms)。スロットの再利用はここを過ぎてから */
  fxUntil: number;
  fxOn: boolean;
  impacted: boolean;
  /** endRemoteStab を呼んだ = あとは Swords が描く。表示は effect でしまう */
  handedOff: boolean;

  /** 最終姿勢(= Swords が書く行列)。ここへ寸分たがわず着地させる */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  size: number;
  /** 落下方向(穴の法線) */
  n: THREE.Vector3;
  /** 落ちながらの回転量 */
  spin: number;
  leanX: number;
  leanZ: number;
  wobX: number;
  wobZ: number;
  fallH: number;
  /** 落下の尾を出すか(動きを減らす設定では出さない) */
  showTrail: boolean;
}

function makeSlot(sh: Shared): Slot {
  const root = new THREE.Group();
  root.frustumCulled = false;

  // ── 剣 ──
  const pose = new THREE.Group();
  pose.visible = false;
  const swordMats = new Map<number, THREE.MeshPhysicalMaterial>();
  const baseMat = makeSwordMaterial(0, "#ffffff");
  swordMats.set(0, baseMat);
  const sword = new THREE.Mesh(sh.sword, baseMat);
  sword.frustumCulled = false;
  sword.raycast = () => {}; // 穴のタップを絶対に遮らない

  const beadMat = makeSwordMaterial(0, "#ffffff");
  const bead = new THREE.Mesh(sh.bead, beadMat);
  bead.frustumCulled = false;
  bead.visible = false;
  bead.raycast = () => {};

  const trailMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const trail = new THREE.Mesh(sh.trail, trailMat);
  trail.position.y = SWORD_DIMS.top; // 柄頭から上へ伸ばす
  trail.frustumCulled = false;
  trail.raycast = () => {};
  pose.add(sword, bead, trail);

  // ── 着弾エフェクト ──
  const fx = new THREE.Group();
  fx.visible = false;

  const ringMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(sh.ring, ringMat);
  ring.position.y = 0.035; // 月面とのZファイトを避ける
  ring.frustumCulled = false;
  ring.raycast = () => {};

  const flashMat = new THREE.SpriteMaterial({
    map: sh.circle,
    color: "#ffffff",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.position.y = 0.1;
  flash.frustumCulled = false;
  flash.raycast = () => {};

  const flagMat = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const flag = new THREE.Sprite(flagMat);
  flag.center.set(0.5, 0);
  flag.visible = false;
  flag.frustumCulled = false;
  flag.raycast = () => {};
  fx.add(ring, flash, flag);

  // ── 土煙(スプライトを並べず Points 1個。スロットあたり1ドローコール) ──
  const dustPos = new Float32Array(DUST_N * 3);
  const dustGeo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(dustPos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  dustGeo.setAttribute("position", attr);
  const dustMat = new THREE.PointsMaterial({
    map: sh.circle,
    color: "#d9def0", // 月の土(淡いラベンダーグレー)
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.visible = false;
  dust.frustumCulled = false;
  dust.raycast = () => {};

  root.add(pose, fx, dust);

  return {
    root,
    pose,
    sword,
    bead,
    trail,
    trailMat,
    beadMat,
    swordMats,
    fx,
    ring,
    ringMat,
    flash,
    flashMat,
    flag,
    flagMat,
    dust,
    dustMat,
    dustPos,
    dustVel: Array.from({ length: DUST_N }, () => new THREE.Vector3()),
    holeId: -1,
    t0: 0,
    impactAt: 0,
    fxUntil: 0,
    fxOn: false,
    impacted: false,
    handedOff: false,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    size: 1,
    n: new THREE.Vector3(0, 1, 0),
    spin: 0,
    leanX: 0,
    leanZ: 0,
    wobX: 0,
    wobZ: 0,
    fallH: FALL_H,
    showTrail: true,
  };
}

function disposeSlot(slot: Slot): void {
  slot.swordMats.forEach((m) => m.dispose());
  slot.swordMats.clear();
  slot.beadMat.dispose();
  slot.trailMat.dispose();
  slot.ringMat.dispose();
  slot.flashMat.dispose();
  slot.flagMat.dispose();
  slot.dustMat.dispose();
  slot.dust.geometry.dispose();
}

/** スキンに対応した、このスロット専用の剣マテリアル(色はそのつど塗り替える) */
function swordMaterialFor(
  slot: Slot,
  skin: number,
  color: number
): THREE.MeshPhysicalMaterial {
  let m = slot.swordMats.get(skin);
  if (!m) {
    // 白地で作って色は都度set。Swords の「白マテリアル×インスタンスカラー」と
    // 同じ結果になるので、引き渡しで色が変わらない
    m = makeSwordMaterial(skin, "#ffffff");
    slot.swordMats.set(skin, m);
  }
  m.color.set(swordHexOf(skin, color));
  return m;
}

/** 1本ぶんの再生を開始する(プールから借りたスロットを組み立てる) */
function beginSlot(slot: Slot, e: RemoteStab, t0: number, soft: boolean): void {
  const hw = getHoleWorld(e.holeId);
  slot.pos.copy(hw.pos);
  slot.n.copy(hw.normal);
  // 姿勢と大きさは Swords とまったく同じ関数から作る(ここを自前でやるとズレる)
  slot.size = orientSword(hw.normal, e.holeId, slot.quat);

  slot.holeId = e.holeId;
  slot.t0 = t0;
  slot.impacted = false;
  slot.handedOff = false;
  slot.pose.visible = false; // t0 が来るまでは出さない

  // 見た目(色・スキン・チャーム)。ビーズは Swords と同じ簡略表現にそろえる
  slot.sword.material = swordMaterialFor(slot, e.skin, e.color);
  // ビーズの色は「いちばん新しくつけたチャーム」= 一覧の最後(Swords と同じ約束)
  if (e.charms.length > 0) {
    slot.bead.visible = true;
    slot.beadMat.color.set(
      CHARMS[e.charms[e.charms.length - 1]]?.hex ?? CHARMS[0].hex
    );
  } else {
    slot.bead.visible = false;
  }

  // 尾・リング・閃光は「誰の剣か」がうっすら分かるよう、剣の色を白へ寄せて使う
  _color.set(swordHexOf(e.skin, e.color)).lerp(WHITE, 0.5);
  slot.trailMat.color.copy(_color);
  slot.ringMat.color.copy(_color);
  slot.flashMat.color.copy(_color);

  // まっすぐ落ちるだけだと安っぽいので、回りながら・傾きながら落として
  // 着弾までにきっちり最終姿勢へ戻す
  const dir = Math.random() < 0.5 ? -1 : 1;
  slot.spin = soft ? 0 : dir * (1.6 + Math.random() * 1.6) * Math.PI;
  slot.leanX = soft ? 0 : (Math.random() - 0.5) * 0.9;
  slot.leanZ = soft ? 0 : (Math.random() - 0.5) * 0.9;
  slot.wobX = soft ? 0 : (Math.random() - 0.5) * 0.36;
  slot.wobZ = soft ? 0 : (Math.random() - 0.5) * 0.36;
  slot.fallH = soft ? FALL_H * 0.4 : FALL_H;
  slot.showTrail = !soft;
  slot.trail.visible = false;
}

/** 演出中の剣をしまう(Swords が描く番になった)。エフェクトはそのまま続ける */
function stowSword(slot: Slot): void {
  slot.pose.visible = false;
  slot.holeId = -1;
  slot.handedOff = false;
}

export default function RemoteStabs() {
  // 本数が変わったときだけ再レンダリング(毎フレームの setState はしない)
  const remoteStabs = useGameStore((s) => s.remoteStabs);

  const shared = useMemo(makeShared, []);
  const slots = useMemo(
    () => Array.from({ length: POOL }, () => makeSlot(shared)),
    [shared]
  );
  const root = useMemo(() => {
    const g = new THREE.Group();
    g.frustumCulled = false;
    for (const s of slots) g.add(s.root);
    return g;
  }, [slots]);
  const soft = useMemo(reducedMotion, []);

  useEffect(() => {
    return () => {
      // アンマウント時: 演出中の剣を宙に浮かせたまま消さない。
      // endRemoteStab を呼ばないと、その穴の剣が Swords 側でも描かれず消えたままになる
      const end = useGameStore.getState().endRemoteStab;
      for (const s of slots) {
        if (s.holeId >= 0) end(s.holeId);
        disposeSlot(s);
      }
      shared.dispose();
    };
  }, [slots, shared]);

  // ── 引き渡し ──
  // store から消えた穴のスロットを、この effect でしまう。`Swords` の行列再構築も
  // 同じ store 変更が起こす同じコミットの effect なので、両者はフレームの
  // あいだで入れ替わる = 欠けも二重描画も起きない。
  // (store 側が古い演出を畳んだ場合も同じ経路でしまわれる)
  useEffect(() => {
    for (const s of slots) {
      if (s.holeId < 0) continue;
      let alive = false;
      for (const r of remoteStabs) {
        if (r.holeId === s.holeId) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        // store 側が古い演出を畳んだ場合もここへ来る。playingStabs に穴が
        // 残ったままだと Swords が永久に描かないので、必ず引き渡しておく
        const holeId = s.holeId;
        stowSword(s);
        useGameStore.getState().endRemoteStab(holeId);
      }
    }
  }, [remoteStabs, slots]);

  useFrame((state, dt) => {
    const st = useGameStore.getState();
    const now = Date.now();

    // ── 新しい刺しをプールに割り当てる ──
    // 自分のカットシーン(stabbing〜new-round)の最中は始めない。主役は自分の1本で、
    // 寄ったカメラの手前に他人の剣が降ってくると邪魔になるため。
    // 待たされたぶんは store に残るので取りこぼしはなく、idle に戻ったときに
    // REMOTE_STAGGER で並べ直して「パラパラ」と降らせる。
    // 逆に、降下中にフェーズが変わっても途中で消さない(必ず着弾させて引き渡す)。
    const queue = st.remoteStabs;
    if (queue.length > 0 && (st.phase === "idle" || st.phase === "confirming")) {
      let late = 0;
      for (let qi = 0; qi < queue.length; qi++) {
        const e = queue[qi];
        let free: Slot | null = null;
        let taken = false;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (s.holeId === e.holeId) {
            taken = true;
            break;
          }
          if (!free && s.holeId < 0 && now >= s.fxUntil) free = s;
        }
        if (taken) continue;
        if (!free) break; // 空きが出るまで store が持っていてくれる
        const overdue = now - e.startAt > LATE_MS;
        beginSlot(
          free,
          e,
          overdue ? now + late++ * REMOTE_STAGGER : e.startAt,
          soft
        );
        // ここではじめて Swords に「この穴は描かないで」と伝える。
        // 順番待ちのあいだも隠していたせいで、混んでいるときや自分の
        // カットシーン中に、誰も描かない穴(=消えた剣)が生まれていた
        st.claimRemoteStab(e.holeId);
      }
    }

    // ── 再生 ──
    const clock = state.clock.elapsedTime;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.holeId >= 0) updateSword(slot, now, clock);
      if (slot.fxOn) updateFx(slot, now, dt);
    }
  });

  return <primitive object={root} />;
}

/** 剣の落下〜着弾〜静止。最後に必ず「Swords とまったく同じ行列」へ収束する */
function updateSword(slot: Slot, now: number, clock: number): void {
  const t = (now - slot.t0) / 1000;
  if (t < 0) return; // 順番待ち(スロットは押さえてある)

  slot.pose.visible = true;
  const bury = SWORD_DIMS.bury * slot.size;

  if (t < FALL_S) {
    // ── 降下: 自由落下(距離が t² で伸びる)で加速しながら落ちる ──
    const p = t / FALL_S;
    const k = 1 - p;
    const tipH = slot.fallH + (-bury - slot.fallH) * p * p; // 剣先の高さ
    slot.pose.position.copy(slot.pos).addScaledVector(slot.n, tipH + bury);

    // 回りながら・傾きながら。どちらも p=1 で厳密に 0 になるので着弾姿勢は最終姿勢
    _qA.setFromAxisAngle(UP, slot.spin * k);
    _euler.set(slot.leanX * k * k, 0, slot.leanZ * k * k);
    _qB.setFromEuler(_euler);
    slot.pose.quaternion.copy(slot.quat).multiply(_qA).multiply(_qB);

    // 宇宙からポンと現れるので、最初の0.1秒だけ小さく湧かせる
    const pop = t < 0.1 ? easeOutCubic(t / 0.1) : 1;
    slot.pose.scale.setScalar(slot.size * pop);

    // 尾: 速いほど長く、着弾でスッと消える
    if (slot.showTrail) {
      slot.trail.visible = true;
      slot.trail.scale.set(1, TRAIL_LEN * (0.4 + 0.6 * p), 1);
      slot.trailMat.opacity = 0.7 * clamp01(p / 0.12) * (1 - p * p * p * p);
    }
  } else {
    // ── 着弾〜静止 ──
    if (!slot.impacted) fireImpact(slot, now);
    slot.trail.visible = false;

    const q = clamp01((t - FALL_S) / SETTLE_S);
    const sink = settleWave(q, 1); // ぐっと沈んで戻る
    const wob = settleWave(q, 2.4); // 根元のふるえ
    slot.pose.position
      .copy(slot.pos)
      .addScaledVector(slot.n, -SINK * slot.size * sink);
    _euler.set(slot.wobX * wob, 0, slot.wobZ * wob);
    _qA.setFromEuler(_euler);
    slot.pose.quaternion.copy(slot.quat).multiply(_qA);
    slot.pose.scale.setScalar(slot.size * (1 - 0.12 * sink));

    // q=1 では sink も wob も厳密に 0 = いま書いた行列が Swords の行列と一致する。
    // このフレームの描画のあと(次のコミット)に Swords が引き取る
    if (q >= 1 && !slot.handedOff) {
      slot.handedOff = true;
      useGameStore.getState().endRemoteStab(slot.holeId);
    }
  }

  // にじいろスキンの色相送り(他のスキンでは何もしない)
  const mat = slot.sword.material;
  if (!Array.isArray(mat)) tickSwordMaterial(mat, clock);
}

/** 着弾の瞬間: 音・土煙・衝撃の輪・閃光・国旗を仕込む */
function fireImpact(slot: Slot, now: number): void {
  slot.impacted = true;
  slot.impactAt = now;
  slot.fxUntil = now + FX_LIFE * 1000;
  slot.fxOn = true;

  // エフェクト置き場を穴の上に寝かせる(剣は沈むが、こちらは月面に残す)
  slot.fx.visible = true;
  slot.fx.position.copy(slot.pos).addScaledVector(slot.n, 0.02);
  slot.fx.quaternion.setFromUnitVectors(UP, slot.n);

  // 接平面の基底を作って、土煙を放射状に飛ばす(自分の刺しより小さく・弱く)
  _axis.set(0, 1, 0);
  if (Math.abs(slot.n.y) > 0.95) _axis.set(1, 0, 0);
  _t1.crossVectors(_axis, slot.n).normalize();
  _t2.crossVectors(slot.n, _t1);
  for (let i = 0; i < DUST_N; i++) {
    const th = (i / DUST_N) * Math.PI * 2 + Math.random() * 0.8;
    const spd = 0.5 + Math.random() * 0.8;
    slot.dustVel[i]
      .copy(_t1)
      .multiplyScalar(Math.cos(th) * spd)
      .addScaledVector(_t2, Math.sin(th) * spd)
      .addScaledVector(slot.n, 0.18 + Math.random() * 0.4);
    _v.copy(slot.pos)
      .addScaledVector(slot.n, 0.05)
      .addScaledVector(slot.dustVel[i], 0.04);
    slot.dustPos[i * 3] = _v.x;
    slot.dustPos[i * 3 + 1] = _v.y;
    slot.dustPos[i * 3 + 2] = _v.z;
  }
  slot.dust.geometry.getAttribute("position").needsUpdate = true;
  slot.dust.visible = true;

  // 誰の剣かのヒント。国が分からないときは何も出さない(やりすぎない)
  let country: string | null = null;
  for (const e of useGameStore.getState().recent) {
    if (e.holeId === slot.holeId) {
      country = e.country;
      break;
    }
  }
  const tex = country ? flagTexture(country) : null;
  if (tex) {
    slot.flagMat.map = tex;
    slot.flagMat.needsUpdate = true;
    slot.flag.visible = true;
  } else {
    slot.flag.visible = false;
  }

  // 遠くで小さくコツン(音側で間引き・パン・ピッチ散らしまで面倒を見てくれる)
  emitGameEvent("remote-stab");
}

/** 着弾エフェクトの寿命管理。剣を引き渡したあとも最後まで再生しきる */
function updateFx(slot: Slot, now: number, dt: number): void {
  const tf = (now - slot.impactAt) / 1000;
  if (tf >= FX_LIFE) {
    slot.fxOn = false;
    slot.fx.visible = false;
    slot.dust.visible = false;
    return;
  }

  // 土煙: 放射 → 指数減速しながら広がって薄くなる
  if (tf < DUST_LIFE) {
    const k = tf / DUST_LIFE;
    const damp = Math.exp(-5.2 * dt);
    for (let i = 0; i < DUST_N; i++) {
      const v = slot.dustVel[i];
      v.multiplyScalar(damp);
      slot.dustPos[i * 3] += v.x * dt;
      slot.dustPos[i * 3 + 1] += v.y * dt;
      slot.dustPos[i * 3 + 2] += v.z * dt;
    }
    slot.dust.geometry.getAttribute("position").needsUpdate = true;
    slot.dustMat.size = 0.13 * (1 + 1.5 * k);
    slot.dustMat.opacity = 0.42 * Math.pow(1 - k, 1.5);
  } else if (slot.dust.visible) {
    slot.dust.visible = false;
  }

  // 衝撃の輪: すっと広がって消える
  if (tf < RING_LIFE) {
    const k = tf / RING_LIFE;
    const e = easeOutCubic(k);
    slot.ring.scale.setScalar(0.07 + 0.4 * e);
    slot.ringMat.opacity = 0.5 * (1 - k) * (1 - k);
    slot.ring.visible = true;
  } else if (slot.ring.visible) {
    slot.ring.visible = false;
  }

  // 閃光: ごく短く
  if (tf < FLASH_LIFE) {
    const k = tf / FLASH_LIFE;
    slot.flash.scale.setScalar(0.26 + 0.4 * k);
    slot.flashMat.opacity = 0.7 * (1 - k) * (1 - k);
    slot.flash.visible = true;
  } else if (slot.flash.visible) {
    slot.flash.visible = false;
  }

  // 国旗: ふわっと上がって消える。小さく短く
  if (slot.flag.visible) {
    const k = tf / FLAG_LIFE;
    if (k >= 1) {
      slot.flag.visible = false;
    } else {
      const pop = easeOutCubic(clamp01(k / 0.16));
      slot.flag.position.y = FLAG_Y + 0.3 * easeOutCubic(k);
      slot.flag.scale.set(0.6 * pop, 0.39 * pop, 1);
      slot.flagMat.opacity =
        0.95 * pop * (1 - clamp01((k - 0.65) / 0.35));
    }
  }
}
