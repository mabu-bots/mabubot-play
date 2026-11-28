# 変更履歴（CHANGELOG）

## v1.0.0（2026-11-28）

### 追加

- 統一開発フローの土台（Issue / PR テンプレート、CONTRIBUTING、CI ワークフロー、Dependabot）を追加
- ワンコマンドビルド（build.sh / build.bat）を追加
- プレゼンス・サイクルの単体テストを追加

### 変更

- ゼロから再実装し、バージョンを 1.0.0 に振り直した。旧実装（v0.1.1）の全機能・全コマンド（/rank、/leaderboard、/level reward、/game、/ping、/help）を再現し、保存形式（SQLite `data/mabubot-play.db`）は旧実装と同一に保った
- テストの配置を `src/test/` からルートの `tests/` に移し、ビルド成果物を `dist/src/` と `dist/tests/` に分けた（aegis-bot の構成に統一）。これに伴い起動スクリプトは `dist/src/index.js` になった
- コメント規約（バナー見出し＋絵文字マーカー）とドキュメント形式（README のメタ表・コマンド表・環境変数表・判断記録）を基準に統一した
