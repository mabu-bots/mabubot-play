// ==========================================
// 📨 イベント登録（メッセージ XP）
// ==========================================
import { ChannelType, type Client, type Message } from "discord.js";
import type { MabusabaStore } from "./store.js";
import {
  XP_COOLDOWN_MS,
  XP_PER_MESSAGE_MAX,
  XP_PER_MESSAGE_MIN,
  awardXp,
} from "./level.js";
import { randomInt } from "./util.js";

// ------------------------------------------
// 📨 イベント登録
// ------------------------------------------
// mabubot-play が購読するイベントはメッセージ作成（XP 付与）のみ。
// 元 mabubot の events.ts にあったスパム対策は mabubot-guard へ、
// 参加イベントとボタン処理は mabubot-ops へ分離した
export function registerEvents(client: Client, store: MabusabaStore): void {
  // ----- ✉️ メッセージ（XP 付与） -----
  client.on("messageCreate", async (message: Message) => {
    // 📌 ハンドラ全体を包む: ここで同期例外が漏れる（ストア由来など）と
    // 未処理 rejection になってプロセスが落ちかねない
    try {
      if (!message.guildId || !message.guild || message.author.bot) return;
      if (message.channel.type !== ChannelType.GuildText) return;
      const guildId = message.guildId;
      const userId = message.author.id;
      const now = Date.now();

      // ✨ 1件 15〜25 XP、ギルド＋ユーザーごとに60秒クールダウン
      const row = store.getXp(guildId, userId);
      if (row && now - row.last_xp_at_ms < XP_COOLDOWN_MS) return;
      const amount = randomInt(XP_PER_MESSAGE_MIN, XP_PER_MESSAGE_MAX);
      await awardXp(
        store,
        message.guild,
        message.channel,
        userId,
        amount,
      ).catch(() => undefined);
    } catch (error) {
      console.error("[mabusaba] messageCreate failed:", error);
    }
  });
}
