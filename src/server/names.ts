// 勝者名のサニタイズとNGワード判定。サーバー専用。
// トロフィーホールに永久に刻まれる名前なので、見えない文字や露骨な言葉は
// ここで確実に弾く(置換はせず、理由を返してクライアントに再入力させる)。

import { NAME_MAX_LEN } from "@/lib/config";

/** sanitizeName の結果。ok:false のとき reason はそのままUIに出せる文言 */
export type NameResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

// 制御文字 (C0/C1・DEL)
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
// ゼロ幅・不可視文字 (SOFT HYPHEN / CGJ / モンゴル語母音区切り / ZWSP〜RLM /
// 行区切り・段落区切り / 双方向制御 / WORD JOINER〜 / BOM)
const INVISIBLE_RE =
  /[\u00ad\u034f\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g;

// 露骨なNGワード(日英)。部分一致で判定する。
// 比較は NFKC 正規化 + 小文字化 + カタカナ→ひらがな + 区切り文字除去後に行うので、
// 「ウンコ」「ｕｎｋｏ」のような表記ゆれもある程度捕まえる。
const NG_WORDS: readonly string[] = [
  // 英語
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "penis",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "slut",
  "rape",
  "porn",
  // 日本語(ひらがなで持ち、入力側をひらがなへ折りたたんで比較)
  "うんこ",
  "ちんこ",
  "ちんぽ",
  "まんこ",
  "きんたま",
  "せっくす",
  "おっぱい",
  "しね",
  "ころす",
  "れいぷ",
  "きちがい",
] as const;

/** カタカナ(ァ..ヶ)をひらがなへ折りたたむ(NGワード比較用) */
function foldKana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

/**
 * 勝者名をサニタイズする。
 * - 制御文字・ゼロ幅文字を除去し、連続空白を1つに畳んで前後をトリム
 * - コードポイント単位(Array.from)で NAME_MAX_LEN 文字に制限
 * - NGワードを含むときは ok:false(保存しない)
 */
export function sanitizeName(raw: unknown): NameResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "なまえをいれてね" };
  }

  let s = raw
    .normalize("NFC")
    .replace(CONTROL_RE, "")
    .replace(INVISIBLE_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  // サロゲートペア(絵文字など)を壊さないようコードポイント単位で切る
  s = Array.from(s).slice(0, NAME_MAX_LEN).join("").trim();
  if (s.length === 0) {
    return { ok: false, reason: "なまえをいれてね" };
  }

  // 表記ゆれを潰してからNGワード判定
  const probe = foldKana(s.normalize("NFKC").toLowerCase()).replace(
    /[\s・._-]/g,
    "",
  );
  for (const word of NG_WORDS) {
    if (probe.includes(word)) {
      return { ok: false, reason: "そのなまえは つかえないよ" };
    }
  }

  return { ok: true, name: s };
}
