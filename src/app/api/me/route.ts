// GET /api/me?fp=... — その端末の「とばした代」をサーバーから返す。
//
// なぜ要るか: とばした回数は端末のメモ(localStorage)だけに書いていた。
// つまり **勝ったのに剣がもらえない道** がいくつもあった:
//   ・当たった直後にタブが落ちた/閉じた(サーバーには記録が残る)
//   ・メモの書き込みに失敗した(プライベートモードなど)
//   ・剣のスキンだけ消えて、記録の数が食い違った
// サーバーが持っている記録を正にして、開くたびに合わせにいく。
//
// **/api/state はCDNで配るので、ここに個人の記録は混ぜられない。**
// この口だけ no-store で分けてある。

import { NextResponse } from "next/server";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const fp = new URL(req.url).searchParams.get("fp") ?? "";
    if (!fp || fp.length > 64) {
      return NextResponse.json({ wonRounds: [] }, { headers: NO_STORE });
    }
    const wonRounds = await getStore().wonRoundsOf(fp);
    return NextResponse.json({ wonRounds }, { headers: NO_STORE });
  } catch {
    // 取れなくても遊べる(端末のメモがそのまま使われる)
    return NextResponse.json({ wonRounds: [] }, { status: 500, headers: NO_STORE });
  }
}
