// ==========================================
// 💾 起動時 DB バックアップ
// ==========================================
// suzushiro と同じ方式: 起動時に DB ファイルを
// data/backups/<timestamp>/ へコピーし、直近の世代だけを残す。
// WAL の未反映分を取りこぼさないよう、コピー前にチェックポイントし、
// チェックポイントに失敗した場合はサイドカー（-wal / -shm）も
// 一緒にコピーする。
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// ------------------------------------------
// 🗂️ 世代管理
// ------------------------------------------
// 📌 保持世代数（環境変数 DB_BACKUP_RETENTION、既定10、最小1）
export const DB_BACKUP_RETENTION = Math.max(
  1,
  Number(process.env.DB_BACKUP_RETENTION || 10),
);

// 🕐 世代ディレクトリ名（辞書順＝時系列順になる形式、suzushiro と同一）
export function backupTimestamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

// 🧹 保持世代数を超えた古い世代を削除する
export function pruneBackups(backupRoot: string, retention: number): void {
  if (!existsSync(backupRoot)) return;
  const dirs = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const dir of dirs.slice(Math.max(1, retention))) {
    rmSync(join(backupRoot, dir), { recursive: true, force: true });
  }
}

// ------------------------------------------
// 💾 バックアップ本体
// ------------------------------------------
// DB ファイルをバックアップし、コピー先のパスを返す。
// DB ファイルが存在しない場合は何もせず null を返す。
export function backupDatabase(
  db: DatabaseSync,
  dbPath: string,
  timestamp: string = backupTimestamp(),
  retention: number = DB_BACKUP_RETENTION,
): string | null {
  if (!existsSync(dbPath)) return null;
  const backupRoot = join(dirname(dbPath), "backups");
  const directory = join(backupRoot, timestamp);
  mkdirSync(directory, { recursive: true });

  // 📌 WAL チェックポイントで本体ファイルへ反映してからコピーする。
  // 失敗したら未反映分が入ったサイドカーも一緒にコピーする
  let checkpointed = false;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    checkpointed = true;
  } catch (error) {
    console.warn(
      "[mabusaba] WAL checkpoint before backup failed; copying sidecars too:",
      error,
    );
  }

  const destination = join(directory, basename(dbPath));
  copyFileSync(dbPath, destination);
  if (!checkpointed) {
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${dbPath}${suffix}`;
      if (existsSync(sidecar)) {
        copyFileSync(sidecar, `${destination}${suffix}`);
      }
    }
  }
  pruneBackups(backupRoot, retention);
  return destination;
}
