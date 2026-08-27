"use client";

// store.toast のポップ表示。下から跳ねて出て、store側のタイマーで消える。
// id を key にすることで連続表示でもアニメが再生される。

import { useGameStore } from "@/game/store";
import "./ui.css";

export default function Toast() {
  const toast = useGameStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast-wrap" aria-live="polite">
      <div key={toast.id} className="toast">
        {toast.msg}
      </div>
    </div>
  );
}
