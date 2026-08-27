// トロフィーホールのページ。中身はクライアント側の TrophyHall に任せる。

import type { Metadata } from "next";
import TrophyHall from "@/ui/TrophyHall";

export const metadata: Metadata = {
  title: "トロフィーホール | こすくまくん危機一髪",
  description:
    "こすくまくんを宇宙へとばした歴代の勇者たち。ひとつとして同じ形のないトロフィーが、宇宙の殿堂に並んでいる。",
};

export default function TrophiesPage() {
  return <TrophyHall />;
}
