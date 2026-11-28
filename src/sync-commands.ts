// ==========================================
// 🔁 スラッシュコマンドの上書き同期
// ==========================================
// コマンド登録はこのスクリプト（`npm run sync:commands`）だけが行う。
// Bot 本体は起動時に同期しない（index.ts 参照）ため、古いコマンドが
// 再起動で復活することはない。
//
// 上書きの仕組み:
//  1. 現在のグローバルコマンドを取得する（何が消えるか報告するため）
//  2. 望む一式で PUT する。Discord のアプリケーションコマンドへの
//     PUT は全置換で、本文に無いコマンドはすべて削除され、本文の
//     コマンドは作成・更新される。マージは一切されない
//  3. 再取得して、実物が望む一式と完全一致するか検証する。
//     一致しなければ成功を装わず非ゼロで終了する
//
// 環境変数（DISCORD_TOKEN / DISCORD_APPLICATION_ID）はシェルに
// export するか systemd の EnvironmentFile で渡すこと。このファイル
// は .env を読まない（dotenv に依存しない）。
import { REST, Routes } from "discord.js";
import { allCommands } from "./commands.js";

// ------------------------------------------
// ⚙️ 環境変数の読み込み
// ------------------------------------------
const token = process.env.DISCORD_TOKEN?.trim();
const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
if (!token || !applicationId) {
  console.error("DISCORD_TOKEN and DISCORD_APPLICATION_ID are required.");
  process.exit(1);
}

// ------------------------------------------
// 🔁 同期処理
// ------------------------------------------
const desired = allCommands.map((c) => c.toJSON());
const desiredNames = desired.map((c) => c.name).sort();
const rest = new REST({ version: "10" }).setToken(token);

const before = (await rest.get(
  Routes.applicationCommands(applicationId),
)) as Array<{ name: string }>;
const beforeNames = before.map((c) => c.name).sort();
const removed = beforeNames.filter((name) => !desiredNames.includes(name));
const added = desiredNames.filter((name) => !beforeNames.includes(name));

await rest.put(Routes.applicationCommands(applicationId), { body: desired });

const after = (await rest.get(
  Routes.applicationCommands(applicationId),
)) as Array<{ name: string }>;
const afterNames = after.map((c) => c.name).sort();
if (JSON.stringify(afterNames) !== JSON.stringify(desiredNames)) {
  console.error(
    `Overwrite sync verification failed. Expected: ${desiredNames.join(", ")}. Live: ${afterNames.join(", ")}.`,
  );
  process.exit(1);
}

console.log(
  `Application commands overwrite-synced (${before.length} -> ${after.length}).`,
);
if (added.length) console.log(`Added: ${added.join(", ")}`);
if (removed.length) console.log(`Removed: ${removed.join(", ")}`);
console.log(`Live commands: ${afterNames.join(", ")}`);
