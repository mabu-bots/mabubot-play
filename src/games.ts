// ==========================================
// 🎮 ミニゲーム（じゃんけん・コイン・スロット・数当て）
// ==========================================
import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  TextChannel,
} from "discord.js";
import type { MabusabaStore } from "./store.js";
import {
  EMBED_COLOR_ERROR,
  EMBED_COLOR_INFO,
  EMBED_COLOR_SUCCESS,
  randomInt,
  replyEmbed,
} from "./util.js";
import { awardXp } from "./level.js";

// ------------------------------------------
// 🔢 数当てゲーム
// ------------------------------------------
// 数当てゲームはメモリ内のみで保持する（ギルド＋チャンネル＋
// ユーザー単位）。仕様どおり、再起動で進行中のゲームは終了する
interface NumberGame {
  answer: number;
  attempts: number;
  maxAttempts: number;
  startedAtMs: number;
}

const numberGames = new Map<string, NumberGame>();

// ⏱️ 開始したゲームの有効期限。期限が無いと、放置されたゲームが
// そのチャンネルで新しいゲームを永遠に始められなくし（start は
// 「進行中」と返すだけ）、マップも増え続けた。startedAtMs は
// 記録されていたが使われていなかった
export const NUMBER_GAME_TTL_MS = 30 * 60_000;

export function numberGameExpired(game: NumberGame, now = Date.now()): boolean {
  return now - game.startedAtMs > NUMBER_GAME_TTL_MS;
}

// ⏳ 数当て勝利の +30 XP には専用のクールダウンがある: ヒント付きの
// 二分探索なら数回で勝てるため、無いと報酬を連続で稼げてしまう。
// プレイ（と勝利）自体はブロックせず、XP 付与だけを止める。
// クールダウンはストアに保存し（下の kind）、メッセージ XP の
// クールダウンとは分ける。範囲は XP と同じギルド＋ユーザー単位
// （チャンネルを変えてもリセットされない）
export const NUMBER_GAME_XP_COOLDOWN_MS = 10 * 60_000;
export const NUMBER_GAME_XP_COOLDOWN_KIND = "number_game_xp";

// ⏳ 数当て XP を再び付与できるまでの残りミリ秒（今すぐ付与できる場合は 0）
export function numberGameXpCooldownRemainingMs(
  lastAwardedAtMs: number | null,
  now = Date.now(),
): number {
  if (lastAwardedAtMs === null) return 0;
  const remaining = NUMBER_GAME_XP_COOLDOWN_MS - (now - lastAwardedAtMs);
  return remaining > 0 ? remaining : 0;
}

// ⏳ じゃんけん／スロット勝利の +10 XP は1つのクールダウンを共有する
// （数当て XP と同じ設計: ストア保存、ギルド＋ユーザー単位、プレイ
// 自体はブロックしない）。無いと +10 をコマンド連打で稼げてしまう
export const GAME_XP_COOLDOWN_MS = 10 * 60_000;
export const GAME_XP_COOLDOWN_KIND = "game_win_xp";

// ⏳ ゲーム勝利 XP を再び付与できるまでの残りミリ秒（付与できる場合は 0）
export function gameXpCooldownRemainingMs(
  lastAwardedAtMs: number | null,
  now = Date.now(),
): number {
  if (lastAwardedAtMs === null) return 0;
  const remaining = GAME_XP_COOLDOWN_MS - (now - lastAwardedAtMs);
  return remaining > 0 ? remaining : 0;
}

// 🔍 キーに対応する進行中ゲームを返す。期限切れなら破棄して
// undefined を返し、新しく始め直せるようにする
function takeActiveGame(key: string): NumberGame | undefined {
  const game = numberGames.get(key);
  if (game && numberGameExpired(game)) {
    numberGames.delete(key);
    return undefined;
  }
  return game;
}

function numberGameKey(
  guildId: string,
  channelId: string,
  userId: string,
): string {
  return `${guildId}:${channelId}:${userId}`;
}

// ------------------------------------------
// ✊ じゃんけん
// ------------------------------------------
const JANKEN = {
  goo: { label: "グー", emoji: "✊" },
  choki: { label: "チョキ", emoji: "✌️" },
  paa: { label: "パー", emoji: "🖐️" },
} as const;

type JankenChoice = keyof typeof JANKEN;

function jankenWinner(
  user: JankenChoice,
  bot: JankenChoice,
): "win" | "lose" | "draw" {
  if (user === bot) return "draw";
  if (
    (user === "goo" && bot === "choki") ||
    (user === "choki" && bot === "paa") ||
    (user === "paa" && bot === "goo")
  ) {
    return "win";
  }
  return "lose";
}

// ------------------------------------------
// 🎰 スロット
// ------------------------------------------
const SLOT_SYMBOLS = ["🍒", "🍋", "🍇", "⭐", "🔔", "💎"];

function slotResult(): {
  symbols: [string, string, string];
  win: boolean;
  jackpot: boolean;
} {
  const pick = (): string =>
    SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)]!;
  const symbols: [string, string, string] = [pick(), pick(), pick()];
  const win = symbols[0] === symbols[1] && symbols[1] === symbols[2];
  return { symbols, win, jackpot: win && symbols[0] === "💎" };
}

// ------------------------------------------
// ⌨️ ゲームコマンド処理
// ------------------------------------------
export async function handleGameCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  store: MabusabaStore,
): Promise<void> {
  const guildId = interaction.guildId;
  if (
    !guildId ||
    !interaction.guild ||
    !interaction.channel ||
    !("send" in interaction.channel)
  ) {
    await replyEmbed(
      interaction,
      "⚠️ サーバー内で使用してください",
      "このコマンドはサーバー内で使用してください。",
      EMBED_COLOR_ERROR,
    );
    return;
  }
  const guild = interaction.guild as Guild;
  const channel = interaction.channel as TextChannel;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // ✨ 勝利時は上の共有クールダウンのもとで +10 XP を付与する
  // （数当ては +30 XP で、専用の10分クールダウンが別にある）。
  // ゲーム XP はメッセージ XP のクールダウンを動かさない。
  // 付与は返信より先に行い、クールダウンは付与が成功した後にだけ
  // 記録する。「+10 XP」の文言・クールダウン・保存された XP が
  // 食い違わないため（以前は返信が先で、付与に失敗しても
  // 獲得したように表示された）
  type WinXpOutcome =
    | { status: "granted" }
    | { status: "cooldown"; remainingMs: number }
    | { status: "failed" };
  const grantWinXp = async (): Promise<WinXpOutcome> => {
    const remainingMs = gameXpCooldownRemainingMs(
      store.getCooldownLastAt(
        guildId,
        interaction.user.id,
        GAME_XP_COOLDOWN_KIND,
      ),
    );
    if (remainingMs > 0) return { status: "cooldown", remainingMs };
    try {
      await awardXp(store, guild, channel, interaction.user.id, 10, {
        touchCooldown: false,
      });
    } catch (error) {
      console.error("[mabusaba] game win XP failed:", error);
      return { status: "failed" };
    }
    store.recordCooldown(guildId, interaction.user.id, GAME_XP_COOLDOWN_KIND);
    return { status: "granted" };
  };
  const winXpSuffix = (outcome: WinXpOutcome): string => {
    if (outcome.status === "granted") return " +10 XP";
    if (outcome.status === "cooldown") {
      const minutes = Math.ceil(outcome.remainingMs / 60_000);
      return `\n⏳ ゲームXPはクールダウン中（あと約${minutes}分）のため、今回はXPは付与されませんでした。`;
    }
    return "\n⚠️ XPの付与に失敗しました。";
  };

  // ----- ✊ じゃんけん -----
  if (sub === "janken") {
    const choice = interaction.options.getString(
      "choice",
      true,
    ) as JankenChoice;
    const botChoice = (["goo", "choki", "paa"] as const)[randomInt(0, 2)]!;
    const result = jankenWinner(choice, botChoice);
    let text: string;
    if (result === "win") {
      text = `🎉 あなたの勝ち！${winXpSuffix(await grantWinXp())}`;
    } else if (result === "lose") {
      text = "😢 あなたの負け…";
    } else {
      text = "🤝 あいこ！";
    }
    await replyEmbed(
      interaction,
      "✊✌️🖐️ じゃんけん",
      `あなた：${JANKEN[choice].emoji} ${JANKEN[choice].label}\nまぶさば：${JANKEN[botChoice].emoji} ${JANKEN[botChoice].label}\n\n${text}`,
      result === "win" ? EMBED_COLOR_SUCCESS : EMBED_COLOR_INFO,
      false,
    );
    return;
  }

  // ----- 🪙 コイン -----
  if (sub === "coin") {
    const heads = Math.random() < 0.5;
    await replyEmbed(
      interaction,
      "🪙 コイントス",
      heads ? "🪙 **表** が出ました！" : "🪙 **裏** が出ました！",
      EMBED_COLOR_INFO,
      false,
    );
    return;
  }

  // ----- 🎰 スロット -----
  if (sub === "slot") {
    const { symbols, win, jackpot } = slotResult();
    const line = symbols.join(" | ");
    let resultText = "😢 はずれ…もう一度挑戦してみてね";
    if (win) {
      const outcome = await grantWinXp();
      resultText = `${jackpot ? "💎💎💎 ジャックポット！" : "🎉 そろった！"}${winXpSuffix(outcome)}`;
    }
    await replyEmbed(
      interaction,
      "🎰 スロット",
      `${line}\n\n${resultText}`,
      win ? EMBED_COLOR_SUCCESS : EMBED_COLOR_INFO,
      false,
    );
    return;
  }

  // ----- 🔢 数当てゲーム -----
  if (group === "number") {
    // /game number はサブコマンドグループ（start / guess）
    const leaf = interaction.options.getSubcommand(true);
    const key = numberGameKey(
      guildId,
      interaction.channelId,
      interaction.user.id,
    );
    if (leaf === "start") {
      const existing = takeActiveGame(key);
      if (existing) {
        await replyEmbed(
          interaction,
          "🔢 数当てゲーム",
          `すでに進行中のゲームがあります。残り ${existing.maxAttempts - existing.attempts} 回です。\n\`/game number guess\` で数字を当ててみてください。`,
        );
        return;
      }
      numberGames.set(key, {
        answer: randomInt(1, 100),
        attempts: 0,
        maxAttempts: 10,
        startedAtMs: Date.now(),
      });
      await replyEmbed(
        interaction,
        "🔢 数当てゲーム開始！",
        "1〜100の数字を当ててください。10回まで挑戦できます（開始から30分で時間切れになります）。\n`/game number guess number:<数字>` で回答してください。",
        EMBED_COLOR_INFO,
        false,
      );
      return;
    }
    // guess — number（必須）
    const guess = interaction.options.getInteger("number", true);
    const game = takeActiveGame(key);
    if (!game) {
      await replyEmbed(
        interaction,
        "⚠️ ゲームが始まっていません",
        "まず `/game number start` でゲームを始めてください（開始から30分経ったゲームは時間切れで終了します）。",
        EMBED_COLOR_ERROR,
      );
      return;
    }
    game.attempts++;
    const left = game.maxAttempts - game.attempts;
    if (guess === game.answer) {
      numberGames.delete(key);
      const xpRemainingMs = numberGameXpCooldownRemainingMs(
        store.getCooldownLastAt(
          guildId,
          interaction.user.id,
          NUMBER_GAME_XP_COOLDOWN_KIND,
        ),
      );
      if (xpRemainingMs > 0) {
        // ⏳ クールダウン中: 勝利は成立するが XP は付与しない
        const minutes = Math.ceil(xpRemainingMs / 60_000);
        await replyEmbed(
          interaction,
          "🎉 正解！",
          `正解は **${game.answer}** でした！ ${game.attempts}回目で当てました。\n⏳ 数当てゲームのXPはクールダウン中（あと約${minutes}分）のため、今回はXPは付与されませんでした。`,
          EMBED_COLOR_SUCCESS,
          false,
        );
        return;
      }
      // 📌 付与を先に行い、クールダウンは成功後にだけ記録し、返信は
      // 最後にする（以前は「+30 XP」の返信とクールダウン記録が付与
      // より先で、付与に失敗しても獲得表示になりクールダウンだけ
      // 消費された）
      let granted = true;
      try {
        await awardXp(store, guild, channel, interaction.user.id, 30, {
          touchCooldown: false,
        });
      } catch (error) {
        console.error("[mabusaba] number game XP failed:", error);
        granted = false;
      }
      if (granted) {
        store.recordCooldown(
          guildId,
          interaction.user.id,
          NUMBER_GAME_XP_COOLDOWN_KIND,
        );
      }
      await replyEmbed(
        interaction,
        "🎉 正解！",
        granted
          ? `正解は **${game.answer}** でした！ ${game.attempts}回目で当てました。\n+30 XP を獲得しました！`
          : `正解は **${game.answer}** でした！ ${game.attempts}回目で当てました。\n⚠️ XPの付与に失敗しました。`,
        EMBED_COLOR_SUCCESS,
        false,
      );
      return;
    }
    if (left <= 0) {
      numberGames.delete(key);
      await replyEmbed(
        interaction,
        "😢 ゲームオーバー",
        `10回使い切りました…。正解は **${game.answer}** でした。\n\`/game number start\` でもう一度挑戦できます。`,
        EMBED_COLOR_ERROR,
        false,
      );
      return;
    }
    const hint =
      guess < game.answer
        ? "もっと **大きい** 数字です ⬆️"
        : "もっと **小さい** 数字です ⬇️";
    await replyEmbed(
      interaction,
      "🔢 数当てゲーム",
      `${guess} は違います。${hint}\n残り ${left} 回です。`,
      EMBED_COLOR_INFO,
      false,
    );
    return;
  }

  await replyEmbed(
    interaction,
    "⚠️ 不明なゲームです",
    "不明なゲームです。",
    EMBED_COLOR_ERROR,
  );
}

// ------------------------------------------
// 🧪 テスト用エクスポート
// ------------------------------------------
// テスト用にエクスポートする（純粋ロジック、Discord 不要）
export { jankenWinner, slotResult };
