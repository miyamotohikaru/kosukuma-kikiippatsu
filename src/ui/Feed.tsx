"use client";

// 左下のチャット欄。**みんなが書いたコメント**と、月で起きたこと(刺し)を
// 1本の流れにまぜて出す。並びはYouTubeのライブと同じで、
// **新しいものが下**。いちばん下が入力欄なので、書いた自分のコメントが
// そのすぐ上に出てくる = 送れたことがその場で分かる。
//
// 刺しの行を混ぜているのは、コメントが無い時間帯でも欄が動いているように
// 見せたいから(ゲームのキルログとチャットが同じ箱にいるのと同じ)。
// ただし主役はコメントなので、刺しの行は一段暗く・小さく置く。

import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LEN, FEED_ROWS } from "@/lib/config";
import type { ChatMessage, StabEvent } from "@/lib/types";
import { useGameStore } from "@/game/store";
import { feedLine, flagEmoji } from "./feedText";
import "./ui.css";

/** どれくらい前か。サーバーと時計がずれて未来になっても「いま」に丸める */
function agoLabel(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  if (ms < 8000) return "いま";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}びょう前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}ふん前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}じかん前`;
  return `${Math.floor(hour / 24)}にち前`;
}

type Row =
  | { kind: "chat"; key: string; at: number; msg: ChatMessage }
  | { kind: "stab"; key: string; at: number; e: StabEvent };

/** コメントと刺しを時刻でまぜて、古い順(= 下が最新)に並べる */
export function mergeRows(
  chat: ChatMessage[],
  stabs: StabEvent[],
  limit: number,
): Row[] {
  const rows: Row[] = [
    ...chat.map((m): Row => ({
      kind: "chat",
      key: `c${m.id}`,
      at: Date.parse(m.at),
      msg: m,
    })),
    ...stabs.map((e): Row => ({
      kind: "stab",
      key: `s${e.at}-${e.holeId}`,
      at: Date.parse(e.at),
      e,
    })),
  ];
  // 新しい順に切ってから、表示のために古い順へひっくり返す
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, limit).reverse();
}

/**
 * スマホのソフトキーボードぶん、チャット欄を持ち上げる。
 * これが無いと、書いている本文がキーボードの裏に隠れて何も見えなくなる。
 * (HUDは position:absolute なので、ページのスクロールでは逃げられない)
 */
function useKeyboardLift(active: boolean) {
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    const apply = () => {
      const lift = active
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      root.style.setProperty("--kk-kb", `${Math.round(lift)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.setProperty("--kk-kb", "0px");
    };
  }, [active]);
}

interface FeedProps {
  /** 「ぜんぶ みる」を押したとき。記録の一覧をひらく */
  onOpenLog: () => void;
}

export default function Feed({ onOpenLog }: FeedProps) {
  const recent = useGameStore((s) => s.recent);
  const chat = useGameStore((s) => s.chat);
  const myStabs = useGameStore((s) => s.myStabs);
  const remoteStabs = useGameStore((s) => s.remoteStabs);
  const sendChat = useGameStore((s) => s.sendChat);
  const sending = useGameStore((s) => s.chatSending);

  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  useKeyboardLift(focused);

  // 経過時間の表示を進めるための時計。1秒ごとの、数行だけの軽い再描画
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = mergeRows(chat, recent, FEED_ROWS);

  const submit = async () => {
    if (composing.current) return; // 変換中のEnterは確定であって送信ではない
    const ok = await sendChat(text);
    if (ok) setText("");
  };

  return (
    <div className={focused ? "feed-wrap is-writing" : "feed-wrap"}>
      <div className="feed-head">
        <span className="feed-live-dot" aria-hidden="true" />
        <span>みんなの コメント</span>
        {/* 流れていったぶんを読み返す逃し口 */}
        <button type="button" className="feed-all" onClick={onOpenLog}>
          ぜんぶ みる
        </button>
      </div>

      <div className="feed" aria-live="polite">
        {rows.length === 0 ? (
          <p className="feed-empty">
            まだ 何も ないよ。さいしょの コメントを かいてみて！
          </p>
        ) : (
          rows.map((row) =>
            row.kind === "chat" ? (
              <div key={row.key} className="feed-row feed-chat">
                <span className="feed-flag" aria-hidden="true">
                  {flagEmoji(row.msg.country)}
                </span>
                <span className="feed-name">{row.msg.name ?? "だれか"}</span>
                <span className="feed-body">{row.msg.body}</span>
              </div>
            ) : (
              <StabRow
                key={row.key}
                e={row.e}
                now={now}
                mine={!row.e.win && myStabs.includes(row.e.holeId)}
                falling={
                  !row.e.win &&
                  remoteStabs.some((r) => r.holeId === row.e.holeId)
                }
              />
            ),
          )
        )}
      </div>

      {/* 入力欄。いちばん下に置くので、書いたものが真上に出てくる */}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="chat-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={CHAT_MAX_LEN}
          placeholder="コメントする"
          aria-label="コメントする"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={sending || text.trim().length === 0}
        >
          {sending ? "…" : "おくる"}
        </button>
      </form>
    </div>
  );
}

/** 月で起きたこと(刺し)の行。コメントより一段しずかに置く */
function StabRow({
  e,
  now,
  mine,
  falling,
}: {
  e: StabEvent;
  now: number;
  mine: boolean;
  falling: boolean;
}) {
  const cls = ["feed-row", "feed-sys"];
  if (e.win) cls.push("feed-win");
  else if (falling) cls.push("feed-live");
  else if (mine) cls.push("feed-mine");

  return (
    <div className={cls.join(" ")}>
      <span className="feed-flag" aria-hidden="true">
        {flagEmoji(e.country)}
      </span>
      <span className="feed-text">{feedLine(e, mine, falling)}</span>
      <span className="feed-hole">#{e.holeId}</span>
      <span className="feed-time">{agoLabel(e.at, now)}</span>
    </div>
  );
}
