export type BreakoutRuleStatus =
  | "breakout-ready"
  | "wait-pullback"
  | "profit-tracking"
  | "risk-off"
  | "avoid";

export type BreakoutVolumeStatus =
  | "strong"
  | "confirmed"
  | "normal"
  | "weak"
  | "unavailable";

export type BreakoutVolumeContext =
  | "breakout"
  | "support"
  | "none";

export type BreakoutVolumeConfirmation = {
  ratio20: number | null;
  status: BreakoutVolumeStatus;
  context: BreakoutVolumeContext;
  label: string;
  reason: string;
};

export type BreakoutRule = {
  status: BreakoutRuleStatus;
  newHighLevel: number | null;
  breakoutDistancePct: number | null;
  avgTradedValue20: number | null;
  volumeConfirmation: BreakoutVolumeConfirmation;
  fixedStopPrice: number | null;
  profitSwitchPrice: number | null;
  trailingExitPrice: number | null;
  reasons: string[];
};

type BreakoutCandle = {
  high: number;
  close: number;
  volume: number;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const getVolumeStatus = (ratio: number | null): BreakoutVolumeStatus => {
  if (!isNumber(ratio)) {
    return "unavailable";
  }
  if (ratio >= 2) {
    return "strong";
  }
  if (ratio >= 1.5) {
    return "confirmed";
  }
  if (ratio >= 1) {
    return "normal";
  }
  return "weak";
};

const getVolumeLabel = (status: BreakoutVolumeStatus) => {
  switch (status) {
    case "strong":
      return "강한 수급";
    case "confirmed":
      return "거래량 확인";
    case "normal":
      return "보통";
    case "weak":
      return "거래량 부족";
    case "unavailable":
      return "확인 불가";
  }
};

const getVolumeReason = (
  status: BreakoutVolumeStatus,
  ratio: number | null,
  context: BreakoutVolumeContext,
) => {
  const ratioText = isNumber(ratio) ? `${ratio.toFixed(2)}배` : "확인 불가";
  if (context === "breakout") {
    if (status === "strong" || status === "confirmed") {
      return `돌파 거래량은 ${ratioText}로 확인됩니다.`;
    }
    if (status === "normal") {
      return `가격은 돌파했지만 거래량은 ${ratioText}로 강한 수급까지는 아닙니다.`;
    }
    if (status === "weak") {
      return `가격은 돌파했지만 거래량은 ${ratioText}로 약해 추격보다 지지 확인이 우선입니다.`;
    }
    return "돌파 거래량 배율을 계산할 데이터가 부족합니다.";
  }
  if (context === "support") {
    if (isNumber(ratio) && ratio >= 1.2) {
      return `지지 반등 거래량은 ${ratioText}로 양호합니다.`;
    }
    if (status === "weak") {
      return `지지 구간이지만 거래량은 ${ratioText}로 약해 확인이 더 필요합니다.`;
    }
    return `지지 구간 거래량은 ${ratioText}입니다.`;
  }
  return isNumber(ratio)
    ? `최근 거래량은 20봉 평균 대비 ${ratioText}입니다.`
    : "거래량 배율 계산 데이터가 부족합니다.";
};

export const calculateBreakoutRule = ({
  candles,
  sma20,
}: {
  candles: BreakoutCandle[];
  sma20: Array<number | null>;
}): BreakoutRule => {
  const latest = candles[candles.length - 1];
  if (!latest) {
    return {
      status: "avoid",
      newHighLevel: null,
      breakoutDistancePct: null,
      avgTradedValue20: null,
      volumeConfirmation: {
        ratio20: null,
        status: "unavailable",
        context: "none",
        label: "확인 불가",
        reason: "거래량 배율 계산 데이터가 부족합니다.",
      },
      fixedStopPrice: null,
      profitSwitchPrice: null,
      trailingExitPrice: null,
      reasons: ["신고가 돌파 룰 계산에 필요한 가격 데이터가 부족합니다."],
    };
  }

  const priorCandles = candles.slice(0, -1);
  const lookback = priorCandles.length >= 252 ? 252 : 120;
  const highWindow = priorCandles.slice(-lookback);
  const newHighLevel = highWindow.length
    ? Math.max(...highWindow.map((candle) => candle.high))
    : null;
  const entryReference = newHighLevel ?? latest.close;
  const breakoutDistancePct = newHighLevel ? latest.close / newHighLevel - 1 : null;
  const avgTradedValue20 = average(
    candles.slice(-20).map((candle) => candle.close * candle.volume).filter(isNumber),
  );
  const avgVolume20 = average(
    (priorCandles.length ? priorCandles : candles)
      .slice(-20)
      .map((candle) => candle.volume)
      .filter(isNumber),
  );
  const fixedStopPrice = entryReference * 0.9;
  const profitSwitchPrice = entryReference * 1.2;
  const trailingExitPrice = sma20[sma20.length - 1] ?? null;
  const brokeNewHigh = newHighLevel !== null && latest.close > newHighLevel;
  const aboveSma20 = trailingExitPrice !== null && latest.close >= trailingExitPrice;
  const volumeRatio20 = avgVolume20 && avgVolume20 > 0 ? latest.volume / avgVolume20 : null;
  const volumeContext: BreakoutVolumeContext = brokeNewHigh
    ? "breakout"
    : aboveSma20
      ? "support"
      : "none";
  const volumeStatus = getVolumeStatus(volumeRatio20);
  const volumeConfirmation: BreakoutVolumeConfirmation = {
    ratio20: volumeRatio20,
    status: volumeStatus,
    context: volumeContext,
    label: getVolumeLabel(volumeStatus),
    reason: getVolumeReason(volumeStatus, volumeRatio20, volumeContext),
  };
  const profitTracking = latest.close >= profitSwitchPrice && aboveSma20;
  const riskOff =
    (trailingExitPrice !== null && latest.close < trailingExitPrice) ||
    latest.close <= fixedStopPrice;

  const reasons = [
    newHighLevel
      ? `신고가 기준 ${newHighLevel.toLocaleString(undefined, { maximumFractionDigits: 2 })} 돌파 여부를 확인합니다.`
      : "신고가 기준을 만들 120봉 이상 데이터가 부족합니다.",
    avgTradedValue20
      ? `최근 20봉 평균 거래대금은 ${avgTradedValue20.toLocaleString(undefined, { maximumFractionDigits: 0 })}입니다.`
      : "거래대금 계산 데이터가 부족합니다.",
    volumeConfirmation.reason,
    trailingExitPrice
      ? `20일선 추적 기준은 ${trailingExitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}입니다.`
      : "20일선 추적 기준 데이터가 부족합니다.",
  ];

  if (profitTracking) {
    return {
      status: "profit-tracking",
      newHighLevel,
      breakoutDistancePct,
      avgTradedValue20,
      volumeConfirmation,
      fixedStopPrice,
      profitSwitchPrice,
      trailingExitPrice,
      reasons: [
        "진입 기준 대비 +20% 구간에 들어와 20일선 추적 모드로 봅니다.",
        ...reasons,
      ],
    };
  }

  if (riskOff) {
    return {
      status: "risk-off",
      newHighLevel,
      breakoutDistancePct,
      avgTradedValue20,
      volumeConfirmation,
      fixedStopPrice,
      profitSwitchPrice,
      trailingExitPrice,
      reasons: [
        "20일선 또는 -10% 고정 손절 기준을 위협해 추가매수보다 리스크 관리가 우선입니다.",
        ...reasons,
      ],
    };
  }

  if (brokeNewHigh && aboveSma20) {
    return {
      status: "breakout-ready",
      newHighLevel,
      breakoutDistancePct,
      avgTradedValue20,
      volumeConfirmation,
      fixedStopPrice,
      profitSwitchPrice,
      trailingExitPrice,
      reasons: [
        "신고가 돌파 후보입니다. 즉시 추격보다 거래량과 지지 확인을 함께 봅니다.",
        ...reasons,
      ],
    };
  }

  if (aboveSma20) {
    return {
      status: "wait-pullback",
      newHighLevel,
      breakoutDistancePct,
      avgTradedValue20,
      volumeConfirmation,
      fixedStopPrice,
      profitSwitchPrice,
      trailingExitPrice,
      reasons: [
        "20일선 위 구조는 유지되지만 신고가 돌파는 아직 확인되지 않아 눌림/지지 확인이 우선입니다.",
        ...reasons,
      ],
    };
  }

  return {
    status: "avoid",
    newHighLevel,
    breakoutDistancePct,
    avgTradedValue20,
    volumeConfirmation,
    fixedStopPrice,
    profitSwitchPrice,
    trailingExitPrice,
    reasons: [
      "20일선 위 구조와 신고가 돌파가 모두 부족해 신규 접근 매력은 낮습니다.",
      ...reasons,
    ],
  };
};
