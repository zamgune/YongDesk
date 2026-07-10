#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_DAYS = 730;
const DEFAULT_TFS = ["1d"];
const DEFAULT_REPORT = "daily";
const SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "BRK-B",
  "BTC-USD",
  "ETH-USD",
];
const TSLA_TARGET_WINDOWS = [
  { setupDate: "2024-04-23", expectedSignalDate: "2024-04-24" },
  { setupDate: "2024-10-23", expectedSignalDate: "2024-10-24" },
  { setupDate: "2025-03-10", expectedSignalDate: "2025-03-12" },
  { setupDate: "2025-04-08", expectedSignalDate: "2025-04-09" },
  { setupDate: "2025-04-21", expectedSignalDate: "2025-04-22" },
];

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
};

const baseUrl = readArg("base", DEFAULT_BASE_URL).replace(/\/$/, "");
const days = Number(readArg("days", String(DEFAULT_DAYS)));
const tfArg = readArg("tf", "");
const report = readArg("report", DEFAULT_REPORT);
const timeframes = tfArg
  ? tfArg
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : DEFAULT_TFS;

const pct = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "-";

const toDateLabel = (unixTime) => {
  if (typeof unixTime !== "number" || !Number.isFinite(unixTime)) {
    return "-";
  }
  return new Date(unixTime * 1000).toISOString().slice(0, 10);
};

const getRecentBuySample = (signals, limit = 8) =>
  signals
    .filter((signal) => signal?.type === "buy")
    .slice(-limit)
    .map((signal) => ({
      date: toDateLabel(signal.time),
      label: signal.label ?? "-",
      reason: signal.reason ?? "-",
    }));

const addDays = (dateLabel, daysToAdd) => {
  const date = new Date(`${dateLabel}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
};

const getTslaTargetHits = (signals) => {
  const buyDates = signals
    .filter((signal) => signal?.type === "buy")
    .map((signal) => toDateLabel(signal.time));

  return TSLA_TARGET_WINDOWS.map((target) => ({
    ...target,
    actualSignalDate:
      buyDates.find(
        (date) =>
          date >= target.setupDate && date <= addDays(target.setupDate, 2),
      ) ?? "-",
  }));
};

const getLocalBottomIndices = (candles, lookaroundBars = 3) => {
  const localBottomIndices = [];
  for (let i = lookaroundBars; i < candles.length - lookaroundBars; i += 1) {
    const currentLow = candles[i].low;
    let isLocalBottom = true;
    for (let j = i - lookaroundBars; j <= i + lookaroundBars; j += 1) {
      if (j === i) {
        continue;
      }
      const compareLow = candles[j].low;
      if (compareLow < currentLow || (compareLow === currentLow && j < i)) {
        isLocalBottom = false;
        break;
      }
    }
    if (isLocalBottom) {
      localBottomIndices.push(i);
    }
  }
  return localBottomIndices;
};

const getMissedUpLegSample = (candles, signals, upThreshold = 0.1) => {
  const totalBars = candles.length;
  const timeToIndex = new Map(candles.map((candle, index) => [candle.time, index]));
  const buyIndices = new Set(
    signals
      .filter((signal) => signal?.type === "buy")
      .map((signal) => timeToIndex.get(signal.time))
      .filter((index) => Number.isInteger(index)),
  );

  const misses = [];
  for (const bottomIndex of getLocalBottomIndices(candles, 3)) {
    const end = Math.min(totalBars - 1, bottomIndex + 30);
    if (end <= bottomIndex + 1) {
      continue;
    }

    const entry = candles[bottomIndex].close;
    let maxHigh = -Infinity;
    let maxHighIndex = bottomIndex + 1;
    for (let i = bottomIndex + 1; i <= end; i += 1) {
      if (candles[i].high > maxHigh) {
        maxHigh = candles[i].high;
        maxHighIndex = i;
      }
    }

    let minBeforeTop = Number.POSITIVE_INFINITY;
    for (let i = bottomIndex + 1; i <= maxHighIndex; i += 1) {
      minBeforeTop = Math.min(minBeforeTop, candles[i].low);
    }

    const upGain = maxHigh / entry - 1;
    const ddBeforeTop = minBeforeTop / entry - 1;
    const qualifies = upGain >= upThreshold && ddBeforeTop > -0.08;
    if (!qualifies) {
      continue;
    }

    let hit = false;
    const hitEnd = Math.min(totalBars - 1, bottomIndex + 5);
    for (let i = bottomIndex; i <= hitEnd; i += 1) {
      if (buyIndices.has(i)) {
        hit = true;
        break;
      }
    }

    if (!hit) {
      misses.push({
        date: toDateLabel(candles[bottomIndex].time),
        upGain,
        ddBeforeTop,
      });
    }
  }

  return misses.slice(-5);
};

const fetchDiagnostics = async (symbol, tf) => {
  const query = new URLSearchParams({
    days: String(days),
    tf,
    debug: "1",
    diag: "1",
  });
  const endpoint = `${baseUrl}/api/market/${encodeURIComponent(symbol)}?${query.toString()}`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return {
        symbol,
        tf,
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }

    const body = await response.json();
    const counters = body?.debugMeta?.counters ?? {};
    const dailyQuality = body?.debugMeta?.dailyQuality ?? null;
    const dailyBottomStudy = body?.debugMeta?.dailyBottomStudy ?? null;
    const dailyProfile = body?.debugMeta?.dailyProfile ?? null;
    const signals = Array.isArray(body?.signals) ? body.signals : [];
    const candles = Array.isArray(body?.candles) ? body.candles : [];

    const buySignals = signals.filter((signal) => signal?.type === "buy");
    const sellSignals = signals.filter((signal) => signal?.type === "sell");
    const lastBuy = buySignals.length ? buySignals[buySignals.length - 1] : null;
    const lastSell = sellSignals.length ? sellSignals[sellSignals.length - 1] : null;

    return {
      symbol,
      tf,
      ok: true,
      buys: buySignals.length,
      sells: sellSignals.length,
      lastBuyDate: toDateLabel(lastBuy?.time),
      lastSellDate: toDateLabel(lastSell?.time),
      counters,
      dailyQuality,
      dailyBottomStudy,
      dailyProfile,
      missedUpLegSample: getMissedUpLegSample(candles, signals, 0.1),
      recentBuySample: getRecentBuySample(signals),
      tslaTargetHits: symbol === "TSLA" && tf === "1d" ? getTslaTargetHits(signals) : null,
    };
  } catch (error) {
    return {
      symbol,
      tf,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const printDailyDetails = (rows) => {
  for (const row of rows) {
    if (row.tf !== "1d") {
      continue;
    }
    console.log(`\n[${row.symbol} 1D Samples]`);

    const misses = row.missedUpLegSample ?? [];
    if (misses.length) {
      console.log("- missed up-leg sample (latest 5)");
      for (const miss of misses) {
        console.log(
          `  ${miss.date} | up=${pct(miss.upGain)} | ddBeforeTop=${pct(miss.ddBeforeTop)}`,
        );
      }
    } else {
      console.log("- missed up-leg sample: none");
    }

    const failedBuys = row.dailyQuality?.recentFailedBuys ?? [];
    if (failedBuys.length) {
      console.log("- failed buy sample (latest 5)");
      for (const failed of failedBuys) {
        console.log(
          `  ${failed.date} | dd=${pct(failed.maxDrawdown)} | gain=${pct(failed.maxGain)} | ${failed.reason}`,
        );
      }
    } else {
      console.log("- failed buy sample: none");
    }

    const recentBuys = row.recentBuySample ?? [];
    if (recentBuys.length) {
      console.log("- recent buy sample");
      for (const buy of recentBuys) {
        console.log(`  ${buy.date} | ${buy.label} | ${buy.reason}`);
      }
    } else {
      console.log("- recent buy sample: none");
    }

    const bottomStudy = row.dailyBottomStudy ?? null;
    if (bottomStudy) {
      console.log(
        `- daily bottom study | setup=${bottomStudy.setupCoverage.hit}/${bottomStudy.setupCoverage.count} (${pct(bottomStudy.setupCoverage.hitRate)})` +
          ` | trigger<=3=${bottomStudy["triggerCoverage<=3"].hit}/${bottomStudy["triggerCoverage<=3"].count} (${pct(bottomStudy["triggerCoverage<=3"].hitRate)})` +
          ` | failedTriggerBuys=${bottomStudy.failedTriggerBuys.fail}/${bottomStudy.failedTriggerBuys.count} (${pct(bottomStudy.failedTriggerBuys.failRate)})`,
      );
    }

    if (row.symbol === "TSLA" && row.tslaTargetHits?.length) {
      console.log("- TSLA target windows");
      for (const target of row.tslaTargetHits) {
        console.log(
          `  ${target.setupDate} -> ${target.expectedSignalDate} | actual=${target.actualSignalDate}`,
        );
      }
    }
  }
};

const main = async () => {
  const rows = [];
  for (const tf of timeframes) {
    for (const symbol of SYMBOLS) {
      rows.push(await fetchDiagnostics(symbol, tf));
    }
  }

  const failedRows = rows.filter((row) => !row.ok);
  if (failedRows.length) {
    console.log("[Errors]");
    for (const row of failedRows) {
      console.log(`- ${row.symbol} ${row.tf}: ${row.error}`);
    }
    console.log("");
  }

  const okRows = rows.filter((row) => row.ok);
  if (!okRows.length) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `[Signal Diagnostics] base=${baseUrl} days=${days} tf=${timeframes.join(",")} report=${report}`,
  );
  console.log("");

  console.table(
    okRows.map((row) => ({
      symbol: row.symbol,
      tf: row.tf,
      profileType: row.dailyProfile?.type ?? "-",
      buys: row.buys,
      sells: row.sells,
      setupDetected: row.counters.setupDetected ?? 0,
      triggerCandidate: row.counters.triggerCandidate ?? 0,
      triggerPassed: row.counters.triggerPassed ?? 0,
      crashPass: row.counters.bullCrashReclaimPassed ?? 0,
      balancedPass: row.counters.bullBalancedPanicPassed ?? 0,
      flushPass: row.counters.bullFlushPanicPassed ?? 0,
      growthPass: row.counters.bullGrowthProfilePassed ?? 0,
      gapPass: row.counters.bullGapSnapbackPassed ?? 0,
      twoStepPass: row.counters.bullTwoStepFlushPassed ?? 0,
      compressionPass: row.counters.bullCompressionResetPassed ?? 0,
      turnDayPass: row.counters.bullTurnDayResetPassed ?? 0,
      exactDaySuppressed: row.counters.bullSuppressedBy1dExactDayPolicy ?? 0,
      growthVolGateRej: row.counters.bullGrowthProfileRejectedByVolGate ?? 0,
      growthBreakoutRej: row.counters.bullGrowthProfileRejectedByBreakoutQuality ?? 0,
      growthClusterRej: row.counters.bullGrowthProfileClusterSuppressed ?? 0,
      momentumRej: row.counters.rejectedByMomentumTurn ?? 0,
      structureRej: row.counters.rejectedByStructureBreak ?? 0,
      volumeOnlyMiss: row.counters.rejectedByVolumeOnlyFilter ?? 0,
      bullCooldownRej: row.counters.bullRejectedByCooldown ?? 0,
      bullStateRej: row.counters.bullRejectedByState ?? 0,
      bullEmitted: row.counters.bullSignalsEmitted ?? 0,
      setupCoverage: row.dailyBottomStudy
        ? `${row.dailyBottomStudy.setupCoverage.hit}/${row.dailyBottomStudy.setupCoverage.count}`
        : "-",
      triggerCov3: row.dailyBottomStudy
        ? `${row.dailyBottomStudy["triggerCoverage<=3"].hit}/${row.dailyBottomStudy["triggerCoverage<=3"].count}`
        : "-",
      triggerCov3Rate: row.dailyBottomStudy
        ? pct(row.dailyBottomStudy["triggerCoverage<=3"].hitRate)
        : "-",
      triggerFail10: row.dailyBottomStudy
        ? `${row.dailyBottomStudy.failedTriggerBuys.fail}/${row.dailyBottomStudy.failedTriggerBuys.count}`
        : "-",
      triggerFail10Rate: row.dailyBottomStudy
        ? pct(row.dailyBottomStudy.failedTriggerBuys.failRate)
        : "-",
      bottomLeg10: row.dailyQuality
        ? `${row.dailyQuality.bottomLeg10.hitLe5}/${row.dailyQuality.bottomLeg10.count}`
        : "-",
      bottomLeg10Rate: row.dailyQuality
        ? pct(row.dailyQuality.bottomLeg10.hitRate)
        : "-",
      buyFail10: row.dailyQuality
        ? `${row.dailyQuality.buyFailure10.fail}/${row.dailyQuality.buyFailure10.count}`
        : "-",
      buyFail10Rate: row.dailyQuality
        ? pct(row.dailyQuality.buyFailure10.failRate)
        : "-",
      lastBuy: row.lastBuyDate,
      lastSell: row.lastSellDate,
    })),
  );

  const summaryByTf = timeframes.map((tf) => {
    const group = okRows.filter((row) => row.tf === tf);
    const avgBottomLeg10Rate =
      group.reduce(
        (sum, row) =>
          sum + (row.dailyQuality ? row.dailyQuality.bottomLeg10.hitRate : 0),
        0,
      ) / Math.max(group.length, 1);
    const avgBuyFailRate =
      group.reduce(
        (sum, row) =>
          sum + (row.dailyQuality ? row.dailyQuality.buyFailure10.failRate : 0),
        0,
      ) / Math.max(group.length, 1);
    const avgTriggerCov3Rate =
      group.reduce(
        (sum, row) =>
          sum +
          (row.dailyBottomStudy
            ? row.dailyBottomStudy["triggerCoverage<=3"].hitRate
            : 0),
        0,
      ) / Math.max(group.length, 1);
    const avgTriggerFailRate =
      group.reduce(
        (sum, row) =>
          sum +
          (row.dailyBottomStudy
            ? row.dailyBottomStudy.failedTriggerBuys.failRate
            : 0),
        0,
      ) / Math.max(group.length, 1);
    return {
      tf,
      avgBuys: (
        group.reduce((sum, row) => sum + row.buys, 0) / Math.max(group.length, 1)
      ).toFixed(2),
      avgSells: (
        group.reduce((sum, row) => sum + row.sells, 0) / Math.max(group.length, 1)
      ).toFixed(2),
      avgTriggerCov3Rate: pct(avgTriggerCov3Rate),
      avgTriggerFail10Rate: pct(avgTriggerFailRate),
      avgBottomLeg10Rate: pct(avgBottomLeg10Rate),
      avgBuyFail10Rate: pct(avgBuyFailRate),
      totalCrashPass: group.reduce(
        (sum, row) => sum + (row.counters.bullCrashReclaimPassed ?? 0),
        0,
      ),
      totalBalancedPass: group.reduce(
        (sum, row) => sum + (row.counters.bullBalancedPanicPassed ?? 0),
        0,
      ),
      totalFlushPass: group.reduce(
        (sum, row) => sum + (row.counters.bullFlushPanicPassed ?? 0),
        0,
      ),
      totalGrowthPass: group.reduce(
        (sum, row) => sum + (row.counters.bullGrowthProfilePassed ?? 0),
        0,
      ),
    };
  });

  console.log("\n[Summary]");
  console.table(summaryByTf);

  if (report === "daily") {
    printDailyDetails(okRows);
  }

  if (failedRows.length) {
    process.exitCode = 1;
  }
};

await main();
