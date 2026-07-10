import { getLiveTradingGate } from "@/lib/automation/live-trading";
import { getUserTelegramChatId, sendTelegramMessage } from "@/lib/notify/telegram";
import { listStrategyConfigs } from "@/lib/automation/store";
import { getBrokerAccountPreference } from "@/lib/broker/account-preferences";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { createTossClient, TossApiError } from "@/lib/toss/client";
import { createTossBroker } from "@/adapters/toss/toss-broker";
import type { BrokerPort } from "@/ports/broker";
import { createOrderPrecheck } from "./precheck-order.ts";
import { runAutomationWorkerTick } from "./run-automation-worker.ts";
import { syncOrderFills } from "./sync-order-fills.ts";
import {
  applySyncUpdates,
  listOpenTrackedOrders,
  recordSubmittedOrder,
} from "@/lib/automation/order-tracker";

/**
 * 한 사용자의 자동매매 1사이클: 활성 전략 평가·주문(틱) + 추적 주문 체결 동기화.
 * 스케줄러(cron)와 수동 트리거가 공유합니다. 한 사용자의 실패가 다른 사용자에
 * 영향을 주지 않도록 내부 오류는 잡아서 요약에 담습니다.
 */

export type AutomationCycleSummary = {
  userId: string;
  status: "ran" | "skipped" | "error";
  reason?: string;
  liveTradingEnabled?: boolean;
  accountSeq?: number;
  strategies?: number;
  submitted?: number;
  rejected?: number;
  blocked?: number;
  syncedOrders?: number;
  newFills?: number;
};

const seoulToday = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export type RunUserAutomationCycleOptions = {
  /** macOS local sidecar는 주문 전 원장을 먼저 기록하는 BrokerPort를 주입한다. */
  broker?: BrokerPort;
  /** 외부 master gate 대신 local policy gate가 이미 평가된 경우에만 사용한다. */
  liveTradingEnabledOverride?: boolean;
};

export const runUserAutomationCycle = async (
  userId: string,
  options: RunUserAutomationCycleOptions = {},
): Promise<AutomationCycleSummary> => {
  try {
    const configs = (await listStrategyConfigs(userId)).filter((c) => c.status === "enabled" && c.market !== "CRYPTO");
    const credentials = await loadDecryptedCredentials(userId, "toss");
    if (!credentials) {
      return { userId, status: "skipped", reason: "no-credentials", strategies: configs.length };
    }
    if (configs.length === 0) {
      return { userId, status: "skipped", reason: "no-enabled-strategies" };
    }

    const client = createTossClient(credentials);
    const accounts = await client.listAccounts();
    const accountPreference = await getBrokerAccountPreference(userId, "toss");
    const brokerageAccounts = accounts.filter((account) => account.accountType === "BROKERAGE");
    const candidateAccounts = brokerageAccounts.length ? brokerageAccounts : accounts;
    if (candidateAccounts.length === 0) {
      return { userId, status: "skipped", reason: "no-account" };
    }
    const selectedAccount = accountPreference
      ? candidateAccounts.find((account) => account.accountSeq === accountPreference.accountSeq)
      : candidateAccounts.length === 1
        ? candidateAccounts[0]
        : null;
    if (accountPreference && !selectedAccount) {
      return { userId, status: "skipped", reason: "preferred-account-unavailable" };
    }
    if (!selectedAccount) {
      return { userId, status: "skipped", reason: "account-selection-required" };
    }
    const accountSeq = selectedAccount.accountSeq;

    const liveTradingGate = options.liveTradingEnabledOverride === undefined
      ? await getLiveTradingGate(userId)
      : null;
    const liveTradingEnabled = options.liveTradingEnabledOverride ?? liveTradingGate?.effective ?? false;

    const broker = options.broker ?? createTossBroker({ client, liveTradingEnabled });
    const precheck = createOrderPrecheck({
      accountSeq,
      getBuyingPower: (seq, currency) => client.getBuyingPower(seq, currency),
      getSellableQuantity: (seq, symbol) => client.getSellableQuantity(seq, symbol),
    });
    const today = seoulToday();

    const symbols = [...new Set(configs.map((c) => c.symbol.trim().toUpperCase()))];
    const prices = await client.getPrices(symbols);
    const priceBySymbol = new Map(prices.map((p) => [p.symbol.toUpperCase(), Number(p.lastPrice)]));

    let submitted = 0;
    let rejected = 0;
    let blocked = 0;
    const alertLines: string[] = [];

    for (const config of configs) {
      const marketPrice = priceBySymbol.get(config.symbol.trim().toUpperCase());
      if (marketPrice === undefined || !Number.isFinite(marketPrice)) {
        continue;
      }
      const tick = await runAutomationWorkerTick({
        userId,
        config,
        marketPrice,
        broker,
        liveTradingEnabled,
        accountSeq,
        today,
        precheck,
        resolveExitQuantity: async (symbol) => {
          const res = await client.getSellableQuantity(accountSeq, symbol);
          const qty = Number(res.sellableQuantity);
          return Number.isFinite(qty) ? qty : 0;
        },
        resolveEntryPrice: async (symbol) => {
          const holdings = await client.getHoldings(accountSeq, symbol);
          const item = holdings.items.find((h) => h.symbol.toUpperCase() === symbol);
          const avg = item ? Number(item.averagePurchasePrice) : NaN;
          return Number.isFinite(avg) ? avg : null;
        },
        resolveOpenOrderIds: async (symbol) => {
          const open = await client.getOpenOrders(accountSeq, symbol);
          return open.orders.map((o) => o.orderId);
        },
      });
      for (const order of tick.orders) {
        if (order.status === "submitted" && order.brokerOrderId) {
          submitted += 1;
          alertLines.push(
            `📤 주문 ${order.side === "buy" ? "매수" : "매도"} ${config.symbol.trim().toUpperCase()} ${order.quantity}주 @ ${order.limitPrice}`,
          );
          await recordSubmittedOrder({
            userId,
            brokerOrderId: order.brokerOrderId,
            clientOrderId: order.clientOrderId,
            accountSeq,
            strategyId: config.id,
            stepId: order.stepId,
            symbol: config.symbol.trim().toUpperCase(),
            side: order.side,
            quantity: order.quantity,
            limitPrice: order.limitPrice,
            submittedAt: tick.evaluatedAt,
          });
        } else if (order.status === "rejected") {
          rejected += 1;
        } else if (order.status === "blocked") {
          blocked += 1;
        }
      }
    }

    // 체결 동기화
    const trackedOrders = await listOpenTrackedOrders(userId, accountSeq);
    const sync = await syncOrderFills({
      userId,
      accountSeq,
      trackedOrders,
      fetcher: {
        getOpenOrders: (seq, symbol) => client.getOpenOrders(seq, symbol),
        getOrder: (seq, orderId) => client.getOrder(seq, orderId),
      },
    });
    await applySyncUpdates({ orderUpdates: sync.orderUpdates, newFills: sync.newFills });

    for (const fill of sync.newFills) {
      alertLines.push(
        `✅ 체결 ${fill.side === "buy" ? "매수" : "매도"} ${fill.symbol} ${fill.filledQuantity}주 @ ${fill.averageFilledPrice ?? "-"}`,
      );
    }
    if (alertLines.length > 0) {
      const chatId = await getUserTelegramChatId(userId);
      // 개인 chat_id가 없어 공용 채팅으로 갈 때만 사용자 구분 표시
      const header = `🤖 자동매매 (${liveTradingEnabled ? "실거래" : "모의"})${chatId ? "" : ` · 사용자 ${userId.slice(0, 8)}`}`;
      await sendTelegramMessage([header, ...alertLines].join("\n"), chatId);
    }

    return {
      userId,
      status: "ran",
      liveTradingEnabled,
      accountSeq,
      strategies: configs.length,
      submitted,
      rejected,
      blocked,
      syncedOrders: sync.orderUpdates.length,
      newFills: sync.newFills.length,
    };
  } catch (error) {
    const reason =
      error instanceof TossApiError
        ? `toss[${error.code}]: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { userId, status: "error", reason };
  }
};
