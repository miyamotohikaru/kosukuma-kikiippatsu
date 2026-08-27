// GET /api/trophies?page=1&perPage=24 — 歴代勝者(トロフィーホール)の一覧。
// 決着済みラウンドを新しい順に返す。未クレームの勝者は「ななしさん」。

import { NextResponse } from "next/server";
import type { TrophiesResponse } from "@/lib/types";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
} as const;

/** クエリ値を整数へ(不正値は fallback)、min..max にクランプ */
function intParam(
  v: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, base));
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const page = intParam(url.searchParams.get("page"), 1, 1, 1_000_000);
    const perPage = intParam(url.searchParams.get("perPage"), 24, 1, 50);

    const { total, items } = await getStore().getTrophies(page, perPage);
    const body: TrophiesResponse = { total, page, perPage, items };
    return NextResponse.json(body, { headers: HEADERS });
  } catch {
    return NextResponse.json(
      { result: "error", message: "trophies unavailable" },
      { status: 500 },
    );
  }
}
