// ==========================================
// 📊 レベル・経験値（付与・レベルアップ・報酬ロール・表示）
// ==========================================
import { PermissionFlagsBits } from "discord.js";
import type {
  ChatInputCommandInteraction,
  Guild,
  TextChannel,
} from "discord.js";
import type { MabusabaStore } from "./store.js";
import {
  EMBED_COLOR_ERROR,
  EMBED_COLOR_INFO,
  EMBED_COLOR_SUCCESS,
  buildEmbed,
  levelFromTotalXp,
  replyEmbed,
  totalXpForLevel,
} from "./util.js";

// ------------------------------------------
// ✨ XP の定数と付与
// ------------------------------------------
export const XP_PER_MESSAGE_MIN = 15;
export const XP_PER_MESSAGE_MAX = 25;
export const XP_COOLDOWN_MS = 60_000;

// ➕ XP を付与し、レベルアップ処理（お祝い＋報酬ロール）を行って
// 新しいレベル情報を返す。メッセージ XP とゲーム勝利の両方から使う。
// `touchCooldown: false`（ゲーム勝利）は、メッセージ XP の
// クールダウンをリセットせずに付与する
export async function awardXp(
  store: MabusabaStore,
  guild: Guild,
  channel: TextChannel,
  userId: string,
  amount: number,
  opts: { touchCooldown?: boolean } = {},
): Promise<{
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  totalXp: number;
}> {
  const { before, after } = store.addXp(guild.id, userId, amount, opts);
  const oldLevel = before.level;
  const newLevel = levelFromTotalXp(after.xp).level;
  if (newLevel <= oldLevel) {
    return { leveledUp: false, oldLevel, newLevel, totalXp: after.xp };
  }
  // 🎁 今回またいだレベルの報酬ロールをすべて付与する。お祝いに
  // 載せるのは実際に付与できたロールだけ（以前はメンバー取得や
  // ロール付与に失敗しても「付与しました」と表示していた）
  const rewards = store
    .getLevelRewards(guild.id)
    .filter((r) => r.level > oldLevel && r.level <= newLevel);
  const granted: typeof rewards = [];
  if (rewards.length) {
    const member = await guild.members.fetch(userId).catch(() => null);
    for (const reward of rewards) {
      if (!member) break;
      try {
        await member.roles.add(reward.role_id);
        granted.push(reward);
      } catch (error) {
        console.error(
          `[mabusaba] level reward role failed (${reward.role_id}):`,
          error,
        );
      }
    }
  }
  const rewardLines = granted.map(
    (r) =>
      `🎁 レベル ${r.level} の報酬ロール <@&${r.role_id}> を付与しました！`,
  );
  const embed = buildEmbed(
    `🎉 レベルアップ！`,
    `<@${userId}> が **レベル ${newLevel}** に上がりました！\nおめでとうございます 🎊${rewardLines.length ? `\n${rewardLines.join("\n")}` : ""}`,
    EMBED_COLOR_SUCCESS,
  );
  await channel.send({ embeds: [embed] }).catch(() => undefined);
  return { leveledUp: true, oldLevel, newLevel, totalXp: after.xp };
}

// ------------------------------------------
// 📏 レベル表示ヘルパー
// ------------------------------------------
function progressBar(into: number, needed: number, width = 10): string {
  const filled = Math.round((into / needed) * width);
  return (
    "▰".repeat(Math.max(0, Math.min(width, filled))) +
    "▱".repeat(Math.max(0, width - Math.min(width, filled)))
  );
}

// ------------------------------------------
// ⌨️ コマンド処理
// ------------------------------------------
// ----- 📊 ランク -----
export async function handleRankCommand(
  interaction: ChatInputCommandInteraction,
  store: MabusabaStore,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEmbed(
      interaction,
      "⚠️ サーバー内で使用してください",
      "このコマンドはサーバー内で使用してください。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  const user = interaction.options.getUser("user") ?? interaction.user;
  const row = store.getXp(guildId, user.id);
  const totalXp = row?.xp ?? 0;
  const info = levelFromTotalXp(totalXp);
  const rank = store.xpRank(guildId, user.id);
  const nextTotal = totalXpForLevel(info.level + 1);
  await replyEmbed(
    interaction,
    `📊 <@${user.id}> のランク`,
    [
      `**レベル**　${info.level}`,
      `**XP**　${totalXp} XP（次のレベルまで あと${info.xpNeededForNext - info.xpIntoLevel} XP / 累計 ${nextTotal} XP）`,
      `**進捗**　${progressBar(info.xpIntoLevel, info.xpNeededForNext)} ${info.xpIntoLevel}/${info.xpNeededForNext}`,
      `**順位**　${rank ? `${rank}位` : "—"}`,
    ].join("\n"),
    EMBED_COLOR_INFO,
    false,
  );
}

// ----- 🏆 ランキング -----
export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
  store: MabusabaStore,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEmbed(
      interaction,
      "⚠️ サーバー内で使用してください",
      "このコマンドはサーバー内で使用してください。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  const top = store.topXp(guildId, 10);
  if (!top.length) {
    await replyEmbed(
      interaction,
      "🏆 レベルランキング",
      "まだXPを獲得した人はいません。メッセージを送るとXPがもらえます。",
      EMBED_COLOR_INFO,
      false,
    );
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((row, i) => {
    const medal = medals[i] ?? `${i + 1}位`;
    return `${medal} <@${row.user_id}>　レベル ${row.level}　${row.xp} XP`;
  });
  await replyEmbed(
    interaction,
    "🏆 レベルランキング（上位10人）",
    lines.join("\n"),
    EMBED_COLOR_INFO,
    false,
  );
}

// ----- 🎁 レベル管理と報酬 -----
// 報酬ロールを登録時点で弾くべき理由、なければ null。
// "not-editable": Bot 自身が付与できないロール（Bot の最上位ロール
// 以下にない、または連携管理ロール）で、受け付けてもレベルアップ時に
// 黙って失敗するだけになる。
// "above-executor": 実行者がそのロールを上回っていない。登録を許すと
// 「自分より上のロールを登録して、レベルを上げて自分で受け取る」
// 権限昇格の経路になる。サーバーオーナーは全ロールを上回る。
// 実行者の位置が不明な場合は安全側（拒否）に倒す
export type RewardRoleRejection = "not-editable" | "above-executor";

export function rewardRoleRejection(
  role: { editable: boolean; position: number },
  executorHighestPosition: number | null,
  isGuildOwner: boolean,
): RewardRoleRejection | null {
  if (!role.editable) return "not-editable";
  if (isGuildOwner) return null;
  if (
    executorHighestPosition === null ||
    role.position >= executorHighestPosition
  ) {
    return "above-executor";
  }
  return null;
}

export async function handleLevelCommand(
  interaction: ChatInputCommandInteraction,
  store: MabusabaStore,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEmbed(
      interaction,
      "⚠️ サーバー内で使用してください",
      "このコマンドはサーバー内で使用してください。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  const group = interaction.options.getSubcommandGroup(false);
  if (group !== "reward") {
    await replyEmbed(
      interaction,
      "⚠️ 不明なサブコマンドです",
      "不明なサブコマンドです。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  // 🔐 コマンド定義の setDefaultMemberPermissions だけでなく実行時にも
  // 再確認する: ギルド側で連携の権限が上書きされていると、「サーバーの
  // 管理」を持たないメンバーでもこのハンドラが呼ばれることがある
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyEmbed(
      interaction,
      "⚠️ 権限がありません",
      "この操作には「サーバーの管理」権限が必要です。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  // reward サブコマンドグループは add / list / remove
  const rewardSub = interaction.options.getSubcommand(true);
  if (rewardSub === "list") {
    const rewards = store.getLevelRewards(guildId);
    if (!rewards.length) {
      await replyEmbed(
        interaction,
        "🎁 レベル報酬ロール",
        "レベル報酬ロールは設定されていません。",
      );
      return;
    }
    await replyEmbed(
      interaction,
      "🎁 レベル報酬ロール",
      rewards.map((r) => `レベル ${r.level} → <@&${r.role_id}>`).join("\n"),
    );
    return;
  }
  if (rewardSub === "remove") {
    const level = interaction.options.getInteger("level", true);
    store.deleteLevelReward(guildId, level);
    await replyEmbed(
      interaction,
      "🎁 レベル報酬ロールを削除しました",
      `レベル ${level} の報酬ロールを削除しました。`,
      EMBED_COLOR_SUCCESS,
    );
    return;
  }
  // add — level（必須）は role（必須）より前に置く
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);
  // 📌 @everyone と連携管理ロールはメンバーへ付与できない。受け付けて
  // もレベルアップ時に失敗するだけなので、登録時点で弾く
  if (role.id === guildId || role.managed) {
    await replyEmbed(
      interaction,
      "⚠️ その役職は付与できません",
      `<@&${role.id}> は自動付与できない役職です（@everyone・連携サービス管理の役職は付与できません）。`,
      EMBED_COLOR_ERROR,
    );
    return;
  }
  // 🔐 階層チェック（rewardRoleRejection 参照）: Bot が付与できることと、
  // 実行者がそのロールを上回っていることの両方を確認する。
  // interaction.member は未キャッシュの API メンバー（roles: string[]）の
  // 場合があるため、そのときはギルドのロールキャッシュから位置を引く
  let executorHighestPosition: number | null = null;
  const member = interaction.member;
  if (member) {
    if (Array.isArray(member.roles)) {
      // @everyone は暗黙（列挙されない）で位置 0
      executorHighestPosition = 0;
      for (const roleId of member.roles) {
        const position = interaction.guild?.roles.cache.get(roleId)?.position;
        if (position !== undefined && position > executorHighestPosition) {
          executorHighestPosition = position;
        }
      }
    } else {
      executorHighestPosition = member.roles.highest.position;
    }
  }
  const botHighestPosition =
    interaction.guild?.members.me?.roles.highest.position;
  const roleEditable =
    "editable" in role
      ? role.editable
      : botHighestPosition !== undefined &&
        !role.managed &&
        botHighestPosition > role.position;
  const rejection = rewardRoleRejection(
    { editable: roleEditable, position: role.position },
    executorHighestPosition,
    interaction.guild?.ownerId === interaction.user.id,
  );
  if (rejection === "not-editable") {
    await replyEmbed(
      interaction,
      "⚠️ その役職は付与できません",
      `<@&${role.id}> は Bot の役職より上にあるため付与できません。Bot の役職をその役職より上に移動してから設定してください。`,
      EMBED_COLOR_ERROR,
    );
    return;
  }
  if (rejection === "above-executor") {
    await replyEmbed(
      interaction,
      "⚠️ その役職は設定できません",
      `<@&${role.id}> はあなたの最上位役職以上の役職のため、報酬ロールに設定できません。`,
      EMBED_COLOR_ERROR,
    );
    return;
  }
  store.setLevelReward(guildId, level, role.id);
  await replyEmbed(
    interaction,
    "🎁 レベル報酬ロールを設定しました",
    `レベル ${level} に到達したら <@&${role.id}> を付与します。`,
    EMBED_COLOR_SUCCESS,
  );
}
