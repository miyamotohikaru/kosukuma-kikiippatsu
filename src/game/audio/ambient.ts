"use client";

// 宇宙アンビエント。デチューンした三角波2基のパッド(ゆっくり呼吸するローパス)と、
// まれに鳴る「星のピング音」(ランダム12〜25秒間隔、パンを散らす)。
// sfx.ts のオーディオグラフ(ambientBus)に接続する。音量はSFXよりはるかに小さく。

import { getAudioGraph, type AudioGraph } from "./sfx";

/** パッドの目標音量。SFX(ピーク0.1〜0.6)に対して十分小さく */
const PAD_GAIN = 0.045;

/** 星のピング音の音階(Cメジャーペンタトニック高域) */
const PING_NOTES: readonly number[] = [
  1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0,
];

interface PadNodes {
  oscs: OscillatorNode[];
  lfo: OscillatorNode;
  amp: GainNode;
}

let pad: PadNodes | null = null;
let pingTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** アンビエント開始。initAudio() 前に呼ばれた場合は何もしない */
export function startAmbient(): void {
  const g = getAudioGraph();
  if (!g || running) return;
  running = true;
  startPad(g);
  schedulePing(g);
}

/** アンビエント停止(フェードアウトしてから音源を止める) */
export function stopAmbient(): void {
  if (!running) return;
  running = false;
  if (pingTimer) {
    clearTimeout(pingTimer);
    pingTimer = null;
  }
  const g = getAudioGraph();
  if (pad && g) {
    const t = g.ctx.currentTime;
    pad.amp.gain.cancelScheduledValues(t);
    pad.amp.gain.setTargetAtTime(0.0001, t, 0.25);
    for (const o of pad.oscs) o.stop(t + 1.5);
    pad.lfo.stop(t + 1.5);
  }
  pad = null;
}

// ── 宇宙パッド ─────────────────────────────────────────

function startPad(g: AudioGraph): void {
  const { ctx } = g;
  const t = ctx.currentTime;

  // ゆっくり立ち上がる全体ゲイン
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(PAD_GAIN, t + 4);

  // 呼吸するローパス(LFOでカットオフを揺らす)
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 240;
  filter.Q.value = 0.7;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.055; // 約18秒で一呼吸
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 120; // 240Hz ± 120Hz
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.frequency);

  // デチューンした三角波2基(左右に少し開いてうねりを作る)
  const spec: ReadonlyArray<readonly [number, number]> = [
    [-9, -0.35], // [デチューン(cent), パン]
    [+9, +0.35],
  ];
  const oscs: OscillatorNode[] = [];
  for (const [det, panV] of spec) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 110; // A2
    o.detune.value = det;
    let out: AudioNode = o;
    if (typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = panV;
      o.connect(p);
      out = p;
    }
    out.connect(filter);
    o.start(t);
    oscs.push(o);
  }

  filter.connect(amp);
  amp.connect(g.ambientBus);
  lfo.start(t);
  pad = { oscs, lfo, amp };
}

// ── 星のピング音 ───────────────────────────────────────

function schedulePing(g: AudioGraph): void {
  const wait = 12000 + Math.random() * 13000; // 12〜25秒
  pingTimer = setTimeout(() => {
    if (!running) return;
    if (g.ctx.state === "running") playPing(g);
    schedulePing(g);
  }, wait);
}

function playPing(g: AudioGraph): void {
  const { ctx } = g;
  const t = ctx.currentTime;
  const freq = PING_NOTES[Math.floor(Math.random() * PING_NOTES.length)];
  const panV = (Math.random() * 2 - 1) * 0.8;

  // 基音 + かすかな非整数倍音(遠くの星の瞬き)
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const shimmer = ctx.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.value = freq * 3.01;
  const shimmerAmp = ctx.createGain();
  shimmerAmp.gain.value = 0.12;
  shimmer.connect(shimmerAmp);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  osc.connect(amp);
  shimmerAmp.connect(amp);

  let out: AudioNode = amp;
  if (typeof ctx.createStereoPanner === "function") {
    const p = ctx.createStereoPanner();
    p.pan.value = panV;
    amp.connect(p);
    out = p;
  }
  out.connect(g.ambientBus);

  // 宇宙の残響(ディレイセンドへ多めに送る)
  const send = ctx.createGain();
  send.gain.value = 0.7;
  amp.connect(send);
  send.connect(g.delaySend);

  osc.start(t);
  osc.stop(t + 1.5);
  shimmer.start(t);
  shimmer.stop(t + 1.5);
}
