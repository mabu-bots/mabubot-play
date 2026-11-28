// ==========================================
// 🧰 共通ユーティリティ（埋め込み・XP計算・実行ログ）
// ==========================================
import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";

// ------------------------------------------
// 🎨 埋め込みの共通部品
// ------------------------------------------
// 📌 すべての返信はプレーンテキストではなく埋め込みで統一する
export const EMBED_COLOR_INFO = 0x5865f2;
export const EMBED_COLOR_SUCCESS = 0x57f287;
export const EMBED_COLOR_ERROR = 0xed4245;
export const EMBED_FOOTER = "✨ まぶさば";

// 🏗️ 標準形の埋め込みを作る（タイトル・説明・色・フッター・時刻）
export function buildEmbed(
  title: string,
  description: string,
  color: number = EMBED_COLOR_INFO,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: EMBED_FOOTER })
    .setTimestamp(new Date());
  if (fields?.length) embed.addFields(fields);
  return embed;
}

// 💬 すべてのコマンド返信はここを通し、見た目を統一する
// 📌 限定表示（ephemeral）でも埋め込みは使える。すでに返信済み・
// 遅延済みのインタラクションでは followUp に切り替える
export async function replyEmbed(
  interaction: ChatInputCommandInteraction,
  title: string,
  description: string,
  color: number = EMBED_COLOR_INFO,
  ephemeral = true,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<void> {
  const embed = buildEmbed(title, description, color, fields);
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], ephemeral });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral });
  }
}

// ------------------------------------------
// 📊 レベル・XP計算
// ------------------------------------------
// 📐 xpForLevel(n): レベル n から n+1 へ上がるのに必要な XP
export function xpForLevel(n: number): number {
  return 5 * n * n + 50 * n + 100;
}

// 📐 レベル 0 から `level` に到達するまでの累計 XP
// sum_{i=0}^{level-1} (5i^2 + 50i + 100) の閉形式で O(1) にする
export function totalXpForLevel(level: number): number {
  if (level <= 0) return 0;
  return (
    (5 * (level - 1) * level * (2 * level - 1)) / 6 +
    25 * (level - 1) * level +
    100 * level
  );
}

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpNeededForNext: number;
}

// 📐 累計 XP から現在のレベルとレベル内の進捗を求める
export function levelFromTotalXp(totalXp: number): LevelInfo {
  let level = 0;
  let remaining = Math.max(0, totalXp);
  for (;;) {
    const needed = xpForLevel(level);
    if (remaining < needed) {
      return { level, xpIntoLevel: remaining, xpNeededForNext: needed };
    }
    remaining -= needed;
    level++;
  }
}

// ------------------------------------------
// 🎲 汎用ユーティリティ
// ------------------------------------------
// 🎲 min〜max（両端含む）の一様な整数乱数
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ------------------------------------------
// 📝 コマンド実行ログ
// ------------------------------------------
// コマンドが実行されるたびに標準出力へ1行残す（pm2 の out ログに
// 残る形）。書式は艦隊で統一する:
//   [exec] <ISO時刻> cmd=<名前> route=<slash|context|prefix>
//          guild=<ID> channel=<ID> user=<ID> result=<ok|error>
// 失敗時は末尾に error="<要点>" を付ける。記録するのはコマンド名・
// ID類・成否のみで、ユーザーの入力テキスト（オプション値や
// メッセージ本文）は記録しない。
export interface CommandExecLogInput {
  commandName: string;
  route: "slash" | "context" | "prefix";
  guildId: string | null;
  channelId: string | null;
  userId: string;
  error?: unknown;
  now?: Date;
}

export function formatCommandExecLog(input: CommandExecLogInput): string {
  const at = (input.now ?? new Date()).toISOString();
  const base =
    `[exec] ${at} cmd=${input.commandName} route=${input.route} ` +
    `guild=${input.guildId ?? "-"} channel=${input.channelId ?? "-"} ` +
    `user=${input.userId} result=${input.error ? "error" : "ok"}`;
  if (!input.error) return base;
  const raw =
    input.error instanceof Error ? input.error.message : String(input.error);
  // 📌 1行書式を保つため、空白類と引用符を潰して短くする
  const summary = raw
    .replace(/[\s"]+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base} error="${summary}"`;
}

export function logCommandExec(input: CommandExecLogInput): void {
  console.log(formatCommandExecLog(input));
}
