"use client";

// あそびかたモーダル。Hud の ❓ ボタンから開閉する。

import { COOLDOWN_SEC } from "@/lib/config";
import "./ui.css";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  "月の あなを えらんで けんを刺す",
  "あたりは 1000このうち 1つだけ",
  "あてたら こすくまくんが 宇宙へ飛んで なまえが 永久にトロフィーへ",
] as const;

/** 剣そだての説明。ステップとは別の「知っておくと楽しい」情報 */
const GEAR = [
  { icon: "🎨", text: "けんの いろは 8しょくから えらべるよ" },
  { icon: "🏅", text: "10本 刺すごとに チャームが 1こ ふえる(ぜんぶで12こ)" },
  { icon: "✨", text: "こすくまくんを とばすと、ぎん・きんの けんが つかえるよ" },
  // つついて揺らせることは、待ち時間のセリフでしか伝わらない。
  // 刺したことのない人にも気づいてもらうため、ここに1行おく
  { icon: "👆", text: "こすくまくんは つつけるよ" },
] as const;

export default function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="あそびかた"
      onClick={(e) => {
        // 背景タップでも閉じられる
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card help-card">
        <h2 className="modal-title">あそびかた</h2>
        <ol className="help-steps">
          {STEPS.map((step, i) => (
            <li key={i} className="help-step">
              <span className="help-num">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <ul className="help-gear">
          {GEAR.map((g) => (
            <li key={g.text} className="help-gear-row">
              <span className="help-gear-icon" aria-hidden="true">
                {g.icon}
              </span>
              <span>{g.text}</span>
            </li>
          ))}
        </ul>
        <p className="help-cooldown">
          ⏱️ {COOLDOWN_SEC}びょうに1回だけ 刺せるよ
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          とじる
        </button>
      </div>
    </div>
  );
}
