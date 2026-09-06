// 見た人の国。国旗の絵文字を出すためだけに使う。サーバー専用。
//
// **どのヘッダを信じるかが要点。**
// kosukuma.com は Cloudflare のワーカーを通ってから Vercel へ届く。
// そのとき Vercel から見える相手は「見た人」ではなく「Cloudflare」なので、
// Vercel が自分で付ける `x-vercel-ip-country` は **Cloudflare の国**になる。
// 日本から刺したのに海外の国旗が出ていたのはこれが原因。
//
// Cloudflare は見た人の国を `cf-ipcountry` に入れて渡してくれる(ワーカー側で
// request.cf.country から明示的に載せている)ので、**そちらを先に見る**。
// 素の *.vercel.app で開いた人には `cf-ipcountry` が無いので、
// そのときだけ `x-vercel-ip-country` に落とす。どちらの入口でも正しくなる。

/**
 * 国が分からないときにCDNが入れる値。
 * XX = 判定できない / T1 = Tor 経由。国旗にできないので「分からない」に倒す。
 */
const UNKNOWN = new Set(["XX", "T1"]);

/** 見た人の国(ISO 3166-1 の2文字)。分からなければ null */
export function countryOf(req: Request): string | null {
  const raw =
    req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country");
  if (!raw || !/^[a-z]{2}$/i.test(raw)) return null;
  const up = raw.toUpperCase();
  return UNKNOWN.has(up) ? null : up;
}
