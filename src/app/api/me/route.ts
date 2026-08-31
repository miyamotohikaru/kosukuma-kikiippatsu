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
// **/api/state はCDNで配るので、ここに個人の記録は混ぜられない。**
// この口だけ no-store で分けてある。

import { NextResponse } from "next/server";
import { getStore } from "@/server/store";

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

    const wonRounds = await getStore().wonRoundsOf(fp);
    const res = NextResponse.json({ fp, wonRounds }, { headers: NO_STORE });
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
      { fp: null, wonRounds: [] },
      { status: 500, headers: NO_STORE },
    );
  }
}
