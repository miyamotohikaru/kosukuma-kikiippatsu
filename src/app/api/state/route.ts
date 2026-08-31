// GET /api/state — 全クライアントがポーリングする現在のラウンド状態。
// CDNキャッシュ(s-maxage=3)に加えて関数内でも2.5秒キャッシュし、
// 同時アクセスが増えてもDBへの問い合わせが増えないようにする。

import { NextResponse } from "next/server";
import { maskToBase64, u16ToBase64, u32ToBase64 } from "@/lib/bitmask";
import type { StateResponse } from "@/lib/types";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 2500;
const HEADERS = {
  "Cache-Control": "public, s-maxage=3, stale-while-revalidate=27",
} as const;

// 関数インスタンス内キャッシュ(モジュール変数)。同時リクエストは inflight に相乗り
let cached: { at: number; body: StateResponse } | null = null;
let inflight: Promise<StateResponse> | null = null;

async function loadState(): Promise<StateResponse> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
  if (!inflight) {
    inflight = getStore()
      .getSnapshot()
      .then((snap) => {
        const body: StateResponse = {
          roundNo: snap.roundNo,
          startedAt: snap.startedAt,
          stabCount: snap.stabCount,
          holesBase64: maskToBase64(snap.mask),
          stabColorsBase64: maskToBase64(snap.stabColors),
          stabStylesBase64: u16ToBase64(snap.stabStyles),
          stabCharmsBase64: u32ToBase64(snap.stabCharms),
          recent: snap.recent,
          prevWinner: snap.prevWinner,
          chat: snap.chat,
        };
        cached = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET(): Promise<NextResponse> {
  try {
    const body = await loadState();
    return NextResponse.json(body, { headers: HEADERS });
  } catch {
    return NextResponse.json(
      { result: "error", message: "state unavailable" },
      { status: 500 },
    );
  }
}
