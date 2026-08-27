"use client";

// セリフの演出家。何も描画しない(return null)。
//   - store.phase の変化 → 場面のセリフ(かくにん/刺す/……/セーフ/発射/降臨)
//   - onGameEvent → 単発のセリフ(他人の刺し/チャーム/地球/しっぱい)
//   - ひまなとき → 12〜20秒に1回くらい、ひとりごと
//
// 方針: しゃべりすぎるとうるさい。だいじな場面(セーフ/発射/爆発)は
// ひとりごとより強くして、必ず前に出る。ひとりごと同士は間を空ける。

import { useEffect } from "react";
import {
  EARTH_CHARM_INDEX,
  T_NEW_ROUND,
  T_SPEECH,
  T_STAB,
  T_SUSPENSE,
} from "@/lib/config";
import { useGameStore, type Phase } from "@/game/store";
import { onGameEvent } from "@/game/events";
import {
  CHARM,
  CHARM_SECRET,
  CONFIRM,
  COOLDOWN,
  EARTH_BOOM,
  EARTH_TAP,
  FEW_LEFT,
  HOVER,
  IDLE,
  LAUNCH_ME,
  LAUNCH_OTHER,
  NEW_ROUND,
  POKE,
  POKE_MANY,
  RANDOM,
  READY,
  REMOTE,
  SAFE,
  SKIN,
  STABBING,
  SUSPENSE,
  TRIVIA_EARTH,
  WAIT,
  pick,
  type Line,
} from "./lines";

/** セリフの強さ。強いものは、弱いものの表示中でも割り込める */
const P = {
  IDLE: 0, // ひとりごと
  FLAVOR: 1, // ホバー・他人の刺し・地球つつき・クールダウン
  PHASE: 2, // かくにん/刺す/判定待ち
  BIG: 3, // セーフ・発射・降臨・爆発・ごほうび
} as const;

// ── しゃべる頻度(2026-08-08 ユーザー依頼で全体に上げた) ──
// 「もっと頻繁に喋ってほしい」。うるさくならない範囲で、間を約半分に。
// セリフ帳(lines.ts)を大幅に増やしたので、頻度を上げても被りにくい。
/** ひとりごとの間隔(ms) */
const IDLE_MIN = 6000;
const IDLE_MAX = 10500;
/** 遊びはじめ/場面が落ち着いた直後の1回目は、すこし早めに */
const FIRST_MIN = 2600;
const FIRST_MAX = 4500;
/** ひまなセリフ同士の最低あいだ(ms)。連続でしゃべらせない */
const QUIET_GAP = 4200;

/**
 * 穴にふれたときにしゃべる確率と、その最低間隔。
 * ホバーはドラッグ中に何十回も変わるので、確率より間隔のほうが効く。
 * 短くすると「穴さがし中ずっとしゃべっている」状態になるので長めに取る
 */
const HOVER_CHANCE = 0.34;
const HOVER_GAP = 6000;
/** 他の人が刺したときにしゃべる確率と、その最低間隔(連発させない) */
const REMOTE_CHANCE = 0.55;
const REMOTE_GAP = 6500;
/** 地球つつきは15回に1回くらい(つつきは連打されるので控えめに保つ) */
const EARTH_TAP_CHANCE = 1 / 15;
/**
 * こすくまくんを つついたときにしゃべる確率と、その最低間隔。
 * 地球つつきよりは高い(自分の体を触られている本人なので、無反応だと寂しい)が、
 * 連打のたびにしゃべると吹き出しが点滅するので、間隔でしっかり止める。
 */
const POKE_CHANCE = 0.5;
const POKE_GAP = 4500;
/** これより速く続けてつつかれたら「連打されている」と数える(ms) */
const POKE_STREAK_GAP = 1100;
/** 何回続けてつつかれたら、たまりかねた言いかたに変わるか */
const POKE_MANY_AT = 4;
/** 刺せなかったときに ぼやく確率 */
const COOLDOWN_CHANCE = 0.7;
/** あなが残りわずか、と感じはじめる本数 */
const FEW_LEFT_AT = 900;
const FEW_LEFT_CHANCE = 0.4;

/** 降臨は「降りきってから」あいさつしたい */
const NEW_ROUND_DELAY = 1500;
/** スキン解放は発射〜授与式で流れてしまうので、idleに戻ってから伝える */
const SKIN_DELAY = 1400;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export default function SpeechDirector() {
  useEffect(() => {
    // ── 状態はすべてクロージャに持つ(再レンダリングを起こさない) ──
    let lastText: string | undefined; // 直前のセリフ(同じ文の連続を避ける)
    let curPrio = -1;
    let curUntil = 0; // いま出ている吹き出しが消える時刻
    let lastAt = 0; // 最後にしゃべった時刻
    let lastHoverAt = 0;
    let lastRemoteAt = 0;
    let lastPokeAt = 0; // 最後につつかれた時刻(連打を数えるため)
    let lastPokeSpeakAt = 0;
    let pokeStreak = 0;
    let pendingSkin = false; // 解放したスキンの話をまだしていない
    let idleTurn = 0; // ひとりごとの通し番号(豆知識・雑談を順番で回すのに使う)
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    /** こすくまくんが画面にいて、しゃべっていいフェーズか */
    const canSpeak = (phase: Phase) =>
      phase !== "boot" &&
      phase !== "title" &&
      phase !== "name-entry" &&
      phase !== "trophy";

    /**
     * しゃべる。強さ(prio)が今出ているものより弱ければ黙る。
     * @param minGap 直前のセリフからこの時間が経っていなければ黙る
     */
    const speak = (
      lines: Line[],
      prio: number,
      ms: number = T_SPEECH,
      minGap = 0
    ): boolean => {
      const s = useGameStore.getState();
      if (!canSpeak(s.phase)) return false;
      const now = Date.now();
      if (now < curUntil && prio < curPrio) return false;
      if (minGap > 0 && now - lastAt < minGap) return false;

      const line = pick(lines, lastText);
      lastText = line.text;
      curPrio = prio;
      curUntil = now + ms;
      lastAt = now;
      s.say(line.text, line.tone, ms);
      // 何かしゃべった直後は、ひとりごとの時計を巻き戻して静かにする。
      // ただし**軽い相づち(ホバー・他人の刺し・地球つつき)では巻き戻さない**。
      // 遊んでいるあいだはそれらが絶えず飛ぶので、巻き戻していると
      // ひとりごとの出番が永久に来ず、豆知識や雑談がまったく出なくなる。
      if (prio >= P.PHASE) armIdle(IDLE_MIN, IDLE_MAX);
      return true;
    };

    // ── ひとりごと ─────────────────────────────────
    const armIdle = (min: number, max: number) => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(tickIdle, rand(min, max));
    };

    /**
     * ひとりごとの引き出しを選ぶ。ふだんの話が7割で、たまに地球の豆知識、
     * たまにまったく関係ない話。「急に何の話?」が可愛いので、混ぜる比率は
     * 低めにして、出たときに効くようにしている。
     */
    const idlePool = (few: boolean, waiting: boolean): Line[] => {
      if (few) return FEW_LEFT;
      // 確率まかせだと「何十回も出ない」ことが普通に起きるので、順番で保証する。
      // 4回に1回が地球の豆知識、4回に1回がまったく関係ない話、残り半分がふだんの話。
      idleTurn++;
      if (idleTurn % 4 === 1) return TRIVIA_EARTH;
      if (idleTurn % 4 === 3) return RANDOM;
      // つぎに刺せるまでの30秒だけ、ふだんのひとりごとを「待つ人にむけた話」に
      // 差し替える。豆知識と雑談の枠はそのまま残すので、話題が偏らない
      return waiting ? WAIT : IDLE;
    };

    const tickIdle = () => {
      const s = useGameStore.getState();
      // 月をながめていられるときだけ。裏タブでは黙っている
      if (s.phase === "idle" && !document.hidden) {
        // 残りが少なくなってきたら、そわそわしたセリフを混ぜる
        const few =
          s.stabCount > FEW_LEFT_AT && Math.random() < FEW_LEFT_CHANCE;
        const waiting = s.cooldownUntil > Date.now();
        if (speak(idlePool(few, waiting), P.IDLE, T_SPEECH + 900, QUIET_GAP)) {
          return;
        }
      }
      armIdle(IDLE_MIN, IDLE_MAX);
    };

    // ── フェーズが変わったとき ─────────────────────
    const onPhase = (phase: Phase, prev: Phase) => {
      switch (phase) {
        case "idle":
          // 遊びはじめ/新しい代のあとは、すこし早めに話しかける。
          // 刺したあとの復帰は speak() が引いた12〜20秒の時計にまかせる
          if (prev === "title" || prev === "new-round") {
            armIdle(FIRST_MIN, FIRST_MAX);
          }
          if (pendingSkin) {
            pendingSkin = false;
            after(SKIN_DELAY, () => {
              if (useGameStore.getState().phase === "idle") speak(SKIN, P.BIG);
            });
          }
          break;
        case "confirming":
          speak(CONFIRM, P.PHASE);
          break;
        case "stabbing":
          speak(STABBING, P.PHASE, T_STAB + 300);
          break;
        case "suspense":
          speak(SUSPENSE, P.PHASE, T_SUSPENSE + 300);
          break;
        case "safe":
          speak(SAFE, P.BIG, 2600);
          break;
        case "launch": {
          // 飛んでいくこすくまくんに、吹き出しも付いていく
          const isMe = useGameStore.getState().launchInfo?.isMe ?? false;
          speak(isMe ? LAUNCH_ME : LAUNCH_OTHER, P.BIG, 4200);
          break;
        }
        case "new-round":
          // 降りきったころに、新しい代のあいさつ
          after(NEW_ROUND_DELAY, () => {
            if (useGameStore.getState().phase === "new-round") {
              speak(NEW_ROUND, P.BIG, Math.min(2800, T_NEW_ROUND - NEW_ROUND_DELAY));
            }
          });
          break;
        default:
          break;
      }
      // 発射でいなくなるので、ひとりごとの予約は畳んでおく
      if (phase === "launch" || phase === "name-entry" || phase === "trophy") {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    /** 他の人が刺した(イベントとstoreの両方から来るので、間隔でまとめる) */
    const onRemote = () => {
      const s = useGameStore.getState();
      if (s.phase !== "idle") return;
      const now = Date.now();
      if (now - lastRemoteAt < REMOTE_GAP) return;
      if (Math.random() > REMOTE_CHANCE) return;
      if (speak(REMOTE, P.FLAVOR, T_SPEECH, QUIET_GAP)) lastRemoteAt = now;
    };

    // ── store 購読 ─────────────────────────────────
    const unsubStore = useGameStore.subscribe((s, prev) => {
      if (s.phase !== prev.phase) onPhase(s.phase, prev.phase);

      // 穴にふれた瞬間。低確率で、ぼそっと
      if (
        s.hoveredHole !== prev.hoveredHole &&
        s.hoveredHole !== null &&
        s.phase === "idle"
      ) {
        const now = Date.now();
        if (now - lastHoverAt >= HOVER_GAP && Math.random() < HOVER_CHANCE) {
          if (speak(HOVER, P.FLAVOR, T_SPEECH, QUIET_GAP)) lastHoverAt = now;
        }
      }

      // "remote-stab" イベントの発火元がまだ無い場合の保険。
      // 演出キューが伸びた=だれかが刺した、とみなす(間隔ガードで二重にならない)
      if (s.remoteStabs.length > prev.remoteStabs.length) onRemote();

      // スキン解放は、発射〜授与式のあいだに起きて流れてしまう。
      // idle に戻ってから伝えたいので、ここでは予約だけしておく
      if (s.newSkins.length > prev.newSkins.length) pendingSkin = true;
    });

    // ── 単発イベント購読 ───────────────────────────
    const unsubEvents = onGameEvent((type) => {
      switch (type) {
        case "remote-stab":
          onRemote();
          break;
        case "charm-get": {
          // 隠しチャーム「ちきゅう」だけは、こすくまくんも驚く
          const secret =
            useGameStore.getState().newCharm === EARTH_CHARM_INDEX;
          speak(secret ? CHARM_SECRET : CHARM, P.BIG, secret ? 3600 : 2800);
          break;
        }
        case "skin-unlock":
          // イベントが飛んでくる作りになったときは、こちらを優先
          pendingSkin = false;
          if (!speak(SKIN, P.BIG)) pendingSkin = true;
          break;
        case "earth-tap":
          if (Math.random() < EARTH_TAP_CHANCE) {
            speak(EARTH_TAP, P.FLAVOR, T_SPEECH, QUIET_GAP);
          }
          break;
        case "earth-boom":
          speak(EARTH_BOOM, P.BIG, 3800);
          break;
        case "kosukuma-poke": {
          // 連打は store に数えさせず、届いた時刻から数える
          const now = Date.now();
          pokeStreak = now - lastPokeAt < POKE_STREAK_GAP ? pokeStreak + 1 : 1;
          lastPokeAt = now;
          if (now - lastPokeSpeakAt < POKE_GAP) break;
          const many = pokeStreak >= POKE_MANY_AT;
          // 連打されているときは確率を通す。「そんなに押さないでよ」は
          // 押している本人がいちばん見たい反応なので、必ず返す
          if (!many && Math.random() > POKE_CHANCE) break;
          if (speak(many ? POKE_MANY : POKE, P.FLAVOR, T_SPEECH, QUIET_GAP)) {
            lastPokeSpeakAt = now;
          }
          break;
        }
        case "cooldown-ready":
          // 待ち時間あけ。UIのピルが消えるのと同時に、本人からも知らせる
          speak(READY, P.PHASE, 2800);
          break;
        case "error":
          // error は「もう刺さってる」等とも共用。クールダウン中かどうかで見分ける
          if (
            useGameStore.getState().cooldownUntil > Date.now() &&
            Math.random() < COOLDOWN_CHANCE
          ) {
            speak(COOLDOWN, P.FLAVOR, T_SPEECH, QUIET_GAP);
          }
          break;
        default:
          break;
      }
    });

    // 復帰直後にいきなり話しかけない
    armIdle(FIRST_MIN, FIRST_MAX);

    return () => {
      unsubStore();
      unsubEvents();
      if (idleTimer) clearTimeout(idleTimer);
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  return null;
}
