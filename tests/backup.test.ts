// ==========================================
// 🧪 テスト: 起動時 DB バックアップ
// ==========================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backupDatabase,
  backupTimestamp,
  pruneBackups,
} from "../src/backup.js";

// ------------------------------------------
// 🕐 世代名の形式
// ------------------------------------------
describe("backupTimestamp", () => {
  it("formats as a sortable timestamp (suzushiro と同じ形式)", () => {
    const earlier = backupTimestamp(new Date("2026-11-23T00:00:00.000Z"));
    const later = backupTimestamp(new Date("2026-11-23T00:00:01.000Z"));
    assert.equal(earlier, "20261123T000000Z");
    assert.ok(earlier < later);
  });
});

// ------------------------------------------
// 💾 バックアップ本体
// ------------------------------------------
describe("backupDatabase", () => {
  it("copies the DB into backups/<timestamp>/ with its contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-backup-"));
    try {
      const dbPath = join(dir, "test.db");
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42);");
      const dest = backupDatabase(db, dbPath, "20261123T000000Z", 10);
      db.close();
      assert.equal(dest, join(dir, "backups", "20261123T000000Z", "test.db"));
      assert.ok(dest && existsSync(dest));
      const copy = new DatabaseSync(dest!);
      try {
        const row = copy.prepare("SELECT x FROM t").get() as { x: number };
        assert.equal(row.x, 42);
      } finally {
        copy.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null and creates nothing when the DB file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-backup-"));
    try {
      const dbPath = join(dir, "missing.db");
      const db = new DatabaseSync(join(dir, "other.db"));
      try {
        assert.equal(backupDatabase(db, dbPath, "20261123T000000Z", 10), null);
      } finally {
        db.close();
      }
      assert.equal(existsSync(join(dir, "backups")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes older generations beyond the retention count", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-backup-"));
    try {
      const dbPath = join(dir, "test.db");
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE t (x INTEGER);");
      backupDatabase(db, dbPath, "20261120T000000Z", 2);
      backupDatabase(db, dbPath, "20261121T000000Z", 2);
      backupDatabase(db, dbPath, "20261122T000000Z", 2);
      db.close();
      assert.deepEqual(readdirSync(join(dir, "backups")).sort(), [
        "20261121T000000Z",
        "20261122T000000Z",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------
// 🧹 世代の間引き
// ------------------------------------------
describe("pruneBackups", () => {
  it("keeps only the newest N generation directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-backup-"));
    try {
      const root = join(dir, "backups");
      for (const name of [
        "20261120T000000Z",
        "20261121T000000Z",
        "20261122T000000Z",
      ]) {
        mkdirSync(join(root, name), { recursive: true });
        writeFileSync(join(root, name, "test.db"), "x");
      }
      pruneBackups(root, 2);
      assert.deepEqual(readdirSync(root).sort(), [
        "20261121T000000Z",
        "20261122T000000Z",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when the backup root does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "mabubot-backup-"));
    try {
      pruneBackups(join(dir, "backups"), 10);
      assert.equal(existsSync(join(dir, "backups")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
