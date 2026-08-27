// POST /api/claim — 勝者が名前を刻む。claim_token が一致し、まだ
// winner_name が入っていないときだけ成功する(排他はストア層の条件付きUPDATE)。

import { NextResponse } from "next/server";
import type { ClaimResponse } from "@/lib/types";
import { sanitizeName } from "@/server/names";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ParsedClaim {
  roundNo: number;
  token: string;
  /** 名前のサニタイズは names.ts に任せるので unknown のまま渡す */
  name: unknown;
}

/** リクエストボディの厳密なバリデーション(不正なら null) */
function parseBody(v: unknown): ParsedClaim | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { roundNo, token } = o;
  if (typeof roundNo !== "number" || !Number.isInteger(roundNo) || roundNo < 1) {
    return null;
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 128) {
    return null;
  }
  return { roundNo, token, name: o.name };
}

function json(body: ClaimResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = parseBody(await req.json().catch(() => null));
    if (!body) {
      return json(
        { ok: false, code: "bad-request", message: "ふせいなリクエストだよ" },
        400
      );
    }

    // 名前のサニタイズ + NGワード判定
    const checked = sanitizeName(body.name);
    if (!checked.ok) {
      return json({ ok: false, code: "bad-name", message: checked.reason });
    }

    const result = await getStore().claim(body.roundNo, body.token, checked.name);
    if (!result.ok) {
      return json({ ok: false, code: "bad-token", message: result.message });
    }

    return json({ ok: true, name: checked.name, roundNo: body.roundNo });
  } catch {
    return json(
      { ok: false, code: "server-error", message: "サーバーエラーだよ" },
      500
    );
  }
}
