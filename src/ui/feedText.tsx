// フィードの1行の文と国旗。左下の流れる4行・「ぜんぶ みる」・右上の通知が
// 同じ言い回しになるように、ここ1か所で作る。

import type { StabEvent } from "@/lib/types";

/** ISO 3166-1 alpha-2 → 国旗絵文字。不明・不正なら 🌍 */
export function flagEmoji(country: string | null): string {
  if (!country || country.length !== 2) return "🌍";
  const up = country.toUpperCase();
  const a = up.charCodeAt(0) - 65;
  const b = up.charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "🌍";
  return String.fromCodePoint(0x1f1e6 + a, 0x1f1e6 + b);
}

/**
 * 「〇〇が 刺した」の一行。
 * 名前があれば、自分の行でもそれを主語にする。自分だけ「きみ」にしていたら、
 * 名前が残っているのかどうかが分からなかった(どれが自分かは行の色で分かる)。
 *
 * @param mine    この端末が刺した穴か
 * @param falling いま3Dで剣が降ってきている最中か
 */
export function feedLine(e: StabEvent, mine: boolean, falling: boolean): string {
  if (e.win) return "あたりを ひいた！！";
  if (falling) return "いま 刺してる…";
  const who = e.name || (mine ? "きみ" : null);
  return who ? `${who}が 刺した` : "だれかが 刺した";
}

/** どのくらい前か。時計がずれて未来になっても「いま」に丸める */
export function agoLabel(at: string, now: number): string {
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
