// ゲーム全体の定数。サーバー/クライアント両方から参照する。

/** 月に開いた剣穴の総数(1ラウンドあたり) */
export const HOLE_COUNT = 1000;

/** 月の半径 (three.js units) */
export const MOON_RADIUS = 5;

/** こすくまくんが刺さっている北極まわりの、穴を置かない角度(度) */
export const POLAR_CAP_DEG = 34;

/** 同一プレイヤーの連続刺し禁止時間(秒) */
export const COOLDOWN_SEC = 30;

/** 状態ポーリング間隔(ms) — /api/state はCDNで3秒キャッシュされる */
export const POLL_MS = 4000;

/** 名前の最大文字数 */
export const NAME_MAX_LEN = 12;

// ── チャット ────────────────────────────────────────
/** 1回に書ける文字数。長い文はチャットの流れを止めるので短く切る */
export const CHAT_MAX_LEN = 60;
/** 連投の間隔(秒)。同じ人が流れを埋めないように */
export const CHAT_COOLDOWN_SEC = 8;
/**
 * 同じ回線(ip_hash)から1分に書ける本数。
 * 端末ごとの間隔とは別に見る。学校や会社のように出口IPを共有している人たちが、
 * お互いの発言でお互いを止めてしまわないよう、間隔ではなく本数で制限する。
 */
export const CHAT_BURST_PER_MIN = 12;

/** サーバーが返す直近のコメント数 */
export const CHAT_FETCH = 30;

/**
 * 運営として出したコメントの id。
 * 個人の名前ではなく「うんえい」として、おしらせの見た目で出す。
 * (書いた本人の名前が入ったままだと、ただの1コメントに見えてしまう)
 */
export const OPERATOR_CHAT_IDS: readonly number[] = [1, 13];

/** 「ぜんぶ みる」で1回にさかのぼる件数 */
export const CHAT_PAGE = 50;
/**
 * 右上の「だれが刺したか」の記録で、一度に見える行数。
 * 携帯だと縦が短く、6行あるとこすくまくんの顔にちょうど重なってしまう。
 * 2行だけ出して、続きは指でさかのぼる。
 */
export const STAB_LOG_ROWS = 2;

/**
 * 左下のチャットで、一度に見える行数(コメントだけ・新しいものが下)。
 * 中身はもっと入っていて、指でさかのぼれる。ここは「箱の高さ」の指定。
 */
export const FEED_ROWS = 4;

// ── 演出タイミング (ms) ──────────────────────────────
export const T_STAB = 1100; // 剣を構えて刺すまで
export const T_SUSPENSE = 1600; // 刺した後の「……」の間
export const T_SAFE = 2200; // セーフ演出
export const T_LAUNCH = 6500; // こすくまくん発射カットシーン
export const T_TROPHY = 4500; // トロフィー授与式
export const T_NEW_ROUND = 3500; // 新こすくまくん降臨

// ── 剣の色(プレイヤーが選べる。indexをAPI/DBに保存する) ──
// 黒ひげ危機一発の「1色成型のプラスチック剣」に合わせた、明るい原色パレット。
// 並び順を変えると過去の剣の色が変わってしまうので、追加は末尾にのみ行うこと。
// 実物のパーツ写真を計測すると 彩度≈87% / 明度≈73%。パステル(彩度59%)では
// 成型プラスチックに見えず、灰色の月面からも分離しないので彩度を上げてある。
// hex を変えると過去に刺された剣の色も変わるが、index の並びは不変なので
// 「どの剣が誰の色か」の対応は壊れない(並び替え・削除だけは禁止)。
export const SWORD_COLORS = [
  { name: "きいろ", hex: "#f5c400" }, // 0: デフォルト(いままでの剣と同じ位置)
  { name: "あか", hex: "#e8402f" },
  { name: "オレンジ", hex: "#f5811f" },
  { name: "みどり", hex: "#2cb865" },
  { name: "みずいろ", hex: "#22b0de" },
  { name: "あお", hex: "#2a62c8" },
  { name: "むらさき", hex: "#8e3fd0" },
  { name: "ピンク", hex: "#ee4f92" },
] as const;

// ── 剣のスキン(こすくまくんを とばした人だけが解放できる) ────────
// index を style バイトの下位3bitに詰めてAPI/DBへ保存する(src/lib/style.ts)。
// 3bit = 最大8種。並び順を変えると過去の剣の見た目が変わるので追加は末尾にのみ。
export interface SwordSkin {
  /** 表示名(ひらがな中心) */
  name: string;
  /** 解放に必要な「とばした回数」。0 = 最初から使える */
  needWins: number;
  /** true = プレイヤーが選んだ SWORD_COLORS で塗る / false = hex 固定 */
  tinted: boolean;
  /** tinted=false のときの固有色 */
  hex: string;
  metalness: number;
  roughness: number;
  /** 自発光の強さ(0=なし)。暗い宇宙でも剣が沈まないように */
  emissive: number;
  /** 1未満で半透明(クリスタル) */
  opacity: number;
  /** 見る角度で色が動く(にじいろ) */
  iridescent: boolean;
  /**
   * きらめきの強さ(0=なし)。刃の上を光の帯がゆっくり流れる。
   * ぎん・きんは「色を変えただけの剣」に見えて、他の人から違いが分からなかった。
   * 金属や宝石は"動く反射"でそれと分かるものなので、遠景でも動きで見分けられるようにした。
   */
  sparkle: number;
  /** UIのラベルにそえる小さな絵文字 */
  emoji: string;
}

export const SWORD_SKINS: readonly SwordSkin[] = [
  {
    name: "ノーマル",
    needWins: 0,
    tinted: true,
    hex: "#ffd93d",
    metalness: 0.04,
    roughness: 0.34,
    // 実測: 実物パーツの明度は74%。0.09 だとレンダー後の剣が47%で
    // 月面(47%)と同値になり、色相でしか分離しなくなる
    emissive: 0.2,
    opacity: 1,
    iridescent: false,
    sparkle: 0,
    emoji: "🗡",
  },
  {
    name: "ぎん",
    needWins: 1,
    tinted: false,
    hex: "#e8eefc",
    metalness: 1,
    roughness: 0.17,
    emissive: 0.05,
    opacity: 1,
    iridescent: false,
    sparkle: 1,
    emoji: "🥈",
  },
  {
    name: "きん",
    needWins: 1,
    tinted: false,
    hex: "#ffd06a",
    metalness: 1,
    roughness: 0.22,
    emissive: 0.1,
    opacity: 1,
    iridescent: false,
    sparkle: 1,
    emoji: "🥇",
  },
  {
    name: "クリスタル",
    needWins: 2,
    tinted: true,
    hex: "#bfe9ff",
    metalness: 0,
    roughness: 0.04,
    emissive: 0.34,
    opacity: 0.58,
    iridescent: false,
    sparkle: 0.85,
    emoji: "💠",
  },
  {
    name: "にじいろ",
    needWins: 3,
    tinted: false,
    hex: "#ffffff",
    metalness: 0.72,
    roughness: 0.14,
    emissive: 0.22,
    opacity: 1,
    iridescent: true,
    sparkle: 1,
    emoji: "🌈",
  },
] as const;

// ── チャーム(刺した本数でたまる、剣にぶら下げる かざり) ──────────
// index+1 を style バイトの上位5bitに詰める(0=チャームなし)。最大31段。
// キーホルダーに付ける「チャーム」。狙いはY2Kのキーチャーム
// (クロムの金具 + つやのある樹脂 + ちょっとダサかわいいモチーフ)。
// 参考: サイコロ・8ボール・きのこ・南京錠・鏡面ハート・アヒル・タッセル。
// ぺたっとしたパステルの図形にすると、とたんに"おしゃれ"から遠ざかる。
export type CharmShape =
  | "dice" // サイコロ
  | "eightball" // ビリヤードの8番
  | "mushroom" // きのこ(赤に白い水玉)
  | "padlock" // 南京錠
  | "heart" // ぷっくりハート(鏡面)
  | "bolt" // いなずま
  | "wing" // つばさ
  | "duck" // アヒル
  | "star" // ぷっくり星
  | "plate" // ネームプレート
  | "tassel" // ひものタッセル
  | "bear" // こすくまくん(おすわり)
  | "bearlie" // こすくまくん ふたり(ねそべり。公式ロゴ)
  | "earth" // ちきゅう(隠し)
  // ── ここから下は、月の向こうを横切るものをつかまえて手に入れる ──
  | "comet" // ながれぼし
  | "rocket" // ロケット
  | "satellite" // じんこうえいせい
  | "ufo"; // UFO

/** チャームの素材。見た目(金属感・透け・つや)を決める */
export type CharmMaterial =
  | "chrome" // 磨いたニッケル。まわりを映す
  | "resin" // つやのある不透明プラスチック
  | "glass" // 透ける樹脂
  | "matte" // つや消し(黒いゴムなど)
  | "fabric"; // ひも・革

export interface Charm {
  /** 獲得に必要な通算の刺し本数。Infinity = 刺しては手に入らない(隠し) */
  need: number;
  name: string;
  emoji: string;
  shape: CharmShape;
  hex: string;
  /** 見た目の素材。金具のクロムと、樹脂のつやを混ぜるのが今回の肝 */
  material: CharmMaterial;
  /** 差し色(水玉・数字・文字など)。無ければ hex だけで作る */
  accentHex?: string;
  /**
   * true = 手に入れるまで存在を隠す。棚にも「?」ではなく空きとして出し、
   * 何本刺しても出てこない(条件を教えない)。
   */
  secret?: boolean;
}

/** need の昇順で並べること(charmLevelOf が前提にしている) */
export const CHARMS: readonly Charm[] = [
  {
    need: 10,
    name: "サイコロ",
    emoji: "🎲",
    shape: "dice",
    hex: "#fbf7ef",
    accentHex: "#2b2620",
    material: "resin",
  },
  {
    need: 20,
    name: "ほし",
    emoji: "⭐️",
    shape: "star",
    hex: "#d9dde6",
    material: "chrome",
  },
  {
    need: 30,
    name: "きのこ",
    emoji: "🍄",
    shape: "mushroom",
    hex: "#e5372c",
    accentHex: "#fffaf2",
    material: "resin",
  },
  {
    need: 40,
    name: "ハート",
    emoji: "💗",
    shape: "heart",
    hex: "#e9edf5",
    material: "chrome",
  },
  {
    need: 50,
    name: "エイトボール",
    emoji: "🎱",
    shape: "eightball",
    hex: "#17161a",
    accentHex: "#fffdf6",
    material: "matte",
  },
  {
    need: 60,
    name: "なんきんじょう",
    emoji: "🔒",
    shape: "padlock",
    hex: "#dbe0e9",
    material: "chrome",
  },
  {
    need: 70,
    name: "アヒル",
    emoji: "🐤",
    shape: "duck",
    hex: "#ffc21f",
    accentHex: "#ff7a2f",
    material: "resin",
  },
  {
    need: 80,
    name: "いなずま",
    emoji: "⚡️",
    shape: "bolt",
    hex: "#e3e8f2",
    material: "chrome",
  },
  {
    need: 100,
    name: "つばさ",
    emoji: "🪽",
    shape: "wing",
    hex: "#cfd5e0",
    material: "chrome",
  },
  {
    need: 150,
    name: "ネームプレート",
    emoji: "🏷",
    shape: "plate",
    hex: "#c9ced9",
    accentHex: "#15161a",
    material: "chrome",
  },
  {
    need: 200,
    name: "タッセル",
    emoji: "🎗",
    shape: "tassel",
    hex: "#f4f2ec",
    accentHex: "#2f2b26",
    material: "fabric",
  },
  {
    need: 300,
    name: "こすくまくん",
    emoji: "🐻",
    shape: "bearlie",
    hex: "#fdf7c1",
    accentHex: "#2b2620",
    material: "resin",
  },
  // ── ここから下は刺して手に入るチャームではない ──
  {
    need: Infinity,
    name: "ちきゅう",
    emoji: "🌏",
    shape: "earth",
    hex: "#4fa8e8",
    accentHex: "#7ed08a",
    material: "glass",
    secret: true,
  },
  // ── 空を横切るものをタップしてつかまえるチャーム ──
  // 刺し本数では絶対に増えない。並び順は SKY_KINDS と対応させること。
  {
    need: Infinity,
    name: "ながれぼし",
    emoji: "☄️",
    shape: "comet",
    hex: "#eaf1ff",
    accentHex: "#7fb6ff",
    material: "glass",
    secret: true,
  },
  {
    need: Infinity,
    name: "ロケット",
    emoji: "🚀",
    shape: "rocket",
    hex: "#f2f4f8",
    accentHex: "#e8402f",
    material: "resin",
    secret: true,
  },
  {
    need: Infinity,
    name: "えいせい",
    emoji: "🛰",
    shape: "satellite",
    hex: "#cdd3de",
    accentHex: "#f5c400",
    material: "chrome",
    secret: true,
  },
  {
    need: Infinity,
    name: "ユーフォー",
    emoji: "🛸",
    shape: "ufo",
    hex: "#c7d6cf",
    accentHex: "#6ef0c0",
    material: "chrome",
    secret: true,
  },
  // ── こすくまくんを POKE_CHARM_NEED 回つついた人だけ ──
  // 300本のほうは ねそべった2匹(ロゴ)。こちらは おすわりの1匹で、
  // 並べたときに一目で違うものだと分かる。
  {
    need: Infinity,
    name: "すわりこすくまくん",
    emoji: "🐻",
    shape: "bear",
    hex: "#fdf7c1",
    accentHex: "#2b2620",
    material: "resin",
    secret: true,
  },
] as const;

/**
 * 剣に同時につけられるチャームの数。
 * 全部つけると房が長くなりすぎて、剣がチャームに埋もれてしまう。
 * 「どれを見せるか選ぶ」のがコレクションの楽しみになる数として10。
 */
export const MAX_EQUIPPED_CHARMS = 10;

/** 刺して手に入るチャームの数(= 隠しチャームを除いた本数)。棚の分母にもなる */
export const NORMAL_CHARM_COUNT = CHARMS.filter((c) => !c.secret).length;

/** 地球を壊した人だけが手に入れる隠しチャーム(CHARMS の index) */
export const EARTH_CHARM_INDEX = CHARMS.findIndex((c) => c.secret);

// ── 月の向こうを横切るもの ────────────────────────────
// 待っているあいだ、ときどき背景を何かが通る。タップするとチャームになる。
// **並び順が style のビット順(bit 8..11)そのもの。並べ替え・削除は禁止。**
export const SKY_KINDS = ["comet", "rocket", "satellite", "ufo"] as const;
export type SkyKind = (typeof SKY_KINDS)[number];

/** SKY_KINDS の index → CHARMS の index */
export const SKY_CHARM_INDEX: readonly number[] = SKY_KINDS.map((k) =>
  CHARMS.findIndex((c) => c.shape === k),
);

/**
 * 空のものを「通算で何こ つかまえたら」チャームが開くか。SKY_KINDS と同じ並び。
 * 昇順で並べること(skyCharmLevelOf が前提にしている)。
 *
 * 1タップ1こだと軽すぎて、チャームがただの参加賞になってしまう。
 * かといって最初の1つが遠すぎると「タップしても何も起きない」で終わるので、
 * 最初だけは1回の待ち時間の積み重ねで届く距離に置いてある。
 */
export const SKY_CATCH_NEED = [10, 30, 50, 100] as const;

/** 通算のつかまえた数から、開いた空のチャームの数(0..SKY_KINDS.length) */
export function skyCharmLevelOf(catches: number): number {
  let n = 0;
  for (const need of SKY_CATCH_NEED) {
    if (catches >= need) n++;
    else break;
  }
  return n;
}

// ── こすくまくんを つつく ────────────────────────────
/** こすくまくんを通算で何回つついたら「かお」のチャームが開くか */
export const POKE_CHARM_NEED = 10000;

/** つつきで手に入る隠しチャーム(CHARMS の index) */
export const POKE_CHARM_INDEX = CHARMS.findIndex((c) => c.shape === "bear");

/** 空のものが飛んでくる間隔(ms)。この幅でランダムに次が決まる */
export const SKY_GAP_MS: [number, number] = [9000, 22000];
/** 待ち時間(クールダウン)中は、退屈しないように間隔を詰める */
export const SKY_GAP_WAITING_MS: [number, number] = [3500, 9000];
/** 1機が画面を横切りきるまで(ms) */
export const SKY_CROSS_MS = 7000;

/** 通算の刺し本数から「刺して手に入れたチャームの数」(0..NORMAL_CHARM_COUNT) */
export function charmLevelOf(total: number): number {
  let n = 0;
  for (const c of CHARMS) {
    if (c.secret) break; // 隠しは刺しでは増えない
    if (total >= c.need) n++;
    else break;
  }
  return n;
}

// ── 他の人の刺しを見せる演出 ─────────────────────────
/** 他の人の剣が降ってきて刺さるまで(ms) */
export const T_REMOTE_STAB = 620;
/** 同時に届いた刺しをずらす間隔(ms) */
export const REMOTE_STAGGER = 300;
/** 一度に演出する最大数(残りは静かに反映) */
export const REMOTE_MAX = 6;

// ── 地球イースターエッグ ─────────────────────────────
/** 地球を何回タップしたら爆発するか */
export const EARTH_BOOM_CLICKS = 1000;
/** 爆発してから地球が再生するまで(ms) */
export const T_EARTH_BOOM = 5200;

// ── こすくまくんの吹き出し ───────────────────────────
/** セリフの既定表示時間(ms) */
export const T_SPEECH = 3200;

// ── パレット ────────────────────────────────────────
export const COLORS = {
  space: "#0a0e2a", // 宇宙の紺
  spaceDeep: "#05071a",
  moon: "#cfd3e8", // 月の淡いグレー
  moonCrater: "#a9aecb",
  kosukuma: "#fdf7c1", // こすくまくんのクリーム
  accent: "#ffd93d", // 星の黄色
  accentPink: "#ffb3c7",
  ui: "#fffef2", // UI地色
  uiText: "#3a3730",
  danger: "#ff6b6b",
  safe: "#7ce38b",
} as const;
