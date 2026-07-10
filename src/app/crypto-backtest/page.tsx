"use client";

import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./page.module.css";

type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BacktestSignal = {
  time: UTCTimestamp;
  eventTime: UTCTimestamp;
  entryTime: UTCTimestamp;
  side: "buy" | "sell";
  direction: "long" | "short";
  mode: "A" | "B";
  signalFamily:
    | "flush"
    | "rebound"
    | "capitulation"
    | "rejection"
    | "upthrust"
    | "blowoff"
    | null;
  signalLane: string | null;
  score: number;
  stopLevel: number;
  reasons: string[];
};

type BacktestTrade = {
  side: "buy" | "sell";
  direction: "long" | "short";
  entryTime: UTCTimestamp;
  exitTime: UTCTimestamp;
  score: number;
  entryPrice: number;
  stopPrice: number;
  exitReason: string;
  netPnl: number;
  rMultiple: number;
  holdBars: number;
  tp1Hit: boolean;
  reasons: string[];
};

type LowerTfConfirmation = {
  interval: "30m" | "1h" | "4h" | "1d";
  required: boolean;
  direction: "long" | "short";
  passed: boolean;
  triggeredBreak: boolean;
  lastRecovery: boolean;
  triggerTime: UTCTimestamp | null;
  priorRangeLevel20: number | null;
  lastChildClose: number | null;
  excursionDepth20: number | null;
};

type BacktestResponse = {
  symbol: string;
  side: "buy" | "sell";
  timeframe: "1d" | "4h";
  mode: "A" | "B";
  costScenario: "zero" | "normal" | "conservative";
  range: {
    start: string;
    end: string;
  };
  candles: Candle[];
  sellWarningEvents: Array<{
    time: UTCTimestamp;
    level: 1 | 2 | 3;
    reasons: string[];
  }>;
  signals: BacktestSignal[];
  trades: BacktestTrade[];
  summary: {
    symbol: string;
    side: "buy" | "sell";
    direction: "long" | "short";
    mode: "A" | "B";
    costScenario: "zero" | "normal" | "conservative";
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    endingEquity: number;
    totalReturn: number;
    maxDrawdown: number;
    profitFactor: number | null;
    expectancy: number;
    averageHoldBars: number;
    averageWin: number | null;
    averageLoss: number | null;
    averageRMultiple: number | null;
  };
  warningSummary: {
    totalEvents: number;
    level1: number;
    level2: number;
    level3: number;
  };
  skippedSignals: number;
  latestFeature: {
    time: UTCTimestamp;
    side: "buy" | "sell";
    score: number;
    htfPassed: boolean;
    setupActive: boolean;
    signalFamily:
      | "flush"
      | "rebound"
      | "capitulation"
      | "rejection"
      | "upthrust"
      | "blowoff"
      | null;
    signalLane: string | null;
    recentOverboughtWithin2: boolean;
    recentBreakoutSeenWithin2: boolean;
    recentReturn5HighWithin2: boolean;
    previousBreakoutHold: boolean;
    sellWarningLevel: 0 | 1 | 2 | 3;
    sellWarningReasons: string[];
    primaryLowerTf: LowerTfConfirmation | null;
    secondaryLowerTf: LowerTfConfirmation | null;
  } | null;
};

const chartColors = {
  candleUp: "#1c9d6f",
  candleDown: "#d0454f",
  volume: "rgba(160, 107, 65, 0.28)",
  priceLast: "#1c9d6f",
  signal: "#0f766e",
  signalModeB: "#2b6d77",
  entry: "#f39b6d",
  exitWin: "#1c9d6f",
  exitLoss: "#d0454f",
  sellWarningLevel1: "#d88b92",
  sellWarningLevel2: "#d45b68",
  sellWarningLevel3: "#aa1f32",
};

const formatPct = (value: number | null) =>
  value === null || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(2)}%`;

const formatDateLabel = (unixTime: number, timeframe: "1d" | "4h") =>
  new Date(unixTime * 1000).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeframe === "4h"
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {}),
  });

export default function CryptoBacktestPage() {
  const [symbol, setSymbol] = useState("ETH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [timeframe, setTimeframe] = useState<"1d" | "4h">("1d");
  const [startDate, setStartDate] = useState("2026-01-25");
  const [endDate, setEndDate] = useState("2026-02-10");
  const [mode, setMode] = useState<"A" | "B">("A");
  const [cost, setCost] = useState<"zero" | "normal" | "conservative">("normal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BacktestResponse | null>(null);

  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const volumeContainerRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markerSeriesRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const loadBacktest = async () => {
    setLoading(true);
    setError(null);

    try {
      const encoded = encodeURIComponent(symbol.trim().toUpperCase());
      const query = new URLSearchParams({
        side,
        tf: timeframe,
        start: startDate,
        end: endDate,
        mode,
        cost,
      });
      const response = await fetch(`/api/crypto-backtest/${encoded}?${query.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load crypto backtest.");
      }
      const payload = (await response.json()) as BacktestResponse;
      setData(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, timeframe]);

  useEffect(() => {
    if (!priceContainerRef.current || !volumeContainerRef.current) {
      return;
    }

    const commonLayout = {
      layout: {
        textColor: "#3a302a",
        background: { color: "#fffaf4" },
      },
      grid: {
        vertLines: { color: "rgba(20, 17, 15, 0.05)" },
        horzLines: { color: "rgba(20, 17, 15, 0.05)" },
      },
      rightPriceScale: {
        borderColor: "rgba(20, 17, 15, 0.12)",
      },
      timeScale: {
        borderColor: "rgba(20, 17, 15, 0.12)",
        timeVisible: false,
      },
    } as const;

    const priceChart = createChart(priceContainerRef.current, {
      ...commonLayout,
      height: 430,
    });
    const volumeChart = createChart(volumeContainerRef.current, {
      ...commonLayout,
      height: 170,
    });

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: chartColors.candleUp,
      downColor: chartColors.candleDown,
      borderVisible: false,
      wickUpColor: chartColors.candleUp,
      wickDownColor: chartColors.candleDown,
    });
    const volumeSeries = volumeChart.addSeries(HistogramSeries, {
      color: chartColors.volume,
      priceFormat: {
        type: "volume",
      },
    });

    const markerSeries = createSeriesMarkers(candleSeries, []);

    priceChartRef.current = priceChart;
    volumeChartRef.current = volumeChart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    markerSeriesRef.current = markerSeries;

    const syncVisibleRange = () => {
      const range = priceChart.timeScale().getVisibleRange();
      if (range) {
        try {
          volumeChart.timeScale().setVisibleRange(range);
        } catch {
          /* ignore */
        }
      }
    };

    priceChart.timeScale().subscribeVisibleTimeRangeChange(syncVisibleRange);

    const resize = () => {
      const width = priceContainerRef.current?.clientWidth ?? 0;
      if (width > 0) {
        priceChart.applyOptions({ width });
        volumeChart.applyOptions({ width });
      }
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    return () => {
      window.removeEventListener("resize", resize);
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(syncVisibleRange);
      markerSeriesRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceChartRef.current = null;
      volumeChartRef.current = null;
      priceChart.remove();
      volumeChart.remove();
    };
  }, []);

  useEffect(() => {
    if (!data || !candleSeriesRef.current || !volumeSeriesRef.current || !markerSeriesRef.current) {
      return;
    }

    priceChartRef.current?.applyOptions({
      timeScale: {
        timeVisible: data.timeframe === "4h",
      },
    });
    volumeChartRef.current?.applyOptions({
      timeScale: {
        timeVisible: data.timeframe === "4h",
      },
    });

    candleSeriesRef.current.setData(data.candles);
    volumeSeriesRef.current.setData(
      data.candles.map((candle) => ({
        time: candle.time,
        value: candle.volume,
        color:
          candle.close >= candle.open
            ? "rgba(28, 157, 111, 0.45)"
            : "rgba(208, 69, 79, 0.38)",
      })),
    );

    const candleByTime = new Map(data.candles.map((candle) => [candle.time, candle]));
    const markers: SeriesMarker<Time>[] = [];

    for (const signal of data.signals) {
      const candle = candleByTime.get(signal.time);
      if (!candle) {
        continue;
      }
      markers.push({
        time: signal.time,
        position: signal.side === "buy" ? "aboveBar" : "belowBar",
        shape: "circle",
        color: signal.mode === "A" ? chartColors.signal : chartColors.signalModeB,
        text: signal.side === "buy" ? "P" : "S",
        size: 1.8,
      });
      const entryCandle = candleByTime.get(signal.entryTime);
      if (entryCandle) {
        markers.push({
          time: signal.entryTime,
          position: signal.side === "buy" ? "belowBar" : "aboveBar",
          shape: signal.side === "buy" ? "arrowUp" : "arrowDown",
          color: chartColors.entry,
          text: "E",
          size: 1.4,
        });
      }
    }

    for (const trade of data.trades) {
      const exitCandle = candleByTime.get(trade.exitTime);
      if (!exitCandle) {
        continue;
      }
      markers.push({
        time: trade.exitTime,
        position: trade.netPnl >= 0 ? "aboveBar" : "belowBar",
        shape: trade.netPnl >= 0 ? "circle" : "square",
        color: trade.netPnl >= 0 ? chartColors.exitWin : chartColors.exitLoss,
        text: trade.netPnl >= 0 ? "X+" : "X-",
        size: 1.2,
      });
    }

    for (const warning of data.sellWarningEvents) {
      const candle = candleByTime.get(warning.time);
      if (!candle) {
        continue;
      }
      markers.push({
        time: warning.time,
        position: "aboveBar",
        shape: "arrowDown",
        color:
          warning.level === 1
            ? chartColors.sellWarningLevel1
            : warning.level === 2
              ? chartColors.sellWarningLevel2
              : chartColors.sellWarningLevel3,
        text: warning.level === 3 ? "▼" : "",
        size: warning.level === 1 ? 0.8 : warning.level === 2 ? 1 : 1.2,
      });
    }

    markerSeriesRef.current.setMarkers(markers);

    const lastCandle = data.candles[data.candles.length - 1];
    const recentWindow = data.candles.slice(-60);
    if (lastCandle && recentWindow.length) {
      candleSeriesRef.current.priceLines().forEach((line) => {
        candleSeriesRef.current?.removePriceLine(line);
      });
      candleSeriesRef.current.createPriceLine({
        price: lastCandle.close,
        color: chartColors.priceLast,
        lineWidth: 2,
        axisLabelVisible: false,
      });
      candleSeriesRef.current.createPriceLine({
        price: Math.max(...recentWindow.map((item) => item.high)),
        color: "#a06b41",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
      candleSeriesRef.current.createPriceLine({
        price: Math.min(...recentWindow.map((item) => item.low)),
        color: "#6a5c53",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
    }

    priceChartRef.current?.timeScale().fitContent();
    volumeChartRef.current?.timeScale().fitContent();
  }, [data]);

  const sortedTrades = useMemo(() => {
    if (!data) {
      return [];
    }
    return [...data.trades].sort((left, right) => right.entryTime - left.entryTime);
  }, [data]);
  const recentWarningEvents = useMemo(() => {
    if (!data) {
      return [];
    }
    return [...data.sellWarningEvents].sort((left, right) => right.time - left.time).slice(0, 8);
  }, [data]);

  const signalCount = data?.signals.length ?? 0;
  const activeTimeframe = data?.timeframe ?? timeframe;
  const applySampleRange = () => {
    if (timeframe === "4h") {
      setSymbol("ETH");
      setSide(side);
      setStartDate(side === "buy" ? "2026-02-04" : "2025-10-05");
      setEndDate(side === "buy" ? "2026-02-08" : "2025-10-08");
      setMode("A");
      setCost("normal");
      return;
    }

    setSymbol("ETH");
    setSide(side);
    setStartDate(side === "buy" ? "2026-01-25" : "2025-08-20");
    setEndDate(side === "buy" ? "2026-02-10" : "2025-08-28");
    setMode("A");
    setCost("normal");
  };

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.titleBlock}>
            <p className={styles.kicker}>
              Crypto {side === "buy" ? "Panic-Buy" : "Top Warning"} Backtest
            </p>
            <h1 className={styles.title}>백테스트 신호를 차트에서 확인</h1>
            <p className={styles.subtitle}>
              상위 봉 {side === "buy" ? "panic buy" : "top warning"}에 하위 봉
              {side === "buy" ? " range reclaim" : " range reject"} 확인을 붙여서,
              일봉은 `4h + 1h`, 4시간봉은 `1h + 30m` 구조로 어디서 반응했는지 바로 볼 수 있게 했습니다.
            </p>
          </div>
          <div className={styles.heroActions}>
            <Link href="/" className={styles.secondaryLink}>
              메인 신호 화면
            </Link>
            <Link href="/sentiment" className={styles.secondaryLink}>
              시황 화면
            </Link>
          </div>
        </header>

        <section className={styles.toolbar}>
          <input
            className={styles.input}
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="BTC / ETH / SOL"
          />
          <select
            className={styles.select}
            value={side}
            onChange={(event) => setSide(event.target.value as "buy" | "sell")}
          >
            <option value="buy">Buy Side</option>
            <option value="sell">Sell Side</option>
          </select>
          <select
            className={styles.select}
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value as "1d" | "4h")}
          >
            <option value="1d">1D Parent</option>
            <option value="4h">4H Parent</option>
          </select>
          <input
            className={styles.input}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <input
            className={styles.input}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <select
            className={styles.select}
            value={mode}
            onChange={(event) => setMode(event.target.value as "A" | "B")}
            disabled={side === "sell"}
          >
            <option value="A">Mode A</option>
            <option value="B">Mode B</option>
          </select>
          <select
            className={styles.select}
            value={cost}
            onChange={(event) =>
              setCost(event.target.value as "zero" | "normal" | "conservative")
            }
            disabled={side === "sell"}
          >
            <option value="zero">Zero Cost</option>
            <option value="normal">Normal Cost</option>
            <option value="conservative">Conservative Cost</option>
          </select>
          <button className={styles.button} onClick={loadBacktest} disabled={loading}>
            {loading ? "불러오는 중..." : "백테스트 보기"}
          </button>
          <button
            className={styles.secondaryButton}
            onClick={applySampleRange}
            type="button"
          >
            예시 신호 보기
          </button>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.grid}>
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div>
                <h2>{side === "buy" ? "Signal Overlay" : "Top Warning Markers"}</h2>
                <p>
                  {side === "buy"
                    ? "원형 `P` = parent panic-buy setup"
                    : "봉 위 `▼` = 고점부근 warning"}
                  {side === "buy"
                    ? `, E = 다음 ${activeTimeframe === "4h" ? "4시간봉" : "일봉"} 시가 진입, X+/X- = 최종 청산`
                    : ", 레벨이 올라갈 때만 새 warning이 표시됩니다."}
                </p>
              </div>
              {data ? (
                <div className={styles.chartMeta}>
                  <span>{data.symbol}</span>
                  <span>{data.timeframe.toUpperCase()}</span>
                  <span>{data.range.start} ~ {data.range.end}</span>
                </div>
              ) : null}
            </div>
            <div ref={priceContainerRef} className={styles.chart} />
            <div ref={volumeContainerRef} className={styles.volumeChart} />
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.summaryCard}>
              <h3>Summary</h3>
              {data ? (
                side === "buy" ? (
                  <div className={styles.summaryGrid}>
                    <div>
                      <span className={styles.metricLabel}>Signals</span>
                      <strong>{signalCount}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Trades</span>
                      <strong>{data.summary.trades}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Win Rate</span>
                      <strong>{formatPct(data.summary.winRate)}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Profit Factor</span>
                      <strong>
                        {data.summary.profitFactor === null
                          ? "—"
                          : Number.isFinite(data.summary.profitFactor)
                            ? data.summary.profitFactor.toFixed(2)
                            : "inf"}
                      </strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Total Return</span>
                      <strong>{formatPct(data.summary.totalReturn)}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Max Drawdown</span>
                      <strong>{formatPct(data.summary.maxDrawdown)}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Avg Hold</span>
                      <strong>{data.summary.averageHoldBars.toFixed(1)} bars</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Skipped</span>
                      <strong>{data.skippedSignals}</strong>
                    </div>
                  </div>
                ) : (
                  <div className={styles.summaryGrid}>
                    <div>
                      <span className={styles.metricLabel}>Warnings</span>
                      <strong>{data.warningSummary.totalEvents}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Warning Bars</span>
                      <strong>{data.sellWarningEvents.length ? new Set(data.sellWarningEvents.map((event) => event.time)).size : 0}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Level 1</span>
                      <strong>{data.warningSummary.level1}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Level 2</span>
                      <strong>{data.warningSummary.level2}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Level 3</span>
                      <strong>{data.warningSummary.level3}</strong>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>Latest Level</span>
                      <strong>{data.latestFeature?.sellWarningLevel ?? 0}</strong>
                    </div>
                  </div>
                )
              ) : (
                <p className={styles.placeholder}>데이터를 불러오면 요약이 표시됩니다.</p>
              )}
            </div>

            <div className={styles.summaryCard}>
              <h3>Latest State</h3>
              {data?.latestFeature ? (
                <div className={styles.stateList}>
                  <span>현재 방향: {data.latestFeature.side}</span>
                  <span>최근 점수: {data.latestFeature.score}</span>
                  {side === "buy" ? (
                    <>
                      <span>신호 계열: {data.latestFeature.signalFamily ?? "none"}</span>
                      <span>레인: {data.latestFeature.signalLane ?? "none"}</span>
                    </>
                  ) : null}
                  <span>Sell Warning: {data.latestFeature.sellWarningLevel}</span>
                  <span>
                    최근 컨텍스트:{" "}
                    {[
                      data.latestFeature.recentOverboughtWithin2 ? "overbought" : null,
                      data.latestFeature.recentBreakoutSeenWithin2 ? "breakout" : null,
                      data.latestFeature.previousBreakoutHold ? "prev-hold" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "none"}
                  </span>
                  <span>
                    Warning 이유:{" "}
                    {data.latestFeature.sellWarningReasons.join(", ") || "none"}
                  </span>
                  <span>추세 우위: {data.latestFeature.htfPassed ? "Yes" : "No"}</span>
                  {side === "buy" ? <span>Setup: {data.latestFeature.setupActive ? "Yes" : "No"}</span> : null}
                  <span>
                    주 확인: {data.latestFeature.primaryLowerTf?.interval ?? "—"}{" "}
                    {data.latestFeature.primaryLowerTf?.passed ? "pass" : "fail"}
                  </span>
                  <span>
                    보조 확인: {data.latestFeature.secondaryLowerTf?.interval ?? "—"}{" "}
                    {data.latestFeature.secondaryLowerTf?.passed ? "pass" : "fail"}
                  </span>
                  <span>기준 시각: {formatDateLabel(data.latestFeature.time, activeTimeframe)}</span>
                </div>
              ) : (
                <p className={styles.placeholder}>최근 상태 정보가 없습니다.</p>
              )}
            </div>
          </aside>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <h2>{side === "buy" ? "Executed Trades" : "Recent Warning Events"}</h2>
            <p>
              {side === "buy"
                ? "신호 이유와 실제 손익을 함께 확인할 수 있습니다."
                : "최근 고점부근 경고 이유를 시간순으로 확인할 수 있습니다."}
            </p>
          </div>
          {side === "buy" ? (
            sortedTrades.length ? (
              <div className={styles.tradeList}>
                {sortedTrades.map((trade) => (
                  <article
                    key={`${trade.entryTime}-${trade.exitTime}-${trade.score}`}
                    className={styles.tradeItem}
                  >
                    <div className={styles.tradeTop}>
                      <div>
                        <span className={styles.tradeType}>{trade.exitReason}</span>
                        <strong>{formatDateLabel(trade.entryTime, activeTimeframe)}</strong>
                      </div>
                      <div
                        className={
                          trade.netPnl >= 0 ? styles.tradePnlPositive : styles.tradePnlNegative
                        }
                      >
                        {trade.netPnl.toFixed(2)} / {trade.rMultiple.toFixed(2)}R
                      </div>
                    </div>
                    <div className={styles.tradeMeta}>
                      <span>Entry {trade.entryPrice.toFixed(2)}</span>
                      <span>Stop {trade.stopPrice.toFixed(2)}</span>
                      <span>Hold {trade.holdBars} bars</span>
                      <span>TP1 {trade.tp1Hit ? "hit" : "miss"}</span>
                    </div>
                    <p className={styles.tradeReasons}>{trade.reasons.join(" · ")}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.placeholder}>
                현재 구간에는 실행된 거래가 없습니다. `예시 신호 보기`를 누르거나
                {timeframe === "4h"
                  ? `\`ETH / 2026-02-04 ~ 2026-02-08 / Buy / Mode A\` 로 보면 실제 4시간봉 panic-buy 신호를`
                  : `\`ETH / 2026-01-25 ~ 2026-02-10 / Buy / Mode A\` 로 보면 실제 일봉 panic-buy 신호를`}
                확인할 수 있습니다.
              </p>
            )
          ) : recentWarningEvents.length ? (
            <div className={styles.tradeList}>
              {recentWarningEvents.map((event, index) => (
                <article
                  key={`${event.time}-${event.level}-${index}`}
                  className={styles.tradeItem}
                >
                  <div className={styles.tradeTop}>
                    <div>
                      <span className={styles.tradeType}>warning L{event.level}</span>
                      <strong>{formatDateLabel(event.time, activeTimeframe)}</strong>
                    </div>
                    <div className={styles.tradePnlNegative}>Top Alert</div>
                  </div>
                  <p className={styles.tradeReasons}>{event.reasons.join(" · ")}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.placeholder}>
              현재 구간에는 고점부근 경고가 없습니다. 기간을 넓히거나 ETH 일봉 구간을 사용해 보세요.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
