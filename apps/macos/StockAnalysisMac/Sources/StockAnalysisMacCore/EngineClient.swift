import Foundation

public struct EngineClient: Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let requestTimeout: TimeInterval

    public init(baseURL: URL, session: URLSession = .shared, requestTimeout: TimeInterval = 20) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.requestTimeout = requestTimeout
    }

    public func health() async throws -> EngineHealth {
        try await getJSON("/health")
    }

    public func automationHealth() async throws -> AutomationHealth {
        try await getJSON("/api/automation/health")
    }

    public func news(limit: Int = 50) async throws -> NewsPollResponse {
        try await getJSON("/api/news/events?limit=\(limit)")
    }

    public func localSelfTest() async throws -> LocalSelfTestResponse {
        try await getJSON("/api/local/self-test")
    }

    public func paperTradingState() async throws -> PaperTradingStateResponse {
        try await getJSON("/api/paper-trading/state")
    }

    public func resetPaperTradingState() async throws -> PaperTradingStateResponse {
        let data = try await postJSON("/api/paper-trading/reset", body: [:] as [String: String])
        return try decoder.decode(PaperTradingStateResponse.self, from: data)
    }

    public func terminalDashboard(symbol: String, session: String) async throws -> TerminalDashboardSnapshot {
        let encodedSymbol = symbol.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? symbol
        let encodedSession = session.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? session
        return try await getJSON("/api/dashboard/terminal?symbol=\(encodedSymbol)&session=\(encodedSession)")
    }

    public func savePlaybook(symbol: String, playbook: DashboardPlaybook) async throws -> DashboardPlaybook {
        let encodedSymbol = symbol.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? symbol
        let data = try await postJSON("/api/dashboard/playbook?symbol=\(encodedSymbol)", body: playbook)
        return try decoder.decode(DashboardPlaybook.self, from: data)
    }

    public func brokerCredential() async throws -> BrokerCredentialResponse {
        try await getJSON("/api/local/broker/credentials")
    }

    public func brokerAccountPreference() async throws -> BrokerCredentialResponse {
        try await getJSON("/api/local/broker/account-preference")
    }

    public func updateBrokerAccountPreference(accountSeq: Int) async throws -> BrokerCredentialResponse {
        let data = try await putJSON("/api/local/broker/account-preference", body: ["accountSeq": accountSeq])
        return try decoder.decode(BrokerCredentialResponse.self, from: data)
    }

    public func brokerDiagnostics(includePublicIP: Bool = false) async throws -> BrokerDiagnosticsResponse {
        try await getJSON("/api/local/broker/diagnostics\(includePublicIP ? "?includeEgress=1" : "")")
    }

    public func tossReadiness(symbol: String = "NVDA") async throws -> TossReadinessResponse {
        let encodedSymbol = symbol.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? symbol
        return try await getJSON("/api/local/toss/readiness?symbol=\(encodedSymbol)")
    }

    public func localLiveTrading() async throws -> LocalLiveTradingResponse {
        try await getJSON("/api/local/live-trading")
    }

    public func updateLocalLiveTrading(enabled: Bool) async throws -> LocalLiveTradingResponse {
        let data = try await putJSON("/api/local/live-trading", body: ["enabled": enabled])
        return try decoder.decode(LocalLiveTradingResponse.self, from: data)
    }

    public func localKillSwitch() async throws -> LocalKillSwitchResponse {
        try await getJSON("/api/local/kill-switch")
    }

    public func updateLocalKillSwitch(engaged: Bool, reason: String) async throws -> LocalKillSwitchResponse {
        let data = try await putJSON(
            "/api/local/kill-switch",
            body: LocalKillSwitchPayload(engaged: engaged, reason: reason, updatedBy: "macos-app")
        )
        return try decoder.decode(LocalKillSwitchResponse.self, from: data)
    }

    public func localWorkerControl() async throws -> LocalWorkerControlResponse {
        try await getJSON("/api/local/worker-control")
    }

    public func updateLocalWorkerControl(paused: Bool, reason: String) async throws -> LocalWorkerControlResponse {
        let data = try await putJSON(
            "/api/local/worker-control",
            body: LocalWorkerControlPayload(paused: paused, reason: reason, updatedBy: "macos-app")
        )
        return try decoder.decode(LocalWorkerControlResponse.self, from: data)
    }

    public func localAutomationScheduler() async throws -> LocalAutomationSchedulerResponse {
        try await getJSON("/api/local/automation/scheduler")
    }

    public func updateLocalAutomationScheduler(enabled: Bool, intervalSeconds: Int) async throws -> LocalAutomationSchedulerResponse {
        let data = try await putJSON(
            "/api/local/automation/scheduler",
            body: LocalAutomationSchedulerPayload(enabled: enabled, intervalSeconds: intervalSeconds)
        )
        return try decoder.decode(LocalAutomationSchedulerResponse.self, from: data)
    }

    public func searchSymbols(query: String, markets: [String], limit: Int = 12) async throws -> LocalSymbolSearchResponse {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "markets", value: markets.joined(separator: ",")),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        return try await getJSON("/api/local/symbol-search?\(components.percentEncodedQuery ?? "")")
    }

    public func cryptoExchanges() async throws -> CryptoExchangeListResponse {
        try await getJSON("/api/local/crypto-exchanges")
    }

    public func registerCryptoCredential(exchange: String, accessKey: String, secretKey: String) async throws -> CryptoCredentialResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/credentials",
            body: CryptoCredentialPayload(accessKey: accessKey, secretKey: secretKey)
        )
        return try decoder.decode(CryptoCredentialResponse.self, from: data)
    }

    public func deleteCryptoCredential(exchange: String) async throws -> Data {
        try await requestData("/api/local/crypto-exchanges/\(exchange)/credentials", method: "DELETE")
    }

    public func cryptoReadiness(exchange: String, market: String = "KRW-BTC") async throws -> CryptoReadinessResponse {
        let encodedMarket = market.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? market
        return try await getJSON("/api/local/crypto-exchanges/\(exchange)/readiness?market=\(encodedMarket)")
    }

    public func cryptoOrderPrecheck(exchange: String, market: String, side: String, volume: Double, price: Double) async throws -> CryptoOrderPrecheckResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/orders/precheck",
            body: CryptoOrderPrecheckPayload(market: market, side: side, volume: volume, price: price)
        )
        return try decoder.decode(CryptoOrderPrecheckResponse.self, from: data)
    }

    public func registerBrokerCredential(clientId: String, clientSecret: String) async throws -> BrokerCredentialResponse {
        let data = try await postJSON("/api/local/broker/credentials", body: [
            "clientId": clientId,
            "clientSecret": clientSecret,
        ])
        return try decoder.decode(BrokerCredentialResponse.self, from: data)
    }

    public func deleteBrokerCredential() async throws -> Data {
        try await requestData("/api/local/broker/credentials", method: "DELETE")
    }

    public func strategyConfigs() async throws -> StrategyConfigListResponse {
        try await getJSON("/api/local/strategy-configs")
    }

    public func exportStrategyConfigs() async throws -> StrategyExportBundle {
        try await getJSON("/api/local/strategy-configs/export")
    }

    public func importStrategyConfigs(_ bundle: StrategyExportBundle) async throws -> StrategyImportResponse {
        let data = try await postJSON("/api/local/strategy-configs/import", body: bundle)
        return try decoder.decode(StrategyImportResponse.self, from: data)
    }

    public func createStrategyDraft(_ input: StrategyDraftInput) async throws -> StrategyConfigResponse {
        let data = try await postJSON("/api/local/strategy-configs", body: StrategyPayload(input: input))
        return try decoder.decode(StrategyConfigResponse.self, from: data)
    }

    public func updateStrategyDraft(id: String, input: StrategyDraftInput) async throws -> StrategyConfigResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await putJSON("/api/local/strategy-configs/\(encodedId)", body: StrategyPayload(input: input))
        return try decoder.decode(StrategyConfigResponse.self, from: data)
    }

    public func simulateStrategy(id: String) async throws -> StrategySimulationResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await postJSON("/api/local/strategy-configs/\(encodedId)/simulate", body: [:] as [String: String])
        return try decoder.decode(StrategySimulationResponse.self, from: data)
    }

    public func previewStrategyTick(id: String, scenario: String) async throws -> Data {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await postJSON("/api/local/strategy-configs/\(encodedId)/tick-preview", body: ["scenario": scenario])
    }

    public func updateStrategyStatus(id: String, status: String) async throws -> StrategyConfigResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await putJSON("/api/local/strategy-configs/\(encodedId)", body: ["status": status])
        return try decoder.decode(StrategyConfigResponse.self, from: data)
    }

    public func deleteStrategy(id: String) async throws -> Data {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestData("/api/local/strategy-configs/\(encodedId)", method: "DELETE")
    }

    public func runPaperTrading(session: String) async throws -> Data {
        try await postJSON("/api/paper-trading/run", body: ["session": session, "source": "manual"])
    }

    public func submitPaperOrderIntent(_ intent: DashboardOrderIntent, session: String) async throws -> Data {
        try await postJSON("/api/paper-trading/order-intent", body: PaperOrderIntentPayload(session: session, orderIntent: intent))
    }

    public func runAutomationCycle() async throws -> Data {
        try await postJSON("/api/automation/cycle", body: [:] as [String: String])
    }

    public func runAutomationDryRun() async throws -> Data {
        try await postJSON("/api/automation/cycle", body: ["dryRun": true])
    }

    public func syncAutomationOrders() async throws -> Data {
        try await postJSON("/api/local/orders/sync", body: [:] as [String: String])
    }

    public func localHolding(symbol: String, accountSeq: Int? = nil) async throws -> LocalHoldingResponse {
        let encodedSymbol = symbol.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? symbol
        let accountQuery = accountSeq.map { "&accountSeq=\($0)" } ?? ""
        return try await getJSON("/api/local/holdings?symbol=\(encodedSymbol)\(accountQuery)")
    }

    public func localOrderPrecheck(
        symbol: String,
        side: String,
        quantity: Double,
        price: Double,
        currency: String,
        accountSeq: Int? = nil
    ) async throws -> LocalOrderPrecheckResponse {
        let data = try await postJSON(
            "/api/local/orders/precheck",
            body: LocalOrderPrecheckPayload(
                symbol: symbol,
                side: side,
                quantity: quantity,
                price: price,
                currency: currency,
                accountSeq: accountSeq
            )
        )
        return try decoder.decode(LocalOrderPrecheckResponse.self, from: data)
    }

    public func analyze(symbol: String) async throws -> Data {
        try await getData(
            "/api/market/\(symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? symbol)?days=365&tf=1d",
            timeout: 30
        )
    }

    public func dailyBriefing(session: String) async throws -> Data {
        try await getData("/api/briefing/daily-market?session=\(session)&force=1", timeout: 45)
    }

    private func getJSON<T: Decodable>(_ path: String) async throws -> T {
        try decoder.decode(T.self, from: try await getData(path))
    }

    private func getData(_ path: String, timeout: TimeInterval? = nil) async throws -> Data {
        let (data, response) = try await session.data(for: request(path, timeout: timeout))
        try validate(response: response, data: data)
        return data
    }

    private func postJSON<T: Encodable>(_ path: String, body: T) async throws -> Data {
        var request = request(path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    private func putJSON<T: Encodable>(_ path: String, body: T) async throws -> Data {
        var request = request(path)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    private func requestData(_ path: String, method: String) async throws -> Data {
        var request = request(path)
        request.httpMethod = method
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    private func url(_ path: String) -> URL {
        URL(string: path, relativeTo: baseURL)!.absoluteURL
    }

    private func request(_ path: String, timeout: TimeInterval? = nil) -> URLRequest {
        URLRequest(url: url(path), timeoutInterval: timeout ?? requestTimeout)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw EngineClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw EngineClientError.http(statusCode: http.statusCode, message: message)
        }
    }
}

public enum EngineClientError: LocalizedError, Equatable, Sendable {
    case invalidResponse
    case http(statusCode: Int, message: String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "로컬 엔진 응답을 해석할 수 없습니다."
        case let .http(statusCode, message):
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if let data = trimmed.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let error = json["error"] as? String, !error.isEmpty {
                    return error
                }
                if let message = json["message"] as? String, !message.isEmpty {
                    return message
                }
            }
            return trimmed.isEmpty ? "HTTP \(statusCode)" : trimmed
        }
    }
}

private struct StrategyPayload: Encodable {
    let name: String
    let symbol: String
    let market: String
    let executionVenue: String
    let preset: String
    let mode: String
    let status = "draft"
    let currentPrice: Double
    let supportPrice: Double
    let resistancePrice: Double
    let priceAnchor: StrategyPriceAnchorPayload
    let grid: StrategyGridPayload?
    let loop: StrategyLoopPayload?
    let riskLimits: StrategyRiskLimitsPayload
    let exitRules: StrategyExitRulesPayload

    init(input: StrategyDraftInput) {
        let safeRungCount = max(1, min(input.rungCount, 20))
        let safeBasePrice = max(input.basePrice, 0)
        name = input.name
        symbol = input.symbol.uppercased()
        market = input.market == "CRYPTO" ? "CRYPTO" : input.market == "KR" ? "KR" : "US"
        executionVenue = input.executionVenue
        switch input.preset {
        case "box-range", "magic-split", "one-percent-loop", "defensive-split", "custom":
            preset = input.preset
        default:
            preset = "support-rebound"
        }
        mode = input.mode == "loop-grid" ? "loop-grid" : "percent-grid"
        currentPrice = safeBasePrice
        supportPrice = safeBasePrice * 0.95
        resistancePrice = safeBasePrice * 1.05
        priceAnchor = StrategyPriceAnchorPayload(source: "manual", price: safeBasePrice, capturedAt: nil)
        if mode == "loop-grid" {
            grid = nil
            loop = StrategyLoopPayload(
                anchorPrice: safeBasePrice,
                buyDropPct: input.buyDropPct,
                sellRisePct: input.sellRisePct,
                notional: input.notional,
                cooldownMinutes: input.cooldownMinutes
            )
        } else {
            grid = StrategyGridPayload(
                basePrice: safeBasePrice,
                rungs: (1...safeRungCount).map { index in
                    StrategyGridRungPayload(
                        index: index,
                        buyDropPct: input.buyDropPct * Double(index),
                        sellRisePct: input.sellRisePct,
                        notional: input.notional
                    )
                }
            )
            loop = nil
        }
        riskLimits = StrategyRiskLimitsPayload(
            maxDailyBuys: input.maxDailyTrades,
            maxDailySells: input.maxDailyTrades,
            maxPositionValue: mode == "loop-grid" ? input.notional : input.notional * Double(safeRungCount),
            maxLossPct: input.maxLossPct,
            maxHoldHours: 24 * 365
        )
        exitRules = StrategyExitRulesPayload(
            takeProfitPct: 0,
            stopLossPct: 0,
            rescueMode: "disable-only"
        )
    }
}

private struct LocalKillSwitchPayload: Encodable {
    let engaged: Bool
    let reason: String
    let updatedBy: String
}

private struct LocalWorkerControlPayload: Encodable {
    let paused: Bool
    let reason: String
    let updatedBy: String
}

private struct LocalAutomationSchedulerPayload: Encodable {
    let enabled: Bool
    let intervalSeconds: Int
}

private struct CryptoCredentialPayload: Encodable {
    let accessKey: String
    let secretKey: String
}

private struct CryptoOrderPrecheckPayload: Encodable {
    let market: String
    let side: String
    let volume: Double
    let price: Double
}

private struct PaperOrderIntentPayload: Encodable {
    let session: String
    let orderIntent: DashboardOrderIntent
}

private struct LocalOrderPrecheckPayload: Encodable {
    let symbol: String
    let side: String
    let quantity: Double
    let price: Double
    let currency: String
    let accountSeq: Int?
}

private struct StrategyPriceAnchorPayload: Encodable {
    let source: String
    let price: Double
    let capturedAt: String?
}

private struct StrategyGridPayload: Encodable {
    let basePrice: Double
    let rungs: [StrategyGridRungPayload]
}

private struct StrategyGridRungPayload: Encodable {
    let index: Int
    let buyDropPct: Double
    let sellRisePct: Double
    let notional: Double
}

private struct StrategyLoopPayload: Encodable {
    let anchorPrice: Double
    let buyDropPct: Double
    let sellRisePct: Double
    let notional: Double
    let cooldownMinutes: Int
}

private struct StrategyRiskLimitsPayload: Encodable {
    let maxDailyBuys: Int
    let maxDailySells: Int
    let maxPositionValue: Double
    let maxLossPct: Double
    let maxHoldHours: Int
}

private struct StrategyExitRulesPayload: Encodable {
    let takeProfitPct: Double
    let stopLossPct: Double
    let rescueMode: String
}
