"use client";

// WebAudio合成による全SFX。音声ファイルは一切使わず、コードだけで鳴らす。
// 「ピコピコ安物」にしないための道具立て:
//   - exponentialRamp のエンベロープ(アタック/ディケイ)
//   - バンドパス/ローパスのスイープ(ヒュッ・シャキーン系)
//   - 共有ノイズバッファ(打撃・シンバル・噴射)
//   - 倍音を重ねたベル音色(ファンファーレ・トロフィー・オルゴール)
//   - FeedbackDelay 風のセンドバス(キラキラの余韻)
//
// グラフ:
//   音源 → sfxBus / ambientBus ─→ master(ミュート制御) → コンプレッサ → 出力
//   音源 --(send)--> delaySend → delay ⇄ feedback → wet → master

import { EARTH_BOOM_CLICKS } from "@/lib/config";

/** 環境音バスの既定ゲイン(爆発時のダッキングで一時的に下げて、ここへ戻す) */
const AMBIENT_BUS_GAIN = 0.9;

/** 初期化済みオーディオグラフ。ambient.ts もここに接続する */
export interface AudioGraph {
  ctx: AudioContext;
  /** ミュート制御対象。全音がここを通る */
  master: GainNode;
  /** SFX用バス */
  sfxBus: GainNode;
  /** 環境音用バス(SFXよりずっと小さく運用する) */
  ambientBus: GainNode;
  /** FeedbackDelay風エコーへのセンド入力 */
  delaySend: GainNode;
  /** 共有ホワイトノイズ(1.5秒) */
  noise: AudioBuffer;
}

let graph: AudioGraph | null = null;

/**
 * AudioContext を生成/再開する。**必ずユーザージェスチャ内で呼ぶこと**。
 * 2回目以降は既存グラフを返す(suspendedなら resume を試みる)。
 */
export function initAudio(): AudioGraph | null {
  if (graph) {
    if (graph.ctx.state === "suspended") void graph.ctx.resume();
    return graph;
  }
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;

  const ctx = new AC();

  // ── マスターチェーン: master → コンプレッサ → 出力 ──
  const master = ctx.createGain();
  master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; // 重なった瞬間だけ軽く潰してクリッピング防止
  comp.knee.value = 24;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master.connect(comp);
  comp.connect(ctx.destination);

  // ── バス ──
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);
  const ambientBus = ctx.createGain();
  ambientBus.gain.value = AMBIENT_BUS_GAIN; // 個々の環境音はさらに極小ゲインで鳴らす
  ambientBus.connect(master);

  // ── FeedbackDelay風エコー(キラキラ系の余韻) ──
  const delaySend = ctx.createGain();
  delaySend.gain.value = 1;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.27;
  const delayTone = ctx.createBiquadFilter(); // 反復のたびに丸くなる
  delayTone.type = "lowpass";
  delayTone.frequency.value = 3200;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  delaySend.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);

  // ── 共有ノイズバッファ ──
  const noise = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * 1.5),
    ctx.sampleRate
  );
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  graph = { ctx, master, sfxBus, ambientBus, delaySend, noise };
  if (ctx.state === "suspended") void ctx.resume();
  return graph;
}

/** 初期化済みグラフ(ambient.ts が使う)。未初期化なら null */
export function getAudioGraph(): AudioGraph | null {
  return graph;
}

/** AudioContext が生成済みか */
export function isAudioReady(): boolean {
  return graph !== null;
}

/** ミュート即時反映。マスターGainを短いランプで0/1へ(クリック音防止) */
export function setMuted(muted: boolean): void {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.master.gain.cancelScheduledValues(t);
  graph.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.015);
}

/** タブ非表示時に呼ぶ */
export function suspendAudio(): void {
  if (graph && graph.ctx.state === "running") void graph.ctx.suspend();
}

/** タブ復帰時に呼ぶ */
export function resumeAudio(): void {
  if (graph && graph.ctx.state === "suspended") void graph.ctx.resume();
}

// ══════════════════════════════════════════════════════
// 内部ヘルパー
// ══════════════════════════════════════════════════════

/** 再生できる状態のグラフ。suspended中は音を積まない(復帰時の音塊防止) */
function ready(): AudioGraph | null {
  return graph && graph.ctx.state === "running" ? graph : null;
}

/**
 * 発音が終わった瞬間に、その音のために作ったノードを全部切り離す。
 * remote-stab / earth-tap は何百回も鳴るので、切らないとグラフに残り続けて
 * タブが重くなる(耳には影響しない。停止時刻には既に無音まで減衰済み)。
 */
function disposeOnEnd(
  src: AudioScheduledSourceNode,
  nodes: readonly AudioNode[]
): void {
  src.onended = () => {
    src.disconnect();
    for (const n of nodes) n.disconnect();
  };
}

/**
 * pan≠0 なら StereoPanner を dest の手前に挟み、音源の接続先を返す。
 * 作ったノードは trash に積んで、鳴り終わりに切り離せるようにする。
 */
function withPan(
  g: AudioGraph,
  dest: AudioNode,
  pan: number | undefined,
  trash?: AudioNode[]
): AudioNode {
  if (!pan || typeof g.ctx.createStereoPanner !== "function") return dest;
  const p = g.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  trash?.push(p);
  return p;
}

/** エンベロープ後の信号をディレイセンドへ分岐 */
function tapSend(
  g: AudioGraph,
  from: AudioNode,
  amount: number | undefined,
  trash?: AudioNode[]
) {
  if (!amount) return;
  const s = g.ctx.createGain();
  s.gain.value = amount;
  from.connect(s);
  s.connect(g.delaySend);
  trash?.push(s);
}

interface ThrottleOpts {
  /** これより短い間隔で届いた発音は捨てる(秒) */
  minGap: number;
  /** window秒のあいだにこの数を超えたら、音量を落としはじめる */
  soft: number;
  /** window秒のあいだにこの数を超えたら floor まで落としきる */
  hard: number;
  /** 落としきったときの音量倍率。0 なら鳴らさない */
  floor: number;
  /** 数える時間窓(秒) */
  window?: number;
}

/**
 * 連打ガード。呼ぶたびに「この発音に掛ける音量倍率」を返す(0 = 間引く)。
 * 同時発音数の上限がわりで、短時間に音が積み上がって濁る/うるさくなるのを防ぐ。
 * 記録するのは実際に鳴らした時刻だけなので、間引いた分で間隔がずれない。
 */
function makeThrottle(o: ThrottleOpts): (now: number) => number {
  const win = o.window ?? 1;
  const times: number[] = [];
  return (now: number): number => {
    const last = times[times.length - 1];
    if (last !== undefined && now - last < o.minGap) return 0;
    while (times.length > 0 && now - times[0] > win) times.shift();
    const n = times.length; // 直近 win 秒に鳴った数
    times.push(now);
    if (n < o.soft) return 1;
    if (n >= o.hard) return o.floor;
    return 1 - (1 - o.floor) * ((n - o.soft) / (o.hard - o.soft));
  };
}

/**
 * 環境音を一時的に沈める(爆発の下を空けるため)。
 * ambientBus を直接いじるので ambient.ts とは循環参照にならない。
 */
function duckAmbient(
  g: AudioGraph,
  depth: number,
  hold: number,
  release: number
): void {
  const t = g.ctx.currentTime;
  const gain = g.ambientBus.gain;
  const low = AMBIENT_BUS_GAIN * depth;
  gain.cancelScheduledValues(t);
  gain.setValueAtTime(gain.value, t);
  gain.linearRampToValueAtTime(low, t + 0.08); // すっと引く
  gain.setValueAtTime(low, t + hold);
  gain.linearRampToValueAtTime(AMBIENT_BUS_GAIN, t + hold + release); // ゆっくり戻す
}

interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** スイープ先周波数(sweepTime かけて exponentialRamp) */
  sweepTo?: number;
  sweepTime?: number;
}

function makeFilter(g: AudioGraph, o: FilterOpts, t0: number): BiquadFilterNode {
  const f = g.ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t0);
  if (o.sweepTo !== undefined) {
    f.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + (o.sweepTime ?? 0.2));
  }
  if (o.q !== undefined) f.Q.value = o.q;
  return f;
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** [t0からの秒, 周波数] の列でグリッサンド */
  glide?: ReadonlyArray<readonly [number, number]>;
  /** 発音開始のオフセット秒 */
  at?: number;
  attack?: number;
  /** ピークから無音までの秒 */
  decay: number;
  peak: number;
  detune?: number;
  filter?: FilterOpts;
  /** ディレイセンド量 0..1 */
  send?: number;
  pan?: number;
  bus?: AudioNode;
}

/** オシレータ1本 + エンベロープ(+フィルタ/パン/センド) */
function tone(o: ToneOpts): void {
  const g = ready();
  if (!g) return;
  const t0 = g.ctx.currentTime + (o.at ?? 0);
  const attack = o.attack ?? 0.004;

  const osc = g.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.glide) {
    for (const [dt, f] of o.glide) {
      osc.frequency.exponentialRampToValueAtTime(f, t0 + dt);
    }
  }
  if (o.detune) osc.detune.value = o.detune;

  const amp = g.ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(o.peak, t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + o.decay);

  const trash: AudioNode[] = [amp];
  let src: AudioNode = osc;
  if (o.filter) {
    const f = makeFilter(g, o.filter, t0);
    src.connect(f);
    src = f;
    trash.push(f);
  }
  src.connect(amp);
  amp.connect(withPan(g, o.bus ?? g.sfxBus, o.pan, trash));
  tapSend(g, amp, o.send, trash);

  osc.start(t0);
  osc.stop(t0 + attack + o.decay + 0.05);
  disposeOnEnd(osc, trash);
}

interface NoiseOpts {
  at?: number;
  attack?: number;
  decay: number;
  peak: number;
  filter?: FilterOpts;
  send?: number;
  pan?: number;
  bus?: AudioNode;
}

/** ノイズバースト + エンベロープ(+フィルタ/パン/センド) */
function noiseHit(o: NoiseOpts): void {
  const g = ready();
  if (!g) return;
  const t0 = g.ctx.currentTime + (o.at ?? 0);
  const attack = o.attack ?? 0.003;

  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true; // 長い減衰でも途切れないように

  const amp = g.ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(o.peak, t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + o.decay);

  const trash: AudioNode[] = [amp];
  let head: AudioNode = src;
  if (o.filter) {
    const f = makeFilter(g, o.filter, t0);
    head.connect(f);
    head = f;
    trash.push(f);
  }
  head.connect(amp);
  amp.connect(withPan(g, o.bus ?? g.sfxBus, o.pan, trash));
  tapSend(g, amp, o.send, trash);

  src.start(t0);
  src.stop(t0 + attack + o.decay + 0.05);
  disposeOnEnd(src, trash);
}

interface BellOpts {
  freq: number;
  at?: number;
  peak: number;
  decay: number;
  /** [倍音比, 相対音量] の列。省略時は明るいベル */
  partials?: ReadonlyArray<readonly [number, number]>;
  send?: number;
  pan?: number;
}

/** 倍音を重ねたベル。高い倍音ほど速く減衰させて金属感を出す */
function bell(o: BellOpts): void {
  const partials = o.partials ?? [
    [1, 1],
    [2, 0.4],
    [3, 0.15],
  ];
  for (const [ratio, amp] of partials) {
    tone({
      type: "sine",
      freq: o.freq * ratio,
      at: o.at,
      attack: 0.002,
      decay: ratio > 2 ? o.decay / 1.8 : o.decay,
      peak: o.peak * amp,
      send: o.send,
      pan: o.pan,
    });
  }
}

// ══════════════════════════════════════════════════════
// 公開SFX
// ══════════════════════════════════════════════════════

/** まるいポップ音(ボタン押下など汎用UI) */
export function uiTap(): void {
  if (!ready()) return;
  tone({ type: "sine", freq: 520, glide: [[0.07, 800]], decay: 0.12, peak: 0.2 });
  tone({ type: "triangle", freq: 1560, attack: 0.002, decay: 0.05, peak: 0.05 });
}

/** ごく小さいクリック(穴ホバー) */
export function hover(): void {
  if (!ready()) return;
  noiseHit({
    attack: 0.001,
    decay: 0.03,
    peak: 0.05,
    filter: { type: "highpass", freq: 3800 },
  });
  tone({ type: "sine", freq: 1900, attack: 0.001, decay: 0.03, peak: 0.03 });
}

/** シャキーン: 高域へ抜けるスイープ + キラの2音 */
export function swordRaise(): void {
  if (!ready()) return;
  noiseHit({
    attack: 0.01,
    decay: 0.26,
    peak: 0.16,
    filter: { type: "bandpass", freq: 1400, q: 5, sweepTo: 7400, sweepTime: 0.22 },
    send: 0.3,
  });
  // 金属のエッジ
  tone({
    type: "sawtooth",
    freq: 1244.5,
    attack: 0.005,
    decay: 0.12,
    peak: 0.05,
    filter: { type: "highpass", freq: 1800 },
  });
  // キラ
  tone({ type: "sine", freq: 2793.8, at: 0.12, decay: 0.5, peak: 0.07, send: 0.55, pan: -0.2 });
  tone({ type: "sine", freq: 3520.0, at: 0.16, decay: 0.55, peak: 0.06, send: 0.6, pan: 0.25 });
}

/** ヒュッ: バンドパスを下降スイープするノイズ */
export function thrust(): void {
  if (!ready()) return;
  noiseHit({
    attack: 0.012,
    decay: 0.17,
    peak: 0.3,
    filter: { type: "bandpass", freq: 3400, q: 1.4, sweepTo: 320, sweepTime: 0.16 },
  });
}

/** ドスッ: 低いサインのピッチ落ち + ノイズバースト */
export function impact(): void {
  if (!ready()) return;
  tone({ type: "sine", freq: 135, glide: [[0.2, 40]], attack: 0.003, decay: 0.3, peak: 0.6 });
  noiseHit({
    decay: 0.11,
    peak: 0.35,
    filter: { type: "lowpass", freq: 850, sweepTo: 160, sweepTime: 0.1 },
  });
  // 打撃のエッジ
  noiseHit({ decay: 0.03, peak: 0.1, filter: { type: "highpass", freq: 2500 } });
}

// ── remote-stab: 世界のどこかで、誰かが刺した ─────────
//
// 狙い: 上の impact()「ドスッ(自分)」に対する「コッ…(遠くの誰か)」。
// 距離の作り方は4つ:
//   1. 音量   芯 0.6 → 0.11。約 -15dB で、自分の刺しとは絶対に混同しない。
//   2. 帯域   低音の芯を切って 300Hz 付近へ持ち上げる。遠い音は低域が届かない
//             ぶん「小さいもの」に聞こえる。スマホのスピーカーで消えない帯域でもある。
//   3. 時間   アタックを 0.003→0.008 に鈍らせ、高域をローパスで落とす。
//             尖った立ち上がりが空気に舐められた = 遠さの一番強い手がかり。
//   4. 空間   ディレイセンドで向こう側の広さを足す。ただし送るのは主に高域。
//             低い成分を共有ディレイ(270ms/feedback0.34)へ多く送ると、
//             何本も届いたときに反復が積もって必ず濁る。
// 濁り対策: ピッチを±8%、パンを左右いっぱいに散らす。何本重なっても
// 同じ音の連打にならず、中央に団子ができない。届きすぎた分は間引く。
const remoteThrottle = makeThrottle({
  minGap: 0.07, // これより詰まると1発に聞こえるだけなので捨てる
  soft: 3,
  hard: 8,
  floor: 0, // 世界が沸いている時は、鳴らしきらずに落とす
});

/** コッ…: 遠くの誰かの刺し。impact のずっと小さく・遠い版 */
export function remoteStab(): void {
  const g = ready();
  if (!g) return;
  const v = remoteThrottle(g.ctx.currentTime);
  if (v <= 0) return;

  const r = 0.92 + Math.random() * 0.16; // ピッチゆらぎ(±8%)
  const pan = (Math.random() * 2 - 1) * 0.65; // 方向 = 世界のどこか

  // 芯。遠いので低くは沈まず、短く丸く落ちる
  tone({
    type: "sine",
    freq: 300 * r,
    glide: [[0.1, 156 * r]],
    attack: 0.008,
    decay: 0.17,
    peak: 0.11 * v,
    filter: { type: "lowpass", freq: 1500 },
    send: 0.24, // 低域は控えめに(積もらせない)
    pan,
  });
  // 月の土のざらつき。高域は距離で失われた前提で 780Hz 中心
  noiseHit({
    attack: 0.006,
    decay: 0.08,
    peak: 0.05 * v,
    filter: {
      type: "bandpass",
      freq: 780 * r,
      q: 1.1,
      sweepTo: 300 * r,
      sweepTime: 0.07,
    },
    send: 0.18,
    pan,
  });
  // 「剣だ」と分かる、ごく小さな金属の残り香。
  // 高域なので何発重なっても低域を濁さず、遠いきらめきの層になる
  tone({
    type: "sine",
    freq: 2400 * r,
    at: 0.012,
    attack: 0.002,
    decay: 0.1,
    peak: 0.017 * v,
    send: 0.55,
    pan: pan * 0.7,
  });
}

// ── suspense: ドクン…ドクン…の心拍ループ ─────────────

let heartTimer: ReturnType<typeof setTimeout> | null = null;
let heartActive = false;

/** 心拍1発(ドッ)。strength で「ドッ/クン」の強弱をつける */
function heartThump(at: number, strength: number): void {
  tone({
    type: "sine",
    freq: 62,
    glide: [[0.09, 38]],
    at,
    attack: 0.005,
    decay: 0.16,
    peak: 0.5 * strength,
  });
  noiseHit({
    at,
    decay: 0.05,
    peak: 0.12 * strength,
    filter: { type: "lowpass", freq: 300 },
  });
}

/** 心拍ループ開始(だんだん速くなる)。多重呼び出しは無視 */
export function startSuspense(): void {
  if (heartActive) return;
  heartActive = true;
  let interval = 0.95;
  const beat = () => {
    if (!heartActive) return;
    heartThump(0, 1); // ドッ
    heartThump(0.17, 0.6); // クン
    interval = Math.max(0.55, interval * 0.93); // 緊張が高まる
    heartTimer = setTimeout(beat, interval * 1000);
  };
  beat();
}

/** 心拍ループ停止 */
export function stopSuspense(): void {
  heartActive = false;
  if (heartTimer) {
    clearTimeout(heartTimer);
    heartTimer = null;
  }
}

/** ほっ: 下降2音 + ため息風ノイズ */
export function safe(): void {
  if (!ready()) return;
  tone({
    type: "triangle",
    freq: 659.25, // E5
    decay: 0.28,
    peak: 0.15,
    filter: { type: "lowpass", freq: 2200 },
    send: 0.2,
  });
  tone({
    type: "triangle",
    freq: 523.25, // C5
    at: 0.15,
    decay: 0.4,
    peak: 0.14,
    filter: { type: "lowpass", freq: 2000 },
    send: 0.2,
  });
  // ため息
  noiseHit({
    at: 0.1,
    attack: 0.09,
    decay: 0.5,
    peak: 0.06,
    filter: { type: "lowpass", freq: 1400, sweepTo: 350, sweepTime: 0.5 },
  });
}

/** ジャーン: 明るい和音のストラム + シンバル風ノイズ(当たりの瞬間) */
export function winFlash(): void {
  if (!ready()) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    tone({
      type: "sawtooth",
      freq: f,
      at: i * 0.025,
      attack: 0.01,
      decay: 1.0,
      peak: 0.1,
      filter: { type: "lowpass", freq: 2600, q: 0.7 },
      send: 0.35,
      pan: (i - 1.5) * 0.15,
    });
  });
  noiseHit({
    attack: 0.005,
    decay: 1.2,
    peak: 0.2,
    filter: { type: "highpass", freq: 5200 },
    send: 0.3,
  });
  // 底を支えるドン
  tone({ type: "sine", freq: 98, glide: [[0.3, 60]], decay: 0.45, peak: 0.25 });
}

/** ロケット発射: ノイズのローパスが開いて閉じる + 上昇グリッサンド + 地響き */
export function launch(): void {
  const g = ready();
  if (!g) return;
  const t0 = g.ctx.currentTime;

  // 噴射(ローパスの開き→減衰)
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const f = g.ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(160, t0);
  f.frequency.exponentialRampToValueAtTime(5200, t0 + 2.6);
  f.frequency.exponentialRampToValueAtTime(700, t0 + 4.6);
  const amp = g.ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.34, t0 + 0.7);
  amp.gain.setValueAtTime(0.34, t0 + 2.8);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.8);
  src.connect(f);
  f.connect(amp);
  amp.connect(g.sfxBus);
  src.start(t0);
  src.stop(t0 + 5);

  // 上昇グリッサンド(2声)
  tone({
    type: "sawtooth",
    freq: 85,
    glide: [[3.2, 900]],
    attack: 0.5,
    decay: 3.6,
    peak: 0.06,
    filter: { type: "lowpass", freq: 400, sweepTo: 2400, sweepTime: 3.2 },
    send: 0.25,
  });
  tone({ type: "sine", freq: 170, glide: [[3.2, 1800]], attack: 0.6, decay: 3.4, peak: 0.05, send: 0.4 });

  // 地響き
  tone({ type: "sine", freq: 42, glide: [[1.8, 30]], attack: 0.05, decay: 2.0, peak: 0.22 });
}

/** パパパン: 破裂3連 + キラキラ高音の散らし(上空の花火) */
export function fireworks(): void {
  if (!ready()) return;
  const bursts: ReadonlyArray<readonly [number, number]> = [
    [0, -0.45],
    [0.17, 0.4],
    [0.33, -0.05],
  ];
  for (const [at, pan] of bursts) {
    noiseHit({
      at,
      decay: 0.22,
      peak: 0.32,
      filter: { type: "bandpass", freq: 1400, q: 0.9, sweepTo: 240, sweepTime: 0.2 },
      pan,
    });
    tone({ type: "sine", freq: 180, glide: [[0.12, 62]], at, decay: 0.18, peak: 0.24, pan });
  }
  // キラキラの散らし
  for (let i = 0; i < 11; i++) {
    tone({
      type: "sine",
      freq: 1600 + Math.random() * 2800,
      at: 0.15 + Math.random() * 1.0,
      attack: 0.002,
      decay: 0.3 + Math.random() * 0.35,
      peak: 0.028 + Math.random() * 0.025,
      pan: (Math.random() * 2 - 1) * 0.8,
      send: 0.6,
    });
  }
}

/** 勝利ファンファーレ: I-IV-V-I のベルアルペジオ(約2秒) */
export function fanfare(): void {
  if (!ready()) return;
  const chords: ReadonlyArray<{
    at: number;
    notes: readonly number[];
    decay: number;
    peak: number;
  }> = [
    { at: 0, notes: [523.25, 659.25, 783.99], decay: 0.5, peak: 0.16 }, // C (I)
    { at: 0.42, notes: [523.25, 698.46, 880.0], decay: 0.5, peak: 0.16 }, // F (IV)
    { at: 0.84, notes: [587.33, 783.99, 987.77], decay: 0.55, peak: 0.17 }, // G (V)
    { at: 1.26, notes: [523.25, 659.25, 783.99, 1046.5], decay: 1.3, peak: 0.2 }, // C (I)
  ];
  for (const c of chords) {
    c.notes.forEach((f, i) => {
      bell({
        freq: f,
        at: c.at + i * 0.06,
        peak: c.peak,
        decay: c.decay,
        send: 0.35,
        pan: (i - 1) * 0.2,
      });
    });
  }
  // ベースと締めのシンバル
  tone({ type: "triangle", freq: 130.81, decay: 0.4, peak: 0.12 });
  tone({ type: "triangle", freq: 174.61, at: 0.42, decay: 0.4, peak: 0.12 });
  tone({ type: "triangle", freq: 196.0, at: 0.84, decay: 0.4, peak: 0.12 });
  tone({ type: "triangle", freq: 130.81, at: 1.26, decay: 1.0, peak: 0.14 });
  noiseHit({
    at: 1.26,
    attack: 0.01,
    decay: 1.1,
    peak: 0.1,
    filter: { type: "highpass", freq: 6000 },
    send: 0.3,
  });
}

/** キラーン: 倍音ベル(トロフィー授与) */
export function trophy(): void {
  if (!ready()) return;
  // グレースノート → 本命の順で「キ・ラーン」
  bell({ freq: 987.77, peak: 0.12, decay: 0.5, send: 0.5 });
  bell({
    freq: 1318.5,
    at: 0.09,
    peak: 0.24,
    decay: 1.5,
    partials: [
      [1, 1],
      [2.0, 0.4],
      [2.76, 0.22], // わずかに非整数倍音で金属感
      [5.4, 0.07],
    ],
    send: 0.6,
  });
  tone({ type: "sine", freq: 3951.1, at: 0.09, decay: 0.7, peak: 0.04, send: 0.7, pan: 0.3 });
}

/** オルゴール風4音モチーフ(新こすくまくん降臨) */
export function newRound(): void {
  if (!ready()) return;
  const motif: ReadonlyArray<readonly [number, number]> = [
    [783.99, 0], // G5
    [1046.5, 0.19], // C6
    [1318.5, 0.38], // E6
    [1568.0, 0.57], // G6
  ];
  motif.forEach(([f, at], i) => {
    bell({
      freq: f,
      at,
      peak: 0.14,
      decay: i === motif.length - 1 ? 1.2 : 0.7,
      partials: [
        [1, 1],
        [3.9, 0.12], // オルゴールの「チーン」成分
      ],
      send: 0.5,
      pan: (i - 1.5) * 0.25,
    });
  });
}

/** ぷぷっ: 柔らかい2音下降(クールダウン・先を越された等) */
export function error(): void {
  if (!ready()) return;
  tone({
    type: "triangle",
    freq: 392.0, // G4
    attack: 0.008,
    decay: 0.12,
    peak: 0.14,
    filter: { type: "lowpass", freq: 1000 },
  });
  tone({
    type: "triangle",
    freq: 311.1, // Eb4
    at: 0.13,
    attack: 0.008,
    decay: 0.16,
    peak: 0.13,
    filter: { type: "lowpass", freq: 900 },
  });
}

// ══════════════════════════════════════════════════════
// ごほうび(チャーム / スキン)
// ══════════════════════════════════════════════════════

/**
 * チリン: ちいさな鈴ひとつ(チャーム獲得、約0.6秒)。
 * 「シャリ」(鈴の中の玉)→「チ・リン」(2粒が半音ではなく完全4度で上がる)の順。
 * 非整数倍音(2.68 / 5.2倍)で金属の鈴らしさを作り、下に丸い triangle を
 * 一枚だけ敷いてスマホでも芯が残るようにしてある。
 * 音量ピークは合計 0.12 前後で、safe(0.15)より控えめ = 邪魔をしないごほうび。
 */
export function charmGet(): void {
  if (!ready()) return;
  // 鈴を振った瞬間の、金属のこすれ
  noiseHit({
    attack: 0.002,
    decay: 0.09,
    peak: 0.045,
    filter: { type: "bandpass", freq: 7200, q: 0.8 },
    send: 0.35,
    pan: -0.15,
  });
  // チ(G6)
  bell({
    freq: 1567.98,
    peak: 0.1,
    decay: 0.26,
    partials: [
      [1, 1],
      [2.68, 0.3],
      [5.2, 0.1],
    ],
    send: 0.5,
    pan: -0.12,
  });
  // リン(C7)。少し右で、長く残る
  bell({
    freq: 2093.0,
    at: 0.085,
    peak: 0.115,
    decay: 0.5,
    partials: [
      [1, 1],
      [2.74, 0.28],
      [5.4, 0.09],
    ],
    send: 0.62,
    pan: 0.16,
  });
  // 手のひらに乗った重み(高域だけだと薄い/耳に刺さるので)
  tone({
    type: "triangle",
    freq: 783.99, // G5
    attack: 0.004,
    decay: 0.14,
    peak: 0.055,
    filter: { type: "lowpass", freq: 2000 },
  });
}

/**
 * キラララ…キラーン: 剣のスキン解放(約1.2秒)。
 * charm-get より明確に「格上」に聞こえるよう、差を3つ作っている:
 *   - 下から駆け上がる(C6→E6→G6→C7)。charm-get は2粒だけで動かない。
 *   - 下に和音とサブ(C3/C4/G4)を置いて、体積を持たせる。
 *   - 上へ抜けるノイズのスイープ(1.6k→9kHz)で「開いた」空気を作る。
 * ピークは着地のベル 0.19。fanfare(0.2)を超えない = 勝利より上には出ない。
 */
export function skinUnlock(): void {
  if (!ready()) return;

  // 上へ抜ける空気。ゆっくり立ち上げて(0.17s)期待の「間」を作る
  noiseHit({
    attack: 0.17,
    decay: 0.45,
    peak: 0.07,
    filter: {
      type: "bandpass",
      freq: 1600,
      q: 0.9,
      sweepTo: 9000,
      sweepTime: 0.42,
    },
    send: 0.35,
  });

  // 駆け上がる3音。左→中→右へ動かして、上がっていく感じを空間でも出す
  const run: ReadonlyArray<readonly [number, number, number]> = [
    [1046.5, 0, -0.28], // C6
    [1318.5, 0.075, 0], // E6
    [1568.0, 0.15, 0.28], // G6
  ];
  for (const [f, at, pan] of run) {
    bell({
      freq: f,
      at,
      peak: 0.085,
      decay: 0.3,
      partials: [
        [1, 1],
        [2.76, 0.22],
        [5.4, 0.07],
      ],
      send: 0.4,
      pan,
    });
  }

  // 着地の「キラーン」(C7)。この音でいちばん高く、いちばん長い
  bell({
    freq: 2093.0,
    at: 0.26,
    peak: 0.19,
    decay: 1.0,
    partials: [
      [1, 1],
      [2.0, 0.34],
      [2.76, 0.2], // 非整数倍音 = 金属
      [5.4, 0.08],
    ],
    send: 0.66,
  });

  // 格の重み。着地と同時に下から支える(これが charm-get との一番の差)
  tone({
    type: "sine",
    freq: 130.81, // C3
    at: 0.24,
    attack: 0.01,
    decay: 0.55,
    peak: 0.1,
  });
  tone({
    type: "triangle",
    freq: 261.63, // C4
    at: 0.26,
    attack: 0.012,
    decay: 0.85,
    peak: 0.07,
    filter: { type: "lowpass", freq: 1200 },
  });
  tone({
    type: "triangle",
    freq: 392.0, // G4
    at: 0.29,
    attack: 0.012,
    decay: 0.8,
    peak: 0.055,
    filter: { type: "lowpass", freq: 1400 },
  });

  // 余韻に散るきらめき(剣の表面が光る粒)
  for (let i = 0; i < 5; i++) {
    tone({
      type: "sine",
      freq: 2600 + Math.random() * 2600,
      at: 0.36 + Math.random() * 0.5,
      attack: 0.002,
      decay: 0.3 + Math.random() * 0.3,
      peak: 0.024 + Math.random() * 0.014,
      pan: (Math.random() * 2 - 1) * 0.75,
      send: 0.7,
    });
  }
}

// ══════════════════════════════════════════════════════
// 地球イースターエッグ(つつく → 1000回で爆発)
// ══════════════════════════════════════════════════════

/** 進捗が渡されなかったときのフォールバック用カウンタ */
let earthTaps = 0;

// 1000回ぶん連打される音なので、耳の疲れないことを最優先に設計する:
//   - 波形はサイン中心。倍音がないので、何百回聞いても刺さらない
//   - ピーク合計 0.12 前後(safe=0.15 / impact=0.6 より小さい)
//   - decay 0.085秒。余韻を残さないので連打しても像が重ならない
//   - 1発ごとに左右を交互に振る。速い連打がステレオに分かれて団子にならない
//   - 連打中はディレイセンドを切る(送ると反復が溜まって必ず濁る)
const earthThrottle = makeThrottle({
  minGap: 0.042, // これ以上速いと人間の耳には1発。捨てる
  soft: 7,
  hard: 16,
  floor: 0.45, // つついた手応えは消さない。小さくするだけ
});

/**
 * ぽこっ: 遠くの地球をつついた。
 * @param count これまでのタップ数(1..EARTH_BOOM_CLICKS-1)。
 *   省略時は内部カウンタで代用する。
 *
 * 進捗の聞かせ方は3層:
 *   1. 基音が 430Hz から約1.4オクターブ上がる(1回あたり約2.4セント)。
 *      1発では分からないが、100回もつつけば「上がってきた」と分かる。
 *   2. 100回ごとに、ごく小さな倍音のきらめきを足す(道しるべ)。
 *   3. 72%を超えると足もとに低いうなりが育ちはじめる(爆発の予告)。
 */
export function earthTap(count?: number): void {
  const g = ready();
  if (!g) return;
  const v = earthThrottle(g.ctx.currentTime);
  if (v <= 0) return;

  earthTaps++;
  const n = count ?? earthTaps % EARTH_BOOM_CLICKS;
  const p = Math.min(1, Math.max(0, n / EARTH_BOOM_CLICKS));

  const base = 430 * Math.pow(2.62, p); // 430 → 1127Hz
  const pan = (earthTaps % 2 === 0 ? 0.2 : -0.2) + (Math.random() * 0.1 - 0.05);
  const busy = v < 1; // 連打中。余韻と残響を切って像を分ける
  const decay = busy ? 0.055 : 0.085;

  // 「ぽ」: 立ち上がりで完全5度だけ跳ね上がる(指ではじいた膜・水滴の音)
  tone({
    type: "sine",
    freq: base,
    glide: [[0.03, base * 1.5]],
    attack: 0.004, // クリックにならない程度に丸める
    decay,
    peak: 0.075 * v,
    pan,
    send: busy ? 0 : 0.12,
  });
  // 「こ」: 1オクターブ下の胴。小さいスピーカーでも存在が消えないように
  tone({
    type: "triangle",
    freq: base * 0.5,
    attack: 0.003,
    decay: decay * 0.7,
    peak: 0.03 * v,
    filter: { type: "lowpass", freq: 1500 },
    pan,
  });
  // 「っ」: 指先が触れた気配。帯域を絞ってあり、耳に刺さらない
  noiseHit({
    attack: 0.001,
    decay: 0.016,
    peak: 0.016 * v,
    filter: { type: "bandpass", freq: 3200, q: 1.2 },
    pan,
  });

  // 100回ごとの道しるべ。倍音がひとつ増えるだけの、控えめなごほうび
  if (n > 0 && n % 100 === 0) {
    tone({
      type: "sine",
      freq: base * 3,
      at: 0.045,
      attack: 0.002,
      decay: 0.32,
      peak: 0.05,
      send: 0.55,
      pan: -pan,
    });
    tone({
      type: "sine",
      freq: base * 4.5,
      at: 0.075,
      attack: 0.002,
      decay: 0.26,
      peak: 0.032,
      send: 0.6,
      pan,
    });
  }

  // 終盤の予告。104Hz のうなりが少しずつ育つ(爆発が近い、の合図)。
  // 連打中は v で絞り、余韻も切る。切らないと低音が重なって
  // ただの唸りっぱなしになり、耳が疲れる/コンプレッサが暴れる。
  if (p > 0.72) {
    const k = (p - 0.72) / 0.28;
    tone({
      type: "sine",
      freq: 104,
      glide: [[0.3, 72]],
      attack: 0.02,
      decay: busy ? 0.18 : 0.34,
      peak: (0.012 + 0.05 * k) * v,
      pan,
    });
  }
}

/**
 * ドオォン…パラパラ…✨: 地球が1000回目で爆発(約2.7秒)。
 * このゲームで一番派手な音。ただし「こわい音」にはしない:
 *   - 破裂の頭を 4.2kHz でローパス。ガラスが割れるような尖り方をさせない
 *   - 歪みもノコギリ波も使わない。芯はサイン、空気は帯域を絞ったノイズだけ
 *   - 0.5秒後にやわらかい長三和音(C-E-G-C)がふわっと開く。
 *     ここで「破壊」ではなく「おもちゃの花火」に意味が変わる
 *   - 尾はきらきらの粒と、引いていく地鳴りで終わる
 * 音量は例外的に既存より大きい(芯 0.62)。マスターのコンプレッサが
 * 重なった瞬間だけ潰すので、クリップはしない。
 */
export function earthBoom(): void {
  const g = ready();
  if (!g) return;
  const t0 = g.ctx.currentTime;

  // 轟音の下を空ける。環境音を 28% まで沈めて、ゆっくり戻す
  duckAmbient(g, 0.28, 0.5, 1.8);

  // ① パッ: 破裂の頭。明るいが、高域は 4.2kHz で止めて丸くする
  noiseHit({
    attack: 0.002,
    decay: 0.1,
    peak: 0.3,
    filter: { type: "lowpass", freq: 4200, sweepTo: 900, sweepTime: 0.12 },
  });

  // ② ドオォン: 芯。96→34Hz へ落ちる本体と、
  //    168→58Hz の一枚(小さいスピーカーでも「落ちた」と分かる中低域)
  tone({
    type: "sine",
    freq: 96,
    glide: [[0.5, 34]],
    attack: 0.012,
    decay: 1.7,
    peak: 0.62,
  });
  tone({
    type: "triangle",
    freq: 168,
    glide: [[0.35, 58]],
    attack: 0.008,
    decay: 0.8,
    peak: 0.2,
    filter: { type: "lowpass", freq: 900 },
  });

  // ③ ゴオォ: ふくらんで散っていく空気。
  //    ローパスが 2.6k→180Hz へ閉じるぶんだけ、音が遠ざかって聞こえる
  {
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const lp = g.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(2600, t0);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + 1.9);
    const amp = g.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(0.36, t0 + 0.05);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
    const send = g.ctx.createGain();
    send.gain.value = 0.2;
    src.connect(lp);
    lp.connect(amp);
    amp.connect(g.sfxBus);
    amp.connect(send);
    send.connect(g.delaySend);
    src.start(t0);
    src.stop(t0 + 2.5);
    disposeOnEnd(src, [lp, amp, send]);
  }

  // ④ 破片(パラパラ)。1.4秒かけて散らばり、左右いっぱいに広がる
  for (let i = 0; i < 16; i++) {
    noiseHit({
      at: 0.16 + Math.random() * 1.25,
      attack: 0.002,
      decay: 0.04 + Math.random() * 0.08,
      peak: 0.03 + Math.random() * 0.035,
      filter: {
        type: "bandpass",
        freq: 900 + Math.random() * 3200,
        q: 1.6,
      },
      pan: (Math.random() * 2 - 1) * 0.9,
      send: 0.25,
    });
  }

  // ⑤ かわいさの担保。ここで長三和音がふわっと開いて、
  //    「こわい爆発」から「おもちゃの花火」へ意味が変わる
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    bell({
      freq: f,
      at: 0.5 + i * 0.05,
      peak: 0.075,
      decay: 1.5,
      partials: [
        [1, 1],
        [2.0, 0.22],
        [3.9, 0.07],
      ],
      send: 0.55,
      pan: (i - 1.5) * 0.3,
    });
  });

  // ⑥ きらきらの余韻(破片が星になって散っていく)
  for (let i = 0; i < 12; i++) {
    tone({
      type: "sine",
      freq: 1500 + Math.random() * 3000,
      at: 0.45 + Math.random() * 1.5,
      attack: 0.002,
      decay: 0.35 + Math.random() * 0.4,
      peak: 0.022 + Math.random() * 0.018,
      pan: (Math.random() * 2 - 1) * 0.85,
      send: 0.7,
    });
  }

  // ⑦ 尾: 引いていく地鳴り。ゆっくり立ち上げて、最後に残る音にする
  tone({
    type: "sine",
    freq: 58,
    glide: [[2.2, 40]],
    attack: 0.25,
    decay: 2.2,
    peak: 0.11,
  });
}

// ══════════════════════════════════════════════════════
// こすくまくんに さわる / 待ち時間があける
// ══════════════════════════════════════════════════════

/**
 * つついたときの音階(半音)。メジャーペンタトニックなので、
 * どこで止めても不協和にならない。連打すると一段ずつ上がっていく。
 */
const POKE_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19] as const;
/** つつきの基音(G3)。剣や地球より1オクターブ低い = やわらかいものの音 */
const POKE_BASE = 196.0;
/** この時間あくと、音階は最初の段に戻る(秒) */
const POKE_STREAK_GAP = 1.1;

let pokeStep = 0;
let lastPokeAt = -99;

// 連打ガード。earth-tap ほど速くは押されないが、指を滑らせると連発するので
// 最低間隔だけは持たせる(音量は落としきらない = さわった手応えは必ず返す)
const pokeThrottle = makeThrottle({
  minGap: 0.06,
  soft: 5,
  hard: 11,
  floor: 0.5,
});

/**
 * ぽふっ: こすくまくんをつついた手応え。
 *
 * 地球の「ぽこっ」(硬い水滴)と混ざらないように、逆の作りにしてある:
 *   - 基音を1オクターブ下(196Hz付近)に置き、立ち上がりを 0.012秒 まで鈍らせる。
 *     角の取れた立ち上がり = やわらかいものに触れた音。
 *   - 芯のうしろにローパスで丸めたノイズを一枚だけ敷く(布と綿のこすれ)。
 *   - 倍音は 1オクターブ上の triangle が1本だけ。何度押しても耳が疲れない。
 * 連打すると POKE_STEPS を一段ずつのぼる。押しつづけると音が育つので、
 * 「反応が返ってきている」ことが音だけで分かる。
 */
export function kosukumaPoke(): void {
  const g = ready();
  if (!g) return;
  const v = pokeThrottle(g.ctx.currentTime);
  if (v <= 0) return;

  const now = g.ctx.currentTime;
  pokeStep =
    now - lastPokeAt < POKE_STREAK_GAP
      ? Math.min(pokeStep + 1, POKE_STEPS.length - 1)
      : 0;
  lastPokeAt = now;
  const base = POKE_BASE * Math.pow(2, POKE_STEPS[pokeStep] / 12);

  // 「ぽ」: 綿の詰まった胴。押されて一度だけ下へたわむ
  tone({
    type: "sine",
    freq: base,
    glide: [[0.09, base * 0.74]],
    attack: 0.012,
    decay: 0.17,
    peak: 0.09 * v,
    filter: { type: "lowpass", freq: 1500 },
  });
  // 「ふ」: 毛のこすれ。帯域を下に絞ってあるので、連打しても刺さらない
  noiseHit({
    attack: 0.005,
    decay: 0.06,
    peak: 0.026 * v,
    filter: { type: "lowpass", freq: 950, sweepTo: 320, sweepTime: 0.055 },
  });
  // 「っ」: 玩具のまるい響き。連打の音階はこの一粒が聞かせる
  tone({
    type: "triangle",
    freq: base * 2,
    at: 0.014,
    attack: 0.004,
    decay: 0.12,
    peak: 0.03 * v,
    filter: { type: "lowpass", freq: 2600 },
    send: 0.14,
  });
}

/**
 * ちりん、と ふたつ: つぎの1本が刺せるようになった合図(約0.7秒)。
 * charm-get(G6→C7 の鈴)より1オクターブ下の C6→F6 に置いて、
 * 「ごほうび」ではなく「順番が来た」と聞こえるようにしてある。
 * ピーク合計は 0.16 ほど。safe(0.15)と同じくらいで、通知として最小限。
 */
export function cooldownReady(): void {
  if (!ready()) return;
  bell({
    freq: 1046.5, // C6
    peak: 0.07,
    decay: 0.34,
    partials: [
      [1, 1],
      [2.9, 0.13],
    ],
    send: 0.42,
    pan: -0.1,
  });
  bell({
    freq: 1396.91, // F6
    at: 0.11,
    peak: 0.08,
    decay: 0.62,
    partials: [
      [1, 1],
      [2.96, 0.11],
    ],
    send: 0.55,
    pan: 0.1,
  });
  // 下に丸い芯を一枚。小さいスピーカーでも「鳴った」ことが分かる
  tone({
    type: "triangle",
    freq: 523.25, // C5
    attack: 0.006,
    decay: 0.17,
    peak: 0.05,
    filter: { type: "lowpass", freq: 1800 },
  });
}
