// POST /api/stab — 穴に剣を刺す。レスポンスは StabResult (discriminated union)。
// あたり穴 winning_hole はどの分岐でも絶対にレスポンスへ含めない。

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  HOLE_COUNT,
  NORMAL_CHARM_COUNT,
  SKY_KINDS,
  SWORD_COLORS,
  SWORD_SKINS,
} from "@/lib/config";
import { maskToBase64 } from "@/lib/bitmask";
import { packStyle } from "@/lib/style";
import type { StabRequest, StabResult } from "@/lib/types";
import { getStore } from "@/server/store";
import { sanitizeName } from "@/server/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// ip_hash 用の固定salt。生IPは保存せず sha256(ip+salt) の先頭16hexだけ持つ
const IP_SALT = process.env.IP_HASH_SALT ?? "kk-kikiippatsu-moon-v1";

/** リクエストボディの厳密なバリデーション(不正なら null) */
function parseBody(v: unknown): StabRequest | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { holeId, roundNo, fp } = o;
  if (typeof holeId !== "number" || !Number.isInteger(holeId)) return null;
  if (holeId < 0 || holeId >= HOLE_COUNT) return null;
  // roundNo=0(初期値)はエラーにせず store の stale 判定に任せて再同期させる
  if (typeof roundNo !== "number" || !Number.isInteger(roundNo) || roundNo < 0) {
    return null;
  }
  if (typeof fp !== "string" || fp.length === 0) return null;
  // 見た目(色・スキン・チャーム)は任意。不正値はエラーにせず既定へ丸める
  const inRange = (v: unknown, max: number): number | undefined =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max
      ? v
      : undefined;
  const color = inRange(o.color, SWORD_COLORS.length);
  const skin = inRange(o.skin, SWORD_SKINS.length);
  const charm = inRange(o.charm, NORMAL_CHARM_COUNT + 1);
  const earthCharm = o.earthCharm === true;
  const skyCharms = inRange(o.skyCharms, 1 << SKY_KINDS.length) ?? 0;
  // ニックネームは世界中の画面に出るので、トロフィー名と同じ検閲を通す。
  // 弾かれたときはエラーにせず「名無し」に落とす(刺し自体は成立させる)
  const nickname =
    typeof o.nickname === "string" && o.nickname.trim() !== ""
      ? (() => {
          const r = sanitizeName(o.nickname as string);
          return r.ok ? r.name : undefined;
        })()
      : undefined;
  return {
    holeId,
    roundNo,
    fp: fp.slice(0, 64),
    color,
    skin,
    charm,
    earthCharm,
    skyCharms,
    nickname,
  };
}

function json(body: StabResult, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = parseBody(await req.json().catch(() => null));
    if (!body) {
      return json({ result: "error", message: "ふせいなリクエストだよ" }, 400);
    }

    // Vercelの前段プロキシが付けるヘッダから接続元を推定
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

    const outcome = await getStore().stab({
      holeId: body.holeId,
      roundNo: body.roundNo,
      ipHash,
      fp: body.fp,
      country,
      color: body.color ?? null,
      // スキンとチャームは2バイトに詰めて保存する(src/lib/style.ts)
      style:
        body.skin || body.charm || body.earthCharm || body.skyCharms
          ? packStyle(
              body.skin ?? 0,
              body.charm ?? 0,
              body.earthCharm === true,
              body.skyCharms ?? 0,
            )
          : null,
      nickname: body.nickname ?? null,
    });

    switch (outcome.kind) {
      case "stale":
        return json({ result: "stale", roundNo: outcome.activeRoundNo });
      case "cooldown":
        return json({
          result: "cooldown",
          remainingSec: outcome.remainingSec,
        });
      case "taken":
        return json({
          result: "taken",
          holeId: body.holeId,
          holesBase64: maskToBase64(outcome.mask),
        });
      case "win":
        return json({
          result: "win",
          holeId: body.holeId,
          claimToken: outcome.claimToken,
          roundNo: outcome.roundNo,
        });
      case "safe":
        return json({
          result: "safe",
          holeId: body.holeId,
          holesBase64: maskToBase64(outcome.mask),
          stabCount: outcome.stabCount,
        });
    }
  } catch {
    return json({ result: "error", message: "サーバーエラーだよ" }, 500);
  }
}
