export type AutomationFeature = "automation_beta" | "live_trading" | "broker_credentials";

export type AutomationPreset =
  | "support-rebound"
  | "box-range"
  | "magic-split"
  | "one-percent-loop"
  | "defensive-split"
  | "custom";

export type AutomationMarket = "US" | "KR" | "CRYPTO";
export type AutomationExecutionVenue = "toss" | "upbit" | "bithumb";

export type AutomationOrderSizing =
  | { mode: "quantity"; quantity: number }
  | { mode: "notional"; notional: number };

export type AutomationStrategyStatus = "draft" | "enabled" | "disabled";

export type LadderStep = {
  id: string;
  side: "buy" | "sell";
  price: number;
  notional: number;
  condition: string;
};

/** 전략 동작 모드. ladder=고정 가격 사다리, percent-grid=분할 그리드, loop-grid=단일 순환매매 */
export type AutomationMode = "ladder" | "percent-grid" | "loop-grid";

/**
 * 분할 자동매매식 그리드의 차수(rung) 정의.
 * 차수마다 매수 발동 하락률과 매도 발동 상승률을 다르게 설정할 수 있습니다(가변 퍼센트).
 */
export type GridRung = {
  index: number;
  /** 기준가(basePrice) 대비 누적 하락률(%). 매수 발동가 = basePrice × (1 − buyDropPct/100) */
  buyDropPct: number;
  /** 해당 차수의 매수 체결가 대비 상승률(%). 매도 발동가 = 차수 매수가 × (1 + sellRisePct/100) */
  sellRisePct: number;
  /** 차수당 투입 금액 */
  notional: number;
};

export type GridPlan = {
  /** 그리드 기준가 (보통 1차 매수 기준 현재가) */
  basePrice: number;
  rungs: GridRung[];
};

/** 1% 순환매매식 단일 포지션 반복 계획. */
export type LoopGridPlan = {
  /** 다음 매수 기준가. 매도 성공 후 매도가로 갱신됩니다. */
  anchorPrice: number;
  /** 기준가 대비 매수 발동 하락률(%). 기본 1 */
  buyDropPct: number;
  /** 매수가 대비 매도 발동 상승률(%). 기본 1 */
  sellRisePct: number;
  /** 1회 매수 투입 금액 */
  notional: number;
  /** 매수/매도 성공 후 다음 발동까지 최소 대기 시간 */
  cooldownMinutes: number;
};

export type LoopGridPositionState = "empty" | "holding";

/** loop-grid 의 현재 사이클 상태. */
export type LoopGridState = {
  anchorPrice: number;
  positionState: LoopGridPositionState;
  entryPrice: number | null;
  quantity: number;
  lastCycleAt: string | null;
  cycleCount: number;
  updatedAt: string;
};

/** 분할 자동매매 그리드의 보유 차수(lot). 차수별 개별 매도를 위해 매수가·수량을 추적. */
export type GridLot = {
  lotId: string;
  rungIndex: number;
  entryPrice: number;
  quantity: number;
  openedAt: string;
};

export type AutomationRiskLimits = {
  maxDailyBuys: number;
  maxDailySells: number;
  maxPositionValue: number;
  maxLossPct: number;
  maxHoldHours: number;
};

export type AutomationExitRules = {
  takeProfitPct: number;
  stopLossPct: number;
  rescueMode: "cancel-and-liquidate" | "disable-only";
};

export type AutomationPriceAnchor = {
  source: "manual" | "market" | "holding-average";
  price: number;
  capturedAt: string | null;
};

export type AutomationLastSimulation = {
  configHash: string;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  expectedReturnPct: number;
  expectedLossPct: number;
  summary: string;
  simulatedAt: string;
};

export type AutomationStrategyConfig = {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  market: AutomationMarket;
  /** 실제 실행 대상. 기존 주식 전략은 toss, 코인 전략은 upbit/bithumb. */
  executionVenue?: AutomationExecutionVenue;
  preset: AutomationPreset;
  status: AutomationStrategyStatus;
  /** 동작 모드. 미지정 시 "ladder"(하위호환) */
  mode?: AutomationMode;
  /** 새 전략의 1회 주문 크기. 미지정 전략은 기존 차수별 notional 계산을 유지한다. */
  orderSizing?: AutomationOrderSizing;
  supportPrice: number;
  resistancePrice: number;
  currentPrice: number;
  ladder: LadderStep[];
  /** percent-grid 모드에서 사용하는 그리드 계획 */
  grid?: GridPlan;
  /** loop-grid 모드에서 사용하는 순환매매 계획 */
  loop?: LoopGridPlan;
  priceAnchor?: AutomationPriceAnchor;
  lastSimulation?: AutomationLastSimulation;
  riskLimits: AutomationRiskLimits;
  exitRules: AutomationExitRules;
  createdAt: string;
  updatedAt: string;
};

export type AutomationOrderIntentDraft = {
  id: string;
  userId: string;
  strategyConfigId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "limit";
  quantity: number;
  notional: number;
  limitPrice: number;
  status: "draft" | "blocked";
  reason: string;
  createdAt: string;
};

export type AutomationRiskCheck = {
  passed: boolean;
  blockers: string[];
  warnings: string[];
};

export type AutomationSimulationResult = {
  strategyConfigId: string;
  configHash: string;
  mode: "paper";
  liveTradingEnabled: false;
  summary: string;
  expectedReturnPct: number;
  expectedLossPct: number;
  orderIntents: AutomationOrderIntentDraft[];
  riskCheck: AutomationRiskCheck;
  logs: string[];
  simulatedAt: string;
};
