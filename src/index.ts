// ==========================================
// 🚀 mabubot-play エントリポイント
// ==========================================
import { Client, EmbedBuilder, GatewayIntentBits, Partials } from "discord.js";
import { MabusabaStore } from "./store.js";
import { handleChatInputCommand } from "./commands.js";
import { registerEvents } from "./events.js";
import { EMBED_COLOR_ERROR, EMBED_FOOTER, logCommandExec } from "./util.js";
import { attachReadyWatchdog } from "./watchdog.js";
import { startPresenceCycle } from "./presence-cycle.js";

// ------------------------------------------
// ⚙️ 初期化
// ------------------------------------------
const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error(
    "DISCORD_TOKEN is required. Copy .env.example to .env and set it.",
  );
  process.exit(1);
}
const dataDir = process.env.DATA_DIR?.trim() || "./data";
const store = new MabusabaStore(dataDir);

// 📌 Partials: キャッシュに無いオブジェクトでもイベントが内容や
// 投稿者を運んでくるようにするために必要
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // 🔐 特権: レベルアップ時の報酬ロール付与でメンバーを取得するため
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 🔐 特権: メッセージ XP の判定に必要
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
    Partials.User,
  ],
});

// 🛡️ Gateway 安全構造: READY が来ないサイレント停滞を検知して
// プロセスを終了する（watchdog.ts）
attachReadyWatchdog(client);

// ------------------------------------------
// 🚀 起動時の処理
// ------------------------------------------
// 📌 client / shard のエラーを記録する: リスナーが無い 'error' は
// EventEmitter が投げ、shard エラーは記録先が無いと見えない
client.on("error", (error) => {
  console.error("[mabusaba] client error:", error);
});
client.on("shardError", (error, shardId) => {
  console.error(`[mabusaba] shard ${shardId} error:`, error);
});
// 📝 log-only の全体ハンドラ（mabubot-guard と同じ）: これが無いと、
// 漏れた rejection は文脈の無い未処理 rejection として現れ（最近の
// Node ではプロセス終了にもつながる）。記録すれば Bot は生き続け、
// 診断の手がかりも残る
process.on("unhandledRejection", (reason) => {
  console.error("[mabusaba] unhandled rejection:", reason);
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
  // 🎮 プレゼンス・サイクル（全 Bot 共通）を開始する
  startPresenceCycle(client);

  // 📌 コマンドはここでは同期しない。登録は `npm run sync:commands`
  // の上書き同期だけが行う（sync-commands.ts 参照）。起動時に同期
  // すると、同期で消したコマンドが再起動で復活してしまう
});

// ------------------------------------------
// ⌨️ コマンド実行時の処理
// ------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  // 📝 コマンド実行ログ（util.ts）: コマンド名・ID類・成否のみを1行残す
  const execLog = {
    commandName: interaction.commandName,
    route: "slash" as const,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  };
  try {
    await handleChatInputCommand(interaction, client, store);
    logCommandExec(execLog);
  } catch (error) {
    logCommandExec({ ...execLog, error });
    console.error("interaction failed", error);
    // 📌 reply は未使用のインタラクションにしか使えない: ハンドラが
    // 返信・遅延済みなら失敗通知は followUp で送る。そうしないと
    // 例外になってユーザーには何も見えない
    const embed = new EmbedBuilder()
      .setTitle("⚠️ 処理に失敗しました")
      .setDescription("処理に失敗しました。")
      .setColor(EMBED_COLOR_ERROR)
      .setFooter({ text: EMBED_FOOTER })
      .setTimestamp(new Date());
    if (interaction.replied || interaction.deferred) {
      await interaction
        .followUp({ embeds: [embed], ephemeral: true })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({ embeds: [embed], ephemeral: true })
        .catch(() => undefined);
    }
  }
});

// ------------------------------------------
// 📨 イベント登録と終了処理
// ------------------------------------------
registerEvents(client, store);

process.on("SIGINT", () => {
  store.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.close();
  process.exit(0);
});

await client.login(token);
