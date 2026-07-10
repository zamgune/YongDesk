import type {
  AutomationLastSimulation,
  AutomationMarket,
  AutomationMode,
  AutomationOrderSizing,
  AutomationPriceAnchor,
  AutomationPreset,
  AutomationStrategyConfig,
  GridPlan,
  GridRung,
  LadderStep,
  LoopGridPlan,
} from "@/domain/automation";

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const stringOr = (value: unknown, fallback: string, maxLength = 120) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, maxLength);
};

const marketOr = (value: unknown): AutomationMarket =>
  value === "KR" || value === "CRYPTO" ? value : "US";

const executionVenueOr = (value: unknown, market: AutomationMarket) => {
  if (market === "CRYPTO") {
    return value === "bithumb" ? "bithumb" as const : "upbit" as const;
  }
  return "toss" as const;
};

const presetOr = (value: unknown): AutomationPreset => {
  switch (value) {
    case "box-range":
    case "magic-split":
    case "one-percent-loop":
    case "defensive-split":
    case "custom":
      return value;
    default:
      return "support-rebound";
  }
};

const parseLadder = (value: unknown, supportPrice: number, resistancePrice: number): LadderStep[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 8).map((entry, index) => {
    const row = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const side = row.side === "sell" ? "sell" : "buy";
    return {
      id: stringOr(row.id, `step-${index + 1}`, 48),
      side,
      price: numberOr(row.price, side === "sell" ? resistancePrice : supportPrice),
      notional: numberOr(row.notional, 1000),
      condition: stringOr(row.condition, side === "sell" ? "저항선 도달" : "지지선 근접", 160),
    };
  });
};

const modeOr = (value: unknown): AutomationMode =>
  value === "percent-grid" || value === "loop-grid" ? value : "ladder";

const parseOrderSizing = (value: unknown): AutomationOrderSizing | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (row.mode === "quantity") {
    const quantity = Number(row.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? { mode: "quantity", quantity } : undefined;
  }
  if (row.mode === "notional") {
    const notional = Number(row.notional);
    return Number.isFinite(notional) && notional > 0 ? { mode: "notional", notional } : undefined;
  }
  return undefined;
};

const parseGrid = (value: unknown, currentPrice: number): GridPlan | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const basePrice = numberOr(row.basePrice, currentPrice);
  const rungsRaw = Array.isArray(row.rungs) ? row.rungs : [];
  const rungs: GridRung[] = rungsRaw.slice(0, 20).map((entry, index) => {
    const r = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return {
      index: Math.trunc(numberOr(r.index, index + 1)),
      buyDropPct: numberOr(r.buyDropPct, index + 1),
      sellRisePct: numberOr(r.sellRisePct, index + 1),
      notional: numberOr(r.notional, 1000),
    };
  });
  return { basePrice, rungs };
};

const parseLoopGrid = (value: unknown, currentPrice: number): LoopGridPlan | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  return {
    anchorPrice: numberOr(row.anchorPrice, currentPrice),
    buyDropPct: numberOr(row.buyDropPct, 1),
    sellRisePct: numberOr(row.sellRisePct, 1),
    notional: numberOr(row.notional, 1000),
    cooldownMinutes: Math.max(0, Math.trunc(numberOr(row.cooldownMinutes, 5))),
  };
};

const parsePriceAnchor = (value: unknown): AutomationPriceAnchor | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const source = row.source === "market" || row.source === "holding-average" ? row.source : "manual";
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) {
    return undefined;
  }
  return {
    source,
    price,
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : null,
  };
};

const stringArrayOr = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
    : [];

const parseLastSimulation = (value: unknown): AutomationLastSimulation | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.configHash !== "string" || typeof row.simulatedAt !== "string") {
    return undefined;
  }
  return {
    configHash: row.configHash,
    passed: row.passed === true,
    blockers: stringArrayOr(row.blockers),
    warnings: stringArrayOr(row.warnings),
    expectedReturnPct: numberOr(row.expectedReturnPct, 0),
    expectedLossPct: numberOr(row.expectedLossPct, 0),
    summary: stringOr(row.summary, "시뮬레이션 기록", 240),
    simulatedAt: row.simulatedAt,
  };
};

export const parseStrategyConfigPayload = (
  payload: Record<string, unknown>,
  userId: string,
  fallbackId?: string,
): AutomationStrategyConfig => {
  const supportPrice = numberOr(payload.supportPrice, 90);
  const resistancePrice = numberOr(payload.resistancePrice, 110);
  const now = new Date().toISOString();
  const market = marketOr(payload.market);
  return {
    id: typeof payload.id === "string" && payload.id ? payload.id : fallbackId ?? "draft",
    userId,
    name: stringOr(payload.name, "지지반등 베타 전략"),
    symbol: stringOr(payload.symbol, "AAPL", 24).toUpperCase(),
    market,
    executionVenue: executionVenueOr(payload.executionVenue, market),
    preset: presetOr(payload.preset),
    status: payload.status === "enabled" || payload.status === "disabled" ? payload.status : "draft",
    mode: modeOr(payload.mode),
    orderSizing: parseOrderSizing(payload.orderSizing),
    supportPrice,
    resistancePrice,
    currentPrice: numberOr(payload.currentPrice, (supportPrice + resistancePrice) / 2),
    ladder: parseLadder(payload.ladder, supportPrice, resistancePrice),
    grid: parseGrid(payload.grid, numberOr(payload.currentPrice, (supportPrice + resistancePrice) / 2)),
    loop: parseLoopGrid(payload.loop, numberOr(payload.currentPrice, (supportPrice + resistancePrice) / 2)),
    priceAnchor: parsePriceAnchor(payload.priceAnchor),
    lastSimulation: parseLastSimulation(payload.lastSimulation),
    riskLimits: {
      maxDailyBuys: numberOr((payload.riskLimits as Record<string, unknown> | undefined)?.maxDailyBuys, 2),
      maxDailySells: numberOr((payload.riskLimits as Record<string, unknown> | undefined)?.maxDailySells, 2),
      maxPositionValue: numberOr((payload.riskLimits as Record<string, unknown> | undefined)?.maxPositionValue, 5000),
      maxLossPct: numberOr((payload.riskLimits as Record<string, unknown> | undefined)?.maxLossPct, 5),
      maxHoldHours: numberOr((payload.riskLimits as Record<string, unknown> | undefined)?.maxHoldHours, 48),
    },
    exitRules: {
      takeProfitPct: numberOr((payload.exitRules as Record<string, unknown> | undefined)?.takeProfitPct, 4),
      stopLossPct: numberOr((payload.exitRules as Record<string, unknown> | undefined)?.stopLossPct, 3),
      rescueMode:
        (payload.exitRules as Record<string, unknown> | undefined)?.rescueMode === "disable-only"
          ? "disable-only"
          : "cancel-and-liquidate",
    },
    createdAt: now,
    updatedAt: now,
  };
};
