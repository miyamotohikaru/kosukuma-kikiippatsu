"use client";

// ゲーム全体の状態機械(zustand)。3Dシーン・UI・音はすべてここを読む。
// フェーズ遷移と演出タイミングの正はこのファイル。

import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  CHARMS,
  charmLevelOf,
  EARTH_CHARM_INDEX,
  NORMAL_CHARM_COUNT,
  COOLDOWN_SEC,
  SKY_CATCH_NEED,
  EARTH_BOOM_CLICKS,
  HOLE_COUNT,
  MAX_EQUIPPED_CHARMS,
  POKE_CHARM_INDEX,
  POKE_CHARM_NEED,
  NAME_MAX_LEN,
  SKY_CHARM_INDEX,
  SKY_KINDS,
  skyCharmLevelOf,
  POLL_MS,
  REMOTE_MAX,
  REMOTE_STAGGER,
  SWORD_COLORS,
  SWORD_SKINS,
  T_EARTH_BOOM,
  T_LAUNCH,
  T_NEW_ROUND,
  T_REMOTE_STAB,
  T_SAFE,
  T_SPEECH,
  T_STAB,
  T_SUSPENSE,
  T_TROPHY,
} from "@/lib/config";
import {
  base64ToMask,
  base64ToU16,
  base64ToU32,
  emptyMask,
  getBit,
  maskToBase64,
} from "@/lib/bitmask";
import {
  charmIndicesFor,
  charmOf,
  packCharmSet,
  packStyle,
  skinOf,
} from "@/lib/style";
import type {
  ClaimResponse,
  StabResult,
  StateResponse,
  WinnerInfo,
} from "@/lib/types";
import { emitGameEvent } from "./events";

export type Phase =
  | "boot" // 初回ロード中
  | "title" // タイトル画面
  | "idle" // 月を回して穴を選べる
  | "confirming" // 穴を選択して確認中
  | "stabbing" // 刺すアニメ中
  | "suspense" // 判定の「……」
  | "safe" // セーフ演出
  | "launch" // 発射カットシーン(勝者/観客共通)
  | "name-entry" // 勝者の名前入力
  | "trophy" // トロフィー授与式
  | "new-round"; // 新こすくまくん降臨

/** 発射カットシーンで表示する勝者情報 */
export interface LaunchInfo {
  roundNo: number; // 飛んだこすくまくんの代
  holeId: number;
  name: string | null;
  country: string | null;
  isMe: boolean;
}

interface Toast {
  id: number;
  msg: string;
}

/**
 * 他の人が刺した瞬間の再生キュー。ポーリングでマスクに増えたビットを見つけると
 * ここへ積まれ、`RemoteStabs` が「剣が降ってきて刺さる」までを演じる。
 * 演出中の穴は `Swords` 側では描かない(二重に見えないように)。
 */
export interface RemoteStab {
  holeId: number;
  /** SWORD_COLORS の index */
  color: number;
  /** SWORD_SKINS の index */
  skin: number;
  /** ぶら下がっているチャームの数(古い記録のとき用) */
  charm: number;
  /** ぶら下がっているチャーム(CHARMS の index)。これが正 */
  charms: number[];
  /** 再生開始時刻(epoch ms)。同時到着ぶんは REMOTE_STAGGER ずつずらす */
  startAt: number;
}

/** こすくまくんの吹き出し。表示はUI側(`SpeechBubble`)が読む */
export type SpeechTone = "normal" | "happy" | "worry" | "shock" | "sleepy";

export interface Speech {
  /** 同じ文でも言い直しを検知できるように毎回ふる連番 */
  id: number;
  text: string;
  tone: SpeechTone;
  /** この時刻(epoch ms)まで表示する */
  until: number;
}

interface GameState {
  phase: Phase;
  /** phase が変わった時刻(performance.now基準ではなく Date.now) */
  phaseAt: number;

  // ── サーバー状態(表示用) ──
  roundNo: number;
  stabCount: number;
  mask: Uint8Array;
  /** 各穴の剣の色(0=デフォルト金, 1..N=SWORD_COLORSのindex+1) */
  stabColors: Uint8Array;
  /** 各穴の剣のスキン+チャーム(詰め方は src/lib/style.ts)。0=情報なし */
  stabStyles: Uint16Array;
  /** 各穴の「つけていたチャームの一覧」(src/lib/style.ts)。0=記録なし */
  stabCharms: Uint32Array;
  recent: StateResponse["recent"];
  prevWinner: WinnerInfo | null;
  connected: boolean;
  /** いま「刺さる瞬間」を再生中の、他の人の剣 */
  remoteStabs: RemoteStab[];
  /**
   * `RemoteStabs` が実際に受け持った穴。**`Swords` が隠すのはこれだけ。**
   * 順番待ちの穴まで隠していたので、混んでいるとき(や自分のカットシーン中)に
   * 「誰も描かない穴」が生まれて、刺さっているはずの剣が消えて見えていた。
   */
  playingStabs: number[];

  // ── 自分の操作 ──
  selectedHole: number | null;
  hoveredHole: number | null;
  cooldownUntil: number; // epoch ms
  launchInfo: LaunchInfo | null;
  claimToken: string | null;
  claimRound: number | null;
  wonName: string | null; // 授与式で刻む名前
  toast: Toast | null;
  muted: boolean;
  ready3d: boolean; // 3Dアセット読み込み完了
  /** 選んでいる剣の色(SWORD_COLORSのindex)。localStorageに永続 */
  swordColor: number;
  /** 選んでいる剣のスキン(SWORD_SKINSのindex)。localStorageに永続 */
  swordSkin: number;
  /** この代に自分が刺した穴(この端末)。剣を光らせる目印にも使う */
  myStabs: number[];
  /** 自分の通算の刺し回数(この端末) */
  myTotal: number;
  /** 自分がこすくまくんを とばした回数(この端末)。スキン解放の条件 */
  myWins: number;
  /** 獲得したてのチャーム(CHARMSのindex)。演出が終わったら null に戻す */
  newCharm: number | null;
  /** 解放したてのスキン(SWORD_SKINSのindex配列)。表彰で見せる */
  newSkins: number[];

  // ── 地球イースターエッグ ──
  /** 地球をつついた回数(この端末) */
  earthClicks: number;
  /** 地球を爆発させた回数(この端末) */
  earthBooms: number;
  /**
   * 隠しチャーム「ちきゅう」を持っているか。地球を1000回つついて
   * こわした人だけが手に入れる。刺し本数では絶対に増えない。
   */
  hasEarthCharm: boolean;
  /**
   * いま剣につけているチャーム(CHARMS の index)。**持っている ≠ つけている**。
   * 既定は「持っているもの全部」。外したぶんは localStorage に残る。
   * 個数の上限はない(何個でもつけられる)。
   */
  equippedCharms: number[];
  /** 爆発した時刻(epoch ms)。null なら地球は無事 */
  earthBoomAt: number | null;

  /**
   * 月の向こうを横切るものを、通算で何こ つかまえたか。
   * チャームはこの数のしきい値(SKY_CATCH_NEED)で開く。
   */
  skyCatches: number;

  /**
   * つかまえた直後に、指のところへ出す小さな数字。
   * 「あと何回で開くか」を教えるためだけの、消えもの。
   * チャームが開いた回はファンファーレに任せるので null。
   */
  skyPop: { id: number; text: string } | null;

  /**
   * 開いた「空のチャーム」。SKY_KINDS の順に立てたビット。
   * **skyCatches から導くもので、単独では増やさない。**
   * 刺し本数では絶対に増えない。
   */
  caughtSky: number;

  /**
   * 左下のフィードに出す名前。未登録は null(「だれかが 刺した」のまま)。
   * 最初のタイトルで任意入力。刺すたびに送るので、変えれば次から反映される。
   */
  nickname: string | null;

  /**
   * これまでに流れてきた刺しの記録(新しい順・最大 FEED_LOG_MAX 件)。
   * サーバーが返すのは直近12件だけなので、見ているあいだのぶんを
   * この端末に貯めて「ぜんぶ みる」で読み返せるようにしている。
   */
  feedLog: StateResponse["recent"];

  /** こすくまくんを つついた回数(この端末) */
  pokeCount: number;
  /** つつきの隠しチャームを持っているか */
  hasPokeCharm: boolean;

  /** こすくまくんの吹き出し */
  speech: Speech | null;

  // ── actions ──
  init: () => void;
  start: () => void;
  setReady3d: () => void;
  hoverHole: (id: number | null) => void;
  selectHole: (id: number) => void;
  cancelSelect: () => void;
  confirmStab: () => Promise<void>;
  submitName: (name: string) => Promise<void>;
  showToast: (msg: string) => void;
  setMuted: (m: boolean) => void;
  setSwordColor: (c: number) => void;
  /** スキンを選ぶ。未解放(needWins > myWins)なら無視される */
  setSwordSkin: (s: number) => void;
  /** チャームのつけ外し。持っていないものは無視される */
  toggleCharm: (index: number) => void;
  /** その穴の演出を `RemoteStabs` が受け持った(`Swords` は描かない) */
  claimRemoteStab: (holeId: number) => void;
  /** 演出が終わった他人の剣を、通常の剣(Swords)へ引き渡す */
  endRemoteStab: (holeId: number) => void;
  /** チャーム獲得演出をとじる */
  clearNewCharm: () => void;
  /** 地球をつつく。EARTH_BOOM_CLICKS 回で爆発 */
  tapEarth: () => void;
  /**
   * 月の向こうを横切るものをつかまえた。kind は SKY_KINDS の index。
   * 数を1つ増やし、しきい値に届いたときだけチャームが開く。
   * (kind は「何をつかまえたか」の記録用。どのチャームが開くかは数で決まる)
   */
  catchSky: (kind: number) => void;
  /** ニックネームを決める。空文字なら未登録に戻す */
  setNickname: (name: string) => void;
  /** こすくまくんを つついた。POKE_CHARM_NEED 回で隠しチャームが開く */
  pokeKosukuma: () => void;
  /** こすくまくんにしゃべらせる */
  say: (text: string, tone?: SpeechTone, ms?: number) => void;
}

// ── localStorage helpers(SSR安全) ─────────────────────
const LS = {
  get(key: string): string | null {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private mode等は無視 */
    }
  },
  del(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

export function getFingerprint(): string {
  let fp = LS.get("kk-fp");
  if (!fp) {
    fp = nanoid(21);
    LS.set("kk-fp", fp);
  }
  return fp;
}

/**
 * デモ(?demo=watch): 「他の人が当てて、こすくまくんが飛んでいくのを見ている側」の
 * 画面をその場で再生する。サーバーには一切書き込まない(記録は残らない)。
 * ふだんはポーリングで roundNo が進んだのを見つけたときにだけ起きる画面なので、
 * ひとりで確認するには こうして呼び出す口が要る。
 */
function isDemoWatch(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "watch"
    );
  } catch {
    return false;
  }
}

/**
 * デモモード(?demo=win): 刺すと必ず「当たり」になり、発射〜トロフィー授与を
 * 体験できる。サーバーには一切書き込まない(記録は残らない)。
 */
function isDemoWin(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "win"
    );
  } catch {
    return false;
  }
}

const DEMO_TOKEN = "demo";

/**
 * ?demo=watch で流す「誰かが当てた直後」の偽スナップショット。
 * 本物のポーリング応答と同じ形にしておくと、あとの流れ(観客カットシーン →
 * 降臨 → idle)がそのまま本番の道を通る。サーバーへは書き込まない。
 */
function demoWatchState(cur: {
  roundNo: number;
  stabCount: number;
  recent: StateResponse["recent"];
}): StateResponse {
  const round = Math.max(1, cur.roundNo);
  return {
    // 代は進めない。進めると applyState の巻き戻しガードに引っかかって
    // 以後のポーリングが全部無視されてしまう(デモのあと画面が止まる)
    roundNo: round,
    startedAt: new Date().toISOString(),
    stabCount: cur.stabCount,
    // 空文字だと長さ0の配列になって、刺さっている剣が全部消える
    holesBase64: maskToBase64(emptyMask()),
    stabColorsBase64: "",
    stabStylesBase64: "",
    stabCharmsBase64: "",
    recent: cur.recent,
    prevWinner: {
      roundNo: round,
      name: "だれか",
      country: "JP",
      wonAt: new Date().toISOString(),
      holeId: 512,
      stabCount: cur.stabCount,
    },
  };
}

/** この代の自分の刺しをlocalStorageに保存(ラウンドが変わったら空になる) */
function loadMyStabs(roundNo: number): number[] {
  try {
    const raw = LS.get("kk-my-stabs");
    if (!raw) return [];
    const v = JSON.parse(raw) as { r: number; h: number[] };
    return v.r === roundNo && Array.isArray(v.h) ? v.h : [];
  } catch {
    return [];
  }
}

function saveMyStabs(roundNo: number, holes: number[]): void {
  LS.set("kk-my-stabs", JSON.stringify({ r: roundNo, h: holes }));
}

/**
 * 持っているチャームの index 一覧(刺して集めたぶん + 隠し)。
 * 「つけている」ではなく「持っている」。
 */
/**
 * つかまえた数 → 開いたチャームのビット。開く順は SKY_KINDS の並びどおりで、
 * 途中が飛ぶことはないので、いつでも下から詰まった形になる。
 */
export function skyMask(catches: number): number {
  return (1 << skyCharmLevelOf(catches)) - 1;
}

export function ownedCharms(
  myTotal: number,
  earth: boolean,
  caughtSky = 0,
  poke = false,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < charmLevelOf(myTotal); i++) out.push(i);
  if (earth && EARTH_CHARM_INDEX >= 0) out.push(EARTH_CHARM_INDEX);
  for (let i = 0; i < SKY_KINDS.length; i++) {
    const ci = SKY_CHARM_INDEX[i];
    if (caughtSky & (1 << i) && ci >= 0) out.push(ci);
  }
  if (poke && POKE_CHARM_INDEX >= 0) out.push(POKE_CHARM_INDEX);
  return out;
}

/**
 * つけているチャーム。保存が無ければ null を返し、呼び出し側が
 * 「持っているもの全部」を既定にする(あとから増えたぶんも自動でつく)。
 */
function loadEquipped(): number[] {
  try {
    const raw = LS.get("kk-charms");
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is number => typeof x === "number" && Number.isInteger(x))
      .filter((x) => x >= 0 && x < CHARMS.length);
  } catch {
    return [];
  }
}

/**
 * 未保存(=一度もつけ外ししていない)なら、持っているぶんを既定でつけておく。
 * ただし上限があるので、あふれるときは**新しい方**を残す
 * (せっかく手に入れたばかりのチャームが、上限のせいで出てこないのを避ける)。
 */
function defaultEquipped(
  myTotal: number,
  earth: boolean,
  caughtSky = 0,
  poke = false,
): number[] {
  if (LS.get("kk-charms") !== null) return [];
  const owned = ownedCharms(myTotal, earth, caughtSky, poke);
  return owned.slice(-MAX_EQUIPPED_CHARMS);
}

/** とばした回数から、いま使えるスキンのindex一覧 */
export function unlockedSkins(wins: number): number[] {
  const out: number[] = [];
  SWORD_SKINS.forEach((s, i) => {
    if (wins >= s.needWins) out.push(i);
  });
  return out;
}

/**
 * 前回のマスクから増えたビット(=他の人が刺した穴)を拾う。
 * 同一ラウンド内でビットが消えることはないので差分は必ず「増えた分」。
 */
function newlySetHoles(oldMask: Uint8Array, newMask: Uint8Array): number[] {
  const out: number[] = [];
  const len = Math.min(oldMask.length, newMask.length);
  for (let b = 0; b < len; b++) {
    const diff = newMask[b] & ~oldMask[b];
    if (diff === 0) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (diff & (1 << bit)) {
        const id = (b << 3) | bit;
        if (id < HOLE_COUNT) out.push(id);
      }
    }
  }
  return out;
}

/**
 * URLのクエリで「見せたい状態」を作る(社内の確認・スクリーンショット用)。
 *
 *   ?charm=13  … チャームを13個つけた状態(13 = 隠しチャームも込み)
 *   ?wins=3    … こすくまくんを3回とばした状態(剣のスキンがぜんぶ解放される)
 *
 * **localStorage には書かない**ので、クエリを外してリロードすれば元に戻る。
 * `?demo=win`(必ず当たり)や `?earth=999`(地球イースターエッグ)と同じ流儀。
 */
function applyPreviewParams(set: (p: Partial<GameState>) => void): void {
  if (typeof window === "undefined") return;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  const charmRaw = q.get("charm");
  if (charmRaw !== null) {
    const want = Math.min(Math.max(Number(charmRaw) || 0, 0), CHARMS.length);
    // 「刺して集めたぶん」は本数のしきい値から逆算する。隠しぶんは別フラグ
    const normal = Math.min(want, NORMAL_CHARM_COUNT);
    const total = normal === 0 ? 0 : CHARMS[normal - 1].need;
    const earth = want > NORMAL_CHARM_COUNT;
    // ちきゅうより後ろは「空を横切るものをつかまえたぶん」。順に開いていく
    const skyWant = Math.min(
      Math.max(0, want - NORMAL_CHARM_COUNT - 1),
      SKY_KINDS.length,
    );
    const skyCatches = skyWant === 0 ? 0 : SKY_CATCH_NEED[skyWant - 1];
    const sky = skyMask(skyCatches);
    // 空のぶんより後ろは「こすくまくんを1万回つついた人」のチャーム
    const poke = want > NORMAL_CHARM_COUNT + 1 + SKY_KINDS.length;
    set({
      myTotal: total,
      hasEarthCharm: earth,
      skyCatches,
      caughtSky: sky,
      pokeCount: poke ? POKE_CHARM_NEED : 0,
      hasPokeCharm: poke,
      // 見せるための状態なので、つけ外しの保存は無視して上限までつけた姿にする
      equippedCharms: ownedCharms(total, earth, sky, poke).slice(
        -MAX_EQUIPPED_CHARMS,
      ),
    });
  }

  const winsRaw = q.get("wins");
  if (winsRaw !== null) {
    const wins = Math.min(Math.max(Number(winsRaw) || 0, 0), 99);
    set({ myWins: wins });
  }
}

/** 端末に貯める刺しの記録の上限。多すぎても読めないので、これくらいで足りる */
const FEED_LOG_MAX = 120;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
/** カットシーン中に届いた新ラウンド状態を退避しておく */
let pendingState: StateResponse | null = null;
/** 自分が当てた代。観客としての発射カットシーンを二重再生しないための目印 */
const myWonRounds = new Set<number>();

export const useGameStore = create<GameState>((set, get) => {
  const setPhase = (phase: Phase) => set({ phase, phaseAt: Date.now() });

  /**
   * 前回から増えた穴(=他の人が刺した)を「刺さる瞬間」の再生キューへ積む。
   * 演出中の穴は Swords が描かないので、剣が二重に見えることはない。
   */
  const queueRemote = (
    cur: GameState,
    rawMask: Uint8Array,
    colors: Uint8Array,
    styles: Uint16Array,
    charmSets: Uint32Array
  ): RemoteStab[] => {
    const now = Date.now();
    // 取りこぼしの保険: 演出コンポーネントが外れた等で残った古い分は畳む
    const alive = cur.remoteStabs.filter(
      (r) => now - r.startAt < T_REMOTE_STAB + 4000
    );
    const fresh = newlySetHoles(cur.mask, rawMask);
    if (fresh.length === 0) return alive.length === cur.remoteStabs.length ? cur.remoteStabs : alive;

    const mine = new Set(cur.myStabs);
    const busy = new Set(alive.map((r) => r.holeId));
    // すでに走っている演出の後ろへ並べる(同時に降ってこないように)
    let at = now;
    for (const r of alive) at = Math.max(at, r.startAt + REMOTE_STAGGER);

    const added: RemoteStab[] = [];
    for (const holeId of fresh) {
      if (mine.has(holeId) || busy.has(holeId)) continue;
      if (alive.length + added.length >= REMOTE_MAX) break;
      const c = colors[holeId];
      const style = styles[holeId];
      added.push({
        holeId,
        color: c > 0 && c <= SWORD_COLORS.length ? c - 1 : 0,
        skin: skinOf(style),
        charm: charmOf(style),
        charms: charmIndicesFor(style, charmSets[holeId]),
        startAt: at,
      });
      at += REMOTE_STAGGER;
    }
    return added.length > 0 ? [...alive, ...added] : alive;
  };

  /**
   * 手に入れたばかりのチャームを、つけた状態にする。
   * いっぱいのときは勝手に外さない(何が外れたか分からないのがいちばん困る)。
   * 手に入れたこと自体は獲得演出が伝えるので、つけ替えは本人にまかせる。
   */
  const equipCharm = (index: number) => {
    const cur = get().equippedCharms;
    if (cur.includes(index)) return;
    if (cur.length >= MAX_EQUIPPED_CHARMS) return;
    const next = [...cur, index].sort((a, b) => a - b);
    LS.set("kk-charms", JSON.stringify(next));
    set({ equippedCharms: next });
  };

  /** 流れてきた刺しを、この端末の記録へ足す(新しい順・重複はしない) */
  const mergeFeedLog = (
    log: StateResponse["recent"],
    incoming: StateResponse["recent"]
  ): StateResponse["recent"] => {
    const key = (e: StateResponse["recent"][number]) => `${e.at}-${e.holeId}`;
    const seen = new Set(log.map(key));
    const fresh = incoming.filter((e) => !seen.has(key(e)));
    if (fresh.length === 0) return log;
    return [...fresh, ...log].slice(0, FEED_LOG_MAX);
  };

  /** サーバー状態を表示へ反映 */
  const applyState = (s: StateResponse) => {
    const cur = get();
    // CDNキャッシュ(stale-while-revalidate)由来の古い応答でラウンドを巻き戻さない
    if (s.roundNo < cur.roundNo) return;
    const mask = base64ToMask(s.holesBase64);
    const colors = s.stabColorsBase64
      ? base64ToMask(s.stabColorsBase64)
      : new Uint8Array(HOLE_COUNT);
    const styles = s.stabStylesBase64
      ? base64ToU16(s.stabStylesBase64, HOLE_COUNT)
      : new Uint16Array(HOLE_COUNT);
    const charmSets = s.stabCharmsBase64
      ? base64ToU32(s.stabCharmsBase64, HOLE_COUNT)
      : new Uint32Array(HOLE_COUNT);
    let stabCount = s.stabCount;
    let remoteStabs: RemoteStab[] = [];
    if (s.roundNo === cur.roundNo) {
      // 初回ロード(roundNo=0からの立ち上がり)は既存の1000本が一気に
      // 降ってくることになるので、2回目以降の差分だけを演出する
      remoteStabs =
        cur.roundNo > 0
          ? queueRemote(cur, mask, colors, styles, charmSets)
          : cur.remoteStabs;
      // 同一ラウンド内でビットが消えることはない。自分の刺した直後に
      // 数秒古いキャッシュ応答が来ても剣(と色)が消えないよう和集合をとる
      const old = cur.mask;
      for (let i = 0; i < mask.length && i < old.length; i++) mask[i] |= old[i];
      const oldC = cur.stabColors;
      for (let i = 0; i < colors.length && i < oldC.length; i++) {
        if (colors[i] === 0) colors[i] = oldC[i];
      }
      const oldS = cur.stabStyles;
      for (let i = 0; i < styles.length && i < oldS.length; i++) {
        if (styles[i] === 0) styles[i] = oldS[i];
      }
      const oldK = cur.stabCharms;
      for (let i = 0; i < charmSets.length && i < oldK.length; i++) {
        if (charmSets[i] === 0) charmSets[i] = oldK[i];
      }
      stabCount = Math.max(stabCount, cur.stabCount);
    }
    // ラウンドが変わったら「この代の自分の刺し」を読み直す(通常は空)
    const myStabs =
      s.roundNo === cur.roundNo ? cur.myStabs : loadMyStabs(s.roundNo);
    set({
      roundNo: s.roundNo,
      stabCount,
      mask,
      stabColors: colors,
      stabStyles: styles,
      stabCharms: charmSets,
      remoteStabs,
      myStabs,
      recent: s.recent,
      feedLog: mergeFeedLog(cur.feedLog, s.recent),
      prevWinner: s.prevWinner,
      connected: true,
    });
  };

  /**
   * 授与式で「けんのスキンを手に入れた」を知らせる。名前が刻まれる演出
   * (1.0秒)のすこし後に鳴らして、ごほうびが二段構えに見えるようにする。
   */
  const announceSkins = () => {
    if (get().newSkins.length === 0) return;
    setTimeout(() => {
      if (get().newSkins.length > 0) emitGameEvent("skin-unlock");
    }, 1600);
  };

  /** カットシーン中に退避した最新状態があれば反映する */
  const flushPending = () => {
    if (pendingState) {
      applyState(pendingState);
      pendingState = null;
    }
  };

  /**
   * 発射の途中で、まだ刻まれていなかった勝者の名前をもう一度だけ取りにいく。
   * (当てた人が名前を入れるまで、観客からは「だれか」に見えてしまうため)
   */
  const refreshWinnerName = async () => {
    const li = get().launchInfo;
    if (!li || li.isMe || li.name) return;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const s: StateResponse = await res.json();
      const w = s.prevWinner;
      const cur = get().launchInfo;
      if (w?.name && cur && !cur.name && w.roundNo === cur.roundNo) {
        set({ launchInfo: { ...cur, name: w.name, country: w.country } });
      }
      // 退避ぶんも新しい方へ差し替えておく
      if (!pendingState || s.roundNo >= pendingState.roundNo) pendingState = s;
    } catch {
      /* 名前が出ないだけなので黙って諦める */
    }
  };

  /**
   * 観客として発射カットシーンを再生する。
   * 「だれかが当てた → こすくまくんが飛んでいく」を、月を見ている全員に見せる。
   */
  const playSpectatorLaunch = (s: StateResponse) => {
    pendingState = s;
    const w = s.prevWinner;
    set({
      selectedHole: null,
      launchInfo: w
        ? { ...w, isMe: false }
        : {
            roundNo: s.roundNo - 1,
            holeId: 0,
            name: null,
            country: null,
            isMe: false,
          },
    });
    emitGameEvent("win-flash");
    emitGameEvent("launch");
    setPhase("launch");
    void (async () => {
      setTimeout(() => void refreshWinnerName(), Math.round(T_LAUNCH * 0.45));
      await sleep(T_LAUNCH);
      emitGameEvent("new-round");
      setPhase("new-round");
      flushPending();
      await sleep(T_NEW_ROUND);
      flushPending(); // 降臨中に届いた分も適用してからidleへ
      setPhase("idle");
    })();
  };

  /**
   * 自分のカットシーンが終わったときの後始末。退避ぶんに「知らないうちに
   * 決着した代」が含まれていたら、見逃さないように発射から見せる。
   * @returns true = 観客カットシーンを始めた(呼び出し側は idle にしない)
   */
  const flushPendingOrSpectate = (): boolean => {
    const s = pendingState;
    const cur = get();
    if (
      s &&
      s.roundNo > cur.roundNo &&
      cur.roundNo > 0 &&
      !myWonRounds.has(s.roundNo - 1)
    ) {
      playSpectatorLaunch(s);
      return true;
    }
    flushPending();
    return false;
  };

  /** カットシーンなど「今は画面を書き換えたくない」フェーズか */
  const inCutscene = () => {
    const p = get().phase;
    return (
      p === "stabbing" ||
      p === "suspense" ||
      p === "safe" ||
      p === "launch" ||
      p === "name-entry" ||
      p === "trophy" ||
      p === "new-round"
    );
  };

  const fetchState = async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const s: StateResponse = await res.json();
      // 通信は生きている(カットシーン中でも警告は消す)
      if (!get().connected) set({ connected: true });
      const cur = get();
      if (
        s.roundNo > cur.roundNo &&
        cur.roundNo > 0 &&
        !myWonRounds.has(s.roundNo - 1)
      ) {
        // 誰かが当てて新ラウンドになった
        if (cur.phase === "idle" || cur.phase === "confirming") {
          playSpectatorLaunch(s);
          return;
        }
        if (inCutscene()) {
          // 自分のカットシーンが終わってから、観客として見せる
          pendingState = s;
          return;
        }
      }
      if (!inCutscene()) applyState(s);
      else {
        // カットシーン中でも件数などの軽い更新は名前反映のため保持
        pendingState = s;
      }
    } catch {
      set({ connected: false });
    }
  };

  const schedulePoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    const jitter = Math.random() * 800;
    pollTimer = setTimeout(async () => {
      if (typeof document === "undefined" || !document.hidden) {
        await fetchState();
      }
      schedulePoll();
    }, POLL_MS + jitter);
  };

  const initialWins = Math.max(0, Number(LS.get("kk-wins") ?? 0) || 0);
  const initialTotal = Math.max(0, Number(LS.get("kk-my-total") ?? 0) || 0);
  const initialEarthCharm = LS.get("kk-earth-charm") === "1";
  const initialSkyCatches = Math.max(0, Number(LS.get("kk-sky-n") ?? 0) || 0);
  const initialCaughtSky = skyMask(initialSkyCatches);
  const initialPokes = Math.max(0, Number(LS.get("kk-poke-n") ?? 0) || 0);
  const initialPokeCharm = LS.get("kk-poke-charm") === "1";

  return {
    phase: "boot",
    phaseAt: 0,
    roundNo: 0,
    stabCount: 0,
    mask: emptyMask(),
    stabColors: new Uint8Array(HOLE_COUNT),
    stabStyles: new Uint16Array(HOLE_COUNT),
    stabCharms: new Uint32Array(HOLE_COUNT),
    recent: [],
    prevWinner: null,
    connected: true,
    remoteStabs: [],
    playingStabs: [],
    selectedHole: null,
    hoveredHole: null,
    cooldownUntil: 0,
    launchInfo: null,
    claimToken: null,
    claimRound: null,
    wonName: null,
    toast: null,
    muted: LS.get("kk-muted") === "1",
    ready3d: false,
    swordColor: (() => {
      const c = Number(LS.get("kk-sword-color") ?? 0);
      return Number.isInteger(c) && c >= 0 && c < SWORD_COLORS.length ? c : 0;
    })(),
    swordSkin: (() => {
      const s = Number(LS.get("kk-sword-skin") ?? 0);
      if (!Number.isInteger(s) || s < 0 || s >= SWORD_SKINS.length) return 0;
      // 解放していないスキンが残っていたら既定へ戻す
      return initialWins >= SWORD_SKINS[s].needWins ? s : 0;
    })(),
    myStabs: [],
    myTotal: Math.max(0, Number(LS.get("kk-my-total") ?? 0) || 0),
    myWins: initialWins,
    newCharm: null,
    newSkins: [],
    earthClicks: Math.max(0, Number(LS.get("kk-earth-clicks") ?? 0) || 0),
    earthBooms: Math.max(0, Number(LS.get("kk-earth-booms") ?? 0) || 0),
    hasEarthCharm: LS.get("kk-earth-charm") === "1",
    // 一度もつけ外ししていない人は「持っているもの全部」がついている状態
    // 端末に残った設定が上限より長いことがある(上限を入れる前の人)。
    // 表示側でも切るが、ここでも新しい方から MAX_EQUIPPED_CHARMS 個に丸めておく
    equippedCharms: [
      ...loadEquipped(),
      ...defaultEquipped(
        initialTotal,
        initialEarthCharm,
        initialCaughtSky,
        initialPokeCharm
      ),
    ].slice(-MAX_EQUIPPED_CHARMS),
    earthBoomAt: null,
    skyCatches: initialSkyCatches,
    skyPop: null,
    caughtSky: initialCaughtSky,
    nickname: (LS.get("kk-nick") || "").slice(0, NAME_MAX_LEN) || null,
    feedLog: [],
    pokeCount: initialPokes,
    hasPokeCharm: initialPokeCharm,
    speech: null,

    init: () => {
      if (initialized) return;
      initialized = true;
      applyPreviewParams(set);
      const cd = Number(LS.get("kk-cooldown") || 0);
      if (cd > Date.now()) set({ cooldownUntil: cd });
      // リロードで名前未入力のまま閉じた勝者の救済
      const token = LS.get("kk-claim-token");
      const round = Number(LS.get("kk-claim-round") || 0);
      if (token && round > 0) set({ claimToken: token, claimRound: round });
      void fetchState().then(() => {
        const s = get();
        if (s.phase === "boot") setPhase("title");
        // 未クレームの勝利があれば名前入力を再表示
        if (s.claimToken && s.claimRound) {
          set({
            launchInfo: {
              roundNo: s.claimRound,
              holeId: 0,
              name: null,
              country: null,
              isMe: true,
            },
          });
          setPhase("name-entry");
        }
      });
      schedulePoll();
    },

    start: () => {
      if (get().phase !== "title") return;
      emitGameEvent("ui-tap");
      setPhase("idle");
      // ?demo=watch: 月をながめていたら誰かが当てた、という画面を再生する
      if (isDemoWatch()) {
        setTimeout(() => {
          if (get().phase === "idle") playSpectatorLaunch(demoWatchState(get()));
        }, 1200);
      }
    },

    setReady3d: () => set({ ready3d: true }),

    hoverHole: (id) => {
      const cur = get();
      if (cur.hoveredHole === id) return;
      set({ hoveredHole: id });
      if (id !== null && cur.phase === "idle") emitGameEvent("hover");
    },

    selectHole: (id) => {
      const cur = get();
      if (cur.phase !== "idle") return;
      if (getBit(cur.mask, id)) {
        cur.showToast("そこは もう刺さってるよ！");
        emitGameEvent("error");
        return;
      }
      if (!isDemoWin() && cur.cooldownUntil > Date.now()) {
        const sec = Math.ceil((cur.cooldownUntil - Date.now()) / 1000);
        cur.showToast(`つぎに刺せるまで あと${sec}びょう`);
        emitGameEvent("error");
        return;
      }
      emitGameEvent("ui-tap");
      set({ selectedHole: id });
      setPhase("confirming");
    },

    cancelSelect: () => {
      if (get().phase !== "confirming") return;
      emitGameEvent("ui-tap");
      set({ selectedHole: null });
      setPhase("idle");
    },

    confirmStab: async () => {
      const cur = get();
      if (cur.phase !== "confirming" || cur.selectedHole === null) return;
      const holeId = cur.selectedHole;
      // この1本を数えたあとのチャーム数を持たせる(10本目の剣には
      // 「その場で手に入れたチャーム」がもうぶら下がっている)
      // 月に残る剣が持つのは「つけているチャーム」。他の人の画面ではビーズ1個に
      // なるので、いちばん新しくつけたものの色が出るように数へ丸める
      const equipped = cur.equippedCharms;
      const topNormal = equipped.filter((i) => i < NORMAL_CHARM_COUNT);
      const charmNow = topNormal.length === 0 ? 0 : Math.max(...topNormal) + 1;
      const earthOn =
        cur.hasEarthCharm && equipped.includes(EARTH_CHARM_INDEX);
      // つかまえたもののうち、いま剣につけているぶんだけを月へ残す
      let skyOn = 0;
      for (let i = 0; i < SKY_KINDS.length; i++) {
        const ci = SKY_CHARM_INDEX[i];
        if (cur.caughtSky & (1 << i) && ci >= 0 && equipped.includes(ci)) {
          skyOn |= 1 << i;
        }
      }
      const styleNow = packStyle(cur.swordSkin, charmNow, earthOn, skyOn);
      // 「どれをつけたか」は数では表せないので、一覧そのものも送る。
      // 持っていないものが端末の設定に残っていることがあるので、必ず交差させる
      const ownedNow = new Set(
        ownedCharms(
          cur.myTotal,
          cur.hasEarthCharm,
          cur.caughtSky,
          cur.hasPokeCharm
        )
      );
      const charmList = equipped
        .filter((i) => ownedNow.has(i))
        .slice(0, MAX_EQUIPPED_CHARMS);
      const charmSetNow = packCharmSet(charmList);
      const body = JSON.stringify({
        holeId,
        roundNo: cur.roundNo,
        fp: getFingerprint(),
        color: cur.swordColor,
        skin: cur.swordSkin,
        charm: charmNow,
        earthCharm: earthOn,
        skyCharms: skyOn,
        charms: charmList,
        nickname: cur.nickname ?? undefined,
      });

      // 演出とAPIを並走させる。回線ハングでsuspenseに閉じ込められないよう
      // タイムアウトを付ける(非対応ブラウザではブラウザ既定に任せる)
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(12000)
          : undefined;
      const resultPromise: Promise<StabResult> = isDemoWin()
        ? Promise.resolve<StabResult>({
            // デモ: サーバーを呼ばず必ず当たり(記録は残らない)
            result: "win",
            holeId,
            claimToken: DEMO_TOKEN,
            roundNo: cur.roundNo,
          })
        : fetch("/api/stab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: timeoutSignal,
          })
            .then((r) => r.json() as Promise<StabResult>)
            .catch(() => ({ result: "error", message: "つうしんエラー" }));

      setPhase("stabbing");
      emitGameEvent("sword-raise");
      setTimeout(() => emitGameEvent("thrust"), T_STAB * 0.55);
      setTimeout(() => {
        emitGameEvent("impact");
        setPhase("suspense");
        emitGameEvent("suspense");
      }, T_STAB);

      const [result] = await Promise.all([
        resultPromise,
        sleep(T_STAB + T_SUSPENSE),
      ]);

      switch (result.result) {
        case "safe": {
          const until = Date.now() + COOLDOWN_SEC * 1000;
          LS.set("kk-cooldown", String(until));
          // 自分の剣の色/スキンと「自分の刺し」を即時反映(次のポーリングを待たない)
          const colors = new Uint8Array(get().stabColors);
          colors[holeId] = cur.swordColor + 1;
          const styles = new Uint16Array(get().stabStyles);
          styles[holeId] = styleNow;
          const charmSets = new Uint32Array(get().stabCharms);
          charmSets[holeId] = charmSetNow;
          const myStabs = [...get().myStabs, holeId];
          const myTotal = get().myTotal + 1;
          saveMyStabs(cur.roundNo, myStabs);
          LS.set("kk-my-total", String(myTotal));
          // ちょうどチャームがたまった刺しか
          const gotCharm =
            charmLevelOf(myTotal) > charmLevelOf(myTotal - 1)
              ? charmLevelOf(myTotal) - 1
              : null;
          // 手に入れたチャームは、そのままつけた状態にしておく
          if (gotCharm !== null) equipCharm(gotCharm);
          set({
            mask: base64ToMask(result.holesBase64),
            stabCount: result.stabCount,
            stabColors: colors,
            stabStyles: styles,
            stabCharms: charmSets,
            myStabs,
            myTotal,
            cooldownUntil: until,
            selectedHole: null,
            newCharm: gotCharm,
          });
          emitGameEvent("safe");
          setPhase("safe");
          if (gotCharm !== null) {
            setTimeout(() => emitGameEvent("charm-get"), 900);
          }
          await sleep(T_SAFE);
          if (!flushPendingOrSpectate()) setPhase("idle");
          break;
        }
        case "win": {
          // とばした回数が増えると剣のスキンが解放される
          const winsBefore = get().myWins;
          const wins = winsBefore + 1;
          const had = new Set(unlockedSkins(winsBefore));
          const newSkins = unlockedSkins(wins).filter((i) => !had.has(i));
          if (result.claimToken !== DEMO_TOKEN) {
            // デモの当たりはリロード復元の対象にしない
            LS.set("kk-claim-token", result.claimToken);
            LS.set("kk-claim-round", String(result.roundNo));
            myWonRounds.add(result.roundNo);
            // 当たりも自分の1回として数える(デモは数えない)
            const myTotal = get().myTotal + 1;
            LS.set("kk-my-total", String(myTotal));
            LS.set("kk-wins", String(wins));
            const gotCharm =
              charmLevelOf(myTotal) > charmLevelOf(myTotal - 1)
                ? charmLevelOf(myTotal) - 1
                : null;
            set({ myTotal, myWins: wins, newCharm: gotCharm });
          }
          set({
            newSkins,
            claimToken: result.claimToken,
            claimRound: result.roundNo,
            selectedHole: null,
            launchInfo: {
              roundNo: result.roundNo,
              holeId,
              name: null,
              country: null,
              isMe: true,
            },
          });
          emitGameEvent("win-flash");
          emitGameEvent("launch");
          setPhase("launch");
          await sleep(T_LAUNCH);
          setPhase("name-entry");
          break;
        }
        case "taken":
          set({
            mask: base64ToMask(result.holesBase64),
            selectedHole: null,
          });
          get().showToast("いちあしちがいで もう刺さってた！");
          emitGameEvent("error");
          if (!flushPendingOrSpectate()) setPhase("idle");
          break;
        case "cooldown": {
          // サーバー判定のクールダウンをローカルにも反映(ピル表示と再打診防止)
          const until = Date.now() + result.remainingSec * 1000;
          LS.set("kk-cooldown", String(until));
          set({ selectedHole: null, cooldownUntil: until });
          get().showToast(
            `つぎに刺せるまで あと${result.remainingSec}びょう`
          );
          emitGameEvent("error");
          if (!flushPendingOrSpectate()) setPhase("idle");
          break;
        }
        case "stale":
          set({ selectedHole: null });
          get().showToast("あたらしい こすくまくんが きたよ！");
          emitGameEvent("error");
          await fetchState();
          // suspense中の取得は退避されるので明示的に。見逃した発射は
          // ここで観客カットシーンとして再生される
          if (!flushPendingOrSpectate()) setPhase("idle");
          break;
        default:
          set({ selectedHole: null });
          get().showToast(result.message || "エラーがおきたよ");
          emitGameEvent("error");
          if (!flushPendingOrSpectate()) setPhase("idle");
      }
    },

    submitName: async (name: string) => {
      const cur = get();
      if (cur.phase !== "name-entry" || !cur.claimToken || !cur.claimRound)
        return;
      const trimmed = name.trim().slice(0, 12) || "ななし";

      // デモの当たり: サーバーへ書き込まず授与式だけ体験する
      if (cur.claimToken === DEMO_TOKEN) {
        set({
          claimToken: null,
          claimRound: null,
          wonName: trimmed,
          launchInfo: cur.launchInfo
            ? { ...cur.launchInfo, name: trimmed }
            : null,
        });
        emitGameEvent("fanfare");
        emitGameEvent("trophy");
        setPhase("trophy");
        announceSkins();
        get().showToast("デモモードだから きろくには のこらないよ");
        await sleep(T_TROPHY);
        emitGameEvent("new-round");
        setPhase("new-round");
        await sleep(T_NEW_ROUND);
        flushPending();
        setPhase("idle");
        return;
      }

      try {
        const timeoutSignal =
          typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
            ? AbortSignal.timeout(12000)
            : undefined;
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roundNo: cur.claimRound,
            token: cur.claimToken,
            name: trimmed,
          }),
          signal: timeoutSignal,
        });
        const data: ClaimResponse = await res.json();

        if (!data.ok) {
          if (data.code === "bad-token") {
            // もう成功しない(記録が消えた等)。トークンを片付けて静かに復帰
            LS.del("kk-claim-token");
            LS.del("kk-claim-round");
            set({ claimToken: null, claimRound: null, launchInfo: null });
            get().showToast(
              data.message || "きろくが見つからなかった…ごめんね"
            );
            emitGameEvent("error");
            await fetchState();
            flushPending();
            setPhase("idle");
            return;
          }
          // 名前NG・サーバーエラーは再入力/再送のチャンスを残す(トークン保持)
          get().showToast(data.message || "そのなまえは つかえないよ");
          emitGameEvent("error");
          return;
        }

        const finalName = data.name || trimmed;
        LS.del("kk-claim-token");
        LS.del("kk-claim-round");
        set({
          claimToken: null,
          claimRound: null,
          wonName: finalName,
          launchInfo: cur.launchInfo
            ? { ...cur.launchInfo, name: finalName }
            : null,
        });
        emitGameEvent("fanfare");
        emitGameEvent("trophy");
        setPhase("trophy");
        announceSkins();
        await sleep(T_TROPHY);
        emitGameEvent("new-round");
        setPhase("new-round");
        flushPending();
        if (get().roundNo <= (cur.claimRound ?? 0)) {
          // 退避が無かった/古かった場合は取り直してから適用
          await fetchState();
          flushPending();
        }
        await sleep(T_NEW_ROUND);
        // 降臨中に届いた分も適用してからidleへ(授与式のあいだに次の代が
        // 決着していたら、その発射も見逃さずに見せる)
        if (!flushPendingOrSpectate()) setPhase("idle");
      } catch {
        get().showToast("つうしんエラー。もういちどためしてね");
      }
    },

    showToast: (msg: string) => {
      const id = Date.now();
      set({ toast: { id, msg } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, 3200);
    },

    setMuted: (m: boolean) => {
      LS.set("kk-muted", m ? "1" : "0");
      set({ muted: m });
    },

    setSwordColor: (c: number) => {
      if (!Number.isInteger(c) || c < 0 || c >= SWORD_COLORS.length) return;
      LS.set("kk-sword-color", String(c));
      emitGameEvent("ui-tap");
      set({ swordColor: c });
    },

    setSwordSkin: (s: number) => {
      if (!Number.isInteger(s) || s < 0 || s >= SWORD_SKINS.length) return;
      const cur = get();
      if (cur.myWins < SWORD_SKINS[s].needWins) {
        cur.showToast("こすくまくんを とばすと つかえるよ");
        emitGameEvent("error");
        return;
      }
      LS.set("kk-sword-skin", String(s));
      emitGameEvent("ui-tap");
      set({ swordSkin: s });
    },

    toggleCharm: (index: number) => {
      const cur = get();
      const owned = ownedCharms(
        cur.myTotal,
        cur.hasEarthCharm,
        cur.caughtSky,
        cur.hasPokeCharm
      );
      if (!owned.includes(index)) return; // 持っていないものはつけられない
      const on = cur.equippedCharms.includes(index);
      if (!on && cur.equippedCharms.length >= MAX_EQUIPPED_CHARMS) {
        // 勝手に外して入れ替えない。何が外れたか分からないほうが困る
        cur.showToast(`チャームは ${MAX_EQUIPPED_CHARMS}こまで！`);
        emitGameEvent("error");
        return;
      }
      const next = on
        ? cur.equippedCharms.filter((i) => i !== index)
        : [...cur.equippedCharms, index].sort((a, b) => a - b);
      LS.set("kk-charms", JSON.stringify(next));
      emitGameEvent("ui-tap");
      set({ equippedCharms: next });
    },

    claimRemoteStab: (holeId: number) => {
      const cur = get();
      if (cur.playingStabs.includes(holeId)) return;
      set({ playingStabs: [...cur.playingStabs, holeId] });
    },

    endRemoteStab: (holeId: number) => {
      const cur = get();
      const inQueue = cur.remoteStabs.some((r) => r.holeId === holeId);
      const inPlay = cur.playingStabs.includes(holeId);
      if (!inQueue && !inPlay) return;
      set({
        remoteStabs: inQueue
          ? cur.remoteStabs.filter((r) => r.holeId !== holeId)
          : cur.remoteStabs,
        playingStabs: inPlay
          ? cur.playingStabs.filter((h) => h !== holeId)
          : cur.playingStabs,
      });
    },

    clearNewCharm: () => {
      if (get().newCharm !== null) set({ newCharm: null });
    },

    tapEarth: () => {
      const cur = get();
      // 爆発中は反応しない(再生を待つ)
      if (cur.earthBoomAt !== null) return;
      const clicks = cur.earthClicks + 1;
      if (clicks >= EARTH_BOOM_CLICKS) {
        const booms = cur.earthBooms + 1;
        LS.set("kk-earth-clicks", "0");
        LS.set("kk-earth-booms", String(booms));
        LS.set("kk-earth-charm", "1");
        set({
          earthClicks: 0,
          earthBooms: booms,
          earthBoomAt: Date.now(),
          hasEarthCharm: true,
        });
        emitGameEvent("earth-boom");
        // 隠しチャーム「ちきゅう」の獲得。爆発を見届けてから知らせる
        if (!cur.hasEarthCharm && EARTH_CHARM_INDEX >= 0) {
          equipCharm(EARTH_CHARM_INDEX);
          setTimeout(() => {
            set({ newCharm: EARTH_CHARM_INDEX });
            emitGameEvent("charm-get");
          }, Math.round(T_EARTH_BOOM * 0.78));
        }
        setTimeout(() => {
          if (get().earthBoomAt !== null) set({ earthBoomAt: null });
        }, T_EARTH_BOOM);
        return;
      }
      LS.set("kk-earth-clicks", String(clicks));
      set({ earthClicks: clicks });
      emitGameEvent("earth-tap");
    },

    catchSky: (kind: number) => {
      const cur = get();
      if (kind < 0 || kind >= SKY_KINDS.length) return;
      const catches = cur.skyCatches + 1;
      const before = skyCharmLevelOf(cur.skyCatches);
      const after = skyCharmLevelOf(catches);
      LS.set("kk-sky-n", String(catches));
      set({ skyCatches: catches, caughtSky: skyMask(catches) });

      if (after === before) {
        // まだ届いていない。あと何回かを、その場で数字にして返す
        const need = SKY_CATCH_NEED[after];
        set({
          skyPop: {
            id: Date.now(),
            text:
              need === undefined
                ? `${catches}こめ`
                : `あと ${need - catches}`,
          },
        });
        return;
      }

      // しきい値に届いた。開いたチャームは、そのままつけた状態にしておく
      const ci = SKY_CHARM_INDEX[after - 1];
      if (ci >= 0) {
        equipCharm(ci);
        set({ newCharm: ci });
        emitGameEvent("charm-get");
      }
    },

    pokeKosukuma: () => {
      const cur = get();
      if (cur.hasPokeCharm) return; // もう持っている人は数えなくていい
      const n = cur.pokeCount + 1;
      LS.set("kk-poke-n", String(n));
      if (n < POKE_CHARM_NEED || POKE_CHARM_INDEX < 0) {
        set({ pokeCount: n });
        return;
      }
      // 1万回。地球の爆発と同じで、条件はどこにも書かれていない
      LS.set("kk-poke-charm", "1");
      set({ pokeCount: n, hasPokeCharm: true });
      equipCharm(POKE_CHARM_INDEX);
      set({ newCharm: POKE_CHARM_INDEX });
      emitGameEvent("charm-get");
    },

    setNickname: (name: string) => {
      const trimmed = name.trim().slice(0, NAME_MAX_LEN);
      if (trimmed) LS.set("kk-nick", trimmed);
      else LS.del("kk-nick");
      set({ nickname: trimmed || null });
    },

    say: (text: string, tone: SpeechTone = "normal", ms = T_SPEECH) => {
      if (!text) return;
      set({
        speech: { id: Date.now(), text, tone, until: Date.now() + ms },
      });
    },
  };
});

/** チャームの定義(UI/3Dから index で引く) */
export function charmAt(index: number) {
  return CHARMS[Math.min(Math.max(index, 0), CHARMS.length - 1)];
}

// 開発時だけ window.__kk からストアを触れるようにする。
// 「他の人が刺した瞬間」や「チャーム獲得」のように、ひとりでは再現しづらい
// 状態を手で作って見た目を確認するため(本番ビルドには含まれない)。
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __kk: typeof useGameStore }).__kk = useGameStore;
}
