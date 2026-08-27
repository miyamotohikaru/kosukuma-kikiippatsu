// 日本語のセリフを「キリの良いところ」で折り返す。
//
// なぜ自前で折るのか:
//   CSSの折り返しは、日本語だとほぼ「どこでも切れる」。
//   助詞の直前で切れたり、句点だけが次の行に落ちたり、1文字だけ残ったりする。
//   吹き出しは2行しかないので、そのズレがそのまま読みにくさになる。
//
// やっていること(3段階):
//   1) 切ってはいけない場所を落とす(禁則)
//        行頭に来ない文字(、。ゃゅょっー々 閉じ括弧)/行末に来ない文字(開き括弧)/
//        「……」の途中/「ん」の直前/促音「っ」の直後
//   2) 残った候補に「切れ味」の点をつける(小さいほど良い切れ目)
//        空白・読点のうしろ=ほぼ0点、助詞のうしろ=中くらい、語の途中=重い
//   3) 費用がいちばん小さい切りかたを、まとめて選ぶ(DP)
//        費用 = Σ(行のかたちの費用) + Σ(切れ味の点)
//        行のかたちは「余りの二乗」。短い行ほど高くつくので、2行に割るときは
//        なるべく均等になり、ぶら下がり1〜2文字の行は出てこない。
//
// セリフに \n が入っているときは、それが最優先(セリフを書いた人の指定)。
// ここでは絶対に無視も移動もしない。長すぎて はみ出す段だけ、その中をさらに自動で折る。
//
// 形態素解析はしない。上の禁則と「助詞のうしろ/表記の変わり目で切る」だけで、
// この長さ(最大30文字ほど)のセリフは じゅうぶんに整う。

// ── 禁則の文字たち ────────────────────────────────────
/** 行のあたまに置けない文字(終わり括弧・句読点・小書きかな・長音符・くり返し記号) */
const NO_LINE_START = new Set(
  "、。，．,.;:；：!?！？‼⁇⁈⁉・･）〕］｝〉》」』】〙〗〟’”｠»)]}ーｰ〜～ゝゞヽヾ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"
);
/** 行のおしりに置けない文字(始まり括弧) */
const NO_LINE_END = new Set("（〔［｛〈《「『【〘〖〝‘“｟«([{");
/** 続けて出たら割ってはいけない文字(「……」を途中で切らない) */
const LEADER = new Set("…‥—―");
/** このうしろは いちばん良い切れ目(文の終わり・読点) */
const SENT_END = new Set("、。，．,.!?！？…‥‼⁇⁈⁉");
/** 閉じ括弧(このうしろも わりと良い切れ目) */
const CLOSE = new Set("）〕］｝〉》」』】〙〗〟’”｠»)]}");
/** 数字(うしろの単位と離さない) */
const DIGIT = new Set("0123456789０１２３４５６７８９");

// ── 助詞まわり ────────────────────────────────────────
// 完璧な判定はできない(「まちがえて」の「が」のような空振りはある)ので、
// 決め手にはせず、手がかりとして使う。語のあたまに出やすい「か」「な」「や」は
// 入れていない(「やめて」を「や|めて」と切ってしまうため)。
/** 1文字の助詞 */
const PARTICLE1 = new Set("はがをにでともへの");
/** 2文字の助詞・つなぎ。1文字より確からしいので点は軽め */
const PARTICLE2 = [
  "から",
  "まで",
  "より",
  "など",
  "ので",
  "のに",
  "でも",
  "ても",
  "には",
  "では",
  "とは",
  "にも",
  "とか",
  "たら",
  "だけ",
  "ほど",
  "しか",
  "こそ",
  "さえ",
  "なら",
  "けど",
  "って",
];

// ── 切れ味の点(小さいほど良い) ────────────────────────
// 行のかたちの費用(=余りの二乗。最大でも160くらい)と同じものさしに載せてある。
// 「語の途中で切る(100)」は「行に2文字しか残らない」のと同じくらい悪い、という重み。
const P_SPACE = 0; // 分かち書きの区切り
const P_SENT = 1; // 、。！？ のうしろ
const P_BRACKET = 5; // 閉じ括弧のうしろ / 開き括弧の前
const P_HIRA_KANJI = 9; // ひらがな→漢字(語のあたまのことが多い)
const P_PARTICLE2 = 14; // 2文字の助詞のうしろ
const P_SCRIPT = 16; // その他の表記の変わり目
const P_PARTICLE1 = 18; // 1文字の助詞のうしろ
const P_KATA_HIRA = 24; // カタカナ→ひらがな
const P_KANJI_KANJI = 85; // 熟語の途中(「時|間」)。語中とみなす
const P_KANJI_HIRA = 45; // 送り仮名の途中かも(語の切れ目のこともある)
const P_OTHER = 60;
const P_HIRA_HIRA = 100; // ひらがなの語中(読みにくい)
const P_NUM_UNIT = 100; // 数字と単位のあいだ(「24|時間」)
const P_KATA_KATA = 115; // カタカナ語の途中(いちばん読みにくい)
/** 英単語の途中。どうやっても はみ出すときの最後の手段 */
const P_ASCII_INNER = 300;
/** 助詞の直前で切ろうとしたときの追加(「ぼく|は……」を避ける) */
const P_BEFORE_PARTICLE = 14;
/** 次の行が「1文字+句読点」で始まるときの追加(「ね。」だけが落ちるのを避ける) */
const P_ORPHAN_PUNCT = 18;

/** これより短い行は作らない(ぶら下がり1〜2文字よけ)。単位は全角文字数 */
const SHORT_LINE = 3;
const P_SHORT_LINE = 120;

/** はみ出しは基本的に許さない。丸め誤差ぶんの余裕だけ残す */
const OVER_BASE = 400;
const OVER_RATE = 900;

/** 1行に入る全角文字数の既定値(測れないときの目安) */
export const DEFAULT_MAX_UNITS = 13;

export interface WrapOptions {
  /** 1行に入る幅。既定の単位は「全角文字の数」 */
  max?: number;
  /** 1文字ぶんの幅(既定: 全角=1・半角=0.5)。実測を渡すときは max も同じ単位で */
  charWidth?: (ch: string) => number;
}

const isSpace = (ch: string) => ch === " " || ch === "\t";

type Script = "hira" | "kata" | "kanji" | "ascii" | "other";

function scriptOf(ch: string): Script {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x3041 && c <= 0x309f) return "hira";
  if ((c >= 0x30a0 && c <= 0x30ff) || (c >= 0xff66 && c <= 0xff9f)) return "kata";
  if (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    c === 0x3005 // 々
  ) {
    return "kanji";
  }
  if (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0xff10 && c <= 0xff5a)
  ) {
    return "ascii";
  }
  return "other";
}

/**
 * 1文字ぶんの幅の目安(全角=1)。
 * 日本語の書体は かな・漢字・全角記号が きっちり1em なので、これで実寸によく合う。
 */
export function charWidthEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 0x20 || c === 0x09) return 0.34; // 半角スペース
  if (c < 0x80) return 0.5; // 英数字・半角記号
  if (c >= 0xff61 && c <= 0xff9f) return 0.5; // 半角カナ
  return 1;
}

/** i の直前が助詞の切れ目か(語のあたまの1文字を助詞と見ないように、手前も見る) */
function particleBreak(chars: string[], i: number): number {
  // 直前の空白・句読点からの ひとかたまりの長さ。短すぎるものは語のあたまなので見送る
  // (「にんじん」の「に」、「はなし」の「は」を助詞と読みちがえないため)
  let run = 0;
  for (let k = i - 1; k >= 0; k--) {
    const ch = chars[k];
    if (isSpace(ch) || SENT_END.has(ch) || CLOSE.has(ch) || NO_LINE_END.has(ch)) break;
    run++;
  }
  if (run >= 3 && PARTICLE2.includes(chars[i - 2] + chars[i - 1])) return P_PARTICLE2;
  if (run >= 4 && PARTICLE1.has(chars[i - 1])) return P_PARTICLE1;
  return Infinity;
}

/** i の直前が「助詞のあたま」か(そこで切ると助詞だけが次の行に落ちる) */
function beforeParticle(chars: string[], i: number): boolean {
  if (PARTICLE1.has(chars[i])) return true;
  const two = chars[i] + (chars[i + 1] ?? "");
  return two.length === 2 && PARTICLE2.includes(two);
}

/**
 * chars[i] の直前で改行するときの費用。Infinity は「ここでは切れない」。
 * 数字が小さいほど、日本語として自然な切れ目。
 */
function breakPenalty(chars: string[], i: number): number {
  const a = chars[i - 1];
  const b = chars[i];

  // ── 切ってはいけないところ ──
  if (isSpace(b)) return Infinity; // 空白の前ではなく、空白のうしろで切る
  if (NO_LINE_START.has(b)) return Infinity; // 行頭禁則
  if (NO_LINE_END.has(a)) return Infinity; // 行末禁則
  if (b === "ん" || b === "ン") return Infinity; // 「ん」から始まる語はない
  if (a === "っ" || a === "ッ") return Infinity; // 促音のうしろは かならず語の途中
  if (LEADER.has(a) && LEADER.has(b)) return Infinity; // 「……」を割らない
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  // 英数字の途中は、はみ出しを避けるためだけの最後の手段
  if (sa === "ascii" && sb === "ascii") return P_ASCII_INNER;

  // ── ここからは良し悪しの点 ──
  if (isSpace(a)) return P_SPACE;
  if (SENT_END.has(a)) return P_SENT;

  let p: number;
  if (CLOSE.has(a) || NO_LINE_END.has(b)) {
    p = P_BRACKET;
  } else {
    const particle = particleBreak(chars, i);
    // 数字と単位は離さない(「24|時間」「1000|個」)
    if (DIGIT.has(a) && sb !== "ascii") p = P_NUM_UNIT;
    else if (sa === "hira" && sb === "kanji") p = P_HIRA_KANJI;
    else if (sa === "kanji" && sb === "hira") p = P_KANJI_HIRA;
    else if (sa === "kanji" && sb === "kanji") p = P_KANJI_KANJI;
    else if (sa === "hira" && sb === "hira") p = P_HIRA_HIRA;
    else if (sa === "kata" && sb === "kata") p = P_KATA_KATA;
    else if (sa === "kata" && sb === "hira") p = P_KATA_HIRA;
    else if (sa === "other" || sb === "other") p = P_OTHER;
    else p = P_SCRIPT;
    // 助詞のうしろなら、そちらの点を採る(文節の切れ目らしいので)
    if (particle < p) p = particle;
  }

  // 助詞の直前で切ると「ぼく / は……」のように意味が切れる
  if (beforeParticle(chars, i)) p += P_BEFORE_PARTICLE;
  // 次の行が「ね。」のように1文字+句読点で始まると、句点だけ落ちたように見える
  const next = chars[i + 1];
  if (next !== undefined && SENT_END.has(next) && !SENT_END.has(b)) p += P_ORPHAN_PUNCT;
  return p;
}

/** 行(chars[i..j))の両はしの空白を落とした範囲 */
function trimRange(chars: string[], i: number, j: number): [number, number] {
  let a = i;
  let b = j;
  while (a < b && isSpace(chars[a])) a++;
  while (b > a && isSpace(chars[b - 1])) b--;
  return [a, b];
}

/** 1段(=\n で区切られたひとかたまり)を折る */
function wrapSegment(src: string, max: number, cw: (ch: string) => number): string[] {
  const chars = [...src]; // サロゲートペア(絵文字)を1文字として扱う
  const n = chars.length;
  if (n === 0) return [""];

  // 幅の累積。行の幅を引き算だけで出せるようにしておく
  const acc: number[] = new Array(n + 1);
  acc[0] = 0;
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + cw(chars[i]);

  // 折ってよい位置と、その切れ味
  const pen: number[] = new Array(n + 1).fill(Infinity);
  for (let i = 1; i < n; i++) pen[i] = breakPenalty(chars, i);

  /** i..j を1行にしたときの「行のかたち」の費用 */
  const lineCost = (i: number, j: number): number => {
    const [a, b] = trimRange(chars, i, j);
    const width = acc[b] - acc[a];
    // 2行以上に割るのに、その1行がやたら短い(ぶら下がり)のは避ける
    const short = width < SHORT_LINE && (i > 0 || j < n) ? P_SHORT_LINE : 0;
    const slack = max - width;
    // 余りの二乗。行が短いほど高くつくので、自然と均等になる
    if (slack >= 0) return short + slack * slack;
    return short + OVER_BASE + OVER_RATE * -slack;
  };

  // best[j] = 先頭から j 文字目までを折り終えたときの最小費用
  const best: number[] = new Array(n + 1).fill(Infinity);
  const from: number[] = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = 0; i < j; i++) {
      if (best[i] === Infinity) continue;
      if (i > 0 && pen[i] === Infinity) continue;
      const c = best[i] + lineCost(i, j) + (i > 0 ? pen[i] : 0);
      if (c < best[j]) {
        best[j] = c;
        from[j] = i;
      }
    }
  }

  // うしろからたどって行に切り出す
  const out: string[] = [];
  for (let j = n; j > 0; ) {
    const i = from[j];
    const [a, b] = trimRange(chars, i, j);
    out.push(chars.slice(a, b).join(""));
    j = i;
  }
  return out.reverse();
}

/**
 * セリフを行の配列にする。
 * \n はセリフを書いた人の指定として、そのまま段の切れ目になる(自動折り返しより強い)。
 * 段が長すぎて はみ出すときだけ、その中をさらに自動で折る。
 */
export function wrapJa(text: string, opts: WrapOptions = {}): string[] {
  const max = opts.max && opts.max > 0 ? opts.max : DEFAULT_MAX_UNITS;
  const cw = opts.charWidth ?? charWidthEm;
  const out: string[] = [];
  for (const seg of text.split(/\r?\n/)) {
    const s = seg.trim();
    // 空の段(先頭や末尾の \n)は、吹き出しに空きが1行できてしまうので落とす
    if (!s) continue;
    for (const line of wrapSegment(s, max, cw)) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

/** wrapJa の結果を、そのまま描ける1つの文字列にしたもの(white-space: pre-wrap むけ) */
export function wrapJaText(text: string, opts: WrapOptions = {}): string {
  return wrapJa(text, opts).join("\n");
}
