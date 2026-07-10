import type { OrderIntent } from "@/domain/trading";

export type OrderRepository = {
  createIntent(intent: OrderIntent): Promise<OrderIntent>;
  updateIntent(intent: OrderIntent): Promise<OrderIntent>;
  findById(userId: string, orderIntentId: string): Promise<OrderIntent | null>;
};
