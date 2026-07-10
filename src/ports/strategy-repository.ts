import type { StrategyInstance, StrategyTemplate } from "@/domain/strategy";

export type StrategyRepository = {
  listTemplates(): Promise<StrategyTemplate[]>;
  listInstances(userId: string): Promise<StrategyInstance[]>;
  findInstance(userId: string, strategyInstanceId: string): Promise<StrategyInstance | null>;
  saveInstance(instance: StrategyInstance): Promise<StrategyInstance>;
  deleteInstance(userId: string, strategyInstanceId: string): Promise<void>;
};
