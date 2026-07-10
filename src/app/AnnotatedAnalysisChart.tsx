"use client";

import {
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ChartBriefing } from "@/lib/market/briefing";
import type { BreakoutSignal } from "@/lib/market/pattern-signals";
import styles from "./page.module.css";

type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartPoint = {
  time: number;
  value: number;
};

type AnalysisChartData = {
  candles: ChartCandle[];
  breakoutSignal?: BreakoutSignal;
  indicators: {
    sma: {
      "5": ChartPoint[];
      "20": ChartPoint[];
    };
  };
};

type OverlayLine = {
  key: string;
  label: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
};

type OverlayBox = {
  key: string;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverlayArrow = {
  key: string;
  label: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type OverlayGeometry = {
  width: number;
  height: number;
  lines: OverlayLine[];
  boxes: OverlayBox[];
  arrows: OverlayArrow[];
};

type AnnotatedAnalysisChartProps = {
  data: AnalysisChartData;
  briefing: ChartBriefing;
};

const chartHeight = 370;
const chartWindowSize = 90;

const chartColors = {
  candleUp: "#168a68",
  candleDown: "#c83f4c",
  sma5: "#f59e0b",
  sma20: "#3182f6",
  resistance: "#e11d48",
  support: "#2563eb",
  stop: "#7f1d1d",
  entry: "#0f766e",
  breakout: "#9333ea",
  neutral: "#64748b",
};

const getCssVar = (name: string, fallback: string) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getChartLayoutOptions = () => ({
  layout: {
    background: { color: getCssVar("--chart-bg", "#ffffff") },
    textColor: getCssVar("--chart-text", "#4e5968"),
  },
  grid: {
    vertLines: { color: getCssVar("--chart-grid", "rgba(17, 24, 39, 0.05)") },
    horzLines: { color: getCssVar("--chart-grid", "rgba(17, 24, 39, 0.05)") },
  },
  rightPriceScale: {
    borderColor: getCssVar("--border-1", "rgba(17, 24, 39, 0.08)"),
  },
  timeScale: {
    borderColor: getCssVar("--border-1", "rgba(17, 24, 39, 0.08)"),
    timeVisible: false,
  },
  localization: {
    priceFormatter: (price: number) => formatPrice(price),
  },
});

const formatPrice = (value?: number | null) =>
  typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const getLineData = (series: ChartPoint[], visibleTimes: Set<number>) =>
  series
    .filter((point) => visibleTimes.has(point.time))
    .map((point) => ({
      time: point.time as Time,
      value: point.value,
    }));

export default function AnnotatedAnalysisChart({ data, briefing }: AnnotatedAnalysisChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const sma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [overlay, setOverlay] = useState<(OverlayGeometry & { signature: string }) | null>(null);

  const visibleCandles = useMemo(
    () => data.candles.slice(-chartWindowSize),
    [data.candles],
  );
  const visibleTimes = useMemo(
    () => new Set(visibleCandles.map((candle) => candle.time)),
    [visibleCandles],
  );
  const overlaySignature = useMemo(
    () => `${visibleCandles[0]?.time ?? "empty"}:${visibleCandles.at(-1)?.time ?? "empty"}:${briefing.pattern.kind}:${data.breakoutSignal?.status ?? "none"}`,
    [briefing.pattern.kind, data.breakoutSignal?.status, visibleCandles],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      ...getChartLayoutOptions(),
      height: chartHeight,
      width: containerRef.current.clientWidth,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartColors.candleUp,
      downColor: chartColors.candleDown,
      borderVisible: false,
      wickUpColor: chartColors.candleUp,
      wickDownColor: chartColors.candleDown,
    });
    const sma5Series = chart.addSeries(LineSeries, {
      color: chartColors.sma5,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma20Series = chart.addSeries(LineSeries, {
      color: chartColors.sma20,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    sma5SeriesRef.current = sma5Series;
    sma20SeriesRef.current = sma20Series;

    const resize = () => {
      const width = containerRef.current?.clientWidth ?? 0;
      if (width > 0) {
        chart.applyOptions({ width });
      }
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    const syncTheme = () => {
      chart.applyOptions(getChartLayoutOptions());
    };
    window.addEventListener("stock-analysis-theme-change", syncTheme);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("stock-analysis-theme-change", syncTheme);
      priceLinesRef.current = [];
      candleSeriesRef.current = null;
      sma5SeriesRef.current = null;
      sma20SeriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const sma5Series = sma5SeriesRef.current;
    const sma20Series = sma20SeriesRef.current;
    const container = containerRef.current;
    if (!chart || !candleSeries || !sma5Series || !sma20Series || !container || visibleCandles.length < 20) {
      return;
    }

    candleSeries.setData(
      visibleCandles.map((candle) => ({
        ...candle,
        time: candle.time as Time,
      })),
    );
    sma5Series.setData(getLineData(data.indicators.sma["5"], visibleTimes));
    sma20Series.setData(getLineData(data.indicators.sma["20"], visibleTimes));

    priceLinesRef.current.forEach((line) => candleSeries.removePriceLine(line));
    priceLinesRef.current = [];

    const addPriceLine = (price: number | null, title: string, color: string, style = LineStyle.Dashed) => {
      if (typeof price !== "number") {
        return;
      }
      priceLinesRef.current.push(
        candleSeries.createPriceLine({
          price,
          title,
          color,
          lineWidth: title === "손절" ? 3 : 2,
          lineStyle: style,
          axisLabelVisible: true,
        }),
      );
    };

    addPriceLine(briefing.levels.resistance, "저항", chartColors.resistance);
    addPriceLine(briefing.levels.support, "지지", chartColors.support);
    addPriceLine(briefing.levels.primaryStop, "손절", chartColors.stop);
    addPriceLine(data.breakoutSignal?.breakoutLevel ?? null, "돌파", chartColors.breakout, LineStyle.Solid);
    addPriceLine(data.breakoutSignal?.failureLevel ?? null, "실패", chartColors.stop);

    chart.timeScale().fitContent();

    const updateOverlay = () => {
      const width = container.clientWidth;
      const height = chartHeight;
      const first = visibleCandles[0];
      const last = visibleCandles[visibleCandles.length - 1];
      const leftX = chart.timeScale().timeToCoordinate(first.time as Time) ?? 28;
      const rightX = chart.timeScale().timeToCoordinate(last.time as Time) ?? width - 56;
      const safeLeft = Math.max(12, leftX);
      const safeRight = Math.min(width - 78, rightX);
      const priceY = (price?: number | null) => {
        if (typeof price !== "number") {
          return null;
        }
        return candleSeries.priceToCoordinate(price);
      };

      const lines: OverlayLine[] = [];
      const boxes: OverlayBox[] = [];
      const arrows: OverlayArrow[] = [];
      const supportY = priceY(briefing.levels.support);
      const resistanceY = priceY(briefing.levels.resistance);
      const stopY = priceY(briefing.levels.primaryStop);
      const breakoutY = priceY(data.breakoutSignal?.breakoutLevel);
      const failureY = priceY(data.breakoutSignal?.failureLevel);
      const entryHighY = priceY(briefing.levels.fiveDayBuyHigh);
      const entryLowY = priceY(briefing.levels.fiveDayBuyLow);

      if (resistanceY !== null) {
        lines.push({
          key: "resistance",
          label: "저항",
          color: chartColors.resistance,
          x1: safeLeft,
          y1: resistanceY,
          x2: safeRight,
          y2: resistanceY,
        });
      }
      if (supportY !== null) {
        lines.push({
          key: "support",
          label: "지지",
          color: chartColors.support,
          x1: safeLeft,
          y1: supportY,
          x2: safeRight,
          y2: supportY,
        });
      }
      if (stopY !== null) {
        lines.push({
          key: "stop",
          label: "손절",
          color: chartColors.stop,
          x1: safeLeft,
          y1: stopY,
          x2: safeRight,
          y2: stopY,
          dashed: true,
        });
      }
      if (breakoutY !== null) {
        lines.push({
          key: "breakout-signal",
          label: "돌파 기준",
          color: chartColors.breakout,
          x1: safeLeft,
          y1: breakoutY,
          x2: safeRight,
          y2: breakoutY,
        });
      }
      if (failureY !== null) {
        lines.push({
          key: "breakout-failure",
          label: "돌파 실패",
          color: chartColors.stop,
          x1: safeLeft,
          y1: failureY,
          x2: safeRight,
          y2: failureY,
          dashed: true,
        });
      }
      if (entryHighY !== null && entryLowY !== null) {
        boxes.push({
          key: "entry-zone",
          label: "진입 관심",
          color: chartColors.entry,
          x: width * 0.52,
          y: Math.min(entryHighY, entryLowY),
          width: Math.max(96, safeRight - width * 0.52),
          height: Math.max(12, Math.abs(entryLowY - entryHighY)),
        });
      }

      if (briefing.pattern.kind === "box-range" && resistanceY !== null && supportY !== null) {
        boxes.push({
          key: "box-range",
          label: "박스권",
          color: chartColors.neutral,
          x: safeLeft,
          y: Math.min(resistanceY, supportY),
          width: safeRight - safeLeft,
          height: Math.max(18, Math.abs(supportY - resistanceY)),
        });
      }

      if (briefing.pattern.kind === "triangle-contraction" && resistanceY !== null && supportY !== null) {
        const priorHighY = priceY(briefing.levels.priorHigh20);
        const priorLowY = priceY(briefing.levels.priorLow20);
        if (priorHighY !== null) {
          lines.push({
            key: "triangle-upper",
            label: "상단 수렴",
            color: chartColors.resistance,
            x1: width * 0.2,
            y1: priorHighY,
            x2: safeRight,
            y2: resistanceY,
            dashed: true,
          });
        }
        if (priorLowY !== null) {
          lines.push({
            key: "triangle-lower",
            label: "하단 수렴",
            color: chartColors.support,
            x1: width * 0.2,
            y1: priorLowY,
            x2: safeRight,
            y2: supportY,
            dashed: true,
          });
        }
      }

      if (briefing.pattern.kind === "double-top" && resistanceY !== null) {
        arrows.push({
          key: "double-top-risk",
          label: "쌍봉 의심",
          color: chartColors.resistance,
          x1: safeRight - 82,
          y1: resistanceY + 18,
          x2: safeRight - 20,
          y2: resistanceY - 6,
        });
      } else if (briefing.pattern.kind === "breakdown-risk" && supportY !== null) {
        arrows.push({
          key: "down-risk",
          label: "이탈 시 방어",
          color: chartColors.stop,
          x1: safeRight - 84,
          y1: Math.max(28, supportY - 46),
          x2: safeRight - 18,
          y2: supportY + 12,
        });
      } else if (breakoutY !== null) {
        arrows.push({
          key: "breakout-signal-arrow",
          label: "돌파 확인",
          color: chartColors.breakout,
          x1: safeRight - 84,
          y1: breakoutY + 46,
          x2: safeRight - 18,
          y2: breakoutY - 12,
        });
      } else if (resistanceY !== null) {
        arrows.push({
          key: "up-scenario",
          label: "돌파 시 추세",
          color: chartColors.entry,
          x1: safeRight - 84,
          y1: resistanceY + 46,
          x2: safeRight - 18,
          y2: resistanceY - 12,
        });
      }

      setOverlay({ width, height, lines, boxes, arrows, signature: overlaySignature });
    };

    const frameId = requestAnimationFrame(updateOverlay);
    chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlay);

    return () => {
      cancelAnimationFrame(frameId);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateOverlay);
    };
  }, [briefing, data.breakoutSignal, data.indicators.sma, overlaySignature, visibleCandles, visibleTimes]);

  if (visibleCandles.length < 20) {
    return (
      <div className={styles.annotatedChartEmpty}>
        <strong>차트 데이터 부족</strong>
        <p>지지/저항과 패턴을 그리려면 최소 20개 이상의 봉 데이터가 필요합니다.</p>
      </div>
    );
  }

  return (
    <section className={styles.annotatedChartPanel}>
      <div className={styles.annotatedChartHeader}>
        <div>
          <span>차트 그림 분석</span>
          <h3>{briefing.pattern.label}</h3>
          <p>{briefing.pattern.read}</p>
        </div>
        <div className={styles.annotatedChartLegend}>
          <span><i className={styles.legendSma5} />5MA</span>
          <span><i className={styles.legendSma20} />20MA</span>
          <span><i className={styles.legendSupport} />지지</span>
          <span><i className={styles.legendResistance} />저항</span>
        </div>
      </div>
      <div className={styles.annotatedChartFrame}>
        <div ref={containerRef} className={styles.annotatedChartCanvas} />
        {overlay?.signature === overlaySignature ? (
          <svg
            className={styles.annotatedChartOverlay}
            viewBox={`0 0 ${overlay.width} ${overlay.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="analysis-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {overlay.boxes.map((box) => (
              <g key={box.key} color={box.color}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx="4"
                  fill="currentColor"
                  opacity="0.12"
                />
                <text x={box.x + 8} y={box.y + 16} fill={box.color}>{box.label}</text>
              </g>
            ))}
            {overlay.lines.map((line) => (
              <g key={line.key} color={line.color}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="currentColor"
                  strokeWidth={line.key === "stop" ? "4" : "3.2"}
                  strokeDasharray={line.dashed ? "8 6" : undefined}
                />
                <text x={Math.min(line.x2 + 6, overlay.width - 58)} y={line.y2 - 6} fill={line.color}>
                  {line.label}
                </text>
              </g>
            ))}
            {overlay.arrows.map((arrow) => (
              <g key={arrow.key} color={arrow.color}>
                <line
                  x1={arrow.x1}
                  y1={arrow.y1}
                  x2={arrow.x2}
                  y2={arrow.y2}
                  stroke="currentColor"
                  strokeWidth="2.8"
                  markerEnd="url(#analysis-arrow)"
                />
                <text x={Math.min(arrow.x1 - 8, overlay.width - 96)} y={arrow.y1 - 8} fill={arrow.color}>
                  {arrow.label}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
      </div>
      <div className={styles.annotatedChartNotes}>
        {briefing.pattern.evidence.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}
