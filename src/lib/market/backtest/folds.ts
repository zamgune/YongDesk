import type { ChronologicalFoldSet } from "./types.ts";
import { assertUnixSeconds } from "./time.ts";

const requirePositiveInteger = (name: string, value: number) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
};

export const createChronologicalFolds = ({
  timestamps,
  initialTrainingSize,
  validationSize,
  stepSize = validationSize,
  holdoutSize,
}: {
  timestamps: number[];
  initialTrainingSize: number;
  validationSize: number;
  stepSize?: number;
  holdoutSize: number;
}): ChronologicalFoldSet => {
  requirePositiveInteger("initialTrainingSize", initialTrainingSize);
  requirePositiveInteger("validationSize", validationSize);
  requirePositiveInteger("stepSize", stepSize);
  if (!Number.isInteger(holdoutSize) || holdoutSize < 0) {
    throw new Error("holdoutSize must be a non-negative integer.");
  }
  timestamps.forEach((timestamp, index) =>
    assertUnixSeconds(`timestamps[${index}]`, timestamp),
  );
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] <= timestamps[index - 1]) {
      throw new Error("timestamps must be strictly increasing.");
    }
  }
  if (timestamps.length < initialTrainingSize + validationSize + holdoutSize) {
    throw new Error("Not enough timestamps for the requested folds and holdout.");
  }

  const validationLimit = timestamps.length - holdoutSize;
  const folds: ChronologicalFoldSet["folds"] = [];
  let validationStart = initialTrainingSize;
  while (validationStart + validationSize <= validationLimit) {
    const validationEnd = validationStart + validationSize - 1;
    folds.push({
      id: `fold-${String(folds.length + 1).padStart(2, "0")}`,
      train: {
        startIndex: 0,
        endIndex: validationStart - 1,
        startTime: timestamps[0],
        endTime: timestamps[validationStart - 1],
      },
      validation: {
        startIndex: validationStart,
        endIndex: validationEnd,
        startTime: timestamps[validationStart],
        endTime: timestamps[validationEnd],
      },
    });
    validationStart += stepSize;
  }

  const holdoutStart = timestamps.length - holdoutSize;
  return {
    folds,
    holdout:
      holdoutSize > 0
        ? {
            startIndex: holdoutStart,
            endIndex: timestamps.length - 1,
            startTime: timestamps[holdoutStart],
            endTime: timestamps[timestamps.length - 1],
          }
        : null,
  };
};
