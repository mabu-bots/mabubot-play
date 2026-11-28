# mabubot-play 設計書

## 1. 位置づけ

mabubot-play は、まぶさばボット（mabubot）を機能グループごとに切り分けたうちの **ゲーム・レベル系** 担当の単体 Discord Bot である。元の mabubot から `games` と `level` を分離したもので、他の mabubot-\*（guard / ops）や p1228・logbot とは接続を持たず、TypeScript + discord.js の1プロセスで動く。

本プロジェクトは、統一開発フロー（aegis-app/aegis-bot で確立した手順）への移行にあわせて、旧 mabubot-play をゼロから再実装したものである（2026-11-28、v1.0.0）。再実装の棚卸しの正は **本番サーバー（台2）のスナップショット** とした（本番コードが最新の基準であるため）。

引き継ぐもの: 旧実装の全機能・全コマンド、表示文言、各種閾値、SQLite の保存形式（本番 DB をそのまま読めること）。
引き継がないもの: 旧コードそのもの。

## 2. アーキテクチャ

```
Discord Gateway
  │  messageCreate / interactionCreate
  ▼
events.ts ──► level.ts（メッセージ XP・レベルアップ・報酬ロール）
commands.ts ─► level.ts（/rank・/leaderboard・/level reward）
  │        └─► games.ts（ミニゲーム、勝利 XP は level.ts 経由）
  ▼
store.ts（SQLite: data/mabubot-play.db、Node 標準 node:sqlite）
```

- 起動（index.ts）はコマンド同期を行わない。コマンド登録は `sync-commands.ts` の上書き同期だけが行う。
- READY が来ないサイレント停滞は watchdog.ts が検知し、プロセス終了で pm2 に再起動させる。
- プレゼンスは presence-cycle.ts の全 Bot 共通サイクルが担う。
- ストア初期化時に backup.ts が DB の世代バックアップを取る。

モジュール構成:

| モジュール | 役割 |
| --- | --- |
| `src/index.ts` | エントリポイント。Client 生成、ウォッチドッグ取り付け、プレゼンス開始、コマンド実行の例外処理と実行ログ |
| `src/commands.ts` | 全6コマンドの定義（SlashCommandBuilder）と振り分け、/help・/ping |
| `src/sync-commands.ts` | グローバルコマンドの上書き同期（PUT 全置換＋検証） |
| `src/clear-commands.ts` | コマンド全削除（グローバル＋任意でギルド） |
| `src/store.ts` | SQLite ストア（xp_users / level_rewards / cooldowns） |
| `src/backup.ts` | 起動時 DB バックアップ（WAL チェックポイント＋世代間引き） |
| `src/util.ts` | 埋め込み返信、XP・レベル計算、コマンド実行ログの整形 |
| `src/level.ts` | XP 付与とレベルアップ処理（お祝い・報酬ロール）、/rank・/leaderboard・/level reward、報酬ロールの階層検証 |
| `src/games.ts` | ミニゲーム（じゃんけん・コイントス・スロット・数当て）。数当てはメモリ保持＋30分期限、XP クールダウン管理 |
| `src/events.ts` | messageCreate（メッセージ XP 付与） |
| `src/presence-cycle.ts` | プレゼンス・サイクル（Playing、1分交替、境界の200ms前に先行送信） |
| `src/watchdog.ts` | READY ウォッチドッグ（判定ロジック ReadyWatchdog と client への取り付け） |

## 3. データ保存

保存先は SQLite ファイル1つ（既定 `data/mabubot-play.db`、`DATA_DIR` で変更可）。Node 標準の `node:sqlite` を使い、ネイティブ依存を持たない。ジャーナルは WAL、synchronous は NORMAL。

テーブル（旧実装と同一）:

| テーブル | 内容 |
| --- | --- |
| `xp_users` | ギルド＋ユーザーごとの XP・レベル・最終メッセージ XP 付与時刻（主キー guild_id + user_id）。XP 降順の索引 `idx_xp_guild_xp` つき |
| `level_rewards` | ギルドごとのレベル報酬ロール（主キー guild_id + level） |
| `cooldowns` | 汎用クールダウン（主キー guild_id + user_id + kind）。ゲーム勝利 XP 用 |

起動時に DB を `data/backups/<timestamp>/` へコピーし、直近の世代だけを残す（既定10世代、環境変数 `DB_BACKUP_RETENTION`）。コピー前に WAL チェックポイント（TRUNCATE）を行い、失敗した場合はサイドカー（-wal / -shm）も一緒にコピーする。バックアップの失敗では起動を止めない。

## 4. 仕様の要点

### 4.1 XP・レベル

- レベル式: レベル n → n+1 に `5n² + 50n + 100` XP。累計は閉形式で計算する。
- メッセージ XP: テキストチャンネル（GuildText）の通常メッセージ1件に 15〜25、ギルド＋ユーザーごとに60秒クールダウン（`xp_users.last_xp_at_ms`）。Bot のメッセージは対象外。
- 保存される `level` 列は XP 加算のたびに再計算し、XP 合計と常に一致させる。
- レベルアップ時は同じチャンネルにお祝いを送り、今回またいだレベルの報酬ロールを付与する。お祝いに載せるのは実際に付与できたロールだけ。
- 順位（xpRank）は自分より XP が多い人数＋1。XP の行が無いユーザーは順位なし（null）。

### 4.2 ゲームと勝利 XP

- じゃんけん・スロットの勝利 +10 XP は共通クールダウン（`cooldowns`、kind = `game_win_xp`、10分）。数当ての正解 +30 XP は別枠（kind = `number_game_xp`、10分）。
- クールダウンはプレイ自体をブロックしない。勝利しても XP が付かない場合は、その旨と残り時間を応答に表示する。
- 付与は返信より先に行い、クールダウンは付与成功後にだけ記録する（文言・クールダウン・保存 XP が食い違わないため）。
- ゲーム報酬 XP はメッセージ XP のクールダウンを動かさない（`touchCooldown: false`）。
- 数当てゲームはギルド＋チャンネル＋ユーザーごとにメモリ保持し、開始から30分で時間切れ（期限切れは破棄して開始し直せる）。試行は10回まで。

### 4.3 レベル報酬ロールの階層検証

- 登録時点で弾く: Bot が付与できないロール（`not-editable`）、実行者の最上位ロール以上のロール（`above-executor`）。判定は純粋関数 `rewardRoleRejection` に分離し、テストで検証する。
- @everyone と連携サービス管理ロールは付与自体ができないため、階層判定の前に弾く。
- サーバーオーナーは実行者階層の判定を免除される（ただし Bot が付与できないロールは不可）。実行者の最上位位置が不明な場合は安全側（拒否）に倒す。
- コマンド定義の既定権限（Manage Guild）に加え、ハンドラ内でも実行時チェックする（ギルド側の連携権限上書き対策）。

### 4.4 プレゼンス・サイクル

- 形式: Playing で「<Bot名> | 起動して <経過>」と「<Bot名> | 現在時刻 HH:MM JST」を1分ごとに交互表示。位相は Unix 分の偶奇で決まり、全 Bot が同時に切り替わる。
- 値は次の分の境界時点のものを計算し、境界の200ms前に先行送信する（伝播遅延の実測中央値 190ms と相殺）。
- 経過時間の起点は最初の開始時刻に固定し、再接続・再適用ではリセットしない。

### 4.5 READY ウォッチドッグ

- READY でない状態が120秒続いたらプロセスを終了する（確認間隔30秒）。READY 喪失の瞬間から数え直し、発動後は起点をリセットする。

### 4.6 コマンド同期

- 登録は `npm run sync:commands` のみ。PUT 全置換のあと再取得して検証し、不一致なら非ゼロ終了する。
- Bot 起動時には同期しない（同期で消したコマンドが再起動で復活しないため）。

## 5. 旧→新 対応表

| 旧（mabubot-play v0.1.1、本番スナップショット） | 新（mabubot-play v1.0.0） | 備考 |
| --- | --- | --- |
| `src/index.ts` | `src/index.ts` | 同構成。コメント規約のみ刷新（未使用だった ActivityType インポートは除去） |
| `src/commands.ts` | `src/commands.ts` | 全6コマンドの定義・文言・オプション順は同一 |
| `src/sync-commands.ts` / `src/clear-commands.ts` | 同名 | 上書き同期・全削除の手順は同一 |
| `src/store.ts` | `src/store.ts` | テーブル定義・メソッドは同一（本番 DB 互換） |
| `src/backup.ts` | `src/backup.ts` | バックアップ方式・世代名・保持規則は同一 |
| `src/util.ts` | `src/util.ts` | XP 計算・実行ログ書式は同一 |
| `src/level.ts` | `src/level.ts` | 階層検証・お祝いの表示規則を含む |
| `src/games.ts` | `src/games.ts` | 数当ての期限・XP クールダウン・付与順序を含む |
| `src/events.ts` | `src/events.ts` | XP 付与の条件・クールダウンは同一 |
| `src/presence-cycle.ts` | `src/presence-cycle.ts` | サイクル形式・先行送信は同一 |
| `src/watchdog.ts` | `src/watchdog.ts` | 判定ロジックは同一 |
| `src/test/*.test.ts`（src 内、dist/test で実行） | `tests/*.test.ts`（ルート、dist/tests で実行） | aegis-bot の配置に統一。全テストを移植し、プレゼンス・サイクルのテストを追加 |
| バージョン 0.1.1 | 1.0.0 | 再実装にあわせて振り直し |
| 起動スクリプト `dist/index.js` | `dist/src/index.js` | ルートに tests/ を置く構成に合わせた変更。pm2 アプリ名 `mabubot-play` と DB ファイル名 `mabubot-play.db` は運用互換のため据え置き |

## 6. 開発手順

すべての変更は次の手順で main に取り込む（正本は CONTRIBUTING.md）。

1. Issue を作成する（テンプレート使用。目的・作業内容・完了条件を書く）
2. main からブランチを切る: `<type>/<issue番号>-<slug>`
3. 実装し、ローカルで `./build.sh`（型チェック・ビルド・テスト）が通ることを確認する
4. PR を作成し、本文に `Closes #<番号>` を入れて Issue と紐づける
5. CI が通ったら **Rebase and merge** で main に取り込み、ブランチを削除する

- コミットメッセージは Conventional Commits ＋ 英語の件名
- リリースは main 上でバージョンを上げ、タグ `vX.Y.Z` を打って GitHub Release を作る（ノートのみ、バイナリは添付しない）

## 7. テスト

- 配置: `tests/`（util / backup / watchdog / presence-cycle）。`npm test` がビルドのうえで `node --test dist/tests/*.test.js` を実行する。
- 旧テスト（util.test.ts 27件・backup.test.ts 6件・watchdog.test.ts 5件）は全件移植した。あわせてプレゼンス・サイクル（整形・位相・送信スケジュール）のテストを追加し、合計45件。
- Discord 接続が必要な部分（コマンドハンドラ・イベント）は単体テストの対象外で、純粋ロジックとストアを検証範囲とする（旧実装と同じ切り分け。ただし /level reward の実行時権限チェックは、旧実装と同様にフェイクのインタラクションで検証する）。

## 8. 判断記録

- **棚卸しの正は本番スナップショット（2026-11-28）**: 再実装の基準は GitHub ではなく、本番サーバー（台2）から取得したスナップショット（v0.1.1）とした。本番コードが最新の状態であるため。
- **ゼロから再実装し 1.0.0 に振り直し（2026-11-28）**: 統一開発フローへの移行を機に、コード・コメント・ドキュメントを作り直した。振る舞いの同一性は、移植テストと、コマンド定義・文言・閾値・保存形式の棚卸しとの照合で担保する。
- **テスト配置を tests/ に統一（2026-11-28）**: 旧実装は `src/test/` にテストを置き `dist/test/` で実行していた。基準の aegis-bot と新 mabubot に合わせ、ルートの `tests/` に移した（ビルド成果物は `dist/src/` と `dist/tests/`）。これに伴い起動スクリプトは `dist/src/index.js` になった。
- **CI は ci.yml のみに集約（2026-11-28）**: 旧スナップショットの CI（ci.yml 1本）を踏襲しつつ、基準の形式（paths-ignore、format:check 先行、audit 参考情報）に揃えた。Dependabot は継続。
- **Node は 24 以上を前提（2026-11-28）**: `node:sqlite` がフラグなしで使える下限として engines を `>=24` のまま維持し、CI も Node 24 で実行する。ecosystem.config.cjs の Node 22 向けフラグ付与は互換のため残す。
- **保存形式・保存先は変更しない（2026-11-28）**: 本番 DB（`data/mabubot-play.db`）をそのまま使えることが再実装の絶対条件のため、スキーマと既定パスは旧実装と同一にした。pm2 アプリ名も `mabubot-play` のまま据え置く。
- **開発手順を統一した（2026-11-28）**: Issue → ブランチ → PR → Rebase and merge、Conventional Commits＋英語、タグ＋Release（ノートのみ）を採用。導入自体はブートストラップ例外として Issue なしで取り込む。
