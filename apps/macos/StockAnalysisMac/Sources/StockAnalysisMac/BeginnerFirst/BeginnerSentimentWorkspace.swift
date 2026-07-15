import Foundation
import SwiftUI
import StockAnalysisMacCore

struct BeginnerSentimentWorkspace: View {
    @EnvironmentObject private var model: AppModel

    let selectedSymbol: String
    let stockMarket: BeginnerStockMarket
    let onRefresh: (Bool) async -> SentimentOverviewResponseView?

    private var requestKey: String {
        "\(stockMarket.session):\(selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())"
    }

    private var overview: SentimentOverviewResponseView? {
        guard let response = model.sentimentOverview,
              beginnerCanonicalSymbol(response.canonicalSymbol) == beginnerCanonicalSymbol(selectedSymbol),
              response.symbolMarket == stockMarket.session else {
            return nil
        }
        return response
    }

    private var pollingKey: String {
        "\(requestKey):\(overview?.marketComparison.status ?? "none")"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let error = model.sentimentOverviewErrorMessage {
                    errorBanner(error)
                }

                if let overview {
                    instrumentSection(overview)
                    marketSection(overview)
                } else {
                    loadingOrEmptyState
                }
            }
            .padding(20)
            .frame(maxWidth: 1_180, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .background(BeginnerPalette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-sentiment-root")
        .task(id: requestKey) {
            _ = await onRefresh(false)
        }
        .task(id: pollingKey) {
            guard overview?.marketComparison.status == "warming" else { return }
            for _ in 0..<12 {
                do {
                    try await Task.sleep(for: .seconds(5))
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                let response = await onRefresh(false)
                guard response?.marketComparison.status == "warming" else { return }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("민심 레이더")
                    .font(.system(size: 25, weight: .bold))
                    .accessibilityAddTraits(.isHeader)
                Text("\(selectedSymbol) · 한국과 해외 커뮤니티의 수집된 반응을 분리해 봅니다.")
                    .font(.system(size: 13))
                    .foregroundStyle(BeginnerPalette.muted)
                Text("반응 분류와 강도는 참고 근거이며 매수 신호나 주문 입력으로 사용하지 않습니다.")
                    .font(.system(size: 11))
                    .foregroundStyle(BeginnerPalette.muted)
            }

            Spacer()

            if let overview {
                VStack(alignment: .trailing, spacing: 7) {
                    HStack(spacing: 7) {
                        if overview.stale || model.sentimentOverviewUsingPreviousData {
                            BeginnerStatusBadge("이전 데이터", color: BeginnerPalette.amber)
                        }
                        BeginnerStatusBadge(stockMarket.title, color: BeginnerPalette.blue)
                    }
                    Text("갱신 \(beginnerTimestamp(overview.generatedAt))")
                        .font(.system(size: 10))
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
        }
    }

    @ViewBuilder
    private func instrumentSection(_ response: SentimentOverviewResponseView) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("현재 종목", detail: "수집된 반응 비율 · 합계 100%")
            SentimentCommunityRow(
                title: "한국 커뮤니티",
                subtitle: response.symbolMarket == "KR" ? "선택 종목의 국내 반응" : "미국 종목의 국내 반응",
                bucket: response.instrument.krCommunity,
                accessibilityIdentifier: "beginner-sentiment-instrument-kr"
            )
            SentimentCommunityRow(
                title: "해외 커뮤니티",
                subtitle: "Reddit 등 해외 반응",
                bucket: response.instrument.globalCommunity,
                accessibilityIdentifier: "beginner-sentiment-instrument-global"
            )
        }
    }

    @ViewBuilder
    private func marketSection(_ response: SentimentOverviewResponseView) -> some View {
        let comparison = response.marketComparison
        if comparison.status == "warming" {
            BeginnerSurface {
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("한국·미국 시장 민심을 준비 중입니다")
                            .font(.system(size: 14, weight: .semibold))
                        Text("거래대금 상위 30종목을 동일가중으로 집계합니다. 최대 60초 동안 자동으로 다시 확인합니다.")
                            .font(.system(size: 11))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                }
            }
            .accessibilityIdentifier("beginner-sentiment-source-connection")
        } else if ["ready", "low_evidence"].contains(comparison.status),
                  let kr = comparison.kr,
                  let us = comparison.us {
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("시장 비교", detail: "거래대금 상위 30종목 · 종목별 동일가중")
                SentimentCommunityRow(
                    title: "한국 시장 30종목",
                    subtitle: marketBucketSubtitle(kr),
                    bucket: kr,
                    accessibilityIdentifier: "beginner-sentiment-market-kr",
                    showsIntensity: false
                )
                SentimentCommunityRow(
                    title: "미국 시장 30종목",
                    subtitle: marketBucketSubtitle(us),
                    bucket: us,
                    accessibilityIdentifier: "beginner-sentiment-market-us",
                    showsIntensity: false
                )
                deltaCard(response)
            }
        } else {
            sourceConnectionCard(reason: comparison.reason, status: comparison.status)
        }
    }

    private var loadingOrEmptyState: some View {
        BeginnerSurface {
            HStack(spacing: 12) {
                if model.isSentimentOverviewLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .foregroundStyle(BeginnerPalette.muted)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.isSentimentOverviewLoading ? "종목 민심을 불러오는 중입니다" : "표시할 민심 데이터가 없습니다")
                        .font(.system(size: 14, weight: .semibold))
                    Text(model.sentimentOverviewMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(BeginnerPalette.amber)
            Text(message)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(BeginnerPalette.text)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BeginnerPalette.amber.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(BeginnerPalette.amber.opacity(0.35)) }
        .accessibilityIdentifier("beginner-sentiment-error")
    }

    private func sourceConnectionCard(reason: String?, status: String) -> some View {
        let needsConnection = status == "configuration_required"
        return BeginnerSurface {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 9) {
                    Image(systemName: needsConnection ? "link.badge.plus" : "exclamationmark.triangle")
                        .foregroundStyle(BeginnerPalette.amber)
                    Text(needsConnection ? "시장 비교를 표시하려면 소스 연결이 필요합니다" : "현재 시장 비교는 표시할 수 없습니다")
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(sentimentReasonText(reason, fallbackStatus: status))
                    .font(.system(size: 12))
                    .foregroundStyle(BeginnerPalette.muted)
                Text(needsConnection
                    ? "한국·미국 Toss 거래대금 순위와 Reddit OAuth가 모두 준비돼야 30종목 비교를 계산합니다. 대체 종목이나 Yahoo 순위로 채우지 않습니다."
                    : "시장별 10종목·50건 미만이면 0% 막대를 만들지 않습니다. 표본이 준비되면 캐시 조회로 다시 표시합니다.")
                    .font(.system(size: 11))
                    .foregroundStyle(BeginnerPalette.muted)
            }
        }
        .accessibilityIdentifier("beginner-sentiment-source-connection")
    }

    private func deltaCard(_ response: SentimentOverviewResponseView) -> some View {
        let instrument = stockMarket == .korea
            ? response.instrument.krCommunity
            : response.instrument.globalCommunity
        let market = stockMarket == .korea
            ? response.marketComparison.kr
            : response.marketComparison.us
        let bullishDelta = instrument.ratios.flatMap { instrumentRatios in
            market?.ratios.map { instrumentRatios.bullishHype - $0.bullishHype }
        }
        let bearishDelta = instrument.ratios.flatMap { instrumentRatios in
            market?.ratios.map { instrumentRatios.bearishCriticism - $0.bearishCriticism }
        }

        return BeginnerSurface {
            VStack(alignment: .leading, spacing: 9) {
                Text("선택 종목 vs \(stockMarket.title) 시장")
                    .font(.system(size: 13, weight: .semibold))
                if let bullishDelta, let bearishDelta {
                    HStack(spacing: 10) {
                        deltaPill("가즈아", value: bullishDelta, color: BeginnerPalette.green)
                        deltaPill("비관·비난", value: bearishDelta, color: BeginnerPalette.red)
                    }
                    Text("양수는 선택 종목의 수집된 반응 비율이 시장 평균보다 높다는 뜻입니다.")
                        .font(.system(size: 10))
                        .foregroundStyle(BeginnerPalette.muted)
                } else {
                    Text("선택 종목과 시장의 표본이 모두 준비되면 차이(%p)를 표시합니다.")
                        .font(.system(size: 11))
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
        }
    }

    private func deltaPill(_ title: String, value: Int, color: Color) -> some View {
        Text("\(title) \(value >= 0 ? "+" : "")\(value)%p")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(color.opacity(0.10), in: Capsule())
    }

    private func sectionTitle(_ title: String, detail: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(BeginnerPalette.muted)
            Spacer()
        }
    }

    private func marketBucketSubtitle(_ bucket: SentimentBucketView) -> String {
        let coverage = bucket.coverageCount.map(String.init) ?? "-"
        let universe = bucket.universeCount.map(String.init) ?? "30"
        return "커버리지 \(coverage)/\(universe)종목 · 상승 우세 \(bucket.bullishBreadth ?? 0) · 비관 우세 \(bucket.bearishBreadth ?? 0)"
    }
}

private struct SentimentCommunityRow: View {
    let title: String
    let subtitle: String
    let bucket: SentimentBucketView
    let accessibilityIdentifier: String
    var showsIntensity = true

    @State private var isExpanded = false

    private var isAvailable: Bool {
        ["ready", "low_evidence"].contains(bucket.status) && bucket.ratios != nil
    }

    var body: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.system(size: 14, weight: .bold))
                        Text(subtitle)
                            .font(.system(size: 10))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    BeginnerStatusBadge(sentimentStatusLabel(bucket.status), color: sentimentStatusColor(bucket.status))
                }

                if isAvailable, let ratios = bucket.ratios {
                    SentimentRatioBar(ratios: ratios, accessibilityIdentifier: "\(accessibilityIdentifier)-ratio")
                    sampleSummary
                    if showsIntensity {
                        SentimentIntensityView(
                            fomo: bucket.fomo,
                            pain: bucket.pain,
                            toxicity: bucket.toxicity
                        )
                    }
                } else if bucket.status == "warming" {
                    HStack(spacing: 9) {
                        ProgressView().controlSize(.small)
                        Text("반응 표본을 집계 중입니다.")
                            .font(.system(size: 11))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("비교 불가")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(BeginnerPalette.amber)
                        Text(sentimentReasonText(bucket.reason, fallbackStatus: bucket.status))
                            .font(.system(size: 11))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                }

                if !(bucket.sourceStats ?? []).isEmpty || !(bucket.evidence ?? []).isEmpty {
                    DisclosureGroup(isExpanded: $isExpanded) {
                        SentimentEvidenceDetails(bucket: bucket)
                            .padding(.top, 9)
                    } label: {
                        Text("분류 근거와 소스 상태")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(BeginnerPalette.blue)
                    }
                    .accessibilityIdentifier("\(accessibilityIdentifier)-sources")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private var sampleSummary: some View {
        let samples = bucket.sampleCount.map(String.init) ?? "-"
        let authors = bucket.uniqueAuthorCount.map { " · 작성자 \($0)명" } ?? ""
        let window = bucket.effectiveWindowHours.map { " · \($0)시간" } ?? ""
        return Text("최상위 글 \(samples)건\(authors)\(window)")
            .font(.system(size: 10))
            .foregroundStyle(BeginnerPalette.muted)
    }
}

private struct SentimentRatioBar: View {
    let ratios: SentimentReactionRatiosView
    let accessibilityIdentifier: String

    private var total: CGFloat {
        CGFloat(max(ratios.total, 1))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    segment(ratios.bullishHype, color: BeginnerPalette.green, width: proxy.size.width)
                    segment(ratios.bearishCriticism, color: BeginnerPalette.red, width: proxy.size.width)
                    segment(ratios.mixed, color: BeginnerPalette.amber, width: proxy.size.width)
                    segment(ratios.neutral, color: BeginnerPalette.muted, width: proxy.size.width)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(BeginnerPalette.line, lineWidth: 1) }
            }
            .frame(height: 20)

            HStack(spacing: 14) {
                legend("가즈아", value: ratios.bullishHype, color: BeginnerPalette.green)
                legend("비관·비난", value: ratios.bearishCriticism, color: BeginnerPalette.red)
                legend("혼재", value: ratios.mixed, color: BeginnerPalette.amber)
                legend("중립", value: ratios.neutral, color: BeginnerPalette.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("수집된 반응 비율")
        .accessibilityValue("가즈아 \(ratios.bullishHype)%, 비관 비난 \(ratios.bearishCriticism)%, 혼재 \(ratios.mixed)%, 중립 \(ratios.neutral)%")
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func segment(_ value: Int, color: Color, width: CGFloat) -> some View {
        color.frame(width: width * CGFloat(value) / total)
    }

    private func legend(_ title: String, value: Int, color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text("\(title) \(value)%")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(BeginnerPalette.text)
        }
    }
}

private struct SentimentIntensityView: View {
    let fomo: Double?
    let pain: Double?
    let toxicity: Double?

    var body: some View {
        HStack(spacing: 12) {
            intensity("FOMO", value: fomo, color: BeginnerPalette.green)
            intensity("공포", value: pain, color: BeginnerPalette.red)
            intensity("공격성/욕설", value: toxicity, color: BeginnerPalette.amber)
        }
    }

    private func intensity(_ title: String, value: Double?, color: Color) -> some View {
        let normalized = min(max(value ?? 0, 0), 100)
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                Spacer()
                Text(value.map { String(Int($0.rounded())) } ?? "-")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(BeginnerPalette.backgroundDeep)
                    Capsule().fill(color).frame(width: proxy.size.width * CGFloat(normalized) / 100)
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct SentimentEvidenceDetails: View {
    let bucket: SentimentBucketView

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let sources = bucket.sourceStats, !sources.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("소스 상태")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(BeginnerPalette.muted)
                    ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                        HStack(alignment: .top, spacing: 7) {
                            Circle()
                                .fill(sentimentStatusColor(source.status))
                                .frame(width: 6, height: 6)
                                .padding(.top, 5)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(source.label ?? source.id) · \(sentimentStatusLabel(source.status))")
                                    .font(.system(size: 10, weight: .semibold))
                                if let reason = source.reason, !reason.isEmpty {
                                    Text(sentimentReasonText(reason, fallbackStatus: source.status))
                                        .font(.system(size: 9))
                                        .foregroundStyle(BeginnerPalette.muted)
                                }
                            }
                        }
                    }
                }
            }

            if let evidence = bucket.evidence, !evidence.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("분류별 근거 링크")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(BeginnerPalette.muted)
                    ForEach(Array(evidence.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .top, spacing: 7) {
                            Text(sentimentClassificationLabel(item.classification))
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(sentimentClassificationColor(item.classification))
                                .frame(width: 60, alignment: .leading)
                            if let rawURL = item.url, let url = URL(string: rawURL) {
                                Link(destination: url) {
                                    evidenceTitle(item)
                                }
                            } else {
                                evidenceTitle(item)
                            }
                            Spacer(minLength: 4)
                            if let source = item.sourceLabel ?? item.sourceId {
                                Text(source)
                                    .font(.system(size: 9))
                                    .foregroundStyle(BeginnerPalette.muted)
                            }
                        }
                    }
                }
            }
        }
    }

    private func evidenceTitle(_ item: SentimentEvidenceView) -> some View {
        Text((item.title?.isEmpty == false ? item.title : nil) ?? "근거 열기")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(BeginnerPalette.blue)
            .lineLimit(2)
    }
}

private func sentimentStatusLabel(_ status: String) -> String {
    switch status {
    case "ready": return "표본 충분"
    case "low_evidence": return "근거 적음"
    case "configuration_required", "configuration-required": return "연결 필요"
    case "warming": return "준비 중"
    case "unavailable": return "비교 불가"
    case "error", "timeout": return "오류"
    case "ok", "success": return "정상"
    default: return status.replacingOccurrences(of: "_", with: " ")
    }
}

private func sentimentStatusColor(_ status: String) -> Color {
    switch status {
    case "ready", "ok", "success": return BeginnerPalette.green
    case "low_evidence", "warming", "configuration_required", "configuration-required": return BeginnerPalette.amber
    case "error", "timeout": return BeginnerPalette.red
    default: return BeginnerPalette.muted
    }
}

private func sentimentReasonText(_ reason: String?, fallbackStatus: String) -> String {
    guard let reason, !reason.isEmpty else {
        switch fallbackStatus {
        case "configuration_required": return "필수 데이터 소스가 연결되지 않았습니다."
        case "unavailable": return "확인 가능한 표본이 부족해 비율을 만들지 않았습니다."
        case "error": return "소스 조회 중 오류가 발생했습니다."
        default: return "현재 상태를 확인할 수 없습니다."
        }
    }
    switch reason {
    case "unsupported_source_coverage":
        return "현재 이 종목 지역의 커뮤니티 소스를 지원하지 않습니다."
    case "insufficient_sample", "insufficient_evidence":
        return "24시간과 72시간 범위에서도 확인 가능한 최상위 글이 부족합니다."
    case "reddit_configuration_required", "toss_configuration_required", "configuration_required":
        return "Toss 순위 또는 Reddit OAuth 연결을 확인하세요."
    default:
        return reason.replacingOccurrences(of: "_", with: " ")
    }
}

private func sentimentClassificationLabel(_ classification: String?) -> String {
    switch classification {
    case "bullish_hype": return "가즈아"
    case "bearish_criticism": return "비관·비난"
    case "mixed": return "혼재"
    case "neutral": return "중립"
    default: return "근거"
    }
}

private func sentimentClassificationColor(_ classification: String?) -> Color {
    switch classification {
    case "bullish_hype": return BeginnerPalette.green
    case "bearish_criticism": return BeginnerPalette.red
    case "mixed": return BeginnerPalette.amber
    default: return BeginnerPalette.muted
    }
}
