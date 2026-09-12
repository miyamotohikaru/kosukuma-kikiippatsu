import type { Metadata } from "next";
import Game from "@/ui/Game";

// ?x=1 のようにクエリを付けて配っても、素のURLと同じ1ページとして扱われるように。
// canonical を layout に置くと /trophies まで入口を指してしまうので、ここに置く。
export const metadata: Metadata = {
  alternates: { canonical: "https://kikiippatsu.kosukuma.com" },
};

export default function Page() {
  return <Game />;
}
