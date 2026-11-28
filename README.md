# まぶさばボット（mabubot-play）

| 項目 | 内容 |
| --- | --- |
| バージョン | v1.0.0 |
| 状態 | 稼働中 |
| 稼働先 | 台2（ConoHa VPS、pm2 アプリ名 `mabubot-play`） |
| 実装 | TypeScript + discord.js v14 / Node 24 / SQLite（`node:sqlite`） |

まぶさばボット（mabubot）を機能グループごとに切り分けたうちの、**ゲーム・レベル系**担当の Bot です。元の mabubot から `games` と `level` を分離しました。単独で起動でき、他の mabubot-\*（guard / ops）や p1228・logbot とは接続しません。

📜 更新履歴: [CHANGELOG.md](CHANGELOG.md)

## ✨ できること

- **📊 レベル・経験値**: メッセージを送ると XP（15〜25、60秒クールダウン）がもらえ、レベルアップ時に通知と報酬ロールの付与を行います
- **🎮 ミニゲーム**: じゃんけん・コイントス・スロット・数当てゲーム（勝利で XP）
- **🎮 プレゼンス**: 全 Bot 共通のプレゼンス・サイクル（Playing、1分ごとに「起動して ○○」と「現在時刻 ○○ JST」を交互表示）

コマンドの返信は埋め込みメッセージです。`/rank` `/leaderboard` `/game` `/help` は公開表示、それ以外は基本的に実行者にだけ見えます（限定表示）。フッターは `✨ まぶさば` です。

## ⌨️ コマンド

`/level reward` はサーバー管理（Manage Guild）権限が必要です。それ以外は誰でも使えます。

| コマンド | 説明 | 備考 |
| --- | --- | --- |
| `/rank [user]` | 自分（または指定した人）のレベル・XP・次のレベルまでの進捗・順位を表示 | 公開表示 |
| `/leaderboard` | レベルランキング上位10人を表示 | 公開表示 |
| `/level reward add level:<レベル> role:<役職>` | レベル報酬ロールを追加（レベルは1〜100） | 管理者 |
| `/level reward list` | レベル報酬ロールの一覧 | 管理者 |
| `/level reward remove level:<レベル>` | レベル報酬ロールを削除 | 管理者 |
| `/game janken choice:<グー/チョキ/パー>` | じゃんけん（勝利で +10 XP） | 公開表示 |
| `/game coin` | コイントス | 公開表示 |
| `/game slot` | スロット（3つそろったら +10 XP） | 公開表示 |
| `/game number start` | 数当てゲームを開始（1〜100、10回まで） | 公開表示 |
| `/game number guess number:<数字>` | 数字を当てる（正解で +30 XP） | 公開表示 |
| `/ping` | 応答確認 | |
| `/help` | コマンド一覧を表示 | 公開表示 |

補足:

- レベル式：レベル `n` から `n+1` に必要なXPは `5n² + 50n + 100`（レベル1には累計100 XP）。レベルアップ時は同じチャンネルにお祝いメッセージを送り、到達したレベルの報酬ロールを付与します（実際に付与できたロールだけをお祝いに表示します）。
- 報酬ロールの登録時には階層チェックを行います。Bot が付与できない役職（Bot の役職より上、@everyone、連携サービス管理の役職）は登録できません。また、実行者自身の最上位役職以上の役職も登録できません（自分より上の役職を登録してレベルアップで受け取る権限昇格を防ぐため）。サーバーオーナーはこの限りではありません。
- 数当てゲームはギルド＋チャンネル＋ユーザーごとにメモリで保持します（Botの再起動で消えます）。開始から30分経つと時間切れで終了し、新しく始め直せます。
- ゲーム勝利 XP にはクールダウンがあります。じゃんけん・スロットの +10 XP は共通で10分、数当ての +30 XP は別枠で10分です。クールダウン中の勝利では XP は付与されません（応答に表示されます）が、ゲーム自体はいつでも遊べます。ゲームで獲得した XP は、メッセージ XP の60秒クールダウンには影響しません。

## ⚙️ 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ○ | Discord Bot のトークン |
| `DISCORD_APPLICATION_ID` | ○ | Discord アプリケーション ID（コマンド同期・削除に使う） |
| `DATA_DIR` | ― | SQLite データの保存先。既定は `./data`（`data/mabubot-play.db`） |
| `DB_BACKUP_RETENTION` | ― | 起動時 DB バックアップの保持世代数。既定は `10` |
| `DISCORD_GUILD_ID` / `DISCORD_GUILD_IDS` | ― | `clear:commands` でギルドコマンドも消す場合に指定（カンマ区切り可） |

## ⚙️ 必要なDiscord設定

1. [Discord Developer Portal](https://discord.com/developers/applications) で **mabubot-play 用の新しいアプリケーション** を作成し、Bot を追加します（元の mabubot や他の Bot のアプリは使いません。各 Bot でアプリが別々に必要です）。
2. Bot 設定で Privileged Gateway Intents を有効にします：
   - **Server Members Intent**（レベルアップ時の報酬ロール付与でメンバーを取得するため）
   - **Message Content Intent**（メッセージ XP の判定に必要）
3. サーバーに Bot を招待します。権限は「チャンネルを見る」「メッセージを送信する」「埋め込みリンク」「ロールを管理」を付与してください。レベル報酬ロールは、Bot の役職より下にある役職にしか付与できません。
4. `.env.example` を `.env` にコピーし、`DISCORD_TOKEN` と `DISCORD_APPLICATION_ID` を設定します。**トークンはチャットには送らず、`.env` にだけ入れてください。**

## 🚀 起動

```bash
npm ci
npm run build
npm run sync:commands   # スラッシュコマンドを上書き同期（初回・コマンド変更時に実行）
npm start
```

### 🔨 ビルド（ワンコマンド）

依存関係のインストール → 型チェック → ビルド → テストまでを 1 コマンドで実行するスクリプトを用意しています。失敗した場合は、そのステップで止まってどこで落ちたかを表示します。テストは `dist/` に対して実行されるため、スクリプト内でもビルドを先に行います。

```bat
build.bat
```

```sh
./build.sh
```

開発時は `npm run dev` で起動できます。XP・レベル報酬・クールダウンは `data/mabubot-play.db`（SQLite、Node 標準の `node:sqlite`）に保存され、再起動しても残ります。起動時には DB を `data/backups/<timestamp>/` へ自動バックアップします（保持は直近10世代、`DB_BACKUP_RETENTION` で変更可）。Node 24 以上が必要です。

> [!NOTE]
> `.env` は自動では読み込まれません。`DISCORD_TOKEN` / `DISCORD_APPLICATION_ID` はシェルに export するか、systemd の `EnvironmentFile=` で渡してください。pm2 で起動する場合は `ecosystem.config.cjs` が `.env` を読み込むので、このままで大丈夫です。

## 🖥️ pm2で自動起動

VPSの再起動後もBotが自動で立ち上がるように、pm2で管理します。

```bash
pm2 start ecosystem.config.cjs
pm2 startup   # 表示されたコマンドを実行
pm2 save
```

## 🔁 コマンド同期（上書き同期式）

スラッシュコマンドの登録は `npm run sync:commands` だけが行います。Bot の起動時には同期しません。実行すると、このアプリのグローバルコマンドを PUT で全置換し、同期後に再取得して検証します。コマンド定義を変えたら必ず実行し直してください。

## 🧹 古いコマンドが残っているとき

上書き同期は **このアプリのグローバルコマンドだけ** を置き換えます。ギルド限定コマンドや、前に使っていた別プログラム（別アプリケーション）のコマンドは対象外です。それらを全削除したい場合は `npm run clear:commands` を使います（ギルド分は `DISCORD_GUILD_ID` 付き、別アプリ分はそのアプリのトークン／アプリケーション ID で実行）。

## 🔀 元 mabubot からの移行メモ

- **担当データ**: `xp_users`（XP・レベル）、`level_rewards`（報酬ロール）、`cooldowns`（数当て XP のクールダウン等）。DB ファイルは `data/mabubot-play.db` です（元は `data/mabusaba.db`）。
- **データ移行手順**（XP を引き継ぐ場合）: mabubot-play を一度起動して `data/mabubot-play.db` を作り、停止してから、旧 DB の担当テーブルをコピーします（テーブル定義は元と同じなので `INSERT INTO ... SELECT *` が使えます）。
  ```bash
  sqlite3 data/mabubot-play.db \
    "ATTACH '/path/to/mabubot/data/mabusaba.db' AS old;
     INSERT INTO xp_users SELECT * FROM old.xp_users;
     INSERT INTO level_rewards SELECT * FROM old.level_rewards;
     INSERT INTO cooldowns SELECT * FROM old.cooldowns;
     DETACH old;"
  ```
- **切り替え時の注意**:
  - 旧 mabubot と mabubot-play を**同時に稼働させないでください**。両方がメッセージ XP を付与し、レベルアップ通知が二重に出ます（XP 自体は別 DB なので合算はされません）。停止 → データ移行 → 起動の順で切り替えてください。
  - 元の mabubot では「スパム判定を先に行い、スパム投稿には XP を付けない」順序制御がありましたが、分離後はスパム対策が別 Bot（mabubot-guard）になるため、この制御は効きません。guard がタイムアウト・削除した投稿にも、play 側で XP が付く場合があります（60秒クールダウンの範囲内）。
  - 進行中の数当てゲームはメモリ内のみで保持されるため（元からの仕様）、再起動・切り替えで終了します。

## 🗂️ 構成

- `src/index.ts` — 起動・Intents（コマンド同期はしない）
- `src/sync-commands.ts` — スラッシュコマンドの上書き同期（PUT 全置換＋検証）
- `src/clear-commands.ts` — アプリケーションのコマンド全削除（グローバル＋ギルド）
- `src/commands.ts` — スラッシュコマンドの定義と振り分け
- `src/store.ts` — SQLite ストア（xp_users / level_rewards / cooldowns）
- `src/backup.ts` — 起動時 DB バックアップ（世代管理）
- `src/util.ts` — 埋め込み返信・XP 計算・コマンド実行ログ
- `src/level.ts` — XP 付与・レベルアップ・報酬ロール・ランク
- `src/games.ts` — ミニゲーム（じゃんけん・コイン・スロット・数当て）
- `src/events.ts` — messageCreate（XP 付与）
- `src/presence-cycle.ts` — プレゼンス・サイクル（全 Bot 共通形式）
- `src/watchdog.ts` — READY ウォッチドッグ（Gateway のサイレント停滞検知）
- `tests/` — 単体テスト（XP計算・ゲーム・ストア・バックアップ・ウォッチドッグ・プレゼンス）

## 🧭 判断記録

- **ゼロから再実装し、バージョンを 1.0.0 に振り直した（2026-11-28）**: 統一開発フロー（aegis-bot が基準）への移行にあわせ、旧実装（最終 v0.1.1）を棚卸しして全機能を再実装した。棚卸しの正は本番サーバー（台2）のスナップショットとし、コードの構成・コメント規約・ドキュメント形式を基準に揃え、振る舞い（コマンド定義・文言・閾値・保存形式）は旧実装と一致させた。詳細は DESIGN.md の対応表と判断記録を参照。
- **開発手順を統一した（2026-11-28）**: Issue → ブランチ → PR → Rebase and merge の手順、Conventional Commits＋英語の件名、タグ＋GitHub Release（ノートのみ）のリリース手順を採用した。手順の正本は CONTRIBUTING.md。
- **データ保存形式は変えない**: 本番の `data/mabubot-play.db` をそのまま読み続けられるよう、テーブル定義・キー・既定の保存先は旧実装と同一にした。

## Development

開発手順（Issue → ブランチ → PR → Rebase and merge）とコミット規約は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。設計と判断記録は [DESIGN.md](DESIGN.md)、変更履歴は [CHANGELOG.md](CHANGELOG.md) にある。

## License

MIT — [LICENSE](LICENSE) を参照。
