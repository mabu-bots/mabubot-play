// ==========================================
// 🗄️ SQLite ストア（XP・レベル報酬・クールダウン）
// ==========================================
// Node 標準の node:sqlite を使い、ネイティブ依存を持たない。
// DB ファイルは1つ: data/mabubot-play.db
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabase } from "./backup.js";
import { levelFromTotalXp } from "./util.js";

// ------------------------------------------
// 📋 行データの型定義
// ------------------------------------------
export interface XpRow {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  last_xp_at_ms: number;
}

export interface LevelRewardRow {
  guild_id: string;
  level: number;
  role_id: string;
}

// ------------------------------------------
// 🗄️ ストア本体
// ------------------------------------------
export class MabusabaStore {
  private db: DatabaseSync;

  // ----- 🏗️ 初期化 -----
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, "mabubot-play.db");
    this.db = new DatabaseSync(dbPath);
    // 📌 WAL + synchronous NORMAL: コミットを軽くし、単一書き手に
    // 読み手がブロックされないようにする（この Bot のアクセス形）
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS xp_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 0,
        last_xp_at_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS level_rewards (
        guild_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, level)
      );
      CREATE TABLE IF NOT EXISTS cooldowns (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        last_at_ms INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_xp_guild_xp ON xp_users (guild_id, xp DESC);
    `);
    // 💾 起動時バックアップ: DB を data/backups/<timestamp>/ へコピーし、
    // 直近の世代だけを残す（backup.ts、suzushiro と同じ方式）。
    // バックアップの失敗で起動自体は止めない
    try {
      const backupPath = backupDatabase(this.db, dbPath);
      if (backupPath) {
        console.log(`[mabusaba] database backup: ${backupPath}`);
      }
    } catch (error) {
      console.warn("[mabusaba] database backup failed:", error);
    }
  }

  // ----- 📊 XP・レベル -----

  getXp(guildId: string, userId: string): XpRow | null {
    const row = this.db
      .prepare(
        "SELECT guild_id, user_id, xp, level, last_xp_at_ms FROM xp_users WHERE guild_id = ? AND user_id = ?",
      )
      .get(guildId, userId) as XpRow | undefined;
    return row ?? null;
  }

  setXp(row: XpRow): void {
    this.db
      .prepare(
        `INSERT INTO xp_users (guild_id, user_id, xp, level, last_xp_at_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, last_xp_at_ms = excluded.last_xp_at_ms`,
      )
      .run(row.guild_id, row.user_id, row.xp, row.level, row.last_xp_at_ms);
  }

  // ➕ XP を加算し、加算前後の行を返す。レベルアップ時の対応
  // （お祝いメッセージと報酬ロール）は呼び出し側が決める。
  // 保存される `level` はこの書き込みの中で再計算するため、
  // ランキングなど列を読む側が XP 合計と食い違うことはない。
  // `touchCooldown: false` は last_xp_at_ms を動かさずに XP だけ
  // 付与する（ゲーム報酬用。メッセージ XP のクールダウンを
  // リセットしてはいけないため）
  addXp(
    guildId: string,
    userId: string,
    amount: number,
    opts: { now?: number; touchCooldown?: boolean } = {},
  ): { before: XpRow; after: XpRow } {
    const before: XpRow = this.getXp(guildId, userId) ?? {
      guild_id: guildId,
      user_id: userId,
      xp: 0,
      level: 0,
      last_xp_at_ms: 0,
    };
    const xp = before.xp + amount;
    const after: XpRow = {
      ...before,
      xp,
      level: levelFromTotalXp(xp).level,
      last_xp_at_ms:
        opts.touchCooldown === false
          ? before.last_xp_at_ms
          : (opts.now ?? Date.now()),
    };
    this.setXp(after);
    return { before, after };
  }

  // ⏳ 汎用クールダウン（呼び出し側が決める `kind` 単位の最終実行時刻）。
  // xp_users.last_xp_at_ms とは分ける: あちらはメッセージ XP 専用の
  // クールダウンで、独自のクールダウンを持つ報酬（数当てゲームの
  // XP など）が動かしてはいけない。addXp の touchCooldown: false と
  // 同じ理由である
  getCooldownLastAt(
    guildId: string,
    userId: string,
    kind: string,
  ): number | null {
    const row = this.db
      .prepare(
        "SELECT last_at_ms FROM cooldowns WHERE guild_id = ? AND user_id = ? AND kind = ?",
      )
      .get(guildId, userId, kind) as { last_at_ms: number } | undefined;
    return row?.last_at_ms ?? null;
  }

  recordCooldown(
    guildId: string,
    userId: string,
    kind: string,
    now: number = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO cooldowns (guild_id, user_id, kind, last_at_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, kind) DO UPDATE SET last_at_ms = excluded.last_at_ms`,
      )
      .run(guildId, userId, kind, now);
  }

  setLevel(guildId: string, userId: string, level: number): void {
    this.db
      .prepare(
        "UPDATE xp_users SET level = ? WHERE guild_id = ? AND user_id = ?",
      )
      .run(level, guildId, userId);
  }

  topXp(guildId: string, limit: number): XpRow[] {
    return this.db
      .prepare(
        "SELECT guild_id, user_id, xp, level, last_xp_at_ms FROM xp_users WHERE guild_id = ? ORDER BY xp DESC LIMIT ?",
      )
      .all(guildId, limit) as unknown as XpRow[];
  }

  xpRank(guildId: string, userId: string): number | null {
    // 📌 XP の行が無いユーザーは順位なし。旧クエリは部分クエリを
    // COALESCE(xp, 0) で包んでいたが、行自体が無いと部分クエリ全体が
    // NULL になり、`xp > NULL` が0人を数えて未ランクの全員が
    // 1位表示になっていた
    const self = this.getXp(guildId, userId);
    if (!self) return null;
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM xp_users WHERE guild_id = ? AND xp > ?",
      )
      .get(guildId, self.xp) as { n: number } | undefined;
    return row ? row.n + 1 : null;
  }

  // ----- 🎁 レベル報酬 -----

  getLevelRewards(guildId: string): LevelRewardRow[] {
    return this.db
      .prepare(
        "SELECT guild_id, level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level ASC",
      )
      .all(guildId) as unknown as LevelRewardRow[];
  }

  setLevelReward(guildId: string, level: number, roleId: string): void {
    this.db
      .prepare(
        `INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)
         ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`,
      )
      .run(guildId, level, roleId);
  }

  deleteLevelReward(guildId: string, level: number): void {
    this.db
      .prepare("DELETE FROM level_rewards WHERE guild_id = ? AND level = ?")
      .run(guildId, level);
  }

  // ----- 🔚 終了処理 -----
  close(): void {
    this.db.close();
  }
}
