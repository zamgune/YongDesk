export const TRADE_PLAYBOOK_IDS = [
  "kr-intraday-crash-reversal",
  "short-hold-trend",
  "swing-mean-reversion",
  "swing-trend",
] as const;

export type TradePlaybookId = typeof TRADE_PLAYBOOK_IDS[number];
export type TradePlanHorizon = "intraday" | "short-hold" | "swing";
export type TradePlanStage = "shadow" | "provisional" | "calibrated";
export type TradePlanAction = "entry-ready" | "watch" | "wait" | "unavailable";
export type TradePlanGateKind =
  | "data"
  | "market"
  | "sector"
  | "setup"
  | "trigger"
  | "liquidity"
  | "risk"
  | "reward";
export type TradePlanGateStatus = "pass" | "warning" | "fail" | "unavailable";

export type TradeSignalEvent = {
  occurredAt: number;
  confirmedAt: number;
  role: "setup" | "trigger" | "warning" | "exit";
  side: "buy" | "sell" | "neutral";
  label: string;
  reason: string;
  price: number | null;
  structureInvalidationPrice: number | null;
};

export type TradePlanGate = {
  kind: TradePlanGateKind;
  status: TradePlanGateStatus;
  blocking: boolean;
  label: string;
  reason: string;
  source: string | null;
  asOf: string | null;
  dataAgeSeconds: number | null;
};

export type TradeRiskTarget = {
  price: number;
  allocationPct: number;
  basis: string;
};

export type TradeRiskPlan = {
  entryPrice: number | null;
  structureInvalidationPrice: number | null;
  riskPerShare: number | null;
  riskPct: number | null;
  riskStatus: "valid" | "outside-policy" | "unavailable";
  stopTrigger: "intrabar" | "hourly-close" | "daily-close" | null;
  targets: TradeRiskTarget[];
  trailingExit: TradeRiskTarget | null;
  timeStopBars: number | null;
  isBrokerStopEligible: false;
  orderSubmissionAttempted: false;
};

export type TradePlanCalibration = {
  status: "unverified" | "insufficient-data" | "provisional" | "calibrated";
  sampleSize: number;
  holdoutSampleSize: number;
  targetBeforeStopRate: number | null;
  averageNetR: number | null;
  confidence95: {
    lower: number | null;
    upper: number | null;
  };
  costModel: string | null;
  validationStart: string | null;
  validationEnd: string | null;
  note: string;
};

export type TradePlaybookPlan = {
  id: TradePlaybookId;
  horizon: TradePlanHorizon;
  marketScope: Array<"KR" | "US">;
  label: string;
  stage: TradePlanStage;
  action: TradePlanAction;
  setupVariant: string | null;
  events: TradeSignalEvent[];
  gates: TradePlanGate[];
  riskPlan: TradeRiskPlan;
  calibration: TradePlanCalibration;
  blockers: string[];
  reasons: string[];
  isBrokerStopEligible: false;
  orderSubmissionAttempted: false;
};

export type TradeSignalConflict = {
  horizon: TradePlanHorizon;
  playbookIds: TradePlaybookId[];
  reason: string;
};

export type TradeSignalSet = {
  contractVersion: 2;
  generatedAt: string;
  stage: "shadow";
  plans: TradePlaybookPlan[];
  primaryByHorizon: {
    intraday: TradePlaybookId | null;
    shortHold: TradePlaybookId | null;
    swing: TradePlaybookId | null;
  };
  conflicts: TradeSignalConflict[];
  isBrokerStopEligible: false;
  orderSubmissionAttempted: false;
};
