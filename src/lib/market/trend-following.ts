export type TrendFollowingCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TrendFollowingAction =
  | "entry"
  | "breakout-entry"
  | "management-warning"
  | "trend-exit";

export type TrendFollowingSignal = {
  time: number;
  type: "buy" | "sell";
  action: TrendFollowingAction;
  label: string;
  reason: string;
  entryPrice?: number;
  initialStop?: number;
  stopLevel?: number;
  riskPerShare?: number;
  partialTakeProfitLevel?: number;
  trendExitLevel?: number;
  volumeRatio?: number;
};

export type TrendFollowingFeature = {
  time: number;
  sma5: number | null;
  sma20: number | null;
  sma50: number | null;
  sma20SlopePct: number | null;
  sma50SlopePct: number | null;
  volumeMa20: number | null;
  volumeRatio: number | null;
  recentHigh20: number | null;
  recentLow5: number | null;
  closeLocation: number;
  rejectionReasons: string[];
};

export type TrendFollowingActiveSetup = {
  entryTime: number;
  entryPrice: number;
  initialStop: number;
  riskPerShare: number;
  partialTakeProfitLevel: number;
  trendExitLevel: number;
};

export type TrendFollowingDiagnostics = {
  insufficientHistory: boolean;
  rejectedSetups: number;
  latestRejectionReasons: string[];
};

export type TrendFollowingResult = {
  signals: TrendFollowingSignal[];
  latestFeature: TrendFollowingFeature | null;
  activeSetup: TrendFollowingActiveSetup | null;
  diagnostics?: TrendFollowingDiagnostics;
};

export type TrendFollowingThresholds = {
  minimumHistoryBars: number;
  sma20SlopeLookbackBars: number;
  sma50SlopeLookbackBars: number;
  minSma20SlopePct: number;
  minSma50SlopePct: number;
  volumeRatioThreshold: number;
  breakoutVolumeRatioThreshold: number;
  closeStrengthThreshold: number;
  breakoutLookbackBars: number;
  structureLowLookbackBars: number;
  entryCooldownBars: number;
  warningCooldownBars: number;
};

export const TREND_FOLLOWING_THRESHOLDS: TrendFollowingThresholds = {
  minimumHistoryBars: 50,
  sma20SlopeLookbackBars: 3,
  sma50SlopeLookbackBars: 5,
  minSma20SlopePct: 0.001,
  minSma50SlopePct: 0,
  volumeRatioThreshold: 1.2,
  breakoutVolumeRatioThreshold: 1.35,
  closeStrengthThreshold: 0.6,
  breakoutLookbackBars: 20,
  structureLowLookbackBars: 5,
  entryCooldownBars: 5,
  warningCooldownBars: 3,
};

type CalculateTrendFollowingSignalsOptions = {
  candles: TrendFollowingCandle[];
  sma5: Array<number | null>;
  sma20: Array<number | null>;
  sma50: Array<number | null>;
  volumeMa20: Array<number | null>;
  includeDiagnostics?: boolean;
  thresholds?: Partial<TrendFollowingThresholds>;
};

type ActiveTrendPosition = TrendFollowingActiveSetup;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getCloseLocation = (candle: TrendFollowingCandle) => {
  const range = candle.high - candle.low;
  return range > 0 ? (candle.close - candle.low) / range : 0.5;
};

const getWindowHigh = (
  candles: TrendFollowingCandle[],
  endIndex: number,
  lookbackBars: number,
) => {
  const start = Math.max(0, endIndex - lookbackBars);
  const window = candles.slice(start, endIndex);
  return window.length ? Math.max(...window.map((candle) => candle.high)) : null;
};

const getWindowLow = (
  candles: TrendFollowingCandle[],
  endIndex: number,
  lookbackBars: number,
) => {
  const start = Math.max(0, endIndex - lookbackBars + 1);
  const window = candles.slice(start, endIndex + 1);
  return window.length ? Math.min(...window.map((candle) => candle.low)) : null;
};

const createRiskFields = (
  candle: TrendFollowingCandle,
  recentLow: number,
  trendExitLevel: number,
) => {
  const entryPrice = candle.close;
  const structureStop = Math.min(candle.low, recentLow);
  const initialStop =
    structureStop < entryPrice ? structureStop : entryPrice * 0.98;
  const riskPerShare = Math.max(entryPrice - initialStop, entryPrice * 0.005);

  return {
    entryPrice,
    initialStop,
    stopLevel: initialStop,
    riskPerShare,
    partialTakeProfitLevel: entryPrice + riskPerShare * 2,
    trendExitLevel,
  };
};

const buildEntryReason = ({
  label,
  sma20SlopePct,
  sma50SlopePct,
  volumeRatio,
  closeLocation,
  recentHigh,
}: {
  label: string;
  sma20SlopePct: number;
  sma50SlopePct: number;
  volumeRatio: number;
  closeLocation: number;
  recentHigh: number | null;
}) => {
  const parts = [
    label,
    `SMA20 slope ${(sma20SlopePct * 100).toFixed(2)}%`,
    `SMA50 slope ${(sma50SlopePct * 100).toFixed(2)}%`,
    `volume ${volumeRatio.toFixed(2)}x`,
    `close location ${closeLocation.toFixed(2)}`,
  ];
  if (isNumber(recentHigh)) {
    parts.push(`20-bar high ${recentHigh.toFixed(2)}`);
  }
  return parts.join(", ");
};

export const calculateTrendFollowingSignals = ({
  candles,
  sma5,
  sma20,
  sma50,
  volumeMa20,
  includeDiagnostics = false,
  thresholds: thresholdOverrides,
}: CalculateTrendFollowingSignalsOptions): TrendFollowingResult => {
  const thresholds = {
    ...TREND_FOLLOWING_THRESHOLDS,
    ...thresholdOverrides,
  };
  const signals: TrendFollowingSignal[] = [];
  const features: TrendFollowingFeature[] = [];
  let activePosition: ActiveTrendPosition | null = null;
  let lastEntryIndex = -thresholds.entryCooldownBars;
  let lastWarningIndex = -thresholds.warningCooldownBars;
  let rejectedSetups = 0;
  let latestRejectionReasons: string[] = [];

  if (candles.length < thresholds.minimumHistoryBars) {
    const latestCandle = candles[candles.length - 1];
    return {
      signals,
      latestFeature: latestCandle
        ? {
            time: latestCandle.time,
            sma5: null,
            sma20: null,
            sma50: null,
            sma20SlopePct: null,
            sma50SlopePct: null,
            volumeMa20: null,
            volumeRatio: null,
            recentHigh20: null,
            recentLow5: null,
            closeLocation: getCloseLocation(latestCandle),
            rejectionReasons: ["Insufficient 50-bar trend history."],
          }
        : null,
      activeSetup: null,
      diagnostics: includeDiagnostics
        ? {
            insufficientHistory: true,
            rejectedSetups: 0,
            latestRejectionReasons: ["Insufficient 50-bar trend history."],
          }
        : undefined,
    };
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const sma5Value = sma5[index];
    const sma20Value = sma20[index];
    const sma50Value = sma50[index];
    const volumeMa20Value = volumeMa20[index];
    const previousSma5 = sma5[index - 1];
    const previousSma20 = sma20[index - 1];
    const slopeBase = sma20[index - thresholds.sma20SlopeLookbackBars];
    const sma50SlopeBase = sma50[index - thresholds.sma50SlopeLookbackBars];
    const recentHigh20 = getWindowHigh(
      candles,
      index,
      thresholds.breakoutLookbackBars,
    );
    const recentLow5 = getWindowLow(
      candles,
      index,
      thresholds.structureLowLookbackBars,
    );
    const closeLocation = getCloseLocation(candle);
    const volumeRatio =
      isNumber(volumeMa20Value) && volumeMa20Value > 0
        ? candle.volume / volumeMa20Value
        : null;
    const sma20SlopePct =
      isNumber(sma20Value) && isNumber(slopeBase) && slopeBase > 0
        ? sma20Value / slopeBase - 1
        : null;
    const sma50SlopePct =
      isNumber(sma50Value) && isNumber(sma50SlopeBase) && sma50SlopeBase > 0
        ? sma50Value / sma50SlopeBase - 1
        : null;

    const feature: TrendFollowingFeature = {
      time: candle.time,
      sma5: isNumber(sma5Value) ? sma5Value : null,
      sma20: isNumber(sma20Value) ? sma20Value : null,
      sma50: isNumber(sma50Value) ? sma50Value : null,
      sma20SlopePct,
      sma50SlopePct,
      volumeMa20: isNumber(volumeMa20Value) ? volumeMa20Value : null,
      volumeRatio,
      recentHigh20,
      recentLow5,
      closeLocation,
      rejectionReasons: [],
    };

    const stopHit =
      activePosition &&
      (candle.close <= activePosition.initialStop ||
        (isNumber(sma50Value) && candle.close < sma50Value));
    if (activePosition && stopHit) {
      const exitLevel = isNumber(sma50Value)
        ? Math.max(activePosition.initialStop, sma50Value)
        : activePosition.initialStop;
      signals.push({
        time: candle.time,
        type: "sell",
        action: "trend-exit",
        label: "Trend Exit",
        reason: `Close broke SMA50 trend exit level ${exitLevel.toFixed(2)}.`,
        entryPrice: activePosition.entryPrice,
        initialStop: activePosition.initialStop,
        stopLevel: exitLevel,
        riskPerShare: activePosition.riskPerShare,
        partialTakeProfitLevel: activePosition.partialTakeProfitLevel,
        trendExitLevel: exitLevel,
      });
      activePosition = null;
      features.push(feature);
      continue;
    }

    const warningHit =
      activePosition &&
      isNumber(sma20Value) &&
      isNumber(sma50Value) &&
      candle.close < sma20Value &&
      candle.close >= sma50Value &&
      index - lastWarningIndex >= thresholds.warningCooldownBars;
    if (activePosition && warningHit) {
      signals.push({
        time: candle.time,
        type: "sell",
        action: "management-warning",
        label: "Trend Management Warning",
        reason: "Close slipped below SMA20 while the SMA50 trend hold remains intact.",
        entryPrice: activePosition.entryPrice,
        initialStop: activePosition.initialStop,
        stopLevel: activePosition.initialStop,
        riskPerShare: activePosition.riskPerShare,
        partialTakeProfitLevel: activePosition.partialTakeProfitLevel,
        trendExitLevel: sma50Value,
      });
      lastWarningIndex = index;
    }

    const hasRequiredNumbers =
      isNumber(sma5Value) &&
      isNumber(sma20Value) &&
      isNumber(sma50Value) &&
      isNumber(previousSma5) &&
      isNumber(previousSma20) &&
      isNumber(sma20SlopePct) &&
      isNumber(sma50SlopePct) &&
      isNumber(volumeRatio) &&
      isNumber(recentLow5);

    if (!activePosition && hasRequiredNumbers) {
      const priceAboveSma20 = candle.close > sma20Value;
      const sma5AboveSma20 = sma5Value > sma20Value;
      const sma5CrossUp = previousSma5 <= previousSma20 && sma5AboveSma20;
      const sma20Rising = sma20SlopePct >= thresholds.minSma20SlopePct;
      const stage2Trend =
        candle.close > sma50Value &&
        sma20Value > sma50Value &&
        sma50SlopePct >= thresholds.minSma50SlopePct;
      const volumeConfirmed = volumeRatio >= thresholds.volumeRatioThreshold;
      const breakoutVolumeConfirmed =
        volumeRatio >= thresholds.breakoutVolumeRatioThreshold;
      const strongClose = closeLocation >= thresholds.closeStrengthThreshold;
      const breakout =
        isNumber(recentHigh20) &&
        candle.close > recentHigh20 &&
        sma20Rising &&
        stage2Trend &&
        breakoutVolumeConfirmed;
      const continuation =
        priceAboveSma20 &&
        sma20Rising &&
        stage2Trend &&
        volumeConfirmed &&
        strongClose &&
        (sma5CrossUp || sma5AboveSma20);
      const cooledDown =
        index - lastEntryIndex >= thresholds.entryCooldownBars;

      if ((breakout || continuation) && cooledDown) {
        const risk = createRiskFields(candle, recentLow5, sma50Value);
        const action: TrendFollowingAction = breakout
          ? "breakout-entry"
          : "entry";
        const label = breakout
          ? "Trend Breakout Entry"
          : "Trend Follow Entry";
        const reason = buildEntryReason({
          label: breakout ? "20-bar breakout" : "SMA5/SMA20 continuation",
          sma20SlopePct,
          sma50SlopePct,
          volumeRatio,
          closeLocation,
          recentHigh: recentHigh20,
        });

        signals.push({
          time: candle.time,
          type: "buy",
          action,
          label,
          reason,
          ...risk,
          volumeRatio,
        });
        activePosition = {
          entryTime: candle.time,
          entryPrice: risk.entryPrice,
          initialStop: risk.initialStop,
          riskPerShare: risk.riskPerShare,
          partialTakeProfitLevel: risk.partialTakeProfitLevel,
          trendExitLevel: risk.trendExitLevel,
        };
        lastEntryIndex = index;
      } else if (priceAboveSma20 || sma5CrossUp || sma5AboveSma20 || breakout) {
        const reasons = [
          !sma20Rising ? "SMA20 is flat or falling." : null,
          !stage2Trend ? "SMA20/SMA50 trend stack failed." : null,
          !volumeConfirmed ? "Volume confirmation failed." : null,
          !strongClose ? "Close strength failed." : null,
          !priceAboveSma20 ? "Close is not above SMA20." : null,
          !cooledDown ? "Entry cooldown is active." : null,
        ].filter((reason): reason is string => reason !== null);
        if (reasons.length) {
          rejectedSetups += 1;
          latestRejectionReasons = reasons;
          feature.rejectionReasons = reasons;
        }
      }
    }

    features.push(feature);
  }

  return {
    signals,
    latestFeature: features[features.length - 1] ?? null,
    activeSetup: activePosition,
    diagnostics: includeDiagnostics
      ? {
          insufficientHistory: false,
          rejectedSetups,
          latestRejectionReasons,
        }
      : undefined,
  };
};
