// 勝者名のサニタイズとNGワード判定。サーバー専用。
// トロフィーホールに永久に刻まれる名前なので、見えない文字や露骨な言葉は
// ここで確実に弾く(置換はせず、理由を返してクライアントに再入力させる)。

import { CHAT_MAX_LEN, NAME_MAX_LEN } from "@/lib/config";

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

// ── チャット ────────────────────────────────────────
// 名前とちがって「その場で流れて消える」ものだが、世界中の画面に出る点は同じ。
// 名前より少し長く書けるぶん、名前には無い落とし穴を足して塞ぐ:
//   ・URL / メールアドレス(誘導に使われる)
//   ・同じ文字の長い連打(「ｗｗｗｗｗ…」で行を占領する)
//   ・改行(1件で何行も取られると、他の人のコメントが押し出される)

const URL_RE = /(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.[a-z]{2,}|[\w-]+\.(com|net|org|jp|io|co|xyz|shop|link|me|tv|app)\b)/i;

/** 同じ文字が n 回以上つづくか(全角の連打も拾う) */
function hasLongRun(s: string, n: number): boolean {
  const cps = Array.from(s);
  let run = 1;
  for (let i = 1; i < cps.length; i++) {
    if (cps[i] === cps[i - 1]) {
      run++;
      if (run >= n) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

export type ChatCheck =
  | { ok: true; body: string }
  | { ok: false; reason: string };

/**
 * コメント1件をサニタイズする。
 * 名前と同じで、**置換して通すことはしない**(勝手に伏せ字にされるより、
 * 弾いて書き直してもらったほうが本人にも分かる)。
 */
export function sanitizeChat(raw: unknown): ChatCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "なにか かいてね" };
  }

  let s = raw
    .normalize("NFC")
    .replace(CONTROL_RE, "")
    .replace(INVISIBLE_RE, "");
  // 改行もふくめて空白は1つに畳む(1件で何行も取らせない)
  s = s.replace(/\s+/g, " ").trim();
  s = Array.from(s).slice(0, CHAT_MAX_LEN).join("").trim();
  if (s.length === 0) {
    return { ok: false, reason: "なにか かいてね" };
  }

  if (URL_RE.test(s)) {
    return { ok: false, reason: "リンクは かけないよ" };
  }
  if (hasLongRun(s, 12)) {
    return { ok: false, reason: "おなじ文字が おおすぎるよ" };
  }

  const probe = foldKana(s.normalize("NFKC").toLowerCase()).replace(
    /[\s・._-]/g,
    "",
  );
  for (const word of NG_WORDS) {
    if (probe.includes(word)) {
      return { ok: false, reason: "その ことばは かけないよ" };
    }
  }

  return { ok: true, body: s };
}
