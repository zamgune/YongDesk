import type { PortfolioPosition, PortfolioSnapshot } from "@/domain/portfolio";

export type PortfolioRepository = {
  getSnapshot(userId: string): Promise<PortfolioSnapshot>;
  upsertPosition(position: PortfolioPosition): Promise<PortfolioPosition>;
  deletePosition(userId: string, positionId: string): Promise<void>;
};
