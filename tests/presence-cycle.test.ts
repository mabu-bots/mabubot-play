// ==========================================
// 🧪 テスト: プレゼンス・サイクル
// ==========================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatElapsedMinutes,
  nextPresenceSend,
  presenceCycleText,
  PRESENCE_SEND_LEAD_MS,
} from "../src/presence-cycle.js";

// ------------------------------------------
// ⏱️ 経過時間の整形
// ------------------------------------------
describe("formatElapsedMinutes", () => {
  it("formats minutes below an hour without padding", () => {
    assert.equal(formatElapsedMinutes(0), "0分");
    assert.equal(formatElapsedMinutes(26 * 60_000), "26分");
    assert.equal(formatElapsedMinutes(59 * 60_000 + 59_999), "59分");
  });

  it("formats hours with zero-padded minutes", () => {
    assert.equal(formatElapsedMinutes(60 * 60_000), "1時間00分");
    assert.equal(formatElapsedMinutes(86 * 60_000), "1時間26分");
    assert.equal(formatElapsedMinutes(125 * 60_000), "2時間05分");
  });

  it("clamps negative durations to zero", () => {
    assert.equal(formatElapsedMinutes(-1), "0分");
  });
});

// ------------------------------------------
// 🎮 サイクル文言（位相の切り替え）
// ------------------------------------------
describe("presenceCycleText", () => {
  // 📌 Unix 分が偶数の時刻（経過時間パターン）: 2026-11-14T03:00:00Z は
  // epoch 分で偶数になるよう選んだ基準点
  const evenMinute = Date.UTC(2026, 10, 14, 3, 0, 0);
  const startedAt = evenMinute - 86 * 60_000;

  it("shows the elapsed pattern on even minutes", () => {
    assert.equal(
      Math.floor(evenMinute / 60_000) % 2,
      0,
      "test premise: evenMinute must be an even Unix minute",
    );
    assert.equal(
      presenceCycleText("まぶさば", startedAt, new Date(evenMinute)),
      "まぶさば | 起動して 1時間26分",
    );
  });

  it("shows the current JST time on odd minutes", () => {
    const oddMinute = evenMinute + 60_000; // 03:01 UTC = 12:01 JST
    assert.equal(
      presenceCycleText("まぶさば", startedAt, new Date(oddMinute)),
      "まぶさば | 現在時刻 12:01 JST",
    );
  });
});

// ------------------------------------------
// ⏰ 次回送信スケジュール
// ------------------------------------------
describe("nextPresenceSend", () => {
  it("sends 200ms before the next minute boundary", () => {
    const now = Date.UTC(2026, 10, 14, 3, 0, 10);
    const { sendAt, boundary } = nextPresenceSend(now);
    assert.equal(boundary, Date.UTC(2026, 10, 14, 3, 1, 0));
    assert.equal(sendAt, boundary - PRESENCE_SEND_LEAD_MS);
    assert.ok(sendAt > now);
  });

  it("advances a full minute when the send time is already past", () => {
    // 📌 境界の 100ms 前: この境界向けの送信予定（200ms 前）は過ぎている
    const boundary = Date.UTC(2026, 10, 14, 3, 1, 0);
    const now = boundary - 100;
    const next = nextPresenceSend(now);
    assert.equal(next.boundary, boundary + 60_000);
    assert.equal(next.sendAt, boundary + 60_000 - PRESENCE_SEND_LEAD_MS);
    assert.ok(next.sendAt > now);
  });
});
