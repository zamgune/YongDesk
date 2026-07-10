import type {
  CryptoExecutionMode,
  CryptoFeatureRow,
  CryptoSignal,
  SignalSide,
  SignalSet,
} from "./types.mts";

const SIGNAL_CLUSTER_GAP_BARS = 4;

const buildReasons = (row: CryptoFeatureRow) => {
  const reasons: string[] = [];
  const side = row.side ?? "buy";
  const laneNote = row.notes.find((note) => note.startsWith("lane:"));
  const lowerTfNote = row.notes.find((note) => note.startsWith("lower-tf:"));
  const recentOverbought = row.notes.includes("recent-overbought");
  const recentBreakout = row.notes.includes("recent-breakout");
  const previousBreakoutHold = row.notes.includes("prev-breakout-hold");
  const previousBreakoutDepth = row.notes.includes("prev-breakout-depth");
  reasons.push(`side=${side}`);
  if (typeof row.return3 === "number") {
    reasons.push(`R3=${(row.return3 * 100).toFixed(2)}%`);
  }
  if (typeof row.return5 === "number") {
    reasons.push(`R5=${(row.return5 * 100).toFixed(2)}%`);
  }
  if (typeof row.volumeRatio20 === "number") {
    reasons.push(`VR20=${row.volumeRatio20.toFixed(2)}x`);
  }
  if (typeof row.rsi14 === "number") {
    reasons.push(`RSI14=${row.rsi14.toFixed(1)}`);
  }
  if (side === "buy" && typeof row.breakdownDepth20 === "number") {
    reasons.push(`BD20=${(row.breakdownDepth20 * 100).toFixed(2)}%`);
  }
  if (side === "sell" && typeof row.breakoutDepth20 === "number") {
    reasons.push(`BO20=${(row.breakoutDepth20 * 100).toFixed(2)}%`);
  }
  reasons.push(`shapeGate=${row.signalFamily ? "pass" : "fail"}`);
  if (side === "buy" && typeof row.breakdownDepth20 === "number") {
    reasons.push(`parentBD20=${(row.breakdownDepth20 * 100).toFixed(2)}%`);
  }
  if (side === "sell" && typeof row.breakoutDepth20 === "number") {
    reasons.push(`parentBO20=${(row.breakoutDepth20 * 100).toFixed(2)}%`);
  }
  if (typeof row.primaryLowerTf?.excursionDepth20 === "number") {
    reasons.push(
      `${side === "buy" ? "primaryBreakdown20" : "primaryBreakout20"}=${(
        row.primaryLowerTf.excursionDepth20 * 100
      ).toFixed(2)}%`,
    );
  }
  if (
    typeof row.rsi7 === "number" &&
    ((side === "buy" && row.rsi7 <= 30) || (side === "sell" && row.rsi7 >= 70))
  ) {
    reasons.push(`RSI7=${row.rsi7.toFixed(1)}`);
  }
  if (
    typeof row.zScore20 === "number" &&
    ((side === "buy" && row.zScore20 <= -1.2) ||
      (side === "sell" && row.zScore20 >= 1.2))
  ) {
    reasons.push(`Z20=${row.zScore20.toFixed(2)}`);
  }
  if (
    side === "buy" &&
    typeof row.bbLower20_2 === "number" &&
    row.bar.low < row.bbLower20_2
  ) {
    reasons.push("BB lower break");
  }
  if (
    side === "sell" &&
    typeof row.bbUpper20_2 === "number" &&
    row.bar.high > row.bbUpper20_2
  ) {
    reasons.push("BB upper break");
  }
  reasons.push(`recovery=${row.recoveryRatio?.toFixed(2) ?? "-"}`);
  reasons.push(`rejection=${row.rejectionRatio?.toFixed(2) ?? "-"}`);
  reasons.push(`lowerWick=${row.wickBodyRatio?.toFixed(2) ?? "-"}`);
  reasons.push(`upperWick=${row.upperWickBodyRatio?.toFixed(2) ?? "-"}`);
  if (laneNote) {
    reasons.push(`lane=${laneNote.slice("lane:".length)}`);
  }
  if (lowerTfNote) {
    reasons.push(`lowerTf=${lowerTfNote.slice("lower-tf:".length)}`);
  }
  if (side === "sell" && recentOverbought) {
    reasons.push("recentOverboughtWithin2");
  }
  if (side === "sell" && recentBreakout) {
    reasons.push("recentBreakoutSeenWithin2");
  }
  if (side === "sell" && previousBreakoutHold) {
    reasons.push("previousBreakoutHold");
  }
  if (side === "sell" && previousBreakoutDepth) {
    reasons.push("previousBreakoutDepth");
  }
  reasons.push(
    `type=${
      side === "buy"
        ? row.flushSignal
          ? "flush"
          : row.capitulationSignal
            ? "capitulation"
          : row.reboundSignal
            ? "rebound"
            : "none"
        : row.rejectionSignal
          ? "rejection"
          : row.upthrustSignal
            ? "upthrust"
            : row.blowoffSignal
              ? "blowoff"
              : "none"
    }`,
  );
  reasons.push(`family=${row.signalFamily ?? "none"}`);
  reasons.push(`trend=${row.htfPassed ? "up" : "down"}`);
  if (row.primaryLowerTf?.passed) {
    reasons.push(
      `${row.primaryLowerTf.interval} ${
        side === "buy" ? "range reclaim pass" : "range reject pass"
      } (${(
        (row.primaryLowerTf.excursionDepth20 ?? 0) * 100
      ).toFixed(2)}%)`,
    );
  }
  if (row.secondaryLowerTf?.passed) {
    reasons.push(`${row.secondaryLowerTf.interval} bonus pass`);
  }
  reasons.push(`score=${row.score}`);
  return reasons;
};

const choosePreferredSignal = (left: CryptoSignal, right: CryptoSignal) => {
  if (right.score !== left.score) {
    return right.score > left.score ? right : left;
  }
  return right.signalIndex < left.signalIndex ? right : left;
};

const dedupeByEntryIndex = (signals: CryptoSignal[]) => {
  const deduped = new Map<number, CryptoSignal>();

  for (const signal of signals) {
    const existing = deduped.get(signal.entryIndex);
    deduped.set(
      signal.entryIndex,
      existing ? choosePreferredSignal(existing, signal) : signal,
    );
  }

  return [...deduped.values()].sort((left, right) => left.entryIndex - right.entryIndex);
};

const collapseSignalClusters = (signals: CryptoSignal[]) => {
  const clustered: CryptoSignal[] = [];

  for (const signal of signals) {
    const last = clustered[clustered.length - 1];
    if (!last || signal.signalIndex - last.signalIndex > SIGNAL_CLUSTER_GAP_BARS) {
      clustered.push(signal);
      continue;
    }

    // Keep the latest signal inside a capitulation cluster to reduce duplicate markers.
    clustered[clustered.length - 1] = signal;
  }

  return clustered;
};

const createSignal = ({
  row,
  symbol,
  side,
  mode,
  entryIndex,
  entryTime,
  confirmPassed,
  htfPassed,
}: {
  row: CryptoFeatureRow;
  symbol: string;
  side: SignalSide;
  mode: CryptoExecutionMode;
  entryIndex: number;
  entryTime: number;
  confirmPassed: boolean;
  htfPassed: boolean;
}): CryptoSignal | null => {
  if (typeof row.atr14 !== "number") {
    return null;
  }

  return {
    symbol,
    timeframe: row.timeframe,
    side,
    direction: side === "buy" ? "long" : "short",
    mode,
    signalFamily: row.signalFamily,
    signalLane: row.signalLane,
    signalIndex: row.index,
    signalTime: row.bar.closeTime,
    entryIndex,
    entryTime,
    score: row.score,
    reasons: buildReasons(row),
    stopLevel:
      side === "buy" ? row.bar.low - row.atr14 * 0.2 : row.bar.high + row.atr14 * 0.2,
    signalLow: row.bar.low,
    signalHigh: row.bar.high,
    atr14: row.atr14,
    confirmPassed,
    htfPassed,
  };
};

export const generateCryptoSignals = ({
  symbol,
  side = "buy",
  featureRows,
}: {
  symbol: string;
  side?: SignalSide;
  featureRows: CryptoFeatureRow[];
}) => {
  const signals: SignalSet = {
    A: [],
    B: [],
  };

  for (let index = 0; index < featureRows.length; index += 1) {
    const row = featureRows[index];
    const isSetupActive = row.setupActive ?? row.panicBuySetup ?? false;
    if (!isSetupActive) {
      continue;
    }

    const nextRow = featureRows[index + 1];
    const nextNextRow = featureRows[index + 2];

    if (nextRow) {
      const modeASignal = createSignal({
        row,
        symbol,
        side,
        mode: "A",
        entryIndex: nextRow.index,
        entryTime: nextRow.bar.openTime,
        confirmPassed: true,
        htfPassed: row.htfPassed,
      });
      if (modeASignal) {
        signals.A.push(modeASignal);
      }
    }

    const confirmPassed = Boolean(
      nextRow &&
        (side === "buy"
          ? (nextRow.bar.close > row.bar.high) ||
            (typeof nextRow.ema5 === "number" &&
              nextRow.bar.close > nextRow.ema5 &&
              nextRow.bar.low >= row.bar.low)
          : (nextRow.bar.close < row.bar.low) ||
            (typeof nextRow.ema5 === "number" &&
              nextRow.bar.close < nextRow.ema5 &&
              nextRow.bar.high <= row.bar.high)),
    );

    if (nextRow && nextNextRow && confirmPassed) {
      const modeBSignal = createSignal({
        row,
        symbol,
        side,
        mode: "B",
        entryIndex: nextNextRow.index,
        entryTime: nextNextRow.bar.openTime,
        confirmPassed,
        htfPassed: nextRow.htfPassed,
      });
      if (modeBSignal) {
        signals.B.push(modeBSignal);
      }
    }
  }

  return {
    signalsByMode: {
      A: collapseSignalClusters(dedupeByEntryIndex(signals.A)),
      B: collapseSignalClusters(dedupeByEntryIndex(signals.B)),
    },
  };
};
