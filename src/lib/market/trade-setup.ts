import type { BreakoutRule } from "@/lib/market/breakout-rule";

export type TradeSetupType = "breakout" | "pullback" | "reclaim" | "extended" | "risk-off";

export type TradeSetupLevelLabel =
  | "돌파 지지선"
  | "5일선"
  | "20일선"
  | "박스 상단"
  | "회복 기준선"
  | "20일선 추적선"
  | "방어 기준선";

export type TradeSetup = {
  type: TradeSetupType;
  label: string;
  keyLevel: number | null;
  keyLevelLabel: TradeSetupLevelLabel;
  failureLevel: number | null;
  validIf: string;
  invalidIf: string;
  entryPlan: string;
  stopReason: string;
};

export type TradeSetupInput = {
  decision?: "enter" | "hold" | "watch" | "avoid";
  price?: number | null;
  return5?: number | null;
  breakoutRule?: BreakoutRule | null;
  risk?: {
    stopPrice?: number | null;
  } | null;
  levels?: {
    sma5?: number | null;
    sma20?: number | null;
    aggressiveEntryLow?: number | null;
    aggressiveEntryHigh?: number | null;
    conservativeEntryLow?: number | null;
    conservativeEntryHigh?: number | null;
    newEntryStop?: number | null;
    breakoutPrice?: number | null;
  } | null;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatSetupPrice = (value: number | null | undefined) =>
  isNumber(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const getConservativeFailureLevel = (...values: Array<number | null | undefined>) => {
  const candidates = values.filter(isNumber);
  return candidates.length ? Math.max(...candidates) : null;
};

export const buildTradeSetup = (input: TradeSetupInput): TradeSetup => {
  const breakoutRule = input.breakoutRule ?? null;
  const levels = input.levels ?? null;
  const sma5 = levels?.sma5 ?? null;
  const sma20 = levels?.sma20 ?? null;
  const stop = levels?.newEntryStop ?? input.risk?.stopPrice ?? null;
  const breakoutLevel = breakoutRule?.newHighLevel ?? levels?.breakoutPrice ?? null;

  if (breakoutRule?.status === "risk-off") {
    const keyLevel = breakoutRule.trailingExitPrice ?? sma20 ?? stop;
    return {
      type: "risk-off",
      label: "방어 우선",
      keyLevel,
      keyLevelLabel: "방어 기준선",
      failureLevel: keyLevel,
      validIf: "20일선 회복 전까지 신규 진입은 보류합니다.",
      invalidIf: `${formatSetupPrice(keyLevel)} 아래 종가가 이어지면 추세 훼손으로 봅니다.`,
      entryPlan: "신규 진입보다 보유 비중 축소 또는 관찰이 우선입니다.",
      stopReason: "20일선 이탈 이후 회복이 확인되지 않은 구간입니다.",
    };
  }

  if (breakoutRule?.status === "profit-tracking") {
    const keyLevel = breakoutRule.trailingExitPrice ?? sma20;
    return {
      type: "extended",
      label: "수익 추적",
      keyLevel,
      keyLevelLabel: "20일선 추적선",
      failureLevel: keyLevel,
      validIf: `${formatSetupPrice(keyLevel)} 위에서 일봉 종가가 유지되면 보유 논리가 유지됩니다.`,
      invalidIf: `${formatSetupPrice(keyLevel)} 아래 일봉 마감은 수익 보호 신호로 봅니다.`,
      entryPlan: "신규 진입보다 보유 관리 또는 5일선/20일선 눌림 대기가 적합합니다.",
      stopReason: "+20% 이후에는 20일선 이탈을 수익 보호 기준으로 둡니다.",
    };
  }

  if (breakoutRule?.status === "breakout-ready" && isNumber(breakoutLevel)) {
    const failureLevel = getConservativeFailureLevel(
      breakoutLevel * 0.97,
      stop,
    );
    return {
      type: "breakout",
      label: "돌파 지지 확인",
      keyLevel: breakoutLevel,
      keyLevelLabel: "돌파 지지선",
      failureLevel,
      validIf: `${formatSetupPrice(breakoutLevel)} 위에서 일봉 종가가 유지되면 돌파 지지 확인으로 봅니다.`,
      invalidIf: `${formatSetupPrice(failureLevel ?? breakoutLevel)} 아래 일봉 마감은 돌파 실패로 봅니다.`,
      entryPlan: "돌파 지지선 위에서 거래량을 동반한 지지 확인 후 분할 접근합니다.",
      stopReason: "이전 고점 저항선이 지지선으로 바뀌는지 확인하는 기준입니다.",
    };
  }

  if (input.decision === "watch" && isNumber(sma20)) {
    const failureLevel = getConservativeFailureLevel(sma20 * 0.985, stop);
    return {
      type: "reclaim",
      label: "20일선 회복 확인",
      keyLevel: sma20,
      keyLevelLabel: "회복 기준선",
      failureLevel,
      validIf: `${formatSetupPrice(sma20)} 위로 일봉 종가를 회복하고 유지해야 합니다.`,
      invalidIf: `${formatSetupPrice(failureLevel ?? sma20)} 아래 마감은 회복 실패로 봅니다.`,
      entryPlan: "20일선 회복 후 5일선이 따라붙는지 확인하며 분할 접근합니다.",
      stopReason: "20일선 회복 실패 시 추세추종 진입 근거가 약합니다.",
    };
  }

  if (isNumber(sma5)) {
    const failureLevel = getConservativeFailureLevel(stop, sma20);
    return {
      type: "pullback",
      label: "5일선 지지 확인",
      keyLevel: sma5,
      keyLevelLabel: "5일선",
      failureLevel,
      validIf: `${formatSetupPrice(sma5)} 위에서 일봉 종가가 유지되면 단기 추세가 살아 있습니다.`,
      invalidIf: `${formatSetupPrice(failureLevel ?? sma5)} 아래 마감은 눌림 실패로 봅니다.`,
      entryPlan: "5일선 지지 확인 후 분할 진입하고, 과열이면 20일선 눌림을 기다립니다.",
      stopReason: "5일선 지지가 깨지면 20일선 또는 구조 손절까지 밀릴 수 있습니다.",
    };
  }

  if (isNumber(sma20)) {
    const failureLevel = getConservativeFailureLevel(sma20 * 0.985, stop);
    return {
      type: "reclaim",
      label: "20일선 기준 대기",
      keyLevel: sma20,
      keyLevelLabel: "20일선",
      failureLevel,
      validIf: `${formatSetupPrice(sma20)} 위에서 일봉 종가가 유지되어야 합니다.`,
      invalidIf: `${formatSetupPrice(failureLevel ?? sma20)} 아래 마감은 신규 진입 보류 신호입니다.`,
      entryPlan: "20일선 지지 확인 전까지 신규 진입은 보수적으로 기다립니다.",
      stopReason: "20일선 기준이 없으면 추세추종 손익비가 불리해집니다.",
    };
  }

  return {
    type: "risk-off",
    label: "기준선 부족",
    keyLevel: stop,
    keyLevelLabel: "방어 기준선",
    failureLevel: stop,
    validIf: "5일선/20일선 데이터가 확인될 때까지 신규 진입을 보류합니다.",
    invalidIf: stop ? `${formatSetupPrice(stop)} 아래 마감은 리스크 관리 기준입니다.` : "명확한 실패선을 계산할 수 없습니다.",
    entryPlan: "데이터가 보강될 때까지 관찰만 합니다.",
    stopReason: "핵심 이동평균과 구조 손절 기준이 부족합니다.",
  };
};
