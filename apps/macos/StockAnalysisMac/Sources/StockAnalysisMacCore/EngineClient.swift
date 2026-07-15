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

    public func communitySentiment(
        symbol: String,
        market: String,
        includeBroad: Bool = false,
        includeSpikeSources: Bool = false,
        refresh: Bool = false,
        sources: [String] = []
    ) async throws -> CommunitySentimentSnapshot {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSymbol.isEmpty,
              normalizedSymbol != ".",
              normalizedSymbol != "..",
              normalizedSymbol.range(of: #"^[A-Za-z0-9._-]{1,32}$"#, options: .regularExpression) != nil else {
            throw URLError(.badURL)
        }
        var components = URLComponents()
        components.path = "/api/community-pain/\(normalizedSymbol)"
        var queryItems = [
            URLQueryItem(name: "market", value: market),
            URLQueryItem(name: "broad", value: includeBroad ? "1" : "0"),
            URLQueryItem(name: "spike", value: includeSpikeSources ? "1" : "0"),
        ]
        if refresh {
            queryItems.append(URLQueryItem(name: "refresh", value: "1"))
        }
        queryItems.append(URLQueryItem(name: "limit", value: "60"))
        if !sources.isEmpty {
            queryItems.append(URLQueryItem(name: "sources", value: sources.joined(separator: ",")))
        }
        components.queryItems = queryItems
        guard let path = components.string else {
            throw URLError(.badURL)
        }
        return try await getJSON(path, timeout: 45)
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

    public func updateLocalLiveTrading(enabled: Bool, confirmation: String? = nil) async throws -> LocalLiveTradingResponse {
        let data = try await putJSON(
            "/api/local/live-trading",
            body: LocalLiveTradingTogglePayload(enabled: enabled, confirmation: confirmation)
        )
        return try decoder.decode(LocalLiveTradingResponse.self, from: data)
    }

    public func consentLocalLiveTrading(confirmation: String) async throws -> LocalLiveTradingResponse {
        let data = try await postJSON(
            "/api/local/live-trading/consent",
            body: LocalLiveTradingConfirmationPayload(confirmation: confirmation)
        )
        return try decoder.decode(LocalLiveTradingResponse.self, from: data)
    }

    public func updateLocalAutomationLiveTrading(enabled: Bool, confirmation: String? = nil) async throws -> LocalLiveTradingResponse {
        let data = try await putJSON(
            "/api/local/live-trading/automation",
            body: LocalLiveTradingTogglePayload(enabled: enabled, confirmation: confirmation)
        )
        return try decoder.decode(LocalLiveTradingResponse.self, from: data)
    }

    public func verifyLocalLiveTradingSafetyGates() async throws -> LocalLiveTradingResponse {
        let data = try await postJSON("/api/local/live-trading/safety-proof", body: [:] as [String: String])
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

    public func watchlistSummary() async throws -> LocalWatchlistSummaryResponse {
        try await getJSON("/api/local/watchlist/summary", timeout: 30)
    }

    public func watchlistSignals() async throws -> WatchlistSignalScanResponse {
        try await getJSON("/api/local/watchlist/signals", timeout: 30)
    }

    public func scanWatchlistSignals() async throws -> WatchlistSignalScanResponse {
        let data = try await postJSON("/api/local/watchlist/signal-scan", body: [:] as [String: String], timeout: 30)
        return try decoder.decode(WatchlistSignalScanResponse.self, from: data)
    }

    public func addWatchlistItem(_ input: LocalWatchlistItemInput) async throws -> LocalWatchlistResponse {
        let data = try await postJSON("/api/local/watchlist", body: input)
        return try decoder.decode(LocalWatchlistResponse.self, from: data)
    }

    public func deleteWatchlistItem(id: String) async throws -> LocalWatchlistResponse {
        guard let encodedId = percentEncodedPathSegment(id) else {
            throw URLError(.badURL)
        }
        let data = try await requestData("/api/local/watchlist/\(encodedId)", method: "DELETE")
        return try decoder.decode(LocalWatchlistResponse.self, from: data)
    }

    public func cryptoExchanges() async throws -> CryptoExchangeListResponse {
        try await getJSON("/api/local/crypto-exchanges")
    }

    public func realPortfolio(forceRefresh: Bool = false) async throws -> RealPortfolioResponseView {
        try await getJSON("/api/local/portfolio/real\(forceRefresh ? "?refresh=1" : "")")
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

    public func testUpbitOrder(market: String, side: String, volume: Double, price: Double) async throws -> UpbitOrderTestResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/upbit/orders/test",
            body: CryptoOrderPrecheckPayload(market: market, side: side, volume: volume, price: price)
        )
        return try decoder.decode(UpbitOrderTestResponse.self, from: data)
    }

    public func cryptoManualLiveTrading(exchange: String) async throws -> CryptoManualLiveTradingResponse {
        try await getJSON("/api/local/crypto-exchanges/\(exchange)/live-trading")
    }

    public func consentCryptoLiveTrading(exchange: String, confirmation: String) async throws -> CryptoManualLiveTradingResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/live-trading/consent",
            body: LocalLiveTradingConfirmationPayload(confirmation: confirmation)
        )
        return try decoder.decode(CryptoManualLiveTradingResponse.self, from: data)
    }

    public func updateCryptoLiveTrading(exchange: String, mode: String = "manual", enabled: Bool, confirmation: String? = nil) async throws -> CryptoManualLiveTradingResponse {
        let data = try await putJSON(
            "/api/local/crypto-exchanges/\(exchange)/live-trading",
            body: CryptoLiveTradingTogglePayload(mode: mode, enabled: enabled, confirmation: confirmation)
        )
        return try decoder.decode(CryptoManualLiveTradingResponse.self, from: data)
    }

    public func cryptoManualLiveOrderPrecheck(exchange: String, market: String, side: String, volume: Double, price: Double) async throws -> CryptoManualOrderPrecheckResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/orders/live-precheck",
            body: CryptoOrderPrecheckPayload(market: market, side: side, volume: volume, price: price)
        )
        return try decoder.decode(CryptoManualOrderPrecheckResponse.self, from: data)
    }

    public func submitCryptoManualLiveOrder(exchange: String, previewId: String, confirmation: String) async throws -> CryptoManualOrderSubmissionResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/orders/live-submit",
            body: LocalLiveOrderSubmitPayload(previewId: previewId, confirmation: confirmation)
        )
        return try decoder.decode(CryptoManualOrderSubmissionResponse.self, from: data)
    }

    public func reconcileCryptoManualLiveOrder(exchange: String) async throws -> CryptoManualOrderSubmissionResponse {
        let data = try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/live-trading/reconcile",
            body: [:] as [String: String]
        )
        return try decoder.decode(CryptoManualOrderSubmissionResponse.self, from: data)
    }

    public func cancelAllCryptoOpenOrders(exchange: String, confirmation: String) async throws -> Data {
        try await postJSON(
            "/api/local/crypto-exchanges/\(exchange)/open-orders/cancel-all",
            body: LocalLiveTradingConfirmationPayload(confirmation: confirmation)
        )
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

    public func syncAutomationOrders(startupReconciliation: Bool = false) async throws -> Data {
        try await postJSON("/api/local/orders/sync", body: ["startup": startupReconciliation])
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

    public func submitLocalLiveOrder(previewId: String, confirmation: String) async throws -> LocalLiveOrderSubmissionResponse {
        let data = try await postJSON(
            "/api/local/live-orders/submit",
            body: LocalLiveOrderSubmitPayload(previewId: previewId, confirmation: confirmation)
        )
        return try decoder.decode(LocalLiveOrderSubmissionResponse.self, from: data)
    }

    public func analyze(
        symbol: String,
        timeframe: AnalysisTimeframe,
        days: Int
    ) async throws -> Data {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSymbol.isEmpty,
              days > 0,
              let encodedSymbol = percentEncodedPathSegment(normalizedSymbol) else {
            throw URLError(.badURL)
        }
        var components = URLComponents()
        components.percentEncodedPath = "/api/market/\(encodedSymbol)"
        components.queryItems = [
            URLQueryItem(name: "days", value: String(days)),
            URLQueryItem(name: "tf", value: timeframe.rawValue),
        ]
        guard let path = components.string else {
            throw URLError(.badURL)
        }
        return try await getData(path, timeout: 30)
    }

    public func analyze(symbol: String) async throws -> Data {
        try await analyze(symbol: symbol, timeframe: .oneDay, days: 365)
    }

    public func chartData(
        symbol: String,
        assetClass: AnalysisAssetClass,
        timeframe: AnalysisTimeframe
    ) async throws -> Data {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSymbol.isEmpty else {
            throw URLError(.badURL)
        }
        var components = URLComponents()
        components.path = "/api/local/chart"
        components.queryItems = [
            URLQueryItem(name: "symbol", value: normalizedSymbol),
            URLQueryItem(name: "assetClass", value: assetClass.rawValue),
            URLQueryItem(name: "tf", value: timeframe.rawValue),
        ]
        guard let path = components.string else {
            throw URLError(.badURL)
        }
        return try await getData(path, timeout: 45)
    }

    public func workspaceAnalysis(
        symbol: String,
        assetClass: AnalysisAssetClass,
        source: AnalysisDataSource = .auto,
        entryPrice: Double? = nil,
        planMode: AnalysisHoldingPlanMode = .newEntry
    ) async throws -> WorkspaceAnalysis {
        try decoder.decode(
            WorkspaceAnalysis.self,
            from: try await workspaceAnalysisData(
                symbol: symbol,
                assetClass: assetClass,
                source: source,
                entryPrice: entryPrice,
                planMode: planMode
            )
        )
    }

    public func workspaceAnalysisData(
        symbol: String,
        assetClass: AnalysisAssetClass,
        source: AnalysisDataSource = .auto,
        entryPrice: Double? = nil,
        planMode: AnalysisHoldingPlanMode = .newEntry
    ) async throws -> Data {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSymbol.isEmpty else {
            throw URLError(.badURL)
        }
        var components = URLComponents()
        components.path = "/api/local/analysis/workspace"
        components.queryItems = [
            URLQueryItem(name: "symbol", value: normalizedSymbol),
            URLQueryItem(name: "assetClass", value: assetClass.rawValue),
            URLQueryItem(name: "source", value: source.rawValue),
        ]
        if let entryPrice, entryPrice.isFinite, entryPrice > 0 {
            components.queryItems?.append(URLQueryItem(name: "entryPrice", value: String(entryPrice)))
        }
        components.queryItems?.append(URLQueryItem(name: "planMode", value: planMode.rawValue))
        guard let path = components.string else {
            throw URLError(.badURL)
        }
        return try await getData(path, timeout: 60)
    }

    public func dailyBriefing(session: String) async throws -> Data {
        try await getData("/api/briefing/daily-market?session=\(session)&force=1", timeout: 45)
    }

    public func sectorStrength(market: String, forceRefresh: Bool = false) async throws -> SectorStrengthResponseView {
        let normalized = market == "US" ? "US" : "KR"
        let refresh = forceRefresh ? "&refresh=1" : ""
        return try await getJSON("/api/local/sector-strength?market=\(normalized)\(refresh)", timeout: 60)
    }

    private func getJSON<T: Decodable>(_ path: String, timeout: TimeInterval? = nil) async throws -> T {
        try decoder.decode(T.self, from: try await getData(path, timeout: timeout))
    }

    private func getData(_ path: String, timeout: TimeInterval? = nil) async throws -> Data {
        let (data, response) = try await session.data(for: request(path, timeout: timeout))
        try validate(response: response, data: data)
        return data
    }

    private func postJSON<T: Encodable>(_ path: String, body: T, timeout: TimeInterval? = nil) async throws -> Data {
        var request = request(path, timeout: timeout)
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

    private func percentEncodedPathSegment(_ value: String) -> String? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/%?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
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
    let orderSizing: StrategyOrderSizingPayload?
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
        let safeQuantity = max(input.quantity ?? 0, 0)
        let hasExplicitOrderSizing =
            (input.orderSizingMode == "quantity" && safeQuantity > 0)
            || (input.orderSizingMode == "notional" && input.notional > 0)
        if input.orderSizingMode == "quantity", safeQuantity > 0 {
            orderSizing = StrategyOrderSizingPayload(mode: "quantity", quantity: safeQuantity, notional: nil)
        } else if input.orderSizingMode == "notional", input.notional > 0 {
            orderSizing = StrategyOrderSizingPayload(mode: "notional", quantity: nil, notional: input.notional)
        } else {
            orderSizing = nil
        }
        currentPrice = safeBasePrice
        supportPrice = safeBasePrice * 0.95
        resistancePrice = safeBasePrice * 1.05
        priceAnchor = StrategyPriceAnchorPayload(
            source: input.priceAnchorSource == "market" ? "market" : "manual",
            price: safeBasePrice,
            capturedAt: input.priceAnchorCapturedAt
        )
        let resolvedNotional: (Double) -> Double = { price in
            if input.orderSizingMode == "quantity", safeQuantity > 0 {
                return price * safeQuantity
            }
            return input.notional
        }
        let generatedRungs = (1...safeRungCount).map { index in
            let buyDropPct = input.buyDropPct + input.rungGapPct * Double(index - 1)
            let buyLevel = safeBasePrice * (1 - buyDropPct / 100)
            return StrategyGridRungPayload(
                index: index,
                buyDropPct: buyDropPct,
                sellRisePct: input.sellRisePct,
                notional: resolvedNotional(buyLevel)
            )
        }
        let rungPayloads = input.preservedGridRungs?.prefix(20).map { rung in
            StrategyGridRungPayload(
                index: rung.index,
                buyDropPct: rung.buyDropPct,
                sellRisePct: rung.sellRisePct,
                notional: rung.notional
            )
        } ?? generatedRungs
        if mode == "loop-grid" {
            grid = nil
            let buyLevel = safeBasePrice * (1 - input.buyDropPct / 100)
            loop = StrategyLoopPayload(
                anchorPrice: safeBasePrice,
                buyDropPct: input.buyDropPct,
                sellRisePct: input.sellRisePct,
                notional: resolvedNotional(buyLevel),
                cooldownMinutes: input.cooldownMinutes
            )
        } else {
            grid = StrategyGridPayload(
                basePrice: safeBasePrice,
                rungs: rungPayloads
            )
            loop = nil
        }
        let maximumPositionValue: Double
        if mode == "loop-grid" {
            let buyLevel = safeBasePrice * (1 - input.buyDropPct / 100)
            maximumPositionValue = resolvedNotional(buyLevel)
        } else {
            maximumPositionValue = rungPayloads.reduce(0) { total, rung in
                let buyLevel = safeBasePrice * (1 - rung.buyDropPct / 100)
                let rungNotional = hasExplicitOrderSizing ? resolvedNotional(buyLevel) : rung.notional
                return total + rungNotional
            }
        }
        riskLimits = StrategyRiskLimitsPayload(
            maxDailyBuys: input.maxDailyTrades,
            maxDailySells: input.maxDailyTrades,
            maxPositionValue: maximumPositionValue,
            maxLossPct: input.maxLossPct,
            maxHoldHours: 24 * 365
        )
        exitRules = StrategyExitRulesPayload(
            takeProfitPct: input.sellRisePct,
            stopLossPct: input.stopLossPct,
            rescueMode: input.stopLossPct > 0 ? "cancel-and-liquidate" : "disable-only"
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

private struct LocalLiveTradingTogglePayload: Encodable {
    let enabled: Bool
    let confirmation: String?
}

private struct CryptoLiveTradingTogglePayload: Encodable {
    let mode: String
    let enabled: Bool
    let confirmation: String?
}

private struct LocalLiveTradingConfirmationPayload: Encodable {
    let confirmation: String
}

private struct LocalLiveOrderSubmitPayload: Encodable {
    let previewId: String
    let confirmation: String
}

private struct StrategyPriceAnchorPayload: Encodable {
    let source: String
    let price: Double
    let capturedAt: String?
}

private struct StrategyOrderSizingPayload: Encodable {
    let mode: String
    let quantity: Double?
    let notional: Double?
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
