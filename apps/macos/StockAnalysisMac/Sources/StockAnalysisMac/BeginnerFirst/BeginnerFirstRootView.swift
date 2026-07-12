import AppKit
import SwiftUI
import StockAnalysisMacCore

struct BeginnerFirstRootView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("beginner.destination") private var destinationRawValue = BeginnerDestination.chart.rawValue
    @AppStorage("beginner.asset-class") private var assetClassRawValue = BeginnerAssetClass.stock.rawValue
    @AppStorage("beginner.stock-market") private var stockMarketRawValue = BeginnerStockMarket.korea.rawValue
    @AppStorage("beginner.selected-symbol") private var selectedSymbol = "005930.KS"

    @State private var selectedAnalysisTab: BeginnerAnalysisTab = .analysis
    @State private var selectedHorizon: BeginnerTradeHorizon = .day
    @State private var selectedChartTimeframe: BeginnerChartTimeframe = .oneDay
    @State private var resultPreview = ""
    @State private var isLoading = false
    @State private var showingOrderDrawer = false
    @State private var showingLiveOrderDrawer = false
    @State private var activeSheet: BeginnerSettingsSheet?
    @State private var selectedConnectionProvider: BeginnerAPIConnectionProvider = .toss
    @State private var workspaceRevision = UUID()
    @State private var analysisGeneration = 0
    @State private var selectedSymbolName: String?

    private var destination: BeginnerDestination {
        get { BeginnerDestination(rawValue: destinationRawValue) ?? .chart }
        nonmutating set { destinationRawValue = newValue.rawValue }
    }

    private var assetClass: BeginnerAssetClass {
        get { BeginnerAssetClass(rawValue: assetClassRawValue) ?? .stock }
        nonmutating set { assetClassRawValue = newValue.rawValue }
    }

    private var stockMarket: BeginnerStockMarket {
        get { BeginnerStockMarket(rawValue: stockMarketRawValue) ?? .korea }
        nonmutating set { stockMarketRawValue = newValue.rawValue }
    }

    private var selectedSession: String {
        assetClass == .crypto ? "KR" : stockMarket.session
    }

    private var analysis: MarketAnalysisSnapshot? {
        guard let latest = model.latestMarketAnalysis,
              beginnerCanonicalSymbol(latest.symbol) == beginnerCanonicalSymbol(selectedSymbol) else {
            return nil
        }
        return latest
    }

    var body: some View {
        GeometryReader { proxy in
            let compactSidebar = proxy.size.width < 1_150
            ZStack(alignment: .trailing) {
                HStack(spacing: 0) {
                    BeginnerSidebar(
                        destination: Binding(
                            get: { destination },
                            set: { selectDestination($0) }
                        ),
                        compact: compactSidebar
                    )
                    .frame(width: compactSidebar ? 78 : 210)

                    VStack(spacing: 0) {
                        BeginnerTopBar(
                            assetClass: Binding(
                                get: { assetClass },
                                set: { changeAssetClass($0) }
                            ),
                            stockMarket: Binding(
                                get: { stockMarket },
                                set: { changeStockMarket($0) }
                            ),
                            selectedSymbol: $selectedSymbol,
                            querySession: assetClass == .stock ? stockMarket.session : "US",
                            healthOK: model.health?.ok == true,
                            lastUpdated: model.lastUpdated,
                            isLoading: isLoading,
                            onSymbolResolved: { selectedSymbolName = $0 },
                            onAnalyze: { Task { await runAnalysis() } }
                        )

                        workspace(compact: proxy.size.width < 1_230)
                            .id(workspaceRevision)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .accessibilityHidden(showingOrderDrawer || showingLiveOrderDrawer || !model.settings.hasCompletedOnboarding)

                if showingOrderDrawer {
                    Color.black.opacity(0.34)
                        .ignoresSafeArea()
                        .onTapGesture { showingOrderDrawer = false }
                        .accessibilityHidden(true)

                    BeginnerPaperOrderDrawer(
                        selectedSymbol: selectedSymbol,
                        selectedSession: selectedSession,
                        resultPreview: $resultPreview,
                        isLoading: $isLoading,
                        onClose: { showingOrderDrawer = false },
                        onOpenStrategy: {
                            showingOrderDrawer = false
                            destination = .strategy
                        },
                        onOpenLiveOrder: {
                            showingOrderDrawer = false
                            showingLiveOrderDrawer = true
                        }
                    )
                    .frame(width: min(max(proxy.size.width * 0.38, 410), 490))
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(3)
                    .accessibilityHidden(!model.settings.hasCompletedOnboarding)
                }

                if showingLiveOrderDrawer {
                    Color.black.opacity(0.34)
                        .ignoresSafeArea()
                        .onTapGesture { showingLiveOrderDrawer = false }
                        .accessibilityHidden(true)

                    BeginnerLiveOrderDrawer(
                        selectedSymbol: selectedSymbol,
                        selectedSession: selectedSession,
                        resultPreview: $resultPreview,
                        isLoading: $isLoading,
                        onClose: { showingLiveOrderDrawer = false }
                    )
                    .frame(width: min(max(proxy.size.width * 0.40, 430), 520))
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(4)
                    .accessibilityHidden(!model.settings.hasCompletedOnboarding)
                }

                if !model.settings.hasCompletedOnboarding {
                    BeginnerOnboardingView(
                        isLoading: isLoading,
                        onStartExample: { Task { await startExample() } },
                        onConnectAPI: {
                            model.completeOnboarding()
                            openConnectionManagement(provider: .toss)
                        },
                        onSkip: {
                            model.completeOnboarding()
                            destination = .chart
                            Task { await runAnalysis() }
                        }
                    )
                    .transition(.opacity)
                    .zIndex(5)
                }
            }
            .animation(.easeInOut(duration: 0.18), value: showingOrderDrawer)
            .animation(.easeInOut(duration: 0.18), value: showingLiveOrderDrawer)
        }
        .frame(minWidth: 1_024, minHeight: 720)
        .background(BeginnerPalette.backgroundDeep)
        .foregroundStyle(BeginnerPalette.text)
        .sheet(item: $activeSheet) { sheet in
            sheetContent(sheet)
        }
        .task(id: model.health?.ok == true) {
            guard model.settings.hasCompletedOnboarding,
                  model.health?.ok == true,
                  analysis == nil,
                  !isLoading else {
                return
            }
            await runAnalysis()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            model.stopSidecar()
        }
        .onReceive(NotificationCenter.default.publisher(for: .openBeginnerSupportSelfTest)) { _ in
            activeSheet = .selfTest
        }
        .onReceive(NotificationCenter.default.publisher(for: .openBeginnerSupportLog)) { _ in
            model.refreshSidecarLogTail()
            activeSheet = .sidecarLog
        }
    }

    @ViewBuilder
    private func workspace(compact: Bool) -> some View {
        switch destination {
        case .chart:
            BeginnerChartWorkspace(
                selectedSymbol: selectedSymbol,
                selectedSession: selectedSession,
                assetClass: assetClass,
                analysis: analysis,
                selectedTab: $selectedAnalysisTab,
                selectedHorizon: $selectedHorizon,
                selectedChartTimeframe: $selectedChartTimeframe,
                resultPreview: $resultPreview,
                isLoading: isLoading,
                compact: compact,
                onAnalyze: { entryPrice, planMode in
                    Task { await runAnalysis(entryPrice: entryPrice, planMode: planMode) }
                },
                onChartTimeframeChanged: { timeframe in
                    Task { await refreshChartTimeframe(timeframe) }
                },
                onAddToWatchlist: { Task { await addCurrentToWatchlist() } },
                onOpenOrder: { showingOrderDrawer = true },
                onRefreshNews: { Task { await refreshNewsAndSentiment() } }
            )
        case .watchlist:
            BeginnerWatchlistWorkspace(
                onSelect: { item in selectWatchlistItem(item) },
                onAddCurrent: { Task { await addCurrentToWatchlist() } }
            )
        case .assets:
            BeginnerAssetsWorkspace(
                onOpenAPIConnection: { provider in
                    openConnectionManagement(provider: provider)
                },
                onSelectRealPosition: { position in
                    selectRealPosition(position)
                }
            )
        case .strategy:
            BeginnerStrategyWorkspace(
                selectedSymbol: selectedSymbol,
                selectedSession: selectedSession,
                assetClass: assetClass,
                analysis: analysis,
                compact: compact,
                onRefreshQuote: { Task { await runAnalysis() } },
                onOpenAutomation: { destination = .automation }
            )
        case .automation:
            BeginnerAutomationWorkspace(
                selectedSymbol: selectedSymbol,
                selectedSession: selectedSession,
                resultPreview: $resultPreview,
                isLoading: $isLoading,
                onEditStrategy: { config in
                    model.requestedStrategyConfigId = config.id
                    destination = .strategy
                }
            )
        case .settings:
            BeginnerSettingsWorkspace(
                onOpen: { activeSheet = $0 },
                selectedConnectionProvider: $selectedConnectionProvider
            )
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: BeginnerSettingsSheet) -> some View {
        switch sheet {
        case .strategy:
            StrategySettingsSheet(selectedSymbol: selectedSymbol, selectedSession: selectedSession)
                .environmentObject(model)
        case .selfTest:
            AppSelfTestSheet(
                openSidecarLog: {
                    activeSheet = nil
                    DispatchQueue.main.async {
                        model.refreshSidecarLogTail()
                        activeSheet = .sidecarLog
                    }
                }
            )
            .environmentObject(model)
        case .distribution:
            DistributionSheet()
                .environmentObject(model)
        case .sidecarLog:
            SidecarLogSheet()
                .environmentObject(model)
        }
    }

    private func selectDestination(_ next: BeginnerDestination) {
        destination = next
        workspaceRevision = UUID()
    }

    private func openConnectionManagement(provider: BeginnerAPIConnectionProvider) {
        selectedConnectionProvider = provider
        selectDestination(.settings)
    }

    private func changeAssetClass(_ next: BeginnerAssetClass) {
        guard next != assetClass else { return }
        assetClass = next
        destination = .chart
        if next == .crypto {
            selectedSymbol = "KRW-BTC"
        } else {
            selectedSymbol = stockMarket == .korea ? "005930.KS" : "AAPL"
        }
        selectedSymbolName = nil
        Task { await runAnalysis() }
    }

    private func changeStockMarket(_ next: BeginnerStockMarket) {
        guard next != stockMarket else { return }
        stockMarket = next
        guard assetClass == .stock else { return }
        selectedSymbol = next == .korea ? "005930.KS" : "AAPL"
        selectedSymbolName = nil
        destination = .chart
        Task { await runAnalysis() }
    }

    private func startExample() async {
        assetClass = .stock
        stockMarket = .korea
        selectedSymbol = "005930.KS"
        selectedSymbolName = "삼성전자 · Samsung Electronics"
        destination = .chart
        model.completeOnboarding()
        await runAnalysis()
    }

    private func runAnalysis(
        entryPrice: Double? = nil,
        planMode: AnalysisHoldingPlanMode = .newEntry
    ) async {
        let normalized = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        selectedSymbol = normalized.isEmpty
            ? (assetClass == .crypto ? "KRW-BTC" : stockMarket == .korea ? "005930.KS" : "AAPL")
            : normalized
        analysisGeneration += 1
        let requestGeneration = analysisGeneration
        isLoading = true
        resultPreview = "\(selectedSymbol) 데이터를 확인하고 있습니다."
        defer {
            if requestGeneration == analysisGeneration {
                isLoading = false
            }
        }

        guard await ensureEngineReady() else {
            if requestGeneration == analysisGeneration {
                resultPreview = "로컬 엔진에 연결하지 못했습니다. 설정에서 엔진 상태와 로그를 확인하세요."
            }
            return
        }

        let result = await model.refreshWorkspaceAnalysis(
            symbol: selectedSymbol,
            assetClass: assetClass == .crypto ? .crypto : .stock,
            session: assetClass == .crypto ? "CRYPTO" : selectedSession,
            entryPrice: entryPrice,
            planMode: planMode
        )
        guard requestGeneration == analysisGeneration else { return }
        resultPreview = result
        await model.refreshChart(
            symbol: selectedSymbol,
            assetClass: assetClass == .crypto ? .crypto : .stock,
            timeframe: selectedChartTimeframe.analysisTimeframe
        )
        guard requestGeneration == analysisGeneration else { return }
        let analyzedSymbol = selectedSymbol
        let analyzedMarket = assetClass == .crypto ? "CRYPTO" : selectedSession
        Task {
            await refreshNewsAndSentiment(symbol: analyzedSymbol, market: analyzedMarket)
        }
    }

    private func ensureEngineReady() async -> Bool {
        if model.health?.ok == true { return true }
        model.startSidecar()
        for _ in 0..<12 {
            try? await Task.sleep(for: .milliseconds(500))
            await model.refreshHealth()
            if model.health?.ok == true { return true }
        }
        return false
    }

    private func refreshNewsAndSentiment(symbol: String? = nil, market: String? = nil) async {
        guard model.health?.ok == true else { return }
        await model.refreshNews()
        await model.refreshCommunitySentiment(
            symbol: symbol ?? selectedSymbol,
            market: market ?? (assetClass == .crypto ? "CRYPTO" : selectedSession)
        )
    }

    private func refreshChartTimeframe(_ timeframe: BeginnerChartTimeframe) async {
        guard await ensureEngineReady() else { return }
        await model.refreshChart(
            symbol: selectedSymbol,
            assetClass: assetClass == .crypto ? .crypto : .stock,
            timeframe: timeframe.analysisTimeframe
        )
    }

    private func addCurrentToWatchlist() async {
        let market = assetClass == .crypto ? "CRYPTO" : selectedSession
        await model.addWatchlistItem(
            symbol: selectedSymbol,
            assetClass: assetClass.rawValue,
            market: market,
            name: selectedSymbolName
        )
    }

    private func selectWatchlistItem(_ item: LocalWatchlistSummaryItem) {
        if item.assetClass == BeginnerAssetClass.crypto.rawValue {
            assetClass = .crypto
        } else {
            assetClass = .stock
            stockMarket = item.market == "KR" ? .korea : .unitedStates
        }
        selectedSymbol = item.symbol
        selectedSymbolName = item.name
        destination = .chart
        Task { await runAnalysis() }
    }

    private func selectRealPosition(_ position: RealPortfolioPositionView) {
        if position.provider == "toss" {
            assetClass = .stock
            stockMarket = position.currency == "USD" ? .unitedStates : .korea
        } else {
            assetClass = .crypto
        }
        selectedSymbol = position.symbol
        selectedSymbolName = position.name
        destination = .chart
        Task { await runAnalysis() }
    }
}

private struct BeginnerSidebar: View {
    @Binding var destination: BeginnerDestination
    let compact: Bool

    @State private var hoveredDestination: BeginnerDestination?

    private let primaryDestinations: [BeginnerDestination] = [.chart, .watchlist, .assets, .strategy, .automation]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "chart.line.uptrend.xyaxis.circle.fill")
                    .font(.system(size: 27))
                    .foregroundStyle(BeginnerPalette.green)
                if !compact {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Yong'Desk")
                            .font(.system(size: 14, weight: .bold))
                        Text("시장 판단을 한눈에")
                            .font(.system(size: 10))
                            .foregroundStyle(BeginnerPalette.muted)
                        Text("1.2.0-beta.2 · 실주문 잠금")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(BeginnerPalette.amber)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
            .padding(.horizontal, compact ? 0 : 7)

            VStack(spacing: 6) {
                ForEach(primaryDestinations) { item in
                    navigationButton(item)
                }
            }

            Spacer()

            VStack(alignment: .leading, spacing: 10) {
                if !compact {
                    Text("분석 결과는 주문이 아닙니다")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(BeginnerPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if compact {
                    Text("P")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(BeginnerPalette.green)
                        .frame(width: 32, height: 32)
                        .background(BeginnerPalette.green.opacity(0.12), in: Circle())
                        .overlay { Circle().stroke(BeginnerPalette.green.opacity(0.35)) }
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("PAPER ONLY")
                } else {
                    BeginnerStatusBadge("PAPER ONLY", color: BeginnerPalette.green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                navigationButton(.settings)
            }
        }
        .padding(.horizontal, compact ? 9 : 14)
        .padding(.vertical, 18)
        .background(BeginnerPalette.backgroundDeep.opacity(0.98))
        .overlay(alignment: .trailing) {
            Rectangle().fill(BeginnerPalette.line).frame(width: 1)
        }
    }

    private func navigationButton(_ item: BeginnerDestination) -> some View {
        Button {
            destination = item
        } label: {
            HStack(spacing: 11) {
                Image(systemName: item.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)
                if !compact {
                    Text(item.title)
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                }
            }
            .foregroundStyle(destination == item ? BeginnerPalette.green : BeginnerPalette.muted)
            .padding(.horizontal, compact ? 10 : 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: compact ? .center : .leading)
            .contentShape(RoundedRectangle(cornerRadius: 10))
            .background(Color.clear)
            .background(
                destination == item
                    ? BeginnerPalette.green.opacity(0.12)
                    : hoveredDestination == item ? BeginnerPalette.surfaceSoft.opacity(0.65) : Color.clear,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(destination == item ? BeginnerPalette.green.opacity(0.28) : Color.clear)
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
        .onHover { isHovering in
            hoveredDestination = isHovering ? item : nil
        }
        .focusable()
        .accessibilityLabel(item.title)
        .accessibilityValue(destination == item ? "선택됨" : "선택 안 됨")
        .accessibilityAddTraits(destination == item ? .isSelected : [])
        .accessibilityIdentifier(item.accessibilityIdentifier)
    }
}

private struct BeginnerTopBar: View {
    @Binding var assetClass: BeginnerAssetClass
    @Binding var stockMarket: BeginnerStockMarket
    @Binding var selectedSymbol: String
    let querySession: String
    let healthOK: Bool
    let lastUpdated: String
    let isLoading: Bool
    let onSymbolResolved: (String?) -> Void
    let onAnalyze: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Picker("자산", selection: $assetClass) {
                ForEach(BeginnerAssetClass.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 132)
            .accessibilityLabel("자산 종류")
            .accessibilityIdentifier("beginner-asset-class-picker")

            if assetClass == .stock {
                Picker("시장", selection: $stockMarket) {
                    ForEach(BeginnerStockMarket.allCases) { market in
                        Text(market.title).tag(market)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 74)
                .accessibilityLabel("주식 시장")
                .accessibilityIdentifier("beginner-stock-market-picker")
            }

            BeginnerSymbolSearch(
                selectedSymbol: $selectedSymbol,
                querySession: querySession,
                onSymbolResolved: onSymbolResolved,
                onAnalyze: onAnalyze
            )
            .frame(maxWidth: 520)

            Button {
                onAnalyze()
            } label: {
                if isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Label("분석", systemImage: "sparkles")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BeginnerPalette.green)
            .foregroundStyle(BeginnerPalette.backgroundDeep)
            .disabled(isLoading)
            .accessibilityIdentifier("beginner-analyze-button")

            Spacer(minLength: 4)

            HStack(spacing: 7) {
                Circle()
                    .fill(healthOK ? BeginnerPalette.green : BeginnerPalette.red)
                    .frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 1) {
                    Text(healthOK ? "분석 엔진 준비" : "엔진 연결 중")
                        .font(.system(size: 11, weight: .semibold))
                    Text(lastUpdated == "-" ? "기준 시각 대기" : "갱신 \(lastUpdated)")
                        .font(.system(size: 9))
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("beginner-data-status")
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 62)
        .background(BeginnerPalette.surface.opacity(0.96))
        .overlay(alignment: .bottom) {
            Rectangle().fill(BeginnerPalette.line).frame(height: 1)
        }
    }
}

private struct BeginnerSymbolSearch: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selectedSymbol: String
    let querySession: String
    let onSymbolResolved: (String?) -> Void
    let onAnalyze: () -> Void

    @State private var query = ""
    @State private var matches: [LocalSymbolSearchItem] = []
    @State private var message = ""
    @State private var showingSuggestions = false
    @FocusState private var focused: Bool

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(BeginnerPalette.muted)
            TextField("종목명 또는 코드 검색", text: $query)
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit { submit() }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(focused ? BeginnerPalette.blue : BeginnerPalette.line)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-symbol-search")
        .task {
            if query.isEmpty { query = selectedSymbol }
        }
        .onChange(of: selectedSymbol) { _, value in
            if !focused { query = value }
        }
        .onChange(of: querySession) { _, _ in
            matches = []
            showingSuggestions = false
            query = selectedSymbol
        }
        .task(id: "\(querySession):\(trimmedQuery):\(focused)") {
            guard focused, !trimmedQuery.isEmpty else {
                showingSuggestions = false
                return
            }
            do {
                try await Task.sleep(for: .milliseconds(180))
                let nextMatches = try await model.searchSymbols(query: trimmedQuery, session: querySession)
                guard !Task.isCancelled else { return }
                matches = nextMatches
                message = nextMatches.isEmpty ? "검색 결과가 없습니다. 코드를 직접 입력할 수 있습니다." : ""
                showingSuggestions = true
            } catch is CancellationError {
                return
            } catch {
                matches = []
                message = "검색 연결 전입니다. 코드를 직접 입력해 분석할 수 있습니다."
                showingSuggestions = true
            }
        }
        .popover(isPresented: $showingSuggestions, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 5) {
                Text(querySession == "KR" ? "한국 종목" : "미국 종목·코인")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                if matches.isEmpty {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                        .padding(12)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(matches.prefix(20)) { item in
                                Button {
                                    select(item)
                                } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.bilingualName)
                                                .font(.body.weight(.semibold))
                                            Text([item.market, item.exchange].compactMap { $0 }.joined(separator: " · "))
                                                .font(.caption2)
                                                .foregroundStyle(BeginnerPalette.muted)
                                        }
                                        Spacer()
                                        Text(item.displaySymbol)
                                            .font(.system(.body, design: .monospaced).weight(.bold))
                                            .foregroundStyle(BeginnerPalette.blue)
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(item.displayLabel) 선택")
                                .accessibilityIdentifier("beginner-symbol-result-\(item.symbol)")
                            }
                        }
                    }
                    .frame(maxHeight: 330)
                }
            }
            .frame(width: 430)
            .padding(.bottom, 8)
            .background(BeginnerPalette.surfaceRaised)
        }
    }

    private func select(_ item: LocalSymbolSearchItem) {
        selectedSymbol = item.symbol
        query = item.displayLabel
        onSymbolResolved(item.bilingualName)
        matches = []
        showingSuggestions = false
        focused = false
        onAnalyze()
    }

    private func submit() {
        let normalizedQuery = trimmedQuery.lowercased()
        let exactMatch = matches.first { item in
            let values = [item.symbol, item.displaySymbol, item.name]
            return values.contains { $0.lowercased() == normalizedQuery }
        }
        if let exact = exactMatch ?? matches.first {
            select(exact)
            return
        }
        let manual = trimmedQuery.uppercased()
        guard !manual.isEmpty else { return }
        selectedSymbol = manual
        query = manual
        onSymbolResolved(nil)
        showingSuggestions = false
        focused = false
        onAnalyze()
    }
}

private struct BeginnerOnboardingView: View {
    let isLoading: Bool
    let onStartExample: () -> Void
    let onConnectAPI: () -> Void
    let onSkip: () -> Void

    @AccessibilityFocusState private var primaryActionFocused: Bool

    var body: some View {
        ZStack {
            BeginnerPalette.backgroundDeep
                .ignoresSafeArea()
            RadialGradient(
                colors: [BeginnerPalette.green.opacity(0.13), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 620
            )
            .ignoresSafeArea()

            VStack(spacing: 26) {
                VStack(spacing: 12) {
                    Image(systemName: "chart.line.uptrend.xyaxis.circle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(BeginnerPalette.green)
                    Text("처음이어도, 판단 순서는 단순하게")
                        .font(.system(size: 30, weight: .bold))
                        .accessibilityAddTraits(.isHeader)
                    Text("삼성전자 예제로 종목 확인 → 한 줄 결론 → 근거 확인 흐름을 먼저 경험하세요.")
                        .font(.system(size: 15))
                        .foregroundStyle(BeginnerPalette.muted)
                        .multilineTextAlignment(.center)
                }

                BeginnerSurface {
                    HStack(alignment: .top, spacing: 18) {
                        onboardingStep("1", title: "종목 확인", detail: "최근 종가와 일봉 차트를 확인합니다.")
                        onboardingStep("2", title: "한 줄 결론", detail: "진입 전 조건과 무효 조건을 먼저 봅니다.")
                        onboardingStep("3", title: "근거 확인", detail: "신호, 뉴스, 민심을 필요할 때 펼칩니다.")
                    }
                }
                .frame(maxWidth: 780)

                VStack(spacing: 11) {
                    Button(action: onStartExample) {
                        HStack {
                            if isLoading { ProgressView().controlSize(.small) }
                            Text(isLoading ? "예제 데이터를 준비 중입니다" : "삼성전자 예제 분석 시작")
                        }
                        .frame(width: 300, height: 42)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BeginnerPalette.green)
                    .foregroundStyle(BeginnerPalette.backgroundDeep)
                    .disabled(isLoading)
                    .accessibilityFocused($primaryActionFocused)
                    .accessibilityIdentifier("beginner-onboarding-example")

                    HStack(spacing: 8) {
                        Button("내 API 연결하기", action: onConnectAPI)
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("beginner-onboarding-connect-api")
                        Button("나중에 연결", action: onSkip)
                            .buttonStyle(.plain)
                            .foregroundStyle(BeginnerPalette.muted)
                            .accessibilityIdentifier("beginner-onboarding-skip")
                    }
                }

                HStack(spacing: 10) {
                    BeginnerStatusBadge("PAPER ONLY", color: BeginnerPalette.green)
                    Text("분석 결과는 투자 조언이나 실제 주문이 아닙니다. 실제 주문 버튼은 제공하지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
            .padding(42)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("처음 사용 안내")
        .accessibilityIdentifier("beginner-onboarding")
        .task {
            await Task.yield()
            primaryActionFocused = true
        }
    }

    private func onboardingStep(_ number: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(BeginnerPalette.backgroundDeep)
                .frame(width: 26, height: 26)
                .background(BeginnerPalette.green, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
