import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateConfirmedObvDivergence,
  calculateConfirmedRsiDivergence,
} from "../src/lib/market/causal-divergence.ts";
import type { MarketCandle } from "../src/lib/market-data/types.ts";

const candlesFrom = (lows: number[], highs: number[]): MarketCandle[] =>
  lows.map((low, index) => ({
    time: 1_000 + index * 300,
    closeTime: 1_000 + (index + 1) * 300,
    open: low + 2,
    high: highs[index],
    low,
    close: low + 2,
    volume: 1_000,
  }));

test("RSI divergence is exposed on the confirmation bar, not the pivot bar", () => {
  const candles = candlesFrom(
    [10, 9, 7, 9, 10, 9, 6, 9, 10],
    [12, 13, 14, 13, 12, 13, 14, 13, 12],
  );
  const rsi = [50, 40, 20, 40, 50, 40, 30, 40, 50];
  const result = calculateConfirmedRsiDivergence(candles, rsi, 2);

  assert.equal(result.bullMask[6], false);
  assert.equal(result.bullMask[8], true);
  assert.deepEqual(result.bullEvents[0], {
    direction: "bullish",
    previousOccurredIndex: 2,
    occurredIndex: 6,
    confirmedIndex: 8,
    previousOccurredAt: candles[2].time,
    occurredAt: candles[6].time,
    confirmedAt: candles[8].closeTime,
  });
});

test("unconfirmed pivots never appear and confirmed prefixes stay invariant", () => {
  const candles = candlesFrom(
    [10, 9, 7, 9, 10, 9, 6, 9, 10, 8, 11],
    [12, 13, 14, 13, 12, 13, 14, 13, 12, 13, 12],
  );
  const obv = [100, 90, 70, 80, 90, 100, 80, 90, 100, 110, 120];
  const prefix = calculateConfirmedObvDivergence(candles.slice(0, 8), obv.slice(0, 8), 2);
  const confirmed = calculateConfirmedObvDivergence(candles.slice(0, 9), obv.slice(0, 9), 2);
  const extended = calculateConfirmedObvDivergence(candles, obv, 2);

  assert.equal(prefix.bullEvents.length, 0);
  assert.equal(confirmed.bullMask[8], true);
  assert.deepEqual(extended.bullMask.slice(0, 9), confirmed.bullMask);
  assert.deepEqual(extended.bullEvents[0], confirmed.bullEvents[0]);
});

test("bearish divergence also waits for the symmetric pivot window", () => {
  const candles = candlesFrom(
    [8, 8, 8, 8, 8, 8, 8, 8, 8],
    [10, 11, 14, 11, 10, 11, 15, 11, 10],
  );
  const rsi = [50, 60, 80, 60, 50, 60, 70, 60, 50];
  const result = calculateConfirmedRsiDivergence(candles, rsi, 2);

  assert.equal(result.bearMask[6], false);
  assert.equal(result.bearMask[8], true);
  assert.equal(result.bearEvents[0]?.occurredAt, candles[6].time);
  assert.equal(result.bearEvents[0]?.confirmedAt, candles[8].closeTime);
});

test("a confirmed pivot stays hidden until the confirmation candle closes", () => {
  const candles = candlesFrom(
    [10, 9, 7, 9, 10, 9, 6, 9, 10],
    [12, 13, 14, 13, 12, 13, 14, 13, 12],
  );
  const rsi = [50, 40, 20, 40, 50, 40, 30, 40, 50];
  const confirmationOpen = candles[8].time;
  const confirmationClose = candles[8].closeTime!;

  const forming = calculateConfirmedRsiDivergence(candles, rsi, 2, confirmationOpen);
  const closed = calculateConfirmedRsiDivergence(candles, rsi, 2, confirmationClose);

  assert.equal(forming.bullEvents.length, 0);
  assert.equal(forming.bullMask[8], false);
  assert.equal(closed.bullEvents.length, 1);
  assert.equal(closed.bullEvents[0]?.confirmedAt, confirmationClose);
});
