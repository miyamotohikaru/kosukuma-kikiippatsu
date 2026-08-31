// サーバー側ストレージ層。DATABASE_URL があれば Neon Postgres、なければ
// プロセス内メモリ(ローカル開発用)を使う。neon() のHTTPクエリは1文単位で
// アトミックなので、マルチステートメントのトランザクションは使わず、
// 勝敗などの整合性は「条件付きUPDATE/INSERT + 一意制約」だけで守る。
//
// 重要: あたり穴 winning_hole はこのモジュールの外(APIレスポンス)へ絶対に出さない。

import { randomBytes, randomInt } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { TROPHY_GEN_VERSION } from "@/lib/trophy";
import {
  CHAT_BURST_PER_MIN,
  CHAT_COOLDOWN_SEC,
  CHAT_FETCH,
  OPERATOR_CHAT_IDS,
  COOLDOWN_SEC,
  HOLE_COUNT,
  SWORD_COLORS,
} from "@/lib/config";
import { emptyMask, setBit } from "@/lib/bitmask";
import type {
  ChatMessage,
  StabEvent,
  TrophyRecord,
  WinnerInfo,
  PlayerRecord,
} from "@/lib/types";

// ── ルートハンドラへ公開する契約 ─────────────────────

/** GET /api/state 用のスナップショット(mask はバイナリのまま。base64化はルート側) */
export interface SnapshotData {
  roundNo: number;
  startedAt: string;
  stabCount: number;
  mask: Uint8Array;
  /** 各穴の剣の色(0=色なし/デフォルト, 1..N=SWORD_COLORSのindex+1) */
  stabColors: Uint8Array;
  /** 各穴の「つけていたチャームの一覧」(src/lib/style.ts の packCharmSet)。0=記録なし */
  stabCharms: Uint32Array;
  /** 各穴の剣のスキン+チャーム(詰め方は src/lib/style.ts)。0=情報なし */
  stabStyles: Uint16Array;
  /** 現ラウンドの新しい順・最大12件 */
  recent: StabEvent[];
  /** 直前ラウンド(roundNo-1)の勝者。初代なら null */
  prevWinner: WinnerInfo | null;
  /** 新しい順・最大 CHAT_FETCH 件のコメント */
  chat: ChatMessage[];
}

/** POST /api/stab の入力(HTTP層で ip_hash 等へ変換済みのもの) */
export interface StabInput {
  holeId: number;
  roundNo: number;
  ipHash: string;
  fp: string;
  country: string | null;
  /** 剣の色(SWORD_COLORSのindex)。未指定は null(デフォルト表示) */
  color: number | null;
  /** スキン+チャームを詰めた2バイト(src/lib/style.ts)。未指定は null */
  style: number | null;
  /** つけていたチャームの一覧(packCharmSet の4バイト)。未指定は null */
  charms: number | null;
  /** フィードに出すニックネーム(サニタイズ済み)。未登録は null */
  nickname: string | null;
}

/** stab の結果。ルートが StabResult(HTTP形)へ変換する */
export type StabOutcome =
  | { kind: "stale"; activeRoundNo: number }
  | { kind: "cooldown"; remainingSec: number }
  | { kind: "taken"; mask: Uint8Array }
  | { kind: "win"; claimToken: string; roundNo: number }
  | { kind: "safe"; mask: Uint8Array; stabCount: number };

export interface ClaimOutcome {
  ok: boolean;
  message?: string;
}

export interface TrophyPage {
  total: number;
  items: TrophyRecord[];
}

export interface IGameStore {
  getSnapshot(): Promise<SnapshotData>;
  /** 穴に刺す。バリデーション済みの入力を受け、勝敗・重複・冷却を判定する */
  stab(input: StabInput): Promise<StabOutcome>;
  /** 勝者名を刻む(token一致 & winner_name 未設定のときだけ成功) */
  claim(roundNo: number, token: string, name: string): Promise<ClaimOutcome>;
  /** won_at が入ったラウンドを新しい順でページング */
  /** 決着済みラウンドを新しい順に。offset 件とばして limit 件返す */
  getTrophies(offset: number, limit: number): Promise<TrophyPage>;
  /** コメントを1件書き込む(検閲は呼び出し側で済ませてある) */
  postChat(input: ChatInput): Promise<ChatOutcome>;
  /** beforeId より古いコメントを新しい順に(「ぜんぶ みる」で さかのぼる用) */
  chatBefore(beforeId: number, limit: number): Promise<ChatMessage[]>;
  /**
   * その端末がとばした代の一覧。**サーバーが持っている記録が正。**
   * あたり穴に刺した行の fp から引く(勝者の fp は kk_stabs にしか無い)。
   */
  wonRoundsOf(fp: string): Promise<number[]>;
  /** 鍵にひもづけて預けてある記録。まだ無ければ null */
  getPlayer(fp: string): Promise<PlayerRecord | null>;
  /**
   * 記録を預ける。**数は大きいほうを採る**(union / max)。
   * 同じ鍵を2台で使っても、あとから開いたほうが古い数で上書きしない。
   */
  savePlayer(fp: string, rec: PlayerRecord): Promise<PlayerRecord>;
}

/** 預かった記録を、後から開いた端末の数で減らさないように合わせる */
export function mergePlayer(a: PlayerRecord, b: PlayerRecord): PlayerRecord {
  return {
    total: Math.max(a.total, b.total),
    earthCharm: a.earthCharm || b.earthCharm,
    skyCatches: Math.max(a.skyCatches, b.skyCatches),
    pokes: Math.max(a.pokes, b.pokes),
    // 名前と見た目は「あとから言ったほう」を採る(数とちがって新しいのが本人の意思)
    nickname: b.nickname ?? a.nickname,
    charms: b.charms || a.charms,
    color: b.color,
    skin: b.skin,
  };
}

// ── 共通ヘルパ ───────────────────────────────────────

/** kk_players の1行 */
interface PlayerRow {
  total: number;
  earth_charm: boolean;
  sky_catches: number;
  pokes: number;
  nickname: string | null;
  charms: number;
  color: number;
  skin: number;
}

const toPlayer = (r: PlayerRow): PlayerRecord => ({
  total: r.total,
  earthCharm: r.earth_charm,
  skyCatches: r.sky_catches,
  pokes: r.pokes,
  nickname: r.nickname,
  charms: r.charms,
  color: r.color,
  skin: r.skin,
});

/** 新ラウンドのあたり穴を暗号乱数で決める(0..HOLE_COUNT-1) */
const newWinningHole = (): number => randomInt(0, HOLE_COUNT);

/** 勝者だけが知るクレームトークン */
const newClaimToken = (): string => randomBytes(16).toString("base64url");

/** neon は timestamptz を Date で返す(生文字列の可能性にも備える) */
const toIso = (v: string | Date): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const toMs = (v: string | Date): number =>
  v instanceof Date ? v.getTime() : new Date(v).getTime();

/** 最終刺し時刻(epoch ms)からクールダウンの残り秒を計算(0なら制限なし) */
function remainingCooldownSec(lastAtMs: number): number {
  const remaining = COOLDOWN_SEC - (Date.now() - lastAtMs) / 1000;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

/**
 * DBの行を ChatMessage へ。運営として出したものは、書いた人の名前を出さずに
 * 「おしらせ」として返す(表示側はこのフラグだけ見ればいい)。
 */
function applyOperator(m: ChatMessage): ChatMessage {
  if (!OPERATOR_CHAT_IDS.includes(m.id)) return m;
  return { ...m, name: null, country: null, operator: true };
}

function toChatMessage(r: {
  id: string | number;
  name: string | null;
  country: string | null;
  body: string;
  created_at: string | Date;
}): ChatMessage {
  return applyOperator({
    id: Number(r.id),
    name: r.name,
    country: r.country,
    body: r.body,
    at: toIso(r.created_at),
  });
}

/** 最終コメント時刻(epoch ms)から連投の残り秒 */
function remainingChatSec(lastAtMs: number): number {
  const remaining = CHAT_COOLDOWN_SEC - (Date.now() - lastAtMs) / 1000;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// ── Postgres 実装 (@neondatabase/serverless の HTTP クライアント) ──

/** kk_rounds の行(必要な列のみ) */
interface RoundRow {
  round_no: number;
  winning_hole: number;
  started_at: string | Date;
  stab_count: number;
}

interface WinnerRow {
  round_no: number;
  winner_name: string | null;
  winner_country: string | null;
  won_at: string | Date;
  winner_hole: number | null;
  stab_count: number;
  /** そのトロフィーが引いたくじの版。null は 1(記録を始める前の代) */
  trophy_v?: number | null;
}

/** アクティブラウンド(winning_hole はサーバー内でのみ扱う) */
interface ActiveRound {
  roundNo: number;
  winningHole: number;
  startedAt: string;
  stabCount: number;
}

class PostgresStore implements IGameStore {
  private sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  /** スキーマは初回アクセス時に一度だけ作成。失敗したら次回リトライ */
  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      const p = this.createSchema();
      p.catch(() => {
        if (this.schemaReady === p) this.schemaReady = null;
      });
      this.schemaReady = p;
    }
    return this.schemaReady;
  }

  private async createSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS kk_rounds (
        id SERIAL PRIMARY KEY,
        round_no INT UNIQUE NOT NULL,
        winning_hole INT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT now(),
        won_at TIMESTAMPTZ,
        winner_name TEXT,
        winner_country TEXT,
        winner_hole INT,
        claim_token TEXT,
        stab_count INT DEFAULT 0
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS kk_stabs (
        round_no INT NOT NULL,
        hole_id INT NOT NULL,
        ip_hash TEXT,
        fp TEXT,
        country TEXT,
        color SMALLINT,
        style SMALLINT,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (round_no, hole_id)
      )`;
    // 既存テーブルへの後付けマイグレーション(既存の刺しは NULL のまま残る)
    await this.sql`ALTER TABLE kk_stabs ADD COLUMN IF NOT EXISTS color SMALLINT`;
    await this.sql`ALTER TABLE kk_stabs ADD COLUMN IF NOT EXISTS style SMALLINT`;
    // style は2バイトに広げた。SMALLINT は符号付きで bit15 が負になるので INT へ移す。
    // ALTER は毎回打つと(変化が無くても)テーブルロックを取るので、
    // まだ smallint のときだけ実行する
    const styleCol = (await this.sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'kk_stabs' AND column_name = 'style'
    `) as { data_type: string }[];
    if (styleCol[0]?.data_type === "smallint") {
      await this.sql`ALTER TABLE kk_stabs ALTER COLUMN style TYPE INT`;
    }
    await this.sql`ALTER TABLE kk_stabs ADD COLUMN IF NOT EXISTS nickname VARCHAR(24)`;
    // 「どのチャームをつけていたか」の一覧(4バイト)。数では表せないので別の列に持つ
    await this.sql`ALTER TABLE kk_stabs ADD COLUMN IF NOT EXISTS charms INT`;
    // 当てた瞬間に、その人のニックネームを winner_name へ先置きするようにした
    // (観客にすぐ「〇〇が とばした！」と出したいため)。そのぶん
    // 「まだ名前を刻んでいない」の目印を winner_name IS NULL では判定できなく
    // なるので、専用の列を足す。既存の刻み済みのぶんは won_at で埋めておく
    const claimedCol = (await this.sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'kk_rounds' AND column_name = 'claimed_at'
    `) as { data_type: string }[];
    if (claimedCol.length === 0) {
        await this.sql`ALTER TABLE kk_rounds ADD COLUMN claimed_at TIMESTAMPTZ`;
      await this.sql`
        UPDATE kk_rounds SET claimed_at = won_at
        WHERE winner_name IS NOT NULL AND claimed_at IS NULL`;
    }
    // トロフィーの姿を永久に固定するための「くじの版」。
    // 既にあるぶんは NULL のまま = 版1(記録を始める前の姿)として読む
    await this.sql`ALTER TABLE kk_rounds ADD COLUMN IF NOT EXISTS trophy_v INT`;
    // コメント。刺しとちがって代をまたいで残す(「ライブのコメント欄」なので、
    // 代が変わっても流れが途切れないほうが自然)
    await this.sql`
      CREATE TABLE IF NOT EXISTS kk_chat (
        id BIGSERIAL PRIMARY KEY,
        round_no INT NOT NULL,
        name VARCHAR(24),
        country TEXT,
        body VARCHAR(80) NOT NULL,
        fp TEXT,
        ip_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
    // その人の記録。**端末ではなく鍵(fp)にひもづける。**
    // 端末のメモは消えるもの(Safari は7日で消す)なので、正はこちらに置く。
    // ここに預けてあるから、ひきつぎコード1つで別の端末にも戻せる
    await this.sql`
      CREATE TABLE IF NOT EXISTS kk_players (
        fp TEXT PRIMARY KEY,
        total INT NOT NULL DEFAULT 0,
        earth_charm BOOLEAN NOT NULL DEFAULT false,
        sky_catches INT NOT NULL DEFAULT 0,
        pokes INT NOT NULL DEFAULT 0,
        nickname VARCHAR(24),
        charms INT NOT NULL DEFAULT 0,
        color SMALLINT NOT NULL DEFAULT 0,
        skin SMALLINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
    await this.sql`CREATE INDEX IF NOT EXISTS kk_chat_id_idx ON kk_chat (id DESC)`;
    await this.sql`CREATE INDEX IF NOT EXISTS kk_chat_fp_idx ON kk_chat (fp, created_at)`;
    // レート制限(直近の刺し検索)用インデックス
    await this.sql`CREATE INDEX IF NOT EXISTS kk_stabs_ip_idx ON kk_stabs (ip_hash, created_at)`;
    await this.sql`CREATE INDEX IF NOT EXISTS kk_stabs_fp_idx ON kk_stabs (fp, created_at)`;
  }

  /** won_at IS NULL のラウンド(=アクティブ)を探す。無ければ null */
  private async findActiveRound(): Promise<ActiveRound | null> {
    const rows = (await this.sql`
      SELECT round_no, winning_hole, started_at, stab_count
      FROM kk_rounds WHERE won_at IS NULL
      ORDER BY round_no ASC LIMIT 1
    `) as RoundRow[];
    const r = rows[0];
    if (!r) return null;
    return {
      roundNo: r.round_no,
      winningHole: r.winning_hole,
      startedAt: toIso(r.started_at),
      stabCount: r.stab_count,
    };
  }

  /** アクティブラウンドを返す。無ければ作る(初回=第1代、または勝利直後の復旧) */
  private async activeRound(): Promise<ActiveRound> {
    const found = await this.findActiveRound();
    if (found) return found;
    // round_no の UNIQUE 制約により、同時実行でも1行しか入らない
    await this.sql`
      INSERT INTO kk_rounds (round_no, winning_hole)
      VALUES ((SELECT coalesce(max(round_no), 0) + 1 FROM kk_rounds), ${newWinningHole()})
      ON CONFLICT (round_no) DO NOTHING
    `;
    const created = await this.findActiveRound();
    if (!created) throw new Error("kk: active round could not be created");
    return created;
  }

  /** そのラウンドの刺さり状態(ビットマスク+色+スキン/チャーム) */
  private async stabsStateOf(
    roundNo: number,
  ): Promise<{
    mask: Uint8Array;
    colors: Uint8Array;
    styles: Uint16Array;
    charms: Uint32Array;
  }> {
    const rows = (await this.sql`
      SELECT hole_id, color, style, charms FROM kk_stabs WHERE round_no = ${roundNo}
    `) as {
      hole_id: number;
      color: number | null;
      style: number | null;
      charms: number | null;
    }[];
    const mask = emptyMask();
    const colors = new Uint8Array(HOLE_COUNT);
    const styles = new Uint16Array(HOLE_COUNT);
    const charms = new Uint32Array(HOLE_COUNT);
    for (const r of rows) {
      if (r.hole_id < 0 || r.hole_id >= HOLE_COUNT) continue;
      setBit(mask, r.hole_id);
      if (r.color !== null && r.color >= 0 && r.color < 255) {
        colors[r.hole_id] = r.color + 1;
      }
      if (r.style !== null && r.style > 0 && r.style <= 0xffff) {
        styles[r.hole_id] = r.style;
      }
      // charms は bit30 まで使う。INT は符号つきなので念のため 0 以上だけ通す
      if (r.charms !== null && r.charms > 0) charms[r.hole_id] = r.charms >>> 0;
    }
    return { mask, colors, styles, charms };
  }

  private async maskOf(roundNo: number): Promise<Uint8Array> {
    return (await this.stabsStateOf(roundNo)).mask;
  }

  /** 現ラウンドの新しい順12件。アクティブラウンドに勝ちの刺しは存在しない
   *  (当たった瞬間に次ラウンドがアクティブになる)ので win は常に false */
  private async recentOf(roundNo: number): Promise<StabEvent[]> {
    const rows = (await this.sql`
      SELECT hole_id, country, created_at, nickname FROM kk_stabs
      WHERE round_no = ${roundNo}
      ORDER BY created_at DESC LIMIT 12
    `) as {
      hole_id: number;
      country: string | null;
      created_at: string | Date;
      nickname: string | null;
    }[];
    return rows.map((r) => ({
      holeId: r.hole_id,
      name: r.nickname ?? null,
      country: r.country,
      at: toIso(r.created_at),
      win: false,
    }));
  }

  /** 新しい順の直近コメント。代はまたいで残す */
  private async chatOf(): Promise<ChatMessage[]> {
    const rows = (await this.sql`
      SELECT id, name, country, body, created_at FROM kk_chat
      ORDER BY id DESC LIMIT ${CHAT_FETCH}
    `) as {
      id: string | number;
      name: string | null;
      country: string | null;
      body: string;
      created_at: string | Date;
    }[];
    // BIGSERIAL は文字列で返ることがある。id は並び順と重複排除の鍵なので必ず数値へ
    return rows.map(toChatMessage);
  }

  /** 指定ラウンドの勝者情報。未決着・存在しないなら null */
  private async winnerOf(roundNo: number): Promise<WinnerInfo | null> {
    if (roundNo < 1) return null;
    const rows = (await this.sql`
      SELECT round_no, winner_name, winner_country, won_at, winner_hole,
             stab_count, trophy_v
      FROM kk_rounds
      WHERE round_no = ${roundNo} AND won_at IS NOT NULL
    `) as WinnerRow[];
    const r = rows[0];
    if (!r) return null;
    return {
      roundNo: r.round_no,
      name: r.winner_name,
      country: r.winner_country,
      wonAt: toIso(r.won_at),
      holeId: r.winner_hole ?? 0,
      stabCount: r.stab_count,
      trophyV: r.trophy_v ?? 1,
    };
  }

  async getSnapshot(): Promise<SnapshotData> {
    await this.ensureSchema();
    const active = await this.activeRound();
    const [stabs, recent, prevWinner, chat] = await Promise.all([
      this.stabsStateOf(active.roundNo),
      this.recentOf(active.roundNo),
      this.winnerOf(active.roundNo - 1),
      this.chatOf(),
    ]);
    return {
      roundNo: active.roundNo,
      startedAt: active.startedAt,
      stabCount: active.stabCount,
      mask: stabs.mask,
      stabColors: stabs.colors,
      stabStyles: stabs.styles,
      stabCharms: stabs.charms,
      recent,
      prevWinner,
      chat,
    };
  }

  /** 同一 ip_hash / fp の直近刺しからクールダウン残り秒を返す */
  private async cooldownOf(ipHash: string, fp: string): Promise<number> {
    const rows = (await this.sql`
      SELECT greatest(
        (SELECT max(created_at) FROM kk_stabs WHERE ip_hash = ${ipHash}),
        (SELECT max(created_at) FROM kk_stabs WHERE fp = ${fp})
      ) AS last_at
    `) as { last_at: string | Date | null }[];
    const lastAt = rows[0]?.last_at;
    if (!lastAt) return 0;
    return remainingCooldownSec(toMs(lastAt));
  }

  async stab(input: StabInput): Promise<StabOutcome> {
    await this.ensureSchema();
    const active = await this.activeRound();

    // クライアントの見ているラウンドが古い
    if (input.roundNo !== active.roundNo) {
      return { kind: "stale", activeRoundNo: active.roundNo };
    }

    // レート制限(ベストエフォート。厳密な排他は不要)
    const remainingSec = await this.cooldownOf(input.ipHash, input.fp);
    if (remainingSec > 0) return { kind: "cooldown", remainingSec };

    // 刺す。INSERT とカウント加算を1文(CTE)で行いアトミックに。
    // PK(round_no, hole_id) 衝突なら ins が0行 → UPDATE も0行 = 先客あり
    const inserted = (await this.sql.query(
      `WITH ins AS (
         INSERT INTO kk_stabs (round_no, hole_id, ip_hash, fp, country, color, style, nickname, charms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (round_no, hole_id) DO NOTHING
         RETURNING hole_id
       )
       UPDATE kk_rounds SET stab_count = stab_count + 1
       WHERE round_no = $1 AND EXISTS (SELECT 1 FROM ins)
       RETURNING stab_count`,
      [
        input.roundNo,
        input.holeId,
        input.ipHash,
        input.fp,
        input.country,
        input.color,
        input.style,
        input.nickname,
        input.charms,
      ],
    )) as { stab_count: number }[];

    if (inserted.length === 0) {
      // 先客あり。ただし「あたり穴が刺さっているのに未決着」は、勝利確定
      // (won_at更新)の直前にプロセスが落ちた残骸で、放置するとラウンドが
      // 永久に決着しない。直後の同時アクセスと区別するため、先客の刺しが
      // 10秒以上前のときだけ、いまの挑戦者を勝者として復旧させる。
      if (input.holeId === active.winningHole) {
        const orphaned = (await this.sql`
          SELECT 1 FROM kk_stabs
          WHERE round_no = ${active.roundNo} AND hole_id = ${input.holeId}
            AND created_at < now() - interval '10 seconds'
        `) as unknown[];
        if (orphaned.length > 0) {
          const outcome = await this.tryWin(active.roundNo, input);
          if (outcome) return outcome;
        }
      }
      return { kind: "taken", mask: await this.maskOf(active.roundNo) };
    }
    const stabCount = inserted[0].stab_count;

    // あたり判定
    if (input.holeId === active.winningHole) {
      const outcome = await this.tryWin(active.roundNo, input);
      if (outcome) return outcome;
    }

    return { kind: "safe", mask: await this.maskOf(active.roundNo), stabCount };
  }

  /**
   * 勝利の確定を試みる。won_at IS NULL の条件付きUPDATEで、勝てるのは
   * 必ず1人だけ。勝てたら次の代のラウンドも用意する。
   */
  private async tryWin(
    roundNo: number,
    input: StabInput,
  ): Promise<Extract<StabOutcome, { kind: "win" }> | null> {
    const token = newClaimToken();
    // 名前を刻む前でも、観客の画面に「〇〇が とばした！」と出せるように、
    // 刺すときに送られてきたニックネームをそのまま置いておく。
    // 当てた本人はこのあと名前を入れ直せる(claimed_at がその目印)
    const won = (await this.sql`
      UPDATE kk_rounds
      SET won_at = now(),
          claim_token = ${token},
          winner_country = ${input.country},
          winner_hole = ${input.holeId},
          winner_name = ${input.nickname},
          trophy_v = ${TROPHY_GEN_VERSION}
      WHERE round_no = ${roundNo} AND won_at IS NULL
      RETURNING round_no
    `) as { round_no: number }[];
    if (won.length === 0) return null;
    // 次の代のこすくまくんを用意(既にあれば何もしない)
    await this.sql`
      INSERT INTO kk_rounds (round_no, winning_hole)
      VALUES (${roundNo + 1}, ${newWinningHole()})
      ON CONFLICT (round_no) DO NOTHING
    `;
    return { kind: "win", claimToken: token, roundNo };
  }

  async postChat(input: ChatInput): Promise<ChatOutcome> {
    await this.ensureSchema();
    // 連投制限。ベストエフォート(厳密な排他は要らない)。
    // **端末(fp)は間隔で、回線(ip_hash)は1分あたりの本数で見る。**
    // 回線でも間隔を見ると、学校や会社のように出口IPを共有している人たちが
    // お互いの発言でお互いを止めてしまう
    const limits = (await this.sql`
      SELECT
        max(created_at) FILTER (WHERE fp = ${input.fp}) AS mine,
        count(*) FILTER (WHERE ip_hash = ${input.ipHash}) AS burst
      FROM kk_chat
      WHERE created_at > now() - interval '1 minute'
        AND (fp = ${input.fp} OR ip_hash = ${input.ipHash})
    `) as { mine: string | Date | null; burst: string | number }[];
    const mine = limits[0]?.mine;
    if (mine) {
      const remainingSec = remainingChatSec(toMs(mine));
      if (remainingSec > 0) return { kind: "cooldown", remainingSec };
    }
    if (Number(limits[0]?.burst ?? 0) >= CHAT_BURST_PER_MIN) {
      return { kind: "cooldown", remainingSec: 20 };
    }

    const rows = (await this.sql`
      INSERT INTO kk_chat (round_no, name, country, body, fp, ip_hash)
      VALUES (${input.roundNo}, ${input.name}, ${input.country}, ${input.body},
              ${input.fp}, ${input.ipHash})
      RETURNING id, created_at
    `) as { id: string | number; created_at: string | Date }[];
    const r = rows[0];
    return {
      kind: "ok",
      message: {
        id: Number(r.id),
        name: input.name,
        country: input.country,
        body: input.body,
        at: toIso(r.created_at),
      },
    };
  }

  async chatBefore(beforeId: number, limit: number): Promise<ChatMessage[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, name, country, body, created_at FROM kk_chat
      WHERE id < ${beforeId}
      ORDER BY id DESC LIMIT ${limit}
    `) as {
      id: string | number;
      name: string | null;
      country: string | null;
      body: string;
      created_at: string | Date;
    }[];
    return rows.map(toChatMessage);
  }

  async wonRoundsOf(fp: string): Promise<number[]> {
    await this.ensureSchema();
    // 決着したラウンドの「あたり穴に刺した行」が、その代をとばした人。
    // kk_rounds には勝者の fp が無いので、kk_stabs と突き合わせて引く
    const rows = (await this.sql`
      SELECT r.round_no FROM kk_rounds r
      JOIN kk_stabs s
        ON s.round_no = r.round_no AND s.hole_id = r.winner_hole
      WHERE r.won_at IS NOT NULL AND s.fp = ${fp}
      ORDER BY r.round_no
    `) as { round_no: number }[];
    return rows.map((r) => r.round_no);
  }

  async getPlayer(fp: string): Promise<PlayerRecord | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT total, earth_charm, sky_catches, pokes, nickname, charms, color, skin
      FROM kk_players WHERE fp = ${fp}`) as PlayerRow[];
    return rows.length > 0 ? toPlayer(rows[0]) : null;
  }

  async savePlayer(fp: string, rec: PlayerRecord): Promise<PlayerRecord> {
    await this.ensureSchema();
    // 数は GREATEST で大きいほうを残す。2台で同じ鍵を使っても減らない
    const rows = (await this.sql`
      INSERT INTO kk_players
        (fp, total, earth_charm, sky_catches, pokes, nickname, charms, color, skin, updated_at)
      VALUES (${fp}, ${rec.total}, ${rec.earthCharm}, ${rec.skyCatches}, ${rec.pokes},
              ${rec.nickname}, ${rec.charms}, ${rec.color}, ${rec.skin}, now())
      ON CONFLICT (fp) DO UPDATE SET
        total       = GREATEST(kk_players.total, EXCLUDED.total),
        earth_charm = kk_players.earth_charm OR EXCLUDED.earth_charm,
        sky_catches = GREATEST(kk_players.sky_catches, EXCLUDED.sky_catches),
        pokes       = GREATEST(kk_players.pokes, EXCLUDED.pokes),
        nickname    = COALESCE(EXCLUDED.nickname, kk_players.nickname),
        charms      = CASE WHEN EXCLUDED.charms <> 0 THEN EXCLUDED.charms ELSE kk_players.charms END,
        color       = EXCLUDED.color,
        skin        = EXCLUDED.skin,
        updated_at  = now()
      RETURNING total, earth_charm, sky_catches, pokes, nickname, charms, color, skin`) as PlayerRow[];
    return toPlayer(rows[0]);
  }

  async claim(roundNo: number, token: string, name: string): Promise<ClaimOutcome> {
    await this.ensureSchema();
    // token一致 & 未クレームのときだけ1行更新される(条件付きUPDATEで排他)
    const rows = (await this.sql`
      UPDATE kk_rounds SET winner_name = ${name}, claimed_at = now()
      WHERE round_no = ${roundNo}
        AND claim_token = ${token}
        AND won_at IS NOT NULL
        AND claimed_at IS NULL
      RETURNING round_no
    `) as { round_no: number }[];
    if (rows.length === 0) {
      return { ok: false, message: "トークンがちがうか、もう名前が刻まれているよ" };
    }
    return { ok: true };
  }

  async getTrophies(offset: number, limit: number): Promise<TrophyPage> {
    await this.ensureSchema();
    const [totalRaw, itemsRaw] = await Promise.all([
      this.sql`
        SELECT count(*)::int AS total FROM kk_rounds WHERE won_at IS NOT NULL
      `,
      this.sql`
        SELECT round_no, winner_name, winner_country, won_at, stab_count, trophy_v
        FROM kk_rounds WHERE won_at IS NOT NULL
        ORDER BY won_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    ]);
    const totalRows = totalRaw as { total: number }[];
    const itemRows = itemsRaw as WinnerRow[];
    return {
      total: totalRows[0]?.total ?? 0,
      items: itemRows.map((r) => ({
        roundNo: r.round_no,
        name: r.winner_name ?? "ななしさん",
        country: r.winner_country,
        wonAt: toIso(r.won_at),
        stabCount: r.stab_count,
        trophyV: r.trophy_v ?? 1,
      })),
    };
  }
}

// ── メモリ実装 (DATABASE_URL 無しのローカル開発用) ─────

interface MemRound {
  roundNo: number;
  winningHole: number;
  startedAt: number; // epoch ms
  wonAt: number | null;
  winnerName: string | null;
  winnerCountry: string | null;
  winnerHole: number | null;
  claimToken: string | null;
  /** くじの版(トロフィーの姿を固定する印) */
  trophyV: number;
  /** 名前を刻んだ時刻。null = まだ本人が入れていない(先置きの名前かも) */
  claimedAt: number | null;
  stabCount: number;
}

interface MemStab {
  holeId: number;
  /** 刺した端末。とばした代を引き当てるのに使う */
  fp: string;
  country: string | null;
  color: number | null;
  style: number | null;
  charms: number | null;
  nickname: string | null;
  at: number; // epoch ms
}

/** POST /api/chat がサーバーへ渡すもの(検閲ずみの本文) */
export interface ChatInput {
  roundNo: number;
  body: string;
  name: string | null;
  country: string | null;
  fp: string;
  ipHash: string;
}

export type ChatOutcome =
  | { kind: "ok"; message: ChatMessage }
  | { kind: "cooldown"; remainingSec: number };

interface MemoryData {
  rounds: MemRound[];
  /** roundNo → (holeId → 刺し)。Postgres の PK(round_no, hole_id) に相当 */
  stabs: Map<number, Map<number, MemStab>>;
  lastByIp: Map<string, number>;
  lastByFp: Map<string, number>;
  /** コメント(新しい順)。開発用の揮発ストアなので、プロセスが落ちれば消える */
  chat: ChatMessage[];
  chatSeq: number;
  /** 回線ごとの直近の書き込み時刻(1分の本数を数えるため) */
  chatByIp: Map<string, number[]>;
  /** 端末ごとの最終書き込み時刻 */
  chatByFp: Map<string, number>;
  /** 鍵ごとの記録(ひきつぎコードで引くもの) */
  players: Map<string, PlayerRecord>;
}

function newMemRound(roundNo: number): MemRound {
  return {
    roundNo,
    winningHole: newWinningHole(),
    startedAt: Date.now(),
    wonAt: null,
    winnerName: null,
    winnerCountry: null,
    winnerHole: null,
    claimToken: null,
    trophyV: TROPHY_GEN_VERSION,
    claimedAt: null,
    stabCount: 0,
  };
}

function memWinnerInfo(r: MemRound): WinnerInfo {
  return {
    roundNo: r.roundNo,
    name: r.winnerName,
    country: r.winnerCountry,
    wonAt: new Date(r.wonAt ?? 0).toISOString(),
    holeId: r.winnerHole ?? 0,
    stabCount: r.stabCount,
    trophyV: r.trophyV,
  };
}

class MemoryStore implements IGameStore {
  private data: MemoryData = {
    rounds: [],
    stabs: new Map(),
    lastByIp: new Map(),
    lastByFp: new Map(),
    chat: [],
    chatSeq: 0,
    chatByIp: new Map(),
    chatByFp: new Map(),
    players: new Map(),
  };

  private activeRound(): MemRound {
    const unwon = this.data.rounds
      .filter((r) => r.wonAt === null)
      .sort((a, b) => a.roundNo - b.roundNo);
    if (unwon.length > 0) return unwon[0];
    const maxNo = this.data.rounds.reduce((m, r) => Math.max(m, r.roundNo), 0);
    const round = newMemRound(maxNo + 1);
    this.data.rounds.push(round);
    return round;
  }

  private stabsOf(roundNo: number): Map<number, MemStab> {
    let m = this.data.stabs.get(roundNo);
    if (!m) {
      m = new Map();
      this.data.stabs.set(roundNo, m);
    }
    return m;
  }

  private maskOf(roundNo: number): Uint8Array {
    const mask = emptyMask();
    for (const holeId of this.stabsOf(roundNo).keys()) {
      if (holeId >= 0 && holeId < HOLE_COUNT) setBit(mask, holeId);
    }
    return mask;
  }

  private colorsOf(roundNo: number): Uint8Array {
    const colors = new Uint8Array(HOLE_COUNT);
    for (const s of this.stabsOf(roundNo).values()) {
      if (s.holeId < 0 || s.holeId >= HOLE_COUNT) continue;
      if (s.color !== null && s.color >= 0 && s.color < SWORD_COLORS.length) {
        colors[s.holeId] = s.color + 1;
      }
    }
    return colors;
  }

  private charmsOf(roundNo: number): Uint32Array {
    const charms = new Uint32Array(HOLE_COUNT);
    for (const s of this.stabsOf(roundNo).values()) {
      if (s.holeId < 0 || s.holeId >= HOLE_COUNT) continue;
      if (s.charms !== null && s.charms > 0) charms[s.holeId] = s.charms >>> 0;
    }
    return charms;
  }

  private stylesOf(roundNo: number): Uint16Array {
    const styles = new Uint16Array(HOLE_COUNT);
    for (const s of this.stabsOf(roundNo).values()) {
      if (s.holeId < 0 || s.holeId >= HOLE_COUNT) continue;
      if (s.style !== null && s.style > 0 && s.style <= 0xffff) {
        styles[s.holeId] = s.style;
      }
    }
    return styles;
  }

  async getSnapshot(): Promise<SnapshotData> {
    const active = this.activeRound();
    const recent: StabEvent[] = [...this.stabsOf(active.roundNo).values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, 12)
      .map((s) => ({
        holeId: s.holeId,
        name: s.nickname ?? null,
        country: s.country,
        at: new Date(s.at).toISOString(),
        win: false, // アクティブラウンドに勝ちの刺しは存在しない
      }));
    const prev =
      this.data.rounds.find(
        (r) => r.roundNo === active.roundNo - 1 && r.wonAt !== null,
      ) ?? null;
    return {
      roundNo: active.roundNo,
      startedAt: new Date(active.startedAt).toISOString(),
      stabCount: active.stabCount,
      mask: this.maskOf(active.roundNo),
      stabColors: this.colorsOf(active.roundNo),
      stabStyles: this.stylesOf(active.roundNo),
      stabCharms: this.charmsOf(active.roundNo),
      recent,
      prevWinner: prev ? memWinnerInfo(prev) : null,
      chat: this.data.chat.slice(0, CHAT_FETCH).map(applyOperator),
    };
  }

  async stab(input: StabInput): Promise<StabOutcome> {
    const active = this.activeRound();

    if (input.roundNo !== active.roundNo) {
      return { kind: "stale", activeRoundNo: active.roundNo };
    }

    // レート制限
    const last = Math.max(
      this.data.lastByIp.get(input.ipHash) ?? 0,
      this.data.lastByFp.get(input.fp) ?? 0,
    );
    if (last > 0) {
      const remainingSec = remainingCooldownSec(last);
      if (remainingSec > 0) return { kind: "cooldown", remainingSec };
    }

    // 刺す(同じ穴は1人だけ)
    const stabs = this.stabsOf(active.roundNo);
    if (stabs.has(input.holeId)) {
      return { kind: "taken", mask: this.maskOf(active.roundNo) };
    }
    const now = Date.now();
    stabs.set(input.holeId, {
      holeId: input.holeId,
      fp: input.fp,
      country: input.country,
      color: input.color,
      style: input.style,
      charms: input.charms,
      nickname: input.nickname,
      at: now,
    });
    active.stabCount += 1;
    this.data.lastByIp.set(input.ipHash, now);
    this.data.lastByFp.set(input.fp, now);

    // あたり判定
    if (input.holeId === active.winningHole && active.wonAt === null) {
      const token = newClaimToken();
      active.wonAt = now;
      active.claimToken = token;
      active.winnerCountry = input.country;
      active.winnerHole = input.holeId;
      // ニックネームを先置き(本人はこのあと入れ直せる)
      active.winnerName = input.nickname;
      // 次の代のこすくまくんを用意
      this.data.rounds.push(newMemRound(active.roundNo + 1));
      return { kind: "win", claimToken: token, roundNo: active.roundNo };
    }

    return {
      kind: "safe",
      mask: this.maskOf(active.roundNo),
      stabCount: active.stabCount,
    };
  }

  async postChat(input: ChatInput): Promise<ChatOutcome> {
    const last = this.data.chatByFp.get(input.fp) ?? 0;
    if (last > 0) {
      const remainingSec = remainingChatSec(last);
      if (remainingSec > 0) return { kind: "cooldown", remainingSec };
    }
    const now = Date.now();
    // 回線ごとは「1分に何本まで」(共有IPの人どうしが止め合わないように)
    const burst = (this.data.chatByIp.get(input.ipHash) ?? []).filter(
      (t) => now - t < 60_000,
    );
    if (burst.length >= CHAT_BURST_PER_MIN) {
      return { kind: "cooldown", remainingSec: 20 };
    }
    const message: ChatMessage = {
      id: ++this.data.chatSeq,
      name: input.name,
      country: input.country,
      body: input.body,
      at: new Date(now).toISOString(),
    };
    // 新しい順に持つ。あふれたぶんは捨てる(この実装は開発用の揮発ストア)
    this.data.chat.unshift(message);
    if (this.data.chat.length > CHAT_FETCH * 4) this.data.chat.length = CHAT_FETCH * 4;
    this.data.chatByFp.set(input.fp, now);
    this.data.chatByIp.set(input.ipHash, [...burst, now]);
    return { kind: "ok", message };
  }

  async chatBefore(beforeId: number, limit: number): Promise<ChatMessage[]> {
    return this.data.chat
      .filter((m) => m.id < beforeId)
      .slice(0, limit)
      .map(applyOperator);
  }

  async wonRoundsOf(fp: string): Promise<number[]> {
    const out: number[] = [];
    for (const r of this.data.rounds) {
      if (r.wonAt === null || r.winnerHole === null) continue;
      const stab = this.stabsOf(r.roundNo).get(r.winnerHole);
      if (stab && stab.fp === fp) out.push(r.roundNo);
    }
    return out.sort((a, b) => a - b);
  }

  async getPlayer(fp: string): Promise<PlayerRecord | null> {
    return this.data.players.get(fp) ?? null;
  }

  async savePlayer(fp: string, rec: PlayerRecord): Promise<PlayerRecord> {
    const prev = this.data.players.get(fp);
    const next = prev ? mergePlayer(prev, rec) : rec;
    this.data.players.set(fp, next);
    return next;
  }

  async claim(roundNo: number, token: string, name: string): Promise<ClaimOutcome> {
    const r = this.data.rounds.find(
      (x) => x.roundNo === roundNo && x.wonAt !== null && x.claimToken === token,
    );
    if (!r) return { ok: false, message: "トークンがちがうよ" };
    if (r.claimedAt !== null) {
      return { ok: false, message: "もう名前が刻まれているよ" };
    }
    r.winnerName = name;
    r.claimedAt = Date.now();
    return { ok: true };
  }

  async getTrophies(offset: number, limit: number): Promise<TrophyPage> {
    const won = this.data.rounds
      .filter((r) => r.wonAt !== null)
      .sort((a, b) => (b.wonAt ?? 0) - (a.wonAt ?? 0));
    return {
      total: won.length,
      items: won.slice(offset, offset + limit).map((r) => ({
        roundNo: r.roundNo,
        name: r.winnerName ?? "ななしさん",
        country: r.winnerCountry,
        wonAt: new Date(r.wonAt ?? 0).toISOString(),
        stabCount: r.stabCount,
        trophyV: r.trophyV,
      })),
    };
  }
}

// ── ファクトリ ───────────────────────────────────────

// Next.js はルートごとにモジュールを分割バンドルするため、シングルトンは
// globalThis に載せてプロセス内で共有する(dev のHMRでも状態が消えない)
type StoreGlobal = typeof globalThis & {
  __kkPgStore?: PostgresStore;
  __kkMemStore?: MemoryStore;
};

/** DATABASE_URL があれば Postgres、なければメモリのストアを返す */
export function getStore(): IGameStore {
  const g = globalThis as StoreGlobal;
  const url = process.env.DATABASE_URL;
  if (url) {
    if (!g.__kkPgStore) g.__kkPgStore = new PostgresStore(url);
    return g.__kkPgStore;
  }
  if (!g.__kkMemStore) g.__kkMemStore = new MemoryStore();
  return g.__kkMemStore;
}
