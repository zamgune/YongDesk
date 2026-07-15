import SwiftUI
import StockAnalysisMacCore

private enum BeginnerOrderPurpose: String, CaseIterable, Identifiable {
    case newPosition
    case managePosition

    var id: String { rawValue }
    var title: String { self == .newPosition ? "신규 매수" : "보유분 관리" }
    var contractValue: String { self == .newPosition ? "new-position" : "manage-position" }
}

private enum BeginnerOrderMode: String, CaseIterable, Identifiable {
    case paper
    case tossLive

    var id: String { rawValue }
    var title: String { self == .paper ? "모의" : "Toss 실계좌" }
    var contractValue: String { self == .paper ? "paper" : "toss-live" }
}

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
    @State private var inspectorCollapsed = false
    @State private var orderPurpose: BeginnerOrderPurpose = .newPosition
    @State private var orderMode: BeginnerOrderMode = .paper
    @State private var orderQuantity = "1"
    @State private var orderEntryPrice = ""
    @State private var takeProfitEnabled = false
    @State private var takeProfitPrice = ""
    @State private var stopLossEnabled = false
    @State private var stopLossPrice = ""
    @State private var stopLossOrderPrice = ""
    @State private var orderExpiryDate = BeginnerChartWorkspace.defaultExpiryDate(days: 1)
    @State private var liveConfirmation = ""
    @State private var orderError: String?

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
        GeometryReader { proxy in
            let forceCollapsed = proxy.size.width < 850
            VStack(spacing: 0) {
                workspaceToolbar(forceCollapsed: forceCollapsed)
                Divider().overlay(BeginnerPalette.line)

                if forceCollapsed {
                    if inspectorCollapsed { inspector } else { chartColumn }
                } else if inspectorCollapsed {
                    chartColumn
                } else {
                    HSplitView {
                        chartColumn
                            .frame(minWidth: 500)
                        inspector
                            .frame(minWidth: 330, idealWidth: 370, maxWidth: 430)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("beginner-chart-split-workbench")
                }
            }
        }
        .background(BeginnerPalette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-chart-workspace")
        .onChange(of: selectedChartTimeframe) { _, timeframe in
            chartResetToken += 1
            onChartTimeframeChanged(timeframe)
        }
        .onChange(of: selectedSymbol) { _, _ in
            entryPriceMode = .latestClose
            customEntryPrice = ""
            customEntryPriceError = nil
            orderEntryPrice = ""
            takeProfitPrice = ""
            stopLossPrice = ""
            stopLossOrderPrice = ""
            liveConfirmation = ""
            orderError = nil
            Task { await model.refreshManagedTradePlans() }
        }
        .onChange(of: selectedHorizon) { _, horizon in
            orderExpiryDate = Self.defaultExpiryDate(days: horizon == .day ? 1 : 30)
        }
        .onChange(of: assetClass) { _, next in
            if next == .crypto { orderMode = .paper }
        }
        .task { await model.refreshManagedTradePlans() }
    }

    private var chartColumn: some View {
        VStack(spacing: 10) {
            chartCard
        }
        .padding(compact ? 10 : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-chart-column")
    }

    private var inspector: some View {
        VStack(spacing: 0) {
            analysisTabs
                .padding(10)
            ScrollView {
                tabContent
                    .padding(.horizontal, 12)
                    .padding(.bottom, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(BeginnerPalette.backgroundDeep.opacity(0.72))
        .overlay(alignment: .leading) { Rectangle().fill(BeginnerPalette.line).frame(width: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-chart-inspector")
    }

    private func workspaceToolbar(forceCollapsed: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text(displayName)
                        .font(.system(size: 17, weight: .bold))
                    Text(selectedSymbol.uppercased())
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(BeginnerPalette.muted)
                }
                Text(beginnerPrice(
                    workspaceAnalysis?.analyses?.oneHour?.latestClose ?? analysis?.latestClose,
                    currency: planCurrency
                ))
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
            }

            BeginnerStatusBadge(assetClass == .crypto ? "가상자산" : selectedSession == "KR" ? "한국 주식" : "미국 주식", color: BeginnerPalette.blue)
            if !compact {
                BeginnerStatusBadge(toolbarSourceLabel, color: BeginnerPalette.muted)
            }
            BeginnerStatusBadge(workspaceAnalysis?.stale == true ? "시세 지연" : "시세 정상", color: workspaceAnalysis?.stale == true ? BeginnerPalette.amber : BeginnerPalette.green)
            BeginnerStatusBadge(model.liveGateLabel, color: model.killSwitchEngaged ? BeginnerPalette.red : BeginnerPalette.green)
            if let signal = model.watchlistSignal(for: selectedSymbol) {
                Button {
                    selectedTab = .analysis
                } label: {
                    BeginnerStatusBadge("급락 \(signal.signal.label)", color: crashSignalColor(signal.signal.stage))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("beginner-crash-signal-toolbar")
            }

            Spacer(minLength: 8)

            Picker("차트 주기", selection: $selectedChartTimeframe) {
                ForEach(BeginnerChartTimeframe.allCases) { timeframe in
                    Text(timeframe.title).tag(timeframe)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: 90)
            .accessibilityIdentifier("beginner-chart-timeframe-toolbar")

            Button("관심종목", action: onAddToWatchlist)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("beginner-add-watchlist")
            Button("재분석") { onAnalyze(selectedEntryPrice, selectedPlanMode) }
                .buttonStyle(.bordered)
                .disabled(isLoading)
                .accessibilityIdentifier("beginner-refresh-analysis")
            Button {
                if forceCollapsed {
                    inspectorCollapsed.toggle()
                    if inspectorCollapsed { selectedTab = .order }
                } else if inspectorCollapsed {
                    inspectorCollapsed = false
                    selectedTab = .order
                } else {
                    selectedTab = .order
                }
            } label: {
                Label(forceCollapsed ? (inspectorCollapsed ? "차트" : "인스펙터") : inspectorCollapsed ? "인스펙터" : "주문", systemImage: forceCollapsed && inspectorCollapsed ? "chart.xyaxis.line" : "sidebar.right")
            }
            .buttonStyle(.borderedProminent)
            .tint(BeginnerPalette.green)
            .foregroundStyle(BeginnerPalette.backgroundDeep)
            .accessibilityIdentifier("beginner-open-order-inspector")

            if !forceCollapsed {
                Button {
                    inspectorCollapsed.toggle()
                } label: {
                    Image(systemName: inspectorCollapsed ? "sidebar.right" : "sidebar.right")
                }
                .buttonStyle(.bordered)
                .help(inspectorCollapsed ? "인스펙터 열기" : "인스펙터 접기")
                .accessibilityIdentifier("beginner-toggle-chart-inspector")
            }
        }
        .padding(.horizontal, compact ? 12 : 16)
        .frame(minHeight: 64)
        .background(BeginnerPalette.surfaceRaised.opacity(0.82))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-chart-toolbar")
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

    @ViewBuilder
    private var crashSignalCard: some View {
        if assetClass == .stock, selectedSession == "KR", let item = model.watchlistSignal(for: selectedSymbol) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("장중 급락반등")
                            .font(.headline)
                        Text(item.signal.detail)
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    BeginnerStatusBadge(item.signal.label, color: crashSignalColor(item.signal.stage))
                    BeginnerStatusBadge("검증 전", color: BeginnerPalette.muted)
                    BeginnerStatusBadge(item.signal.marketContext.label, color: item.signal.marketContext.status == "weak" ? BeginnerPalette.amber : BeginnerPalette.blue)
                }

                if let plan = item.signal.exitPlan {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                        crashPlanTile("분석 기준가", value: beginnerPrice(plan.entryPrice, currency: item.currency), detail: "확인봉 종가 · 주문 미전송")
                        crashPlanTile("손절·무효화", value: beginnerPrice(plan.stopPrice, currency: item.currency), detail: "확정 5분봉 구조 이탈 · 자동 주문 아님")
                        crashPlanTile("1차 익절 50%", value: beginnerPrice(plan.firstTakeProfit, currency: item.currency), detail: plan.firstTargetBasis == "near-resistance" ? "가까운 저항" : "1R")
                        crashPlanTile("2차 익절 50%", value: beginnerPrice(plan.secondTakeProfit, currency: item.currency), detail: "2R · 예상 손익비 \(plan.rewardRisk.formatted(.number.precision(.fractionLength(1))))")
                    }
                }

                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                        .foregroundStyle(BeginnerPalette.blue)
                    Text((item.signal.reasons + item.signal.blockers).joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Toss REST 확정 5분봉 · \(item.quoteAt.map(beginnerTimestamp) ?? "시각 확인 불가") · 분석·알림 전용")
                    .font(.caption2)
                    .foregroundStyle(item.stale ? BeginnerPalette.red : BeginnerPalette.muted)
            }
            .padding(14)
            .background(BeginnerPalette.surfaceRaised, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(crashSignalColor(item.signal.stage).opacity(0.45)) }
            .accessibilityIdentifier("beginner-crash-signal-card")
        }
    }

    private func crashPlanTile(_ title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(BeginnerPalette.muted)
            Text(value).font(.system(size: 16, weight: .bold, design: .rounded))
            Text(detail).font(.caption2).foregroundStyle(BeginnerPalette.muted)
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 8))
    }

    private func crashSignalColor(_ stage: String) -> Color {
        switch stage {
        case "entry-ready": return BeginnerPalette.green
        case "panic-watch", "insufficient-reward": return BeginnerPalette.amber
        case "invalidated", "expired": return BeginnerPalette.red
        default: return BeginnerPalette.muted
        }
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
                        Text(metadataLine)
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
                            entryGuide: parsedOrderNumber(orderEntryPrice),
                            takeProfitGuide: takeProfitEnabled ? parsedOrderNumber(takeProfitPrice) : nil,
                            stopLossGuide: stopLossEnabled ? parsedOrderNumber(stopLossPrice) : nil,
                            resetToken: chartResetToken,
                            reloadToken: chartReloadToken
                        ),
                        selectedSignalText: $selectedChartSignal,
                        chartError: $chartError
                    )
                    .accessibilityHidden(true)
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
                .frame(minHeight: showRSI ? 400 : 340, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10).stroke(BeginnerPalette.line)
                }
                .accessibilityLabel("\(selectedChartTimeframe.title) 가격 차트. \(metadataLine)")
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
        case .order:
            orderContent
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

    private var selectedHorizonPlan: AnalysisHorizonPlan? {
        workspaceAnalysis?.horizonPlans.first { plan in
            switch (selectedHorizon, plan.horizon) {
            case (.day, .day), (.swing, .swing): return true
            default: return false
            }
        }
    }

    private var orderContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            BeginnerSurface {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("매수·청산 계획")
                                .font(.headline)
                            Text("토글을 끄면 일반 매수만 실행합니다.")
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        Spacer()
                        BeginnerStatusBadge("\(selectedHorizon.title) 지정가", color: BeginnerPalette.blue)
                    }

                    Picker("주문 목적", selection: $orderPurpose) {
                        ForEach(BeginnerOrderPurpose.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("beginner-order-purpose")

                    Picker("실행 계좌", selection: $orderMode) {
                        Text(BeginnerOrderMode.paper.title).tag(BeginnerOrderMode.paper)
                        Text(BeginnerOrderMode.tossLive.title)
                            .tag(BeginnerOrderMode.tossLive)
                            .disabled(assetClass == .crypto)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("beginner-order-mode")

                    if assetClass == .crypto {
                        Label("코인은 이번 버전에서 모의 자동 청산만 제공합니다.", systemImage: "lock.shield")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.amber)
                    } else if orderMode == .tossLive {
                        Label("현재 설치본은 서명 identity가 없어 실제 제출이 잠겨 있습니다.", systemImage: "lock.fill")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.red)
                    }

                    LabeledContent("수량") {
                        TextField("1", text: $orderQuantity)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 128)
                            .accessibilityIdentifier("beginner-order-quantity")
                    }
                    if orderPurpose == .newPosition {
                        LabeledContent("진입 지정가") {
                            TextField(planCurrency, text: $orderEntryPrice)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 128)
                                .accessibilityIdentifier("beginner-order-entry-price")
                        }
                        if orderMode == .tossLive && (takeProfitEnabled != stopLossEnabled) {
                            Text("OTO는 진입가 도달 시 매수하고, 체결 후 선택한 청산 1개를 감시합니다.")
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                    }

                    Divider().overlay(BeginnerPalette.line)
                    exitToggle(
                        title: "익절",
                        subtitle: "목표가 이상에서 매도",
                        isOn: $takeProfitEnabled,
                        price: $takeProfitPrice,
                        identifier: "take-profit",
                        color: BeginnerPalette.green
                    )
                    Divider().overlay(BeginnerPalette.line)
                    exitToggle(
                        title: "손절",
                        subtitle: "무효화가 이하에서 매도",
                        isOn: $stopLossEnabled,
                        price: $stopLossPrice,
                        identifier: "stop-loss",
                        color: BeginnerPalette.red
                    )
                    if stopLossEnabled {
                        LabeledContent("손절 지정가") {
                            TextField("트리거 한 호가 아래", text: $stopLossOrderPrice)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 160)
                                .accessibilityIdentifier("beginner-stop-loss-order-price")
                        }
                        Text("지정가 손절은 급락 시 미체결될 수 있습니다.")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.amber)
                    }

                    LabeledContent("만료일") {
                        TextField("YYYY-MM-DD", text: $orderExpiryDate)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 128)
                            .accessibilityIdentifier("beginner-order-expiry")
                    }

                    HStack {
                        Button("분석값 채우기", action: applyAnalysisValuesToOrder)
                            .buttonStyle(.bordered)
                            .disabled(selectedHorizonPlan == nil)
                            .accessibilityIdentifier("beginner-apply-analysis-to-order")
                        Spacer()
                        Button("사전검증") { precheckOrder() }
                            .buttonStyle(.borderedProminent)
                            .tint(BeginnerPalette.blue)
                            .accessibilityIdentifier("beginner-managed-order-precheck")
                    }

                    if let orderError {
                        Text(orderError)
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.red)
                    }
                }
            }

            if let precheck = matchingManagedPrecheck {
                BeginnerSurface {
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Text("주문 미리보기")
                                .font(.headline)
                            Spacer()
                            BeginnerStatusBadge(precheck.submitReady ? "RiskCheck 통과" : "차단", color: precheck.submitReady ? BeginnerPalette.green : BeginnerPalette.red)
                        }
                        Text(precheck.confirmationText)
                            .font(.system(.caption, design: .monospaced).weight(.semibold))
                            .textSelection(.enabled)
                        ForEach(precheck.record.riskCheck.blockers, id: \.self) { blocker in
                            Label(blocker, systemImage: "xmark.octagon.fill")
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.red)
                        }
                        ForEach(precheck.record.riskCheck.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption2)
                                .foregroundStyle(BeginnerPalette.amber)
                        }
                        if orderMode == .tossLive {
                            TextField("주문 요약 입력", text: $liveConfirmation)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("beginner-managed-live-confirmation")
                        }
                        Button(submitButtonTitle(precheck)) { submitOrder(precheck) }
                            .buttonStyle(.borderedProminent)
                            .tint(orderMode == .tossLive ? BeginnerPalette.red : BeginnerPalette.green)
                            .foregroundStyle(BeginnerPalette.backgroundDeep)
                            .frame(maxWidth: .infinity)
                            .disabled(!canSubmit(precheck))
                            .accessibilityIdentifier("beginner-managed-order-submit")
                    }
                }
            }

            if !matchingManagedPlans.isEmpty {
                BeginnerSurface {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("진행 중·최근 계획")
                            .font(.headline)
                        ForEach(matchingManagedPlans.prefix(4)) { record in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(managedPlanColor(record.status))
                                    .frame(width: 7, height: 7)
                                    .padding(.top, 5)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(managedPlanTitle(record))
                                        .font(.caption.weight(.semibold))
                                    Text(record.error ?? "\(record.plan.mode) · \(record.status)")
                                        .font(.caption2)
                                        .foregroundStyle(BeginnerPalette.muted)
                                }
                                Spacer()
                                if record.status == "watching-exit" || record.status == "risk_checked" {
                                    Button("취소") { Task { await model.cancelManagedTradePlan(record.id) } }
                                        .buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
                .accessibilityIdentifier("beginner-managed-plan-list")
            }

            Text(model.managedTradePlanMessage)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-order-inspector")
    }

    private func exitToggle(
        title: String,
        subtitle: String,
        isOn: Binding<Bool>,
        price: Binding<String>,
        identifier: String,
        color: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: isOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(subtitle).font(.caption2).foregroundStyle(BeginnerPalette.muted)
                }
            }
            .tint(color)
            .accessibilityIdentifier("beginner-\(identifier)-toggle")
            if isOn.wrappedValue {
                TextField(planCurrency, text: price)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("beginner-\(identifier)-price")
            }
        }
    }

    private var matchingManagedPrecheck: ManagedTradePlanPrecheckResponse? {
        guard let value = model.latestManagedTradePrecheck,
              beginnerCanonicalSymbol(value.record.plan.symbol) == beginnerCanonicalSymbol(selectedSymbol),
              value.record.plan.purpose == orderPurpose.contractValue,
              value.record.plan.mode == orderMode.contractValue,
              value.record.plan.horizon == selectedHorizon.rawValue,
              value.record.plan.expiryDate == orderExpiryDate,
              sameOrderValue(value.record.plan.quantity, parsedOrderNumber(orderQuantity)),
              sameOrderValue(
                value.record.plan.referencePrice,
                orderPurpose == .newPosition
                    ? parsedOrderNumber(orderEntryPrice)
                    : selectedHorizonPlan?.entryPrice ?? selectedHorizonPlan?.currentPrice
              ),
              sameOrderValue(value.record.plan.entry?.limitPrice, orderPurpose == .newPosition ? parsedOrderNumber(orderEntryPrice) : nil),
              value.record.plan.exits.takeProfit.enabled == takeProfitEnabled,
              value.record.plan.exits.stopLoss.enabled == stopLossEnabled,
              sameOrderValue(value.record.plan.exits.takeProfit.triggerPrice, takeProfitEnabled ? parsedOrderNumber(takeProfitPrice) : nil),
              sameOrderValue(value.record.plan.exits.stopLoss.triggerPrice, stopLossEnabled ? parsedOrderNumber(stopLossPrice) : nil) else {
            return nil
        }
        return value
    }

    private func sameOrderValue(_ lhs: Double?, _ rhs: Double?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (left?, right?): return abs(left - right) < 0.000_001
        default: return false
        }
    }

    private var matchingManagedPlans: [ManagedTradePlanRecordView] {
        model.managedTradePlans.filter {
            beginnerCanonicalSymbol($0.plan.symbol) == beginnerCanonicalSymbol(selectedSymbol)
        }
    }

    private func parsedOrderNumber(_ text: String) -> Double? {
        let normalized = text.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Double(normalized), value.isFinite, value > 0 else { return nil }
        return value
    }

    private func applyAnalysisValuesToOrder() {
        guard let plan = selectedHorizonPlan else { return }
        if let value = plan.entryPrice ?? plan.currentPrice ?? analysis?.latestClose {
            orderEntryPrice = value.formatted(.number.precision(.fractionLength(0...4)))
        }
        if let value = plan.takeProfits.first?.price {
            takeProfitPrice = value.formatted(.number.precision(.fractionLength(0...4)))
        }
        if let value = plan.stop?.price {
            stopLossPrice = value.formatted(.number.precision(.fractionLength(0...4)))
            stopLossOrderPrice = ""
        }
        orderError = nil
        selectedTab = .order
    }

    private func precheckOrder() {
        guard let quantity = parsedOrderNumber(orderQuantity) else {
            orderError = "0보다 큰 수량을 입력하세요."
            return
        }
        let entryPrice = parsedOrderNumber(orderEntryPrice)
        if orderPurpose == .newPosition && entryPrice == nil {
            orderError = "진입 지정가를 입력하세요."
            return
        }
        orderError = nil
        liveConfirmation = ""
        let input = ManagedTradePlanInput(
            symbol: selectedSymbol,
            assetClass: assetClass.rawValue,
            currency: planCurrency,
            purpose: orderPurpose.contractValue,
            mode: orderMode.contractValue,
            horizon: selectedHorizon.rawValue,
            quantity: quantity,
            entryPrice: entryPrice ?? selectedHorizonPlan?.entryPrice ?? selectedHorizonPlan?.currentPrice,
            takeProfitEnabled: takeProfitEnabled,
            takeProfitPrice: parsedOrderNumber(takeProfitPrice),
            stopLossEnabled: stopLossEnabled,
            stopLossPrice: parsedOrderNumber(stopLossPrice),
            stopLossOrderPrice: parsedOrderNumber(stopLossOrderPrice),
            expiryDate: orderExpiryDate,
            accountSeq: model.brokerAccountPreference?.accountSeq,
            sourceAnalysisId: workspaceAnalysis?.generatedAt,
            session: selectedSession,
            market: assetClass == .crypto ? "CRYPTO" : selectedSession == "KR" ? "KOSPI" : "US"
        )
        Task { resultPreview = await model.precheckManagedTradePlan(input) }
    }

    private func canSubmit(_ precheck: ManagedTradePlanPrecheckResponse) -> Bool {
        guard precheck.submitReady else { return false }
        if precheck.record.plan.mode == BeginnerOrderMode.tossLive.contractValue {
            return precheck.liveSubmissionMode != "disabled" && liveConfirmation == precheck.confirmationText
        }
        return true
    }

    private func submitButtonTitle(_ precheck: ManagedTradePlanPrecheckResponse) -> String {
        if precheck.record.plan.mode == BeginnerOrderMode.tossLive.contractValue && precheck.liveSubmissionMode == "disabled" {
            return "실주문 잠금 · 제출 불가"
        }
        return precheck.record.plan.mode == BeginnerOrderMode.paper.contractValue ? "모의 매수·감시 시작" : "Toss 주문 제출"
    }

    private func submitOrder(_ precheck: ManagedTradePlanPrecheckResponse) {
        Task {
            resultPreview = await model.submitManagedTradePlan(
                live: precheck.record.plan.mode == BeginnerOrderMode.tossLive.contractValue,
                confirmation: liveConfirmation
            )
        }
    }

    private func managedPlanTitle(_ record: ManagedTradePlanRecordView) -> String {
        let exits = [
            record.plan.exits.takeProfit.enabled ? "익절" : nil,
            record.plan.exits.stopLoss.enabled ? "손절" : nil,
        ].compactMap { $0 }.joined(separator: "+")
        return "\(record.plan.purpose == "new-position" ? "매수" : "보유분") · \(exits.isEmpty ? "청산 없음" : exits)"
    }

    private func managedPlanColor(_ status: String) -> Color {
        switch status {
        case "completed": return BeginnerPalette.green
        case "rejected", "unknown": return BeginnerPalette.red
        case "watching-entry", "watching-exit": return BeginnerPalette.blue
        default: return BeginnerPalette.muted
        }
    }

    private static func defaultExpiryDate(days: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        return date.formatted(.iso8601.year().month().day().dateSeparator(.dash))
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

                    Button("분석값을 주문에 채우기") {
                        applyAnalysisValuesToOrder()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BeginnerPalette.blue)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .disabled(selectedHorizonPlan == nil)
                    .accessibilityIdentifier("beginner-analysis-apply-order")
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

            BeginnerSurface {
                SignalStackPanel(analysis: analysis)
            }
            .accessibilityIdentifier("beginner-signal-panel")
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

    private var toolbarSourceLabel: String {
        switch workspaceAnalysis?.dataSource {
        case .toss: return "Toss"
        case .upbit: return "Upbit"
        case .yahoo: return "Yahoo"
        case .fixture: return "FIXTURE"
        case .auto: return "AUTO"
        case let .unknown(value): return value.uppercased()
        case nil: return "출처 확인"
        }
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
    @State private var selectedPlaybookId = ""

    private var plan: AnalysisHorizonPlan? {
        workspaceAnalysis?.horizonPlans.first { item in
            switch (horizon, item.horizon) {
            case (.day, .day), (.swing, .swing): return true
            default: return false
            }
        }
    }

    private var playbookHorizon: String {
        switch horizon {
        case .day: "short-hold"
        case .swing: "swing"
        }
    }

    private var calibratedPlaybooks: [AnalysisTradePlaybookPlan] {
        guard
            assetClass == .stock,
            workspaceAnalysis?.contractVersion == 2,
            workspaceAnalysis?.isBrokerStopEligible == false,
            workspaceAnalysis?.orderSubmissionAttempted == false,
            let signalSet = workspaceAnalysis?.tradeSignalSet,
            signalSet.contractVersion == 2,
            !signalSet.isBrokerStopEligible,
            !signalSet.orderSubmissionAttempted
        else { return [] }
        return signalSet.plans.filter {
            $0.horizon == playbookHorizon &&
                $0.isCalibratedDisplayEligible
        }
    }

    private var playbookConflict: AnalysisTradePlaybookConflict? {
        let eligibleIds = Set(calibratedPlaybooks.map(\.id))
        return workspaceAnalysis?.tradeSignalSet?.conflicts.first {
            $0.horizon == playbookHorizon &&
                $0.playbookIds.filter(eligibleIds.contains).count > 1
        }
    }

    private var selectedPlaybook: AnalysisTradePlaybookPlan? {
        if let explicit = calibratedPlaybooks.first(where: { $0.id == selectedPlaybookId }) {
            return explicit
        }
        return calibratedPlaybooks.count == 1 && playbookConflict == nil
            ? calibratedPlaybooks.first
            : nil
    }

    private var currency: String {
        plan?.basis?.currency ?? workspaceAnalysis?.currency ?? analysis?.currency ?? "KRW"
    }

    private var isActionable: Bool {
        if let selectedPlaybook {
            return selectedPlaybook.action == "entry-ready"
        }
        if playbookConflict != nil {
            return false
        }
        return plan?.status == .actionable
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
                    if selectedPlaybook != nil {
                        BeginnerStatusBadge("시간순 OOS", color: BeginnerPalette.blue)
                    }
                }
            }

            if calibratedPlaybooks.count > 1 {
                Picker("전략 방식", selection: $selectedPlaybookId) {
                    Text("선택 필요").tag("")
                    ForEach(calibratedPlaybooks, id: \.id) { item in
                        Text(item.label).tag(item.id)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("beginner-playbook-picker-\(horizon.rawValue)")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                planTile(
                    title: entryPriceTitle,
                    value: beginnerPrice(selectedPlaybook?.riskPlan.entryPrice ?? plan?.entryPrice ?? analysis?.latestClose, currency: currency),
                    detail: selectedPlaybook == nil && plan?.entryPrice == nil ? "분석 후 표시" : "계산 기준 · 주문 미전송"
                )
                planTile(
                    title: "손절·무효화",
                    value: beginnerPrice(selectedPlaybook?.riskPlan.structureInvalidationPrice ?? plan?.stop?.price, currency: currency),
                    detail: stopDetail
                )
                planTile(
                    title: "1차 익절",
                    value: beginnerPrice(selectedPlaybook?.riskPlan.targets.first?.price ?? plan?.takeProfits.first?.price, currency: currency),
                    detail: takeProfitDetail(at: 0)
                )
                planTile(
                    title: "2차 익절",
                    value: beginnerPrice(selectedPlaybook?.riskPlan.targets.dropFirst().first?.price ?? plan?.takeProfits.dropFirst().first?.price, currency: currency),
                    detail: takeProfitDetail(at: 1)
                )
                planTile(
                    title: "추적 청산",
                    value: beginnerPrice(selectedPlaybook?.riskPlan.trailingExit?.price ?? plan?.trailingExit?.price, currency: currency),
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

            if let selectedPlaybook {
                DisclosureGroup("시간순 검증 근거") {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("표본 \(selectedPlaybook.calibration.sampleSize)건 · holdout \(selectedPlaybook.calibration.holdoutSampleSize)건")
                        if let averageNetR = selectedPlaybook.calibration.averageNetR {
                            Text("비용 후 평균 \(averageNetR.formatted(.number.precision(.fractionLength(2))))R")
                        }
                        if let targetBeforeStopRate = selectedPlaybook.calibration.targetBeforeStopRate {
                            Text("결과 정의 · 최초 손절 전 목표 선도달률 \(targetBeforeStopRate.formatted(.percent.precision(.fractionLength(1))))")
                        }
                        if let lower = selectedPlaybook.calibration.confidence95?.lower,
                           let upper = selectedPlaybook.calibration.confidence95?.upper {
                            Text("95% 구간 \(lower.formatted(.number.precision(.fractionLength(2))))R ~ \(upper.formatted(.number.precision(.fractionLength(2))))R")
                        }
                        if let costModel = selectedPlaybook.calibration.costModel {
                            Text("비용 포함 · \(costModel)")
                        }
                        if let validationStart = selectedPlaybook.calibration.validationStart,
                           let validationEnd = selectedPlaybook.calibration.validationEnd {
                            Text("검증 기간 · \(validationStart) ~ \(validationEnd)")
                        }
                        Text(selectedPlaybook.calibration.note)
                    }
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .padding(.top, 8)
                }
                .accessibilityIdentifier("beginner-playbook-evidence-\(horizon.rawValue)")
            }
        }
        .id(horizon)
        .accessibilityIdentifier(horizon.accessibilityIdentifier)
        .onAppear {
            if selectedPlaybookId.isEmpty && calibratedPlaybooks.count == 1 && playbookConflict == nil {
                selectedPlaybookId = calibratedPlaybooks.first?.id ?? ""
            }
        }
        .onChange(of: calibratedPlaybooks.map(\.id)) { _, ids in
            if !ids.contains(selectedPlaybookId) {
                selectedPlaybookId = ids.count == 1 && playbookConflict == nil
                    ? ids.first ?? ""
                    : ""
            }
        }
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
        if let selectedPlaybook {
            return selectedPlaybook.reasons.first ?? selectedPlaybook.label
        }
        if let playbookConflict {
            return playbookConflict.reason
        }
        if let reason = plan?.reasons.first, !reason.isEmpty {
            return reason
        }
        switch horizon {
        case .day:
            return assetClass == .crypto
                ? "1~3일 단기는 일봉 결론을 그대로 재사용하지 않습니다. 4시간 위험 필터와 1시간 진입 조건이 일치할 때만 손절·익절선을 계산합니다."
                : "주식 1~3일 단기는 정규장 일봉 위험 필터와 확정 1시간봉 진입 조건을 결합합니다. 장중 미완성 봉은 확정 신호에서 제외합니다."
        case .swing:
            return assetClass == .crypto
                ? "코인 스윙은 일봉 추세를 기준으로 4시간 진입과 1시간 재확인을 결합합니다. 부분 봉은 확정 신호에서 제외합니다."
                : "주식 스윙은 일봉 방향을 기준으로 확정 1시간봉 진입 조건을 결합합니다. 4시간봉은 정규장 길이 때문에 필수 조건으로 사용하지 않습니다."
        }
    }

    private func takeProfitDetail(at index: Int) -> String {
        if let targets = selectedPlaybook?.riskPlan.targets, targets.indices.contains(index) {
            let target = targets[index]
            return "\(target.basis) · \(Int(target.allocationPct.rounded()))% 청산"
        }
        guard let targets = plan?.takeProfits, targets.indices.contains(index) else {
            switch horizon {
            case .day: return index == 0 ? "1R와 가까운 저항 비교" : "2R 기준"
            case .swing: return index == 0 ? "1R와 일봉 저항 비교" : "2R 기준"
            }
        }
        let target = targets[index]
        let allocation = target.allocationPct.map { " · \(Int($0.rounded()))% 청산" } ?? ""
        return "\(target.basis ?? "계산 근거 확인")\(allocation)"
    }

    private var stopDetail: String {
        if let riskPlan = selectedPlaybook?.riskPlan {
            let trigger = localizedTrigger(riskPlan.stopTrigger)
            return "\(trigger ?? "구조 무효선") · 검증된 플레이북 기준 · 자동 주문 아님"
        }
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
        }
    }

    private var trailingExitDetail: String {
        if let trailingExit = selectedPlaybook?.riskPlan.trailingExit {
            return "\(trailingExit.basis) · \(Int(trailingExit.allocationPct.rounded()))% 청산"
        }
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
        }
    }

    private var hasCalculatedPrices: Bool {
        if let riskPlan = selectedPlaybook?.riskPlan {
            return riskPlan.structureInvalidationPrice != nil &&
                (!riskPlan.targets.isEmpty || riskPlan.trailingExit != nil)
        }
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
        if let selectedPlaybook {
            return switch selectedPlaybook.action {
            case "entry-ready": "진입 조건 충족"
            case "watch": "관찰"
            case "wait": "진입 대기"
            default: "검증 데이터 대기"
            }
        }
        if playbookConflict != nil {
            return "방식 선택 필요"
        }
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
        if let selectedPlaybook {
            return switch selectedPlaybook.action {
            case "entry-ready": BeginnerPalette.green
            case "watch", "wait": BeginnerPalette.amber
            default: BeginnerPalette.muted
            }
        }
        if playbookConflict != nil {
            return BeginnerPalette.amber
        }
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
        if let selectedPlaybook {
            let costModel = selectedPlaybook.calibration.costModel ?? "비용 모델 확인"
            return "\(selectedPlaybook.label) · \(costModel) · 시간순 OOS 검증 기준입니다. 분석 결과는 주문으로 자동 전송되지 않습니다."
        }
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
        }
    }
}
