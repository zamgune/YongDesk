import type { Currency, PortfolioDailyAction } from "@/domain/portfolio";
import type { BreakoutSignal } from "@/lib/market/pattern-signals";
import type { SignalReliability } from "@/lib/market/signal-reliability";
import type { TradeSetup } from "@/lib/market/trade-setup";

export type PortfolioDailyActionInput = {
  loading?: boolean;
  error?: string | null;
  marketCurrency: Currency;
  currentPrice: number | null;
  pnlPct: number | null;
  currencyMatched: boolean;
  levels: {
    sma5?: number | null;
    sma20?: number | null;
    primaryStop?: number | null;
    hardStop?: number | null;
    resistance?: number | null;
  };
  signalReliability?: SignalReliability | null;
  breakoutSignal?: BreakoutSignal | null;
  tradeSetup?: TradeSetup | null;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatCurrency = (value: number | null | undefined, currency: Currency) => {
  if (!isNumber(value)) {
    return "--";
  }
  return currency === "KRW"
    ? `${Math.round(value).toLocaleString()}원`
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const reliabilityLabel = (reliability?: SignalReliability | null) => {
  if (!reliability) {
    return "신호 신뢰도는 데이터 확보 후 표시합니다.";
  }
  const grade =
    reliability.grade === "high"
      ? "높음"
      : reliability.grade === "medium"
        ? "보통"
        : reliability.grade === "low"
          ? "낮음"
          : "데이터 부족";
  return `신호 신뢰도: ${grade} ${reliability.score}점`;
};

export const calculatePortfolioDailyAction = ({
  loading,
  error,
  marketCurrency,
  currentPrice,
  pnlPct,
  currencyMatched,
  levels,
  signalReliability,
  breakoutSignal,
  tradeSetup,
}: PortfolioDailyActionInput): PortfolioDailyAction => {
  if (loading) {
    return {
      type: "insufficient-data",
      label: "분석 중",
      priority: 0,
      headline: "오늘 할 일을 계산하기 위해 시장 데이터를 불러오는 중입니다.",
      criteria: ["포트폴리오 분석 갱신이 끝나면 다시 확인하십시오."],
      riskLevel: "watch",
    };
  }

  if (error || !isNumber(currentPrice)) {
    return {
      type: "insufficient-data",
      label: "데이터 부족",
      priority: 0,
      headline: error ?? "현재가와 기준선 데이터가 부족해 오늘 할 일을 계산할 수 없습니다.",
      criteria: ["먼저 포트폴리오 분석을 갱신하십시오."],
      riskLevel: "watch",
    };
  }

  const belowHardStop = isNumber(levels.hardStop) && currentPrice < levels.hardStop;
  const nearPrimaryStop = isNumber(levels.primaryStop) && currentPrice <= levels.primaryStop * 1.03;
  const aboveSma20 = isNumber(levels.sma20) && currentPrice >= levels.sma20;
  const aboveSma5 = isNumber(levels.sma5) && currentPrice >= levels.sma5;
  const profitable = currencyMatched && isNumber(pnlPct) && pnlPct > 0;
  const profitTracking = currencyMatched && isNumber(pnlPct) && pnlPct >= 20 && aboveSma20;
  const strongReliability = signalReliability?.grade === "high" || signalReliability?.grade === "medium";

  if (belowHardStop || nearPrimaryStop) {
    return {
      type: "near-stop",
      label: "손절선 근접",
      priority: 100,
      headline: `현재가가 손절 기준에 가깝습니다. ${formatCurrency(levels.primaryStop ?? levels.hardStop, marketCurrency)} 이탈 여부를 먼저 확인하십시오.`,
      criteria: [
        isNumber(levels.hardStop) ? `강제 손절 기준: ${formatCurrency(levels.hardStop, marketCurrency)}` : "강제 손절 기준 데이터가 부족합니다.",
        isNumber(levels.primaryStop) ? `1차 손절 기준: ${formatCurrency(levels.primaryStop, marketCurrency)}` : "1차 손절 기준 데이터가 부족합니다.",
        tradeSetup?.invalidIf ?? "보유 논리 훼손 여부를 확인하십시오.",
      ],
      riskLevel: "danger",
    };
  }

  if (profitTracking) {
    return {
      type: "take-profit",
      label: "분할익절 검토",
      priority: 90,
      headline: `평단 대비 ${formatPercent(pnlPct ?? 0)} 수익권입니다. 1차/2차 분할익절과 20일선 추적 보유를 함께 검토하십시오.`,
      criteria: [
        isNumber(levels.sma20) ? `20일선 추적 기준: ${formatCurrency(levels.sma20, marketCurrency)}` : "20일선 데이터가 부족합니다.",
        isNumber(levels.resistance) ? `저항권: ${formatCurrency(levels.resistance, marketCurrency)}` : "저항선 데이터가 부족합니다.",
        reliabilityLabel(signalReliability),
      ],
      riskLevel: "normal",
    };
  }

  if (!aboveSma20 || signalReliability?.grade === "low") {
    return {
      type: "avoid-new-entry",
      label: "신규 진입 보류",
      priority: 80,
      headline: "20일선 회복 또는 신호 신뢰도 개선 전까지 비중 확대를 보류하는 편이 안전합니다.",
      criteria: [
        isNumber(levels.sma20) ? `20일선 기준: ${formatCurrency(levels.sma20, marketCurrency)}` : "20일선 데이터가 부족합니다.",
        reliabilityLabel(signalReliability),
        tradeSetup?.validIf ?? "기준선 위 종가 회복을 확인하십시오.",
      ],
      riskLevel: "danger",
    };
  }

  if (breakoutSignal?.status === "retest" || (!profitable && strongReliability && aboveSma20)) {
    return {
      type: "support-check",
      label: "지지 확인",
      priority: 70,
      headline: "기준선 위 종가 유지가 확인되면 신규 또는 추가 접근을 검토할 수 있는 구간입니다.",
      criteria: [
        isNumber(breakoutSignal?.supportLevel) ? `돌파 지지선: ${formatCurrency(breakoutSignal.supportLevel, marketCurrency)}` : tradeSetup?.validIf ?? "기준선 위 종가 유지가 필요합니다.",
        isNumber(breakoutSignal?.failureLevel) ? `실패 기준: ${formatCurrency(breakoutSignal.failureLevel, marketCurrency)}` : tradeSetup?.invalidIf ?? "실패선 이탈 시 보류합니다.",
        reliabilityLabel(signalReliability),
      ],
      riskLevel: "watch",
    };
  }

  if (profitable && aboveSma5) {
    return {
      type: "hold",
      label: "보유 유지",
      priority: 60,
      headline: `평단 대비 ${formatPercent(pnlPct ?? 0)}이고 5일선 위에서 추세가 유지 중입니다.`,
      criteria: [
        isNumber(levels.sma5) ? `5일선 이탈 체크: ${formatCurrency(levels.sma5, marketCurrency)}` : "5일선 데이터가 부족합니다.",
        isNumber(levels.sma20) ? `20일선 최종 추적: ${formatCurrency(levels.sma20, marketCurrency)}` : "20일선 데이터가 부족합니다.",
        tradeSetup?.invalidIf ?? "종가 기준 추세 이탈 여부를 확인하십시오.",
      ],
      riskLevel: "normal",
    };
  }

  return {
    type: "add-wait",
    label: "추가매수 대기",
    priority: 50,
    headline: "추세는 유지 중이지만 현재가 추격보다 5일선 또는 20일선 지지 확인을 기다리는 구간입니다.",
    criteria: [
      isNumber(levels.sma5) ? `공격 기준: ${formatCurrency(levels.sma5, marketCurrency)} 부근 지지` : "5일선 데이터가 부족합니다.",
      isNumber(levels.sma20) ? `보수 기준: ${formatCurrency(levels.sma20, marketCurrency)} 부근 지지` : "20일선 데이터가 부족합니다.",
      reliabilityLabel(signalReliability),
    ],
    riskLevel: "watch",
  };
};
