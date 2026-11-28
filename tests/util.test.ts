// ==========================================
// 🧪 テスト: XP計算・ゲーム・ストア・権限チェック・実行ログ
// ==========================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  formatCommandExecLog,
  levelFromTotalXp,
  totalXpForLevel,
  xpForLevel,
} from "../src/util.js";
import {
  gameXpCooldownRemainingMs,
  jankenWinner,
  numberGameExpired,
  numberGameXpCooldownRemainingMs,
  GAME_XP_COOLDOWN_KIND,
  GAME_XP_COOLDOWN_MS,
  NUMBER_GAME_TTL_MS,
  NUMBER_GAME_XP_COOLDOWN_KIND,
  NUMBER_GAME_XP_COOLDOWN_MS,
} from "../src/games.js";
import { handleLevelCommand, rewardRoleRejection } from "../src/level.js";
import { MabusabaStore } from "../src/store.js";

// ------------------------------------------
// 🧰 テスト用ヘルパー
// ------------------------------------------
const NOW = Date.UTC(2026, 10, 14, 3, 0, 0);

// ------------------------------------------
// 📊 XP・レベル
// ------------------------------------------
describe("XP / levels", () => {
  it("xpForLevel matches 5n^2 + 50n + 100", () => {
    assert.equal(xpForLevel(0), 100);
    assert.equal(xpForLevel(1), 155);
    assert.equal(xpForLevel(2), 220);
    assert.equal(xpForLevel(5), 475);
  });

  it("totalXpForLevel accumulates per-level XP", () => {
    assert.equal(totalXpForLevel(0), 0);
    assert.equal(totalXpForLevel(1), 100);
    assert.equal(totalXpForLevel(2), 255);
    assert.equal(totalXpForLevel(3), 475);
  });

  it("totalXpForLevel closed form matches the naive sum", () => {
    let expected = 0;
    for (let level = 0; level <= 60; level++) {
      assert.equal(totalXpForLevel(level), expected);
      expected += xpForLevel(level);
    }
  });

  it("levelFromTotalXp finds the level at boundaries", () => {
    assert.deepEqual(levelFromTotalXp(0), {
      level: 0,
      xpIntoLevel: 0,
      xpNeededForNext: 100,
    });
    assert.deepEqual(levelFromTotalXp(99), {
      level: 0,
      xpIntoLevel: 99,
      xpNeededForNext: 100,
    });
    assert.deepEqual(levelFromTotalXp(100), {
      level: 1,
      xpIntoLevel: 0,
      xpNeededForNext: 155,
    });
    assert.deepEqual(levelFromTotalXp(254), {
      level: 1,
      xpIntoLevel: 154,
      xpNeededForNext: 155,
    });
    assert.deepEqual(levelFromTotalXp(255), {
      level: 2,
      xpIntoLevel: 0,
      xpNeededForNext: 220,
    });
    assert.deepEqual(levelFromTotalXp(1000), {
      level: 4,
      xpIntoLevel: 230,
      xpNeededForNext: 380,
    });
  });
});

// ------------------------------------------
// 🔢 数当てゲームの有効期限
// ------------------------------------------
describe("number game expiry", () => {
  it("expires games older than the TTL", () => {
    const game = { answer: 42, attempts: 0, maxAttempts: 10, startedAtMs: NOW };
    assert.equal(numberGameExpired(game, NOW + NUMBER_GAME_TTL_MS - 1), false);
    assert.equal(numberGameExpired(game, NOW + NUMBER_GAME_TTL_MS + 1), true);
  });
});

// ------------------------------------------
// ✊ じゃんけん
// ------------------------------------------
describe("janken", () => {
  it("goo beats choki, loses to paa, draws itself", () => {
    assert.equal(jankenWinner("goo", "choki"), "win");
    assert.equal(jankenWinner("goo", "paa"), "lose");
    assert.equal(jankenWinner("goo", "goo"), "draw");
    assert.equal(jankenWinner("choki", "paa"), "win");
    assert.equal(jankenWinner("paa", "goo"), "win");
  });
});

// ------------------------------------------
// 🗄️ ストア
// ------------------------------------------
describe("store (SQLite)", () => {
  it("XP round-trips and the leaderboard order follows XP", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-play-test-"));
    const store = new MabusabaStore(dir);
    try {
      const { after } = store.addXp("g1", "u1", 120);
      assert.equal(after.xp, 120);
      assert.deepEqual(levelFromTotalXp(after.xp).level, 1);
      store.setLevel("g1", "u1", 1);
      assert.equal(store.getXp("g1", "u1")?.level, 1);
      store.addXp("g1", "u2", 50);
      assert.equal(store.topXp("g1", 10)[0]?.user_id, "u1");

      // 🎁 レベル報酬の往復（node:sqlite の行は素のオブジェクトでは
      // ないため、行全体の deepEqual ではなくフィールドで比較する）
      store.setLevelReward("g1", 5, "r1");
      const rewards = store.getLevelRewards("g1");
      assert.equal(rewards.length, 1);
      assert.equal(rewards[0]?.guild_id, "g1");
      assert.equal(rewards[0]?.level, 5);
      assert.equal(rewards[0]?.role_id, "r1");
      store.deleteLevelReward("g1", 5);
      assert.equal(store.getLevelRewards("g1").length, 0);
    } finally {
      store.close();
    }
  });

  it("xpRank is null for a user with no XP record", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      store.addXp("g1", "alice", 500);
      store.addXp("g1", "bob", 100);
      // 📌 回帰防止: 未ランクのユーザーが1位と表示されていた
      assert.equal(store.xpRank("g1", "carol"), null);
      assert.equal(store.xpRank("g1", "alice"), 1);
      assert.equal(store.xpRank("g1", "bob"), 2);
    } finally {
      store.close();
    }
  });

  it("addXp keeps the stored level in sync with the XP total", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      const { after } = store.addXp("g1", "u1", 120);
      assert.equal(after.level, 1);
      assert.equal(store.getXp("g1", "u1")?.level, 1);
    } finally {
      store.close();
    }
  });

  it("addXp with touchCooldown:false leaves the message-XP cooldown alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      store.addXp("g1", "u1", 20, { now: 1_000_000 });
      assert.equal(store.getXp("g1", "u1")?.last_xp_at_ms, 1_000_000);
      // 🎮 ゲーム報酬は後の時刻でもクールダウンを動かさない
      store.addXp("g1", "u1", 10, { now: 2_000_000, touchCooldown: false });
      assert.equal(store.getXp("g1", "u1")?.last_xp_at_ms, 1_000_000);
      assert.equal(store.getXp("g1", "u1")?.xp, 30);
    } finally {
      store.close();
    }
  });
});

// ------------------------------------------
// ⏳ 数当てゲーム XP のクールダウン
// ------------------------------------------
describe("number game XP cooldown", () => {
  it("is 10 minutes and available when never awarded", () => {
    assert.equal(NUMBER_GAME_XP_COOLDOWN_MS, 10 * 60_000);
    assert.equal(numberGameXpCooldownRemainingMs(null, NOW), 0);
  });

  it("blocks re-award until 10 minutes have passed", () => {
    // 付与直後: クールダウン全量が残る
    assert.equal(
      numberGameXpCooldownRemainingMs(NOW, NOW),
      NUMBER_GAME_XP_COOLDOWN_MS,
    );
    // 4分後: 6分残る
    assert.equal(
      numberGameXpCooldownRemainingMs(NOW, NOW + 4 * 60_000),
      6 * 60_000,
    );
    // ちょうど境界と、それ以降: 再び付与できる
    assert.equal(
      numberGameXpCooldownRemainingMs(NOW, NOW + NUMBER_GAME_XP_COOLDOWN_MS),
      0,
    );
    assert.equal(
      numberGameXpCooldownRemainingMs(
        NOW,
        NOW + NUMBER_GAME_XP_COOLDOWN_MS + 1,
      ),
      0,
    );
  });

  it("round-trips through the store, scoped by guild, user and kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      const kind = NUMBER_GAME_XP_COOLDOWN_KIND;
      assert.equal(store.getCooldownLastAt("g1", "u1", kind), null);
      store.recordCooldown("g1", "u1", kind, NOW);
      assert.equal(store.getCooldownLastAt("g1", "u1", kind), NOW);
      // ほかのギルド・ユーザー・kind には影響しない
      assert.equal(store.getCooldownLastAt("g2", "u1", kind), null);
      assert.equal(store.getCooldownLastAt("g1", "u2", kind), null);
      assert.equal(store.getCooldownLastAt("g1", "u1", "other"), null);
      // 再記録すると新しい時刻からクールダウンが始まる
      store.recordCooldown("g1", "u1", kind, NOW + 1000);
      assert.equal(store.getCooldownLastAt("g1", "u1", kind), NOW + 1000);
      // クールダウンは XP 行やメッセージ XP のクールダウンとは独立
      assert.equal(store.getXp("g1", "u1"), null);
    } finally {
      store.close();
    }
  });
});

// ------------------------------------------
// ⏳ ゲーム勝利 XP（じゃんけん・スロット）のクールダウン
// ------------------------------------------
describe("game win XP cooldown", () => {
  it("is 10 minutes and available when never awarded", () => {
    assert.equal(GAME_XP_COOLDOWN_MS, 10 * 60_000);
    assert.equal(gameXpCooldownRemainingMs(null, NOW), 0);
  });

  it("blocks re-award until 10 minutes have passed", () => {
    assert.equal(gameXpCooldownRemainingMs(NOW, NOW), GAME_XP_COOLDOWN_MS);
    assert.equal(gameXpCooldownRemainingMs(NOW, NOW + 4 * 60_000), 6 * 60_000);
    assert.equal(gameXpCooldownRemainingMs(NOW, NOW + GAME_XP_COOLDOWN_MS), 0);
    assert.equal(
      gameXpCooldownRemainingMs(NOW, NOW + GAME_XP_COOLDOWN_MS + 1),
      0,
    );
  });

  it("round-trips through the store under its own kind, separate from the number-game kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      assert.equal(
        store.getCooldownLastAt("g1", "u1", GAME_XP_COOLDOWN_KIND),
        null,
      );
      store.recordCooldown("g1", "u1", GAME_XP_COOLDOWN_KIND, NOW);
      assert.equal(
        store.getCooldownLastAt("g1", "u1", GAME_XP_COOLDOWN_KIND),
        NOW,
      );
      // 数当て側のクールダウンは別の kind で影響を受けない
      assert.equal(
        store.getCooldownLastAt("g1", "u1", NUMBER_GAME_XP_COOLDOWN_KIND),
        null,
      );
      assert.equal(
        store.getCooldownLastAt("g2", "u1", GAME_XP_COOLDOWN_KIND),
        null,
      );
      assert.equal(
        store.getCooldownLastAt("g1", "u2", GAME_XP_COOLDOWN_KIND),
        null,
      );
    } finally {
      store.close();
    }
  });
});

// ------------------------------------------
// 🔐 レベル報酬ロールの階層検証
// ------------------------------------------
describe("level reward role hierarchy", () => {
  it("rejects roles the bot cannot assign", () => {
    assert.equal(
      rewardRoleRejection({ editable: false, position: 1 }, 10, false),
      "not-editable",
    );
  });

  it("rejects roles at or above the executor's highest role", () => {
    assert.equal(
      rewardRoleRejection({ editable: true, position: 10 }, 10, false),
      "above-executor",
    );
    assert.equal(
      rewardRoleRejection({ editable: true, position: 11 }, 10, false),
      "above-executor",
    );
    // 実行者の位置が不明な場合は安全側に倒す
    assert.equal(
      rewardRoleRejection({ editable: true, position: 1 }, null, false),
      "above-executor",
    );
  });

  it("accepts roles below both the bot and the executor", () => {
    assert.equal(
      rewardRoleRejection({ editable: true, position: 3 }, 10, false),
      null,
    );
  });

  it("lets the guild owner register any bot-assignable role", () => {
    assert.equal(
      rewardRoleRejection({ editable: true, position: 99 }, 1, true),
      null,
    );
    // …ただし Bot 自身が付与できないロールはオーナーでも不可
    assert.equal(
      rewardRoleRejection({ editable: false, position: 99 }, 1, true),
      "not-editable",
    );
  });
});

// ------------------------------------------
// 🔐 /level reward の実行時権限チェック
// ------------------------------------------
describe("level reward permission check", () => {
  function fakeInteraction(memberPermissions: PermissionsBitField | null) {
    const replies: Array<{ embeds: Array<{ data: { title?: string } }> }> = [];
    const interaction = {
      guildId: "g1",
      guild: null,
      user: { id: "u1" },
      member: null,
      memberPermissions,
      replied: false,
      deferred: false,
      options: {
        getSubcommandGroup: () => "reward",
        getSubcommand: () => "list",
      },
      reply: async (payload: (typeof replies)[number]) => {
        replies.push(payload);
      },
      followUp: async (payload: (typeof replies)[number]) => {
        replies.push(payload);
      },
    };
    return {
      interaction: interaction as unknown as ChatInputCommandInteraction,
      replies,
    };
  }

  it("rejects members without ManageGuild even for list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      const { interaction, replies } = fakeInteraction(
        new PermissionsBitField(0n),
      );
      await handleLevelCommand(interaction, store);
      assert.equal(replies.length, 1);
      assert.equal(replies[0]?.embeds[0]?.data.title, "⚠️ 権限がありません");
    } finally {
      store.close();
    }
  });

  it("rejects when memberPermissions is missing entirely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      const { interaction, replies } = fakeInteraction(null);
      await handleLevelCommand(interaction, store);
      assert.equal(replies[0]?.embeds[0]?.data.title, "⚠️ 権限がありません");
    } finally {
      store.close();
    }
  });

  it("lets members with ManageGuild through to the reward list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mabusaba-test-"));
    const store = new MabusabaStore(dir);
    try {
      const { interaction, replies } = fakeInteraction(
        new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      );
      await handleLevelCommand(interaction, store);
      assert.equal(replies.length, 1);
      assert.equal(replies[0]?.embeds[0]?.data.title, "🎁 レベル報酬ロール");
    } finally {
      store.close();
    }
  });
});

// ------------------------------------------
// 📝 コマンド実行ログ（formatCommandExecLog）
// ------------------------------------------
describe("formatCommandExecLog", () => {
  const now = new Date("2026-11-23T00:00:00.000Z");
  const base = {
    commandName: "ping",
    route: "slash" as const,
    guildId: "g1",
    channelId: "c1",
    userId: "u1",
    now,
  };

  it("formats a successful execution in the fleet-wide format", () => {
    assert.equal(
      formatCommandExecLog(base),
      "[exec] 2026-11-23T00:00:00.000Z cmd=ping route=slash guild=g1 channel=c1 user=u1 result=ok",
    );
  });

  it("uses - for missing guild/channel (e.g. DM)", () => {
    const line = formatCommandExecLog({
      ...base,
      guildId: null,
      channelId: null,
    });
    assert.ok(line.includes("guild=- channel=-"));
    assert.ok(line.endsWith("result=ok"));
  });

  it("appends a single-line error summary on failure", () => {
    const line = formatCommandExecLog({
      ...base,
      error: new Error('boom\n"quoted"  details'),
    });
    assert.ok(line.includes("result=error"));
    assert.ok(line.endsWith('error="boom quoted details"'));
    assert.ok(!line.includes("\n"));
  });

  it("stringifies non-Error failures", () => {
    const line = formatCommandExecLog({ ...base, error: "plain failure" });
    assert.ok(line.endsWith('error="plain failure"'));
  });
});
