import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import { OG_VERSION } from "./og-version";
import "./globals.css";

const rounded = M_PLUS_Rounded_1c({
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rounded",
});

const SITE_URL = "https://kikiippatsu.kosukuma.com";
const TITLE = "こすくまくん危機一髪";
const DESCRIPTION =
  "月に刺さったこすくまくんを、世界のみんなで危機一髪。あたりの穴に剣を刺すと、こすくまくんは宇宙へ飛び、あなたの名前が永久にトロフィーに刻まれる。";
// SNSに貼ったときの一行。画面に出ている惹句をそのまま使う
const SHARE_DESCRIPTION =
  "月にささったこすくまくんを、たすけて…いや、飛ばして！ 1000のあなの どれか1つが あたり。";
// 共有したときに出る絵。実際のタイトル画面を撮ったもので、
// 焼き直しは node tools/shoot-og.mjs。焼くたびに ?v= が変わり、
// SNS が持っている古い絵を捨てて取り直す。
const OG_IMAGE = `${SITE_URL}/og.png?v=${OG_VERSION}`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: SHARE_DESCRIPTION,
    url: SITE_URL,
    siteName: TITLE,
    locale: "ja_JP",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SHARE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0e2a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={rounded.variable}>{children}</body>
    </html>
  );
}
