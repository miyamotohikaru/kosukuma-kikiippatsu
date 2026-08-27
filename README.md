# こすくまくん危機一髪 (kosukuma-kikiippatsu)

月に刺さった「こすくまくん」を、世界中のみんなで危機一髪。
1000個の穴のうち1つだけが「あたり」。あたりを刺した人はこすくまくんを宇宙へ飛ばし、
名前が永久にトロフィーホールへ刻まれる。飛んだら次の代のこすくまくんが現れて、永遠に続く。

設計の詳細は [DESIGN.md](DESIGN.md) を参照。

## 技術構成

- Next.js 16 (App Router) + React Three Fiber (three.js) — Vercelプロジェクト `kosukuma-kikiippatsu`
- 状態管理: Neon Postgres (`DATABASE_URL`)。**未設定ならメモリ内ストアで動く**(ローカル開発はDB不要)
- テーブル(`kk_rounds` / `kk_stabs`)は初回アクセス時に自動作成。手動マイグレーション不要
- 音は全てWebAudio合成、トロフィーは手続き生成 — 追加アセット・外部API課金なし
- 3Dモデル: `public/models/kosukuma.glb`(Blenderの `kosukuma_base model.blend` からDraco圧縮で書き出し、141KB)

## 開発

```bash
npm install
npm run dev
```

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Neon Postgres接続文字列。未設定時はメモリ内ストア(再起動でリセット・多インスタンスで不整合)になるため、本番/プレビューでは必須 |

<!-- DATABASE_URL接続済み(2026-07-15) -->
