"use client";

// エフェクト統括。<Canvas> 内でマウントされる(DOMは書かない)。
// フェーズ駆動のもの(剣・降臨ビーム・紙吹雪)はここでマウント/アンマウントし、
// イベント駆動のもの(土煙・発射)は常駐させてフェーズをまたいでも粒子を切らさない。

import { useGameStore } from "@/game/store";
import StabSword from "./StabSword";
import ImpactDust from "./ImpactDust";
import LaunchFx from "./LaunchFx";
import NewRoundBeam from "./NewRoundBeam";
import RemoteStabs from "./RemoteStabs";
import SkyTraffic from "./SkyTraffic";
import TrophyConfetti from "./TrophyConfetti";

export default function EffectsRoot() {
  const phase = useGameStore((s) => s.phase);
  // 剣は「構え→刺す→震え→セーフ」まで出しっぱなし。idle に戻ると Swords 側に引き継がれる
  const sword = phase === "stabbing" || phase === "suspense" || phase === "safe";

  return (
    <group>
      {sword && <StabSword />}
      <ImpactDust />
      <LaunchFx />
      {/*
        他の人の刺しは常駐させる。理由は2つ:
        ・剣6本ぶんのプール(ジオメトリ/マテリアル)をフェーズが変わるたびに
          作り直さない。マウント/アンマウントで作るには重すぎる。
        ・降ってきている途中でフェーズが変わっても、剣を宙に浮かせたまま
          消さずに着弾させ、必ず endRemoteStab() で Swords へ引き渡せる。
        「自分のカットシーン中は新しい剣を降らせない」という判断は
        RemoteStabs の中(phase を見て開始を止める)で行う。
      */}
      <RemoteStabs />
      {/*
        空を横切るものも常駐させる。4機ぶんのジオメトリを idle に入るたび
        作り直さないため。出すのは idle のあいだだけで、その判断は
        SkyTraffic の中(phase を見て飛ばすのをやめる)で行う。
        つかまえた瞬間の弾けは、カットシーンが始まっても最後まで見せたい。
      */}
      <SkyTraffic />
      {phase === "new-round" && <NewRoundBeam />}
      {phase === "trophy" && <TrophyConfetti />}
    </group>
  );
}
