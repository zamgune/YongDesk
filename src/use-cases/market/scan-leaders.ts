import { SMA } from "technicalindicators";
import { getMarketDataProvider } from "@/lib/market-data";
import {
  confirmedDailyCandles,
  type ConfirmedDailyCandle,
} from "@/lib/market/confirmed-daily-candles";
import {
  getLeaderUniverse,
  type LeaderMarket,
  type LeaderSymbol,
} from "@/lib/market/leader-universes";
import { calculateBreakoutRule } from "@/lib/market/breakout-rule";
import { calculatePatternSignals } from "@/lib/market/pattern-signals";
import { calculateSignalReliability, type SignalReliability } from "@/lib/market/signal-reliability";
import { calculateTrendFollowingSignals, type TrendFollowingCandle } from "@/lib/market/trend-following";
import { buildTradeSetup } from "@/lib/market/trade-setup";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { LEADER_SCAN_MAX_DAYS, mapWithBoundedConcurrency, parseBoundedDays } from "@/lib/security/request-bounds";
import type { UserContext } from "@/domain/user";
import type { CandidateSourceDetail } from "@/lib/market/market-briefing-report";

type LeaderCandle = TrendFollowingCandle & ConfirmedDailyCandle;

type CandleState = {
  candles: LeaderCandle[];
  sma5: Array<number | null>;
  sma20: Array<number | null>;
  sma50: Array<number | null>;
  volumeMa20: Array<number | null>;
};

type StrategyProfile = {
  name: string;
  leaderCount: number;
  marketBreadthMin: number;
  marketAverageReturn50Min: number;
  minLeaderReturn50: number;
  maxStopPct: number;
};

type CandidateDecision = "enter" | "hold" | "watch" | "avoid";

const marketData = getMarketDataProvider();

const DEFAULT_DAYS = 430;
const MAX_CUSTOM_SYMBOLS = 60;

const strategyByMarket: Record<string, StrategyProfile> = {
  US: {
    name: "leader-risk-managed",
    leaderCount: 4,
    marketBreadthMin: 0.45,
    marketAverageReturn50Min: 0,
    minLeaderReturn50: Number.NEGATIVE_INFINITY,
    maxStopPct: 0.08,
  },
  KOSPI: {
    name: "leader-momentum-defensive",
    leaderCount: 4,
    marketBreadthMin: 0.55,
    marketAverageReturn50Min: 0.03,
    minLeaderReturn50: 0.1,
    maxStopPct: 0.08,
  },
  KOSDAQ: {
    name: "leader-momentum-defensive",
    leaderCount: 4,
    marketBreadthMin: 0.55,
    marketAverageReturn50Min: 0.03,
    minLeaderReturn50: 0.1,
    maxStopPct: 0.08,
  },
};

const alignValues = <T>(length: number, values: T[]) => {
  const offset = Math.max(length - values.length, 0);
  return Array.from({ length }, (_, index) =>
    index < offset ? null : values[index - offset],
  );
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeCustomSymbol = (symbol: string, market: LeaderMarket) => {
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  if (market === "US") {
    return trimmed.replace(/\.(KS|KQ)$/i, "");
  }
  if (/\.(KS|KQ)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.${market === "KOSPI" ? "KS" : "KQ"}`;
};

const parseCustomSymbols = ({
  rawSymbols,
  market,
  defaultSymbols,
}: {
  rawSymbols: string | null;
  market: LeaderMarket;
  defaultSymbols: LeaderSymbol[];
}) => {
  if (!rawSymbols) {
    return defaultSymbols;
  }

  const defaultBySymbol = new Map(
    defaultSymbols.map((item) => [item.symbol, item] as const),
  );
  const seenSymbols = new Set<string>();

  return rawSymbols
    .split(",")
    .map((symbol) => normalizeCustomSymbol(symbol, market))
    .filter((symbol) => {
      if (!symbol || seenSymbols.has(symbol)) {
        return false;
      }
      seenSymbols.add(symbol);
      return true;
    })
    .slice(0, MAX_CUSTOM_SYMBOLS)
    .map((symbol) => ({
      symbol,
      name: defaultBySymbol.get(symbol)?.name ?? symbol,
      sector: defaultBySymbol.get(symbol)?.sector ?? "기타",
      themes: defaultBySymbol.get(symbol)?.themes ?? ["사용자 추가"],
    }));
};

const closeLocation = (candle: TrendFollowingCandle) => {
  const range = candle.high - candle.low;
  return range > 0 ? (candle.close - candle.low) / range : 0.5;
};

const fetchCandles = async (
  symbol: string,
  days: number,
  market: LeaderMarket,
  now: Date,
) => {
  const end = now;
  const start = new Date(end);
  start.setDate(end.getDate() - days);

  const result = await marketData.getCandles(symbol, {
    period1: start,
    period2: end,
    interval: "1d",
  });

  return confirmedDailyCandles(result.candles, market, now);
};

const buildState = (candles: LeaderCandle[]): CandleState => {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const sma5 = SMA.calculate({ period: 5, values: closes });
  const sma20 = SMA.calculate({ period: 20, values: closes });
  const sma50 = SMA.calculate({ period: 50, values: closes });
  const volumeMa20 = SMA.calculate({ period: 20, values: volumes });

  return {
    candles,
    sma5: alignValues(candles.length, sma5),
    sma20: alignValues(candles.length, sma20),
    sma50: alignValues(candles.length, sma50),
    volumeMa20: alignValues(candles.length, volumeMa20),
  };
};

const getReturn = (state: CandleState, lookback: number) => {
  const latest = state.candles[state.candles.length - 1];
  const base = state.candles[state.candles.length - lookback - 1];
  return latest && base && base.close > 0 ? latest.close / base.close - 1 : null;
};

const getReturn50 = (state: CandleState) => getReturn(state, 50);

const clamp = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));

const getLatestNumber = (series: Array<number | null>) => {
  const value = series[series.length - 1];
  return isNumber(value) ? value : null;
};

const getLatestEntryDecision = ({
  state,
  strategy,
}: {
  state: CandleState;
  strategy: StrategyProfile;
}) => {
  const index = state.candles.length - 1;
  const candle = state.candles[index];
  const sma5Value = state.sma5[index];
  const sma20Value = state.sma20[index];
  const sma50Value = state.sma50[index];
  const previousSma5 = state.sma5[index - 1];
  const previousSma20 = state.sma20[index - 1];
  const volumeMa20 = state.volumeMa20[index];
  const sma20SlopeBase = state.sma20[index - 3];
  const sma50SlopeBase = state.sma50[index - 5];

  if (
    !candle ||
    !isNumber(sma5Value) ||
    !isNumber(sma20Value) ||
    !isNumber(sma50Value) ||
    !isNumber(previousSma5) ||
    !isNumber(previousSma20) ||
    !isNumber(volumeMa20) ||
    !isNumber(sma20SlopeBase) ||
    !isNumber(sma50SlopeBase)
  ) {
    return {
      entryToday: false,
      trendStack: false,
      reason: "Insufficient trend history.",
      stopPrice: null,
      stopPct: null,
      twoR: null,
    };
  }

  const recentHigh = Math.max(...state.candles.slice(Math.max(0, index - 20), index).map((bar) => bar.high));
  const recentLow = Math.min(...state.candles.slice(Math.max(0, index - 4), index + 1).map((bar) => bar.low));
  const volumeRatio = candle.volume / volumeMa20;
  const sma20SlopePct = sma20Value / sma20SlopeBase - 1;
  const sma50SlopePct = sma50Value / sma50SlopeBase - 1;
  const trendStack =
    candle.close > sma20Value && sma20Value > sma50Value && sma50SlopePct >= 0;
  const sma5AboveSma20 = sma5Value > sma20Value;
  const sma5CrossUp = previousSma5 <= previousSma20 && sma5AboveSma20;
  const continuation =
    trendStack &&
    sma20SlopePct >= 0.001 &&
    volumeRatio >= 1.2 &&
    closeLocation(candle) >= 0.6 &&
    (sma5CrossUp || sma5AboveSma20);
  const breakout =
    trendStack &&
    sma20SlopePct >= 0.001 &&
    candle.close > recentHigh &&
    volumeRatio >= 1.35;
  const structureStop = Math.min(candle.low, recentLow);
  const riskCappedStop = candle.close * (1 - strategy.maxStopPct);
  const stopPrice = Math.max(structureStop, riskCappedStop);
  const riskPerShare = Math.max(candle.close - stopPrice, candle.close * 0.005);
  const missing = [
    !trendStack ? "SMA20/SMA50 trend stack failed" : null,
    sma20SlopePct < 0.001 ? "SMA20 slope is weak" : null,
    volumeRatio < 1.2 && !breakout ? "Volume confirmation is weak" : null,
    closeLocation(candle) < 0.6 && !breakout ? "Close strength is weak" : null,
  ].filter((item): item is string => item !== null);

  return {
    entryToday: continuation || breakout,
    trendStack,
    reason: continuation
      ? "Continuation entry conditions passed."
      : breakout
        ? "20-day breakout entry conditions passed."
        : missing.join(". ") || "Waiting for entry trigger.",
    stopPrice,
    stopPct: stopPrice / candle.close - 1,
    twoR: candle.close + riskPerShare * 2,
    volumeRatio,
    sma20SlopePct,
    sma50SlopePct,
  };
};

const getLeadershipScore = ({
  return5,
  return50,
  breakoutRule,
  breakoutSignal,
  chartQuality,
  signalReliability,
  stopPct,
  volumeRatio,
}: {
  return5: number | null;
  return50: number;
  breakoutRule: ReturnType<typeof calculateBreakoutRule>;
  breakoutSignal?: ReturnType<typeof calculatePatternSignals>["breakoutSignal"];
  chartQuality?: ReturnType<typeof calculatePatternSignals>["chartQuality"];
  signalReliability?: SignalReliability;
  stopPct: number | null;
  volumeRatio: number | null;
}) => {
  const reasons: string[] = [];
  let score = 50;

  score += clamp(-20, 35, return50 * 40);
  if (return50 >= 0.5) {
    reasons.push("50일 상대강도 상위");
  }

  score += clamp(-10, 20, (return5 ?? 0) * 35);
  if ((return5 ?? 0) >= 0.12) {
    reasons.push("5일 탄력 강함");
  }

  if (breakoutSignal?.status === "confirmed") {
    score += 28;
    reasons.push("돌파 확인");
  } else if (breakoutSignal?.status === "retest") {
    score += 22;
    reasons.push("돌파 지지 재확인");
  } else if (breakoutSignal?.status === "triggered") {
    score += 15;
    reasons.push("돌파 시도");
  } else if (breakoutSignal?.status === "extended") {
    score += 4;
    reasons.push("추세 진행중");
  } else if (breakoutSignal?.status === "failed") {
    score -= 25;
    reasons.push("돌파 실패");
  }

  if (breakoutRule.status === "breakout-ready") {
    score += 10;
    reasons.push("신고가 기준선 근접");
  } else if (breakoutRule.status === "profit-tracking") {
    score += 6;
    reasons.push("20일선 수익 추적");
  } else if (breakoutRule.status === "risk-off") {
    score -= 18;
    reasons.push("20일선 이탈 주의");
  }

  if (typeof volumeRatio === "number" && Number.isFinite(volumeRatio)) {
    if (volumeRatio >= 2) {
      score += 15;
      reasons.push(`거래량 ${volumeRatio.toFixed(1)}배`);
    } else if (volumeRatio >= 1.5) {
      score += 10;
      reasons.push(`거래량 ${volumeRatio.toFixed(1)}배`);
    } else if (volumeRatio >= 1.2) {
      score += 5;
      reasons.push(`거래량 ${volumeRatio.toFixed(1)}배`);
    }
  }

  if (chartQuality) {
    score += chartQuality.score * 0.25;
    if (chartQuality.score >= 80) {
      reasons.push(`차트품질 ${chartQuality.score}`);
    }
  }

  if (signalReliability) {
    if (signalReliability.grade === "high") {
      score += 16;
      reasons.push(`신뢰도 ${signalReliability.score}`);
    } else if (signalReliability.grade === "medium") {
      score += 8;
      reasons.push(`신뢰도 ${signalReliability.score}`);
    } else if (signalReliability.grade === "low") {
      score -= 8;
      reasons.push("신뢰도 낮음");
    }
  }

  const riskPct = typeof stopPct === "number" && Number.isFinite(stopPct) ? Math.abs(stopPct) : null;
  if (riskPct !== null) {
    if (riskPct > 0.12) {
      score -= 12;
      reasons.push("손절폭 과다");
    } else if (riskPct <= 0.08) {
      score += 4;
      reasons.push("손절폭 관리 가능");
    }
  }

  return {
    leadershipScore: Math.round(score),
    leadershipReasons: reasons.slice(0, 5),
  };
};

export async function scanLeaders(
  request: Request,
  options?: { userContext?: UserContext },
) {
  void options;
  const rateLimitResponse = checkRateLimit(request, "market-leaders", {
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const url = new URL(request.url);
  const universe = getLeaderUniverse(url.searchParams.get("market") ?? "US");
  const { market } = universe;
  const rawSymbols = url.searchParams.get("symbols");
  const symbols = parseCustomSymbols({
    rawSymbols,
    market,
    defaultSymbols: universe.symbols,
  });
  const strategy = {
    ...strategyByMarket[market],
    leaderCount: Number(url.searchParams.get("top") ?? strategyByMarket[market].leaderCount),
  };
  const daysResult = parseBoundedDays(url.searchParams.get("days"), {
    fallback: DEFAULT_DAYS,
    max: LEADER_SCAN_MAX_DAYS,
  });
  if (!daysResult.ok) {
    return daysResult.response;
  }
  const days = daysResult.value;
  const requestAt = new Date();

  if (!symbols.length) {
    return Response.json({ error: "No symbols to scan." }, { status: 400 });
  }

  const results = await mapWithBoundedConcurrency(
    symbols,
    async (item) => {
      try {
        const candles = await fetchCandles(item.symbol, days, market, requestAt);
        return {
          ...item,
          state: buildState(candles),
        };
      } catch (error) {
        return {
          ...item,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    6,
  );
  const generatedAt = new Date();
  const loaded = results.filter((item): item is typeof item & { state: CandleState } => "state" in item);
  const ranked = loaded
    .map((item) => ({
      ...item,
      return50: getReturn50(item.state),
      breakoutRule: calculateBreakoutRule({
        candles: item.state.candles,
        sma20: item.state.sma20,
      }),
    }))
    .filter((item): item is typeof item & { return50: number } => isNumber(item.return50))
    .toSorted((a, b) => {
      const breakoutScore = (item: typeof a) =>
        item.return50 +
        (item.breakoutRule.status === "profit-tracking"
          ? 0.08
          : item.breakoutRule.status === "breakout-ready"
            ? 0.06
            : item.breakoutRule.status === "wait-pullback"
              ? 0.02
              : 0);
      return breakoutScore(b) - breakoutScore(a);
    });
  const latestCandleTimes = loaded.flatMap((item) => {
    const value = item.state.candles.at(-1)?.closeTime;
    return isNumber(value) ? [value] : [];
  });
  const latestCandleAt = latestCandleTimes.length
    ? new Date(Math.max(...latestCandleTimes) * 1_000).toISOString()
    : null;
  const oldestLatestCandleAt = latestCandleTimes.length
    ? new Date(Math.min(...latestCandleTimes) * 1_000).toISOString()
    : null;
  const maxDataAgeSeconds = oldestLatestCandleAt
    ? Math.max(0, Math.floor((generatedAt.getTime() - Date.parse(oldestLatestCandleAt)) / 1_000))
    : null;
  const breadth =
    ranked.filter((item) => {
      const index = item.state.candles.length - 1;
      const latest = item.state.candles[index];
      const sma50 = item.state.sma50[index];
      return isNumber(sma50) && latest.close > sma50;
    }).length / Math.max(ranked.length, 1);
  const averageReturn50 =
    ranked.reduce((sum, item) => sum + item.return50, 0) / Math.max(ranked.length, 1);
  const marketPass =
    breadth >= strategy.marketBreadthMin &&
    averageReturn50 >= strategy.marketAverageReturn50Min;

  const preparedCandidates = ranked.map((item) => {
    const latest = item.state.candles[item.state.candles.length - 1];
    const return5 = getReturn(item.state, 5);
    const sma5 = getLatestNumber(item.state.sma5);
    const sma20 = getLatestNumber(item.state.sma20);
    const aggressiveEntryLow = sma5 ? sma5 * 0.99 : null;
    const aggressiveEntryHigh = sma5 ? sma5 * 1.015 : null;
    const conservativeEntryLow = sma20 ? sma20 * 0.985 : null;
    const conservativeEntryHigh = sma20 ? sma20 * 1.02 : null;
    const entryReference = [aggressiveEntryLow, conservativeEntryLow, latest.close]
      .filter(isNumber)
      .toSorted((a, b) => a - b)[0];
    const trendFollowing = calculateTrendFollowingSignals({
      candles: item.state.candles,
      sma5: item.state.sma5,
      sma20: item.state.sma20,
      sma50: item.state.sma50,
      volumeMa20: item.state.volumeMa20,
    });
    const entryDecision = getLatestEntryDecision({ state: item.state, strategy });
    const entryStopCandidates = [
      entryDecision.stopPrice,
      sma20 ? sma20 * 0.985 : null,
      entryReference ? entryReference * 0.985 : null,
    ].filter(isNumber);
    const newEntryStop = entryStopCandidates.length
      ? Math.min(...entryStopCandidates)
      : null;
    const activeTrend = Boolean(trendFollowing.activeSetup);
    const candidateSourceDetail =
      "candidateSourceDetail" in item
        ? item.candidateSourceDetail as CandidateSourceDetail
        : undefined;
    const candidateBase = {
      symbol: item.symbol,
      name: item.name,
      sector: item.sector ?? "기타",
      themes: item.themes?.length ? item.themes : [item.sector ?? "기타"],
      rank: 0,
      price: latest.close,
      dataProvenance: "market-data.confirmed-daily-candles" as const,
      latestCandleAt: new Date(latest.closeTime * 1_000).toISOString(),
      dataAgeSeconds: Math.max(
        0,
        Math.floor((generatedAt.getTime() - latest.closeTime * 1_000) / 1_000),
      ),
      return5,
      return50: item.return50,
      breakoutRule: item.breakoutRule,
      decision: "avoid" as CandidateDecision,
      actionable: false,
      activeTrend,
      reason: entryDecision.reason,
      candidateSourceDetail,
      risk: {
        entryPrice: latest.close,
        stopPrice: entryDecision.stopPrice,
        stopPct: entryDecision.stopPct,
        twoR: entryDecision.twoR,
        trendExitLevel: trendFollowing.activeSetup?.trendExitLevel ?? item.state.sma50[item.state.sma50.length - 1],
      },
      levels: {
        sma5,
        sma20,
        aggressiveEntryLow,
        aggressiveEntryHigh,
        conservativeEntryLow,
        conservativeEntryHigh,
        newEntryStop,
        breakoutPrice: Math.max(...item.state.candles.slice(-20).map((bar) => bar.high)),
      },
      features: {
        volumeRatio: entryDecision.volumeRatio ?? null,
        sma20SlopePct: entryDecision.sma20SlopePct ?? null,
        sma50SlopePct: entryDecision.sma50SlopePct ?? null,
      },
    };
    const tradeSetup = buildTradeSetup(candidateBase);
    const patternAnalysis = calculatePatternSignals({
      candles: item.state.candles,
      sma5: item.state.sma5,
      sma20: item.state.sma20,
      sma50: item.state.sma50,
      volumeMa20: item.state.volumeMa20,
      breakoutRule: item.breakoutRule,
      tradeSetup,
      return5,
    });
    const adjustedEntryDecision = patternAnalysis.breakoutSignal.status === "extended"
      ? {
          ...entryDecision,
          entryToday: false,
          reason: "Extended after breakout; wait for pullback.",
        }
      : entryDecision;
    const signalReliability = calculateSignalReliability({
      candles: item.state.candles,
      sma5: item.state.sma5,
      sma20: item.state.sma20,
      sma50: item.state.sma50,
      volumeMa20: item.state.volumeMa20,
      patternSignals: patternAnalysis.patternSignals,
      breakoutSignal: patternAnalysis.breakoutSignal,
    });
    const leadership = getLeadershipScore({
      return5,
      return50: item.return50,
      breakoutRule: item.breakoutRule,
      breakoutSignal: patternAnalysis.breakoutSignal,
      chartQuality: patternAnalysis.chartQuality,
      signalReliability,
      stopPct: adjustedEntryDecision.stopPct,
      volumeRatio: adjustedEntryDecision.volumeRatio ?? null,
    });

    return {
      ...candidateBase,
      entryDecision: adjustedEntryDecision,
      reason: adjustedEntryDecision.reason,
      risk: {
        ...candidateBase.risk,
        stopPrice: adjustedEntryDecision.stopPrice,
        stopPct: adjustedEntryDecision.stopPct,
        twoR: adjustedEntryDecision.twoR,
      },
      features: {
        volumeRatio: adjustedEntryDecision.volumeRatio ?? null,
        sma20SlopePct: adjustedEntryDecision.sma20SlopePct ?? null,
        sma50SlopePct: adjustedEntryDecision.sma50SlopePct ?? null,
      },
      trendFollowing,
      tradeSetup,
      ...patternAnalysis,
      signalReliability,
      ...leadership,
      state: item.state,
    };
  });
  const candidates = preparedCandidates
    .toSorted((left, right) =>
      right.leadershipScore - left.leadershipScore ||
      right.return50 - left.return50,
    )
    .map((item, index) => {
      const rank = index + 1;
      const rankPass = rank <= strategy.leaderCount;
      const momentumPass = item.return50 >= strategy.minLeaderReturn50;
      const actionable = marketPass && rankPass && momentumPass && item.entryDecision.entryToday;
      const decision: CandidateDecision = actionable
        ? "enter"
        : marketPass && rankPass && momentumPass && item.activeTrend
          ? "hold"
          : marketPass && rankPass && momentumPass && item.entryDecision.trendStack
            ? "watch"
            : "avoid";
      const candidate = {
        ...item,
        rank,
        decision,
        actionable,
        reason:
          !marketPass
            ? "Market breadth filter failed."
            : !rankPass
              ? `Outside top ${strategy.leaderCount} leaders.`
              : !momentumPass
                ? "Leader absolute momentum is too weak."
                : actionable
                  ? item.entryDecision.reason
                  : item.activeTrend
                    ? "Trend setup is already active; use the chart before chasing a late entry."
                    : item.entryDecision.reason,
      };
      const tradeSetup = buildTradeSetup(candidate);
      const patternAnalysis = calculatePatternSignals({
        candles: item.state.candles,
        sma5: item.state.sma5,
        sma20: item.state.sma20,
        sma50: item.state.sma50,
        volumeMa20: item.state.volumeMa20,
        breakoutRule: item.breakoutRule,
        tradeSetup,
        return5: item.return5,
      });
      const signalReliability = calculateSignalReliability({
        candles: item.state.candles,
        sma5: item.state.sma5,
        sma20: item.state.sma20,
        sma50: item.state.sma50,
        volumeMa20: item.state.volumeMa20,
        patternSignals: patternAnalysis.patternSignals,
        breakoutSignal: patternAnalysis.breakoutSignal,
      });
      const { state, entryDecision, trendFollowing, ...publicCandidate } = candidate;
      void state;
      void entryDecision;
      void trendFollowing;

      return {
        ...publicCandidate,
        tradeSetup,
        ...patternAnalysis,
        signalReliability,
      };
    });

  return Response.json({
    market,
    strategy,
    generatedAt: generatedAt.toISOString(),
    marketHealth: {
      breadth,
      averageReturn50,
      pass: marketPass,
      loadedSymbols: loaded.length,
      totalSymbols: symbols.length,
      timestampedSymbols: latestCandleTimes.length,
      coverageType: rawSymbols ? "custom-symbol-list" : "curated-leader-universe",
      source: rawSymbols ? "request.custom-symbols" : "leader-universes.static-curated",
      latestCandleAt,
      oldestLatestCandleAt,
      maxDataAgeSeconds,
    },
    candidates,
    errors: results
      .filter((item) => "error" in item)
      .map((item) => ({
        symbol: item.symbol,
        name: item.name,
        error: "error" in item ? item.error : "",
      })),
  });
}
