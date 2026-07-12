export type HoldingHorizon = "day" | "swing" | "long";
export type HorizonPlanStatus = "actionable" | "wait" | "unavailable";
export type ExitTrigger = "hourly-close" | "daily-close" | "monthly-close";
export type PlanReliabilityGrade = "high" | "medium" | "low" | "insufficient-data";
export type HoldingPlanMode = "new-entry" | "position-management";
export type HoldingManagementState = "active" | "invalidation-breached" | "recovery-watch";

export type HorizonManagementState = {
  state: HoldingManagementState;
  currentPrice: number;
  averagePrice: number;
  invalidationPrice: number;
  reentryConfirmationPrice: number;
  actions: string[];
};

export type HorizonPlanBasis = {
  symbol: string;
  market: string;
  currency: "KRW" | "USD";
  dataSource: string;
  quoteAt: string;
  generatedAt: string;
  timeframeLabel: string;
  entryPrice: number;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  sma20: number | null;
  sma200: number | null;
  tenMonthAverage: number | null;
  weeklySma20: number | null;
  weeklySma60: number | null;
  chandelierLong: number | null;
  reliabilityGrade: PlanReliabilityGrade;
};

export type HorizonExitPlan = {
  horizon: HoldingHorizon;
  status: HorizonPlanStatus;
  planMode: HoldingPlanMode;
  currentPrice: number;
  entryPrice: number;
  managementState: HorizonManagementState | null;
  stop: {
    price: number | null;
    trigger: ExitTrigger;
    isBrokerStopEligible: boolean;
    reason: string;
  };
  takeProfits: Array<{
    price: number;
    allocationPct: number;
    basis: string;
  }>;
  trailingExit: {
    price: number | null;
    allocationPct: number;
    basis: string;
  } | null;
  riskPerShare: number | null;
  stopPct: number | null;
  rewardRisk: number | null;
  basis: HorizonPlanBasis;
  formulaSteps: string[];
  reasons: string[];
  blockers: string[];
};

export type HorizonPlanContext = {
  symbol: string;
  market: string;
  currency: "KRW" | "USD";
  dataSource: string;
  dataSourceByHorizon?: Partial<Record<HoldingHorizon, string>>;
  quoteAt: string;
  generatedAt?: string;
  planMode?: HoldingPlanMode;
  currentPrice?: number;
  entryPrice: number;
  stale: boolean;
  staleByHorizon?: Partial<Record<HoldingHorizon, boolean>>;
  quoteAtByHorizon?: Partial<Record<HoldingHorizon, string>>;
  reliabilityGrade: PlanReliabilityGrade;
  day?: {
    atr14: number | null;
    recentLow20: number | null;
    resistance: number | null;
    higherTimeframe: "4h" | "1d";
    higherTimeframeTrendUp: boolean | null;
    entryTrendUp: boolean | null;
    trendQualityPassed: boolean | null;
    volumeConfirmed: boolean | null;
    latestBarClosed: boolean;
  };
  swing?: {
    atr14Daily: number | null;
    failureLevel: number | null;
    resistance: number | null;
    sma20: number | null;
    chandelierLong: number | null;
    marketGatePassed: boolean | null;
    dailyTrendUp: boolean | null;
    entryTimeframe: "1h" | "4h";
    entryTrendUp: boolean | null;
    confirmationTimeframe: "1h" | null;
    confirmationTrendUp: boolean | null;
    latestBarClosed: boolean;
  };
  long?: {
    sma200: number | null;
    tenMonthAverage: number | null;
    weeklySma20: number | null;
    weeklySma60: number | null;
    marketGatePassed: boolean | null;
    latestBarClosed: boolean;
  };
};

const contextIsStale = (context: HorizonPlanContext, horizon: HoldingHorizon) =>
  context.staleByHorizon?.[horizon] ?? context.stale;

const finitePositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const stopPercent = (entryPrice: number, stopPrice: number) =>
  ((stopPrice / entryPrice) - 1) * 100;

const planIdentity = (context: HorizonPlanContext) => ({
  planMode: context.planMode ?? "new-entry" as const,
  currentPrice: context.currentPrice ?? context.entryPrice,
  managementState: null,
});

const baseBasis = (
  context: HorizonPlanContext,
  horizon: HoldingHorizon,
  timeframeLabel: string,
  values: Partial<Omit<HorizonPlanBasis, keyof Pick<
    HorizonPlanBasis,
    "symbol" | "market" | "currency" | "dataSource" | "quoteAt" | "generatedAt" | "timeframeLabel" | "entryPrice" | "reliabilityGrade"
  >>>,
): HorizonPlanBasis => ({
  symbol: context.symbol,
  market: context.market,
  currency: context.currency,
  dataSource: context.dataSourceByHorizon?.[horizon] ?? context.dataSource,
  quoteAt: context.quoteAtByHorizon?.[horizon] ?? context.quoteAt,
  generatedAt: context.generatedAt ?? new Date().toISOString(),
  timeframeLabel,
  entryPrice: context.entryPrice,
  atr14: values.atr14 ?? null,
  support: values.support ?? null,
  resistance: values.resistance ?? null,
  sma20: values.sma20 ?? null,
  sma200: values.sma200 ?? null,
  tenMonthAverage: values.tenMonthAverage ?? null,
  weeklySma20: values.weeklySma20 ?? null,
  weeklySma60: values.weeklySma60 ?? null,
  chandelierLong: values.chandelierLong ?? null,
  reliabilityGrade: context.reliabilityGrade,
});

const unavailablePlan = ({
  context,
  horizon,
  trigger,
  timeframeLabel,
  blockers,
  basisValues = {},
}: {
  context: HorizonPlanContext;
  horizon: HoldingHorizon;
  trigger: ExitTrigger;
  timeframeLabel: string;
  blockers: string[];
  basisValues?: Parameters<typeof baseBasis>[3];
}): HorizonExitPlan => ({
  horizon,
  status: "unavailable",
  ...planIdentity(context),
  entryPrice: context.entryPrice,
  stop: {
    price: null,
    trigger,
    isBrokerStopEligible: false,
    reason: "필수 봉 또는 지표가 없어 손절 기준을 계산하지 않았습니다.",
  },
  takeProfits: [],
  trailingExit: null,
  riskPerShare: null,
  stopPct: null,
  rewardRisk: null,
  basis: baseBasis(context, horizon, timeframeLabel, basisValues),
  formulaSteps: [],
  reasons: [],
  blockers,
});

const calculateDayPlan = (context: HorizonPlanContext): HorizonExitPlan => {
  const values = context.day;
  const timeframeLabel = values?.higherTimeframe === "4h"
    ? "4시간봉 방향 · 1시간봉 진입"
    : "일봉 위험 필터 · 1시간봉 진입";
  const missing: string[] = [];
  if (!finitePositive(context.entryPrice)) missing.push("현재 진입가");
  if (!values) {
    missing.push("1시간봉 분석");
  } else {
    if (!finitePositive(values.atr14)) missing.push("1시간봉 ATR14");
    if (!finitePositive(values.recentLow20)) missing.push("최근 20개 1시간봉 저점");
  }
  if (missing.length || !values || !finitePositive(values.atr14) || !finitePositive(values.recentLow20)) {
    return unavailablePlan({
      context,
      horizon: "day",
      trigger: "hourly-close",
      timeframeLabel,
      blockers: missing,
      basisValues: {
        atr14: values?.atr14 ?? null,
        support: values?.recentLow20 ?? null,
        resistance: values?.resistance ?? null,
      },
    });
  }

  const structureStop = values.recentLow20 - values.atr14 * 0.2;
  const distance = clamp(
    context.entryPrice - structureStop,
    values.atr14 * 0.8,
    values.atr14 * 1.8,
  );
  const stopPrice = context.entryPrice - distance;
  const risk = context.entryPrice - stopPrice;
  if (!finitePositive(stopPrice) || !finitePositive(risk)) {
    return unavailablePlan({
      context,
      horizon: "day",
      trigger: "hourly-close",
      timeframeLabel,
      blockers: ["계산된 손절가 또는 손절 거리 R이 0 이하입니다."],
      basisValues: { atr14: values.atr14, support: values.recentLow20, resistance: values.resistance },
    });
  }

  const resistanceDistance = finitePositive(values.resistance)
    ? values.resistance - context.entryPrice
    : null;
  const firstTarget = resistanceDistance !== null && resistanceDistance >= risk * 0.8 && resistanceDistance <= risk * 1.5
    ? values.resistance!
    : context.entryPrice + risk;
  const blockers = [
    contextIsStale(context, "day") ? "가격 또는 1시간봉 데이터가 오래되었습니다." : null,
    !values.latestBarClosed ? "형성 중인 1시간봉은 확정 신호로 사용하지 않습니다." : null,
    values.higherTimeframeTrendUp === false
      ? `${values.higherTimeframe === "4h" ? "4시간봉" : "일봉"} 방향 필터가 상승 조건을 충족하지 않습니다.`
      : null,
    values.higherTimeframeTrendUp === null
      ? `${values.higherTimeframe === "4h" ? "4시간봉" : "일봉"} 방향 필터를 확인할 표본이 부족합니다.`
      : null,
    values.entryTrendUp === false ? "1시간봉 진입 추세가 상승 조건을 충족하지 않습니다." : null,
    values.entryTrendUp === null ? "1시간봉 진입 추세를 확인할 표본이 부족합니다." : null,
    values.trendQualityPassed === false
      ? "1시간봉 ADX·Choppiness 기준상 추세 품질이 낮습니다."
      : null,
    values.trendQualityPassed === null ? "1시간봉 추세 품질을 확인할 지표가 부족합니다." : null,
    values.volumeConfirmed === false ? "1시간봉 거래량 확인 조건을 충족하지 않습니다." : null,
    values.volumeConfirmed === null ? "1시간봉 거래량 확인 표본이 부족합니다." : null,
    resistanceDistance !== null && resistanceDistance > 0 && resistanceDistance < risk * 0.8
      ? "가까운 저항까지의 보상이 0.8R보다 작습니다."
      : null,
  ].filter((value): value is string => value !== null);

  return {
    horizon: "day",
    status: blockers.length ? "wait" : "actionable",
    ...planIdentity(context),
    entryPrice: context.entryPrice,
    stop: {
      price: stopPrice,
      trigger: "hourly-close",
      isBrokerStopEligible: false,
      reason: "최근 20개 1시간봉 저점과 ATR14 완충폭으로 계산한 종가 무효선입니다.",
    },
    takeProfits: [
      { price: firstTarget, allocationPct: 50, basis: firstTarget === values.resistance ? "가까운 1시간봉 저항" : "1R" },
      { price: context.entryPrice + risk * 2, allocationPct: 50, basis: "2R" },
    ],
    trailingExit: null,
    riskPerShare: risk,
    stopPct: stopPercent(context.entryPrice, stopPrice),
    rewardRisk: 2,
    basis: baseBasis(context, "day", timeframeLabel, {
      atr14: values.atr14,
      support: values.recentLow20,
      resistance: values.resistance,
    }),
    formulaSteps: [
      "structureStop = recentLow20 - 0.2 × ATR1h",
      "distance = clamp(entry - structureStop, 0.8 × ATR1h, 1.8 × ATR1h)",
      "stop = entry - distance",
      "takeProfit1 = 유효 저항 또는 1R, takeProfit2 = 2R",
    ],
    reasons: [
      values.higherTimeframe === "4h"
        ? "코인은 4시간봉을 방향 필터로만 사용하고 1시간봉 확정 종가에서 진입을 판단합니다."
        : "주식은 세션 길이 때문에 왜곡될 수 있는 4시간봉 대신 일봉을 위험 필터로만 쓰고, 진입은 1시간봉으로 판단합니다.",
    ],
    blockers,
  };
};

const calculateSwingPlan = (context: HorizonPlanContext): HorizonExitPlan => {
  const values = context.swing;
  const timeframeLabel = values?.entryTimeframe === "4h"
    ? "일봉 방향 · 4시간봉 진입 · 1시간봉 재확인"
    : "일봉 방향 · 1시간봉 진입";
  const missing: string[] = [];
  if (!finitePositive(context.entryPrice)) missing.push("현재 진입가");
  if (!values) {
    missing.push("일봉·4시간봉 스윙 분석");
  } else {
    if (!finitePositive(values.atr14Daily)) missing.push("일봉 ATR14");
    if (!finitePositive(values.failureLevel)) missing.push("스윙 무효선");
    if (!finitePositive(values.sma20)) missing.push("일봉 SMA20");
    if (!finitePositive(values.chandelierLong)) missing.push("일봉 Chandelier 추적선");
  }
  if (
    missing.length ||
    !values ||
    !finitePositive(values.atr14Daily) ||
    !finitePositive(values.failureLevel) ||
    !finitePositive(values.sma20) ||
    !finitePositive(values.chandelierLong)
  ) {
    return unavailablePlan({
      context,
      horizon: "swing",
      trigger: "daily-close",
      timeframeLabel,
      blockers: missing,
      basisValues: {
        atr14: values?.atr14Daily ?? null,
        support: values?.failureLevel ?? null,
        resistance: values?.resistance ?? null,
        sma20: values?.sma20 ?? null,
        chandelierLong: values?.chandelierLong ?? null,
      },
    });
  }

  const distance = clamp(
    context.entryPrice - values.failureLevel,
    values.atr14Daily * 1.5,
    values.atr14Daily * 2.5,
  );
  const stopPrice = context.entryPrice - distance;
  const risk = context.entryPrice - stopPrice;
  if (!finitePositive(stopPrice) || !finitePositive(risk)) {
    return unavailablePlan({
      context,
      horizon: "swing",
      trigger: "daily-close",
      timeframeLabel,
      blockers: ["계산된 스윙 손절가 또는 손절 거리 R이 0 이하입니다."],
    });
  }

  const resistanceDistance = finitePositive(values.resistance)
    ? values.resistance - context.entryPrice
    : null;
  const firstTarget = resistanceDistance !== null && resistanceDistance >= risk && resistanceDistance <= risk * 2
    ? values.resistance!
    : context.entryPrice + risk;
  const trailingCandidates = [values.sma20, values.chandelierLong].filter(finitePositive);
  const trailingExitPrice = Math.max(...trailingCandidates);
  const blockers = [
    contextIsStale(context, "swing") ? "가격 또는 스윙 데이터가 오래되었습니다." : null,
    values.failureLevel >= context.entryPrice
      ? "스윙 무효선이 현재 진입가 아래에 있지 않습니다."
      : null,
    !values.latestBarClosed ? `형성 중인 ${values.entryTimeframe === "4h" ? "4시간봉" : "1시간봉"}은 진입 확정에 사용하지 않습니다.` : null,
    values.marketGatePassed === false ? "종목 일봉 위험 게이트가 스윙 신규 진입을 허용하지 않습니다." : null,
    values.marketGatePassed === null ? "종목 일봉 위험 게이트를 확인할 표본이 부족합니다." : null,
    values.dailyTrendUp === false ? "일봉 추세가 상승 조건을 충족하지 않습니다." : null,
    values.dailyTrendUp === null ? "일봉 추세를 확인할 표본이 부족합니다." : null,
    values.entryTrendUp === false
      ? `${values.entryTimeframe === "4h" ? "4시간봉" : "1시간봉"} 진입 추세가 상승 조건을 충족하지 않습니다.`
      : null,
    values.entryTrendUp === null
      ? `${values.entryTimeframe === "4h" ? "4시간봉" : "1시간봉"} 진입 추세를 확인할 표본이 부족합니다.`
      : null,
    values.confirmationTimeframe && values.confirmationTrendUp === false
      ? "1시간봉 재확인이 상승 조건을 충족하지 않습니다."
      : null,
    values.confirmationTimeframe && values.confirmationTrendUp === null
      ? "1시간봉 재확인 표본이 부족합니다."
      : null,
    trailingExitPrice >= context.entryPrice
      ? "SMA20 또는 Chandelier 추적선이 현재 진입가 이상이라 신규 진입 추세가 유효하지 않습니다."
      : null,
    context.reliabilityGrade === "low" || context.reliabilityGrade === "insufficient-data"
      ? "신호 신뢰도가 낮거나 표본이 부족합니다."
      : null,
    resistanceDistance !== null && resistanceDistance > 0 && resistanceDistance < risk
      ? "가까운 저항까지의 보상이 1R보다 작습니다."
      : null,
  ].filter((value): value is string => value !== null);

  return {
    horizon: "swing",
    status: blockers.length ? "wait" : "actionable",
    ...planIdentity(context),
    entryPrice: context.entryPrice,
    stop: {
      price: stopPrice,
      trigger: "daily-close",
      isBrokerStopEligible: false,
      reason: "스윙 failure level을 일봉 ATR14의 1.5~2.5배 범위로 제한한 종가 무효선입니다.",
    },
    takeProfits: [
      { price: firstTarget, allocationPct: 30, basis: firstTarget === values.resistance ? "스윙 저항" : "1R" },
      { price: context.entryPrice + risk * 2, allocationPct: 30, basis: "2R" },
    ],
    trailingExit: {
      price: trailingExitPrice,
      allocationPct: 40,
      basis: "SMA20과 22봉 Chandelier 3ATR 중 높은 추적선",
    },
    riskPerShare: risk,
    stopPct: stopPercent(context.entryPrice, stopPrice),
    rewardRisk: 2,
    basis: baseBasis(context, "swing", timeframeLabel, {
      atr14: values.atr14Daily,
      support: values.failureLevel,
      resistance: values.resistance,
      sma20: values.sma20,
      chandelierLong: values.chandelierLong,
    }),
    formulaSteps: [
      "distance = clamp(entry - failureLevel, 1.5 × ATR1d, 2.5 × ATR1d)",
      "stop = entry - distance",
      "takeProfit1 = 유효 저항 또는 1R, takeProfit2 = 2R",
      "trailingExit = max(SMA20, ChandelierLong)",
    ],
    reasons: [
      values.entryTimeframe === "4h"
        ? "코인은 일봉 방향을 확인한 뒤 4시간봉 진입 구조와 1시간봉 재확인을 함께 봅니다."
        : "주식은 일봉 방향을 확인하고 정규장 1시간봉에서 스윙 진입 구조를 판단합니다.",
    ],
    blockers,
  };
};

const calculateLongPlan = (context: HorizonPlanContext): HorizonExitPlan => {
  const values = context.long;
  const missing: string[] = [];
  if (!finitePositive(context.entryPrice)) missing.push("현재 진입가");
  if (!values) {
    missing.push("장기 일봉·주봉 분석");
  } else {
    if (!finitePositive(values.sma200)) missing.push("SMA200");
    if (!finitePositive(values.tenMonthAverage)) missing.push("10개월 이동평균");
    if (!finitePositive(values.weeklySma20)) missing.push("주봉 SMA20");
  }
  if (
    missing.length ||
    !values ||
    !finitePositive(values.sma200) ||
    !finitePositive(values.tenMonthAverage) ||
    !finitePositive(values.weeklySma20)
  ) {
    return unavailablePlan({
      context,
      horizon: "long",
      trigger: "monthly-close",
      timeframeLabel: "일봉 추세 · 주봉 확인 · 월말 재검토",
      blockers: missing,
      basisValues: {
        sma200: values?.sma200 ?? null,
        tenMonthAverage: values?.tenMonthAverage ?? null,
        weeklySma20: values?.weeklySma20 ?? null,
        weeklySma60: values?.weeklySma60 ?? null,
      },
    });
  }

  const stopPrice = Math.max(values.sma200, values.tenMonthAverage);
  const risk = context.entryPrice - stopPrice;
  const currentPrice = context.currentPrice ?? context.entryPrice;
  const planMode = context.planMode ?? "new-entry";
  const reentryConfirmationPrice = Math.max(stopPrice, values.weeklySma20);
  if (!finitePositive(risk) && planMode === "new-entry") {
    return unavailablePlan({
      context,
      horizon: "long",
      trigger: "monthly-close",
      timeframeLabel: "일봉 추세 · 주봉 확인 · 월말 재검토",
      blockers: ["현재가가 장기 추세 무효선 위에 있지 않아 신규 장기 계획을 계산할 수 없습니다."],
      basisValues: {
        sma200: values.sma200,
        tenMonthAverage: values.tenMonthAverage,
        weeklySma20: values.weeklySma20,
        weeklySma60: values.weeklySma60,
      },
    });
  }
  const readinessBlockers = [
    contextIsStale(context, "long") ? "일봉 또는 주봉 데이터가 오래되었습니다." : null,
    !values.latestBarClosed ? "형성 중인 일봉·주봉은 장기 추세 확정에 사용하지 않습니다." : null,
    values.marketGatePassed === false ? "장기 종목 일봉 위험 게이트가 신규 진입을 허용하지 않습니다." : null,
    values.marketGatePassed === null ? "장기 종목 일봉 위험 게이트를 확인할 표본이 부족합니다." : null,
    !finitePositive(values.weeklySma60) ? "주봉 SMA60 표본이 부족해 장기 신규 진입 판단을 보류합니다." : null,
    finitePositive(values.weeklySma60) && values.weeklySma20 <= values.weeklySma60
      ? "주봉 SMA20이 SMA60 위에 있지 않습니다."
      : null,
    planMode === "new-entry" && values.weeklySma20 >= context.entryPrice
      ? "현재가가 주봉 SMA20 추적선 위에 있지 않습니다."
      : null,
  ].filter((value): value is string => value !== null);

  if (planMode === "position-management") {
    const invalidationBreached = currentPrice <= stopPrice;
    const managementState: HorizonManagementState = {
      state: invalidationBreached
        ? "invalidation-breached"
        : currentPrice < reentryConfirmationPrice
          ? "recovery-watch"
          : "active",
      currentPrice,
      averagePrice: context.entryPrice,
      invalidationPrice: stopPrice,
      reentryConfirmationPrice,
      actions: invalidationBreached
        ? [
          "신규 매수를 중단합니다.",
          "보유 비중 축소 또는 청산을 수동으로 검토합니다.",
          "월말 종가가 재진입 확인선을 회복하고 주봉 추세가 확인될 때까지 재진입을 보류합니다.",
        ]
        : [
          "월말 종가의 장기 무효선 이탈 여부를 감시합니다.",
          "유효한 기존 2R·4R 목표와 주봉 SMA20 추적 기준을 유지합니다.",
        ],
    };
    const blockers = [
      ...readinessBlockers,
      invalidationBreached ? "현재가가 장기 무효선을 이탈해 보유관리 상태로 전환했습니다." : null,
      !finitePositive(risk) ? "보유 평단이 장기 무효선 위에 있지 않아 R 기반 익절 목표를 계산하지 않았습니다." : null,
    ].filter((value): value is string => value !== null);
    return {
      horizon: "long",
      status: blockers.length ? "wait" : "actionable",
      planMode,
      currentPrice,
      managementState,
      entryPrice: context.entryPrice,
      stop: {
        price: stopPrice,
        trigger: "monthly-close",
        isBrokerStopEligible: false,
        reason: "SMA200과 10개월 이동평균 중 높은 값을 월말 종가 기준 위험 재검토선으로 사용합니다.",
      },
      takeProfits: finitePositive(risk)
        ? [
          { price: context.entryPrice + risk * 2, allocationPct: 20, basis: "기존 평단 기준 2R 비중 조절" },
          { price: context.entryPrice + risk * 4, allocationPct: 20, basis: "기존 평단 기준 4R 비중 조절" },
        ]
        : [],
      trailingExit: {
        price: values.weeklySma20,
        allocationPct: 60,
        basis: "주봉 SMA20 추세와 투자 가설 재검토",
      },
      riskPerShare: finitePositive(risk) ? risk : null,
      stopPct: finitePositive(risk) ? stopPercent(context.entryPrice, stopPrice) : null,
      rewardRisk: finitePositive(risk) ? 4 : null,
      basis: baseBasis(context, "long", "보유 평단 · 일봉 추세 · 주봉 확인 · 월말 재검토", {
        sma200: values.sma200,
        tenMonthAverage: values.tenMonthAverage,
        weeklySma20: values.weeklySma20,
        weeklySma60: values.weeklySma60,
      }),
      formulaSteps: finitePositive(risk)
        ? [
          "stop = max(SMA200, tenMonthAverage)",
          "R = averagePrice - stop",
          "takeProfit1 = averagePrice + 2R, takeProfit2 = averagePrice + 4R",
          "reentryConfirmation = max(stop, weeklySMA20)",
        ]
        : [
          "invalidation = max(SMA200, tenMonthAverage)",
          "reentryConfirmation = max(invalidation, weeklySMA20)",
        ],
      reasons: ["현재가와 보유 평단을 분리해 신규 진입이 아닌 보유관리 상태를 계산했습니다."],
      blockers,
    };
  }

  const blockers = readinessBlockers;

  return {
    horizon: "long",
    status: blockers.length ? "wait" : "actionable",
    ...planIdentity(context),
    entryPrice: context.entryPrice,
    stop: {
      price: stopPrice,
      trigger: "monthly-close",
      isBrokerStopEligible: false,
      reason: "SMA200과 10개월 이동평균 중 높은 값을 월말 종가 기준 위험 재검토선으로 사용합니다.",
    },
    takeProfits: [
      { price: context.entryPrice + risk * 2, allocationPct: 20, basis: "2R 비중 조절" },
      { price: context.entryPrice + risk * 4, allocationPct: 20, basis: "4R 비중 조절" },
    ],
    trailingExit: {
      price: values.weeklySma20,
      allocationPct: 60,
      basis: "주봉 SMA20 추세와 투자 가설 재검토",
    },
    riskPerShare: risk,
    stopPct: stopPercent(context.entryPrice, stopPrice),
    rewardRisk: 4,
    basis: baseBasis(context, "long", "일봉 추세 · 주봉 확인 · 월말 재검토", {
      sma200: values.sma200,
      tenMonthAverage: values.tenMonthAverage,
      weeklySma20: values.weeklySma20,
      weeklySma60: values.weeklySma60,
    }),
    formulaSteps: [
      "stop = max(SMA200, tenMonthAverage)",
      "R = entry - stop",
      "takeProfit1 = entry + 2R, takeProfit2 = entry + 4R",
      "trailingExit = weeklySMA20",
    ],
    reasons: ["장기 가격선은 일반 stop 주문이 아니라 월말 종가와 투자 가설 재검토 기준입니다."],
    blockers,
  };
};

export const calculateHorizonExitPlans = (context: HorizonPlanContext): HorizonExitPlan[] => [
  calculateDayPlan(context),
  calculateSwingPlan(context),
  calculateLongPlan(context),
];
