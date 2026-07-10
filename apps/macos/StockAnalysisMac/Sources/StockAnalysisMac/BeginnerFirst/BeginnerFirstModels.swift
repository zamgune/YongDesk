import Foundation
import SwiftUI
import StockAnalysisMacCore

enum BeginnerDestination: String, CaseIterable, Identifiable {
    case chart
    case assets
    case strategy
    case automation
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chart: return "차트"
        case .assets: return "내 자산"
        case .strategy: return "전략"
        case .automation: return "자동화"
        case .settings: return "설정"
        }
    }

    var icon: String {
        switch self {
        case .chart: return "chart.xyaxis.line"
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
    case signals
    case newsSentiment

    var id: String { rawValue }

    var title: String {
        switch self {
        case .analysis: return "분석"
        case .signals: return "신호"
        case .newsSentiment: return "뉴스·민심"
        }
    }

    var accessibilityIdentifier: String {
        "beginner-analysis-tab-\(rawValue)"
    }
}

enum BeginnerTradeHorizon: String, CaseIterable, Identifiable {
    case day
    case swing
    case longTerm

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "단타"
        case .swing: return "스윙"
        case .longTerm: return "장투"
        }
    }

    var subtitle: String {
        switch self {
        case .day: return "위험 필터 · 1시간 진입"
        case .swing: return "상위 방향 · 1시간 진입"
        case .longTerm: return "일봉 · 주봉 구조"
        }
    }

    var accessibilityIdentifier: String {
        "beginner-horizon-\(rawValue)"
    }
}

enum BeginnerSettingsSheet: Identifiable {
    case toss
    case crypto
    case strategy
    case selfTest
    case distribution
    case sidecarLog

    var id: String {
        switch self {
        case .toss: return "toss"
        case .crypto: return "crypto"
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
    case let .unknown(value): return value
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
