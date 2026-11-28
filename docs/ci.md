# CI / 自動化メモ

このリポジトリの GitHub Actions 構成と、採用している自動化の要点をまとめる。CI は 1 本に集約している（理由は DESIGN.md の判断記録を参照）。

## ワークフロー一覧

| ファイル | トリガー | 役割 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push（main）/ pull_request | 整形チェック → 型チェック → ビルド → テスト → audit（参考） |

`docs/` 配下や Markdown のみの変更では CI を起動しない（`paths-ignore`）。

## CI（ci.yml）

- Node は 24（`engines >=24` に合わせる）。依存関係は `npm ci`。
- ステップ順: `format:check` → `typecheck` → `build` → `test`（ビルド成果物に対して実行）→ `npm audit`（`continue-on-error: true` の参考情報）。
- 権限は `contents: read` のみ。同一ブランチの重複実行は concurrency でキャンセルする。

## Dependabot

- `.github/dependabot.yml` で npm と GitHub Actions の更新を週次で受け取る。

## ローカルでの再現

CI と同じ検証は `./build.sh`（Windows は `build.bat`）で実行できる（依存関係のインストール → 型チェック → ビルド → テスト）。整形は `npm run format` で自動修正できる。
