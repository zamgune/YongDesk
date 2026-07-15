import type { MarketCandle } from "@/lib/market-data/types";

export type ConfirmedDivergenceEvent = {
  direction: "bullish" | "bearish";
  previousOccurredIndex: number;
  occurredIndex: number;
  confirmedIndex: number;
  previousOccurredAt: number;
  occurredAt: number;
  confirmedAt: number;
};

export type ConfirmedDivergenceMasks = {
  bullMask: boolean[];
  bearMask: boolean[];
  bullEvents: ConfirmedDivergenceEvent[];
  bearEvents: ConfirmedDivergenceEvent[];
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getConfirmedPivotIndices = (
  candles: MarketCandle[],
  window: number,
) => {
  const lowIndices: number[] = [];
  const highIndices: number[] = [];

  for (let index = window; index < candles.length - window; index += 1) {
    const pivotWindow = candles.slice(index - window, index + window + 1);
    const low = Math.min(...pivotWindow.map((candle) => candle.low));
    const high = Math.max(...pivotWindow.map((candle) => candle.high));
    if (candles[index].low === low) lowIndices.push(index);
    if (candles[index].high === high) highIndices.push(index);
  }

  return { lowIndices, highIndices };
};

const eventFor = ({
  candles,
  direction,
  previousOccurredIndex,
  occurredIndex,
  confirmationWindow,
}: {
  candles: MarketCandle[];
  direction: ConfirmedDivergenceEvent["direction"];
  previousOccurredIndex: number;
  occurredIndex: number;
  confirmationWindow: number;
}): ConfirmedDivergenceEvent => {
  const confirmedIndex = occurredIndex + confirmationWindow;
  const confirmationCandle = candles[confirmedIndex];
  const confirmedAt = isNumber(confirmationCandle.closeTime) &&
    confirmationCandle.closeTime >= confirmationCandle.time
    ? confirmationCandle.closeTime
    : confirmationCandle.time;
  return {
    direction,
    previousOccurredIndex,
    occurredIndex,
    confirmedIndex,
    previousOccurredAt: candles[previousOccurredIndex].time,
    occurredAt: candles[occurredIndex].time,
    confirmedAt,
  };
};

const calculateConfirmedDivergenceMasks = ({
  candles,
  values,
  window,
  evaluatedAt,
  bullish,
  bearish,
}: {
  candles: MarketCandle[];
  values: Array<number | null>;
  window: number;
  evaluatedAt: number;
  bullish: (current: number, previous: number, currentIndex: number, previousIndex: number) => boolean;
  bearish: (current: number, previous: number, currentIndex: number, previousIndex: number) => boolean;
}): ConfirmedDivergenceMasks => {
  const confirmationWindow = Math.max(1, Math.floor(window));
  const bullMask = new Array<boolean>(candles.length).fill(false);
  const bearMask = new Array<boolean>(candles.length).fill(false);
  const bullEvents: ConfirmedDivergenceEvent[] = [];
  const bearEvents: ConfirmedDivergenceEvent[] = [];
  const { lowIndices, highIndices } = getConfirmedPivotIndices(candles, confirmationWindow);

  for (let index = 1; index < lowIndices.length; index += 1) {
    const occurredIndex = lowIndices[index];
    const previousOccurredIndex = lowIndices[index - 1];
    const current = values[occurredIndex];
    const previous = values[previousOccurredIndex];
    if (
      isNumber(current) &&
      isNumber(previous) &&
      bullish(current, previous, occurredIndex, previousOccurredIndex)
    ) {
      const event = eventFor({
        candles,
        direction: "bullish",
        previousOccurredIndex,
        occurredIndex,
        confirmationWindow,
      });
      if (event.confirmedAt > evaluatedAt) continue;
      bullMask[event.confirmedIndex] = true;
      bullEvents.push(event);
    }
  }

  for (let index = 1; index < highIndices.length; index += 1) {
    const occurredIndex = highIndices[index];
    const previousOccurredIndex = highIndices[index - 1];
    const current = values[occurredIndex];
    const previous = values[previousOccurredIndex];
    if (
      isNumber(current) &&
      isNumber(previous) &&
      bearish(current, previous, occurredIndex, previousOccurredIndex)
    ) {
      const event = eventFor({
        candles,
        direction: "bearish",
        previousOccurredIndex,
        occurredIndex,
        confirmationWindow,
      });
      if (event.confirmedAt > evaluatedAt) continue;
      bearMask[event.confirmedIndex] = true;
      bearEvents.push(event);
    }
  }

  return { bullMask, bearMask, bullEvents, bearEvents };
};

export const calculateConfirmedRsiDivergence = (
  candles: MarketCandle[],
  rsiValues: Array<number | null>,
  window = 5,
  evaluatedAt = Number.POSITIVE_INFINITY,
) => calculateConfirmedDivergenceMasks({
  candles,
  values: rsiValues,
  window,
  evaluatedAt,
  bullish: (current, previous, currentIndex, previousIndex) =>
    candles[currentIndex].low <= candles[previousIndex].low &&
    current > previous &&
    current < 40,
  bearish: (current, previous, currentIndex, previousIndex) =>
    candles[currentIndex].high >= candles[previousIndex].high &&
    current < previous &&
    current > 60,
});

export const calculateConfirmedObvDivergence = (
  candles: MarketCandle[],
  obvValues: Array<number | null>,
  window = 5,
  evaluatedAt = Number.POSITIVE_INFINITY,
) => calculateConfirmedDivergenceMasks({
  candles,
  values: obvValues,
  window,
  evaluatedAt,
  bullish: (current, previous, currentIndex, previousIndex) =>
    candles[currentIndex].low <= candles[previousIndex].low && current > previous,
  bearish: (current, previous, currentIndex, previousIndex) =>
    candles[currentIndex].high >= candles[previousIndex].high && current < previous,
});
