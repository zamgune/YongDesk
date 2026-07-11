import Foundation

public struct AppSettings: Codable, Equatable, Sendable {
    public var enginePort: Int
    public var repositoryPath: String
    public var alertsEnabled: Bool
    public var workerPaused: Bool
    public var liveTradingOperatorEnabled: Bool
    public var cryptoLiveTradingOperatorEnabled: Bool
    public var hasCompletedOnboarding: Bool

    public init(
        enginePort: Int = 38_771,
        repositoryPath: String = FileManager.default.currentDirectoryPath,
        alertsEnabled: Bool = false,
        workerPaused: Bool = false,
        liveTradingOperatorEnabled: Bool = false,
        cryptoLiveTradingOperatorEnabled: Bool = false,
        hasCompletedOnboarding: Bool = false
    ) {
        self.enginePort = enginePort
        self.repositoryPath = repositoryPath
        self.alertsEnabled = alertsEnabled
        self.workerPaused = workerPaused
        self.liveTradingOperatorEnabled = liveTradingOperatorEnabled
        self.cryptoLiveTradingOperatorEnabled = cryptoLiveTradingOperatorEnabled
        self.hasCompletedOnboarding = hasCompletedOnboarding
    }

    enum CodingKeys: String, CodingKey {
        case enginePort
        case repositoryPath
        case alertsEnabled
        case workerPaused
        case liveTradingOperatorEnabled
        case cryptoLiveTradingOperatorEnabled
        case hasCompletedOnboarding
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.enginePort = try container.decodeIfPresent(Int.self, forKey: .enginePort) ?? 38_771
        self.repositoryPath = try container.decodeIfPresent(String.self, forKey: .repositoryPath) ?? FileManager.default.currentDirectoryPath
        self.alertsEnabled = try container.decodeIfPresent(Bool.self, forKey: .alertsEnabled) ?? false
        self.workerPaused = try container.decodeIfPresent(Bool.self, forKey: .workerPaused) ?? false
        self.liveTradingOperatorEnabled = try container.decodeIfPresent(Bool.self, forKey: .liveTradingOperatorEnabled) ?? false
        self.cryptoLiveTradingOperatorEnabled = try container.decodeIfPresent(Bool.self, forKey: .cryptoLiveTradingOperatorEnabled) ?? false
        self.hasCompletedOnboarding = try container.decodeIfPresent(Bool.self, forKey: .hasCompletedOnboarding) ?? false
    }
}

public struct EngineHealth: Codable, Equatable, Sendable {
    public let ok: Bool
    public let engine: String
    public let version: String
    public let generatedAt: String
    public let storageRoot: String?
    public let localUserId: String
    public let pid: Int?
    public let workingDirectory: String?
    public let sidecarBuildId: String?
}

public enum AnalysisTimeframe: Codable, Equatable, Hashable, Sendable {
    case fiveMinutes
    case fifteenMinutes
    case thirtyMinutes
    case oneHour
    case fourHours
    case oneDay
    case oneWeek
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .fiveMinutes: "5m"
        case .fifteenMinutes: "15m"
        case .thirtyMinutes: "30m"
        case .oneHour: "1h"
        case .fourHours: "4h"
        case .oneDay: "1d"
        case .oneWeek: "1wk"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.lowercased() {
        case "5m": .fiveMinutes
        case "15m": .fifteenMinutes
        case "30m": .thirtyMinutes
        case "1h": .oneHour
        case "4h": .fourHours
        case "1d": .oneDay
        case "1wk": .oneWeek
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum AnalysisAssetClass: Codable, Equatable, Hashable, Sendable {
    case stock
    case crypto
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .stock: "stock"
        case .crypto: "crypto"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.lowercased() {
        case "stock": .stock
        case "crypto": .crypto
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum AnalysisMarket: Codable, Equatable, Hashable, Sendable {
    case kr
    case us
    case crypto
    case kospi
    case kosdaq
    case upbit
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .kr: "KR"
        case .us: "US"
        case .crypto: "CRYPTO"
        case .kospi: "KOSPI"
        case .kosdaq: "KOSDAQ"
        case .upbit: "UPBIT"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.uppercased() {
        case "KR": .kr
        case "US": .us
        case "CRYPTO": .crypto
        case "KOSPI": .kospi
        case "KOSDAQ": .kosdaq
        case "UPBIT": .upbit
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum AnalysisDataSource: Codable, Equatable, Hashable, Sendable {
    case auto
    case toss
    case upbit
    case yahoo
    case fixture
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .auto: "auto"
        case .toss: "toss"
        case .upbit: "upbit"
        case .yahoo: "yahoo"
        case .fixture: "fixture"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.lowercased() {
        case "auto": .auto
        case "toss", "toss-open-api": .toss
        case "upbit", "upbit-public-rest": .upbit
        case "yahoo", "yahoo-finance": .yahoo
        case "fixture", "fixture-data": .fixture
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct WorkspaceAnalysis: Codable, Equatable, Sendable {
    public let symbol: String
    public let assetClass: AnalysisAssetClass
    public let market: AnalysisMarket?
    public let currency: String?
    public let dataSource: AnalysisDataSource?
    public let quoteAt: String?
    public let generatedAt: String?
    public let stale: Bool?
    public let analyses: WorkspaceTimeframeAnalyses?
    public let horizonPlans: [AnalysisHorizonPlan]
    public let warnings: [String]
    public let orderSubmissionAttempted: Bool

    enum CodingKeys: String, CodingKey {
        case symbol
        case assetClass
        case market
        case currency
        case dataSource
        case quoteAt
        case generatedAt
        case stale
        case analyses
        case horizonPlans
        case warnings
        case orderSubmissionAttempted
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        symbol = try container.decode(String.self, forKey: .symbol)
        assetClass = try container.decode(AnalysisAssetClass.self, forKey: .assetClass)
        market = try container.decodeIfPresent(AnalysisMarket.self, forKey: .market)
        currency = try container.decodeIfPresent(String.self, forKey: .currency)
        dataSource = try container.decodeIfPresent(AnalysisDataSource.self, forKey: .dataSource)
        quoteAt = try container.decodeIfPresent(String.self, forKey: .quoteAt)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        stale = try container.decodeIfPresent(Bool.self, forKey: .stale)
        analyses = try container.decodeIfPresent(WorkspaceTimeframeAnalyses.self, forKey: .analyses)
        horizonPlans = try container.decodeIfPresent([AnalysisHorizonPlan].self, forKey: .horizonPlans) ?? []
        warnings = try container.decodeIfPresent([String].self, forKey: .warnings) ?? []
        orderSubmissionAttempted = try container.decode(Bool.self, forKey: .orderSubmissionAttempted)
    }
}

public struct WorkspaceTimeframeAnalyses: Codable, Equatable, Sendable {
    public let oneHour: WorkspaceTimeframeAnalysis?
    public let fourHour: WorkspaceTimeframeAnalysis?
    public let daily: WorkspaceTimeframeAnalysis?
    public let weekly: WorkspaceTimeframeAnalysis?
}

public struct WorkspaceTimeframeAnalysis: Codable, Equatable, Sendable {
    public let symbol: String?
    public let market: AnalysisMarket?
    public let currency: String?
    public let dataSource: AnalysisDataSource?
    public let timeframe: AnalysisTimeframe?
    public let quoteAt: String?
    public let generatedAt: String?
    public let latestClose: Double?
    public let stale: Bool?
    public let analysisBasis: WorkspaceAnalysisBasis?

    enum CodingKeys: String, CodingKey {
        case symbol
        case market
        case currency
        case dataSource
        case timeframe
        case quoteAt
        case generatedAt
        case latestClose
        case currentPrice
        case price
        case stale
        case analysisBasis
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        symbol = try container.decodeIfPresent(String.self, forKey: .symbol)
        market = try container.decodeIfPresent(AnalysisMarket.self, forKey: .market)
        currency = try container.decodeIfPresent(String.self, forKey: .currency)
        dataSource = try container.decodeIfPresent(AnalysisDataSource.self, forKey: .dataSource)
        timeframe = try container.decodeIfPresent(AnalysisTimeframe.self, forKey: .timeframe)
        quoteAt = try container.decodeIfPresent(String.self, forKey: .quoteAt)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        latestClose = try container.decodeIfPresent(Double.self, forKey: .latestClose)
            ?? container.decodeIfPresent(Double.self, forKey: .currentPrice)
            ?? container.decodeIfPresent(Double.self, forKey: .price)
        stale = try container.decodeIfPresent(Bool.self, forKey: .stale)
        analysisBasis = try container.decodeIfPresent(WorkspaceAnalysisBasis.self, forKey: .analysisBasis)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(symbol, forKey: .symbol)
        try container.encodeIfPresent(market, forKey: .market)
        try container.encodeIfPresent(currency, forKey: .currency)
        try container.encodeIfPresent(dataSource, forKey: .dataSource)
        try container.encodeIfPresent(timeframe, forKey: .timeframe)
        try container.encodeIfPresent(quoteAt, forKey: .quoteAt)
        try container.encodeIfPresent(generatedAt, forKey: .generatedAt)
        try container.encodeIfPresent(latestClose, forKey: .latestClose)
        try container.encodeIfPresent(stale, forKey: .stale)
        try container.encodeIfPresent(analysisBasis, forKey: .analysisBasis)
    }
}

public struct WorkspaceAnalysisBasis: Codable, Equatable, Sendable {
    public let atr14: Double?
    public let sma20: Double?
    public let sma200: Double?
    public let ema200: Double?
    public let tenMonthAverage: Double?
    public let hma20: Double?
    public let hma50: Double?
    public let adx14: Double?
    public let choppiness14: Double?
    public let volumeRatio20: Double?
    public let recentLow20: Double?
    public let recentHigh20: Double?
    public let chandelierLong: Double?
    public let weeklySma20: Double?
    public let weeklySma60: Double?
    public let weeklyTrend: String?
    public let trendUp: Bool?
    public let closedCandleCount: Int?
}

public enum AnalysisHoldingHorizon: Codable, Equatable, Hashable, Sendable {
    case day
    case swing
    case long
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .day: "day"
        case .swing: "swing"
        case .long: "long"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.lowercased() {
        case "day": .day
        case "swing": .swing
        case "long": .long
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum AnalysisHorizonPlanStatus: Codable, Equatable, Hashable, Sendable {
    case actionable
    case wait
    case unavailable
    case unknown(String)

    public var rawValue: String {
        switch self {
        case .actionable: "actionable"
        case .wait: "wait"
        case .unavailable: "unavailable"
        case let .unknown(value): value
        }
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value.lowercased() {
        case "actionable": .actionable
        case "wait": .wait
        case "unavailable": .unavailable
        default: .unknown(value)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct AnalysisHorizonPlan: Codable, Equatable, Sendable {
    public let horizon: AnalysisHoldingHorizon
    public let status: AnalysisHorizonPlanStatus
    public let entryPrice: Double?
    public let stop: AnalysisHorizonStop?
    public let takeProfits: [AnalysisTakeProfit]
    public let trailingExit: AnalysisTrailingExit?
    public let riskPerShare: Double?
    public let stopPct: Double?
    public let rewardRisk: Double?
    public let basis: AnalysisHorizonBasis?
    public let formulaSteps: [String]
    public let reasons: [String]
    public let blockers: [String]

    enum CodingKeys: String, CodingKey {
        case horizon
        case status
        case entryPrice
        case stop
        case takeProfits
        case trailingExit
        case riskPerShare
        case stopPct
        case rewardRisk
        case basis
        case formulaSteps
        case reasons
        case blockers
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        horizon = try container.decode(AnalysisHoldingHorizon.self, forKey: .horizon)
        status = try container.decode(AnalysisHorizonPlanStatus.self, forKey: .status)
        entryPrice = try container.decodeIfPresent(Double.self, forKey: .entryPrice)
        stop = try container.decodeIfPresent(AnalysisHorizonStop.self, forKey: .stop)
        takeProfits = try container.decodeIfPresent([AnalysisTakeProfit].self, forKey: .takeProfits) ?? []
        trailingExit = try container.decodeIfPresent(AnalysisTrailingExit.self, forKey: .trailingExit)
        riskPerShare = try container.decodeIfPresent(Double.self, forKey: .riskPerShare)
        stopPct = try container.decodeIfPresent(Double.self, forKey: .stopPct)
        rewardRisk = try container.decodeIfPresent(Double.self, forKey: .rewardRisk)
        basis = try container.decodeIfPresent(AnalysisHorizonBasis.self, forKey: .basis)
        formulaSteps = try container.decodeIfPresent([String].self, forKey: .formulaSteps) ?? []
        reasons = try container.decodeIfPresent([String].self, forKey: .reasons) ?? []
        blockers = try container.decodeIfPresent([String].self, forKey: .blockers) ?? []
    }
}

public struct AnalysisHorizonStop: Codable, Equatable, Sendable {
    public let price: Double?
    public let trigger: String?
    public let isBrokerStopEligible: Bool
    public let reason: String?
}

public struct AnalysisTakeProfit: Codable, Equatable, Sendable {
    public let price: Double?
    public let allocationPct: Double?
    public let basis: String?
}

public struct AnalysisTrailingExit: Codable, Equatable, Sendable {
    public let price: Double?
    public let allocationPct: Double?
    public let basis: String?
}

public struct AnalysisHorizonBasis: Codable, Equatable, Sendable {
    public let symbol: String?
    public let market: AnalysisMarket?
    public let currency: String?
    public let dataSource: AnalysisDataSource?
    public let quoteAt: String?
    public let generatedAt: String?
    public let timeframeLabel: String?
    public let entryPrice: Double?
    public let atr14: Double?
    public let support: Double?
    public let resistance: Double?
    public let sma20: Double?
    public let sma200: Double?
    public let tenMonthAverage: Double?
    public let weeklySma20: Double?
    public let weeklySma60: Double?
    public let chandelierLong: Double?
    public let reliabilityGrade: String?
}

public struct LocalNewsEvent: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let sourceId: String
    public let sourceName: String
    public let category: String
    public let title: String
    public let url: String
    public let publishedAt: String?
    public let summary: String
    public let tags: [String]
    public let tickers: [String]
    public let importance: String
    public let dedupeKey: String
}

public struct NewsPollResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let newEvents: [LocalNewsEvent]
    public let events: [LocalNewsEvent]
    public let errors: [NewsSourceError]
    public let alertCandidates: [LocalNewsEvent]
}

public struct NewsSourceError: Codable, Equatable, Sendable {
    public let sourceId: String
    public let message: String
}

public struct CommunitySentimentSnapshot: Codable, Equatable, Sendable {
    public let symbol: String
    public let canonicalSymbol: String
    public let market: String
    public let queryTerms: [String]
    public let lookbackHours: Int
    public let score: Int
    public let painScore: Int
    public let gajuaScore: Int
    public let divisionScore: Int
    public let sentimentRegime: String
    public let level: String
    public let confidence: Int
    public let verdict: String
    public let evidenceCount: Int
    public let postCount: Int
    public let commentCount: Int
    public let replyCount: Int
    public let signalItemCount: Int
    public let collectionWindowHours: Int
    public let lowEvidence: Bool
    public let factors: [CommunitySentimentFactor]
    public let gajuaFactors: [CommunitySentimentFactor]
    public let sourceStats: [CommunitySentimentSourceStat]
    public let snippets: [CommunitySentimentSnippet]
    public let painSnippets: [CommunitySentimentSnippet]
    public let gajuaSnippets: [CommunitySentimentSnippet]
    public let generatedAt: String
    public let cacheTtlSeconds: Int
}

public struct CommunitySentimentFactor: Codable, Identifiable, Equatable, Sendable {
    public let key: String
    public let label: String
    public let score: Int
    public let value: String
    public let detail: String

    public var id: String { key }
}

public struct CommunitySentimentSourceStat: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let policyStatus: String?
    public let status: String
    public let confidenceWeight: Double?
    public let reason: String?
    public let candidateCount: Int
    public let recentItemCount: Int
    public let itemCount: Int
    public let postCount: Int
    public let commentItemCount: Int
    public let replyCount: Int
    public let oldestItemAt: String?
    public let newestItemAt: String?
    public let dateParseCoverage: Double
    public let timedOut: Bool
}

public struct CommunitySentimentSnippet: Codable, Identifiable, Equatable, Sendable {
    public let sourceId: String
    public let sourceLabel: String
    public let title: String
    public let url: String
    public let reason: String
    public let engagement: Int
    public let kind: String

    public var id: String { "\(sourceId)|\(kind)|\(url)" }
}

public struct AutomationHealth: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let overall: String
    public let storageMode: String
}

public struct LocalSelfTestSummary: Codable, Equatable, Sendable {
    public let total: Int
    public let pass: Int
    public let warn: Int
    public let fail: Int
    public let blockingFailures: Int
}

public struct LocalSelfTestCheck: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let status: String
    public let summary: String
    public let action: String
    public let blocking: Bool
    public let durationMs: Int
}

public struct LocalSelfTestResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let overall: String
    public let summary: LocalSelfTestSummary
    public let checks: [LocalSelfTestCheck]
}

public struct PaperTradingStateResponse: Codable, Equatable, Sendable {
    public let state: PaperTradingStateView
    public let repaired: Bool
    public let storagePath: String?
}

public struct PaperTradingStateView: Codable, Equatable, Sendable {
    public let accounts: [String: PaperTradingAccountView]
    public let positions: [PaperTradingPositionView]
    public let runs: [PaperTradingRunView]
    public let orders: [PaperTradingOrderView]
    public let executions: [PaperTradingExecutionView]
    public let logs: [PaperTradingLogView]
    public let updatedAt: String
}

public struct PaperTradingAccountView: Codable, Equatable, Sendable {
    public let id: String
    public let session: String
    public let currency: String
    public let initialCash: Double
    public let cash: Double
    public let realizedPnl: Double
    public let strategyVersion: String
    public let lastRunDate: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct RealPortfolioResponseView: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let providers: [RealPortfolioProviderView]
    public let totalsByCurrency: [RealPortfolioCurrencyTotalView]
    public let orderSubmissionAttempted: Bool
}

public struct RealPortfolioProviderView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { provider }
    public let provider: String
    public let connectionStatus: String
    public let accounts: [RealPortfolioAccountView]
    public let positions: [RealPortfolioPositionView]
    public let openOrders: [RealPortfolioOpenOrderView]
    public let totalsByCurrency: [RealPortfolioCurrencyTotalView]
    public let stale: Bool
    public let partial: Bool
    public let lastSuccessfulAt: String?
    public let error: String?
}

public struct RealPortfolioBalanceView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { currency }
    public let currency: String
    public let available: Double?
    public let locked: Double?
    public let total: Double?
    public let buyingPower: Double?
}

public struct RealPortfolioAccountView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let provider: String
    public let label: String
    public let maskedAccount: String?
    public let accountType: String
    public let balances: [RealPortfolioBalanceView]
}

public struct RealPortfolioPositionView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let provider: String
    public let accountId: String
    public let accountLabel: String
    public let symbol: String
    public let name: String?
    public let currency: String
    public let availableQuantity: Double
    public let lockedQuantity: Double
    public let quantity: Double
    public let averagePrice: Double?
    public let currentPrice: Double?
    public let purchaseAmount: Double?
    public let marketValue: Double?
    public let profitLoss: Double?
    public let profitLossRate: Double?
    public let valuationSupported: Bool
}

public struct RealPortfolioOpenOrderView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let provider: String
    public let accountId: String
    public let symbol: String
    public let side: String
    public let status: String
    public let price: Double?
    public let quantity: Double
    public let filledQuantity: Double
    public let clientOrderId: String?
}

public struct RealPortfolioCurrencyTotalView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { "\(provider):\(currency)" }
    public let provider: String
    public let currency: String
    public let cash: Double?
    public let buyingPower: Double?
    public let purchaseAmount: Double?
    public let marketValue: Double?
    public let profitLoss: Double?
}

public struct PaperTradingPositionView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let session: String
    public let market: String
    public let symbol: String
    public let name: String?
    public let quantity: Double
    public let averagePrice: Double
    public let lastPrice: Double
    public let currency: String
    public let openedAt: String
    public let updatedAt: String
    public let completedStages: [String]
}

public struct PaperTradingRunView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let session: String
    public let source: String
    public let today: String
    public let strategyVersion: String
    public let status: String
    public let candidateCount: Int
    public let tradableCount: Int
    public let probeCount: Int
    public let ordersCount: Int
    public let executionsCount: Int
    public let startedAt: String
    public let finishedAt: String
    public let summary: String
}

public struct PaperTradingOrderView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let runId: String
    public let session: String
    public let market: String
    public let symbol: String
    public let name: String?
    public let side: String
    public let type: String
    public let quantity: Double
    public let price: Double
    public let currency: String
    public let status: String
    public let reason: String
    public let strategyVersion: String
    public let createdAt: String
}

public struct PaperTradingExecutionView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let runId: String
    public let orderId: String
    public let session: String
    public let market: String
    public let symbol: String
    public let side: String
    public let quantity: Double
    public let price: Double
    public let currency: String
    public let realizedPnl: Double
    public let executedAt: String
}

public struct PaperTradingLogView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let runId: String
    public let session: String
    public let source: String
    public let market: String?
    public let symbol: String?
    public let level: String
    public let message: String
    public let strategyVersion: String
    public let createdAt: String
}

public struct BrokerCredential: Codable, Equatable, Sendable {
    public let broker: String
    public let clientId: String
    public let clientSecret: String

    public init(broker: String = "toss", clientId: String, clientSecret: String) {
        self.broker = broker
        self.clientId = clientId
        self.clientSecret = clientSecret
    }
}

public struct BrokerCredentialView: Codable, Equatable, Sendable {
    public let broker: String
    public let maskedIdentifier: String
    public let status: String
    public let lastVerifiedAt: String?
    public let updatedAt: String
}

public struct BrokerAccountView: Codable, Identifiable, Equatable, Sendable {
    public var id: Int { accountSeq }
    public let accountNo: String
    public let accountSeq: Int
    public let accountType: String
}

public struct BrokerAccountPreferenceView: Codable, Equatable, Sendable {
    public let broker: String
    public let accountNo: String
    public let accountSeq: Int
    public let accountType: String
    public let updatedAt: String
}

public struct BrokerCredentialResponse: Codable, Equatable, Sendable {
    public let credential: BrokerCredentialView?
    public let accounts: [BrokerAccountView]?
    public let accountPreference: BrokerAccountPreferenceView?
    public let accountsError: String?
}

public struct BrokerDiagnosticsEgress: Codable, Equatable, Sendable {
    public let status: String
    public let ip: String?
    public let message: String
    public let checkedAt: String
}

public struct BrokerDiagnosticsLiveGate: Codable, Equatable, Sendable {
    public let enableLiveTrading: Bool
    public let credentialEncryptionConfigured: Bool
    public let storageRoot: String?
    public let automationOverall: String
    public let readinessOverall: String
    public let automationBeta: Bool
    public let brokerCredentials: Bool
    public let accountPreferenceSelected: Bool
    public let userLiveTrading: Bool
    public let liveTradingEffective: Bool
    public let rawLiveTradingEffective: Bool
    public let gateStatus: Int
    public let gateReason: String?
    public let killSwitchEngaged: Bool
    public let killSwitchReason: String?
    public let workerPaused: Bool
    public let workerPauseReason: String?
    public let automationQueueReady: Bool
}

public struct BrokerDiagnosticsItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let owner: String
    public let status: String
    public let label: String
    public let summary: String
    public let action: String
    public let blocking: Bool
}

public struct BrokerDiagnosticsResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let userId: String
    public let credential: BrokerCredentialView?
    public let egress: BrokerDiagnosticsEgress
    public let liveGate: BrokerDiagnosticsLiveGate
    public let readinessItems: [BrokerDiagnosticsItem]
    public let guidance: [String]
}

public struct TossReadinessCredentials: Codable, Equatable, Sendable {
    public let present: Bool
    public let clientIdMasked: String?
}

public struct TossReadinessSelectedAccount: Codable, Equatable, Sendable {
    public let accountSeq: Int
    public let accountType: String
    public let accountNoMasked: String
}

public struct TossReadinessReadonlyChecks: Codable, Equatable, Sendable {
    public let token: Bool
    public let accounts: Bool
    public let holdings: Bool
    public let openOrders: Bool
}

public struct TossReadinessTossError: Codable, Equatable, Sendable {
    public let status: Int?
    public let code: String?
    public let requestId: String?
    public let guidance: String?
}

public struct TossReadinessResponse: Codable, Equatable, Sendable {
    public let generatedAt: String?
    public let ok: Bool
    public let status: String
    public let checkedAt: String
    public let orderSubmissionAttempted: Bool
    public let credentials: TossReadinessCredentials
    public let selectedAccount: TossReadinessSelectedAccount?
    public let accountHeaderVerified: Bool
    public let readonlyChecks: TossReadinessReadonlyChecks
    public let summary: String
    public let guidance: [String]
    public let toss: TossReadinessTossError?
    public let credential: BrokerCredentialView?
    public let accountPreference: BrokerAccountPreferenceView?
    public let automationAccountSelected: Bool?
    public let automationReady: Bool?
}

public struct LocalLiveTradingState: Codable, Equatable, Sendable {
    public let masterEnabled: Bool
    public let userEnabled: Bool
    public let effective: Bool
    public let status: Int
    public let reason: String?
    public let featureEnabled: Bool
    public let localRuntime: Bool
    public let storageRoot: String?
    public let policy: LocalLiveTradingPolicy?
    public let automationEligibility: LocalLiveAutomationEligibility?
    public let attempts: [LocalLiveOrderAttempt]?
    public let limits: LocalLiveTradingLimits?
}

public struct LocalLiveTradingPolicy: Codable, Equatable, Sendable {
    public let installationId: String
    public let boundUserId: String?
    public let boundAccountSeq: Int?
    public let readinessVerifiedAt: String?
    public let bindingHash: String?
    public let userConsentAt: String?
    public let manualEnabled: Bool
    public let automationEnabled: Bool
    public let dailyBuyKrwDate: String
    public let dailyBuyKrwSubmitted: Double
    public let lastReconciliationAt: String?
    public let safetyGateVerifiedAt: String?
    public let unknownLock: LocalLiveUnknownLock?
}

public struct LocalLiveUnknownLock: Codable, Equatable, Sendable {
    public let attemptId: String
    public let reason: String
    public let lockedAt: String
}

public struct LocalLiveAutomationEligibility: Codable, Equatable, Sendable {
    public let eligible: Bool
    public let manualLimitOrders: Int
    public let reconciliationRecorded: Bool
    public let safetyGateVerified: Bool
    public let unresolvedUnknown: Int
    public let blockers: [String]
}

public struct LocalLiveTradingLimits: Codable, Equatable, Sendable {
    public let perBuyOrderKrw: Double
    public let dailyBuyKrw: Double
}

public struct LocalLiveOrderAttempt: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let userId: String
    public let accountSeq: Int
    public let source: String
    public let previewId: String?
    public let clientOrderId: String
    public let payloadHash: String
    public let symbol: String
    public let side: String
    public let quantity: Double
    public let limitPrice: Double
    public let currency: String
    public let krwEquivalent: Double
    public let exchangeRate: Double?
    public let status: String
    public let brokerOrderId: String?
    public let createdAt: String
    public let submissionStartedAt: String?
    public let completedAt: String?
    public let error: String?
}

public struct LocalLiveTradingResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let credential: BrokerCredentialView?
    public let liveTrading: LocalLiveTradingState
    public let guidance: [String]
}

public struct LocalKillSwitchState: Codable, Equatable, Sendable {
    public let engaged: Bool
    public let reason: String?
    public let updatedAt: String
    public let updatedBy: String
    public let blocks: [String]

    public init(
        engaged: Bool,
        reason: String?,
        updatedAt: String,
        updatedBy: String,
        blocks: [String]
    ) {
        self.engaged = engaged
        self.reason = reason
        self.updatedAt = updatedAt
        self.updatedBy = updatedBy
        self.blocks = blocks
    }
}

public struct LocalKillSwitchResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let killSwitch: LocalKillSwitchState
}

public struct LocalWorkerControlState: Codable, Equatable, Sendable {
    public let paused: Bool
    public let reason: String?
    public let updatedAt: String
    public let updatedBy: String

    public init(
        paused: Bool,
        reason: String?,
        updatedAt: String,
        updatedBy: String
    ) {
        self.paused = paused
        self.reason = reason
        self.updatedAt = updatedAt
        self.updatedBy = updatedBy
    }
}

public struct LocalWorkerControlResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let workerControl: LocalWorkerControlState
}

public struct LocalAutomationSchedulerState: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let intervalSeconds: Int
    public let running: Bool
    public let lastStartedAt: String?
    public let lastCompletedAt: String?
    public let lastStatus: String
    public let lastMessage: String?
    public let nextRunAt: String?
    public let consecutiveFailures: Int
    public let updatedAt: String
    public let updatedBy: String
}

public struct LocalAutomationSchedulerResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let scheduler: LocalAutomationSchedulerState
}

public struct LocalSymbolSearchItem: Codable, Identifiable, Equatable, Sendable {
    public let symbol: String
    public let displaySymbol: String
    public let market: String
    public let exchange: String?
    public let name: String
    public let nameKo: String?
    public let nameEn: String?
    public let currency: String
    public let assetType: String
    public let sector: String?
    public let themes: [String]?
    public let aliases: [String]?
    public let score: Double
    public let matchedBy: String

    public var id: String { "\(market):\(symbol)" }

    public var bilingualName: String {
        let names = [nameKo, nameEn, Optional(name)]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return names.reduce(into: [String]()) { result, value in
            if !result.contains(where: { $0.caseInsensitiveCompare(value) == .orderedSame }) {
                result.append(value)
            }
        }.joined(separator: " · ")
    }

    public var displayLabel: String {
        "\(bilingualName) · \(displaySymbol)"
    }
}

public struct LocalSymbolSearchResponse: Codable, Equatable, Sendable {
    public let query: String
    public let markets: [String]
    public let matches: [LocalSymbolSearchItem]
    public let warnings: [String]
}

public struct CryptoExchangeContractView: Codable, Equatable, Sendable {
    public let exchange: String
    public let baseUrl: String
    public let jwtAlgorithm: String
    public let accountsPath: String
    public let orderChancePath: String
    public let createOrderPath: String
    public let docsUrl: String
    public let authHeader: String
    public let queryHashAlgorithm: String
}

public struct CryptoExchangeStateView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { exchange }
    public let exchange: String
    public let credential: BrokerCredentialView?
    public let contract: CryptoExchangeContractView
}

public struct CryptoExchangeListResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchanges: [CryptoExchangeStateView]
}

public struct CryptoCredentialResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchange: String
    public let credential: BrokerCredentialView
    public let accountCount: Int
    public let currencies: [String]
    public let orderSubmissionAttempted: Bool
}

public struct CryptoTickerView: Codable, Equatable, Sendable {
    public let market: String
    public let tradePrice: Double
    public let timestamp: String
    public let ageMs: Double
    public let fresh: Bool
    public let maxAgeMs: Double
}

public struct CryptoOrderConstraintView: Codable, Equatable, Sendable {
    public let minTotal: Double?
    public let maxTotal: Double?
    public let priceUnit: Double?
    public let feeRate: Double?
}

public struct CryptoOrderConstraintSetView: Codable, Equatable, Sendable {
    public let bid: CryptoOrderConstraintView
    public let ask: CryptoOrderConstraintView
}

public struct CryptoReadinessResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchange: String
    public let market: String
    public let ready: Bool
    public let credential: BrokerCredentialView?
    public let readonlyChecks: [String: Bool]
    public let accountCount: Int?
    public let currencies: [String]?
    public let chanceAvailable: Bool?
    public let ticker: CryptoTickerView?
    public let orderConstraints: CryptoOrderConstraintSetView?
    public let orderSubmissionAttempted: Bool
    public let message: String
}

public struct CryptoOrderPrecheckResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchange: String
    public let market: String
    public let passed: Bool
    public let blockers: [String]
    public let estimatedValue: Double
    public let estimatedBuyCost: Double?
    public let orderChanceVerified: Bool
    public let orderConstraints: CryptoOrderConstraintView?
    public let ticker: CryptoTickerView?
    public let orderSubmissionAttempted: Bool
}

public struct CryptoManualLiveTradingLimits: Codable, Equatable, Sendable {
    public let perBuyOrderKrw: Double
    public let dailyBuyKrw: Double
}

public struct CryptoManualLiveTradingPolicy: Codable, Equatable, Sendable {
    public let installationId: String
    public let exchange: String
    public let boundUserId: String?
    public let readinessVerifiedAt: String?
    public let bindingHash: String?
    public let userConsentAt: String?
    public let manualEnabled: Bool
    public let automationEnabled: Bool
    public let manualConfirmedOrderCount: Int
    public let restartReconciledAt: String?
    public let killSwitchVerifiedAt: String?
    public let dailyBuyKrwDate: String
    public let dailyBuyKrwSubmitted: Double
    public let unknownLock: LocalLiveUnknownLock?
}

public struct CryptoManualLiveOrderAttempt: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let exchange: String
    public let market: String
    public let side: String
    public let volume: Double
    public let executedVolume: Double
    public let limitPrice: Double
    public let krwEquivalent: Double
    public let clientOrderId: String
    public let status: String
    public let brokerOrderId: String?
    public let createdAt: String
    public let completedAt: String?
    public let error: String?
}

public struct CryptoManualLiveTradingState: Codable, Equatable, Sendable {
    public let exchange: String
    public let manualOnly: Bool
    public let manualEnabled: Bool
    public let effective: Bool
    public let reason: String?
    public let remainingDailyBuyKrw: Double
    public let limits: CryptoManualLiveTradingLimits
    public let policy: CryptoManualLiveTradingPolicy
    public let attempts: [CryptoManualLiveOrderAttempt]
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool
}

public struct CryptoManualLiveTradingResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchange: String
    public let credential: BrokerCredentialView?
    public let liveTrading: CryptoManualLiveTradingState
}

public struct CryptoManualOrderPreview: Codable, Equatable, Sendable {
    public let id: String
    public let market: String
    public let side: String
    public let volume: Double
    public let price: Double
    public let estimatedValue: Double
    public let clientOrderId: String
    public let confirmationText: String
    public let expiresAt: String
}

public struct CryptoManualLiveGate: Codable, Equatable, Sendable {
    public let effective: Bool
    public let reason: String?
    public let remainingDailyBuyKrw: Double
}

public struct CryptoManualOrderPrecheckResponse: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let exchange: String
    public let market: String
    public let passed: Bool
    public let blockers: [String]
    public let estimatedValue: Double
    public let estimatedBuyCost: Double?
    public let orderChanceVerified: Bool
    public let orderConstraints: CryptoOrderConstraintView?
    public let ticker: CryptoTickerView?
    public let liveTradingGate: CryptoManualLiveGate
    public let preview: CryptoManualOrderPreview?
    public let confirmationText: String
    public let submitReady: Bool
    public let message: String
    public let orderSubmissionAttempted: Bool
}

public struct CryptoManualOrderSubmissionResponse: Codable, Equatable, Sendable {
    public let status: String
    public let error: String?
    public let orderSubmissionAttempted: Bool
    public let attempt: CryptoManualLiveOrderAttempt?
}

public struct LocalHoldingResponse: Codable, Equatable, Sendable {
    public let linked: Bool
    public let held: Bool
    public let symbol: String?
    public let accountSeq: Int?
    public let name: String?
    public let currency: String?
    public let quantity: Double?
    public let averagePurchasePrice: Double?
    public let lastPrice: Double?
    public let marketValue: Double?
    public let profitLoss: Double?
    public let dailyProfitLoss: Double?
    public let message: String?
}

public struct LocalOrderPreviewView: Codable, Equatable, Sendable {
    public let id: String
    public let clientOrderId: String
    public let accountSeq: Int
    public let symbol: String
    public let side: String
    public let orderType: String
    public let quantity: Double
    public let price: Double
    public let currency: String
    public let estimatedOrderValue: Double
    public let available: Double?
    public let ok: Bool
    public let blockers: [String]
    public let warnings: [String]
    public let liveTradingEffective: Bool
    public let liveTradingBlockedReason: String?
    public let createdAt: String
    public let expiresAt: String
    public let submittedAt: String?
}

public struct LocalOrderPrecheckLiveGate: Codable, Equatable, Sendable {
    public let effective: Bool
    public let masterEnabled: Bool
    public let userEnabled: Bool
    public let reason: String?
}

public struct LocalOrderPrecheckResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let reason: String?
    public let available: Double?
    public let symbol: String
    public let side: String
    public let quantity: Double
    public let price: Double
    public let currency: String
    public let accountSeq: Int
    public let riskCheck: DashboardRiskCheck
    public let liveTradingGate: LocalOrderPrecheckLiveGate
    public let preview: LocalOrderPreviewView
    public let blockers: [String]
    public let warnings: [String]
    public let submitReady: Bool
    public let confirmationText: String?
    public let krwEquivalent: Double?
    public let exchangeRate: Double?
    public let exchangeRateValidUntil: String?
    public let remainingDailyBuyKrw: Double?
    public let limits: LocalLiveTradingLimits?
    public let message: String
}

public struct LocalLiveOrderSubmissionResponse: Codable, Equatable, Sendable {
    public let status: String
    public let error: String?
    public let orderSubmissionAttempted: Bool
    public let attempt: LocalLiveOrderAttempt?
    public let remainingDailyBuyKrw: Double?
}

public struct AutomationCycleResponseView: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let dryRun: Bool?
    public let result: AutomationCycleResultView
}

public struct AutomationCycleResultView: Codable, Equatable, Sendable {
    public let userId: String?
    public let status: String
    public let reason: String?
    public let liveTradingEnabled: Bool?
    public let accountSeq: Int?
    public let strategies: Int?
    public let triggers: Int?
    public let orders: Int?
    public let submitted: Int?
    public let rejected: Int?
    public let blocked: Int?
    public let errors: Int?
    public let syncedOrders: Int?
    public let newFills: Int?
    public let evaluations: [AutomationStrategyEvaluationView]?
    public let safety: String?
}

public struct AutomationStrategyEvaluationView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { strategyId }

    public let strategyId: String
    public let name: String
    public let symbol: String
    public let mode: String
    public let marketPrice: Double?
    public let triggers: Int
    public let orders: [AutomationOrderOutcomeView]
    public let logs: [AutomationWorkerLogView]
    public let summary: AutomationStrategyEvaluationSummaryView?
}

public struct AutomationOrderOutcomeView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { "\(stepId):\(clientOrderId)" }

    public let stepId: String
    public let side: String
    public let limitPrice: Double?
    public let quantity: Double
    public let clientOrderId: String
    public let status: String
    public let brokerOrderId: String?
    public let message: String
}

public struct AutomationWorkerLogView: Codable, Identifiable, Equatable, Sendable {
    public var id: String { "\(stepId ?? "-"):\(level):\(message)" }

    public let level: String
    public let stepId: String?
    public let message: String
}

public struct AutomationStrategyEvaluationSummaryView: Codable, Equatable, Sendable {
    public let headline: String?
    public let action: String?
    public let mode: String?
    public let safety: String?
    public let nextAction: String?
    public let nextEntryPrice: Double?
    public let triggerDistancePct: Double?
    public let submittedOrders: Int?
    public let blockedOrders: Int?
    public let rejectedOrders: Int?
    public let errorOrders: Int?
    public let blockers: [String]?
    public let scenario: String?
}

public struct StrategyDraftInput: Equatable, Sendable {
    public let name: String
    public let symbol: String
    public let market: String
    public let preset: String
    public let mode: String
    public let basePrice: Double
    public let notional: Double
    public let rungCount: Int
    public let buyDropPct: Double
    public let sellRisePct: Double
    public let maxDailyTrades: Int
    public let maxLossPct: Double
    public let cooldownMinutes: Int
    public let executionVenue: String
    public let orderSizingMode: String?
    public let quantity: Double?
    public let rungGapPct: Double
    public let stopLossPct: Double
    public let priceAnchorSource: String
    public let priceAnchorCapturedAt: String?
    public let preservedGridRungs: [StrategyGridRungDraftInput]?

    public init(
        name: String,
        symbol: String,
        market: String,
        preset: String,
        mode: String,
        basePrice: Double,
        notional: Double,
        rungCount: Int,
        buyDropPct: Double,
        sellRisePct: Double,
        maxDailyTrades: Int,
        maxLossPct: Double,
        cooldownMinutes: Int,
        executionVenue: String = "toss",
        orderSizingMode: String? = nil,
        quantity: Double? = nil,
        rungGapPct: Double? = nil,
        stopLossPct: Double = 0,
        priceAnchorSource: String = "manual",
        priceAnchorCapturedAt: String? = nil,
        preservedGridRungs: [StrategyGridRungDraftInput]? = nil
    ) {
        self.name = name
        self.symbol = symbol
        self.market = market
        self.preset = preset
        self.mode = mode
        self.basePrice = basePrice
        self.notional = notional
        self.rungCount = rungCount
        self.buyDropPct = buyDropPct
        self.sellRisePct = sellRisePct
        self.maxDailyTrades = maxDailyTrades
        self.maxLossPct = maxLossPct
        self.cooldownMinutes = cooldownMinutes
        self.executionVenue = executionVenue
        self.orderSizingMode = orderSizingMode
        self.quantity = quantity
        self.rungGapPct = rungGapPct ?? buyDropPct
        self.stopLossPct = stopLossPct
        self.priceAnchorSource = priceAnchorSource
        self.priceAnchorCapturedAt = priceAnchorCapturedAt
        self.preservedGridRungs = preservedGridRungs
    }
}

public struct StrategyGridRungDraftInput: Equatable, Sendable {
    public let index: Int
    public let buyDropPct: Double
    public let sellRisePct: Double
    public let notional: Double

    public init(index: Int, buyDropPct: Double, sellRisePct: Double, notional: Double) {
        self.index = index
        self.buyDropPct = buyDropPct
        self.sellRisePct = sellRisePct
        self.notional = notional
    }
}

public struct StrategyOrderSizingView: Codable, Equatable, Sendable {
    public let mode: String
    public let quantity: Double?
    public let notional: Double?
}

public struct StrategyLastSimulationView: Codable, Equatable, Sendable {
    public let configHash: String
    public let passed: Bool
    public let blockers: [String]
    public let warnings: [String]
    public let expectedReturnPct: Double
    public let expectedLossPct: Double
    public let summary: String
    public let simulatedAt: String
}

public struct StrategyAutomationReadinessView: Codable, Equatable, Sendable {
    public let simulationCurrent: Bool
    public let simulationPassed: Bool
    public let paperAutomationReady: Bool
    public let liveSubmissionReady: Bool
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool
    public let credentialVerified: Bool
    public let accountPreferenceSelected: Bool
    public let liveGateStatus: Int
    public let liveGateReason: String?
    public let blockers: [String]
    public let liveBlockers: [String]
    public let nextActions: [String]
}

public struct StrategyPriceAnchorView: Codable, Equatable, Sendable {
    public let source: String
    public let price: Double
    public let capturedAt: String?
}

public struct StrategyGridRungView: Codable, Identifiable, Equatable, Sendable {
    public var id: Int { index }

    public let index: Int
    public let buyDropPct: Double
    public let sellRisePct: Double
    public let notional: Double
}

public struct StrategyGridView: Codable, Equatable, Sendable {
    public let basePrice: Double
    public let rungs: [StrategyGridRungView]
}

public struct StrategyLoopView: Codable, Equatable, Sendable {
    public let anchorPrice: Double
    public let buyDropPct: Double
    public let sellRisePct: Double
    public let notional: Double
    public let cooldownMinutes: Int
}

public struct StrategyRiskLimitsView: Codable, Equatable, Sendable {
    public let maxDailyBuys: Int
    public let maxDailySells: Int
    public let maxPositionValue: Double
    public let maxLossPct: Double
    public let maxHoldHours: Int
}

public struct StrategyConfigView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let symbol: String
    public let market: String
    public let instrument: InstrumentDisplayView?
    public let executionVenue: String?
    public let preset: String?
    public let status: String
    public let mode: String?
    public let orderSizing: StrategyOrderSizingView?
    public let currentPrice: Double
    public let currentConfigHash: String?
    public let automationReadiness: StrategyAutomationReadinessView?
    public let lastSimulation: StrategyLastSimulationView?
    public let grid: StrategyGridView?
    public let loop: StrategyLoopView?
    public let priceAnchor: StrategyPriceAnchorView?
    public let riskLimits: StrategyRiskLimitsView?
    public let exitRules: StrategyExitRulesView?
    public let updatedAt: String
}

public struct StrategyRiskCheckView: Codable, Equatable, Sendable {
    public let passed: Bool
    public let blockers: [String]
    public let warnings: [String]
}

public struct StrategyOrderIntentDraftView: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let side: String
    public let orderType: String
    public let quantity: Double
    public let notional: Double
    public let limitPrice: Double
    public let status: String
    public let reason: String
    public let createdAt: String
}

public struct StrategySimulationResultView: Codable, Equatable, Sendable {
    public let strategyConfigId: String
    public let configHash: String
    public let summary: String
    public let expectedReturnPct: Double
    public let expectedLossPct: Double
    public let orderIntents: [StrategyOrderIntentDraftView]
    public let riskCheck: StrategyRiskCheckView
    public let logs: [String]
    public let simulatedAt: String
}

public struct StrategyConfigListResponse: Codable, Equatable, Sendable {
    public let configs: [StrategyConfigView]
}

public struct StrategyConfigResponse: Codable, Equatable, Sendable {
    public let config: StrategyConfigView
}

public struct StrategyExportBundle: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let exportedAt: String
    public let source: String
    public let configCount: Int
    public let safety: StrategyExportSafety
    public let configs: [StrategyExportConfig]
}

public struct StrategyExportSafety: Codable, Equatable, Sendable {
    public let credentialsIncluded: Bool
    public let accountPreferenceIncluded: Bool
    public let importedStatus: String
    public let importedSimulation: String
}

public struct StrategyLadderStepView: Codable, Equatable, Sendable {
    public let id: String
    public let side: String
    public let price: Double
    public let notional: Double
    public let condition: String
}

public struct StrategyExitRulesView: Codable, Equatable, Sendable {
    public let takeProfitPct: Double
    public let stopLossPct: Double
    public let rescueMode: String
}

public struct StrategyExportConfig: Codable, Equatable, Sendable {
    public let sourceId: String?
    public let name: String
    public let symbol: String
    public let market: String
    public let executionVenue: String?
    public let preset: String
    public let mode: String?
    public let orderSizing: StrategyOrderSizingView?
    public let supportPrice: Double?
    public let resistancePrice: Double?
    public let currentPrice: Double
    public let ladder: [StrategyLadderStepView]?
    public let grid: StrategyGridView?
    public let loop: StrategyLoopView?
    public let priceAnchor: StrategyPriceAnchorView?
    public let riskLimits: StrategyRiskLimitsView?
    public let exitRules: StrategyExitRulesView?
}

public struct StrategyImportResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let imported: Int
    public let skipped: Int
    public let status: String
    public let safety: StrategyImportSafety
    public let configs: [StrategyConfigView]
    public let errors: [StrategyImportError]
}

public struct StrategyImportSafety: Codable, Equatable, Sendable {
    public let enabledStrategiesImported: Int
    public let lastSimulationDiscarded: Bool
    public let liveTradingChanged: Bool
}

public struct StrategyImportError: Codable, Equatable, Sendable {
    public let index: Int
    public let errors: [String]
}

public struct StrategySimulationResponse: Codable, Equatable, Sendable {
    public let result: StrategySimulationResultView
    public let config: StrategyConfigView?
}

public struct TerminalDashboardSnapshot: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let symbol: String
    public let session: String
    public let orderIntent: DashboardOrderIntent
    public let riskCheck: DashboardRiskCheck
    public let auditTrail: [DashboardAuditEntry]
    public let riskScenarios: [DashboardRiskScenario]
    public let watchlistAlerts: [DashboardWatchlistAlert]
    public let watchlistAlertEvaluations: [DashboardWatchlistAlertEvaluation]
    public let newsCredibility: [DashboardNewsCredibility]
    public let preTradeChecklist: [DashboardChecklistItem]
    public let replayEvents: [DashboardReplayEvent]
    public let playbook: DashboardPlaybook
}

public struct LocalWatchlistItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let name: String?
    public let assetClass: String
    public let market: String
    public let addedAt: String
}

public struct LocalWatchlistSummaryItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let name: String?
    public let assetClass: String
    public let market: String
    public let addedAt: String
    public let price: Double?
    public let changePercent: Double?
    public let currency: String
    public let dataSource: String
    public let quoteAt: String?
    public let stale: Bool
    public let error: String?
    public let instrument: InstrumentDisplayView?
    public let insights: LocalWatchlistInsights?
}

public struct InstrumentDisplayView: Codable, Equatable, Sendable {
    public let primaryName: String
    public let code: String
    public let market: String
    public let source: String
}

public struct LocalWatchlistInsights: Codable, Equatable, Sendable {
    public let technical: LocalWatchlistTechnicalInsight
    public let sentiment: LocalWatchlistSentimentInsight
    public let attention: LocalWatchlistAttentionInsight
}

public struct LocalWatchlistTechnicalInsight: Codable, Equatable, Sendable {
    public let label: String
    public let status: String
    public let detail: String
    public let generatedAt: String?
    public let error: String?
}

public struct LocalWatchlistSentimentInsight: Codable, Equatable, Sendable {
    public let label: String
    public let status: String
    public let painScore: Int?
    public let gajuaScore: Int?
    public let confidence: Int?
    public let evidenceCount: Int?
    public let generatedAt: String?
    public let error: String?
}

public struct LocalWatchlistAttentionInsight: Codable, Equatable, Sendable {
    public let label: String
    public let status: String
    public let source: String
    public let detail: String
    public let rank: Int?
    public let generatedAt: String?
    public let error: String?
}

public struct LocalWatchlistResponse: Codable, Equatable, Sendable {
    public let maxItems: Int
    public let items: [LocalWatchlistItem]
}

public struct LocalWatchlistSummaryResponse: Codable, Equatable, Sendable {
    public let maxItems: Int
    public let generatedAt: String
    public let items: [LocalWatchlistSummaryItem]
}

public struct LocalWatchlistItemInput: Encodable, Sendable {
    public let symbol: String
    public let assetClass: String
    public let market: String
    public let name: String?

    public init(symbol: String, assetClass: String, market: String, name: String? = nil) {
        self.symbol = symbol
        self.assetClass = assetClass
        self.market = market
        self.name = name
    }
}

public struct DashboardOrderIntent: Codable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let side: String
    public let type: String
    public let quantity: Int
    public let limitPrice: Double?
    public let stopPrice: Double?
    public let currency: String
    public let status: String
    public let rationale: [String]
    public let createdAt: String
}

public struct DashboardRiskCheck: Codable, Equatable, Sendable {
    public let passed: Bool
    public let blockers: [String]
    public let warnings: [String]
    public let maxPositionValue: Double?
    public let estimatedOrderValue: Double?
}

public struct DashboardAuditEntry: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let createdAt: String
    public let symbol: String
    public let type: String
    public let title: String
    public let detail: String
    public let state: String
    public let orderIntentId: String?
}

public struct DashboardRiskScenario: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let shock: String
    public let estimatedPnl: Double
    public let severity: String
}

public struct DashboardWatchlistAlert: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let scope: String
    public let title: String
    public let detail: String
    public let enabled: Bool
    public let priority: String
    public let cooldownMinutes: Int
}

public struct DashboardWatchlistAlertEvaluation: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let ruleId: String
    public let scope: String
    public let symbol: String
    public let triggered: Bool
    public let state: String
    public let priority: String
    public let evaluatedAt: String
    public let title: String
    public let detail: String
    public let evidence: [String]
}

public struct DashboardNewsCredibility: Codable, Identifiable, Equatable, Sendable {
    public var id: String { sourceId }
    public let sourceId: String
    public let sourceName: String
    public let grade: String
    public let score: Double
    public let allowedForOrderInput: Bool
    public let rationale: String
}

public struct DashboardChecklistItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let status: String
}

public struct DashboardReplayEvent: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let occurredAt: String
    public let symbol: String
    public let kind: String
    public let title: String
    public let detail: String
}

public struct DashboardPlaybook: Codable, Equatable, Sendable {
    public let symbol: String
    public let thesis: String
    public let entryRule: String
    public let invalidationRule: String
    public let addRule: String
    public let trimRule: String
    public let target: String
    public let workerMode: String
    public let updatedAt: String

    public init(
        symbol: String,
        thesis: String,
        entryRule: String,
        invalidationRule: String,
        addRule: String,
        trimRule: String,
        target: String,
        workerMode: String,
        updatedAt: String
    ) {
        self.symbol = symbol
        self.thesis = thesis
        self.entryRule = entryRule
        self.invalidationRule = invalidationRule
        self.addRule = addRule
        self.trimRule = trimRule
        self.target = target
        self.workerMode = workerMode
        self.updatedAt = updatedAt
    }
}
