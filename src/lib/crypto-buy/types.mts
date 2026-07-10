export type CryptoInterval = "30m" | "1h" | "4h" | "1d";

export type CryptoParentTimeframe = "1d" | "4h";

export type CryptoExecutionMode = "A" | "B";

export type CostScenario = "zero" | "normal" | "conservative";

export type SignalSide = "buy" | "sell";

export type TradeDirection = "long" | "short";

export type SignalFamily =
  | "flush"
  | "rebound"
  | "capitulation"
  | "rejection"
  | "upthrust"
  | "blowoff";

export type LowerTfConfirmation = {
  interval: CryptoInterval;
  required: boolean;
  direction: TradeDirection;
  passed: boolean;
  triggeredBreak: boolean;
  lastRecovery: boolean;
  lastReentry?: boolean;
  triggerTime: number | null;
  priorRangeLevel20: number | null;
  priorRangeLow20?: number | null;
  lastChildClose: number | null;
  excursionDepth20: number | null;
  breakdownDepth20?: number | null;
};

export type CryptoBar = {
  symbol: string;
  interval: CryptoInterval;
  openTime: number;
  closeTime: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
};

export type CryptoFeatureRow = {
  index: number;
  bar: CryptoBar;
  timeframe: CryptoParentTimeframe;
  side: SignalSide;
  return3: number | null;
  return5: number | null;
  volumeRatio20: number | null;
  rsi7: number | null;
  rsi14: number | null;
  zScore20: number | null;
  bbUpper20_2: number | null;
  bbLower20_2: number | null;
  priorRangeLow20: number | null;
  breakdownDepth20: number | null;
  rangeReentry: boolean;
  breakdownHold: boolean;
  priorRangeHigh20: number | null;
  breakoutDepth20: number | null;
  rangeReject: boolean;
  breakoutHold: boolean;
  recoveryRatio: number | null;
  rejectionRatio: number | null;
  wickBodyRatio: number | null;
  upperWickBodyRatio: number | null;
  panicClose: boolean;
  weakLowerWick: boolean;
  tightUpperWick: boolean;
  panicUpPassed: boolean;
  overboughtCount: number;
  recentOverboughtWithin2?: boolean;
  recentBreakoutSeenWithin2?: boolean;
  recentReturn5HighWithin2?: boolean;
  previousBreakoutHold?: boolean;
  sellWarningLevel: 0 | 1 | 2 | 3;
  sellWarningReasons: string[];
  flushSignal: boolean;
  reboundSignal: boolean;
  capitulationSignal?: boolean;
  rejectionSignal: boolean;
  upthrustSignal: boolean;
  blowoffSignal: boolean;
  signalFamily: SignalFamily | null;
  signalLane: string | null;
  atr14: number | null;
  volatilityExpansion: number | null;
  ema5: number | null;
  htfClose: number | null;
  htfEma50: number | null;
  htfRsi14: number | null;
  htfPassed: boolean;
  liquidityAverage20d: number | null;
  liquidityPassed: boolean;
  oversoldCount: number;
  panicPassed: boolean;
  reversalPassed: boolean;
  primaryLowerTf: LowerTfConfirmation | null;
  secondaryLowerTf: LowerTfConfirmation | null;
  setupActive: boolean;
  panicBuySetup?: boolean;
  score: number;
  notes: string[];
};

export type SellWarningEvent = {
  time: number;
  level: 1 | 2 | 3;
  reasons: string[];
};

export type CryptoSignal = {
  symbol: string;
  timeframe: CryptoParentTimeframe;
  side: SignalSide;
  direction: TradeDirection;
  mode: CryptoExecutionMode;
  signalFamily: SignalFamily | null;
  signalLane: string | null;
  signalIndex: number;
  signalTime: number;
  entryIndex: number;
  entryTime: number;
  score: number;
  reasons: string[];
  stopLevel: number;
  signalLow: number;
  signalHigh: number;
  atr14: number;
  confirmPassed: boolean;
  htfPassed: boolean;
};

export type CostConfig = {
  scenario: CostScenario;
  feeRate: number;
  slippageRate: number;
};

export const COST_CONFIGS: Record<CostScenario, CostConfig> = {
  zero: {
    scenario: "zero",
    feeRate: 0,
    slippageRate: 0,
  },
  normal: {
    scenario: "normal",
    feeRate: 0.0005,
    slippageRate: 0.0005,
  },
  conservative: {
    scenario: "conservative",
    feeRate: 0.0006,
    slippageRate: 0.001,
  },
};

export type BacktestConfig = {
  startingEquity: number;
  riskPerTrade: number;
  maxHoldBars: number;
  cooldownBars: number;
  advThreshold: number;
};

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startingEquity: 100_000,
  riskPerTrade: 0.01,
  maxHoldBars: 16,
  cooldownBars: 8,
  advThreshold: 10_000_000,
};

export type TradeExitReason =
  | "stop"
  | "breakeven_stop"
  | "tp2"
  | "time"
  | "end_of_data";

export type EquityPoint = {
  time: number;
  equity: number;
};

export type BacktestTrade = {
  symbol: string;
  timeframe: CryptoParentTimeframe;
  side: SignalSide;
  direction: TradeDirection;
  mode: CryptoExecutionMode;
  costScenario: CostScenario;
  signalTime: number;
  entryTime: number;
  exitTime: number;
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  score: number;
  signalFamily: SignalFamily | null;
  signalLane: string | null;
  reasons: string[];
  entryPrice: number;
  stopPrice: number;
  tp1Price: number;
  tp2Price: number;
  exitReason: TradeExitReason;
  quantity: number;
  entryEquity: number;
  grossPnl: number;
  netPnl: number;
  netReturn: number;
  riskPerUnit: number;
  rMultiple: number;
  holdBars: number;
  tp1Hit: boolean;
  maxAdverseExcursion: number;
  maxFavorableExcursion: number;
};

export type BacktestSummary = {
  symbol: string;
  timeframe: CryptoParentTimeframe;
  side: SignalSide;
  direction: TradeDirection;
  mode: CryptoExecutionMode;
  costScenario: CostScenario;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  endingEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  profitFactor: number | null;
  expectancy: number;
  averageHoldBars: number;
  averageWin: number | null;
  averageLoss: number | null;
  averageRMultiple: number | null;
};

export type SymbolBacktestResult = {
  summary: BacktestSummary;
  trades: BacktestTrade[];
  signals: CryptoSignal[];
  equityCurve: EquityPoint[];
  skippedSignals: number;
};

export type SignalSet = Record<CryptoExecutionMode, CryptoSignal[]>;
