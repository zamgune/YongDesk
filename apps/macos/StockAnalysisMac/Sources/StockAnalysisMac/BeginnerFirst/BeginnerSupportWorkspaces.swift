import AppKit
import SwiftUI
import StockAnalysisMacCore

private enum BeginnerAssetsMode: String, CaseIterable, Identifiable {
    case real
    case paper

    var id: String { rawValue }
    var title: String { self == .real ? "실자산" : "모의계좌" }
}

private enum BeginnerAssetsProviderFilter: String, CaseIterable, Identifiable {
    case all
    case toss
    case upbit
    case bithumb

    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "전체"
        case .toss: return "Toss"
        case .upbit: return "Upbit"
        case .bithumb: return "Bithumb"
        }
    }
}

struct BeginnerAssetsWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    let assetClass: BeginnerAssetClass
    let onOpenAPIConnection: (BeginnerAPIConnectionProvider) -> Void
    let onOpenOrder: () -> Void
    let onSelectRealPosition: (RealPortfolioPositionView) -> Void

    @State private var mode: BeginnerAssetsMode = .real
    @State private var providerFilter: BeginnerAssetsProviderFilter = .all
    @State private var didResolveInitialMode = false

    private var selectedAccount: PaperTradingAccountView? {
        model.paperTradingState?.accounts[selectedSession]
            ?? model.paperTradingState?.accounts[selectedSession.uppercased()]
    }

    private var selectedPositions: [PaperTradingPositionView] {
        model.paperTradingState?.positions.filter { position in
            guard position.session == selectedSession else { return false }
            return assetClass == .crypto ? position.market == "CRYPTO" : position.market != "CRYPTO"
        } ?? []
    }

    private var visibleRealProviders: [RealPortfolioProviderView] {
        let providers = model.realPortfolio?.providers ?? []
        return providerFilter == .all
            ? providers
            : providers.filter { $0.provider == providerFilter.rawValue }
    }

    private var visibleRealTotals: [RealPortfolioCurrencyTotalView] {
        let totals = model.realPortfolio?.totalsByCurrency ?? []
        return providerFilter == .all
            ? totals
            : totals.filter { $0.provider == providerFilter.rawValue }
    }

    private var hasConnectedProvider: Bool {
        model.realPortfolio?.providers.contains { $0.connectionStatus == "connected" } == true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("내 자산")
                            .font(.system(size: 26, weight: .bold))
                        Text("실계좌와 모의계좌를 분리하고 공급자·통화별로 보여줍니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    Button("상태 새로고침") {
                        Task {
                            if mode == .real {
                                await model.refreshRealPortfolio(forceRefresh: true)
                            } else {
                                await model.refreshPaperTradingState()
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("beginner-assets-refresh")
                }

                Picker("자산 계좌 유형", selection: $mode) {
                    ForEach(BeginnerAssetsMode.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("beginner-assets-mode")

                if mode == .real {
                    realAssetsContent
                } else {
                    paperAssetsContent
                }
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-assets-workspace")
        .task {
            await model.refreshRealPortfolio()
            if !didResolveInitialMode {
                mode = hasConnectedProvider ? .real : .paper
                didResolveInitialMode = true
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                if mode == .real {
                    await model.refreshRealPortfolio()
                }
            }
        }
    }

    @ViewBuilder
    private var realAssetsContent: some View {
        Picker("실자산 공급자", selection: $providerFilter) {
            ForEach(BeginnerAssetsProviderFilter.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("beginner-assets-provider-filter")

        HStack(spacing: 8) {
            BeginnerStatusBadge("READ ONLY", color: BeginnerPalette.blue)
            Text(model.realPortfolioMessage)
                .font(.caption)
                .foregroundStyle(BeginnerPalette.muted)
            Spacer()
            if let generatedAt = model.realPortfolio?.generatedAt {
                Text("갱신 \(beginnerTimestamp(generatedAt))")
                    .font(.caption2)
                    .foregroundStyle(BeginnerPalette.muted)
            }
        }

        if !visibleRealTotals.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                ForEach(visibleRealTotals) { total in
                    assetMetric(
                        title: "\(providerTitle(total.provider)) · \(total.currency)",
                        value: beginnerPrice(total.marketValue, currency: total.currency),
                        detail: total.buyingPower.map { "주문 가능 \(beginnerPrice($0, currency: total.currency))" }
                            ?? "주문 가능 금액 미제공"
                    )
                }
            }
        }

        ForEach(visibleRealProviders) { provider in
            realProviderSection(provider)
        }
    }

    @ViewBuilder
    private func realProviderSection(_ provider: RealPortfolioProviderView) -> some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(providerTitle(provider.provider))
                        .font(.headline)
                    BeginnerStatusBadge(
                        provider.connectionStatus == "connected" ? "연결됨" : provider.connectionStatus == "error" ? "오류" : "미연결",
                        color: provider.connectionStatus == "connected" ? BeginnerPalette.green : provider.connectionStatus == "error" ? BeginnerPalette.red : BeginnerPalette.amber
                    )
                    if provider.stale { BeginnerStatusBadge("STALE", color: BeginnerPalette.amber) }
                    if provider.partial { BeginnerStatusBadge("일부만 표시", color: BeginnerPalette.amber) }
                    Spacer()
                    Text("보유 \(provider.positions.count) · 미체결 \(provider.openOrders.count)")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }

                if provider.connectionStatus == "disconnected" {
                    Text("API를 연결하면 실제 잔고와 보유 종목을 읽기 전용으로 표시합니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                    Button("\(providerTitle(provider.provider)) API 연결") {
                        if let connectionProvider = connectionProvider(provider.provider) {
                            onOpenAPIConnection(connectionProvider)
                        }
                    }
                    .buttonStyle(.bordered)
                } else {
                    ForEach(provider.accounts) { account in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(account.label)
                                .font(.subheadline.weight(.semibold))
                            ForEach(account.balances) { balance in
                                HStack {
                                    Text(balance.currency)
                                    Spacer()
                                    if let total = balance.total {
                                        Text("잔고 \(beginnerPrice(total, currency: balance.currency))")
                                    }
                                    if let buyingPower = balance.buyingPower {
                                        Text("주문 가능 \(beginnerPrice(buyingPower, currency: balance.currency))")
                                            .foregroundStyle(BeginnerPalette.muted)
                                    }
                                }
                                .font(.caption)
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    if provider.positions.isEmpty {
                        Text("현재 보유 종목이 없습니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    } else {
                        ForEach(provider.positions) { position in
                            Button {
                                onSelectRealPosition(position)
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(position.name ?? position.symbol)
                                            .font(.subheadline.weight(.semibold))
                                        Text("\(position.symbol) · \(position.accountLabel)")
                                            .font(.caption.monospaced())
                                            .foregroundStyle(BeginnerPalette.muted)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text("수량 \(quantityText(position.quantity))")
                                        if position.lockedQuantity > 0 {
                                            Text("잠금 \(quantityText(position.lockedQuantity))")
                                                .foregroundStyle(BeginnerPalette.amber)
                                        }
                                    }
                                    .font(.caption)
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(position.valuationSupported
                                             ? beginnerPrice(position.marketValue, currency: position.currency)
                                             : "평가 미지원")
                                            .font(.subheadline.weight(.semibold))
                                        if let profitLoss = position.profitLoss {
                                            Text("\(profitLoss >= 0 ? "+" : "")\(beginnerPrice(profitLoss, currency: position.currency))")
                                                .font(.caption)
                                                .foregroundStyle(profitLoss >= 0 ? BeginnerPalette.green : BeginnerPalette.red)
                                        }
                                    }
                                    .frame(width: 145, alignment: .trailing)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("beginner-real-position-\(position.id)")
                        }
                    }

                    if !provider.openOrders.isEmpty {
                        Divider().overlay(BeginnerPalette.line)
                        Text("미체결 주문")
                            .font(.subheadline.weight(.semibold))
                        ForEach(provider.openOrders) { order in
                            HStack {
                                Text(order.symbol)
                                    .font(.caption.monospaced())
                                Text(order.side == "buy" ? "매수" : "매도")
                                Spacer()
                                Text("\(quantityText(order.filledQuantity))/\(quantityText(order.quantity))")
                                Text(order.status)
                                    .foregroundStyle(BeginnerPalette.muted)
                            }
                            .font(.caption)
                        }
                    }
                }

                if let error = provider.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(BeginnerPalette.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private var paperAssetsContent: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 12)], spacing: 12) {
            assetMetric(
                title: "\(selectedSession) 모의 현금",
                value: beginnerPrice(selectedAccount?.cash, currency: selectedAccount?.currency ?? defaultCurrency),
                detail: selectedAccount == nil
                    ? "모의 주문 후 계좌 상태가 표시됩니다."
                    : assetClass == .crypto
                        ? "KR 주식·코인 paper 현금 공유 · 실현손익 \(beginnerPrice(selectedAccount?.realizedPnl, currency: selectedAccount?.currency ?? defaultCurrency))"
                        : "실현손익 \(beginnerPrice(selectedAccount?.realizedPnl, currency: selectedAccount?.currency ?? defaultCurrency))"
            )
            assetMetric(title: "보유 포지션", value: "\(selectedPositions.count)개", detail: "현재 세션 기준")
            assetMetric(
                title: "최근 주문",
                value: model.paperTradingState?.orders.first(where: {
                    $0.session == selectedSession && (assetClass == .crypto ? $0.market == "CRYPTO" : $0.market != "CRYPTO")
                })?.status ?? "없음",
                detail: "PAPER ONLY"
            )
        }

        BeginnerSurface {
            VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("보유 종목")
                                .font(.headline)
                            Spacer()
                            BeginnerStatusBadge("\(selectedSession) 계좌", color: BeginnerPalette.blue)
                        }
                        if selectedPositions.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: "tray")
                                    .font(.system(size: 30))
                                    .foregroundStyle(BeginnerPalette.muted)
                                Text("이 계좌에 모의 포지션이 없습니다.")
                                    .font(.subheadline.weight(.semibold))
                                Text("차트에서 모의 주문 drawer를 열어 기존 OrderIntent와 RiskCheck를 먼저 확인하세요.")
                                    .font(.caption)
                                    .foregroundStyle(BeginnerPalette.muted)
                                    .multilineTextAlignment(.center)
                                if assetClass == .crypto {
                                    VStack(spacing: 8) {
                                        Text("코인 paper 주문은 자동화 화면에서 소수점 수량 전략으로 실행합니다. 공개 시세 분석에는 API 키가 필요하지 않습니다.")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(BeginnerPalette.amber)
                                            .multilineTextAlignment(.center)
                                        Button("코인 계좌 API 연결·확인") {
                                            onOpenAPIConnection(.upbit)
                                        }
                                            .buttonStyle(.bordered)
                                            .accessibilityIdentifier("beginner-assets-open-crypto-settings")
                                    }
                                } else {
                                    Button("\(selectedSymbol) 모의 주문 보기", action: onOpenOrder)
                                        .buttonStyle(.borderedProminent)
                                        .tint(BeginnerPalette.green)
                                        .foregroundStyle(BeginnerPalette.backgroundDeep)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 210)
                        } else {
                            ForEach(selectedPositions) { position in
                                HStack(spacing: 14) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(position.name ?? position.symbol)
                                            .font(.subheadline.weight(.semibold))
                                        Text(position.symbol)
                                            .font(.system(.caption, design: .monospaced))
                                            .foregroundStyle(BeginnerPalette.muted)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(assetClass == .crypto
                                             ? "수량 \(quantityText(position.quantity))"
                                             : "\(quantityText(position.quantity))주")
                                            .font(.subheadline.weight(.semibold))
                                        Text("평단 \(beginnerPrice(position.averagePrice, currency: position.currency))")
                                            .font(.caption)
                                            .foregroundStyle(BeginnerPalette.muted)
                                    }
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(beginnerPrice(position.lastPrice, currency: position.currency))
                                            .font(.subheadline.weight(.semibold))
                                        Text(beginnerPrice((position.lastPrice - position.averagePrice) * position.quantity, currency: position.currency))
                                            .font(.caption)
                                            .foregroundStyle(position.lastPrice >= position.averagePrice ? BeginnerPalette.green : BeginnerPalette.red)
                                    }
                                    .frame(width: 120, alignment: .trailing)
                                }
                                .padding(.vertical, 10)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(BeginnerPalette.line.opacity(0.7)).frame(height: 1)
                                }
                            }
                        }
            }
        }
    }

    private func assetMetric(title: String, value: String, detail: String) -> some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
                Text(value)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
            }
        }
    }

    private var defaultCurrency: String {
        selectedSession == "KR" ? "KRW" : "USD"
    }

    private func quantityText(_ value: Double) -> String {
        value.rounded() == value ? Int(value).formatted() : value.formatted(.number.precision(.fractionLength(3)))
    }

    private func providerTitle(_ provider: String) -> String {
        switch provider {
        case "toss": return "Toss"
        case "upbit": return "Upbit"
        case "bithumb": return "Bithumb"
        default: return provider
        }
    }

    private func connectionProvider(_ provider: String) -> BeginnerAPIConnectionProvider? {
        switch provider {
        case "toss": return .toss
        case "upbit": return .upbit
        case "bithumb": return .bithumb
        default: return nil
        }
    }
}

struct BeginnerWatchlistWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let onSelect: (LocalWatchlistSummaryItem) -> Void
    let onAddCurrent: () -> Void

    @State private var filter: WatchlistFilter = .all

    private var visibleItems: [LocalWatchlistSummaryItem] {
        model.watchlistItems.filter { filter.includes($0) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("관심종목")
                            .font(.system(size: 26, weight: .bold))
                        Text("저장한 종목의 현재가와 데이터 상태를 빠르게 비교합니다. 매수 판단은 종목별 분석에서 확인하세요.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 7) {
                        Text("\(model.watchlistItems.count) / \(model.watchlistMaxItems)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BeginnerPalette.muted)
                        HStack(spacing: 8) {
                            Button("현재 종목 추가", action: onAddCurrent)
                                .buttonStyle(.bordered)
                                .disabled(model.watchlistItems.count >= model.watchlistMaxItems)
                                .accessibilityIdentifier("beginner-watchlist-add-current")
                            Button("새로고침") {
                                Task { await model.refreshWatchlist() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(BeginnerPalette.green)
                            .foregroundStyle(BeginnerPalette.backgroundDeep)
                            .accessibilityIdentifier("beginner-watchlist-refresh")
                        }
                    }
                }

                Picker("관심종목 필터", selection: $filter) {
                    ForEach(WatchlistFilter.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("beginner-watchlist-filter")

                if visibleItems.isEmpty {
                    BeginnerSurface {
                        VStack(spacing: 10) {
                            Image(systemName: "star")
                                .font(.system(size: 30))
                                .foregroundStyle(BeginnerPalette.muted)
                            Text(model.watchlistItems.isEmpty ? "아직 관심종목이 없습니다." : "이 필터에 해당하는 관심종목이 없습니다.")
                                .font(.headline)
                            Text(model.watchlistMessage)
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                                .multilineTextAlignment(.center)
                            Button("현재 종목 추가", action: onAddCurrent)
                                .buttonStyle(.borderedProminent)
                                .tint(BeginnerPalette.green)
                                .foregroundStyle(BeginnerPalette.backgroundDeep)
                                .disabled(model.watchlistItems.count >= model.watchlistMaxItems)
                        }
                        .frame(maxWidth: .infinity, minHeight: 240)
                    }
                } else {
                    BeginnerSurface {
                        VStack(spacing: 0) {
                            ForEach(visibleItems) { item in
                                watchlistRow(item)
                                if item.id != visibleItems.last?.id {
                                    Divider().overlay(BeginnerPalette.line.opacity(0.7))
                                }
                            }
                        }
                    }
                }

                Text(model.watchlistMessage)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .accessibilityIdentifier("beginner-watchlist-message")
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-watchlist-workspace")
        .task {
            await model.refreshWatchlist()
        }
    }

    private func watchlistRow(_ item: LocalWatchlistSummaryItem) -> some View {
        HStack(spacing: 12) {
            Button {
                onSelect(item)
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(beginnerInstrumentPrimary(item.instrument, fallbackName: item.name, fallbackCode: item.symbol))
                            .font(.system(size: 16, weight: .bold))
                            .lineLimit(1)
                        Text("\(beginnerInstrumentCode(item.instrument, fallbackCode: item.symbol)) · \(beginnerInstrumentMarketLabel(item.market))")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) {
                        Text(beginnerPrice(item.price, currency: item.currency))
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                        Text(changeLabel(item))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle((item.changePercent ?? 0) >= 0 ? BeginnerPalette.green : BeginnerPalette.red)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(minWidth: 260, maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("\(beginnerInstrumentPrimary(item.instrument, fallbackName: item.name, fallbackCode: item.symbol)), \(beginnerInstrumentCode(item.instrument, fallbackCode: item.symbol)), 현재가 \(beginnerPrice(item.price, currency: item.currency)), 등락률 \(changeLabel(item))")
            .accessibilityIdentifier("beginner-watchlist-select-\(item.id)")

            insightChips(item)
            .contentShape(Rectangle())
            .onTapGesture { onSelect(item) }
            .accessibilityIdentifier("beginner-watchlist-insights")

            if item.stale || item.error != nil {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(item.error == nil ? BeginnerPalette.amber : BeginnerPalette.red)
                    .help(item.error ?? "시세 갱신이 필요합니다.")
                    .accessibilityLabel(item.error ?? "시세 갱신 필요")
                    .accessibilityIdentifier("beginner-watchlist-stale-\(item.id)")
            }

            Button(role: .destructive) {
                Task { await model.removeWatchlistItem(id: item.id) }
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("\(item.symbol) 관심종목에서 제거")
            .accessibilityIdentifier("beginner-watchlist-remove-\(item.id)")
        }
        .padding(.vertical, 11)
    }

    @ViewBuilder
    private func insightChips(_ item: LocalWatchlistSummaryItem) -> some View {
        HStack(spacing: 6) {
            if item.assetClass == "crypto" {
                insightChip(title: "인사이트", value: "준비 중", detail: "코인 인사이트는 다음 단계에서 제공합니다.", status: "unsupported")
            } else {
                insightChip(
                    title: "기술",
                    value: item.insights?.technical.label ?? "근거 부족",
                    detail: item.insights?.technical.error ?? item.insights?.technical.detail ?? "요약 대기",
                    status: item.insights?.technical.status ?? "low-evidence"
                )
                insightChip(
                    title: "민심",
                    value: item.insights?.sentiment.label ?? "근거 부족",
                    detail: sentimentDetail(item),
                    status: item.insights?.sentiment.status ?? "low-evidence"
                )
                insightChip(
                    title: "관심도",
                    value: item.insights?.attention.label ?? "근거 부족",
                    detail: item.insights?.attention.error ?? item.insights?.attention.detail ?? "요약 대기",
                    status: item.insights?.attention.status ?? "low-evidence"
                )
            }
        }
        .frame(width: item.assetClass == "crypto" ? 92 : 228, alignment: .trailing)
    }

    private func insightChip(title: String, value: String, detail: String, status: String) -> some View {
        BeginnerStatusBadge(value, color: insightColor(status: status, value: value))
            .help("\(title): \(detail)")
            .accessibilityLabel("\(title) \(value), \(detail)")
    }

    private func sentimentDetail(_ item: LocalWatchlistSummaryItem) -> String {
        guard let insight = item.insights?.sentiment else {
            return "요약 대기"
        }
        if let error = insight.error {
            return error
        }
        guard let evidenceCount = insight.evidenceCount, let confidence = insight.confidence else {
            return insight.status == "unsupported" ? "지원 준비" : "근거 확인 필요"
        }
        return "근거 \(evidenceCount) · 신뢰 \(confidence)%"
    }

    private func insightColor(status: String, value: String) -> Color {
        if status == "error" { return BeginnerPalette.red }
        if status == "low-evidence" || status == "unavailable" || status == "unsupported" {
            return BeginnerPalette.amber
        }
        if value == "하락 주의" || value == "공포" { return BeginnerPalette.red }
        if value == "상승 우세" || value == "관심 높음" || value == "토스 체결 관심" {
            return BeginnerPalette.green
        }
        if value == "과열" || value == "의견 분열" { return BeginnerPalette.amber }
        return BeginnerPalette.muted
    }

    private func changeLabel(_ item: LocalWatchlistSummaryItem) -> String {
        guard let changePercent = item.changePercent else {
            return item.error == nil ? "등락률 제공 없음" : "시세 확인 실패"
        }
        return beginnerPercent(changePercent / 100)
    }
}

private enum WatchlistFilter: String, CaseIterable, Identifiable {
    case all
    case korea
    case unitedStates
    case crypto

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "전체"
        case .korea: return "한국"
        case .unitedStates: return "미국"
        case .crypto: return "코인"
        }
    }

    func includes(_ item: LocalWatchlistSummaryItem) -> Bool {
        switch self {
        case .all: return true
        case .korea: return item.market == "KR"
        case .unitedStates: return item.market == "US"
        case .crypto: return item.market == "CRYPTO"
        }
    }
}

struct BeginnerStrategyLanding: View {
    let onOpenSettings: () -> Void

    var body: some View {
        VStack {
            BeginnerSurface {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 28))
                            .foregroundStyle(BeginnerPalette.green)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("자동매매 전략")
                                .font(.title2.weight(.bold))
                            Text("검증된 현재 설정 순서와 동작을 그대로 사용합니다.")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                    }

                    HStack(spacing: 8) {
                        workflowStep("1", "초안 저장")
                        workflowArrow
                        workflowStep("2", "조건 확인")
                        workflowArrow
                        workflowStep("3", "시뮬레이션")
                        workflowArrow
                        workflowStep("4", "활성화")
                    }

                    Text("전략 생성, 시뮬레이션, 활성화, 백업 기능은 기존 시트에서 동일하게 동작합니다. 활성 전략도 현재 릴리스에서는 paper 계좌에서만 실행됩니다.")
                        .font(.callout)
                        .foregroundStyle(BeginnerPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("전략 workspace 열기", action: onOpenSettings)
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.green)
                        .foregroundStyle(BeginnerPalette.backgroundDeep)
                        .accessibilityIdentifier("beginner-open-strategy-workspace")
                }
            }
            .frame(maxWidth: 860)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BeginnerPalette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-strategy-workspace")
    }

    private func workflowStep(_ number: String, _ title: String) -> some View {
        VStack(spacing: 6) {
            Text(number)
                .font(.caption.weight(.bold))
                .foregroundStyle(BeginnerPalette.backgroundDeep)
                .frame(width: 26, height: 26)
                .background(BeginnerPalette.green, in: Circle())
            Text(title)
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var workflowArrow: some View {
        Image(systemName: "chevron.right")
            .font(.caption)
            .foregroundStyle(BeginnerPalette.muted)
    }
}

struct BeginnerAutomationWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    let onEditStrategy: (StrategyConfigView) -> Void

    @State private var schedulerIntervalSeconds = 60
    @State private var showingRunConfirmation = false
    @State private var showingSchedulerConfirmation = false

    private var enabledConfigs: [StrategyConfigView] {
        model.strategyConfigs.filter { $0.status == "enabled" }
    }

    private var inactiveCount: Int {
        model.strategyConfigs.count - enabledConfigs.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("활성 전략 운영")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(BeginnerPalette.green)
                        Text("무엇이 자동으로 실행되는지 먼저 확인")
                            .font(.system(size: 27, weight: .bold))
                        Text("전략 탭에서 활성화한 설정만 실행 대상 카드로 표시합니다. 실행 제어와 주문 점검은 아래 고급 자동화 제어에서 확인합니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    BeginnerStatusBadge("PAPER ONLY", color: BeginnerPalette.green)
                }

                overview

                HStack(alignment: .top, spacing: 14) {
                    BeginnerSurface {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("활성 전략")
                                    .font(.headline)
                                Spacer()
                                Text("전략 탭과 같은 설정 데이터")
                                    .font(.caption2)
                                    .foregroundStyle(BeginnerPalette.muted)
                            }

                            if enabledConfigs.isEmpty {
                                VStack(spacing: 10) {
                                    Image(systemName: "bolt.slash")
                                        .font(.system(size: 30))
                                        .foregroundStyle(BeginnerPalette.muted)
                                    Text("활성 전략이 없습니다.")
                                        .font(.headline)
                                    Text("전략 탭에서 초안을 저장하고 조건 확인·시뮬레이션을 통과한 뒤 활성화하세요.")
                                        .font(.caption)
                                        .foregroundStyle(BeginnerPalette.muted)
                                        .multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity, minHeight: 180)
                            } else {
                                ForEach(enabledConfigs) { config in
                                    activeStrategyCard(config)
                                }
                            }

                            if inactiveCount > 0 {
                                Text("초안·일시중지 전략 \(inactiveCount)개는 전략 탭의 ‘내 전략’에서 관리합니다.")
                                    .font(.caption2)
                                    .foregroundStyle(BeginnerPalette.muted)
                            }
                        }
                    }

                    controlPanel
                        .frame(width: 330)
                }

                DisclosureGroup("고급 주문·리스크 점검") {
                    advancedOrderRisk
                        .padding(.top, 10)
                }
                .font(.caption.weight(.semibold))
                .padding(14)
                .background(BeginnerPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay { RoundedRectangle(cornerRadius: 14).stroke(BeginnerPalette.line) }
                .accessibilityIdentifier("beginner-automation-advanced-order-risk")

                if !resultPreview.isEmpty {
                    BeginnerSurface {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("최근 실행 결과")
                                .font(.headline)
                            Text(resultPreview)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(BeginnerPalette.muted)
                                .textSelection(.enabled)
                                .lineLimit(14)
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-automation-workspace")
        .task {
            await model.refreshStrategyConfigs()
            await model.refreshAutomationScheduler()
            await model.refreshWorkerControl()
            if let interval = model.automationSchedulerState?.intervalSeconds {
                schedulerIntervalSeconds = interval
            }
        }
        .confirmationDialog("자동화 1회 실행", isPresented: $showingRunConfirmation, titleVisibility: .visible) {
            Button("paper 자동화 1회 실행", role: .destructive) { runOnce() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("활성 전략의 조건을 한 번 계산하고 paper 계좌만 갱신합니다. 실제 주문은 제출하지 않습니다.")
        }
        .confirmationDialog("연속 자동 실행 시작", isPresented: $showingSchedulerConfirmation, titleVisibility: .visible) {
            Button("\(schedulerIntervalSeconds)초 주기로 시작", role: .destructive) {
                Task { await model.setAutomationSchedulerEnabled(true, intervalSeconds: schedulerIntervalSeconds) }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("앱과 sidecar가 실행 중인 동안 활성 전략을 반복 확인합니다. 모든 결과는 paper 계좌에만 기록됩니다.")
        }
    }

    private var overview: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 10)], spacing: 10) {
            overviewMetric("활성 전략", "\(enabledConfigs.count)개")
            overviewMetric("자동 실행", model.automationSchedulerState?.enabled == true ? "켜짐 · \(schedulerIntervalSeconds)초" : "꺼짐")
            overviewMetric("다음 실행", model.automationSchedulerState?.nextRunAt.map(beginnerTimestamp) ?? "수동 실행 대기")
            overviewMetric("안전 상태", safetyLabel)
        }
        .accessibilityIdentifier("beginner-automation-overview")
    }

    private func overviewMetric(_ title: String, _ value: String) -> some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.caption).foregroundStyle(BeginnerPalette.muted)
                Text(value).font(.headline).lineLimit(1)
            }
        }
    }

    private var safetyLabel: String {
        if model.killSwitchEngaged { return "긴급 중지" }
        if model.workerPausedEffective { return "자동화 일시중지" }
        return "정상 · paper"
    }

    private func activeStrategyCard(_ config: StrategyConfigView) -> some View {
        let evaluation = model.latestAutomationRun?.result.evaluations?.first { $0.strategyId == config.id }
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(beginnerInstrumentPrimary(config.instrument, fallbackCode: config.symbol))
                        .font(.headline)
                    Text("\(beginnerInstrumentCode(config.instrument, fallbackCode: config.symbol)) · \(beginnerInstrumentMarketLabel(config.market)) · paper 실행")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(BeginnerPalette.muted)
                    if config.name != beginnerInstrumentPrimary(config.instrument, fallbackCode: config.symbol) {
                        Text(config.name)
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                }
                Spacer()
                BeginnerStatusBadge(config.automationReadiness?.paperAutomationReady == true ? "실행 가능" : "차단 확인", color: config.automationReadiness?.paperAutomationReady == true ? BeginnerPalette.green : BeginnerPalette.amber)
            }

            Text(strategySentence(config))
                .font(.callout)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 9))

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                strategyMetric("다음 매수 조건", nextEntryLabel(config))
                strategyMetric("주문 단위", orderSizeLabel(config))
                strategyMetric("최대 노출", maximumExposureLabel(config))
                strategyMetric("최근 시뮬레이션", config.lastSimulation?.passed == true ? "통과 · \(beginnerTimestamp(config.lastSimulation?.simulatedAt))" : "기록 없음")
                strategyMetric("최근 실행", evaluation.map(evaluationLabel) ?? "최근 실행 기록 없음")
                strategyMetric("다음 실행", model.automationSchedulerState?.nextRunAt.map(beginnerTimestamp) ?? "수동 실행 대기")
            }

            HStack(spacing: 8) {
                Button("전략 수정") { onEditStrategy(config) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("beginner-automation-edit-\(config.id)")
                Button("전략 일시중지") {
                    Task { await model.setStrategyStatus(config, status: "disabled") }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("beginner-automation-pause-\(config.id)")
                Spacer()
            }
        }
        .padding(14)
        .background(BeginnerPalette.green.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(BeginnerPalette.green.opacity(0.32)) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-automation-strategy-\(config.id)")
    }

    private func strategyMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2).foregroundStyle(BeginnerPalette.muted)
            Text(value).font(.caption.weight(.semibold)).lineLimit(2)
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 8))
    }

    private var controlPanel: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("실행 제어").font(.headline)
                    Spacer()
                    BeginnerStatusBadge(model.automationSchedulerState?.running == true ? "실행 중" : "대기", color: model.automationSchedulerState?.running == true ? BeginnerPalette.amber : BeginnerPalette.blue)
                }

                Text("활성 전략의 조건을 한 번 계산합니다. 실제 주문 없이 paper 계좌만 갱신합니다.")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                Button("자동화 1회 실행") { showingRunConfirmation = true }
                    .buttonStyle(.borderedProminent)
                    .tint(BeginnerPalette.green)
                    .foregroundStyle(BeginnerPalette.backgroundDeep)
                    .frame(maxWidth: .infinity)
                    .disabled(enabledConfigs.isEmpty || model.executionBlocked || model.workerPausedEffective || isLoading)
                    .accessibilityIdentifier("beginner-automation-run-once")

                Divider().overlay(BeginnerPalette.line)

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("반복 실행").font(.subheadline.weight(.semibold))
                        Text(model.automationSchedulerState?.enabled == true ? "켜짐" : "꺼짐")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    Button(model.automationSchedulerState?.enabled == true ? "중지" : "시작") {
                        if model.automationSchedulerState?.enabled == true {
                            Task { await model.setAutomationSchedulerEnabled(false, intervalSeconds: schedulerIntervalSeconds) }
                        } else {
                            showingSchedulerConfirmation = true
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(enabledConfigs.isEmpty || isLoading || (model.automationSchedulerState?.enabled != true && (model.executionBlocked || model.workerPausedEffective)))
                    .accessibilityIdentifier("beginner-automation-scheduler-toggle")
                }

                Picker("확인 주기", selection: $schedulerIntervalSeconds) {
                    Text("30초").tag(30)
                    Text("1분").tag(60)
                    Text("5분").tag(300)
                    Text("15분").tag(900)
                }
                .pickerStyle(.menu)
                .disabled(model.automationSchedulerState?.enabled == true)
                .accessibilityIdentifier("beginner-automation-scheduler-interval")

                DisclosureGroup("고급 자동화 제어") {
                    VStack(alignment: .leading, spacing: 10) {
                        Button(model.workerPausedEffective ? "자동화 다시 시작" : "자동화 일시중지") {
                            Task {
                                await model.setWorkerPaused(!model.workerPausedEffective, reason: "자동화 화면")
                                await model.refreshStrategyConfigs(replacingMessage: false)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.workerControlTransitionPending || model.killSwitchTransitionPending)
                        .accessibilityIdentifier("beginner-automation-worker-toggle")

                        Button(model.killSwitchEngaged ? "긴급 중지 해제" : "긴급 중지 켜기", role: model.killSwitchEngaged ? nil : .destructive) {
                            Task {
                                await model.setKillSwitchEngaged(!model.killSwitchEngaged, reason: "자동화 화면")
                                await model.refreshStrategyConfigs(replacingMessage: false)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.killSwitchTransitionPending)
                        .accessibilityIdentifier("beginner-automation-kill-switch")

                        Text(model.killSwitchEngaged ? "긴급 중지가 자동화와 모의 주문을 차단하고 있습니다." : model.workerPausedEffective ? "자동화 일시중지가 실행을 차단하고 있습니다." : "자동화 안전 차단이 해제되어 있습니다.")
                            .font(.caption2)
                            .foregroundStyle(model.killSwitchEngaged ? BeginnerPalette.red : model.workerPausedEffective ? BeginnerPalette.amber : BeginnerPalette.muted)
                    }
                    .padding(.top, 8)
                }
                .font(.caption.weight(.semibold))
            }
        }
        .accessibilityIdentifier("beginner-automation-controls")
    }

    private var advancedOrderRisk: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("보유 조회·사전검증·체결 동기화는 주문 제출이 아닌 준비 작업입니다.")
                .font(.caption)
                .foregroundStyle(BeginnerPalette.muted)
            HStack(spacing: 8) {
                Button("자동화 dry-run") { runAction { await model.runAutomationDryRun() } }
                    .buttonStyle(.bordered)
                Button("체결 동기화") { runAction { await model.syncAutomationOrders() } }
                    .buttonStyle(.bordered)
                Button("보유 조회") { runAction { await model.refreshBrokerHolding(symbol: selectedSymbol) } }
                    .buttonStyle(.bordered)
                Button("사전검증") {
                    guard let dashboard = model.terminalDashboard else { return }
                    runAction { await model.runOrderPrecheck(dashboard) }
                }
                .buttonStyle(.bordered)
                .disabled(model.terminalDashboard == nil)
            }
            .disabled(isLoading || model.health == nil)
        }
    }

    private func runOnce() {
        runAction { await model.runAutomationCycle() }
    }

    private func runAction(_ operation: @escaping () async -> String) {
        Task {
            isLoading = true
            resultPreview = await operation()
            isLoading = false
        }
    }

    private func strategySentence(_ config: StrategyConfigView) -> String {
        let basePrice = config.grid?.basePrice ?? config.loop?.anchorPrice ?? config.currentPrice
        let firstDrop = config.grid?.rungs.sorted { $0.index < $1.index }.first?.buyDropPct ?? config.loop?.buyDropPct ?? 0
        let takeProfit = config.grid?.rungs.sorted { $0.index < $1.index }.first?.sellRisePct ?? config.loop?.sellRisePct ?? config.exitRules?.takeProfitPct ?? 0
        let stopLoss = config.exitRules?.stopLossPct ?? 0
        return "\(formattedPrice(basePrice, market: config.market)) 기준 · -\(firstDrop.formatted(.number.precision(.fractionLength(1))))%부터 \(orderSizeLabel(config)) · 익절 +\(takeProfit.formatted(.number.precision(.fractionLength(1))))% · 손절 -\(stopLoss.formatted(.number.precision(.fractionLength(1))))%"
    }

    private func nextEntryLabel(_ config: StrategyConfigView) -> String {
        if let grid = config.grid, let first = grid.rungs.sorted(by: { $0.index < $1.index }).first {
            return "\(formattedPrice(grid.basePrice * (1 - first.buyDropPct / 100), market: config.market)) 이하"
        }
        if let loop = config.loop {
            return "\(formattedPrice(loop.anchorPrice * (1 - loop.buyDropPct / 100), market: config.market)) 이하"
        }
        return "조건 확인 필요"
    }

    private func orderSizeLabel(_ config: StrategyConfigView) -> String {
        if config.orderSizing?.mode == "quantity", let quantity = config.orderSizing?.quantity {
            return "\(quantityText(quantity))주"
        }
        if config.orderSizing?.mode == "notional", let notional = config.orderSizing?.notional {
            return "\(formattedPrice(notional, market: config.market))"
        }
        let legacy = config.grid?.rungs.sorted { $0.index < $1.index }.first?.notional ?? config.loop?.notional
        return "기존 금액 · \(formattedPrice(legacy, market: config.market))"
    }

    private func maximumExposureLabel(_ config: StrategyConfigView) -> String {
        if let grid = config.grid {
            let total = grid.rungs.reduce(0) { sum, rung in
                let price = grid.basePrice * (1 - rung.buyDropPct / 100)
                if config.orderSizing?.mode == "quantity", let quantity = config.orderSizing?.quantity {
                    return sum + price * quantity
                }
                return sum + (config.orderSizing?.notional ?? rung.notional)
            }
            return formattedPrice(total, market: config.market)
        }
        if let loop = config.loop {
            let price = loop.anchorPrice * (1 - loop.buyDropPct / 100)
            let total = config.orderSizing?.mode == "quantity"
                ? price * (config.orderSizing?.quantity ?? 0)
                : config.orderSizing?.notional ?? loop.notional
            return formattedPrice(total, market: config.market)
        }
        return "계산 대기"
    }

    private func evaluationLabel(_ evaluation: AutomationStrategyEvaluationView) -> String {
        if let summary = evaluation.summary?.headline, !summary.isEmpty {
            return summary
        }
        return "발동 \(evaluation.triggers)개 · 주문 \(evaluation.orders.count)건"
    }

    private func formattedPrice(_ value: Double?, market: String) -> String {
        beginnerPrice(value, currency: market == "US" ? "USD" : "KRW")
    }

    private func quantityText(_ value: Double) -> String {
        value.rounded() == value
            ? Int(value).formatted()
            : value.formatted(.number.precision(.fractionLength(8)))
    }
}

struct BeginnerSettingsWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let onOpen: (BeginnerSettingsSheet) -> Void
    @Binding var selectedConnectionProvider: BeginnerAPIConnectionProvider

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("설정")
                        .font(.system(size: 26, weight: .bold))
                    Text("연결·알림과 자동화 상태를 관리합니다. 엔진·진단·배포 도구는 지원 경로에서만 제공합니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }

                BeginnerAPIConnectionWorkspace(selectedProvider: $selectedConnectionProvider)

                BeginnerLiveTradingSettingsCard()

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                    settingsCard(
                        icon: "waveform.path.ecg",
                        title: "로컬 엔진",
                        detail: model.health?.ok == true ? "Sidecar가 정상 동작 중입니다. \(model.statusLine)" : "분석 엔진이 오프라인입니다. 시작 후 상태를 다시 확인하세요.",
                        actionTitle: model.health?.ok == true ? "상태 갱신" : "엔진 시작",
                        identifier: "beginner-settings-engine",
                        action: {
                            if model.health?.ok == true {
                                Task { await model.refreshHealth() }
                            } else {
                                model.startSidecar()
                            }
                        }
                    )
                    settingsCard(
                        icon: "bell",
                        title: "알림",
                        detail: model.settings.alertsEnabled ? "중요 뉴스 알림이 켜져 있습니다." : "중요 뉴스 알림이 꺼져 있습니다.",
                        actionTitle: model.settings.alertsEnabled ? "알림 끄기" : "알림 켜기",
                        identifier: "beginner-settings-notifications",
                        action: { model.toggleAlerts() }
                    )
                }

                BeginnerSurface {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: model.killSwitchEngaged ? "hand.raised.fill" : "hand.raised")
                            .font(.system(size: 24))
                            .foregroundStyle(model.killSwitchEngaged ? BeginnerPalette.red : BeginnerPalette.amber)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("긴급 중지")
                                .font(.headline)
                            Text(model.killSwitchEngaged
                                 ? "모의 주문과 자동화 큐가 차단되어 있습니다."
                                 : "현재 긴급 중지가 해제되어 있습니다. 실주문은 별도 게이트로 계속 차단됩니다.")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        Spacer()
                        Button(model.killSwitchEngaged ? "중지 해제" : "긴급 중지") {
                            Task {
                                await model.setKillSwitchEngaged(
                                    !model.killSwitchEngaged,
                                    reason: model.killSwitchEngaged ? "beginner 설정에서 긴급 중지 해제" : "beginner 설정에서 긴급 중지"
                                )
                            }
                        }
                        .buttonStyle(.bordered)
                        .tint(model.killSwitchEngaged ? BeginnerPalette.green : BeginnerPalette.red)
                        .disabled(model.killSwitchTransitionPending)
                        .accessibilityIdentifier("beginner-settings-kill-switch")
                    }
                }
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-settings-workspace")
    }

    private func settingsCard(
        icon: String,
        title: String,
        detail: String,
        actionTitle: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(BeginnerPalette.blue)
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 2)
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier(identifier)
            }
            .frame(minHeight: 140, alignment: .topLeading)
        }
    }
}

private struct BeginnerAPIConnectionWorkspace: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selectedProvider: BeginnerAPIConnectionProvider

    @State private var identifier = ""
    @State private var secret = ""
    @State private var isSaving = false
    @State private var isRefreshing = false
    @State private var isRunningAdvancedCheck = false
    @State private var selectedAccountSeq: Int?
    @State private var showingAdvanced = false
    @State private var showingDeleteConfirmation = false
    @State private var copiedOperationReport = false
    @State private var cryptoMarket = "KRW-BTC"
    @State private var cryptoSide = "buy"
    @State private var cryptoVolume = "0.001"
    @State private var cryptoPrice = "100000000"
    @State private var credentialSaveFailure: String?
    @State private var cryptoConsentConfirmation = ""
    @State private var cryptoManualConfirmation = ""
    @State private var cryptoAutomationConfirmation = ""
    @State private var cryptoCancelConfirmation = ""
    @State private var cryptoOrderConfirmation = ""

    private var credential: BrokerCredentialView? {
        if selectedProvider == .toss {
            return model.brokerCredential
        }
        return model.cryptoExchanges.first { $0.exchange == selectedProvider.rawValue }?.credential
    }

    private var isVerified: Bool {
        credential?.status == "verified"
    }

    private var statusText: String {
        switch credential?.status {
        case "verified": return "연결됨"
        case "pending": return "검증 대기"
        case "failed": return "검증 실패"
        case .some(let status): return status
        case .none: return "미등록"
        }
    }

    private var statusColor: Color {
        switch credential?.status {
        case "verified": return BeginnerPalette.green
        case "failed": return BeginnerPalette.red
        case "pending": return BeginnerPalette.amber
        default: return BeginnerPalette.muted
        }
    }

    private var statusMessage: String {
        selectedProvider == .toss ? model.brokerCredentialMessage : model.cryptoExchangeMessage
    }

    private var canSave: Bool {
        model.health?.ok == true &&
            !isSaving &&
            !identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("연결 관리")
                            .font(.title3.weight(.bold))
                        Text("키 등록 전에는 연결에 필요한 정보만 표시합니다. 계좌·진단·사전검증은 검증된 연결에서만 확인하세요.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    BeginnerStatusBadge("PAPER ONLY", color: BeginnerPalette.green)
                }

                HStack(spacing: 8) {
                    ForEach(BeginnerAPIConnectionProvider.allCases) { provider in
                        providerButton(provider)
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(selectedProvider.title)
                                .font(.headline)
                            Text(selectedProvider.detail)
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        Spacer()
                        BeginnerStatusBadge(statusText, color: statusColor)
                    }

                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(selectedProvider.identifierLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BeginnerPalette.muted)
                            TextField("\(selectedProvider.identifierLabel) 입력", text: $identifier)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("beginner-api-identifier")
                        }
                        VStack(alignment: .leading, spacing: 5) {
                            Text(selectedProvider.secretLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BeginnerPalette.muted)
                            SecureField("\(selectedProvider.secretLabel) 입력", text: $secret)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("beginner-api-secret")
                        }
                    }

                    HStack(spacing: 8) {
                        Button(isSaving ? "검증 중" : "검증 후 저장") {
                            Task { await saveCredential() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.green)
                        .foregroundStyle(BeginnerPalette.backgroundDeep)
                        .disabled(!canSave)
                        .accessibilityIdentifier("beginner-api-save")

                        Button("입력 지우기") {
                            identifier = ""
                            secret = ""
                        }
                        .buttonStyle(.bordered)

                        if isVerified {
                            Button(isRefreshing ? "상태 확인 중" : "상태 새로고침") {
                                Task { await refreshProviderState() }
                            }
                            .buttonStyle(.bordered)
                            .disabled(isRefreshing)
                        }
                    }

                    if let credentialSaveFailure {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "xmark.octagon.fill")
                                .foregroundStyle(BeginnerPalette.red)
                            Text(credentialSaveFailure)
                        }
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BeginnerPalette.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("beginner-api-save-failure")
                    } else {
                        Text(statusMessage)
                            .font(.caption2)
                            .foregroundStyle(statusColor)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .background(BeginnerPalette.backgroundDeep.opacity(0.42), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(BeginnerPalette.line)
                }

                Text("\(selectedProvider.shortTitle)는 API 등록 때 readiness를 자동 점검합니다. KRW 수동·자동 지정가는 각각 기본 OFF이며 시장가·출금은 지원하지 않습니다.")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.amber)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(11)
                    .background(BeginnerPalette.amber.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                DisclosureGroup(isExpanded: $showingAdvanced) {
                    if isVerified {
                        advancedContent
                            .padding(.top, 8)
                    } else {
                        Text("검증이 완료되면 계좌 선택, 허용 IP·진단, 주문 사전검증과 운영 리포트를 필요한 때만 확인할 수 있습니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                            .padding(.top, 8)
                    }
                } label: {
                    HStack {
                        Text("고급 점검")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(isVerified ? "필요할 때 열기" : "연결 후 사용 가능")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                }
                .padding(12)
                .background(BeginnerPalette.backgroundDeep.opacity(0.30), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(BeginnerPalette.line)
                }
            }
        }
        .task(id: selectedProvider) {
            identifier = ""
            secret = ""
            credentialSaveFailure = nil
            showingAdvanced = false
            await refreshProviderState()
        }
        .confirmationDialog(
            "\(selectedProvider.shortTitle) API 키 삭제",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("API 키 삭제", role: .destructive) {
                Task { await deleteCredential() }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("sidecar 저장소와 macOS Keychain에서 credential을 삭제합니다. 실제 주문은 이 작업 전후에도 차단된 상태입니다.")
        }
        .accessibilityIdentifier("beginner-api-connection-workspace")
    }

    @ViewBuilder
    private var advancedContent: some View {
        if selectedProvider == .toss {
            tossAdvancedContent
        } else {
            cryptoAdvancedContent
        }
    }

    private var tossAdvancedContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button(isRunningAdvancedCheck ? "점검 중" : "운영 준비 점검") {
                    Task {
                        isRunningAdvancedCheck = true
                        await model.runTossReadiness()
                        isRunningAdvancedCheck = false
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isRunningAdvancedCheck)

                Button("허용 IP·진단") {
                    Task { await model.refreshBrokerDiagnostics(includePublicIP: true) }
                }
                .buttonStyle(.bordered)

                Button(copiedOperationReport ? "리포트 복사됨" : "운영 리포트 복사") {
                    copyOperationReport()
                }
                .buttonStyle(.bordered)

                Spacer()
                Button("API 키 삭제", role: .destructive) {
                    showingDeleteConfirmation = true
                }
                .buttonStyle(.bordered)
            }

            Text(model.tossReadinessMessage)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Text(model.brokerDiagnosticsMessage)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("자동화 계좌")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Button("계좌 새로고침") {
                        Task { await model.refreshBrokerAccounts() }
                    }
                    .buttonStyle(.borderless)
                }
                if model.brokerAccounts.isEmpty {
                    Text(model.brokerAccountMessage)
                        .font(.caption2)
                        .foregroundStyle(BeginnerPalette.muted)
                } else {
                    ForEach(model.brokerAccounts) { account in
                        let selected = model.brokerAccountPreference?.accountSeq == account.accountSeq
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(account.accountNo)
                                    .font(.caption.monospaced())
                                Text(account.accountType)
                                    .font(.caption2)
                                    .foregroundStyle(BeginnerPalette.muted)
                            }
                            Spacer()
                            Button(selectedAccountSeq == account.accountSeq ? "선택 중" : selected ? "선택됨" : "이 계좌 사용") {
                                Task {
                                    selectedAccountSeq = account.accountSeq
                                    await model.selectBrokerAccount(account)
                                    selectedAccountSeq = nil
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(selected || selectedAccountSeq != nil || account.accountType != "BROKERAGE")
                        }
                    }
                }
            }
            .padding(10)
            .background(BeginnerPalette.surfaceRaised.opacity(0.42), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
    }

    private var cryptoAdvancedContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                TextField("마켓", text: $cryptoMarket)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 130)
                Picker("방향", selection: $cryptoSide) {
                    Text("매수").tag("buy")
                    Text("매도").tag("sell")
                }
                .frame(width: 100)
                Button(isRunningAdvancedCheck ? "점검 중" : "계좌·주문가능 점검") {
                    Task {
                        isRunningAdvancedCheck = true
                        await model.runCryptoReadiness(exchange: selectedProvider.rawValue, market: cryptoMarket.uppercased())
                        isRunningAdvancedCheck = false
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isRunningAdvancedCheck)
                Spacer()
                Button("API 키 삭제", role: .destructive) {
                    showingDeleteConfirmation = true
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: 8) {
                TextField("수량", text: $cryptoVolume)
                    .textFieldStyle(.roundedBorder)
                TextField("지정가", text: $cryptoPrice)
                    .textFieldStyle(.roundedBorder)
                Button("주문 사전검증") {
                    Task {
                        isRunningAdvancedCheck = true
                        await model.runCryptoOrderPrecheck(
                            exchange: selectedProvider.rawValue,
                            market: cryptoMarket.uppercased(),
                            side: cryptoSide,
                            volume: Double(cryptoVolume) ?? 0,
                            price: Double(cryptoPrice) ?? 0
                        )
                        isRunningAdvancedCheck = false
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isRunningAdvancedCheck || (Double(cryptoVolume) ?? 0) <= 0 || (Double(cryptoPrice) ?? 0) <= 0)
            }

            Text(model.cryptoExchangeMessage)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)

            if let readiness = model.cryptoReadiness,
               readiness.exchange == selectedProvider.rawValue,
               readiness.market == cryptoMarket.uppercased() {
                Text(readiness.message)
                    .font(.caption2)
                    .foregroundStyle(readiness.ready ? BeginnerPalette.green : BeginnerPalette.amber)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let precheck = model.cryptoOrderPrecheck,
               precheck.exchange == selectedProvider.rawValue,
               precheck.market == cryptoMarket.uppercased() {
                let precheckMessage = precheck.blockers.first ?? "조건을 확인하세요."
                Text(precheck.passed ? "사전검증 통과 · 주문 제출 없음" : "사전검증 차단 · \(precheckMessage)")
                    .font(.caption2)
                    .foregroundStyle(precheck.passed ? BeginnerPalette.green : BeginnerPalette.amber)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(BeginnerPalette.line)
            cryptoLiveTradingContent
        }
        .task(id: selectedProvider) {
            await model.refreshCryptoLiveTrading(exchange: selectedProvider.rawValue)
        }
    }

    private var cryptoLiveTradingContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                BeginnerStatusBadge("\(selectedProvider.shortTitle) KRW 지정가", color: BeginnerPalette.blue)
                BeginnerStatusBadge(model.cryptoLiveTrading?.manualEnabled == true ? "수동 토글 ON" : "기본 OFF", color: model.cryptoLiveTrading?.manualEnabled == true ? BeginnerPalette.green : BeginnerPalette.amber)
                if model.cryptoLiveTrading?.policy.unknownLock != nil {
                    BeginnerStatusBadge("결과 불명 잠금", color: BeginnerPalette.red)
                }
            }

            Text("API 등록 때 읽기 전용 readiness를 자동 점검합니다. 시장가·출금은 지원하지 않으며, 실거래 이용 동의와 거래소별 토글, 주문별 요약 재입력이 모두 필요합니다.")
                .font(.caption)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)

            if model.cryptoLiveTrading?.policy.readinessVerifiedAt == nil {
                Text("자동 읽기 전용 점검 미완료 · API를 다시 등록하거나 준비 점검을 실행하세요.")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.amber)
            } else if model.cryptoLiveTrading?.policy.userConsentAt == nil {
                HStack(spacing: 8) {
                    TextField("코인 실거래 위험을 확인했습니다", text: $cryptoConsentConfirmation)
                        .textFieldStyle(.roundedBorder)
                    Button("실거래 이용 동의") {
                        Task { await model.consentCryptoLiveTrading(exchange: selectedProvider.rawValue, confirmation: cryptoConsentConfirmation) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(cryptoConsentConfirmation != "코인 실거래 위험을 확인했습니다")
                }
            }

            HStack(spacing: 8) {
                TextField("코인 실거래 수동 주문 해제", text: $cryptoManualConfirmation)
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.cryptoLiveTrading?.manualEnabled == true)
                Button("수동 실거래 켜기") {
                    Task { await model.setCryptoLiveTrading(exchange: selectedProvider.rawValue, enabled: true, confirmation: cryptoManualConfirmation) }
                }
                .buttonStyle(.borderedProminent)
                .tint(BeginnerPalette.red)
                .disabled(model.cryptoLiveTrading?.manualEnabled == true || cryptoManualConfirmation != "코인 실거래 수동 주문 해제")
                Button("수동 실거래 끄기") {
                    Task { await model.setCryptoLiveTrading(exchange: selectedProvider.rawValue, enabled: false) }
                }
                .buttonStyle(.bordered)
                .disabled(model.cryptoLiveTrading?.manualEnabled != true)
            }

            HStack(spacing: 8) {
                TextField("코인 지정가 자동매매 해제", text: $cryptoAutomationConfirmation)
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.cryptoLiveTrading?.policy.automationEnabled == true)
                Button("자동매매 켜기") {
                    Task { await model.setCryptoLiveTrading(exchange: selectedProvider.rawValue, mode: "automation", enabled: true, confirmation: cryptoAutomationConfirmation) }
                }
                .buttonStyle(.bordered)
                .disabled(model.cryptoLiveTrading?.policy.automationEnabled == true || cryptoAutomationConfirmation != "코인 지정가 자동매매 해제")
                Button("자동매매 끄기") {
                    Task { await model.setCryptoLiveTrading(exchange: selectedProvider.rawValue, mode: "automation", enabled: false) }
                }
                .buttonStyle(.bordered)
                .disabled(model.cryptoLiveTrading?.policy.automationEnabled != true)
            }
            Text("자동화 해제: 거래소 조회로 확인된 수동 주문 \(model.cryptoLiveTrading?.policy.manualConfirmedOrderCount ?? 0)/5 · 재시작 재조정·kill switch 검증 필요")
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)

            if model.cryptoLiveTrading?.attempts.contains(where: { ["submitted", "open", "partially_filled"].contains($0.status) }) == true {
                HStack(spacing: 8) {
                    TextField("\(selectedProvider.rawValue) 미체결 일괄 취소", text: $cryptoCancelConfirmation)
                        .textFieldStyle(.roundedBorder)
                    Button("미체결 일괄 취소", role: .destructive) {
                        Task { await model.cancelAllCryptoOpenOrders(exchange: selectedProvider.rawValue, confirmation: cryptoCancelConfirmation) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(cryptoCancelConfirmation != "\(selectedProvider.rawValue) 미체결 일괄 취소")
                }
            }

            HStack(spacing: 8) {
                Button("실주문 사전검증") {
                    Task {
                        isRunningAdvancedCheck = true
                        cryptoOrderConfirmation = ""
                        await model.runCryptoManualLiveOrderPrecheck(
                            exchange: selectedProvider.rawValue,
                            market: cryptoMarket.uppercased(),
                            side: cryptoSide,
                            volume: Double(cryptoVolume) ?? 0,
                            price: Double(cryptoPrice) ?? 0
                        )
                        isRunningAdvancedCheck = false
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isRunningAdvancedCheck || (Double(cryptoVolume) ?? 0) <= 0 || (Double(cryptoPrice) ?? 0) <= 0)

                if model.cryptoLiveTrading?.policy.unknownLock != nil {
                    Button("결과 불명 주문 재조정") {
                        Task { await model.reconcileCryptoManualLiveOrder(exchange: selectedProvider.rawValue) }
                    }
                    .buttonStyle(.bordered)
                }
            }

            if let precheck = model.cryptoLiveOrderPrecheck,
               precheck.market == cryptoMarket.uppercased() {
                VStack(alignment: .leading, spacing: 7) {
                    Text(precheck.submitReady ? "사전검증 통과 · 주문은 아직 제출되지 않았습니다." : "사전검증 차단 · \(precheck.blockers.first ?? "조건을 확인하세요.")")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(precheck.submitReady ? BeginnerPalette.green : BeginnerPalette.amber)
                    Text("최종 확인 문구: \(precheck.confirmationText)")
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .foregroundStyle(BeginnerPalette.muted)
                    TextField("표시된 주문 요약 입력", text: $cryptoOrderConfirmation)
                        .textFieldStyle(.roundedBorder)
                        .disabled(!precheck.submitReady)
                    Button("최종 \(selectedProvider.shortTitle) 실주문 제출") {
                        guard let preview = precheck.preview else { return }
                        Task { await model.submitCryptoManualLiveOrder(exchange: selectedProvider.rawValue, previewId: preview.id, confirmation: cryptoOrderConfirmation) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BeginnerPalette.red)
                    .foregroundStyle(BeginnerPalette.backgroundDeep)
                    .disabled(!precheck.submitReady || cryptoOrderConfirmation != precheck.confirmationText)
                    .accessibilityIdentifier("beginner-crypto-live-order-submit")
                }
                .padding(10)
                .background(BeginnerPalette.backgroundDeep.opacity(0.48), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }

            Text(model.cryptoLiveTrading?.reason ?? model.cryptoExchangeMessage)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func providerButton(_ provider: BeginnerAPIConnectionProvider) -> some View {
        Button {
            selectedProvider = provider
            credentialSaveFailure = nil
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(provider.shortTitle)
                    .font(.caption.weight(.semibold))
                Text(provider.detail)
                    .font(.caption2)
                    .foregroundStyle(selectedProvider == provider ? BeginnerPalette.text.opacity(0.78) : BeginnerPalette.muted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .background(Color.clear)
            .padding(.horizontal, 10)
            .background(selectedProvider == provider ? BeginnerPalette.blue.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(selectedProvider == provider ? BeginnerPalette.blue.opacity(0.55) : BeginnerPalette.line)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(provider.accessibilityIdentifier)
        .accessibilityValue(selectedProvider == provider ? "선택됨" : "선택 안 됨")
        .accessibilityAddTraits(selectedProvider == provider ? .isSelected : [])
    }

    private func saveCredential() async {
        isSaving = true
        defer { isSaving = false }
        credentialSaveFailure = nil
        let saved: Bool
        if selectedProvider == .toss {
            saved = await model.registerBrokerCredential(clientId: identifier, clientSecret: secret)
        } else {
            saved = await model.registerCryptoCredential(exchange: selectedProvider.rawValue, accessKey: identifier, secretKey: secret)
        }
        secret = ""
        guard saved else {
            credentialSaveFailure = statusMessage
            showingAdvanced = false
            return
        }
        identifier = ""
        await refreshProviderState()
        showingAdvanced = isVerified
    }

    private func refreshProviderState() async {
        isRefreshing = true
        defer { isRefreshing = false }
        guard model.health?.ok == true else { return }
        if selectedProvider == .toss {
            model.refreshKeychainCredentialStatus()
            await model.refreshBrokerCredential()
        } else {
            await model.refreshCryptoExchanges()
            await model.refreshCryptoLiveTrading(exchange: selectedProvider.rawValue)
        }
    }

    private func deleteCredential() async {
        if selectedProvider == .toss {
            await model.deleteBrokerCredential()
        } else {
            await model.deleteCryptoCredential(exchange: selectedProvider.rawValue)
        }
        identifier = ""
        secret = ""
        showingAdvanced = false
    }

    private func copyOperationReport() {
        let report = TossOperationReport.make(from: TossOperationReportInput(
            sidecarOK: model.health?.ok == true,
            credential: model.brokerCredential,
            keychainCredentialStored: model.keychainCredentialStored,
            accountPreference: model.brokerAccountPreference,
            accountCount: model.brokerAccounts.count,
            diagnostics: model.brokerDiagnostics,
            localLiveTrading: model.localLiveTrading,
            killSwitchEngaged: model.killSwitchEngaged,
            workerPaused: model.workerPausedEffective,
            liveTradingOperatorEnabled: model.settings.liveTradingOperatorEnabled
        ))
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
        copiedOperationReport = true
    }
}

struct BeginnerPaperOrderDrawer: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    let onClose: () -> Void
    let onOpenStrategy: () -> Void
    let onOpenLiveOrder: () -> Void

    @State private var showingSubmitConfirmation = false
    @AccessibilityFocusState private var closeButtonFocused: Bool

    private var dashboard: TerminalDashboardSnapshot? {
        guard let latest = model.terminalDashboard,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol) else {
            return nil
        }
        return latest
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("모의 주문")
                        .font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text("기존 OrderIntent · RiskCheck")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel("모의 주문 닫기")
                .accessibilityFocused($closeButtonFocused)
                .accessibilityIdentifier("beginner-paper-order-close")
            }
            .padding(18)
            .background(BeginnerPalette.surfaceRaised)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        BeginnerStatusBadge("PAPER ONLY", color: BeginnerPalette.green)
                        BeginnerStatusBadge("실제 주문 없음", color: BeginnerPalette.blue)
                    }

                    if let dashboard {
                        BeginnerSurface {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("OrderIntent 미리보기")
                                    .font(.headline)
                                LazyVGrid(columns: [GridItem(), GridItem()], spacing: 9) {
                                    drawerMetric("종목", dashboard.symbol)
                                    drawerMetric("방향", dashboard.orderIntent.side == "buy" ? "매수" : "매도")
                                    drawerMetric("유형", dashboard.orderIntent.type == "limit" ? "지정가" : dashboard.orderIntent.type)
                                    drawerMetric("수량", "\(dashboard.orderIntent.quantity)")
                                    drawerMetric("지정가", beginnerPrice(dashboard.orderIntent.limitPrice, currency: dashboard.orderIntent.currency))
                                    drawerMetric("손절", beginnerPrice(dashboard.orderIntent.stopPrice, currency: dashboard.orderIntent.currency))
                                }
                            }
                        }

                        BeginnerSurface {
                            VStack(alignment: .leading, spacing: 9) {
                                HStack {
                                    Text("RiskCheck")
                                        .font(.headline)
                                    Spacer()
                                    BeginnerStatusBadge(
                                        dashboard.riskCheck.passed ? "통과" : "차단",
                                        color: dashboard.riskCheck.passed ? BeginnerPalette.green : BeginnerPalette.red
                                    )
                                }
                                if dashboard.riskCheck.blockers.isEmpty && dashboard.riskCheck.warnings.isEmpty {
                                    Text("현재 차단 또는 주의 항목이 없습니다. 실행 시 다시 검증합니다.")
                                        .font(.caption)
                                        .foregroundStyle(BeginnerPalette.muted)
                                } else {
                                    ForEach(dashboard.riskCheck.blockers, id: \.self) { blocker in
                                        riskLine(blocker, icon: "xmark.octagon.fill", color: BeginnerPalette.red)
                                    }
                                    ForEach(dashboard.riskCheck.warnings, id: \.self) { warning in
                                        riskLine(warning, icon: "exclamationmark.triangle.fill", color: BeginnerPalette.amber)
                                    }
                                }
                            }
                        }

                        if !resultPreview.isEmpty {
                            Text(resultPreview)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(BeginnerPalette.muted)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 10))
                        }
                    } else {
                        BeginnerSurface {
                            VStack(spacing: 9) {
                                Image(systemName: "doc.text.magnifyingglass")
                                    .font(.system(size: 28))
                                    .foregroundStyle(BeginnerPalette.muted)
                                Text("주문 후보 데이터가 없습니다.")
                                    .font(.subheadline.weight(.semibold))
                                Text("차트에서 종목 분석을 먼저 실행하면 OrderIntent와 RiskCheck가 표시됩니다.")
                                    .font(.caption)
                                    .foregroundStyle(BeginnerPalette.muted)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity, minHeight: 170)
                        }
                    }
                }
                .padding(16)
            }

            VStack(spacing: 8) {
                Button(isLoading ? "처리 중" : "모의 주문 실행") {
                    showingSubmitConfirmation = true
                }
                .buttonStyle(.borderedProminent)
                .tint(BeginnerPalette.green)
                .foregroundStyle(BeginnerPalette.backgroundDeep)
                .frame(maxWidth: .infinity)
                .disabled(dashboard == nil || model.executionBlocked || isLoading)
                .accessibilityIdentifier("beginner-paper-order-submit")

                HStack(spacing: 8) {
                    Button("계획 저장") { savePlan() }
                        .buttonStyle(.bordered)
                        .disabled(dashboard == nil || isLoading)
                        .accessibilityIdentifier("beginner-paper-order-save-plan")
                    Button("전략 설정", action: onOpenStrategy)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("beginner-paper-order-open-strategy")
                }

                Button("실주문 주문서") { onOpenLiveOrder() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("beginner-paper-order-open-live")
            }
            .padding(16)
            .background(BeginnerPalette.surfaceRaised)
            .overlay(alignment: .top) {
                Rectangle().fill(BeginnerPalette.line).frame(height: 1)
            }
        }
        .frame(maxHeight: .infinity)
        .background(BeginnerPalette.backgroundDeep)
        .overlay(alignment: .leading) {
            Rectangle().fill(BeginnerPalette.lineStrong).frame(width: 1)
        }
        .shadow(color: .black.opacity(0.35), radius: 28, x: -10)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("모의 주문 패널")
        .accessibilityIdentifier("beginner-paper-order-drawer")
        .task {
            await Task.yield()
            closeButtonFocused = true
        }
        .confirmationDialog(
            "모의 주문 실행",
            isPresented: $showingSubmitConfirmation,
            titleVisibility: .visible
        ) {
            Button("모의 주문 실행") { submitPaperOrder() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("선택한 OrderIntent를 paper 계좌에만 실행합니다. 실제 broker 주문은 제출하지 않습니다.")
        }
    }

    private func drawerMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(BeginnerPalette.muted)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(2)
        }
        .padding(9)
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 8))
    }

    private func riskLine(_ text: String, icon: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(color)
            Text(text)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func submitPaperOrder() {
        guard let dashboard else { return }
        Task {
            isLoading = true
            resultPreview = "\(dashboard.symbol) OrderIntent를 paper 계좌에 실행 중입니다."
            defer { isLoading = false }
            resultPreview = await model.runPaperOrderIntent(dashboard, session: selectedSession)
        }
    }

    private func savePlan() {
        guard let dashboard else { return }
        Task {
            isLoading = true
            resultPreview = "\(dashboard.symbol) 주문 계획을 저장 중입니다."
            defer { isLoading = false }
            resultPreview = await model.saveOrderIntentPlan(dashboard, session: selectedSession)
        }
    }
}

struct BeginnerLiveTradingSettingsCard: View {
    @EnvironmentObject private var model: AppModel
    @State private var liveConsentConfirmation = ""
    @State private var manualConfirmation = ""
    @State private var automationConfirmation = ""

    private var policy: LocalLiveTradingPolicy? { model.localLiveTrading?.policy }
    private var eligibility: LocalLiveAutomationEligibility? { model.localLiveTrading?.automationEligibility }

    var body: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Toss 실거래 운영")
                            .font(.headline)
                        Text("이 Mac 한 대와 선택 계좌만 대상으로 합니다. API 등록·계좌 변경 시 readiness와 실거래 토글은 자동으로 초기화됩니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    BeginnerStatusBadge(policy?.manualEnabled == true ? "수동 ON" : "기본 OFF", color: policy?.manualEnabled == true ? BeginnerPalette.green : BeginnerPalette.amber)
                }

                if let unknown = policy?.unknownLock {
                    Text("결과 불명 주문 잠금: \(unknown.reason)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BeginnerPalette.red)
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text("1. 자동 읽기 전용 점검")
                        .font(.subheadline.weight(.semibold))
                    Text(policy?.readinessVerifiedAt == nil
                         ? "API 등록 또는 거래 계좌 선택 뒤 계좌·전체 보유·KRW/USD 주문 가능 금액·미체결 주문을 자동 확인합니다."
                         : "계좌·보유·주문 가능 금액·미체결 주문 읽기 전용 점검이 완료되었습니다.")
                        .font(.caption)
                        .foregroundStyle(policy?.readinessVerifiedAt == nil ? BeginnerPalette.amber : BeginnerPalette.green)
                    if policy?.readinessVerifiedAt != nil && policy?.userConsentAt == nil {
                        TextField("주식 실거래 위험을 확인했습니다", text: $liveConsentConfirmation)
                            .textFieldStyle(.roundedBorder)
                        Button("실거래 이용 동의") {
                            Task { await model.consentLocalLiveTrading(confirmation: liveConsentConfirmation) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(liveConsentConfirmation != "주식 실거래 위험을 확인했습니다")
                    }
                }

                Divider().overlay(BeginnerPalette.line)

                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("2. 수동 지정가 주문")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(policy?.userConsentAt == nil ? "이용 동의 필요" : "이용 동의됨")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(policy?.userConsentAt == nil ? BeginnerPalette.amber : BeginnerPalette.green)
                    }
                    Text("매수는 건당 10만원, KST 일일 제출 누적 30만원입니다. 취소·매도로 한도가 복구되지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                    TextField("실거래 수동 주문 해제", text: $manualConfirmation)
                        .textFieldStyle(.roundedBorder)
                        .disabled(policy?.manualEnabled == true)
                    HStack {
                        Button("수동 실거래 켜기") {
                            Task { await model.setLocalLiveTradingUserEnabled(true, confirmation: manualConfirmation) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.red)
                        .disabled(policy?.manualEnabled == true || manualConfirmation != "실거래 수동 주문 해제")
                        Button("수동 실거래 끄기") {
                            Task { await model.setLocalLiveTradingUserEnabled(false) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(policy?.manualEnabled != true)
                    }
                }

                Divider().overlay(BeginnerPalette.line)

                VStack(alignment: .leading, spacing: 7) {
                    Text("3. 자동화 실거래 (별도 해제)")
                        .font(.subheadline.weight(.semibold))
                    if let eligibility {
                        Text("수동 지정가 \(eligibility.manualLimitOrders)/5 · 재시작 재조정 \(eligibility.reconciliationRecorded ? "완료" : "미완료") · 안전 게이트 \(eligibility.safetyGateVerified ? "완료" : "미완료") · 결과 불명 \(eligibility.unresolvedUnknown)건")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                        ForEach(eligibility.blockers, id: \.self) { blocker in
                            Text("• \(blocker)")
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.amber)
                        }
                    } else {
                        Text("sidecar 상태를 불러오는 중입니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Text("안전 차단 증거는 긴급 중지와 워커 일시중지를 모두 켠 상태에서만 기록됩니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                    Button("현재 차단 상태 기록") {
                        Task { await model.verifyLocalLiveTradingSafetyGates() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(!model.killSwitchEngaged || !model.workerPausedEffective)
                    TextField("자동화 실거래 해제", text: $automationConfirmation)
                        .textFieldStyle(.roundedBorder)
                        .disabled(policy?.automationEnabled == true)
                    HStack {
                        Button("자동화 실거래 켜기") {
                            Task { await model.setLocalAutomationLiveTradingEnabled(true, confirmation: automationConfirmation) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.red)
                        .disabled(policy?.automationEnabled == true || eligibility?.eligible != true || automationConfirmation != "자동화 실거래 해제")
                        Button("자동화 실거래 끄기") {
                            Task { await model.setLocalAutomationLiveTradingEnabled(false) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(policy?.automationEnabled != true)
                    }
                }

                Text(model.localLiveTradingMessage)
                    .font(.caption2)
                    .foregroundStyle(BeginnerPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityIdentifier("beginner-settings-live-trading")
        .task { await model.refreshLocalLiveTrading() }
    }
}

struct BeginnerLiveOrderDrawer: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    let onClose: () -> Void

    @State private var confirmation = ""
    @AccessibilityFocusState private var closeButtonFocused: Bool

    private var dashboard: TerminalDashboardSnapshot? {
        guard let latest = model.terminalDashboard,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol) else {
            return nil
        }
        return latest
    }

    private var precheck: LocalOrderPrecheckResponse? {
        guard let latest = model.latestOrderPrecheck,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol) else {
            return nil
        }
        return latest
    }

    private var manualEnabled: Bool {
        model.localLiveTrading?.policy?.manualEnabled == true
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Toss 실주문")
                        .font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text("단일 Mac · 선택 계좌 · 지정가 전용")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel("실주문 주문서 닫기")
                .accessibilityFocused($closeButtonFocused)
            }
            .padding(18)
            .background(BeginnerPalette.surfaceRaised)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        BeginnerStatusBadge("Toss 지정가", color: BeginnerPalette.blue)
                        BeginnerStatusBadge(manualEnabled ? "수동 토글 ON" : "수동 토글 OFF", color: manualEnabled ? BeginnerPalette.green : BeginnerPalette.amber)
                        if model.localLiveTrading?.policy?.unknownLock != nil {
                            BeginnerStatusBadge("결과 불명 잠금", color: BeginnerPalette.red)
                        }
                    }

                    Text("Upbit·Bithumb과 시장가 주문은 이 화면에서 지원하지 않습니다. 제출 직전에도 계좌·RiskCheck·잔고/매도가능수량·환율·KST 한도를 다시 확인합니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)

                    if let dashboard {
                        BeginnerSurface {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("주문 요약")
                                    .font(.headline)
                                LazyVGrid(columns: [GridItem(), GridItem()], spacing: 9) {
                                    metric("종목", dashboard.orderIntent.symbol)
                                    metric("방향", dashboard.orderIntent.side == "buy" ? "매수" : "매도")
                                    metric("유형", dashboard.orderIntent.type == "limit" ? "지정가" : dashboard.orderIntent.type)
                                    metric("수량", "\(dashboard.orderIntent.quantity)")
                                    metric("지정가", beginnerPrice(dashboard.orderIntent.limitPrice, currency: dashboard.orderIntent.currency))
                                    metric("예상금액", beginnerPrice(
                                        (dashboard.orderIntent.limitPrice ?? 0) * Double(dashboard.orderIntent.quantity),
                                        currency: dashboard.orderIntent.currency
                                    ))
                                }
                            }
                        }

                        if let precheck {
                            BeginnerSurface {
                                VStack(alignment: .leading, spacing: 9) {
                                    HStack {
                                        Text("제출 전 검증")
                                            .font(.headline)
                                        Spacer()
                                        BeginnerStatusBadge(precheck.submitReady ? "제출 가능" : "차단", color: precheck.submitReady ? BeginnerPalette.green : BeginnerPalette.red)
                                    }
                                    metric("KRW 환산", beginnerPrice(precheck.krwEquivalent, currency: "KRW"))
                                    metric("남은 일일 매수 한도", beginnerPrice(precheck.remainingDailyBuyKrw, currency: "KRW"))
                                    if precheck.currency == "USD" {
                                        metric("Toss USD/KRW", precheck.exchangeRate.map { $0.formatted(.number.precision(.fractionLength(2))) } ?? "유효하지 않음")
                                    }
                                    ForEach(precheck.blockers, id: \.self) { blocker in
                                        riskLine(blocker, icon: "xmark.octagon.fill", color: BeginnerPalette.red)
                                    }
                                    ForEach(precheck.warnings, id: \.self) { warning in
                                        riskLine(warning, icon: "exclamationmark.triangle.fill", color: BeginnerPalette.amber)
                                    }
                                }
                            }

                            if let confirmationText = precheck.confirmationText {
                                BeginnerSurface {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("최종 확인")
                                            .font(.headline)
                                        Text("아래 주문 요약을 정확히 입력해야 제출 버튼이 열립니다.")
                                            .font(.caption)
                                            .foregroundStyle(BeginnerPalette.muted)
                                        Text(confirmationText)
                                            .font(.system(.caption, design: .monospaced).weight(.semibold))
                                            .textSelection(.enabled)
                                            .padding(9)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 8))
                                        TextField("주문 요약 입력", text: $confirmation)
                                            .textFieldStyle(.roundedBorder)
                                            .disabled(!precheck.submitReady || isLoading)
                                            .accessibilityIdentifier("beginner-live-order-confirmation")
                                    }
                                }
                            }
                        } else {
                            BeginnerSurface {
                                Text("사전검증을 실행하면 RiskCheck, Toss 잔고/매도가능수량, USD 환율과 일일 한도를 표시합니다. 실제 주문은 아직 제출하지 않습니다.")
                                    .font(.caption)
                                    .foregroundStyle(BeginnerPalette.muted)
                            }
                        }
                    } else {
                        BeginnerSurface {
                            Text("차트에서 종목 분석을 먼저 실행해 지정가 OrderIntent를 준비하세요.")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                    }

                    if !resultPreview.isEmpty {
                        Text(resultPreview)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(BeginnerPalette.muted)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(16)
            }

            VStack(spacing: 8) {
                Button(isLoading ? "검증 중" : "사전검증 다시 실행") { runPrecheck() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(dashboard == nil || isLoading)
                    .accessibilityIdentifier("beginner-live-order-precheck")

                Button(isLoading ? "처리 중" : "최종 실주문 제출") { submit() }
                    .buttonStyle(.borderedProminent)
                    .tint(BeginnerPalette.red)
                    .foregroundStyle(BeginnerPalette.backgroundDeep)
                    .frame(maxWidth: .infinity)
                    .disabled(precheck?.submitReady != true || confirmation != precheck?.confirmationText || isLoading)
                    .accessibilityIdentifier("beginner-live-order-submit")
            }
            .padding(16)
            .background(BeginnerPalette.surfaceRaised)
            .overlay(alignment: .top) { Rectangle().fill(BeginnerPalette.line).frame(height: 1) }
        }
        .frame(maxHeight: .infinity)
        .background(BeginnerPalette.backgroundDeep)
        .overlay(alignment: .leading) { Rectangle().fill(BeginnerPalette.lineStrong).frame(width: 1) }
        .shadow(color: .black.opacity(0.35), radius: 28, x: -10)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Toss 실주문 패널")
        .accessibilityIdentifier("beginner-live-order-drawer")
        .task {
            await Task.yield()
            closeButtonFocused = true
            if precheck == nil { runPrecheck() }
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(BeginnerPalette.muted)
            Text(value).font(.system(size: 13, weight: .semibold)).lineLimit(2)
        }
        .padding(9)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .topLeading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 8))
    }

    private func riskLine(_ text: String, icon: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(color)
            Text(text).font(.caption).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func runPrecheck() {
        guard let dashboard else { return }
        Task {
            isLoading = true
            defer { isLoading = false }
            confirmation = ""
            resultPreview = await model.runOrderPrecheck(dashboard)
        }
    }

    private func submit() {
        guard let precheck else { return }
        Task {
            isLoading = true
            defer { isLoading = false }
            resultPreview = await model.submitLocalLiveOrder(precheck, confirmation: confirmation)
        }
    }
}
