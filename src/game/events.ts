// ゲーム内イベントバス。音(AudioDirector)とエフェクトが購読する。
// store から emit され、Reactの再レンダリングを経由せずに単発イベントを届ける。

export type GameEventType =
  | "ui-tap" // ボタン押下など汎用UI音
  | "hover" // 穴にホバー/タップフォーカス
  | "sword-raise" // 剣を構える(キラーン)
  | "thrust" // 突き(ヒュッ)
  | "impact" // 月に刺さる(ドスッ)
  | "suspense" // 判定待ちの鼓動はじまり
  | "safe" // セーフ!(ほっ)
  | "win-flash" // 当たりの瞬間の白フラッシュ
  | "launch" // こすくまくん発射
  | "fireworks" // 上空で花火
  | "fanfare" // 勝利ファンファーレ
  | "trophy" // トロフィー授与(キラーン)
  | "new-round" // 新こすくまくん降臨(オルゴール)
  | "remote-stab" // 他の人の剣が刺さった(遠くのコツン)
  | "charm-get" // チャーム獲得(チリン)
  | "skin-unlock" // 剣のスキン解放(キラッ)
  | "earth-tap" // 地球をつついた(ポコッ)
  | "earth-boom" // 地球が1000回で爆発
  | "kosukuma-poke" // こすくまくんをつついた(ぽふっ)
  | "cooldown-ready" // つぎの1本が刺せるようになった(待ち時間あけ)
  | "error"; // 失敗トースト(クールダウン/先を越された等)

type Listener = (type: GameEventType) => void;

const listeners = new Set<Listener>();

/** 購読。戻り値で解除 */
export function onGameEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitGameEvent(type: GameEventType): void {
  for (const fn of listeners) fn(type);
}
