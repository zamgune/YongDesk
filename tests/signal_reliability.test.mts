import assert from "node:assert/strict";
import test from "node:test";

import { calculateSignalReliability } from "../src/lib/market/signal-reliability.ts";
import type { Candle } from "../src/domain/market.ts";

const makeBaseCandles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index + 1,
    open: 98,
    high: 101,
    low: 95,
    close: 99,
    volume: 1_000_000,
  }));

const addSuccessfulBreakout = (candles: Candle[], index: number, level: number) => {
  candles[index] = {
    time: index + 1,
    open: level + 1,
    high: level + 6,
    low: level,
    close: level + 5,
    volume: 2_200_000,
  };
  for (let offset = 1; offset <= 20; offset += 1) {
    candles[index + offset] = {
      time: index + offset + 1,
      open: level + 8,
      high: level + 12,
      low: level + 4,
      close: level + 10,
      volume: 1_100_000,
    };
  }
  candles[index + 5] = {
    time: index + 6,
    open: level + 16,
    high: level + 42,
    low: level + 14,
    close: level + 34,
    volume: 1_200_000,
  };
};

const addFailedBreakout = (candles: Candle[], index: number, level: number) => {
  candles[index] = {
    time: index + 1,
    open: level + 1,
    high: level + 6,
    low: level,
    close: level + 5,
    volume: 2_200_000,
  };
  candles[index + 4] = {
    time: index + 5,
    open: level - 2,
    high: level,
    low: level - 12,
    close: level - 10,
    volume: 1_400_000,
  };
};

test("calculateSignalReliability grades repeated successful new-high breakouts", () => {
  const candles = makeBaseCandles(240);
  addSuccessfulBreakout(candles, 70, 102);
  addSuccessfulBreakout(candles, 110, 150);
  addSuccessfulBreakout(candles, 150, 200);
  addSuccessfulBreakout(candles, 190, 250);

  const reliability = calculateSignalReliability({
    candles,
    breakoutSignal: {
      status: "confirmed",
      pattern: "new-high",
      breakoutLevel: 192,
      supportLevel: 192,
      failureLevel: 185,
      volumeRatio: 2.2,
      entryPlan: "신고가 기준선 위 종가 유지와 거래량 확인으로 진입 가능 후보입니다.",
      invalidation: "실패선 아래 마감 시 무효입니다.",
      reasons: [],
    },
  });

  assert.equal(reliability.pattern, "new-high");
  assert.equal(reliability.grade, "high");
  assert.equal(reliability.sampleSize >= 3, true);
  assert.equal((reliability.successRate ?? 0) >= 0.6, true);
});

test("calculateSignalReliability does not overstate thin history", () => {
  const reliability = calculateSignalReliability({
    candles: makeBaseCandles(70),
    breakoutSignal: {
      status: "watch",
      pattern: "box-breakout",
      breakoutLevel: 105,
      supportLevel: 105,
      failureLevel: 98,
      volumeRatio: 1.1,
      entryPlan: "박스권 상단 돌파 대기입니다.",
      invalidation: "박스권 하단 이탈 시 무효입니다.",
      reasons: [],
    },
  });

  assert.equal(reliability.grade, "insufficient-data");
  assert.equal(reliability.successRate, null);
});

test("calculateSignalReliability lowers grade when stops are hit first", () => {
  const candles = makeBaseCandles(240);
  addFailedBreakout(candles, 70, 102);
  addFailedBreakout(candles, 110, 150);
  addFailedBreakout(candles, 150, 200);
  addFailedBreakout(candles, 190, 250);

  const reliability = calculateSignalReliability({
    candles,
    breakoutSignal: {
      status: "confirmed",
      pattern: "new-high",
      breakoutLevel: 192,
      supportLevel: 192,
      failureLevel: 185,
      volumeRatio: 2.2,
      entryPlan: "신고가 기준선 위 종가 유지와 거래량 확인으로 진입 가능 후보입니다.",
      invalidation: "실패선 아래 마감 시 무효입니다.",
      reasons: [],
    },
  });

  assert.equal(reliability.grade, "low");
  assert.equal((reliability.stopHitRate ?? 0) >= 0.6, true);
});
