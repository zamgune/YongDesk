export type StockMarket = "KR" | "US";

export type StockBacktestTimeframe = "5m" | "1h" | "1d";

export type StockBacktestHorizon = "intraday" | "short-hold" | "swing";

export type StockTradeDirection = "long" | "short";

export type StockTradeSide = "buy" | "sell";

/** All market and signal timestamps use UNIX seconds, never milliseconds. */
export type UnixSeconds = number;

export type StockBacktestBar = {
  symbol: string;
  market: StockMarket;
  timeframe: StockBacktestTimeframe;
  openTime: UnixSeconds;
  closeTime: UnixSeconds;
  sessionDate: string;
  isSessionEnd?: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockUniverseMembershipInterval = {
  from: UnixSeconds;
  to: UnixSeconds | null;
};

export type StockDatasetSymbolEvidence = {
  symbol: string;
  market: StockMarket;
  validFrom: UnixSeconds;
  validTo: UnixSeconds | null;
  universeMemberships: StockUniverseMembershipInterval[];
  delisting: {
    status: "active" | "delisted";
    effectiveTime: UnixSeconds | null;
  };
  source: string;
  recordedAt: string;
};

export type StockDatasetManifestSeed = {
  schemaVersion: 1;
  provider: string;
  retrievedAt: string;
  timeframe: StockBacktestTimeframe;
  markets: StockMarket[];
  symbols: string[];
  startTime: UnixSeconds;
  endTime: UnixSeconds;
  priceAdjustment: "raw" | "split-adjusted" | "total-return-adjusted";
  sessionPolicy: string;
  missingBarPolicy: string;
  pointInTimeUniverse: boolean;
  delistingsIncluded: boolean;
  symbolEvidence: StockDatasetSymbolEvidence[];
};

export type StockDatasetManifest = StockDatasetManifestSeed & {
  datasetId: string;
  contentChecksum: string;
  recordCount: number;
};

export type StockBacktestDataset = {
  manifest: StockDatasetManifest;
  bars: StockBacktestBar[];
};

export type StockDatasetContentCheckId =
  | "non-empty"
  | "declared-extents"
  | "symbols"
  | "markets"
  | "timeframe"
  | "chronological"
  | "duplicate-bars"
  | "price-shape"
  | "session-shape"
  | "symbol-evidence"
  | "symbol-validity"
  | "point-in-time-universe-evidence"
  | "delisting-evidence";

export type StockDatasetContentCheck = {
  id: StockDatasetContentCheckId;
  passed: boolean;
  detail: string;
};

export type StockDatasetContentValidation = {
  valid: boolean;
  actualStartTime: UnixSeconds | null;
  actualEndTime: UnixSeconds | null;
  checks: StockDatasetContentCheck[];
  blockers: StockDatasetContentCheckId[];
};

export type StockCostModel = {
  id: string;
  commissionRate: number;
  sellTaxRate: number;
  adverseSlippageBps: number;
};

export type StockBacktestConfigSeed = {
  schemaVersion: 1;
  playbookId: string;
  horizon: StockBacktestHorizon;
  market: StockMarket;
  timeframe: StockBacktestTimeframe;
  startingEquity: number;
  riskPerTradeFraction: number;
  maxPositionFraction: number;
  maxHoldBars: number | null;
  forceSessionEndExit: boolean;
  cost: StockCostModel;
};

export type StockBacktestConfig = StockBacktestConfigSeed & {
  configId: string;
};

export type StockTargetSpec = {
  id: string;
  allocationFraction: number;
  rMultiple?: number;
  price?: number;
};

export type StockTrailingLevel = {
  observedAtCloseTime: UnixSeconds;
  price: number;
};

export type StockBacktestSignal = {
  id: string;
  symbol: string;
  playbookId: string;
  direction: StockTradeDirection;
  occurredAt: UnixSeconds;
  confirmedAt: UnixSeconds;
  sessionDate?: string;
  stopPrice: number;
  targets: StockTargetSpec[];
  trailingLevels?: StockTrailingLevel[];
  reasons?: string[];
};

export type StockFillReason =
  | "entry"
  | "stop"
  | "target"
  | "trail"
  | "time"
  | "session-end"
  | "end-of-data";

export type StockFill = {
  time: UnixSeconds;
  barIndex: number;
  side: StockTradeSide;
  reason: StockFillReason;
  targetId: string | null;
  referencePrice: number;
  executionPrice: number;
  quantity: number;
  commission: number;
  tax: number;
  grossPnl: number;
};

export type StockTradeExitReason = Exclude<StockFillReason, "entry">;

export type StockBacktestTrade = {
  signalId: string;
  symbol: string;
  playbookId: string;
  direction: StockTradeDirection;
  signalTime: UnixSeconds;
  confirmedAt: UnixSeconds;
  entryTime: UnixSeconds;
  exitTime: UnixSeconds;
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  initialStopPrice: number;
  quantity: number;
  riskPerUnit: number;
  riskCapital: number;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  rMultiple: number;
  holdBars: number;
  maxAdverseExcursionFraction: number;
  maxFavorableExcursionFraction: number;
  maxAdverseExcursionR: number;
  maxFavorableExcursionR: number;
  exitReason: StockTradeExitReason;
  fills: StockFill[];
};

export type StockSignalRejectionReason =
  | "duplicate-signal-id"
  | "wrong-symbol"
  | "playbook-mismatch"
  | "invalid-signal-time"
  | "missing-next-bar"
  | "cross-session-entry"
  | "invalid-stop"
  | "invalid-target"
  | "invalid-trail"
  | "entry-conflict"
  | "position-open"
  | "invalid-risk"
  | "insufficient-equity";

export type StockSignalRejection = {
  signalId: string;
  symbol: string;
  confirmedAt: UnixSeconds;
  reason: StockSignalRejectionReason;
  detail: string;
};

export type StockEquityPoint = {
  time: UnixSeconds;
  equity: number;
  realizedEquity: number;
  openSignalId: string | null;
};

export type StockBacktestSummary = {
  datasetId: string;
  configId: string;
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  endingEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  profitFactor: number | null;
  averageNetPnl: number;
  averageRMultiple: number | null;
  averageHoldBars: number;
};

export type StockBacktestResult = {
  summary: StockBacktestSummary;
  trades: StockBacktestTrade[];
  equityCurve: StockEquityPoint[];
  rejections: StockSignalRejection[];
};

export type ChronologicalFold = {
  id: string;
  train: {
    startIndex: number;
    endIndex: number;
    startTime: UnixSeconds;
    endTime: UnixSeconds;
  };
  validation: {
    startIndex: number;
    endIndex: number;
    startTime: UnixSeconds;
    endTime: UnixSeconds;
  };
};

export type ChronologicalFoldSet = {
  folds: ChronologicalFold[];
  holdout: {
    startIndex: number;
    endIndex: number;
    startTime: UnixSeconds;
    endTime: UnixSeconds;
  } | null;
};

export type PromotionThresholds = {
  minimumOosTrades: number;
  minimumHoldoutTrades: number;
  minimumAverageRLower95: number;
  minimumBaseProfitFactor: number;
  minimumStressProfitFactor: number;
  minimumPositiveFoldRatio: number;
  maximumSymbolContribution: number;
  maximumYearContribution: number;
  maximumDrawdownVsBaseline: number;
};

export type PromotionInputs = {
  horizon: StockBacktestHorizon;
  oosTrades: StockBacktestTrade[];
  holdoutTrades: StockBacktestTrade[];
  stressTrades: StockBacktestTrade[];
  averageRLower95: number | null;
  foldNetReturns: number[];
  maxDrawdown: number;
  baselineMaxDrawdown: number;
  pointInTimeUniverse: boolean;
  delistingsIncluded: boolean;
  holmAdjustedPassed: boolean;
  thresholds?: Partial<PromotionThresholds>;
};

export type PromotionCheck = {
  id:
    | "oos-sample"
    | "holdout-sample"
    | "average-r-ci"
    | "base-profit-factor"
    | "stress-profit-factor"
    | "positive-fold-ratio"
    | "top-one-percent"
    | "symbol-concentration"
    | "year-concentration"
    | "drawdown"
    | "point-in-time-universe"
    | "delistings"
    | "holm-adjustment";
  passed: boolean;
  actual: number | boolean | null;
  required: number | boolean;
};

export type PromotionEvaluation = {
  status: "calibrated" | "provisional" | "insufficient-data";
  checks: PromotionCheck[];
  metrics: {
    oosTrades: number;
    holdoutTrades: number;
    averageRLower95: number | null;
    baseProfitFactor: number | null;
    stressProfitFactor: number | null;
    positiveFoldRatio: number;
    topOnePercentRemovedAverageR: number | null;
    maximumSymbolContribution: number;
    maximumYearContribution: number;
    maxDrawdown: number;
    baselineMaxDrawdown: number;
  };
  thresholds: PromotionThresholds;
  blockers: PromotionCheck["id"][];
};
