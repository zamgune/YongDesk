import type { BreakoutRule } from "@/lib/market/breakout-rule";
import type { BreakoutSignal, ChartQuality, PatternSignals } from "@/lib/market/pattern-signals";
import type { TradeSetup } from "@/lib/market/trade-setup";

export type BriefingCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BriefingPoint = {
  time: number;
  value: number;
};

export type BriefingMarketData = {
  symbol: string;
  candles: BriefingCandle[];
  breakoutRule?: BreakoutRule;
  tradeSetup?: TradeSetup;
  chartQuality?: ChartQuality;
  patternSignals?: PatternSignals;
  breakoutSignal?: BreakoutSignal;
  indicators: {
    sma: {
      "5": BriefingPoint[];
      "20": BriefingPoint[];
      "60": BriefingPoint[];
      "100"?: BriefingPoint[];
    };
  };
  trendFollowing?: {
    latestFeature?: {
      sma20SlopePct: number | null;
      volumeRatio: number | null;
    } | null;
    activeSetup?: unknown;
  };
};

export type BriefingRow = {
  symbol: string;
  name?: string;
  market: string;
  normalizedSymbol?: string;
  data: BriefingMarketData | null;
};

export type ChartBriefingDecision =
  | "buy-pullback"
  | "hold"
  | "wait"
  | "avoid"
  | "risk-off";

export type ChartPatternKind =
  | "breakout-confirmed"
  | "box-range"
  | "triangle-contraction"
  | "double-top"
  | "uptrend"
  | "breakdown-risk"
  | "neutral";

export type ChartBriefing = {
  decision: ChartBriefingDecision;
  label: string;
  tone: "trendEnter" | "trendHold" | "trendWatch" | "trendExit" | "trendMuted";
  headline: string;
  marketRead: string;
  sectorRead: string;
  executionPlan: string[];
  riskNotes: string[];
  pattern: {
    kind: ChartPatternKind;
    label: string;
    read: string;
    evidence: string[];
  };
  levels: {
    currentPrice: number;
    sma5: number | null;
    sma20: number | null;
    sma60: number | null;
    support: number | null;
    resistance: number | null;
    fiveDayBuyLow: number | null;
    fiveDayBuyHigh: number | null;
    twentyDayBuyLow: number | null;
    twentyDayBuyHigh: number | null;
    primaryStop: number | null;
    hardStop: number | null;
    recentHigh20: number | null;
    recentLow10: number | null;
    recentHigh60: number | null;
    recentLow60: number | null;
    priorHigh20: number | null;
    priorLow20: number | null;
    distanceToSma5Pct: number | null;
    distanceToSma20Pct: number | null;
  };
};

export type DailyBriefing = {
  dateLabel: string;
  headline: string;
  marketTone: string;
  leadership: string[];
  watchlist: string[];
  riskList: string[];
  tradingStory: string;
};

const lastValue = (series: BriefingPoint[]) =>
  series.length ? series[series.length - 1].value : null;

const formatPrice = (value?: number | null) =>
  typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const formatPriceRange = (low?: number | null, high?: number | null) =>
  typeof low === "number" && typeof high === "number"
    ? `${formatPrice(low)} ~ ${formatPrice(high)}`
    : "--";

const getWindowLowValue = (candles: BriefingCandle[], lookback: number) => {
  const window = candles.slice(-lookback);
  return window.length ? Math.min(...window.map((candle) => candle.low)) : null;
};

const getWindowHighValue = (candles: BriefingCandle[], lookback: number) => {
  const window = candles.slice(-lookback);
  return window.length ? Math.max(...window.map((candle) => candle.high)) : null;
};

const getCloseLocation = (candle: BriefingCandle) => {
  const range = candle.high - candle.low;
  return range > 0 ? (candle.close - candle.low) / range : 0.5;
};

const countNearLevel = (
  candles: BriefingCandle[],
  level: number | null,
  selector: (candle: BriefingCandle) => number,
  tolerance = 0.018,
) => {
  if (!level) {
    return 0;
  }
  return candles.filter((candle) => Math.abs(selector(candle) / level - 1) <= tolerance).length;
};

const getSeriesValueFromEnd = (series: BriefingPoint[], offset: number) => {
  const item = series[series.length - 1 - offset];
  return item?.value ?? null;
};

const getRowDisplayName = (row: BriefingRow) =>
  row.name ?? row.normalizedSymbol ?? row.symbol;

const getChangePct = (data: BriefingMarketData) => {
  const latest = data.candles[data.candles.length - 1];
  const previous = data.candles[data.candles.length - 2] ?? latest;
  return previous.close > 0 ? latest.close / previous.close - 1 : 0;
};

const isBreakoutLeadership = (item: {
  row: BriefingRow & { data: BriefingMarketData };
  briefing: ChartBriefing;
}) =>
  item.briefing.pattern.kind === "breakout-confirmed" ||
  item.row.data.breakoutRule?.status === "breakout-ready" ||
  item.row.data.breakoutRule?.status === "profit-tracking";

const getLeadershipLabel = (item: {
  row: BriefingRow & { data: BriefingMarketData };
  briefing: ChartBriefing;
}) => (isBreakoutLeadership(item) ? item.briefing.pattern.label : item.briefing.label);

type ExecutionPlanInput = {
  decision: ChartBriefingDecision;
  patternKind: ChartPatternKind;
  tradeSetup?: TradeSetup;
  sma5: number | null;
  sma20: number | null;
  recentHigh20: number | null;
  recentHigh60: number | null;
  recentLow10: number | null;
  recentLow60: number | null;
  volumeRatio: number | null;
  fiveDayBuyLow: number | null;
  fiveDayBuyHigh: number | null;
  twentyDayBuyLow: number | null;
  twentyDayBuyHigh: number | null;
  primaryStop: number | null;
  hardStop: number | null;
};

const getVolumeCheckText = (volumeRatio: number | null) =>
  volumeRatio !== null
    ? `거래량 ${volumeRatio.toFixed(2)}배`
    : "거래량 회복";

const buildExecutionPlan = ({
  decision,
  patternKind,
  tradeSetup,
  sma5,
  sma20,
  recentHigh20,
  recentHigh60,
  recentLow10,
  recentLow60,
  volumeRatio,
  fiveDayBuyLow,
  fiveDayBuyHigh,
  twentyDayBuyLow,
  twentyDayBuyHigh,
  primaryStop,
  hardStop,
}: ExecutionPlanInput) => {
  const keyLevel = tradeSetup?.keyLevel ?? null;
  const failureLevel = tradeSetup?.failureLevel ?? primaryStop ?? hardStop;
  const resistance = keyLevel ?? recentHigh20 ?? recentHigh60;
  const support = failureLevel ?? recentLow10 ?? recentLow60 ?? sma20;

  if (tradeSetup?.type === "risk-off" || patternKind === "breakdown-risk" || decision === "risk-off") {
    return [
      `우선 전략: 신규 진입보다 방어가 먼저입니다. ${tradeSetup?.keyLevelLabel ?? "20일선"} ${formatPrice(keyLevel ?? sma20)} 회복 전까지 관찰합니다.`,
      `진입 조건: ${formatPrice(keyLevel ?? sma20)} 위 일봉 종가 회복과 ${getVolumeCheckText(volumeRatio)}가 같이 필요합니다.`,
      `실패 조건: ${tradeSetup?.invalidIf ?? `${formatPrice(support)} 아래 마감 시 추세 훼손으로 보고 비중 축소를 우선합니다.`}`,
    ];
  }

  if (tradeSetup?.type === "breakout" || patternKind === "breakout-confirmed") {
    return [
      `우선 전략: ${formatPrice(resistance)} 돌파 지지선 위 일봉 종가 유지가 핵심입니다.`,
      `진입 조건: 돌파 지지선 위 눌림에서 ${getVolumeCheckText(volumeRatio)} 후 분할 접근합니다.`,
      `실패 조건: ${tradeSetup?.invalidIf ?? `${formatPrice(failureLevel)} 아래 일봉 마감 시 돌파 실패로 보고 신규 진입을 보류합니다.`}`,
    ];
  }

  if (patternKind === "double-top") {
    return [
      `우선 전략: ${formatPrice(recentHigh60 ?? recentHigh20)} 저항 재돌파 전까지 신규 진입을 보류합니다.`,
      `진입 조건: 저항 위 일봉 종가 회복과 ${getVolumeCheckText(volumeRatio)}가 같이 나와야 합니다.`,
      `실패 조건: ${formatPrice(support)} 아래 마감 시 쌍봉 실패 흐름으로 보고 방어합니다.`,
    ];
  }

  if (patternKind === "triangle-contraction") {
    return [
      `우선 전략: 수렴 구간은 방향 확인 전까지 비중을 제한합니다.`,
      `진입 조건: 상단 ${formatPrice(recentHigh20 ?? resistance)} 돌파 또는 20일선 ${formatPrice(sma20)} 지지 후 분할 접근합니다.`,
      `실패 조건: 하단 ${formatPrice(recentLow10 ?? support)} 아래 마감 시 하방 이탈로 보고 신규 진입을 보류합니다.`,
    ];
  }

  if (patternKind === "box-range") {
    return [
      `우선 전략: 박스 상단 ${formatPrice(recentHigh60 ?? recentHigh20)} 돌파 전 추격은 피합니다.`,
      `진입 조건: 상단 돌파 후 지지 확인 또는 하단 ${formatPrice(recentLow60 ?? recentLow10)} 부근 반등 확인 시 분할 접근합니다.`,
      `실패 조건: 박스 하단 ${formatPrice(recentLow60 ?? recentLow10)} 아래 마감 시 구간 대응을 중단합니다.`,
    ];
  }

  if (tradeSetup?.type === "reclaim") {
    return [
      `우선 전략: ${tradeSetup.keyLevelLabel} ${formatPrice(keyLevel)} 회복 여부를 먼저 봅니다.`,
      `진입 조건: ${tradeSetup.validIf} 회복 후 5일선이 따라붙으면 분할 접근합니다.`,
      `실패 조건: ${tradeSetup.invalidIf}`,
    ];
  }

  if (tradeSetup?.type === "extended") {
    return [
      `우선 전략: 신규 진입보다 보유 관리가 우선입니다. ${tradeSetup.keyLevelLabel} ${formatPrice(keyLevel)}를 추적합니다.`,
      `진입 조건: 과열이 식고 5일선 ${formatPrice(sma5)} 또는 20일선 ${formatPrice(sma20)} 지지가 확인될 때만 검토합니다.`,
      `실패 조건: ${tradeSetup.invalidIf}`,
    ];
  }

  if (patternKind === "uptrend" || decision === "buy-pullback" || decision === "hold") {
    return [
      `우선 전략: 5일선 ${formatPrice(sma5)} 지지 확인 후 분할 접근합니다.`,
      `진입 조건: ${formatPriceRange(fiveDayBuyLow, fiveDayBuyHigh)} 구간에서 양봉 전환, 보수형은 ${formatPriceRange(twentyDayBuyLow, twentyDayBuyHigh)} 20일선 지지를 확인합니다.`,
      `실패 조건: ${formatPrice(primaryStop ?? support)} 아래 일봉 마감 시 눌림 실패로 보고 신규 진입을 보류합니다.`,
    ];
  }

  return [
    `우선 전략: 방향성이 약하므로 ${formatPrice(resistance)} 돌파 또는 ${formatPrice(sma20)} 회복 전까지 대기합니다.`,
    `진입 조건: 20일선 위 일봉 종가 회복과 ${getVolumeCheckText(volumeRatio)}가 같이 필요합니다.`,
    `실패 조건: ${formatPrice(support)} 아래 마감 시 관찰 후보에서 낮춥니다.`,
  ];
};

export const buildChartBriefing = (row?: BriefingRow | null): ChartBriefing | null => {
  const data = row?.data;
  if (!data?.candles.length) {
    return null;
  }

  const latest = data.candles[data.candles.length - 1];
  const previous = data.candles[data.candles.length - 2] ?? latest;
  const priorCandles = data.candles.slice(0, -1);
  const sma5 = lastValue(data.indicators.sma["5"]);
  const sma20 = lastValue(data.indicators.sma["20"]);
  const sma60 = lastValue(data.indicators.sma["60"]);
  const previousSma20 = getSeriesValueFromEnd(data.indicators.sma["20"], 5);
  const recentHigh20 = getWindowHighValue(priorCandles, 20);
  const recentLow10 = getWindowLowValue(data.candles, 10);
  const recentLow20 = getWindowLowValue(data.candles, 20);
  const recentWindow60 = priorCandles.slice(-60);
  const priorWindow20 = data.candles.slice(-40, -20);
  const recentHigh60 = getWindowHighValue(priorCandles, 60);
  const recentLow60 = getWindowLowValue(data.candles, 60);
  const priorHigh20 = priorWindow20.length ? Math.max(...priorWindow20.map((candle) => candle.high)) : null;
  const priorLow20 = priorWindow20.length ? Math.min(...priorWindow20.map((candle) => candle.low)) : null;
  const distanceToSma5Pct = sma5 ? latest.close / sma5 - 1 : null;
  const distanceToSma20Pct = sma20 ? latest.close / sma20 - 1 : null;
  const sma20Rising = sma20 !== null && previousSma20 !== null && sma20 >= previousSma20;
  const aboveSma5 = sma5 !== null && latest.close >= sma5;
  const aboveSma20 = sma20 !== null && latest.close >= sma20;
  const aboveSma60 = sma60 !== null && latest.close >= sma60;
  const strongCandle = latest.close >= previous.close;
  const extendedFromFive = distanceToSma5Pct !== null && distanceToSma5Pct > 0.045;
  const extendedFromTwenty = distanceToSma20Pct !== null && distanceToSma20Pct > 0.12;
  const brokenTwenty = sma20 !== null && latest.close < sma20;
  const brokenRecentLow = recentLow10 !== null && latest.close < recentLow10;
  const fiveDayBuyLow = sma5 ? sma5 * 0.99 : null;
  const fiveDayBuyHigh = sma5 ? sma5 * 1.015 : null;
  const twentyDayBuyLow = sma20 ? sma20 * 0.985 : null;
  const twentyDayBuyHigh = sma20 ? sma20 * 1.02 : null;
  const primaryStop = sma20 ? sma20 * 0.985 : null;
  const hardStop = recentLow10 ? recentLow10 * 0.99 : primaryStop;
  const rangeWidth60 = recentHigh60 && recentLow60 && latest.close > 0 ? (recentHigh60 - recentLow60) / latest.close : null;
  const resistanceTouches = countNearLevel(recentWindow60, recentHigh60, (candle) => candle.high);
  const supportTouches = countNearLevel(recentWindow60, recentLow60, (candle) => candle.low);
  const highsContracting = priorHigh20 !== null && recentHigh20 !== null && recentHigh20 < priorHigh20 * 0.995;
  const lowsRising = priorLow20 !== null && recentLow20 !== null && recentLow20 > priorLow20 * 1.005;
  const topCandidates = recentWindow60
    .map((candle, index) => ({ candle, index }))
    .sort((left, right) => right.candle.high - left.candle.high);
  const doubleTopPair = topCandidates.find((left, leftIndex) =>
    topCandidates
      .slice(leftIndex + 1)
      .some((right) =>
        Math.abs(left.index - right.index) >= 8 &&
        Math.abs(left.candle.high / right.candle.high - 1) <= 0.035,
      ),
  );
  const closeLocation = getCloseLocation(latest);
  const volumeRatio = data.trendFollowing?.latestFeature?.volumeRatio ?? null;
  const breakoutStatus = data.breakoutRule?.status;
  const breakoutLevel = data.breakoutRule?.newHighLevel ?? recentHigh60 ?? recentHigh20;
  const breakoutRuleConfirmed =
    breakoutStatus === "breakout-ready" || breakoutStatus === "profit-tracking";
  const priceBreakoutConfirmed =
    breakoutLevel !== null &&
    latest.close > breakoutLevel * 1.005 &&
    aboveSma20 &&
    closeLocation >= 0.6;
  const breakoutConfirmed = breakoutRuleConfirmed || priceBreakoutConfirmed;
  const doubleTopFailed =
    Boolean(doubleTopPair && recentHigh60) &&
    latest.high >= (recentHigh60 ?? 0) * 0.98 &&
    (latest.close < (recentHigh60 ?? 0) * 0.995 || closeLocation < 0.55);
  const pattern =
    brokenTwenty || brokenRecentLow
      ? {
          kind: "breakdown-risk" as const,
          label: "20일선 이탈 주의",
          read: "주요 기준선 아래로 내려왔거나 최근 저점을 위협해 신규 매수보다 방어가 먼저입니다.",
          evidence: [
            sma20 ? `20일선 ${formatPrice(sma20)} 기준 확인` : "20일선 데이터 부족",
            recentLow10 ? `최근 저점 ${formatPrice(recentLow10)} 이탈 여부 확인` : "최근 저점 기준 부족",
          ],
        }
      : breakoutConfirmed && breakoutLevel !== null
        ? {
            kind: "breakout-confirmed" as const,
            label: breakoutStatus === "profit-tracking" ? "20일선 추적" : "신고가 돌파",
            read: "전고점을 종가로 돌파했고 20일선 위 구조가 유지됩니다. 추격보다 5일선 또는 전고점 지지 확인을 우선합니다.",
            evidence: [
              `전고점 ${formatPrice(breakoutLevel)} 종가 돌파`,
              `종가 위치 ${(closeLocation * 100).toFixed(0)}% / 20일선 위`,
              volumeRatio !== null
                ? `거래량 ${volumeRatio.toFixed(2)}배`
                : "거래량 배율 데이터는 보조 확인 필요",
            ],
          }
      : doubleTopFailed && recentHigh60
        ? {
            kind: "double-top" as const,
            label: "쌍봉 의심",
            read: "비슷한 가격대의 고점이 반복되어 전고 돌파 실패 시 단기 조정 가능성을 봅니다.",
            evidence: [
              `상단 저항 ${formatPrice(recentHigh60)} 돌파 실패`,
              `종가 위치 ${(closeLocation * 100).toFixed(0)}% / 종가 기준 전고 방어 확인 필요`,
            ],
          }
        : highsContracting && lowsRising
          ? {
              kind: "triangle-contraction" as const,
              label: "삼각수렴 관찰",
              read: "고점은 낮아지고 저점은 높아지는 압축 구간입니다. 방향이 나오는 쪽으로 대응합니다.",
              evidence: [
                priorHigh20 && recentHigh20 ? `고점 ${formatPrice(priorHigh20)} -> ${formatPrice(recentHigh20)}` : "고점 수렴",
                priorLow20 && recentLow20 ? `저점 ${formatPrice(priorLow20)} -> ${formatPrice(recentLow20)}` : "저점 수렴",
              ],
            }
          : rangeWidth60 !== null && rangeWidth60 <= 0.22 && resistanceTouches >= 2 && supportTouches >= 2
            ? {
                kind: "box-range" as const,
                label: "박스권",
                read: "상단 저항과 하단 지지가 반복되는 구간입니다. 상단 돌파 또는 하단 이탈 전까지는 구간 대응이 유리합니다.",
                evidence: [
                  `상단 터치 ${resistanceTouches}회 / 하단 터치 ${supportTouches}회`,
                  recentHigh60 && recentLow60 ? `박스 폭 ${((rangeWidth60 ?? 0) * 100).toFixed(1)}%` : "박스 폭 계산 대기",
                ],
              }
            : aboveSma20 && sma20Rising
              ? {
                  kind: "uptrend" as const,
                  label: "상승 추세",
                  read: "20일선 위에서 추세가 유지됩니다. 추격보다 5일선 또는 20일선 지지 확인이 중요합니다.",
                  evidence: [
                    sma5 ? `5일선 ${formatPrice(sma5)}` : "5일선 데이터 부족",
                    sma20 ? `20일선 ${formatPrice(sma20)} 상승 흐름` : "20일선 데이터 부족",
                  ],
                }
              : {
                  kind: "neutral" as const,
                  label: "방향성 대기",
                  read: "지지와 저항 사이에서 확실한 방향이 아직 약합니다. 돌파 또는 지지 반등 확인이 필요합니다.",
                  evidence: [
                    recentHigh20 ? `저항 ${formatPrice(recentHigh20)}` : "저항 계산 대기",
                    recentLow10 ? `지지 ${formatPrice(recentLow10)}` : "지지 계산 대기",
                  ],
                };
  let decision: ChartBriefingDecision = "wait";

  if (brokenTwenty || brokenRecentLow) {
    decision = "risk-off";
  } else if (aboveSma20 && sma20Rising && aboveSma5 && !extendedFromFive && !extendedFromTwenty) {
    decision = "buy-pullback";
  } else if (aboveSma20 && sma20Rising && (extendedFromFive || extendedFromTwenty)) {
    decision = "hold";
  } else if (!aboveSma60 || !sma20Rising) {
    decision = "avoid";
  }

  const labelByDecision: Record<ChartBriefingDecision, string> = {
    "buy-pullback": "눌림 매수 가능",
    hold: "보유/눌림 대기",
    wait: "확인 대기",
    avoid: "매력 낮음",
    "risk-off": "손절 주의",
  };
  const toneByDecision: Record<ChartBriefingDecision, ChartBriefing["tone"]> = {
    "buy-pullback": "trendEnter",
    hold: "trendHold",
    wait: "trendWatch",
    avoid: "trendMuted",
    "risk-off": "trendExit",
  };
  const headline =
    decision === "buy-pullback"
      ? "5일선과 20일선 위에서 추세가 유지됩니다. 추격보다 5일선 지지 확인 후 분할 진입이 유리합니다."
      : decision === "hold"
        ? "추세는 살아 있지만 현재가가 단기선에서 벌어져 있습니다. 신규 진입은 눌림을 기다리는 편이 낫습니다."
        : decision === "risk-off"
          ? "20일선 또는 최근 저점 이탈 위험이 잡힙니다. 신규 매수보다 손절/비중 축소 기준을 먼저 확인하십시오."
          : decision === "avoid"
            ? "20일선 기울기나 중기 추세가 아직 충분히 강하지 않습니다. 주도주 후보로 보기 어렵습니다."
            : "방향성은 중립입니다. 5일선 재돌파 또는 20일선 지지 반등이 확인될 때까지 대기하십시오.";
  const marketRead = aboveSma20
    ? `현재가는 20일선 위에 있으며 20일선 기울기는 ${sma20Rising ? "상승" : "둔화"} 상태입니다.`
    : "현재가는 20일선 아래에 있어 추세 매수보다 회복 확인이 먼저입니다.";
  const sectorRead =
    data.trendFollowing?.activeSetup || decision === "buy-pullback" || decision === "hold"
      ? "대장주 후보는 20일선을 지키며 시장보다 강한 종목을 우선합니다. 같은 섹터 내 약한 종목은 후순위로 둡니다."
      : "섹터 대장주 기준으로도 20일선 위 회복과 거래량 동반 반등이 확인되어야 합니다.";

  return {
    decision,
    label: labelByDecision[decision],
    tone: toneByDecision[decision],
    headline,
    marketRead,
    sectorRead,
    pattern,
    executionPlan: buildExecutionPlan({
      decision,
      patternKind: pattern.kind,
      tradeSetup: data.tradeSetup,
      sma5,
      sma20,
      recentHigh20,
      recentHigh60,
      recentLow10,
      recentLow60,
      volumeRatio,
      fiveDayBuyLow,
      fiveDayBuyHigh,
      twentyDayBuyLow,
      twentyDayBuyHigh,
      primaryStop,
      hardStop,
    }),
    riskNotes: [
      primaryStop
        ? `1차 손절: 종가가 20일선 기준 ${formatPrice(primaryStop)} 아래로 내려가면 방어적으로 봅니다.`
        : "1차 손절: 20일선 데이터가 부족합니다.",
      hardStop
        ? `강제 손절: 최근 저점 기준 ${formatPrice(hardStop)} 이탈 시 추세 훼손으로 봅니다.`
        : "강제 손절: 최근 저점 데이터가 부족합니다.",
      strongCandle
        ? "마지막 봉은 직전 봉 대비 가격을 방어했습니다."
        : "마지막 봉은 직전 봉 대비 약세이므로 다음 봉 확인이 필요합니다.",
    ],
    levels: {
      currentPrice: latest.close,
      sma5,
      sma20,
      sma60,
      support: recentLow10 ?? recentLow20 ?? recentLow60,
      resistance: recentHigh20 ?? recentHigh60,
      fiveDayBuyLow,
      fiveDayBuyHigh,
      twentyDayBuyLow,
      twentyDayBuyHigh,
      primaryStop,
      hardStop,
      recentHigh20,
      recentLow10,
      recentHigh60,
      recentLow60,
      priorHigh20,
      priorLow20,
      distanceToSma5Pct,
      distanceToSma20Pct,
    },
  };
};

export const buildDailyBriefing = (rows: BriefingRow[]): DailyBriefing | null => {
  const loadedRows = rows.filter((row) => row.data?.candles.length);
  if (!loadedRows.length) {
    return null;
  }

  const briefings = loadedRows
    .map((row) => ({ row: row as BriefingRow & { data: BriefingMarketData }, briefing: buildChartBriefing(row) }))
    .filter((item): item is { row: BriefingRow & { data: BriefingMarketData }; briefing: ChartBriefing } => item.briefing !== null);
  const constructive = briefings.filter((item) =>
    item.briefing.decision === "buy-pullback" ||
    item.briefing.decision === "hold" ||
    isBreakoutLeadership(item),
  );
  const riskRows = briefings.filter((item) =>
    item.briefing.decision === "risk-off" || item.briefing.decision === "avoid",
  );
  const above20Count = briefings.filter((item) =>
    item.briefing.levels.sma20 !== null &&
    item.briefing.levels.currentPrice >= item.briefing.levels.sma20,
  ).length;
  const breadth = above20Count / Math.max(briefings.length, 1);
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  const leadership = constructive
    .toSorted((left, right) => {
      const breakoutRank = Number(isBreakoutLeadership(right)) - Number(isBreakoutLeadership(left));
      return breakoutRank || getChangePct(right.row.data) - getChangePct(left.row.data);
    })
    .slice(0, 5)
    .map((item) => `${getRowDisplayName(item.row)}: ${getLeadershipLabel(item)} / ${item.briefing.marketRead}`);
  const watchlist = briefings
    .filter((item) => item.briefing.decision === "wait")
    .slice(0, 5)
    .map((item) => `${getRowDisplayName(item.row)}: 5일선 재돌파 또는 20일선 지지 확인 대기`);
  const riskList = riskRows
    .slice(0, 5)
    .map((item) => `${getRowDisplayName(item.row)}: ${item.briefing.label} / ${item.briefing.riskNotes[0]}`);

  return {
    dateLabel,
    headline:
      breadth >= 0.65
        ? "관심종목 다수가 20일선 위에서 버티고 있어 추세 접근이 가능합니다."
        : breadth >= 0.45
          ? "관심종목별 온도 차가 큽니다. 대장주와 20일선 지지 종목만 선별하십시오."
          : "20일선 위 종목이 부족합니다. 신규 매수보다 방어와 관찰이 우선입니다.",
    marketTone: `관심종목 ${briefings.length}개 중 ${above20Count}개가 20일선 위에 있습니다. 시장 체온은 ${breadth >= 0.65 ? "양호" : breadth >= 0.45 ? "중립" : "약세"}로 봅니다.`,
    leadership: leadership.length ? leadership : ["20일선 위에서 바로 접근 가능한 강한 후보가 아직 부족합니다."],
    watchlist: watchlist.length ? watchlist : ["대기 후보보다 보유/위험 후보가 더 뚜렷합니다."],
    riskList: riskList.length ? riskList : ["뚜렷한 위험 후보는 제한적입니다."],
    tradingStory:
      constructive.length > riskRows.length
        ? "오늘은 종목을 넓게 사기보다 20일선을 지키는 강한 후보에 비중을 압축하는 흐름이 적합합니다."
        : "오늘은 강한 종목만 관찰하고, 20일선 이탈 종목은 회복 전까지 후순위로 두는 흐름이 적합합니다.",
  };
};
