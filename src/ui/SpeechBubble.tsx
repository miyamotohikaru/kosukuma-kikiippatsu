"use client";

// こすくまくんの吹き出し(DOM)。
//
// 追従のしくみ:
//   SpeechAnchor(Canvas内)が毎フレーム書く sharedRefs.speechAnchor を
//   requestAnimationFrame で読み、style.transform に直書きする。
//   Reactの再レンダリングが起きるのは「セリフが変わったとき」だけ。
//
// かたちのしくみ(2026-08 作り直し):
//   **輪郭は1本の閉じたSVGパス**。角丸の本体を時計回りに1周し、尻尾が生える
//   ふちだけ、途中で外へ出て戻ってくる。fill と stroke が1回しかかからないので、
//   本体と尻尾のあいだに継ぎ目が **原理的に** 生じない。
//   (前は「borderを持つ箱」「尻尾のSVG」「継ぎ目を隠す板」の3枚重ねだった。
//    輪郭が別々に引かれていたので、どう調整しても段が残った)
//
// 組み立て(いちばん外から):
//   .sb-root  = 頭のよこの点。JSが translate + scale する
//   .sb-wrap  = 吹き出し本体のオフセット。画面のはしでは内側へずれる
//   .sb-body  = 大きさの持ち主(文字量で決まる)。CSSアニメ(ぽん/tone別のくせ)
//     svg.sb-shape > path = 輪郭1枚(本体+尻尾)。影もこれ1枚に落ちる
//     .sb-text            = セリフ(パスの中には入れない)
//
// transform を JS と CSSアニメで奪い合わないよう、階層を分けているのが要点。
//
// 改行の担当は wrapJa.ts。CSSの折り返しは日本語だと どこでも切ってしまうので、
// 「1行に何文字入るか」だけ実際のCSSから測って、切る場所はこちらで決めている。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { speechAnchor } from "@/game/scene/sharedRefs";
import { useGameStore, type SpeechTone } from "@/game/store";
import { DEFAULT_MAX_UNITS, wrapJaText } from "./wrapJa";
import "./speech.css";

/**
 * 頭は「吹き出しの手前がわ、22%くらいのところ」の真下に来る。
 * 真横に離して置くと尻尾が長く寝てしまい、細いヒゲみたいに見える。
 * 頭の上にかぶせて、短くて太い尻尾をまっすぐ下ろすほうが しっかり付いて見える。
 */
const SIDE_BIAS = 0.22;

// ── 尻尾のかたち ──────────────────────────────────────
// まんがの吹き出しの尻尾は、本体に対してずっと小さい。付け根はふちに沿って短く、
// そこから急に細くなって先は点に近い。**上下左右どの向きでも同じ寸法**にするため、
// 「付け根の半幅」と「長さ」を固定値で持ち、向きだけを頭に向ける。
/** 付け根の半分の幅 */
const TAIL_HALF = 9;
/** 長さの目安(=頭とのすきま)。ふだんはこの距離ぴったりに置く */
const TAIL_LEN = 24;
/** 画面のはしで本体がずれても、これ以上は伸ばさない/縮めない */
const TAIL_LEN_MIN = 15;
const TAIL_LEN_MAX = 32;
/** 本体に対して主張しすぎないための上限(本体の高さの約半分) */
const TAIL_LEN_RATIO = 0.52;
/** ふちの法線から傾いてよい角度。これ以上は寝かせない(平たい板に見えるので) */
const TAIL_TILT = 0.62; // rad ≒ 35°
/** 側面のくびれ。付け根の幅に対する制御点の位置。小さいほど先が鋭くなる */
const TAIL_WAIST = 0.46;
/** 全体をすこし片側へ反らせる量(手描きの角(つの)っぽさ) */
const TAIL_LEAN = 0.1;
/**
 * びっくりのいなずま。付け根の2点それぞれを、**自分の側のまま** 折り曲げる量。
 * 両方を同じ向きへ折ると軸を越えて輪郭が自分と交わるので、必ず符号を分けること
 */
const JAG_TAIL_OUT = 0.45; // 片側は外へ張り出す
const JAG_TAIL_IN = -0.3; // もう片側は内へ入る(左右で表情が変わる)

/** ねむいときは「考えごと」の玉なので、すきまを少し広めに取る */
const GAP_Y_SLEEPY = 30;
/** 「よこ」に出すとき、体のシルエットから空ける距離(=尻尾の長さ) */
const SIDE_GAP = TAIL_LEN;
/** 「上」へ戻るときに求める余分な余裕(境目でパタパタさせない) */
const MODE_HYST = 16;
/** 尻尾を出すふちを変えるのに必要な差(境目でパタパタさせない) */
const EDGE_HYST = 0.18;
/** 画面のふちに残す余白 */
const EDGE = 10;
/** 輪郭SVGを四方に広げる量(speech.css の .sb-shape と合わせること) */
const SHAPE_PAD = 96;
/** 消えるアニメの長さ(speech.css の sb-out と合わせる) */
const OUT_MS = 220;
/**
 * 吹き出しの最大幅。ふだんは getComputedStyle から実測するので使わないが、
 * min() を計算前のまま返すブラウザ向けの保険として持っておく。
 * speech.css の .sb-body の max-width と合わせること
 */
const MAX_W_VW = 0.64;
const MAX_W_PX = 300;
/** 折り返しの幅は、ぎりぎりを狙うとCSS側で1文字だけ折れる。すこし辛めに見る */
const WRAP_MARGIN = 0.2;

// ── 前面のUIをよける ──────────────────────────────────
// 吹き出しは HUD(z-index:10)より下のレイヤーなので、かぶると読めなくなる。
// 位置で逃げるしかないため、相手の矩形をDOMから読んで「使えない帯」にする。
// (あちらのCSSは触らない。相手が変わっても勝手についていく)
/** 画面の上に貼りついているUI */
const TOP_UI = ".hud-badges, .hud-top-right";
/** 画面の下に貼りついているUI と、画面の中央に出る大きな札 */
const BOTTOM_UI =
  ".confirm-sheet, .feed-wrap, .cooldown-pill, .kk-fab, .conn-warn, .toast, .center-stage > *";
/** これが出ているあいだは吹き出しを出さない(暗幕の下では どうせ読めない) */
const COVER_UI = ".kk-drawer-back, .modal-backdrop";
/** UIから空ける余白 */
const UI_GAP = 8;
/** UIの位置を測り直す間隔(フィードは数秒で増減する) */
const SCAN_MS = 250;

/** 画面の上/下から「ここまでは使えない」を表す帯。x が重なるものだけ効く */
interface Band {
  x0: number;
  x1: number;
  /** 上の帯なら「下端のy」、下の帯なら「上端から下の高さ」 */
  edge: number;
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/** x が [x0,x1] と重なる帯のうち、いちばん厚いものを返す */
function bandOf(list: Band[], x0: number, x1: number, dflt: number): number {
  let v = dflt;
  for (const b of list) {
    if (b.x1 > x0 && b.x0 < x1 && b.edge > v) v = b.edge;
  }
  return v;
}

/**
 * `--sb-radius` を、CSSの border-radius と同じ省略ルールで4つ(左上/右上/右下/左下)に
 * ひらく。1つ=全部おなじ / 2つ=(左上・右下)(右上・左下) / 3つ=左上,(右上・左下),右下。
 * 本体より大きい丸みは形が壊れるので、短いほうの辺の半分で頭打ちにする。
 */
function parseRadius(src: string, w: number, h: number): number[] {
  const n = src
    .trim()
    .split(/\s+/)
    .map((t) => parseFloat(t))
    .filter((v) => Number.isFinite(v));
  let q: number[];
  if (n.length >= 4) q = [n[0], n[1], n[2], n[3]];
  else if (n.length === 3) q = [n[0], n[1], n[2], n[1]];
  else if (n.length === 2) q = [n[0], n[1], n[0], n[1]];
  else if (n.length === 1) q = [n[0], n[0], n[0], n[0]];
  else q = [20, 20, 20, 20];
  const lim = Math.max(0, Math.min(w, h) * 0.5 - 0.5);
  return q.map((r) => clamp(r, 0, lim));
}

/**
 * ふち e の「角丸を除いた直線部分」。
 * e は 0=上 / 1=右 / 2=下 / 3=左。s→t が時計回りに進む向き(d)、n は外向きの法線。
 * 左上を (0,0)、右下を (w,h) とする本体ローカル座標。
 */
function edgeOf(e: number, w: number, h: number, r: number[]) {
  switch (e) {
    case 0:
      return { sx: r[0], sy: 0, tx: w - r[1], ty: 0, nx: 0, ny: -1, dx: 1, dy: 0 };
    case 1:
      return { sx: w, sy: r[1], tx: w, ty: h - r[2], nx: 1, ny: 0, dx: 0, dy: 1 };
    case 2:
      return { sx: w - r[2], sy: h, tx: r[3], ty: h, nx: 0, ny: 1, dx: -1, dy: 0 };
    default:
      return { sx: 0, sy: h - r[3], tx: 0, ty: r[0], nx: -1, ny: 0, dx: 0, dy: -1 };
  }
}

/** ふち e を歩き終えた先にある角(円弧の終点と半径) */
function cornerOf(e: number, w: number, h: number, r: number[]) {
  switch (e) {
    case 0:
      return { r: r[1], x: w, y: r[1] };
    case 1:
      return { r: r[2], x: w - r[2], y: h };
    case 2:
      return { r: r[3], x: 0, y: h - r[3] };
    default:
      return { r: r[0], x: r[0], y: 0 };
  }
}

interface Tail {
  /** 生えているふち(0=上 1=右 2=下 3=左) */
  e: number;
  /** 付け根の中心(本体ローカル) */
  cx: number;
  cy: number;
  /** 付け根の中心の、ふちの始点からの距離(ギザギザを飛ばす区間に使う) */
  at: number;
  /** 尻尾の軸(単位ベクトル)と長さ・付け根の半幅 */
  ux: number;
  uy: number;
  len: number;
  half: number;
  /** ふちに沿って進む向き(付け根の2点を並べるのに使う) */
  ex: number;
  ey: number;
}

/**
 * 頭 (hx,hy) を指す尻尾を組み立てる。
 * 付け根は角丸にかからない範囲へ収め、向きだけ頭へ向ける(傾けすぎない)。
 * **長さと太さは向きによらず同じ**なので、上下左右どこから出しても同じ形になる。
 */
function solveTail(
  e: number,
  w: number,
  h: number,
  r: number[],
  hx: number,
  hy: number
): Tail | null {
  const E = edgeOf(e, w, h, r);
  const run = Math.hypot(E.tx - E.sx, E.ty - E.sy);
  const half = Math.min(TAIL_HALF, run * 0.5 - 1);
  if (!(half > 2)) return null; // 付け根が取れないほど小さい本体

  // 付け根は「頭をまっすぐ見る位置」。角丸に食い込まないところへ収める
  const proj = (hx - E.sx) * E.dx + (hy - E.sy) * E.dy;
  const at = clamp(proj, half + 0.5, run - half - 0.5);
  const cx = E.sx + E.dx * at;
  const cy = E.sy + E.dy * at;

  // 向き: 頭のほうへ。ただしふちに寝かせると平たい板に見えるので角度を止める。
  // 画面の上へ押し込まれて頭が本体の中に入ってしまったときは、指す先が無い。
  // そのときは まっすぐ外へ、いちばん短く出す(あさっての方角を指させない)
  const inside = hx > 0 && hx < w && hy > 0 && hy < h;
  const vx = hx - cx;
  const vy = hy - cy;
  const dist = inside ? TAIL_LEN_MIN : Math.hypot(vx, vy);
  let ux = E.nx;
  let uy = E.ny;
  if (!inside && dist > 0.5) {
    const ax = vx / dist;
    const ay = vy / dist;
    const ang = Math.atan2(E.nx * ay - E.ny * ax, E.nx * ax + E.ny * ay);
    const t = clamp(ang, -TAIL_TILT, TAIL_TILT);
    const c = Math.cos(t);
    const s = Math.sin(t);
    ux = E.nx * c - E.ny * s;
    uy = E.nx * s + E.ny * c;
  }

  const len = clamp(
    dist,
    TAIL_LEN_MIN,
    Math.min(TAIL_LEN_MAX, Math.max(TAIL_LEN_MIN, h * TAIL_LEN_RATIO))
  );
  return { e, cx, cy, at, ux, uy, len, half, ex: E.dx, ey: E.dy };
}

/**
 * 尻尾の輪郭(付け根の片方 → 先 → 付け根のもう片方)。
 * 本体の輪郭を歩いている途中に差し込むので、頭に L、最後は付け根の2点目で終わる。
 * 側面を軸へ寄せて(TAIL_WAIST)ゆるく凹ませ、先を鋭くしている。
 */
function tailCurve(t: Tail): string {
  const vx = -t.uy; // 軸の垂線
  const vy = t.ux;
  const b1x = t.cx - t.ex * t.half;
  const b1y = t.cy - t.ey * t.half;
  const b2x = t.cx + t.ex * t.half;
  const b2y = t.cy + t.ey * t.half;
  const tipx = t.cx + t.ux * t.len;
  const tipy = t.cy + t.uy * t.len;
  // 付け根の2点の「軸からのずれ」。斜めに出しても形が崩れないよう射影で測る
  const s1 = (b1x - t.cx) * vx + (b1y - t.cy) * vy;
  const s2 = (b2x - t.cx) * vx + (b2y - t.cy) * vy;
  const q = t.len * 0.5;
  const lean = t.half * TAIL_LEAN;
  const q1x = t.cx + t.ux * q + vx * (s1 * TAIL_WAIST + lean);
  const q1y = t.cy + t.uy * q + vy * (s1 * TAIL_WAIST + lean);
  const q2x = t.cx + t.ux * q + vx * (s2 * TAIL_WAIST + lean);
  const q2y = t.cy + t.uy * q + vy * (s2 * TAIL_WAIST + lean);
  return (
    `L${f(b1x)},${f(b1y)}` +
    `Q${f(q1x)},${f(q1y)} ${f(tipx)},${f(tipy)}` +
    `Q${f(q2x)},${f(q2y)} ${f(b2x)},${f(b2y)}`
  );
}

/**
 * ねむいときの「考えごと」の玉。本体から離れた、独立した閉じた部分パス。
 * 玉は必ず離れていること(くっつくと線が交わって にごる)。
 * 大きさも間隔も尻尾の長さに比例させるので、どの向きでも同じ見えかたになる。
 */
function thoughtDots(t: Tail): string {
  // 玉3つ + すきま2つ + 出だし が、ちょうど尻尾の長さ(=頭までの距離)に収まる比率
  const rad = [t.len * 0.19, t.len * 0.13, t.len * 0.083];
  const gap = t.len * 0.08;
  let d = "";
  let off = 2.5;
  for (let i = 0; i < 3; i++) {
    off += rad[i];
    const r = rad[i];
    const cx = t.cx + t.ux * off;
    const cy = t.cy + t.uy * off;
    d +=
      `M${f(cx - r)},${f(cy)}` +
      `a${f(r)},${f(r)} 0 1,0 ${f(r * 2)},0` +
      `a${f(r)},${f(r)} 0 1,0 ${f(-r * 2)},0`;
    off += r + gap;
  }
  return d;
}

/** びっくりのギザギザ。ふちの折り返し1つぶんの目安と、外へ出る山の高さ */
const JAG_STEP = 19;
const JAG_AMP = 5;

/**
 * びっくり(shock)の輪郭。角丸を使わず、ふちを折り紙のように折った多角形。
 * 尻尾も同じ1周のなかに、いなずま型で差し込む。
 */
function jagPath(w: number, h: number, tail: Tail | null): string {
  const R = [0, 0, 0, 0];
  const pts: number[][] = [];
  const push = (x: number, y: number) => {
    const p = pts[pts.length - 1];
    if (p && Math.abs(p[0] - x) < 0.05 && Math.abs(p[1] - y) < 0.05) return;
    pts.push([x, y]);
  };

  for (let e = 0; e < 4; e++) {
    const E = edgeOf(e, w, h, R);
    const run = Math.hypot(E.tx - E.sx, E.ty - E.sy);
    const n = Math.max(3, Math.round(run / JAG_STEP));
    const jag = (lo: number, hi: number) => {
      for (let k = 1; k < n; k++) {
        const p = (run * k) / n;
        if (p <= lo || p >= hi) continue;
        const off = k % 2 === 1 ? JAG_AMP : 0;
        push(E.sx + E.dx * p + E.nx * off, E.sy + E.dy * p + E.ny * off);
      }
    };
    push(E.sx, E.sy);
    if (tail && tail.e === e) {
      jag(0, tail.at - tail.half);
      // 付け根 → いなずま → 先 → いなずま → 付け根
      const vx = -tail.uy;
      const vy = tail.ux;
      const b1x = tail.cx - tail.ex * tail.half;
      const b1y = tail.cy - tail.ey * tail.half;
      const b2x = tail.cx + tail.ex * tail.half;
      const b2y = tail.cy + tail.ey * tail.half;
      const tx = tail.cx + tail.ux * tail.len;
      const ty = tail.cy + tail.uy * tail.len;
      // 折れ目は「その点がいる側」へ動かす。軸をまたぐと輪郭が自分と交わる
      const s1 = (b1x - tail.cx) * vx + (b1y - tail.cy) * vy;
      const s2 = (b2x - tail.cx) * vx + (b2y - tail.cy) * vy;
      const k1 = s1 * JAG_TAIL_OUT;
      const k2 = s2 * JAG_TAIL_IN;
      push(b1x, b1y);
      push((b1x + tx) * 0.5 + vx * k1, (b1y + ty) * 0.5 + vy * k1);
      push(tx, ty);
      push((tx + b2x) * 0.5 + vx * k2, (ty + b2y) * 0.5 + vy * k2);
      push(b2x, b2y);
      jag(tail.at + tail.half, run);
    } else {
      jag(0, run);
    }
  }
  return `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}Z`;
}

/**
 * 吹き出しの輪郭ぜんぶを1本のパスにして返す。
 * 角丸の本体を時計回りに1周し、尻尾が生えるふちだけ途中で外へ出て戻る。
 * この1本に fill と stroke をかけるので、本体と尻尾に継ぎ目ができない。
 */
function bubblePath(
  w: number,
  h: number,
  r: number[],
  tone: SpeechTone,
  tail: Tail | null
): string {
  if (tone === "shock") return jagPath(w, h, tail);
  // ねむいときの尻尾は離れた玉なので、本体のふちには何も差し込まない
  const splice = tone === "sleepy" ? null : tail;
  const out: string[] = [`M${f(r[0])},0`];
  for (let e = 0; e < 4; e++) {
    const E = edgeOf(e, w, h, r);
    if (splice && splice.e === e) out.push(tailCurve(splice));
    out.push(`L${f(E.tx)},${f(E.ty)}`);
    const c = cornerOf(e, w, h, r);
    if (c.r > 0.05) out.push(`A${f(c.r)},${f(c.r)} 0 0 1 ${f(c.x)},${f(c.y)}`);
  }
  out.push("Z");
  if (tone === "sleepy" && tail) out.push(thoughtDots(tail));
  return out.join("");
}

export default function SpeechBubble() {
  // 再レンダリングはセリフが変わったときだけ(位置追従は rAF が直接さわる)
  const speech = useGameStore((s) => s.speech);
  // フェーズは「よけるUI」を測り直すきっかけにだけ使う(数秒に1回)
  const phase = useGameStore((s) => s.phase);

  const layerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  // 1行に入る全角文字数。字の大きさ(clamp)と最大幅から測るので、画面幅で変わる。
  // 変わったときだけ setState する(セリフごとの再レンダリングは増やさない)
  const [wrapMax, setWrapMax] = useState(DEFAULT_MAX_UNITS);
  const wrapMaxRef = useRef(DEFAULT_MAX_UNITS);

  // 実際に表示する文(改行入り)。セリフか幅が変わったときだけ折り直す
  const shown = useMemo(
    () => (speech ? wrapJaText(speech.text, { max: wrapMax }) : ""),
    [speech, wrapMax]
  );

  // rAFループから読む値はすべて ref(setStateを起こさない)
  const speechRef = useRef(speech);
  const sizeRef = useRef({ w: 150, h: 46, r: [20, 20, 20, 20] });
  const viewRef = useRef({ w: 1, h: 1 });
  const sideRef = useRef(1); // 1=頭の右 / -1=左
  const besideRef = useRef(false); // true=頭のよこ / false=頭の上
  const edgeRef = useRef(2); // 尻尾を出しているふち
  const topBandRef = useRef<Band[]>([]);
  const botBandRef = useRef<Band[]>([]);
  const coveredRef = useRef(false); // 引き出し/モーダルの暗幕が出ている
  const scanAtRef = useRef(0);
  const closingRef = useRef(false);
  const doneAtRef = useRef(0);
  // 輪郭パスは毎フレーム作ると文字列のごみが出るので、もとになる数値を覚えておいて
  // 変わったときだけ組み立て直す
  const lastRef = useRef({
    bx: NaN,
    by: NaN,
    vis: -1,
    w: -1,
    h: -1,
    tone: "" as string,
    e: -1,
    cx: NaN,
    cy: NaN,
    ux: NaN,
    uy: NaN,
    len: NaN,
  });

  /** 吹き出しより前面のUIの位置を測り、上/下の「使えない帯」にする */
  const scanUi = useCallback(() => {
    const view = viewRef.current;
    const top: Band[] = [];
    const bottom: Band[] = [];
    // .sb-layer は position:fixed の .game-root いっぱいなので、
    // ビューポート座標(getBoundingClientRect)がそのまま使える
    // 左右にも UI_GAP ぶん広げておく。よこに並んだときも隙間が残るし、
    // ぎりぎりまで寄ると(影が重なって)くっついて見える
    document.querySelectorAll<HTMLElement>(TOP_UI).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        top.push({
          x0: r.left - UI_GAP,
          x1: r.right + UI_GAP,
          edge: r.bottom + UI_GAP,
        });
      }
    });
    document.querySelectorAll<HTMLElement>(BOTTOM_UI).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        bottom.push({
          x0: r.left - UI_GAP,
          x1: r.right + UI_GAP,
          edge: view.h - r.top + UI_GAP,
        });
      }
    });
    topBandRef.current = top;
    botBandRef.current = bottom;
    coveredRef.current = document.querySelector(COVER_UI) !== null;
    scanAtRef.current = Date.now();
  }, []);

  /** 吹き出しの実寸と画面サイズをはかる(毎フレームのレイアウト読みを避ける) */
  const measure = useCallback(() => {
    const layer = layerRef.current;
    if (layer) {
      viewRef.current = { w: layer.clientWidth, h: layer.clientHeight };
    }
    const body = bodyRef.current;
    const textEl = textRef.current;
    if (body && body.offsetWidth > 0) {
      const cb = getComputedStyle(body);
      const w = body.offsetWidth;
      const h = body.offsetHeight;
      // 角の丸みは tone ごとに CSS が持っている。輪郭パスもそれに合わせる
      sizeRef.current = {
        w,
        h,
        r: parseRadius(cb.getPropertyValue("--sb-radius"), w, h),
      };

      // ── 1行に入る全角文字数(折り返しの幅) ──
      // 字の大きさは clamp、最大幅は min() で書いてあるので、CSSから読むのが確実。
      // 全角の文字は 1em ちょうどで並ぶので、幅 ÷ 送り幅 が そのまま文字数になる
      if (textEl) {
        const ct = getComputedStyle(textEl);
        const fs = parseFloat(ct.fontSize);
        const ls = parseFloat(ct.letterSpacing); // "normal" のときは NaN
        let maxW = parseFloat(cb.maxWidth); // min() は計算後の px で返る
        if (!(maxW > 0)) {
          maxW = Math.min(viewRef.current.w * MAX_W_VW, MAX_W_PX);
        }
        if (cb.boxSizing === "border-box") {
          maxW -=
            (parseFloat(cb.paddingLeft) || 0) + (parseFloat(cb.paddingRight) || 0);
        }
        const adv = fs + (Number.isFinite(ls) ? ls : 0); // 全角1文字ぶんの送り
        if (adv > 0 && maxW > 0) {
          const units =
            Math.max(5, Math.round((maxW / adv - WRAP_MARGIN) * 10) / 10);
          if (units !== wrapMaxRef.current) {
            wrapMaxRef.current = units;
            setWrapMax(units); // 折り直し → 下の useLayoutEffect で測り直す
          }
        }
      }
    }
    scanUi();
  }, [scanUi]);

  /** 位置・輪郭の再計算(rAFから毎フレーム。書き込みは変わったものだけ) */
  const layout = useCallback((force: boolean) => {
    const root = rootRef.current;
    const wrap = wrapRef.current;
    const body = bodyRef.current;
    const path = pathRef.current;
    const sp = speechRef.current;
    if (!root || !wrap || !body || !path || !sp) return;

    const a = speechAnchor;
    const last = lastRef.current;

    // 画面外/カメラの後ろ/暗幕の下では、そっと消す
    const vis = a.visible && !coveredRef.current ? 1 : 0;
    if (vis !== last.vis) {
      root.style.opacity = vis ? "1" : "0";
      last.vis = vis;
    }
    if (!vis && !force) return;

    const view = viewRef.current;
    // 遠いほど小さく。ただしそのままだと文字が読めなくなるので下限を上げる。
    // スマホでは字がもともと小さいので、縮小をさらに浅くする(15px x 0.95 = 14.3px)
    const narrow = view.w < 480;
    const s = clamp(0.62 + 0.38 * a.scale, narrow ? 0.95 : 0.85, narrow ? 1.06 : 1.12);
    const { w, h, r } = sizeRef.current;
    const gapY = sp.tone === "sleepy" ? GAP_Y_SLEEPY : TAIL_LEN;

    // ローカル単位(=画面px ÷ s)。吹き出しの中身はすべてこの単位で考える
    const nearW = w * SIDE_BIAS; // 頭より手前がわに出るぶん
    const farW = w - nearW; // 頭より向こうがわに伸びるぶん
    const clearX = (a.bodyW * 0.5 + SIDE_GAP) / s; // よこ置きで体をよける距離

    // 上下の「使えない帯」は、吹き出しの横はばと重なる相手だけを見る。
    // ところが横位置は「上に置くか、よこに置くか」を決めてからでないと出ない。
    // そこで2回にわける: まず いちばん広がったときの幅で置きかたを決め、
    // 決まったあとに **実際の横はば** で測り直してから、縦を詰める。
    // (スマホでは左右の角のUIに必ずかかるので、実質「上のバー全体」になる)
    const spanHalf = Math.max(farW, clearX + w) * s;
    const roomR = (view.w - EDGE - a.x) / s;
    const roomL = (a.x - EDGE) / s;
    const roomU0 =
      (a.y - bandOf(topBandRef.current, a.x - spanHalf, a.x + spanHalf, EDGE)) / s;

    // ── 置きかたを決める ────────────────────────────────
    // 1) 頭の上(いちばん自然)
    // 2) 上が詰まっていたら 頭のよこ。safe の寄りカメラのように、こすくまくんが
    //    画面の上ぎりぎりに来る場面がある。ここで「下」に出すと顔を隠してしまう
    // 3) よこも無理なら上へ押し込む(頭のてっぺんだけ隠れる。顔は隠さない)
    const needUp = gapY + h;
    const fitsUp = needUp <= roomU0;
    const fitsSideR = clearX + w <= roomR;
    const fitsSideL = clearX + w <= roomL;
    let beside = besideRef.current;
    if (!beside) {
      if (!fitsUp && (fitsSideR || fitsSideL)) beside = true;
    } else if (needUp + MODE_HYST <= roomU0 || (!fitsSideR && !fitsSideL)) {
      beside = false;
    }
    besideRef.current = beside;

    // 左右: 入りきらなくなったときだけ反対側へ(ヒステリシスでパタパタしない)
    let side = sideRef.current;
    const fitR = beside ? fitsSideR : farW <= roomR && nearW <= roomL;
    const fitL = beside ? fitsSideL : farW <= roomL && nearW <= roomR;
    if (side > 0 && !fitR && fitL) side = -1;
    else if (side < 0 && !fitL && fitR) side = 1;
    sideRef.current = side;

    // 本体の位置(アンカー基準・ローカル単位)。画面に入りきらないぶんは
    // 本体だけ内側へずらし、尻尾は向きだけ頭を指し続ける
    let bx = beside
      ? side > 0
        ? clearX
        : -(clearX + w)
      : side > 0
        ? -nearW
        : -farW;
    const maxBx = roomR - w;
    const minBx = -roomL;
    bx = maxBx < minBx ? -w / 2 : clamp(bx, minBx, maxBx);

    // 横位置が決まった。ここで **実際に占める横はば** で帯を測り直す。
    // 画面のはしへ寄せたぶん、見積もりより外へ出ていることがあるため
    const sx0 = a.x + bx * s;
    const sx1 = sx0 + w * s;
    const roomU = (a.y - bandOf(topBandRef.current, sx0, sx1, EDGE)) / s;
    const roomD = (view.h - bandOf(botBandRef.current, sx0, sx1, EDGE) - a.y) / s;

    // よこに出すときは、頭の高さに顔をならべる(目の高さで話しかける感じ)
    let by = beside ? -h * 0.5 : -(gapY + h);
    const maxBy = roomD - h;
    const minBy = -roomU;
    by = maxBy < minBy ? -h / 2 : clamp(by, minBy, maxBy);

    // ── 尻尾 ────────────────────────────────────────────
    // 頭は本体ローカルでどこにいるか(アンカーは .sb-root の原点)
    const hx = -bx;
    const hy = -by;
    // 尻尾を出すふちは「頭がいちばん張り出している側」。本体の縦横で正規化して
    // 比べるので、平たい吹き出しでも上下より左右が勝つ、ということがない
    const rx = (hx - w * 0.5) / (w * 0.5);
    const ry = (hy - h * 0.5) / (h * 0.5);
    let e = edgeRef.current;
    const wantH = Math.abs(rx) > Math.abs(ry) * (1 + EDGE_HYST);
    const wantV = Math.abs(ry) > Math.abs(rx) * (1 + EDGE_HYST);
    if (wantH) e = rx > 0 ? 1 : 3;
    else if (wantV) e = ry > 0 ? 2 : 0;
    edgeRef.current = e;

    const tail = solveTail(e, w, h, r, hx, hy);

    root.style.transform = `translate3d(${f(a.x)}px, ${f(a.y)}px, 0) scale(${s.toFixed(3)})`;

    if (force || Math.abs(bx - last.bx) > 0.4 || Math.abs(by - last.by) > 0.4) {
      wrap.style.transform = `translate3d(${f(bx)}px, ${f(by)}px, 0)`;
      last.bx = bx;
      last.by = by;
    }

    const tcx = tail ? tail.cx : NaN;
    const tcy = tail ? tail.cy : NaN;
    const tux = tail ? tail.ux : NaN;
    const tuy = tail ? tail.uy : NaN;
    const tlen = tail ? tail.len : NaN;
    if (
      force ||
      w !== last.w ||
      h !== last.h ||
      sp.tone !== last.tone ||
      e !== last.e ||
      !(Math.abs(tcx - last.cx) <= 0.4) ||
      !(Math.abs(tcy - last.cy) <= 0.4) ||
      !(Math.abs(tux - last.ux) <= 0.01) ||
      !(Math.abs(tuy - last.uy) <= 0.01) ||
      !(Math.abs(tlen - last.len) <= 0.4)
    ) {
      path.setAttribute("d", bubblePath(w, h, r, sp.tone, tail));
      // ぽんっと出るときの基点も尻尾の付け根に合わせる(頭から生えて見える)
      if (tail) body.style.transformOrigin = `${f(tail.cx)}px ${f(tail.cy)}px`;
      last.w = w;
      last.h = h;
      last.tone = sp.tone;
      last.e = e;
      last.cx = tcx;
      last.cy = tcy;
      last.ux = tux;
      last.uy = tuy;
      last.len = tlen;
    }
  }, []);

  // セリフが変わったら: 実寸をはかり直して、1フレーム目からズレずに出す
  useLayoutEffect(() => {
    speechRef.current = speech;
    if (!speech) return;
    closingRef.current = false;
    doneAtRef.current = 0;
    const root = rootRef.current;
    const body = bodyRef.current;
    if (body) body.classList.remove("sb-leave");
    if (root) root.style.display = "";
    lastRef.current.vis = -1; // 表示状態も引き直す
    measure();
    layout(true);
  }, [speech, measure, layout]);

  // 確認シートなどが出入りしたら、よけるUIを測り直す。
  // 描画前に直したいので useLayoutEffect(1フレームだけ かぶるのを防ぐ)。
  // 折り返しの幅(wrapMax)が変わったときも、行が変わるので実寸を測り直す
  useLayoutEffect(() => {
    measure();
    layout(true);
  }, [phase, wrapMax, measure, layout]);

  // フォント読み込み・画面回転で幅が変わる。そのときだけはかり直す
  useEffect(() => {
    const onResize = () => {
      measure();
      layout(true);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // 丸ゴシックは display:swap。差し替わると行幅が変わるので測り直す
    document.fonts?.ready.then(onResize).catch(() => {});
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [measure, layout]);

  // 追従ループ。ここでは transform と輪郭の直書きだけを行う
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sp = speechRef.current;
      const root = rootRef.current;
      if (!sp || !root) return;

      const now = Date.now();
      // フィードは数秒で増減し、引き出しはフェーズを変えずに開く。
      // どちらもDOMを読まないと分からないので、ゆっくり測り直す
      if (now - scanAtRef.current > SCAN_MS) scanUi();

      if (!closingRef.current && now > sp.until) {
        // 表示時間ぎれ → すっと消える
        closingRef.current = true;
        doneAtRef.current = now + OUT_MS;
        bodyRef.current?.classList.add("sb-leave");
      }
      if (closingRef.current) {
        if (now > doneAtRef.current) {
          root.style.display = "none";
          return; // 消えおわったら位置の更新も止める
        }
      }
      layout(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, scanUi]);

  return (
    // aria-live のために、セリフが無いときも入れ物は置いておく
    <div className="sb-layer" ref={layerRef} aria-live="polite" aria-atomic="true">
      {speech && (
        <div className="sb-root" ref={rootRef}>
          <div className="sb-wrap" ref={wrapRef}>
            <div
              key={speech.id}
              ref={bodyRef}
              className={`sb-body sb-${speech.tone}`}
            >
              {/* 輪郭(本体+尻尾)は、この1本のパスだけ。
                  SVGは四方に SHAPE_PAD ぶん広げてあるので、パスは本体ローカル
                  座標のまま書いて translate でずらす(filter に切られないため) */}
              <svg className="sb-shape" aria-hidden="true">
                <path
                  ref={pathRef}
                  d=""
                  transform={`translate(${SHAPE_PAD},${SHAPE_PAD})`}
                />
              </svg>
              {/* 改行は wrapJa が入れる。CSSは white-space:pre-wrap でそれを守るだけ */}
              <p className="sb-text" ref={textRef}>
                {shown}
              </p>

              {speech.tone === "sleepy" && (
                <span className="sb-zzz" aria-hidden="true">
                  <i>z</i>
                  <i>z</i>
                  <i>z</i>
                </span>
              )}
              {speech.tone === "happy" && (
                <svg
                  className="sb-spark"
                  viewBox="0 0 40 40"
                  width="40"
                  height="40"
                  aria-hidden="true"
                >
                  <path
                    className="sb-spark-a"
                    d="M27 3 L29.4 11.6 L38 14 L29.4 16.4 L27 25 L24.6 16.4 L16 14 L24.6 11.6 Z"
                  />
                  <path
                    className="sb-spark-b"
                    d="M12 18 L13.5 23.5 L19 25 L13.5 26.5 L12 32 L10.5 26.5 L5 25 L10.5 23.5 Z"
                  />
                </svg>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
