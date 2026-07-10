import Foundation

public enum OrderIntentStrategyDraftFactory {
    public static func makeMagicSplitDraft(
        from dashboard: TerminalDashboardSnapshot,
        session: String
    ) -> StrategyDraftInput? {
        let intent = dashboard.orderIntent
        guard let limitPrice = intent.limitPrice,
              limitPrice.isFinite,
              limitPrice > 0,
              intent.quantity > 0 else {
            return nil
        }

        let market = session == "KR" || dashboard.session == "KR" ? "KR" : "US"
        let estimatedOrderValue = limitPrice * Double(intent.quantity)
        let rungCount = 3
        let notional = max(limitPrice, estimatedOrderValue / Double(rungCount))
        let symbol = dashboard.symbol.uppercased()

        return StrategyDraftInput(
            name: "\(symbol) OrderIntent 순환분할",
            symbol: symbol,
            market: market,
            preset: "magic-split",
            mode: "percent-grid",
            basePrice: limitPrice,
            notional: notional,
            rungCount: rungCount,
            buyDropPct: 1.0,
            sellRisePct: 1.2,
            maxDailyTrades: rungCount,
            maxLossPct: 12.0,
            cooldownMinutes: 5
        )
    }

    public static func reusableDraft(
        in configs: [StrategyConfigView],
        for input: StrategyDraftInput
    ) -> StrategyConfigView? {
        configs
            .filter { config in
                config.status != "enabled" &&
                    config.name == input.name &&
                    config.symbol.uppercased() == input.symbol.uppercased() &&
                    config.preset == input.preset &&
                    config.mode == input.mode
            }
            .sorted { $0.updatedAt > $1.updatedAt }
            .first
    }
}
