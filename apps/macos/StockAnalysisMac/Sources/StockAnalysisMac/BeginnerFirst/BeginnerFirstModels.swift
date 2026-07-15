import Foundation
import SwiftUI
import StockAnalysisMacCore

extension Notification.Name {
    static let openBeginnerSupportSelfTest = Notification.Name("openBeginnerSupportSelfTest")
    static let openBeginnerSupportLog = Notification.Name("openBeginnerSupportLog")
}

enum BeginnerDestination: String, CaseIterable, Identifiable {
    case chart
    case sector
    case sentiment
    case watchlist
    case assets
    case strategy
    case automation
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chart: return "차트"
        case .sector: return "섹터"
        case .sentiment: return "민심"
        case .watchlist: return "관심종목"
        case .assets: return "내 자산"
        case .strategy: return "전략"
        case .automation: return "자동화"
        case .settings: return "설정"
        }
    }

    var icon: String {
        switch self {
        case .chart: return "chart.xyaxis.line"
        case .sector: return "square.grid.3x3.fill"
        case .sentiment: return "bubble.left.and.text.bubble.right.fill"
        case .watchlist: return "star"
        case .assets: return "wallet.bifold"
        case .strategy: return "slider.horizontal.3"
        case .automation: return "bolt.horizontal.circle"
        case .settings: return "gearshape"
        }
    }

    var accessibilityIdentifier: String {
        "beginner-nav-\(rawValue)"
    }
}

enum BeginnerAPIConnectionProvider: String, CaseIterable, Identifiable {
    case toss
    case upbit
    case bithumb

    var id: String { rawValue }

    var title: String {
        switch self {
        case .toss: return "Toss 주식 API"
        case .upbit: return "Upbit API"
        case .bithumb: return "Bithumb API"
        }
    }

    var shortTitle: String {
        switch self {
        case .toss: return "Toss 주식"
        case .upbit: return "Upbit"
        case .bithumb: return "Bithumb"
        }
    }

    var detail: String {
        switch self {
        case .toss:
            return "계좌·보유·미체결 조회와 paper 자동화 사전검증"
        case .upbit, .bithumb:
            return "코인 잔고·주문 가능 정보와 paper 자동화 사전검증"
        }
    }

    var identifierLabel: String {
        self == .toss ? "Client ID" : "Access Key"
    }

    var secretLabel: String {
        self == .toss ? "Client Secret" : "Secret Key"
    }

    var accessibilityIdentifier: String {
        "beginner-api-provider-\(rawValue)"
    }
}

enum BeginnerAssetClass: String, CaseIterable, Identifiable {
    case stock
    case crypto

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stock: return "주식"
        case .crypto: return "코인"
        }
    }
}

enum BeginnerStockMarket: String, CaseIterable, Identifiable {
    case korea
    case unitedStates

    var id: String { rawValue }

    var title: String {
        switch self {
        case .korea: return "한국"
        case .unitedStates: return "미국"
        }
    }

    var session: String {
        switch self {
        case .korea: return "KR"
        case .unitedStates: return "US"
        }
    }
}

enum BeginnerAnalysisTab: String, CaseIterable, Identifiable {
    case analysis
    case order
    case newsSentiment

    var id: String { rawValue }

    var title: String {
        switch self {
        case .analysis: return "분석"
        case .order: return "주문"
        case .newsSentiment: return "뉴스"
        }
    }

    var accessibilityIdentifier: String {
        "beginner-analysis-tab-\(rawValue)"
    }
}

enum BeginnerChartTimeframe: String, CaseIterable, Identifiable {
    case fiveMinutes = "5m"
    case fifteenMinutes = "15m"
    case thirtyMinutes = "30m"
    case oneHour = "1h"
    case fourHours = "4h"
    case oneDay = "1d"
    case oneWeek = "1wk"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .fiveMinutes: return "5분"
        case .fifteenMinutes: return "15분"
        case .thirtyMinutes: return "30분"
        case .oneHour: return "1시간"
        case .fourHours: return "4시간"
        case .oneDay: return "일봉"
        case .oneWeek: return "주봉"
        }
    }

    var analysisTimeframe: AnalysisTimeframe {
        switch self {
        case .fiveMinutes: return .fiveMinutes
        case .fifteenMinutes: return .fifteenMinutes
        case .thirtyMinutes: return .thirtyMinutes
        case .oneHour: return .oneHour
        case .fourHours: return .fourHours
        case .oneDay: return .oneDay
        case .oneWeek: return .oneWeek
        }
    }

    var visibleCandleLimit: Int {
        switch self {
        case .fiveMinutes, .fifteenMinutes, .thirtyMinutes: return 180
        case .oneHour, .fourHours: return 160
        case .oneDay: return 120
        case .oneWeek: return 104
        }
    }
}

enum BeginnerTradeHorizon: String, CaseIterable, Identifiable {
    case day
    case swing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "1~3일 단기"
        case .swing: return "스윙"
        }
    }

    var subtitle: String {
        switch self {
        case .day: return "위험 필터 · 1시간 진입"
        case .swing: return "상위 방향 · 1시간 진입"
        }
    }

    var accessibilityIdentifier: String {
        "beginner-horizon-\(rawValue)"
    }
}

enum BeginnerEntryPriceMode: String, CaseIterable, Identifiable {
    case latestClose
    case holdingAverage
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .latestClose: return "최근 확정 종가"
        case .holdingAverage: return "보유 평단"
        case .custom: return "직접 입력"
        }
    }
}

enum BeginnerSettingsSheet: Identifiable {
    case strategy
    case selfTest
    case distribution
    case sidecarLog

    var id: String {
        switch self {
        case .strategy: return "strategy"
        case .selfTest: return "self-test"
        case .distribution: return "distribution"
        case .sidecarLog: return "sidecar-log"
        }
    }
}

enum BeginnerPalette {
    static let background = Color(red: 0.027, green: 0.063, blue: 0.098)
    static let backgroundDeep = Color(red: 0.020, green: 0.043, blue: 0.071)
    static let surface = Color(red: 0.047, green: 0.090, blue: 0.133)
    static let surfaceRaised = Color(red: 0.067, green: 0.122, blue: 0.173)
    static let surfaceSoft = Color(red: 0.082, green: 0.145, blue: 0.204)
    static let line = Color(red: 0.129, green: 0.208, blue: 0.275)
    static let lineStrong = Color(red: 0.192, green: 0.314, blue: 0.400)
    static let text = Color(red: 0.933, green: 0.965, blue: 0.973)
    static let muted = Color(red: 0.569, green: 0.659, blue: 0.718)
    static let green = Color(red: 0.263, green: 0.839, blue: 0.682)
    static let blue = Color(red: 0.431, green: 0.667, blue: 1.000)
    static let amber = Color(red: 0.953, green: 0.718, blue: 0.416)
    static let red = Color(red: 1.000, green: 0.490, blue: 0.525)
}

struct BeginnerSurface<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(BeginnerPalette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(BeginnerPalette.line, lineWidth: 1)
            }
    }
}

struct BeginnerStatusBadge: View {
    let text: String
    let color: Color

    init(_ text: String, color: Color) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(color.opacity(0.12), in: Capsule())
            .overlay {
                Capsule().stroke(color.opacity(0.35), lineWidth: 1)
            }
    }
}

func beginnerPrice(_ value: Double?, currency: String) -> String {
    guard let value else { return "-" }
    if currency == "KRW" {
        return "₩\(Int(value.rounded()).formatted())"
    }
    if value >= 1_000 {
        return "\(currency) \(value.formatted(.number.precision(.fractionLength(0))))"
    }
    return "\(currency) \(value.formatted(.number.precision(.fractionLength(2))))"
}

func beginnerPercent(_ value: Double?) -> String {
    guard let value else { return "-" }
    return value.formatted(.percent.precision(.fractionLength(2)).sign(strategy: .always()))
}

func beginnerTimestamp(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "기준 시각 대기" }
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fallbackFormatter = ISO8601DateFormatter()
    fallbackFormatter.formatOptions = [.withInternetDateTime]
    guard let date = fractionalFormatter.date(from: value) ?? fallbackFormatter.date(from: value) else {
        return value
    }
    return date.formatted(
        Date.FormatStyle(
            date: .abbreviated,
            time: .shortened,
            locale: Locale(identifier: "ko_KR"),
            timeZone: .current
        )
    )
}

func beginnerDataSourceLabel(_ source: AnalysisDataSource?) -> String {
    switch source {
    case .toss: return "Toss 공식 시세"
    case .upbit: return "Upbit 공개 시세"
    case .yahoo: return "Yahoo 보조 시세"
    case .fixture: return "테스트 fixture"
    case .auto: return "자동 선택"
    case let .unknown(value):
        return value == "toss+yahoo" || value == "yahoo+toss" ? "Toss + Yahoo 시간봉 보완" : value
    case nil: return "출처 확인 중"
    }
}

func beginnerCanonicalSymbol(_ value: String) -> String {
    var symbol = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if symbol.hasSuffix(".KS") || symbol.hasSuffix(".KQ") {
        symbol.removeLast(3)
    }
    if symbol.hasPrefix("KRW-") {
        symbol.removeFirst(4)
    }
    if symbol.hasSuffix("USDT") {
        symbol.removeLast(4)
    } else if symbol.hasSuffix("-USD") {
        symbol.removeLast(4)
    }
    return symbol
}

func beginnerInstrumentPrimary(
    _ instrument: InstrumentDisplayView?,
    fallbackName: String? = nil,
    fallbackCode: String
) -> String {
    if let name = instrument?.primaryName.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
        return name
    }
    if let name = fallbackName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
        return name
    }
    return beginnerCanonicalSymbol(fallbackCode)
}

func beginnerInstrumentCode(_ instrument: InstrumentDisplayView?, fallbackCode: String) -> String {
    let code = instrument?.code.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return code.isEmpty ? beginnerCanonicalSymbol(fallbackCode) : code
}

func beginnerInstrumentMarketLabel(_ market: String) -> String {
    switch market {
    case "KR", "KOSPI", "KOSDAQ": return "한국"
    case "US": return "미국"
    default: return "코인"
    }
}
