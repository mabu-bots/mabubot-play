// ==========================================
// ⌨️ スラッシュコマンド定義と振り分け
// ==========================================
import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import type { MabusabaStore } from "./store.js";
import {
  EMBED_COLOR_ERROR,
  EMBED_COLOR_INFO,
  EMBED_COLOR_SUCCESS,
  replyEmbed,
} from "./util.js";
import {
  handleLeaderboardCommand,
  handleLevelCommand,
  handleRankCommand,
} from "./level.js";
import { handleGameCommand } from "./games.js";

// ------------------------------------------
// 📋 コマンド定義
// ------------------------------------------
// すべてのコマンド定義はここに置き、sync-commands.ts が同じ一覧を
// 取り込んで登録する。必須オプションは任意オプションより前に置く
// （Discord は必須が後だと 50035 で弾く）。

// ----- 📊 レベル・ランク -----
export const rankCommand = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("自分の（または指定した人の）レベルとXPを表示します")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("確認するユーザー（未指定なら自分）"),
  );

export const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("レベルランキング上位10人を表示します");

export const levelCommand = new SlashCommandBuilder()
  .setName("level")
  .setDescription("レベル報酬ロールを設定します")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((group) =>
    group
      .setName("reward")
      .setDescription("レベル到達時の報酬ロール")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("レベル報酬ロールを追加します")
          .addIntegerOption((opt) =>
            opt
              .setName("level")
              .setDescription("報酬をもらえるレベル")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100),
          )
          .addRoleOption((opt) =>
            opt
              .setName("role")
              .setDescription("付与する役職")
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("レベル報酬ロールの一覧を表示します"),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("レベル報酬ロールを削除します")
          .addIntegerOption((opt) =>
            opt
              .setName("level")
              .setDescription("削除するレベル")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100),
          ),
      ),
  );

// ----- 🎮 ゲーム -----
export const gameCommand = new SlashCommandBuilder()
  .setName("game")
  .setDescription("ミニゲームで遊びます（勝利でXPがもらえます）")
  .addSubcommand((sub) =>
    sub
      .setName("janken")
      .setDescription("じゃんけんをします（勝利で +10 XP）")
      .addStringOption((opt) =>
        opt
          .setName("choice")
          .setDescription("出す手")
          .setRequired(true)
          .addChoices(
            { name: "グー", value: "goo" },
            { name: "チョキ", value: "choki" },
            { name: "パー", value: "paa" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("coin").setDescription("コイントスをします"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("slot")
      .setDescription("スロットを回します（そろったら +10 XP）"),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("number")
      .setDescription("数当てゲーム（1〜100、10回まで。正解で +30 XP）")
      .addSubcommand((sub) =>
        sub.setName("start").setDescription("数当てゲームを始めます"),
      )
      .addSubcommand((sub) =>
        sub
          .setName("guess")
          .setDescription("数字を当てます")
          .addIntegerOption((opt) =>
            opt
              .setName("number")
              .setDescription("予想する数字（1〜100）")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100),
          ),
      ),
  );

// ----- ⚙️ その他 -----
export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("mabubot-play の応答状態を確認します");

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("mabubot-play のコマンド一覧を表示します");

// ------------------------------------------
// 📖 コマンド一覧とヘルプ文
// ------------------------------------------
export const allCommands = [
  rankCommand,
  leaderboardCommand,
  levelCommand,
  gameCommand,
  pingCommand,
  helpCommand,
];

const HELP_TEXT = [
  "**📊 レベル・経験値**\n`/rank [user]` `/leaderboard` ／ `/level reward add|list|remove`（管理者）\nメッセージを送るとXP（15〜25、60秒クールダウン）がもらえます。",
  "**🎮 ミニゲーム**\n`/game janken` `/game coin` `/game slot` `/game number start|guess`\nじゃんけん・スロットの勝利で +10 XP、数当ての正解で +30 XP。",
  "**⚙️ その他**\n`/ping`",
].join("\n\n");

// ------------------------------------------
// ⌨️ コマンド処理
// ------------------------------------------
export async function handleHelpCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await replyEmbed(
    interaction,
    "✨ mabubot-play のコマンド一覧",
    HELP_TEXT,
    EMBED_COLOR_INFO,
    false,
  );
}

export async function handlePingCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await replyEmbed(
    interaction,
    "🏓 Pong!",
    `mabubot-play は正常に稼働しています。（ping: ${client.ws.ping}ms）`,
    EMBED_COLOR_SUCCESS,
  );
}

export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  store: MabusabaStore,
): Promise<void> {
  switch (interaction.commandName) {
    case "rank":
      await handleRankCommand(interaction, store);
      break;
    case "leaderboard":
      await handleLeaderboardCommand(interaction, store);
      break;
    case "level":
      await handleLevelCommand(interaction, store);
      break;
    case "game":
      await handleGameCommand(interaction, client, store);
      break;
    case "ping":
      await handlePingCommand(interaction, client);
      break;
    case "help":
      await handleHelpCommand(interaction);
      break;
    default:
      await replyEmbed(
        interaction,
        "⚠️ 不明なコマンドです",
        "不明なコマンドです。",
        EMBED_COLOR_ERROR,
      );
  }
}
