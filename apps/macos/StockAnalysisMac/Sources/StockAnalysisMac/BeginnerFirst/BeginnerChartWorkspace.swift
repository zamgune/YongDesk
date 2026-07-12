import SwiftUI
import StockAnalysisMacCore

struct BeginnerChartWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    let assetClass: BeginnerAssetClass
    let analysis: MarketAnalysisSnapshot?
    @Binding var selectedTab: BeginnerAnalysisTab
    @Binding var selectedHorizon: BeginnerTradeHorizon
    @Binding var selectedChartTimeframe: BeginnerChartTimeframe
    @Binding var resultPreview: String
    let isLoading: Bool
    let compact: Bool
    let onAnalyze: (Double?, AnalysisHoldingPlanMode) -> Void
    let onChartTimeframeChanged: (BeginnerChartTimeframe) -> Void
    let onAddToWatchlist: () -> Void
    let onOpenOrder: () -> Void
    let onRefreshNews: () -> Void

    @AppStorage("interactive-chart.show-ma5") private var showMA5 = true
    @AppStorage("interactive-chart.show-ma20") private var showMA20 = true
    @AppStorage("interactive-chart.show-ma60") private var showMA60 = true
    @AppStorage("interactive-chart.show-rsi") private var showRSI = true
    @State private var chartResetToken = 0
    @State private var chartReloadToken = 0
    @State private var chartError: String?
    @State private var selectedChartSignal: String?
    @State private var entryPriceMode: BeginnerEntryPriceMode = .latestClose
    @State private var customEntryPrice = ""
    @State private var customEntryPriceError: String?

    private var workspaceAnalysis: WorkspaceAnalysis? {
        guard let latest = model.latestWorkspaceAnalysis,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol) else {
            return nil
        }
        return latest
    }

    private var chartAnalysis: MarketAnalysisSnapshot? {
        guard let latest = model.latestChartAnalysis,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol),
              latest.timeframe == selectedChartTimeframe.rawValue else {
            return analysis
        }
        return latest
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                marketSummary
                instrumentHeader
                chartCard
                analysisTabs
                tabContent
            }
            .padding(compact ? 14 : 20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-chart-workspace")
        .onChange(of: selectedChartTimeframe) { _, timeframe in
            chartResetToken += 1
            onChartTimeframeChanged(timeframe)
        }
        .onChange(of: selectedSymbol) { _, _ in
            entryPriceMode = .latestClose
            customEntryPrice = ""
            customEntryPriceError = nil
        }
    }

    private var marketSummary: some View {
        HStack(spacing: 11) {
            Image(systemName: analysis == nil ? "clock" : "checkmark.seal.fill")
                .foregroundStyle(analysis == nil ? BeginnerPalette.amber : BeginnerPalette.green)
            VStack(alignment: .leading, spacing: 3) {
                Text(analysis == nil ? model.workspaceAnalysisMessage : marketSummaryText)
                    .font(.system(size: 13, weight: .semibold))
                Text(analysis == nil
                     ? "API 키 없이도 기본 데이터로 분석할 수 있습니다."
                     : metadataLine)
                    .font(.system(size: 11))
                    .foregroundStyle(BeginnerPalette.muted)
                if let warning = workspaceAnalysis?.warnings.first, !warning.isEmpty {
                    Text(warning)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(BeginnerPalette.amber)
                        .lineLimit(2)
                }
            }
            Spacer()
            BeginnerStatusBadge(model.liveGateLabel, color: model.killSwitchEngaged ? BeginnerPalette.red : BeginnerPalette.green)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
        .background(BeginnerPalette.surfaceRaised.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12).stroke(BeginnerPalette.line)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("beginner-market-summary")
    }

    private var instrumentHeader: some View {
        HStack(alignment: .bottom, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text(displayName)
                    .font(.system(size: compact ? 22 : 26, weight: .bold))
                HStack(spacing: 8) {
                    Text(selectedSymbol.uppercased())
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .foregroundStyle(BeginnerPalette.muted)
                    BeginnerStatusBadge(assetClass == .crypto ? "가상자산" : selectedSession == "KR" ? "한국 주식" : "미국 주식", color: BeginnerPalette.blue)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(workspaceAnalysis?.analyses?.oneHour?.latestClose == nil
                     ? "최근 일봉 종가"
                     : "최근 확정 1시간봉 종가")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
                Text(beginnerPrice(
                    workspaceAnalysis?.analyses?.oneHour?.latestClose ?? analysis?.latestClose,
                    currency: workspaceAnalysis?.currency ?? analysis?.currency ?? defaultCurrency
                ))
                    .font(.system(size: compact ? 24 : 30, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                Text("일봉 등락률 · 직전 일봉 종가 대비 \(beginnerPercent(analysis?.changeRatio))")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle((analysis?.changeRatio ?? 0) >= 0 ? BeginnerPalette.green : BeginnerPalette.red)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 7) {
                Text("분석은 주문이 아닙니다")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                HStack(spacing: 8) {
                    Button("관심종목 추가", action: onAddToWatchlist)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("beginner-add-watchlist")
                    Button("다시 분석") {
                        onAnalyze(selectedEntryPrice, selectedPlanMode)
                    }
                        .buttonStyle(.bordered)
                        .disabled(isLoading)
                        .accessibilityIdentifier("beginner-refresh-analysis")
                    Button(assetClass == .crypto ? "코인 paper는 자동화에서" : "모의 주문", action: onOpenOrder)
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.green)
                        .foregroundStyle(BeginnerPalette.backgroundDeep)
                        .disabled(
                            assetClass == .crypto ||
                            model.terminalDashboard.map {
                                beginnerCanonicalSymbol($0.symbol) != beginnerCanonicalSymbol(selectedSymbol)
                            } ?? true
                        )
                        .help(assetClass == .crypto
                              ? "코인 paper 주문은 자동화 화면의 fractional 수량 전략 흐름을 사용합니다."
                              : "분석 후 생성된 OrderIntent를 paper 계좌에서만 실행합니다.")
                        .accessibilityIdentifier("beginner-open-paper-order")
                }
            }
        }
    }

    private var chartCard: some View {
        BeginnerSurface {
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("가격 흐름")
                            .font(.headline)
                        Text("선택한 봉 주기의 확정 캔들과 최근 종가를 사용합니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    Picker("차트 주기", selection: $selectedChartTimeframe) {
                        ForEach(BeginnerChartTimeframe.allCases) { timeframe in
                            Text(timeframe.title).tag(timeframe)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .frame(width: 104)
                    .accessibilityIdentifier("beginner-chart-timeframe")
                    Menu("지표") {
                        Toggle("MA 5", isOn: $showMA5)
                        Toggle("MA 20", isOn: $showMA20)
                        Toggle("MA 60", isOn: $showMA60)
                        Divider()
                        Toggle("RSI 14", isOn: $showRSI)
                    }
                    .menuStyle(.borderedButton)
                    .accessibilityIdentifier("beginner-chart-indicators")
                    Button("차트 초기화") {
                        chartResetToken += 1
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("beginner-chart-reset")
                }

                ZStack {
                    InteractiveChartView(
                        analysis: chartAnalysis,
                        options: InteractiveChartOptions(
                            showMA5: showMA5,
                            showMA20: showMA20,
                            showMA60: showMA60,
                            showRSI: showRSI,
                            resetToken: chartResetToken,
                            reloadToken: chartReloadToken
                        ),
                        selectedSignalText: $selectedChartSignal,
                        chartError: $chartError
                    )
                    if let chartError {
                        VStack(spacing: 8) {
                            Label("인터랙티브 차트를 불러오지 못했습니다.", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                            Text(chartError)
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.muted)
                                .multilineTextAlignment(.center)
                            Button("차트 다시 시도") {
                                chartReloadToken += 1
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("beginner-chart-retry")
                        }
                        .padding(16)
                        .background(BeginnerPalette.surfaceRaised, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .frame(height: showRSI ? 430 : 360)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10).stroke(BeginnerPalette.line)
                }
                .accessibilityIdentifier("beginner-price-chart")

                if let selectedChartSignal, !selectedChartSignal.isEmpty {
                    Text(selectedChartSignal)
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                        .lineLimit(2)
                        .accessibilityIdentifier("beginner-chart-signal-detail")
                } else {
                    Text("차트 위 신호에 커서를 올리면 근거와 가격을 확인할 수 있습니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
        }
    }

    private var analysisTabs: some View {
        HStack(spacing: 6) {
            ForEach(BeginnerAnalysisTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(tab.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selectedTab == tab ? BeginnerPalette.text : BeginnerPalette.muted)
                        .padding(.horizontal, 16)
                        .frame(height: 38)
                        .background(selectedTab == tab ? BeginnerPalette.surfaceSoft : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityValue(selectedTab == tab ? "선택됨" : "선택 안 됨")
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityIdentifier(tab.accessibilityIdentifier)
            }
            Spacer()
        }
        .padding(5)
        .background(BeginnerPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(BeginnerPalette.line) }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .analysis:
            analysisContent
        case .signals:
            BeginnerSurface {
                SignalStackPanel(analysis: analysis)
            }
            .accessibilityIdentifier("beginner-signal-panel")
        case .newsSentiment:
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("뉴스와 종목 민심")
                            .font(.headline)
                        Text("제목 수보다 원문 근거와 수집 상태를 함께 확인하세요.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    Button("새로고침", action: onRefreshNews)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("beginner-refresh-news-sentiment")
                }
                NewsImpactPanel(events: model.newsEvents, selectedSymbol: selectedSymbol)
                CommunitySentimentPanel(
                    snapshot: model.communitySentiment,
                    selectedSymbol: selectedSymbol,
                    message: model.communitySentimentMessage
                )
            }
            .accessibilityIdentifier("beginner-news-sentiment-panel")
        }
    }

    private var analysisContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            BeginnerSurface {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("보유 기간별 손절·익절 계획")
                                .font(.headline)
                            Text("최근 확정 종가·보유 평단·직접 입력 중 기준가를 선택하며, 데이터가 부족하면 가격을 임의로 만들지 않습니다.")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        Spacer()
                        BeginnerStatusBadge("가격·진입 판단 분리", color: BeginnerPalette.blue)
                    }

                    Picker("매매 기간", selection: $selectedHorizon) {
                        ForEach(BeginnerTradeHorizon.allCases) { horizon in
                            Text(horizon.title).tag(horizon)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("beginner-horizon-picker")

                    entryPriceControls

                    BeginnerHorizonPlan(
                        horizon: selectedHorizon,
                        analysis: analysis,
                        workspaceAnalysis: workspaceAnalysis,
                        assetClass: assetClass
                    )
                }
            }

            BeginnerSurface {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("한 줄 결론")
                                .font(.headline)
                            Text(analysis?.tradeLabel ?? "분석을 실행하면 조건부 결론이 표시됩니다.")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        Spacer()
                        BeginnerStatusBadge(
                            analysis?.reliabilityGrade.map { "신뢰도 \($0)" } ?? "신뢰도 대기",
                            color: analysis == nil ? BeginnerPalette.amber : BeginnerPalette.green
                        )
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10)], spacing: 10) {
                        conditionCard(title: "진입 계획", value: analysis?.entryPlan ?? "분석 데이터 없음", color: BeginnerPalette.blue)
                        conditionCard(title: "유효 조건", value: analysis?.validIf ?? "분석 데이터 없음", color: BeginnerPalette.green)
                        conditionCard(title: "무효 조건", value: analysis?.invalidIf ?? "분석 데이터 없음", color: BeginnerPalette.red)
                    }

                    DisclosureGroup("상세 근거 보기") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(resultPreview.isEmpty ? "분석을 실행하면 엔진의 상세 근거가 표시됩니다." : resultPreview)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(BeginnerPalette.muted)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 8)
                    }
                    .accessibilityIdentifier("beginner-analysis-details")
                }
            }
        }
    }

    private var entryPriceControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text("계산 기준가")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
                Picker("계산 기준가", selection: $entryPriceMode) {
                    Text(BeginnerEntryPriceMode.latestClose.title)
                        .tag(BeginnerEntryPriceMode.latestClose)
                    Text(BeginnerEntryPriceMode.holdingAverage.title)
                        .tag(BeginnerEntryPriceMode.holdingAverage)
                        .disabled(matchingHoldingAverage == nil)
                    Text(BeginnerEntryPriceMode.custom.title)
                        .tag(BeginnerEntryPriceMode.custom)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .frame(maxWidth: 430)
                .accessibilityIdentifier("beginner-entry-price-mode")
                Spacer()
                if entryPriceMode == .holdingAverage, let matchingHoldingAverage {
                    Text(beginnerPrice(matchingHoldingAverage, currency: planCurrency))
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
            }

            if entryPriceMode == .custom {
                HStack(spacing: 8) {
                    TextField("0보다 큰 기준가", text: $customEntryPrice)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 220)
                        .onSubmit(applyCustomEntryPrice)
                        .accessibilityIdentifier("beginner-custom-entry-price")
                    Text(planCurrency)
                        .font(.caption.monospaced())
                        .foregroundStyle(BeginnerPalette.muted)
                    Button("기준가 적용", action: applyCustomEntryPrice)
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.blue)
                        .accessibilityIdentifier("beginner-apply-entry-price")
                }
                if let customEntryPriceError {
                    Text(customEntryPriceError)
                        .font(.caption2)
                        .foregroundStyle(BeginnerPalette.red)
                }
            } else {
                Text(entryPriceMode == .holdingAverage
                     ? "현재 종목·통화와 일치하는 실제 보유 평단으로 다시 계산합니다."
                     : "최근 확정 1시간봉 종가를 기본 진입가로 사용합니다.")
                    .font(.caption2)
                    .foregroundStyle(BeginnerPalette.muted)
            }
        }
        .onChange(of: entryPriceMode) { _, mode in
            customEntryPriceError = nil
            switch mode {
            case .latestClose:
                onAnalyze(nil, .newEntry)
            case .holdingAverage:
                if let matchingHoldingAverage {
                    onAnalyze(matchingHoldingAverage, .positionManagement)
                } else {
                    entryPriceMode = .latestClose
                }
            case .custom:
                break
            }
        }
    }

    private var planCurrency: String {
        workspaceAnalysis?.currency ?? analysis?.currency ?? defaultCurrency
    }

    private var matchingHoldingAverage: Double? {
        model.realPortfolio?.providers
            .flatMap(\.positions)
            .first {
                beginnerCanonicalSymbol($0.symbol) == beginnerCanonicalSymbol(selectedSymbol)
                    && $0.currency == planCurrency
                    && ($0.averagePrice ?? 0) > 0
            }?
            .averagePrice
    }

    private var selectedEntryPrice: Double? {
        switch entryPriceMode {
        case .latestClose:
            return nil
        case .holdingAverage:
            return matchingHoldingAverage
        case .custom:
            return parsedCustomEntryPrice
        }
    }

    private var parsedCustomEntryPrice: Double? {
        let normalized = customEntryPrice
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Double(normalized), value.isFinite, value > 0 else {
            return nil
        }
        return value
    }

    private func applyCustomEntryPrice() {
        guard let entryPrice = parsedCustomEntryPrice else {
            customEntryPriceError = "0보다 큰 숫자를 입력하세요."
            return
        }
        customEntryPriceError = nil
        onAnalyze(entryPrice, .newEntry)
    }

    private var selectedPlanMode: AnalysisHoldingPlanMode {
        entryPriceMode == .holdingAverage ? .positionManagement : .newEntry
    }

    private func conditionCard(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
            }
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
        .background(BeginnerPalette.surfaceRaised, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(BeginnerPalette.line) }
    }

    private var marketSummaryText: String {
        guard let analysis else { return "시장 판단 대기" }
        let movement = (analysis.changeRatio ?? 0) >= 0 ? "상승" : "하락"
        return "\(selectedSymbol.uppercased()) 최근 일봉은 직전 일봉 대비 \(movement)했습니다. 조건과 무효선을 함께 확인하세요."
    }

    private var metadataLine: String {
        guard let workspaceAnalysis else {
            return "일봉 분석 · 최근 종가 기준 · 통화 \(analysis?.currency ?? "-")"
        }
        let source = beginnerDataSourceLabel(workspaceAnalysis.dataSource)
        let quoteAt = beginnerTimestamp(workspaceAnalysis.quoteAt ?? workspaceAnalysis.generatedAt)
        let stale = workspaceAnalysis.stale == true ? " · 지연 가능" : ""
        return "\(selectedChartTimeframe.title) 차트 · \(source) · \(workspaceAnalysis.currency ?? chartAnalysis?.currency ?? analysis?.currency ?? "-") · \(quoteAt)\(stale)"
    }

    private var displayName: String {
        switch selectedSymbol.uppercased() {
        case "005930", "005930.KS": return "삼성전자"
        case "AAPL": return "Apple"
        case "KRW-BTC", "BTC-USD", "BTCUSDT": return "Bitcoin"
        default: return selectedSymbol.uppercased()
        }
    }

    private var defaultCurrency: String {
        if assetClass == .crypto || selectedSession == "KR" { return "KRW" }
        return "USD"
    }
}

private struct BeginnerHorizonPlan: View {
    let horizon: BeginnerTradeHorizon
    let analysis: MarketAnalysisSnapshot?
    let workspaceAnalysis: WorkspaceAnalysis?
    let assetClass: BeginnerAssetClass

    private var plan: AnalysisHorizonPlan? {
        workspaceAnalysis?.horizonPlans.first { item in
            switch (horizon, item.horizon) {
            case (.day, .day), (.swing, .swing), (.longTerm, .long): return true
            default: return false
            }
        }
    }

    private var currency: String {
        plan?.basis?.currency ?? workspaceAnalysis?.currency ?? analysis?.currency ?? "KRW"
    }

    private var isActionable: Bool {
        plan?.status == .actionable
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(horizonSubtitle)
                        .font(.system(size: 15, weight: .semibold))
                    Text(statusDescription)
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                HStack(spacing: 6) {
                    BeginnerStatusBadge(calculationStatusLabel, color: calculationStatusColor)
                    BeginnerStatusBadge(entryStatusLabel, color: entryStatusColor)
                }
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                planTile(
                    title: entryPriceTitle,
                    value: beginnerPrice(plan?.entryPrice ?? analysis?.latestClose, currency: currency),
                    detail: plan?.entryPrice == nil ? "분석 후 표시" : "계산 기준 · 주문 미전송"
                )
                planTile(
                    title: "손절·무효화",
                    value: beginnerPrice(plan?.stop?.price, currency: currency),
                    detail: stopDetail
                )
                planTile(
                    title: "1차 익절",
                    value: beginnerPrice(plan?.takeProfits.first?.price, currency: currency),
                    detail: takeProfitDetail(at: 0)
                )
                planTile(
                    title: "2차 익절",
                    value: beginnerPrice(plan?.takeProfits.dropFirst().first?.price, currency: currency),
                    detail: takeProfitDetail(at: 1)
                )
                planTile(
                    title: "추적 청산",
                    value: beginnerPrice(plan?.trailingExit?.price, currency: currency),
                    detail: trailingExitDetail
                )
            }

            if let managementState = plan?.managementState {
                managementPanel(managementState)
            }

            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "info.circle")
                    .foregroundStyle(BeginnerPalette.blue)
                Text(planGuidance)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let plan, !plan.blockers.isEmpty || !plan.formulaSteps.isEmpty {
                DisclosureGroup("계산 근거와 보류 사유") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(plan.blockers, id: \.self) { blocker in
                            Label(blocker, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.amber)
                        }
                        ForEach(Array(plan.formulaSteps.enumerated()), id: \.offset) { index, step in
                            Text("\(index + 1). \(step)")
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(BeginnerPalette.muted)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.top, 8)
                }
                .accessibilityIdentifier("beginner-horizon-evidence-\(horizon.rawValue)")
            }
        }
        .id(horizon)
        .accessibilityIdentifier(horizon.accessibilityIdentifier)
    }

    private func planTile(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(BeginnerPalette.muted)
            Text(value)
                .font(.system(size: 16, weight: .bold, design: .rounded))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).stroke(BeginnerPalette.line) }
    }

    private func managementPanel(_ state: AnalysisHorizonManagementState) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label(
                    state.state == .invalidationBreached ? "장기 무효선 이탈 보유관리" : "장기 보유관리",
                    systemImage: state.state == .invalidationBreached ? "exclamationmark.shield.fill" : "shield.checkered"
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(state.state == .invalidationBreached ? BeginnerPalette.red : BeginnerPalette.green)
                Spacer()
                Text("현재 \(beginnerPrice(state.currentPrice, currency: currency)) · 평단 \(beginnerPrice(state.averagePrice, currency: currency))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(BeginnerPalette.muted)
            }
            HStack(spacing: 14) {
                Text("무효선 \(beginnerPrice(state.invalidationPrice, currency: currency))")
                Text("재진입 확인 \(beginnerPrice(state.reentryConfirmationPrice, currency: currency))")
            }
            .font(.caption.weight(.semibold))
            ForEach(state.actions, id: \.self) { action in
                Label(action, systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
            }
        }
        .padding(12)
        .background(BeginnerPalette.surfaceRaised, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(BeginnerPalette.line) }
        .accessibilityIdentifier("beginner-position-management")
    }

    private var entryPriceTitle: String {
        "선택한 계산 기준가"
    }

    private var statusDescription: String {
        if let reason = plan?.reasons.first, !reason.isEmpty {
            return reason
        }
        switch horizon {
        case .day:
            return assetClass == .crypto
                ? "단타는 일봉 결론을 그대로 재사용하지 않습니다. 4시간 위험 필터와 1시간 진입 조건이 일치할 때만 손절·익절선을 계산합니다."
                : "주식 단타는 정규장 일봉 위험 필터와 확정 1시간봉 진입 조건을 결합합니다. 장중 미완성 봉은 확정 신호에서 제외합니다."
        case .swing:
            return assetClass == .crypto
                ? "코인 스윙은 일봉 추세를 기준으로 4시간 진입과 1시간 재확인을 결합합니다. 부분 봉은 확정 신호에서 제외합니다."
                : "주식 스윙은 일봉 방향을 기준으로 확정 1시간봉 진입 조건을 결합합니다. 4시간봉은 정규장 길이 때문에 필수 조건으로 사용하지 않습니다."
        case .longTerm:
            return "현재 일봉 분석은 참고할 수 있지만, 장기 손절·익절 수치는 주봉 구조와 장기 이동평균 계약이 연결된 뒤 계산합니다."
        }
    }

    private func takeProfitDetail(at index: Int) -> String {
        guard let targets = plan?.takeProfits, targets.indices.contains(index) else {
            switch horizon {
            case .day: return index == 0 ? "1R와 가까운 저항 비교" : "2R 기준"
            case .swing: return index == 0 ? "1R와 일봉 저항 비교" : "2R 기준"
            case .longTerm: return index == 0 ? "2R 비중 조절" : "4R 비중 조절"
            }
        }
        let target = targets[index]
        let allocation = target.allocationPct.map { " · \(Int($0.rounded()))% 청산" } ?? ""
        return "\(target.basis ?? "계산 근거 확인")\(allocation)"
    }

    private var stopDetail: String {
        guard let stop = plan?.stop else { return "시간봉 구조·ATR 필요" }
        let trigger = localizedTrigger(stop.trigger)
        let executionNote = stop.isBrokerStopEligible == false ? " · 자동 주문 아님" : ""
        if let reason = stop.reason, !reason.isEmpty {
            if let trigger {
                return "\(trigger) · \(reason)\(executionNote)"
            }
            return "\(reason)\(executionNote)"
        }
        return "\(trigger ?? "무효 조건 확인")\(executionNote)"
    }

    private func localizedTrigger(_ trigger: String?) -> String? {
        switch trigger {
        case "hourly-close": return "1시간봉 종가"
        case "daily-close": return "일봉 종가"
        case "monthly-close": return "월말 종가"
        case let value?: return value
        case nil: return nil
        }
    }

    private var trailingDetail: String {
        switch horizon {
        case .day: return "1시간 종가 기준"
        case .swing: return "일봉 SMA20·Chandelier 기준"
        case .longTerm: return "월봉·주봉 종가 기준"
        }
    }

    private var trailingExitDetail: String {
        if let trailingExit = plan?.trailingExit {
            let allocation = trailingExit.allocationPct.map { " · \(Int($0.rounded()))% 청산" } ?? ""
            return "\(trailingExit.basis ?? trailingDetail)\(allocation)"
        }
        return horizon == .day ? "별도 추적선 없음 · 1시간봉 종가에서 재검토" : trailingDetail
    }

    private var requiredData: String {
        switch horizon {
        case .day:
            return assetClass == .crypto
                ? "확정 4시간봉·1시간봉, ATR, 최근 저점"
                : "확정 일봉·1시간봉, 세션 기준 ATR, 최근 저점"
        case .swing:
            return assetClass == .crypto
                ? "확정 일봉·4시간봉·1시간봉, ATR, 저항선"
                : "확정 일봉·1시간봉, ATR, 일봉 저항선"
        case .longTerm: return "확정 일봉·주봉, SMA200, 장기 구조선"
        }
    }

    private var hasCalculatedPrices: Bool {
        guard let plan else { return false }
        if plan.managementState != nil, plan.stop?.price != nil {
            return true
        }
        return plan.stop?.price != nil && plan.takeProfits.count >= 2
    }

    private var calculationStatusLabel: String {
        if plan?.managementState != nil { return "보유관리 계산 완료" }
        return hasCalculatedPrices ? "가격 계산 완료" : plan == nil ? "계산 데이터 대기" : "가격 계산 불가"
    }

    private var calculationStatusColor: Color {
        hasCalculatedPrices ? BeginnerPalette.green : plan == nil ? BeginnerPalette.muted : BeginnerPalette.red
    }

    private var entryStatusLabel: String {
        guard let plan else { return "진입 판단 대기" }
        if plan.managementState?.state == .invalidationBreached { return "무효선 이탈" }
        if plan.managementState?.state == .recoveryWatch { return "회복 관찰" }
        if plan.managementState?.state == .active { return "보유관리 활성" }
        switch plan.status {
        case .actionable: return "진입 가능"
        case .wait: return "진입 대기"
        case .unavailable: return "진입 판단 불가"
        case let .unknown(value): return value
        }
    }

    private var entryStatusColor: Color {
        guard let plan else { return BeginnerPalette.muted }
        if plan.managementState?.state == .invalidationBreached { return BeginnerPalette.red }
        if plan.managementState?.state == .recoveryWatch { return BeginnerPalette.amber }
        if plan.managementState?.state == .active { return BeginnerPalette.green }
        switch plan.status {
        case .actionable: return BeginnerPalette.green
        case .wait: return BeginnerPalette.amber
        case .unavailable, .unknown: return BeginnerPalette.red
        }
    }

    private var planGuidance: String {
        if let managementState = plan?.managementState {
            return managementState.state == .invalidationBreached
                ? "보유 평단 기준 계획의 장기 무효선이 이미 이탈했습니다. 익절 목표보다 축소·청산과 재진입 조건을 먼저 확인하세요."
                : "실제 보유 평단과 현재가를 분리한 보유관리 계획입니다. 주문은 전송하지 않습니다."
        }
        if plan?.status == .unavailable, let blocker = plan?.blockers.first, !blocker.isEmpty {
            return "가격 계산 불가: \(blocker) 임의 가격으로 대체하지 않습니다."
        }
        if plan?.status == .wait, let blocker = plan?.blockers.first, !blocker.isEmpty {
            return "신규 진입 대기: \(blocker) 표시 가격은 위험 관리 참고값이며 지금 매수 신호가 아닙니다."
        }
        if isActionable {
            let source = beginnerDataSourceLabel(plan?.basis?.dataSource ?? workspaceAnalysis?.dataSource)
            let timeframe = plan?.basis?.timeframeLabel ?? horizonSubtitle
            let quoteAt = beginnerTimestamp(plan?.basis?.quoteAt ?? workspaceAnalysis?.quoteAt)
            return "\(source) · \(timeframe) · \(quoteAt) 기준입니다. 이 계획은 주문이 아니며 실행 전에 가격과 RiskCheck를 다시 확인해야 합니다."
        }
        return "수치가 표시되려면 \(requiredData)가 모두 있어야 합니다. 누락 시 고정 퍼센트나 임의 가격으로 대체하지 않습니다."
    }

    private var horizonSubtitle: String {
        switch (assetClass, horizon) {
        case (.stock, .day): return "일봉 위험 필터 · 1시간 진입"
        case (.stock, .swing): return "일봉 방향 · 1시간 진입"
        case (.crypto, .day): return "4시간 위험 필터 · 1시간 진입"
        case (.crypto, .swing): return "일봉 방향 · 4시간 진입 · 1시간 확인"
        case (_, .longTerm): return "일봉 · 주봉 구조"
        }
    }
}
