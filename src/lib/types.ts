// クライアント/サーバー共有の型定義。APIのレスポンス形はここが正。

/** 直近の刺しイベント(フィード表示用) */
export interface StabEvent {
  holeId: number;
  /** 刺した人のニックネーム。未登録は null → 「だれかが」表示 */
  name: string | null;
  /** ISO 3166-1 alpha-2 (Vercelのgeoヘッダ由来)。不明はnull */
  country: string | null;
  /** ISO8601 */
  at: string;
  win: boolean;
}

/** 過去ラウンドの勝者情報 */
export interface WinnerInfo {
  roundNo: number;
  /** 未入力(クレーム前)は null → 「なまえをきざんでいる…」表示 */
  name: string | null;
  country: string | null;
  wonAt: string;
  holeId: number;
  /** そのラウンドで刺された総数 */
  stabCount: number;
  /**
   * そのトロフィーが引いたくじの版(src/lib/trophy.ts)。
   * 記録が無い(古い代)なら 1。**一度出たトロフィーの姿を固定するための印。**
   */
  trophyV?: number;
}

/** チャットの1件。左下に流れ、「ぜんぶ みる」で読み返せる */
export interface ChatMessage {
  /** サーバーの連番。これが新しさの順番であり、重複排除の鍵でもある */
  id: number;
  /** 書いた人のニックネーム。未登録は null → 「だれか」表示 */
  name: string | null;
  country: string | null;
  body: string;
  /** ISO8601 */
  at: string;
  /** true = 運営からのおしらせ。人の名前は出さない */
  operator?: boolean;
}

/** GET /api/state のレスポンス */
export interface StateResponse {
  roundNo: number;
  startedAt: string;
  /** 現ラウンドで刺された数 */
  stabCount: number;
  /** HOLE_COUNTビットのビットマスクをbase64化したもの。1=刺さっている */
  holesBase64: string;
  /**
   * 各穴の剣の色。Uint8Array(HOLE_COUNT)をbase64化したもの。
   * 0=色情報なし(デフォルト金) / 1..N = SWORD_COLORS のindex+1
   */
  stabColorsBase64: string;
  /**
   * 各穴の剣のスキンとチャーム。Uint8Array(HOLE_COUNT)をbase64化したもの。
   * 詰め方は `src/lib/style.ts` (bit0-2=skin / bit3-7=charm)。0=情報なし。
   */
  stabStylesBase64: string;
  /**
   * 各穴の「つけていたチャームの一覧」。Uint32Array(HOLE_COUNT)をbase64化したもの。
   * 詰め方は `src/lib/style.ts` の packCharmSet。0=記録なし(古い刺し)で、
   * そのときは stabStyles の数から組み立てる。
   */
  stabCharmsBase64: string;
  /** 新しい順・最大12件 */
  recent: StabEvent[];
  /** 直前のラウンドの勝者(roundNo-1)。初代ならnull */
  prevWinner: WinnerInfo | null;
  /** 新しい順・最大 CHAT_FETCH 件のコメント */
  chat: ChatMessage[];
}

/** POST /api/chat のリクエストボディ */
export interface ChatRequest {
  body: string;
  /** クライアント指紋(連投制限に使う) */
  fp: string;
  /** 表示名。省略・空なら「だれか」 */
  nickname?: string;
}

/** POST /api/chat のレスポンス */
export type ChatResult =
  | { result: "ok"; message: ChatMessage }
  | { result: "cooldown"; remainingSec: number }
  | { result: "rejected"; message: string };

/** POST /api/stab のリクエストボディ */
export interface StabRequest {
  holeId: number;
  /** クライアントが見ているラウンド。サーバーと不一致なら 'stale' が返る */
  roundNo: number;
  /** クライアント指紋(localStorageのランダムID) */
  fp: string;
  /** 選んだ剣の色(SWORD_COLORSのindex)。省略時はデフォルト(金) */
  color?: number;
  /** 選んだ剣のスキン(SWORD_SKINSのindex)。省略時は0=ノーマル */
  skin?: number;
  /** そのとき持っていた「刺して集めたチャーム」の数。省略時は0 */
  charm?: number;
  /** 隠しチャーム(地球をこわした人)を持っているか。省略時は false */
  earthCharm?: boolean;
  /** つかまえた「空のもの」チャームのフラグ(SKY_KINDS の順)。省略時は0 */
  skyCharms?: number;
  /**
   * 剣につけていたチャームの一覧(CHARMS の index)。省略時は「記録なし」。
   * 何を選んだかは数では表せないので、一覧そのものを送る。
   */
  charms?: number[];
  /** 左下のフィードに出す名前。省略・空なら「だれかが」のまま */
  nickname?: string;
}

/** POST /api/stab のレスポンス(discriminated union) */
export type StabResult =
  | { result: "safe"; holeId: number; holesBase64: string; stabCount: number }
  | { result: "win"; holeId: number; claimToken: string; roundNo: number }
  | { result: "taken"; holeId: number; holesBase64: string }
  | { result: "cooldown"; remainingSec: number }
  | { result: "stale"; roundNo: number }
  | { result: "error"; message: string };

/** POST /api/claim のリクエストボディ */
export interface ClaimRequest {
  roundNo: number;
  token: string;
  name: string;
}

export interface ClaimResponse {
  ok: boolean;
  name?: string;
  roundNo?: number;
  message?: string;
  /** 失敗理由。bad-name=名前を変えれば再挑戦できる / bad-token=もう成功しない */
  code?: "bad-request" | "bad-name" | "bad-token" | "server-error";
}

/** トロフィー1件(トロフィーホール表示用) */
export interface TrophyRecord {
  roundNo: number;
  name: string;
  country: string | null;
  wonAt: string;
  stabCount: number;
  /** くじの版(記録が無ければ 1)。姿を固定するための印 */
  trophyV?: number;
}

/** GET /api/trophies?offset=N&limit=M のレスポンス */
export interface TrophiesResponse {
  total: number;
  offset: number;
  limit: number;
  items: TrophyRecord[];
}
