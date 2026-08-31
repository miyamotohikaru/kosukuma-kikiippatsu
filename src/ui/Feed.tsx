"use client";

// 左下のチャット欄。**ここに出るのはみんなが書いたコメントだけ。**
// 月で起きたこと(だれが刺したか)は右上の通知(StabNotice)が受け持つ。
// 同じ箱に混ぜていた時期もあったが、読むもの(コメント)と
// 流し見するもの(刺しの記録)が同居すると、どちらも読みにくくなる。
//
// 並びはYouTubeのライブと同じで**新しいものが下**。いちばん下が入力欄なので、
// 書いた自分のコメントがそのすぐ上に出てくる = 送れたことがその場で分かる。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHAT_MAX_LEN, FEED_ROWS } from "@/lib/config";
import { useGameStore } from "@/game/store";
import { agoLabel, flagEmoji } from "./feedText";
import "./ui.css";

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
  /** 「ぜんぶ みる」を押したとき。コメントの一覧をひらく */
  onOpenLog: () => void;
}

export default function Feed({ onOpenLog }: FeedProps) {
  const chat = useGameStore((s) => s.chat);
  const sendChat = useGameStore((s) => s.sendChat);
  const sending = useGameStore((s) => s.chatSending);

  // 「○ふん前」を進めるための時計。数行だけの軽い再描画
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  useKeyboardLift(focused);

  // store は新しい順に持っている。表示は「新しいものが下」なのでひっくり返す。
  // **見えるのは FEED_ROWS 行ぶんだけで、中身は全部入っている**(指でさかのぼれる)
  const rows = [...chat].reverse();

  // ── いちばん下に貼りつく ──
  // 新しいコメントが来たら下へ送る。ただし**さかのぼって読んでいる最中は
  // 動かさない**(読んでいる途中で勝手に飛ばされるのがいちばん困る)。
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

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

      <div
        className="feed"
        aria-live="polite"
        ref={listRef}
        onScroll={onScroll}
        style={{ ["--feed-rows" as string]: FEED_ROWS }}
      >
        {rows.length === 0 ? (
          <p className="feed-empty">
            まだ 何も ないよ。さいしょの コメントを かいてみて！
          </p>
        ) : (
          rows.map((m) => (
            <div
              key={m.id}
              className={
                m.operator ? "feed-row feed-chat is-op" : "feed-row feed-chat"
              }
            >
              <span className="feed-flag" aria-hidden="true">
                {m.operator ? "📣" : flagEmoji(m.country)}
              </span>
              <span className="feed-name">
                {m.operator ? "うんえい" : (m.name ?? "だれか")}
              </span>
              <span className="feed-body">{m.body}</span>
              <span className="feed-time">{agoLabel(m.at, now)}</span>
            </div>
          ))
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
