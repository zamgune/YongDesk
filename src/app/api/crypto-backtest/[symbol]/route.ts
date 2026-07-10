import { NextResponse } from "next/server";

import {
  buildSellWarningEvents,
  runCryptoBacktestForSymbol,
} from "@/lib/crypto-buy/service.mts";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { CRYPTO_BACKTEST_MAX_DAYS, parseBoundedDateRange } from "@/lib/security/request-bounds";
import type {
  CostScenario,
  CryptoExecutionMode,
  CryptoParentTimeframe,
  SignalSide,
} from "@/lib/crypto-buy/types.mts";

export const dynamic = "force-dynamic";

const coerceMode = (value: string | null): CryptoExecutionMode =>
  value === "B" ? "B" : "A";

const coerceCostScenario = (value: string | null): CostScenario =>
  value === "zero" || value === "conservative" ? value : "normal";

const coerceTimeframe = (value: string | null): CryptoParentTimeframe =>
  value === "4h" ? "4h" : "1d";

const coerceSide = (value: string | null): SignalSide =>
  value === "sell" ? "sell" : "buy";

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol?: string }> },
) {
  const { symbol: rawSymbol = "" } = await context.params;
  const symbol = decodeURIComponent(rawSymbol);
  const url = new URL(request.url);
  const mode = coerceMode(url.searchParams.get("mode"));
  const cost = coerceCostScenario(url.searchParams.get("cost"));
  const timeframe = coerceTimeframe(url.searchParams.get("tf"));
  const side = coerceSide(url.searchParams.get("side"));
  const rateLimitResponse = checkRateLimit(request, "crypto-backtest", {
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  const range = parseBoundedDateRange({
    startRaw: url.searchParams.get("start"),
    endRaw: url.searchParams.get("end"),
    fallbackDays: 30,
    maxDays: CRYPTO_BACKTEST_MAX_DAYS,
  });
  if (!range.ok) {
    return range.response;
  }
  const { startMs, endMs } = range;

  if (!symbol.trim()) {
    return NextResponse.json({ error: "Crypto symbol is required." }, { status: 400 });
  }

  try {
    const dataset = await runCryptoBacktestForSymbol({
      symbol,
      side,
      timeframe,
      startTimeMs: startMs,
      endTimeMs: endMs,
      mode,
      costScenario: cost,
    });
    const sellWarningEvents = buildSellWarningEvents(dataset.features);
    const warningSummary = {
      totalEvents: sellWarningEvents.length,
      level1: sellWarningEvents.filter((event) => event.level === 1).length,
      level2: sellWarningEvents.filter((event) => event.level === 2).length,
      level3: sellWarningEvents.filter((event) => event.level === 3).length,
    };

    const response = {
      symbol: dataset.symbol,
      side,
      timeframe,
      mode,
      costScenario: cost,
      range: {
        start: new Date(startMs).toISOString().slice(0, 10),
        end: new Date(endMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      candles: dataset.bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })),
      signals: dataset.signalsByMode[mode].map((signal) => ({
        time: dataset.bars[signal.signalIndex]?.time ?? signal.entryTime,
        eventTime: signal.signalTime,
        entryTime: dataset.bars[signal.entryIndex]?.time ?? signal.entryTime,
        side: signal.side,
        direction: signal.direction,
        mode: signal.mode,
        signalFamily: signal.signalFamily,
        signalLane: signal.signalLane,
        score: signal.score,
        stopLevel: signal.stopLevel,
        reasons: signal.reasons,
      })),
      sellWarningEvents,
      warningSummary,
      trades: dataset.result.trades.map((trade) => ({
        ...trade,
        signalTime: dataset.bars[trade.signalIndex]?.time ?? trade.signalTime,
        entryTime: dataset.bars[trade.entryIndex]?.time ?? trade.entryTime,
        exitTime: dataset.bars[trade.exitIndex]?.time ?? trade.exitTime,
      })),
      summary: dataset.result.summary,
      skippedSignals: dataset.result.skippedSignals,
      latestFeature: dataset.features.length
        ? {
            time: dataset.features[dataset.features.length - 1].bar.time,
            side: dataset.features[dataset.features.length - 1].side,
            score: dataset.features[dataset.features.length - 1].score,
            htfPassed: dataset.features[dataset.features.length - 1].htfPassed,
            setupActive: dataset.features[dataset.features.length - 1].setupActive,
            signalFamily: dataset.features[dataset.features.length - 1].signalFamily,
            signalLane: dataset.features[dataset.features.length - 1].signalLane,
            recentOverboughtWithin2:
              dataset.features[dataset.features.length - 1].recentOverboughtWithin2 ?? false,
            recentBreakoutSeenWithin2:
              dataset.features[dataset.features.length - 1].recentBreakoutSeenWithin2 ?? false,
            recentReturn5HighWithin2:
              dataset.features[dataset.features.length - 1].recentReturn5HighWithin2 ?? false,
            previousBreakoutHold:
              dataset.features[dataset.features.length - 1].previousBreakoutHold ?? false,
            sellWarningLevel:
              dataset.features[dataset.features.length - 1].sellWarningLevel,
            sellWarningReasons:
              dataset.features[dataset.features.length - 1].sellWarningReasons,
            primaryLowerTf: dataset.features[dataset.features.length - 1].primaryLowerTf,
            secondaryLowerTf: dataset.features[dataset.features.length - 1].secondaryLowerTf,
          }
        : null,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown backtest error.",
      },
      { status: 500 },
    );
  }
}
