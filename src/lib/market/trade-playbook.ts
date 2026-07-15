import type {
  TradePlanGate,
  TradePlanHorizon,
  TradePlaybookId,
  TradePlaybookPlan,
  TradeRiskPlan,
  TradeSignalEvent,
  TradeSignalSet,
} from "@/domain/market-playbook";
import type { CrashReversalSignal } from "@/lib/market/crash-reversal-signal";
import type { HorizonExitPlan } from "@/lib/market/horizon-exit-plans";
import {
  resolvePlaybookCalibration,
  type PlaybookCalibrationRegistry,
  type ResolvedPlaybookCalibration,
} from "@/lib/market/playbook-calibrations";

type JsonObject = Record<string, unknown>;

export type TradePlaybookAnalysis = JsonObject & {
  candles?: unknown[];
  stale?: boolean;
  quoteAt?: string | null;
  signals?: unknown[];
  trendFollowing?: JsonObject;
  tradeSetup?: JsonObject;
  analysisBasis?: JsonObject;
};

export type TradePlaybookExternalGate = {
  status: "pass" | "weak" | "unavailable";
  label: string;
  reason: string;
  source: string;
  asOf: string | null;
  dataAgeSeconds?: number | null;
};

export type BuildTradeSignalSetInput = {
  market: string;
  generatedAt: string;
  oneHour: TradePlaybookAnalysis;
  daily: TradePlaybookAnalysis;
  horizonPlans: HorizonExitPlan[];
  externalContext?: {
    market?: TradePlaybookExternalGate | null;
    sector?: TradePlaybookExternalGate | null;
    leader50?: TradePlaybookExternalGate | null;
  };
  calibrationRegistry?: PlaybookCalibrationRegistry;
};

const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;

const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

const gate = ({
  kind,
  status,
  label,
  reason,
  source = null,
  asOf = null,
  dataAgeSeconds = null,
  blocking = status === "fail" || status === "unavailable",
}: Omit<TradePlanGate, "blocking" | "source" | "asOf" | "dataAgeSeconds"> & Partial<Pick<
  TradePlanGate,
  "blocking" | "source" | "asOf" | "dataAgeSeconds"
>>): TradePlanGate => ({
  kind,
  status,
  blocking,
  label,
  reason,
  source,
  asOf,
  dataAgeSeconds,
});

const missingGate = (
  kind: TradePlanGate["kind"],
  label: string,
  reason: string,
): TradePlanGate => gate({ kind, status: "unavailable", label, reason });

const emptyRiskPlan = (): TradeRiskPlan => ({
  entryPrice: null,
  structureInvalidationPrice: null,
  riskPerShare: null,
  riskPct: null,
  riskStatus: "unavailable",
  stopTrigger: null,
  targets: [],
  trailingExit: null,
  timeStopBars: null,
  isBrokerStopEligible: false,
  orderSubmissionAttempted: false,
});

const getLatestCandleTime = (analysis: TradePlaybookAnalysis) => {
  if (!Array.isArray(analysis.candles)) return null;
  const candle = asObject(analysis.candles.at(-1));
  return asNumber(candle?.closeTime) ?? asNumber(candle?.time);
};

const eventFromSignal = (
  value: unknown,
  fallbackInvalidationPrice: number | null,
  candleCloseByTime: ReadonlyMap<number, number> = new Map(),
): TradeSignalEvent | null => {
  const signal = asObject(value);
  const time = asNumber(signal?.time);
  const occurredAt = asNumber(signal?.occurredAt) ?? time;
  const confirmedAt = asNumber(signal?.confirmedAt) ??
    (time === null ? null : candleCloseByTime.get(time) ?? time);
  const type = asText(signal?.type);
  const action = asText(signal?.action);
  const label = asText(signal?.label);
  if (occurredAt === null || confirmedAt === null || !label) return null;
  return {
    occurredAt,
    confirmedAt,
    role: action === "setup" || /\bwatch\b/i.test(label)
      ? "setup"
      : action === "management-warning"
        ? "warning"
        : action === "trend-exit" || type === "sell"
          ? "exit"
          : "trigger",
    side: type === "buy" ? "buy" : type === "sell" ? "sell" : "neutral",
    label,
    reason: asText(signal?.reason) ?? "기존 분석 신호에서 변환했습니다.",
    price: asNumber(signal?.price) ?? asNumber(signal?.entryPrice),
    structureInvalidationPrice:
      asNumber(signal?.initialStop) ??
      asNumber(signal?.stopLevel) ??
      fallbackInvalidationPrice,
  };
};

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const eventIdentity = (event: TradeSignalEvent) => JSON.stringify([
  event.occurredAt,
  event.confirmedAt,
  event.role,
  event.side,
  event.label,
]);

const mergeDuplicateEvents = (events: TradeSignalEvent[]): TradeSignalEvent => {
  const first = events[0];
  const reasons = [...new Set(events.map((event) => event.reason))]
    .toSorted((left, right) => right.length - left.length || compareText(left, right));
  const prices = events
    .map((event) => event.price)
    .filter((value): value is number => value !== null)
    .toSorted((left, right) => left - right);
  const invalidationPrices = events
    .map((event) => event.structureInvalidationPrice)
    .filter((value): value is number => value !== null)
    .toSorted((left, right) => left - right);
  return {
    ...first,
    reason: reasons[0] ?? first.reason,
    price: prices[0] ?? null,
    structureInvalidationPrice: invalidationPrices[0] ?? null,
  };
};

const candleCloseByTimeFor = (analysis: TradePlaybookAnalysis) => new Map(
  (Array.isArray(analysis.candles) ? analysis.candles : [])
    .map(asObject)
    .flatMap((candle): Array<[number, number]> => {
      const time = asNumber(candle?.time);
      const closeTime = asNumber(candle?.closeTime);
      return time !== null && closeTime !== null && closeTime >= time
        ? [[time, closeTime]]
        : [];
    }),
);

export const buildTradeSignalEvents = (
  analysis: TradePlaybookAnalysis,
): TradeSignalEvent[] => {
  const fallbackInvalidationPrice = asNumber(asObject(analysis.tradeSetup)?.failureLevel);
  const candleCloseByTime = candleCloseByTimeFor(analysis);
  const legacySignals = Array.isArray(analysis.signals) ? analysis.signals : [];
  const trendSignals = Array.isArray(asObject(analysis.trendFollowing)?.signals)
    ? asObject(analysis.trendFollowing)?.signals as unknown[]
    : [];
  const groups = new Map<string, TradeSignalEvent[]>();

  for (const rawSignal of [...legacySignals, ...trendSignals]) {
    const event = eventFromSignal(rawSignal, null, candleCloseByTime);
    if (!event) continue;
    const key = eventIdentity(event);
    const group = groups.get(key);
    if (group) {
      group.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  return [...groups.values()]
    .map(mergeDuplicateEvents)
    .map((event) => ({
      ...event,
      structureInvalidationPrice: event.structureInvalidationPrice ?? fallbackInvalidationPrice,
    }))
    .toSorted((left, right) =>
      left.confirmedAt - right.confirmedAt ||
      left.occurredAt - right.occurredAt ||
      compareText(left.role, right.role) ||
      compareText(left.side, right.side) ||
      compareText(left.label, right.label));
};

const latestSignalEvent = (
  analysis: TradePlaybookAnalysis,
  predicate: (signal: JsonObject) => boolean,
  fallbackInvalidationPrice: number | null,
) => {
  if (!Array.isArray(analysis.signals)) return null;
  const signal = analysis.signals
    .map(asObject)
    .filter((item): item is JsonObject => item !== null && predicate(item))
    .toSorted((left, right) => (asNumber(right.confirmedAt) ?? asNumber(right.time) ?? 0) -
      (asNumber(left.confirmedAt) ?? asNumber(left.time) ?? 0))[0];
  return eventFromSignal(
    signal,
    fallbackInvalidationPrice,
    candleCloseByTimeFor(analysis),
  );
};

const latestTrendEvent = (
  analysis: TradePlaybookAnalysis,
  fallbackInvalidationPrice: number | null,
) => {
  const trend = asObject(analysis.trendFollowing);
  const signals = Array.isArray(trend?.signals) ? trend.signals : null;
  if (!signals) return null;
  const signal = signals
    .map(asObject)
    .filter((item): item is JsonObject => item !== null)
    .toSorted((left, right) => (asNumber(right.time) ?? 0) - (asNumber(left.time) ?? 0))[0];
  return eventFromSignal(
    signal,
    fallbackInvalidationPrice,
    candleCloseByTimeFor(analysis),
  );
};

const latestTrendEntryEvent = (
  analysis: TradePlaybookAnalysis,
  fallbackInvalidationPrice: number | null,
) => {
  const trend = asObject(analysis.trendFollowing);
  const signals = Array.isArray(trend?.signals) ? trend.signals : null;
  if (!signals) return null;
  const signal = signals
    .map(asObject)
    .filter((item): item is JsonObject =>
      item !== null &&
      asText(item.type) === "buy" &&
      (asText(item.action) === "entry" || asText(item.action) === "breakout-entry"))
    .toSorted((left, right) =>
      (asNumber(right.confirmedAt) ?? asNumber(right.time) ?? 0) -
      (asNumber(left.confirmedAt) ?? asNumber(left.time) ?? 0))[0];
  const event = eventFromSignal(
    signal,
    fallbackInvalidationPrice,
    candleCloseByTimeFor(analysis),
  );
  return event && signal
    ? { event, action: asText(signal.action), label: asText(signal.label) }
    : null;
};

const externalGates = (
  externalContext: BuildTradeSignalSetInput["externalContext"],
): [TradePlanGate, TradePlanGate] => {
  const market = externalContext?.market ?? null;
  const sector = externalContext?.sector ?? null;
  if (!market || market.status === "unavailable" || !sector || sector.status === "unavailable") {
    return [
      market && market.status !== "unavailable"
        ? gate({
            kind: "market",
            status: market.status === "weak" ? "warning" : "pass",
            blocking: false,
            label: market.label,
            reason: market.reason,
            source: market.source,
            asOf: market.asOf,
            dataAgeSeconds: market.dataAgeSeconds ?? null,
          })
        : market
          ? gate({
              kind: "market",
              status: "unavailable",
              label: market.label,
              reason: market.reason,
              source: market.source,
              asOf: market.asOf,
              dataAgeSeconds: market.dataAgeSeconds ?? null,
            })
          : missingGate("market", "시장 breadth 확인 불가", "실제 시장 breadth snapshot이 연결되지 않았습니다."),
      sector && sector.status !== "unavailable"
        ? gate({
            kind: "sector",
            status: sector.status === "weak" ? "warning" : "pass",
            blocking: false,
            label: sector.label,
            reason: sector.reason,
            source: sector.source,
            asOf: sector.asOf,
            dataAgeSeconds: sector.dataAgeSeconds ?? null,
          })
        : sector
          ? gate({
              kind: "sector",
              status: "unavailable",
              label: sector.label,
              reason: sector.reason,
              source: sector.source,
              asOf: sector.asOf,
              dataAgeSeconds: sector.dataAgeSeconds ?? null,
            })
          : missingGate("sector", "섹터 상대강도 확인 불가", "종목-섹터 매핑 또는 섹터 상대강도 snapshot이 연결되지 않았습니다."),
    ];
  }

  const bothWeak = market.status === "weak" && sector.status === "weak";
  const makeGate = (
    kind: "market" | "sector",
    value: TradePlaybookExternalGate,
  ) => gate({
    kind,
    status: value.status === "weak" ? (bothWeak ? "fail" : "warning") : "pass",
    blocking: bothWeak && value.status === "weak",
    label: value.label,
    reason: bothWeak && value.status === "weak"
      ? `${value.reason} 시장과 섹터가 모두 약해 신규 진입을 차단합니다.`
      : value.reason,
    source: value.source,
    asOf: value.asOf,
    dataAgeSeconds: value.dataAgeSeconds ?? null,
  });

  return [makeGate("market", market), makeGate("sector", sector)];
};

const leader50Gate = (
  externalContext: BuildTradeSignalSetInput["externalContext"],
): TradePlanGate => {
  const leader = externalContext?.leader50 ?? null;
  if (!leader) {
    return missingGate(
      "setup",
      "50일 leader 확인 불가",
      "종목의 point-in-time 50일 상대강도 순위가 연결되지 않았습니다.",
    );
  }
  if (leader.status === "unavailable") {
    return gate({
      kind: "setup",
      status: "unavailable",
      label: leader.label,
      reason: leader.reason,
      source: leader.source,
      asOf: leader.asOf,
      dataAgeSeconds: leader.dataAgeSeconds ?? null,
    });
  }
  return gate({
    kind: "setup",
    status: leader.status === "pass" ? "pass" : "fail",
    blocking: leader.status !== "pass",
    label: leader.label,
    reason: leader.reason,
    source: leader.source,
    asOf: leader.asOf,
    dataAgeSeconds: leader.dataAgeSeconds ?? null,
  });
};

const dataGate = ({
  market,
  analysis,
  horizonPlan,
  label,
}: {
  market: string;
  analysis: TradePlaybookAnalysis | null;
  horizonPlan: HorizonExitPlan | null;
  label: string;
}) => {
  if (market !== "US" && market !== "KOSPI" && market !== "KOSDAQ") {
    return missingGate("data", label, "이 계약은 한국·미국 주식 플레이북만 지원합니다.");
  }
  if (!analysis || !horizonPlan || horizonPlan.status === "unavailable") {
    return missingGate("data", label, "플레이북 계산에 필요한 확정 봉 또는 horizon plan이 부족합니다.");
  }
  if (asBoolean(analysis.stale) === true) {
    return gate({
      kind: "data",
      status: "fail",
      label,
      reason: "확정 봉이 오래되어 신규 진입 계산을 차단합니다.",
      source: "market-workspace",
      asOf: asText(analysis.quoteAt),
    });
  }
  return gate({
    kind: "data",
    status: "pass",
    label,
    reason: "필요한 확정 봉과 기존 horizon plan을 확인했습니다.",
    source: "market-workspace",
    asOf: asText(analysis.quoteAt),
  });
};

const liquidityGate = (
  analysis: TradePlaybookAnalysis,
  label: string,
) => {
  const ratio = asNumber(asObject(analysis.analysisBasis)?.volumeRatio20);
  if (ratio === null) {
    return missingGate("liquidity", label, "20봉 거래량 배율을 계산할 데이터가 없습니다.");
  }
  return gate({
    kind: "liquidity",
    status: ratio >= 1 ? "pass" : "fail",
    label,
    reason: `최근 거래량은 20봉 평균 대비 ${ratio.toFixed(2)}배입니다.`,
    source: "analysisBasis.volumeRatio20",
    asOf: asText(analysis.quoteAt),
  });
};

const riskPlanFromHorizon = (
  plan: HorizonExitPlan | null,
  atr: number | null,
  policy: { minimumAtr: number; maximumAtr: number },
  timeStopBars: number | null,
): TradeRiskPlan => {
  if (!plan) return emptyRiskPlan();
  const entryPrice = asNumber(plan.entryPrice);
  const stopPrice = asNumber(plan.stop.price);
  if (entryPrice === null || stopPrice === null || stopPrice >= entryPrice) {
    return {
      ...emptyRiskPlan(),
      entryPrice,
      structureInvalidationPrice: stopPrice,
      timeStopBars,
    };
  }
  const riskPerShare = entryPrice - stopPrice;
  const riskStatus = atr === null
    ? "unavailable" as const
    : riskPerShare < atr * policy.minimumAtr || riskPerShare > atr * policy.maximumAtr
      ? "outside-policy" as const
      : "valid" as const;
  const trigger = plan.stop.trigger === "hourly-close" || plan.stop.trigger === "daily-close"
    ? plan.stop.trigger
    : null;
  return {
    entryPrice,
    structureInvalidationPrice: stopPrice,
    riskPerShare,
    riskPct: riskPerShare / entryPrice * 100,
    riskStatus,
    stopTrigger: trigger,
    targets: plan.takeProfits
      .filter((target) => Number.isFinite(target.price) && target.price > entryPrice)
      .map((target) => ({
        price: target.price,
        allocationPct: target.allocationPct,
        basis: target.basis,
      })),
    trailingExit: plan.trailingExit && asNumber(plan.trailingExit.price) !== null
      ? {
          price: plan.trailingExit.price!,
          allocationPct: plan.trailingExit.allocationPct,
          basis: plan.trailingExit.basis,
        }
      : null,
    timeStopBars,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
};

const trendRiskPlan = (
  daily: TradePlaybookAnalysis,
  fallback: TradeRiskPlan,
): TradeRiskPlan => {
  const activeSetup = asObject(asObject(daily.trendFollowing)?.activeSetup);
  const entryPrice = asNumber(activeSetup?.entryPrice);
  const stopPrice = asNumber(activeSetup?.initialStop);
  const target = asNumber(activeSetup?.partialTakeProfitLevel);
  const trail = asNumber(activeSetup?.trendExitLevel);
  const atr = asNumber(asObject(daily.analysisBasis)?.atr14);
  if (entryPrice === null || stopPrice === null || stopPrice >= entryPrice) return fallback;
  const riskPerShare = entryPrice - stopPrice;
  return {
    entryPrice,
    structureInvalidationPrice: stopPrice,
    riskPerShare,
    riskPct: riskPerShare / entryPrice * 100,
    riskStatus: atr === null
      ? "unavailable"
      : riskPerShare < atr * 1.5 || riskPerShare > atr * 2.5
        ? "outside-policy"
        : "valid",
    stopTrigger: "daily-close",
    targets: target !== null && target > entryPrice
      ? [{ price: target, allocationPct: 25, basis: "기존 추세 분석의 2R 검토 구간" }]
      : [],
    trailingExit: trail !== null
      ? { price: trail, allocationPct: 75, basis: "기존 추세 분석의 SMA50 단일 추적선" }
      : null,
    timeStopBars: null,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
};

const riskGate = (riskPlan: TradeRiskPlan): TradePlanGate => {
  if (riskPlan.riskStatus === "unavailable") {
    return missingGate("risk", "구조 손절 확인 불가", "구조 무효선 또는 ATR 위험폭을 확인할 수 없습니다.");
  }
  if (riskPlan.riskStatus === "outside-policy") {
    return gate({
      kind: "risk",
      status: "fail",
      label: "허용 위험폭 초과",
      reason: "구조 손절선을 안쪽으로 이동하지 않고 진입을 보류합니다.",
      source: "structure-stop",
    });
  }
  return gate({
    kind: "risk",
    status: "pass",
    label: "구조 손절 유효",
    reason: "구조 무효선이 플레이북 ATR 위험폭 안에 있습니다.",
    source: "structure-stop",
  });
};

const rewardGate = (riskPlan: TradeRiskPlan): TradePlanGate => {
  if (
    riskPlan.entryPrice === null ||
    riskPlan.riskPerShare === null ||
    riskPlan.riskPerShare <= 0 ||
    !riskPlan.targets.length
  ) {
    return missingGate("reward", "보상비 확인 불가", "유효한 진입가·R·익절 후보가 없습니다.");
  }
  const maximumR = Math.max(
    ...riskPlan.targets.map((target) => (target.price - riskPlan.entryPrice!) / riskPlan.riskPerShare!),
  );
  return gate({
    kind: "reward",
    status: maximumR >= 1 ? "pass" : "fail",
    label: `최대 ${maximumR.toFixed(2)}R`,
    reason: maximumR >= 1
      ? "현재 익절 후보가 최소 1R 보상 조건을 충족합니다."
      : "현재 익절 후보가 최소 1R 보상 조건을 충족하지 않습니다.",
    source: "horizon-plan",
  });
};

const deriveAction = (
  gates: TradePlanGate[],
  calibration: ResolvedPlaybookCalibration,
): TradePlaybookPlan["action"] => {
  if (gates.some((item) => item.blocking && item.status === "unavailable")) return "unavailable";
  if (gates.some((item) => item.blocking && item.status === "fail")) return "wait";
  return calibration.reviewed ? "entry-ready" : "watch";
};

const buildPlan = ({
  id,
  horizon,
  marketScope,
  label,
  setupVariant,
  events,
  gates,
  riskPlan,
  calibration,
  reasons,
}: {
  id: TradePlaybookId;
  horizon: TradePlanHorizon;
  marketScope: TradePlaybookPlan["marketScope"];
  label: string;
  setupVariant: string | null;
  events: TradeSignalEvent[];
  gates: TradePlanGate[];
  riskPlan: TradeRiskPlan;
  calibration: ResolvedPlaybookCalibration;
  reasons: string[];
}): TradePlaybookPlan => ({
  id,
  horizon,
  marketScope,
  label,
  stage: calibration.stage,
  action: deriveAction(gates, calibration),
  setupVariant,
  events,
  gates,
  riskPlan,
  calibration: calibration.calibration,
  blockers: gates
    .filter((item) => item.blocking && (item.status === "fail" || item.status === "unavailable"))
    .map((item) => item.reason),
  reasons,
  isBrokerStopEligible: false,
  orderSubmissionAttempted: false,
});

export type BuildCrashReversalTradePlanOptions = {
  externalContext?: BuildTradeSignalSetInput["externalContext"];
  calibrationRegistry?: PlaybookCalibrationRegistry;
};

const crashSignalAsOf = (signal: CrashReversalSignal, generatedAt: string) => {
  if (signal.quoteAt === null || !Number.isFinite(signal.quoteAt)) return generatedAt;
  return new Date(signal.quoteAt * 1_000).toISOString();
};

const crashRiskPlan = (signal: CrashReversalSignal): TradeRiskPlan => {
  const exit = signal.exitPlan;
  if (!exit) return emptyRiskPlan();
  const riskOutsidePolicy = signal.stage === "insufficient-reward" &&
    signal.blockers.some((blocker) => blocker.includes("손절 거리") || blocker.includes("ATR"));
  return {
    entryPrice: exit.entryPrice,
    structureInvalidationPrice: exit.stopPrice,
    riskPerShare: exit.riskPerShare,
    riskPct: exit.riskPerShare / exit.entryPrice * 100,
    riskStatus: riskOutsidePolicy ? "outside-policy" : "valid",
    stopTrigger: "intrabar",
    targets: [
      {
        price: exit.firstTakeProfit,
        allocationPct: exit.firstAllocationPct,
        basis: exit.firstTargetBasis === "near-resistance" ? "가까운 저항" : "1R",
      },
      {
        price: exit.secondTakeProfit,
        allocationPct: exit.secondAllocationPct,
        basis: "2R",
      },
    ],
    trailingExit: null,
    timeStopBars: 6,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
};

export const buildCrashReversalTradePlan = (
  signal: CrashReversalSignal,
  generatedAt: string,
  options: BuildCrashReversalTradePlanOptions = {},
): TradePlaybookPlan => {
  const asOf = crashSignalAsOf(signal, generatedAt);
  const [marketGate, sectorGate] = externalGates(options.externalContext);
  const riskPlan = crashRiskPlan(signal);
  const panicDetected = signal.panicAt !== null;
  const confirmed = signal.confirmationAt !== null;
  const event: TradeSignalEvent | null = confirmed
    ? {
        occurredAt: signal.panicAt ?? signal.confirmationAt!,
        confirmedAt: signal.confirmationAt!,
        role: "trigger",
        side: "buy",
        label: signal.label,
        reason: signal.detail,
        price: signal.exitPlan?.entryPrice ?? null,
        structureInvalidationPrice: signal.exitPlan?.stopPrice ?? null,
      }
    : panicDetected
      ? {
          occurredAt: signal.panicAt!,
          confirmedAt: signal.panicAt! + 5 * 60,
          role: "setup",
          side: "neutral",
          label: signal.label,
          reason: signal.detail,
          price: null,
          structureInvalidationPrice: signal.exitPlan?.stopPrice ?? null,
        }
      : null;
  const data = signal.stage === "unavailable" || signal.quoteAt === null
    ? missingGate("data", "급락반전 데이터 확인 불가", signal.blockers.join(" ") || "확정 5분봉 데이터가 부족합니다.")
    : gate({
        kind: "data",
        status: "pass",
        label: "확정 5분봉 급락반전 데이터",
        reason: "기존 급락반전 계산 결과와 quote 시각을 확인했습니다.",
        source: "crash-reversal-signal",
        asOf,
      });
  const setup = signal.stage === "unavailable"
    ? missingGate("setup", "급락 셋업 확인 불가", "급락 셋업 계산에 필요한 데이터가 부족합니다.")
    : panicDetected
      ? gate({
          kind: "setup",
          status: "pass",
          label: "ATR·거래량·과매도 급락 셋업",
          reason: signal.reasons[0] ?? signal.detail,
          source: "crash-reversal-signal.panicAt",
          asOf,
        })
      : gate({
          kind: "setup",
          status: "fail",
          label: "급락 셋업 없음",
          reason: signal.blockers.join(" ") || signal.detail,
          source: "crash-reversal-signal",
          asOf,
        });
  const trigger = signal.stage === "unavailable"
    ? missingGate("trigger", "5분봉 reclaim 확인 불가", "반전 확인봉 데이터가 부족합니다.")
    : confirmed
      ? gate({
          kind: "trigger",
          status: "pass",
          label: "확정 5분봉 reclaim",
          reason: signal.detail,
          source: "crash-reversal-signal.confirmationAt",
          asOf,
        })
      : gate({
          kind: "trigger",
          status: "fail",
          label: "확정 5분봉 reclaim 대기",
          reason: signal.blockers.join(" ") || signal.detail,
          source: "crash-reversal-signal",
          asOf,
        });
  const requiredVolumeRatio = confirmed ? 1.2 : 2;
  const liquidity = signal.volumeRatio === null
    ? missingGate("liquidity", "5분봉 거래량 확인 불가", "급락 또는 확인봉 거래량 배율이 없습니다.")
    : gate({
        kind: "liquidity",
        status: signal.volumeRatio >= requiredVolumeRatio ? "pass" : "fail",
        label: `5분봉 거래량 ${signal.volumeRatio.toFixed(2)}배`,
        reason: `현재 단계에는 최소 ${requiredVolumeRatio.toFixed(1)}배 거래량이 필요합니다.`,
        source: "crash-reversal-signal.volumeRatio",
        asOf,
      });
  const rewardBlocked = signal.stage === "insufficient-reward" &&
    signal.blockers.some((blocker) => blocker.includes("보상"));
  const reward = rewardBlocked
    ? gate({
        kind: "reward",
        status: "fail",
        label: "가까운 저항 보상 부족",
        reason: signal.blockers.find((blocker) => blocker.includes("보상")) ?? "최소 보상 조건을 충족하지 않습니다.",
        source: "crash-reversal-signal",
        asOf,
      })
    : rewardGate(riskPlan);
  const calibration = resolvePlaybookCalibration(
    options.calibrationRegistry,
    "kr-intraday-crash-reversal",
    "KR",
  );
  const plan = buildPlan({
    id: "kr-intraday-crash-reversal",
    horizon: "intraday",
    marketScope: ["KR"],
    label: "장중 급락반등",
    setupVariant: "panic-reclaim",
    events: event ? [event] : [],
    gates: [data, marketGate, sectorGate, setup, trigger, liquidity, riskGate(riskPlan), reward],
    riskPlan,
    calibration,
    reasons: [signal.detail, ...signal.reasons],
  });
  return {
    ...plan,
    blockers: [...new Set([...plan.blockers, ...signal.blockers])],
  };
};

const setupGateFromTradeSetup = (analysis: TradePlaybookAnalysis) => {
  const setupType = asText(asObject(analysis.tradeSetup)?.type);
  if (!setupType) {
    return missingGate("setup", "단기 셋업 확인 불가", "1시간봉 tradeSetup 유형이 없습니다.");
  }
  const accepted = setupType === "breakout" || setupType === "pullback" || setupType === "reclaim";
  return gate({
    kind: "setup",
    status: accepted ? "pass" : "fail",
    label: `1시간봉 ${setupType}`,
    reason: accepted
      ? "breakout 또는 pullback/reclaim 단기 셋업을 확인했습니다."
      : "현재 tradeSetup은 신규 단기 진입 셋업이 아닙니다.",
    source: "tradeSetup.type",
    asOf: asText(analysis.quoteAt),
  });
};

const shortHoldTriggerGate = ({
  analysis,
  plan,
  entry,
}: {
  analysis: TradePlaybookAnalysis;
  plan: HorizonExitPlan | null;
  entry: ReturnType<typeof latestTrendEntryEvent>;
}) => {
  if (!plan || plan.status === "unavailable") {
    return missingGate("trigger", "단기 트리거 확인 불가", "확정 1시간봉 horizon plan이 없습니다.");
  }
  const latestTime = getLatestCandleTime(analysis);
  const setupType = asText(asObject(analysis.tradeSetup)?.type);
  const isCurrent = entry !== null && latestTime !== null && entry.event.confirmedAt === latestTime;
  const isBreakout = entry?.action === "breakout-entry";
  const isPullbackReclaim = entry?.action === "entry" && setupType === "reclaim";
  const confirmedStructure = isBreakout || isPullbackReclaim;
  const passed = plan.status === "actionable" && isCurrent && confirmedStructure;
  return gate({
    kind: "trigger",
    status: passed ? "pass" : "fail",
    label: passed
      ? isBreakout
        ? "확정 1시간봉 breakout"
        : "확정 1시간봉 pullback-reclaim"
      : "1시간봉 구조 트리거 대기",
    reason: passed
      ? `${entry?.label ?? "진입 이벤트"}가 최신 확정 1시간봉에서 확인되었습니다.`
      : plan.status !== "actionable"
        ? plan.blockers.join(" ") || "1시간봉 horizon plan이 아직 진입 가능 상태가 아닙니다."
        : !isCurrent
          ? "최신 확정 1시간봉의 매수 진입 이벤트가 없습니다."
          : "pullback 단독은 진입 트리거가 아니며 breakout 또는 reclaim 확인이 필요합니다.",
    source: "trendFollowing.signals+horizonPlans.day",
    asOf: asText(analysis.quoteAt),
  });
};

const signalSetupGates = ({
  analysis,
  event,
  setupLabel,
  source,
}: {
  analysis: TradePlaybookAnalysis;
  event: TradeSignalEvent | null;
  setupLabel: string;
  source: string;
}): [TradePlanGate, TradePlanGate] => {
  const signalsAvailable = Array.isArray(analysis.signals) || Array.isArray(asObject(analysis.trendFollowing)?.signals);
  if (!signalsAvailable) {
    return [
      missingGate("setup", `${setupLabel} 확인 불가`, "기존 분석에 신호 배열이 없습니다."),
      missingGate("trigger", `${setupLabel} 트리거 확인 불가`, "확정 신호 이벤트를 확인할 수 없습니다."),
    ];
  }
  if (!event || event.side !== "buy") {
    return [
      gate({
        kind: "setup",
        status: "fail",
        label: `${setupLabel} 없음`,
        reason: "현재 분석 구간에 유효한 매수 셋업이 없습니다.",
        source,
      }),
      gate({
        kind: "trigger",
        status: "fail",
        label: `${setupLabel} 트리거 없음`,
        reason: "확정 매수 트리거가 없습니다.",
        source,
      }),
    ];
  }
  const latestTime = getLatestCandleTime(analysis);
  const currentTrigger = latestTime !== null && event.confirmedAt === latestTime;
  return [
    gate({
      kind: "setup",
      status: "pass",
      label: setupLabel,
      reason: event.reason,
      source,
    }),
    gate({
      kind: "trigger",
      status: currentTrigger ? "pass" : "fail",
      label: currentTrigger ? "최신 확정봉 트리거" : "과거 트리거",
      reason: currentTrigger
        ? "최신 확정봉에서 매수 트리거를 확인했습니다."
        : "셋업은 존재하지만 최신 확정봉의 신규 트리거가 아닙니다.",
      source,
    }),
  ];
};

const isCandidate = (plan: TradePlaybookPlan) =>
  plan.action === "watch" || plan.action === "entry-ready";

export const buildTradeSignalSet = ({
  market,
  generatedAt,
  oneHour,
  daily,
  horizonPlans,
  externalContext,
  calibrationRegistry,
}: BuildTradeSignalSetInput): TradeSignalSet => {
  const dayPlan = horizonPlans.find((plan) => plan.horizon === "day") ?? null;
  const swingPlan = horizonPlans.find((plan) => plan.horizon === "swing") ?? null;
  const marketScope = market === "US" ? ["US"] as const : ["KR"] as const;
  const calibrationMarket = market === "US" ? "US" as const : "KR" as const;
  const calibrationFor = (playbookId: TradePlaybookId) =>
    resolvePlaybookCalibration(calibrationRegistry, playbookId, calibrationMarket);
  const [marketGate, sectorGate] = externalGates(externalContext);
  const commonExternalGates = () => [marketGate, sectorGate].map((item) => ({ ...item }));
  const swingTrendLeaderGate = leader50Gate(externalContext);
  const oneHourAtr = asNumber(asObject(oneHour.analysisBasis)?.atr14);
  const dailyAtr = asNumber(asObject(daily.analysisBasis)?.atr14);

  const intradayPlan = buildPlan({
    id: "kr-intraday-crash-reversal",
    horizon: "intraday",
    marketScope: ["KR"],
    label: "장중 급락반등",
    setupVariant: null,
    events: [],
    gates: [
      missingGate("data", "5분봉 데이터 확인 불가", "workspace에는 동일 시간대 RVOL을 포함한 한국 정규장 5분봉이 없습니다."),
      ...commonExternalGates(),
      missingGate("setup", "급락 셋업 확인 불가", "장중 급락반전 watcher 결과가 workspace에 연결되지 않았습니다."),
      missingGate("trigger", "5분봉 reclaim 확인 불가", "확정 5분봉 midpoint/VWAP reclaim 이벤트가 없습니다."),
      missingGate("liquidity", "동일 시간대 RVOL 확인 불가", "직전 20거래일 동일 5분 bucket 기준이 없습니다."),
      missingGate("risk", "panic 저점 확인 불가", "장중 구조 무효선이 없습니다."),
      missingGate("reward", "장중 보상비 확인 불가", "장중 진입가와 구조 무효선이 없습니다."),
    ],
    riskPlan: emptyRiskPlan(),
    calibration: calibrationFor("kr-intraday-crash-reversal"),
    reasons: ["장중 watcher 계약이 연결될 때까지 이 플레이북은 shadow unavailable입니다."],
  });

  const shortRisk = riskPlanFromHorizon(dayPlan, oneHourAtr, { minimumAtr: 0.8, maximumAtr: 1.8 }, 6);
  const shortEntry = latestTrendEntryEvent(oneHour, shortRisk.structureInvalidationPrice);
  const shortEvent = shortEntry?.event ?? null;
  const shortPlan = buildPlan({
    id: "short-hold-trend",
    horizon: "short-hold",
    marketScope: [...marketScope],
    label: "1~3일 단기 추세",
    setupVariant: asText(asObject(oneHour.tradeSetup)?.type),
    events: shortEvent ? [shortEvent] : [],
    gates: [
      dataGate({ market, analysis: oneHour, horizonPlan: dayPlan, label: "1시간봉·일봉 데이터" }),
      ...commonExternalGates(),
      setupGateFromTradeSetup(oneHour),
      shortHoldTriggerGate({ analysis: oneHour, plan: dayPlan, entry: shortEntry }),
      liquidityGate(oneHour, "1시간봉 거래량"),
      riskGate(shortRisk),
      rewardGate(shortRisk),
    ],
    riskPlan: shortRisk,
    calibration: calibrationFor("short-hold-trend"),
    reasons: ["일봉은 위험 필터로만 사용하고 확정 1시간봉에서 진입을 판단합니다."],
  });

  const meanRisk = riskPlanFromHorizon(swingPlan, dailyAtr, { minimumAtr: 1.5, maximumAtr: 2.5 }, null);
  const meanEvent = latestSignalEvent(
    daily,
    (signal) => asText(signal.type) === "buy" && asText(signal.label)?.includes("Swing Trap BUY") === true,
    meanRisk.structureInvalidationPrice,
  );
  const [legacyMeanSetupGate, meanTriggerGate] = signalSetupGates({
    analysis: daily,
    event: meanEvent,
    setupLabel: "Swing Trap 평균회귀",
    source: "signals.Swing Trap BUY",
  });
  const meanSignal = Array.isArray(daily.signals)
    ? daily.signals.map(asObject).findLast((signal) => signal !== null && asText(signal.label)?.includes("Swing Trap BUY") === true)
    : null;
  const meanProfile = asText(meanSignal?.profile);
  const meanSetupFamilies = new Set(
    (Array.isArray(meanSignal?.setupFamilies) ? meanSignal.setupFamilies : [])
      .map(asText)
      .filter((family): family is string => family !== null),
  );
  const meanSetupGate = !meanEvent
    ? legacyMeanSetupGate
    : meanProfile !== "base-panic" && meanProfile !== "growth-reset"
      ? missingGate(
          "setup",
          "평균회귀 profile 확인 불가",
          "base-panic과 growth-reset을 구분할 profile 근거가 없습니다.",
        )
      : !meanSetupFamilies.has("oscillator") || meanSetupFamilies.size < 3
        ? gate({
            kind: "setup",
            status: "fail",
            label: `${meanProfile} setup family 부족`,
            reason: "RSI·CCI·Stochastic·Williams %R은 하나의 oscillator family로만 계산하며 서로 다른 setup family가 3개 이상 필요합니다.",
            source: "signals.setupFamilies+profile",
            asOf: asText(daily.quoteAt),
          })
        : gate({
            kind: "setup",
            status: "pass",
            label: `${meanProfile} 독립 setup family ${meanSetupFamilies.size}개`,
            reason: "oscillator 중복 투표 없이 평균회귀 setup family를 확인했습니다.",
            source: "signals.setupFamilies+profile",
            asOf: asText(daily.quoteAt),
          });
  const meanPlan = buildPlan({
    id: "swing-mean-reversion",
    horizon: "swing",
    marketScope: [...marketScope],
    label: "스윙 평균회귀",
    setupVariant: meanProfile ?? (meanEvent ? "swing-trap" : null),
    events: meanEvent ? [meanEvent] : [],
    gates: [
      dataGate({ market, analysis: daily, horizonPlan: swingPlan, label: "일봉 평균회귀 데이터" }),
      ...commonExternalGates(),
      meanSetupGate,
      meanTriggerGate,
      liquidityGate(daily, "일봉 거래량"),
      riskGate(meanRisk),
      rewardGate(meanRisk),
    ],
    riskPlan: meanRisk,
    calibration: calibrationFor("swing-mean-reversion"),
    reasons: ["base-panic과 growth-reset은 신호 profile이 제공될 때 별도 setupVariant로 유지합니다."],
  });

  const fallbackTrendRisk = riskPlanFromHorizon(swingPlan, dailyAtr, { minimumAtr: 1.5, maximumAtr: 2.5 }, null);
  const swingTrendRisk = trendRiskPlan(daily, fallbackTrendRisk);
  const trendEvent = latestTrendEvent(daily, swingTrendRisk.structureInvalidationPrice);
  const [trendSetupGate, trendTriggerGate] = signalSetupGates({
    analysis: {
      ...daily,
      signals: Array.isArray(asObject(daily.trendFollowing)?.signals)
        ? asObject(daily.trendFollowing)?.signals as unknown[]
        : undefined,
    },
    event: trendEvent,
    setupLabel: "일봉 추세",
    source: "trendFollowing",
  });
  const swingTrendPlan = buildPlan({
    id: "swing-trend",
    horizon: "swing",
    marketScope: [...marketScope],
    label: "스윙 추세",
    setupVariant: asText(trendEvent?.label) ?? null,
    events: trendEvent ? [trendEvent] : [],
    gates: [
      dataGate({ market, analysis: daily, horizonPlan: swingPlan, label: "일봉 추세 데이터" }),
      ...commonExternalGates(),
      swingTrendLeaderGate,
      trendSetupGate,
      trendTriggerGate,
      liquidityGate(daily, "일봉 거래량"),
      riskGate(swingTrendRisk),
      rewardGate(swingTrendRisk),
    ],
    riskPlan: swingTrendRisk,
    calibration: calibrationFor("swing-trend"),
    reasons: ["2R은 전량 청산점이 아니라 25% 검토 구간이며 나머지는 단일 SMA50 추적선 후보입니다."],
  });

  const plans = [intradayPlan, shortPlan, meanPlan, swingTrendPlan];
  const swingCandidates = [meanPlan, swingTrendPlan].filter(isCandidate);
  const calibratedSwingCandidates = swingCandidates.filter(
    (plan) => plan.stage === "calibrated",
  );
  const activeSwingCandidates = calibratedSwingCandidates.length > 0
    ? calibratedSwingCandidates
    : swingCandidates;
  const conflicts = activeSwingCandidates.length > 1
    ? [{
        horizon: "swing" as const,
        playbookIds: activeSwingCandidates.map((plan) => plan.id),
        reason: "평균회귀와 추세 플레이북이 동시에 준비되어 자동 선택하지 않습니다.",
      }]
    : [];

  return {
    contractVersion: 2,
    generatedAt,
    stage: "shadow",
    plans,
    primaryByHorizon: {
      intraday: isCandidate(intradayPlan) ? intradayPlan.id : null,
      shortHold: isCandidate(shortPlan) ? shortPlan.id : null,
      swing: conflicts.length ? null : activeSwingCandidates[0]?.id ?? null,
    },
    conflicts,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
};
