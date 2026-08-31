// GET /api/me?fp=... — その端末の「とばした代」をサーバーから返す。
//
// なぜ要るか: とばした回数は端末のメモ(localStorage)だけに書いていた。
// つまり **勝ったのに剣がもらえない道** がいくつもあった:
//   ・当たった直後にタブが落ちた/閉じた(サーバーには記録が残る)
//   ・メモの書き込みに失敗した(プライベートモードなど)
//   ・**メモそのものが消えた**(いちばん多い。下の節)
// サーバーが持っている記録を正にして、開くたびに合わせにいく。
//
// ── 目じるしを cookie にも置く ─────────────────────────
// 記録を引き当てる鍵は fp(端末ごとのランダムID)で、これも localStorage に
// 置いていた。ところが Safari は「**スクリプトが書いた保存は7日で消す**」ので、
// 1週間あければ鍵ごと消えて、勝った記録にたどり着けなくなる。
// **サーバーが Set-Cookie で置いた HttpOnly の cookie はこの7日制限の外**
// なので、同じ fp を cookie にも預けておく。localStorage が消えても、
// cookie が残っていれば剣は戻る。
//
// ── 記録そのものもサーバーに預ける ─────────────────────
// 剣・本数・チャームまで端末のメモだけに置いていたので、消えれば全部消えた。
// POST でこの口に預けておくと、鍵さえ通じればどの端末でも戻せる
// (= したく引き出しの「ひきつぎコード」)。
//
// **/api/state はCDNで配るので、ここに個人の記録は混ぜられない。**
// この口だけ no-store で分けてある。

import { NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { sanitizeName } from "@/server/names";
import { CHARM_SET_MARK } from "@/lib/style";
import { SWORD_COLORS, SWORD_SKINS } from "@/lib/config";
import type { PlayerRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 目じるしの cookie 名と寿命(Safariの上限が400日なので、その手前) */
const ID_COOKIE = "kk_id";
const ID_MAX_AGE = 60 * 60 * 24 * 390;

/** Cookie ヘッダから1つ取り出す */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** fp として通していい形か(nanoid 相当の英数字・記号2種だけ) */
function validFp(v: string | null): v is string {
  return !!v && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const q = new URL(req.url).searchParams.get("fp");
    // 端末が名乗ればそれ。名乗らない(= メモが消えた)ときは cookie の目じるし
    const fp = validFp(q) ? q : readCookie(req, ID_COOKIE);
    if (!validFp(fp)) {
      return NextResponse.json({ fp: null, wonRounds: [] }, { headers: NO_STORE });
    }

    const store = getStore();
    const [wonRounds, player] = await Promise.all([
      store.wonRoundsOf(fp),
      store.getPlayer(fp),
    ]);
    const res = NextResponse.json({ fp, wonRounds, player }, { headers: NO_STORE });
    // 来るたびに置き直して寿命を延ばす。HttpOnly なので JS からは読めない
    // (読ませる必要は無く、サーバーが返す fp を使えばいい)
    res.cookies.set(ID_COOKIE, fp, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: ID_MAX_AGE,
    });
    return res;
  } catch {
    // 取れなくても遊べる(端末のメモがそのまま使われる)
    return NextResponse.json(
      { fp: null, wonRounds: [], player: null },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** 0以上の整数に丸める(上限つき)。壊れた値でDBを汚さない */
function toCount(v: unknown, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

/** 選択肢の番号として通していい範囲か */
function toIndex(v: unknown, len: number): number {
  const n = Math.floor(Number(v));
  return Number.isInteger(n) && n >= 0 && n < len ? n : 0;
}

/**
 * POST /api/me — その人の記録を預ける。
 * **端末が送ってくる数を鵜呑みにしない**が、ここは見た目だけの記録で、
 * とばした代(=剣の解放)は kk_stabs から引くので偽れない。
 * 数は上限で頭打ちにして、あとはサーバー側が大きいほうを残す。
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const fp = validFp(typeof body.fp === "string" ? body.fp : null)
      ? (body.fp as string)
      : readCookie(req, ID_COOKIE);
    if (!validFp(fp)) {
      return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
    }

    // 名前は刻まれるものと同じ検閲を通す(通らなければ名前だけ預けない)
    let nickname: string | null = null;
    if (typeof body.nickname === "string" && body.nickname.trim() !== "") {
      const checked = sanitizeName(body.nickname);
      if (checked.ok) nickname = checked.name;
    }

    // チャームは packCharmSet の形(しるし付き)だけ通す
    const rawCharms = Math.floor(Number(body.charms));
    const charms =
      Number.isFinite(rawCharms) && (rawCharms & CHARM_SET_MARK) !== 0
        ? rawCharms >>> 0
        : 0;

    const rec: PlayerRecord = {
      total: toCount(body.total, 1_000_000),
      earthCharm: body.earthCharm === true,
      skyCatches: toCount(body.skyCatches, 100_000),
      pokes: toCount(body.pokes, 10_000_000),
      nickname,
      charms,
      color: toIndex(body.color, SWORD_COLORS.length),
      skin: toIndex(body.skin, SWORD_SKINS.length),
    };

    const saved = await getStore().savePlayer(fp, rec);
    const res = NextResponse.json({ ok: true, player: saved }, { headers: NO_STORE });
    res.cookies.set(ID_COOKIE, fp, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: ID_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
