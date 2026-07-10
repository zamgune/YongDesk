import { createHash, randomUUID } from "node:crypto";

import type {
  AutomationLastSimulation,
  AutomationOrderIntentDraft,
  AutomationRiskCheck,
  AutomationSimulationResult,
  AutomationStrategyConfig,
} from "@/domain/automation";
import { resolveOrderSizing } from "@/use-cases/trading/resolve-order-sizing";

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const MAX_REASONABLE_PERCENT = 80;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .filter((key) => row[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const getStrategyConfigHash = (config: AutomationStrategyConfig): string => {
  const hashable = { ...config } as Record<string, unknown>;
  delete hashable.status;
  delete hashable.createdAt;
  delete hashable.updatedAt;
  delete hashable.lastSimulation;
  return createHash("sha256").update(stableStringify(hashable)).digest("hex");
};

export const toAutomationLastSimulation = (
  result: AutomationSimulationResult,
): AutomationLastSimulation => ({
  configHash: result.configHash,
  passed: result.riskCheck.passed,
  blockers: result.riskCheck.blockers,
  warnings: result.riskCheck.warnings,
  expectedReturnPct: result.expectedReturnPct,
  expectedLossPct: result.expectedLossPct,
  summary: result.summary,
  simulatedAt: result.simulatedAt,
});

const loopBuyLevel = (anchorPrice: number, buyDropPct: number) =>
  anchorPrice * (1 - buyDropPct / 100);

const loopSellLevel = (entryPrice: number, sellRisePct: number) =>
  entryPrice * (1 + sellRisePct / 100);

const gridBuyLevel = (basePrice: number, buyDropPct: number) =>
  basePrice * (1 - buyDropPct / 100);

export const validateStrategyConfig = (config: AutomationStrategyConfig) => {
  const errors: string[] = [];
  if (!config.name.trim()) {
    errors.push("전략 이름이 필요합니다.");
  }
  if (!config.symbol.trim()) {
    errors.push("종목이 필요합니다.");
  }
  if (config.market === "CRYPTO" && config.executionVenue !== "upbit" && config.executionVenue !== "bithumb") {
    errors.push("코인 전략은 Upbit 또는 Bithumb 실행 거래소가 필요합니다.");
  }
  if (!Number.isFinite(config.currentPrice) || config.currentPrice <= 0) {
    errors.push("현재가가 필요합니다.");
  }
  if (config.orderSizing?.mode === "quantity") {
    if (!Number.isFinite(config.orderSizing.quantity) || config.orderSizing.quantity <= 0) {
      errors.push("고정 주문 수량은 0보다 커야 합니다.");
    } else if (config.market !== "CRYPTO" && !Number.isInteger(config.orderSizing.quantity)) {
      errors.push("주식 고정 주문 수량은 1주 이상의 정수여야 합니다.");
    }
  }
  if (
    config.orderSizing?.mode === "notional" &&
    (!Number.isFinite(config.orderSizing.notional) || config.orderSizing.notional <= 0)
  ) {
    errors.push("고정 주문 금액은 0보다 커야 합니다.");
  }

  if (config.mode === "percent-grid") {
    // 순환분할 그리드 모드: 그리드 차수 검증
    const grid = config.grid;
    if (!grid || !Number.isFinite(grid.basePrice) || grid.basePrice <= 0) {
      errors.push("그리드 기준가가 필요합니다.");
    }
    if (!grid || grid.rungs.length < 1) {
      errors.push("최소 1개 이상의 그리드 차수가 필요합니다.");
    }
    const sortedRungs = [...(grid?.rungs ?? [])].toSorted((a, b) => a.index - b.index);
    const seenIndexes = new Set<number>();
    let previousBuyDropPct = 0;
    for (const [position, rung] of sortedRungs.entries()) {
      if (!Number.isInteger(rung.index) || rung.index < 1) {
        errors.push("그리드 차수 번호는 1 이상의 정수여야 합니다.");
      } else if (seenIndexes.has(rung.index)) {
        errors.push(`${rung.index}차 그리드가 중복되었습니다.`);
      } else if (rung.index !== position + 1) {
        errors.push("그리드 차수 번호는 1부터 순서대로 이어져야 합니다.");
      }
      seenIndexes.add(rung.index);
      if (!Number.isFinite(rung.buyDropPct) || rung.buyDropPct <= 0 || rung.buyDropPct > MAX_REASONABLE_PERCENT) {
        errors.push(`${rung.index}차 매수 하락률은 0보다 커야 합니다.`);
      } else if (rung.buyDropPct <= previousBuyDropPct) {
        errors.push("그리드 매수 하락률은 차수가 올라갈수록 커져야 합니다.");
      }
      if (!Number.isFinite(rung.sellRisePct) || rung.sellRisePct <= 0 || rung.sellRisePct > MAX_REASONABLE_PERCENT) {
        errors.push(`${rung.index}차 매도 상승률은 0보다 커야 합니다.`);
      }
      if (!config.orderSizing && (!Number.isFinite(rung.notional) || rung.notional <= 0)) {
        errors.push(`${rung.index}차 투입 금액이 필요합니다.`);
      }
      if (Number.isFinite(rung.buyDropPct) && rung.buyDropPct > 0) {
        previousBuyDropPct = Math.max(previousBuyDropPct, rung.buyDropPct);
      }
    }
    const totalNotional = (grid?.rungs ?? []).reduce((sum, rung) => {
      const price = gridBuyLevel(grid!.basePrice, rung.buyDropPct);
      return sum + resolveOrderSizing({
        orderSizing: config.orderSizing,
        legacyNotional: rung.notional,
        price,
        fractionalQuantity: config.market === "CRYPTO",
      }).notional;
    }, 0);
    if (totalNotional > config.riskLimits.maxPositionValue) {
      errors.push("분할 주문 총액이 최대 보유 금액을 초과합니다.");
    }
    if ((grid?.rungs.length ?? 0) > config.riskLimits.maxDailyBuys) {
      errors.push("분할 매수 차수가 일일 최대 매수 횟수를 초과합니다.");
    }
    if (config.riskLimits.maxDailyBuys < 1 || config.riskLimits.maxDailySells < 1) {
      errors.push("매수/매도 횟수 제한이 필요합니다.");
    }
    if (config.riskLimits.maxPositionValue <= 0) {
      errors.push("최대 보유 금액 제한이 필요합니다.");
    }
    if (
      !Number.isFinite(config.riskLimits.maxLossPct) ||
      config.riskLimits.maxLossPct <= 0 ||
      config.riskLimits.maxLossPct > MAX_REASONABLE_PERCENT
    ) {
      errors.push("추가매수 중단선은 0보다 크고 80% 이하여야 합니다.");
    }
    return errors;
  }

  if (config.mode === "loop-grid") {
    const loop = config.loop;
    if (!loop || !Number.isFinite(loop.anchorPrice) || loop.anchorPrice <= 0) {
      errors.push("순환매매 기준가가 필요합니다.");
    }
    if (!loop || !Number.isFinite(loop.buyDropPct) || loop.buyDropPct <= 0 || loop.buyDropPct > MAX_REASONABLE_PERCENT) {
      errors.push("순환매매 매수 하락률은 0보다 커야 합니다.");
    }
    if (!loop || !Number.isFinite(loop.sellRisePct) || loop.sellRisePct <= 0 || loop.sellRisePct > MAX_REASONABLE_PERCENT) {
      errors.push("순환매매 매도 상승률은 0보다 커야 합니다.");
    }
    if (!loop || (!config.orderSizing && (!Number.isFinite(loop.notional) || loop.notional <= 0))) {
      errors.push("순환매매 1회 매수 금액이 필요합니다.");
    }
    if (loop && loop.cooldownMinutes < 0) {
      errors.push("순환매매 쿨다운은 0분 이상이어야 합니다.");
    }
    if (config.riskLimits.maxDailyBuys < 1 || config.riskLimits.maxDailySells < 1) {
      errors.push("매수/매도 횟수 제한이 필요합니다.");
    }
    if (config.riskLimits.maxPositionValue <= 0) {
      errors.push("최대 보유 금액 제한이 필요합니다.");
    }
    const loopNotional = loop
      ? resolveOrderSizing({
        orderSizing: config.orderSizing,
        legacyNotional: loop.notional,
        price: loopBuyLevel(loop.anchorPrice, loop.buyDropPct),
        fractionalQuantity: config.market === "CRYPTO",
      }).notional
      : 0;
    if (loop && loopNotional > config.riskLimits.maxPositionValue) {
      errors.push("순환매매 1회 매수 금액이 최대 보유 금액을 초과합니다.");
    }
    if (
      !Number.isFinite(config.riskLimits.maxLossPct) ||
      config.riskLimits.maxLossPct <= 0 ||
      config.riskLimits.maxLossPct > MAX_REASONABLE_PERCENT
    ) {
      errors.push("추가매수 중단선은 0보다 크고 80% 이하여야 합니다.");
    }
    return errors;
  }

  if (!Number.isFinite(config.supportPrice) || config.supportPrice <= 0) {
    errors.push("지지선 가격이 필요합니다.");
  }
  if (!Number.isFinite(config.resistancePrice) || config.resistancePrice <= 0) {
    errors.push("저항선 가격이 필요합니다.");
  }
  if (config.supportPrice >= config.resistancePrice) {
    errors.push("지지선은 저항선보다 낮아야 합니다.");
  }
  if (!config.ladder.length) {
    errors.push("최소 1개 이상의 분할 주문이 필요합니다.");
  }
  if (config.riskLimits.maxDailyBuys < 1 || config.riskLimits.maxDailySells < 1) {
    errors.push("매수/매도 횟수 제한이 필요합니다.");
  }
  if (config.riskLimits.maxPositionValue <= 0) {
    errors.push("최대 보유 금액 제한이 필요합니다.");
  }
  if (config.riskLimits.maxLossPct <= 0) {
    errors.push("최대 손실률 제한이 필요합니다.");
  }
  if (config.exitRules.stopLossPct <= 0 || config.exitRules.takeProfitPct <= 0) {
    errors.push("손절/익절 종료 조건이 필요합니다.");
  }
  return errors;
};

export const simulateAutomationStrategy = ({
  userId,
  config,
}: {
  userId: string;
  config: AutomationStrategyConfig;
}): AutomationSimulationResult => {
  const configHash = getStrategyConfigHash(config);
  if (config.mode === "percent-grid" && config.grid) {
    const blockers = validateStrategyConfig(config);
    const warnings = ["실거래 OFF 상태에서는 분할 주문의도 초안만 생성하고 broker 전송은 차단됩니다."];
    const rungs = [...config.grid.rungs].toSorted((a, b) => a.index - b.index);
    const totalNotional = rungs.reduce((sum, rung) => {
      const buyLevel = gridBuyLevel(config.grid!.basePrice, rung.buyDropPct);
      return sum + resolveOrderSizing({
        orderSizing: config.orderSizing,
        legacyNotional: rung.notional,
        price: buyLevel,
        fractionalQuantity: config.market === "CRYPTO",
      }).notional;
    }, 0);
    const riskCheck: AutomationRiskCheck = {
      passed: blockers.length === 0,
      blockers,
      warnings,
    };
    const now = new Date().toISOString();
    const orderIntents: AutomationOrderIntentDraft[] = rungs.map((rung) => {
      const buyLevel = roundMoney(gridBuyLevel(config.grid!.basePrice, rung.buyDropPct));
      const sellLevel = roundMoney(buyLevel * (1 + rung.sellRisePct / 100));
      const sizing = resolveOrderSizing({
        orderSizing: config.orderSizing,
        legacyNotional: rung.notional,
        price: buyLevel,
        fractionalQuantity: config.market === "CRYPTO",
      });
      return {
        id: randomUUID(),
        userId,
        strategyConfigId: config.id,
        symbol: config.symbol.trim().toUpperCase(),
        side: "buy",
        orderType: "limit",
        quantity: sizing.quantity,
        notional: roundMoney(sizing.notional),
        limitPrice: buyLevel,
        status: riskCheck.passed ? "draft" : "blocked",
        reason: riskCheck.passed
          ? `${rung.index}차 분할 매수 대기: 기준가 ${roundMoney(config.grid!.basePrice)} -${rung.buyDropPct}%, 익절선 ${sellLevel}`
          : riskCheck.blockers.join(" / "),
        createdAt: now,
      };
    });
    const deepestDropPct = rungs.reduce((max, rung) => Math.max(max, rung.buyDropPct), 0);
    const averageRisePct = rungs.length
      ? rungs.reduce((sum, rung) => sum + rung.sellRisePct, 0) / rungs.length
      : 0;
    return {
      strategyConfigId: config.id,
      configHash,
      mode: "paper",
      liveTradingEnabled: false,
      summary: riskCheck.passed
        ? `${rungs.length}차 분할 전략 시뮬레이션을 통과했습니다. 실제 주문은 제출되지 않습니다.`
        : "리스크 조건 때문에 분할 주문의도 초안이 차단되었습니다.",
      expectedReturnPct: roundMoney(averageRisePct),
      expectedLossPct: roundMoney(deepestDropPct),
      orderIntents,
      riskCheck,
      logs: [
        `기준가 ${roundMoney(config.grid.basePrice)}에서 ${rungs.length}개 차수를 대기합니다.`,
        `총 투입 예정 금액은 ${roundMoney(totalNotional)}입니다.`,
        `최대 하락 차수는 -${roundMoney(deepestDropPct)}%, 평균 익절폭은 +${roundMoney(averageRisePct)}%입니다.`,
      ],
      simulatedAt: now,
    };
  }

  if (config.mode === "loop-grid" && config.loop) {
    const blockers = validateStrategyConfig(config);
    const warnings = ["실거래 OFF 상태에서는 순환매매 조건 충족 여부만 확인하고 주문 전송은 차단됩니다."];
    const buyLevel = roundMoney(loopBuyLevel(config.loop.anchorPrice, config.loop.buyDropPct));
    const sellLevel = roundMoney(loopSellLevel(buyLevel, config.loop.sellRisePct));
    const riskCheck: AutomationRiskCheck = {
      passed: blockers.length === 0,
      blockers,
      warnings,
    };
    const now = new Date().toISOString();
    const sizing = resolveOrderSizing({
      orderSizing: config.orderSizing,
      legacyNotional: config.loop.notional,
      price: buyLevel,
      fractionalQuantity: config.market === "CRYPTO",
    });
    const orderIntents: AutomationOrderIntentDraft[] = [
      {
        id: randomUUID(),
        userId,
        strategyConfigId: config.id,
        symbol: config.symbol.trim().toUpperCase(),
        side: "buy",
        orderType: "limit",
        quantity: sizing.quantity,
        notional: roundMoney(sizing.notional),
        limitPrice: buyLevel,
        status: riskCheck.passed ? "draft" : "blocked",
        reason: riskCheck.passed
          ? `1% 순환매매 매수 대기: 기준가 ${roundMoney(config.loop.anchorPrice)} -${config.loop.buyDropPct}%`
          : riskCheck.blockers.join(" / "),
        createdAt: now,
      },
    ];
    return {
      strategyConfigId: config.id,
      configHash,
      mode: "paper",
      liveTradingEnabled: false,
      summary: riskCheck.passed
        ? "1% 순환매매 설정이 저장 가능합니다. 실제 주문은 제출되지 않습니다."
        : "리스크 조건 때문에 순환매매 주문의도 초안이 차단되었습니다.",
      expectedReturnPct: roundMoney(config.loop.sellRisePct),
      expectedLossPct: roundMoney(config.loop.buyDropPct),
      orderIntents,
      riskCheck,
      logs: [
        `매수선 ${buyLevel}, 1차 익절선 ${sellLevel}입니다.`,
        `매도 성공 후 다음 기준가는 매도가로 갱신됩니다.`,
        `쿨다운은 ${config.loop.cooldownMinutes}분입니다.`,
      ],
      simulatedAt: now,
    };
  }

  const blockers = validateStrategyConfig(config);
  const warnings: string[] = [];
  const boxWidthPct = ((config.resistancePrice - config.supportPrice) / config.supportPrice) * 100;
  const expectedReturnPct = ((config.resistancePrice - config.currentPrice) / config.currentPrice) * 100;
  const expectedLossPct = ((config.currentPrice - config.supportPrice) / config.currentPrice) * 100;
  const ladderNotional = config.ladder.reduce((sum, step) => sum + resolveOrderSizing({
    orderSizing: config.orderSizing,
    legacyNotional: step.notional,
    price: step.price,
    fractionalQuantity: config.market === "CRYPTO",
  }).notional, 0);

  if (boxWidthPct < 1.5) {
    warnings.push("박스 폭이 좁아 수수료와 슬리피지를 이기기 어려울 수 있습니다.");
  }
  if (ladderNotional > config.riskLimits.maxPositionValue) {
    blockers.push("분할 주문 총액이 최대 보유 금액을 초과합니다.");
  }
  if (expectedLossPct > config.riskLimits.maxLossPct) {
    blockers.push("현재가 기준 예상 손실률이 설정한 최대 손실률을 초과합니다.");
  }
  if (config.ladder.filter((step) => step.side === "buy").length > config.riskLimits.maxDailyBuys) {
    blockers.push("매수 차수가 일일 최대 매수 횟수를 초과합니다.");
  }
  if (config.ladder.filter((step) => step.side === "sell").length > config.riskLimits.maxDailySells) {
    blockers.push("매도 차수가 일일 최대 매도 횟수를 초과합니다.");
  }

  const riskCheck: AutomationRiskCheck = {
    passed: blockers.length === 0,
    blockers,
    warnings,
  };

  const now = new Date().toISOString();
  const orderIntents: AutomationOrderIntentDraft[] = config.ladder.map((step) => {
    const sizing = resolveOrderSizing({
      orderSizing: config.orderSizing,
      legacyNotional: step.notional,
      price: step.price,
      fractionalQuantity: config.market === "CRYPTO",
    });
    return {
      id: randomUUID(),
      userId,
      strategyConfigId: config.id,
      symbol: config.symbol.trim().toUpperCase(),
      side: step.side,
      orderType: "limit",
      quantity: sizing.quantity,
      notional: roundMoney(sizing.notional),
      limitPrice: roundMoney(step.price),
      status: riskCheck.passed ? "draft" : "blocked",
      reason: riskCheck.passed
        ? `${config.name} 모의 자동매매 ${step.condition}`
        : riskCheck.blockers.join(" / "),
      createdAt: now,
    };
  });

  const logs = [
    `실거래 비활성: ${orderIntents.length}개 주문의도 초안만 생성했습니다.`,
    `예상 상방 ${expectedReturnPct.toFixed(2)}%, 예상 하방 ${expectedLossPct.toFixed(2)}%입니다.`,
    config.exitRules.rescueMode === "cancel-and-liquidate"
      ? "종료 조건 발동 시 미체결 취소 + 보유 청산 의도를 생성합니다."
      : "종료 조건 발동 시 전략만 비활성화합니다.",
  ];

  return {
    strategyConfigId: config.id,
    configHash,
    mode: "paper",
    liveTradingEnabled: false,
    summary: riskCheck.passed
      ? "모의 자동매매 준비가 완료되었습니다. 실제 주문은 제출되지 않았습니다."
      : "리스크 조건 때문에 주문의도 초안이 차단 상태로 생성되었습니다.",
    expectedReturnPct: roundMoney(expectedReturnPct),
    expectedLossPct: roundMoney(expectedLossPct),
    orderIntents,
    riskCheck,
    logs,
    simulatedAt: now,
  };
};
