// ==========================================
// 🖥️ pm2 起動設定（mabubot-play）
// ==========================================
// 🚀 起動: pm2 start ecosystem.config.cjs
// サーバー再起動後も自動で立ち上げるには pm2 startup（表示される
// コマンドを実行）と pm2 save を行う。
//
// 📌 このファイルが .env を自分で読む理由: pm2 は .env を読み込まず、
// Bot 本体も自動では読み込まない（dotenv に依存しない）ため、ここで
// リポジトリ直下の .env を解析して環境変数として渡す。秘密情報は
// .env（gitignore 済み）にだけ置き、このファイルには書かない。
//
// 📌 Node のバージョン: Bot は Node 標準の node:sqlite を使う。
// Node 22 では --experimental-sqlite が必要なため、Node 24 未満では
// このファイルが自動でフラグを付ける（Node 24 以上では不要）。

// ------------------------------------------
// 📥 .env の読み込み
// ------------------------------------------
const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(file) {
  const env = {};
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return env;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

// ------------------------------------------
// ⚙️ アプリ設定
// ------------------------------------------
const envFromFile = loadEnvFile(path.join(__dirname, ".env"));
if (!envFromFile.DISCORD_TOKEN || !envFromFile.DISCORD_APPLICATION_ID) {
  console.error(
    "[mabubot-play] .env に DISCORD_TOKEN / DISCORD_APPLICATION_ID がありません。先に .env を用意してください。",
  );
}

const nodeMajor = Number(process.versions.node.split(".")[0]);

module.exports = {
  apps: [
    {
      name: "mabubot-play",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      kill_timeout: 5000,
      // 📌 Node 24 未満では node:sqlite 用のフラグが必要
      ...(nodeMajor < 24 ? { node_args: "--experimental-sqlite" } : {}),
      env: {
        NODE_ENV: "production",
        ...envFromFile,
      },
    },
  ],
};
