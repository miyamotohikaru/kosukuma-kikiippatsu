// POST /api/chat — 左下のコメント欄へ1件書き込む。
//
// 世界中の画面に出る自由入力なので、通すかどうかはここで決める:
//   ・長さ / 制御文字・ゼロ幅文字 / URL / 同じ文字の連打 / NGワード → sanitizeChat
//   ・連投 → store 側で fp と ip_hash の両方を見て CHAT_COOLDOWN_SEC 待たせる
// 弾いたときは理由をそのまま返す(伏せ字にして通すことはしない)。

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { CHAT_PAGE } from "@/lib/config";
import type { ChatResult } from "@/lib/types";
import { getStore } from "@/server/store";
import { sanitizeChat, sanitizeName } from "@/server/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// 刺しと同じ salt。生IPは保存せず sha256(ip+salt) の先頭16hexだけ持つ
const IP_SALT = process.env.IP_HASH_SALT ?? "kk-kikiippatsu-moon-v1";

function json(body: ChatResult, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * GET /api/chat?before=<id> — それより古いコメントを新しい順に返す。
 * 「ぜんぶ みる」でさかのぼるためのページング。
 * 現在ぶんは /api/state が配っているので、ここは過去だけを受け持つ。
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get("before"));
    // before が無い/不正なら「いちばん新しいところから」= 上限なし
    const before =
      Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Number.MAX_SAFE_INTEGER;
    const items = await getStore().chatBefore(before, CHAT_PAGE);
    return NextResponse.json(
      { items, hasMore: items.length === CHAT_PAGE },
      { headers: { "Cache-Control": "public, s-maxage=10" } },
    );
  } catch {
    return NextResponse.json(
      { items: [], hasMore: false },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const raw: unknown = await req.json().catch(() => null);
    if (typeof raw !== "object" || raw === null) {
      return json({ result: "rejected", message: "なにか かいてね" }, 400);
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.fp !== "string" || o.fp.length === 0) {
      return json({ result: "rejected", message: "もういちど ためしてね" }, 400);
    }

    const checked = sanitizeChat(o.body);
    if (!checked.ok) {
      return json({ result: "rejected", message: checked.reason }, 400);
    }

    // 表示名は刺しのフィードと同じ検閲を通す。弾かれたら「だれか」に落として、
    // コメント自体は通す(名前のせいで発言できないほうが分かりにくい)
    const name =
      typeof o.nickname === "string" && o.nickname.trim() !== ""
        ? (() => {
            const r = sanitizeName(o.nickname);
            return r.ok ? r.name : null;
          })()
        : null;

    const fwd = req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0].trim() : "unknown";
    const ipHash = createHash("sha256")
      .update(ip + IP_SALT)
      .digest("hex")
      .slice(0, 16);
    const rawCountry = req.headers.get("x-vercel-ip-country");
    const country =
      rawCountry && /^[a-z]{2}$/i.test(rawCountry)
        ? rawCountry.toUpperCase()
        : null;

    // round_no は「いつのコメントか」の記録用。表示の並びは id なので、
    // ここが多少ずれても流れは壊れない
    const store = getStore();
    const snap = await store.getSnapshot();
    const outcome = await store.postChat({
      roundNo: snap.roundNo,
      body: checked.body,
      name,
      country,
      fp: o.fp.slice(0, 64),
      ipHash,
    });

    if (outcome.kind === "cooldown") {
      return json({ result: "cooldown", remainingSec: outcome.remainingSec });
    }
    return json({ result: "ok", message: outcome.message });
  } catch {
    return json({ result: "rejected", message: "サーバーエラーだよ" }, 500);
  }
}
