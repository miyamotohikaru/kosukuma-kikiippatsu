import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

const rounded = M_PLUS_Rounded_1c({
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rounded",
});

export const metadata: Metadata = {
  title: "こすくまくん危機一髪",
  description:
    "月に刺さったこすくまくんを、世界のみんなで危機一髪。あたりの穴に剣を刺すと、こすくまくんは宇宙へ飛び、あなたの名前が永久にトロフィーに刻まれる。",
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
