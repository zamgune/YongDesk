import type { AutoTradeLog, Execution, TradeLog } from "@/domain/execution";

export type ExecutionRepository = {
  listExecutions(userId: string, orderIntentId?: string): Promise<Execution[]>;
  recordExecution(execution: Execution): Promise<Execution>;
  listTradeLogs(userId: string, strategyInstanceId?: string): Promise<Array<TradeLog | AutoTradeLog>>;
  recordTradeLog(log: TradeLog | AutoTradeLog): Promise<TradeLog | AutoTradeLog>;
};
