import type { AutomationOrderSizing } from "@/domain/automation";

export type ResolvedOrderSizing = {
  quantity: number;
  notional: number;
};

const cryptoQuantity = (notional: number, price: number) =>
  Math.floor((notional / price) * 100_000_000) / 100_000_000;

export const resolveOrderSizing = ({
  orderSizing,
  legacyNotional,
  price,
  fractionalQuantity = false,
}: {
  orderSizing?: AutomationOrderSizing;
  legacyNotional: number;
  price: number;
  fractionalQuantity?: boolean;
}): ResolvedOrderSizing => {
  if (!Number.isFinite(price) || price <= 0) {
    return { quantity: 0, notional: 0 };
  }

  if (orderSizing?.mode === "quantity") {
    const quantity = fractionalQuantity
      ? Math.floor(orderSizing.quantity * 100_000_000) / 100_000_000
      : Math.floor(orderSizing.quantity);
    return {
      quantity,
      notional: quantity * price,
    };
  }

  const notional = orderSizing?.mode === "notional"
    ? orderSizing.notional
    : legacyNotional;
  const quantity = fractionalQuantity
    ? cryptoQuantity(notional, price)
    : Math.max(1, Math.floor(notional / price));
  return { quantity, notional };
};
