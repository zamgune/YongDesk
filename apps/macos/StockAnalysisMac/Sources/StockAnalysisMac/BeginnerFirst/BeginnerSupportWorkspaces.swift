import AppKit
import SwiftUI
import StockAnalysisMacCore

struct BeginnerAssetsWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    let assetClass: BeginnerAssetClass
    let onOpenAPIConnection: (BeginnerAPIConnectionProvider) -> Void
    let onOpenOrder: () -> Void

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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("내 자산")
                            .font(.system(size: 26, weight: .bold))
                        Text("통화가 다른 계좌는 합산하지 않고 세션별로 보여줍니다.")
                            .font(.caption)
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                    Spacer()
                    Button("상태 새로고침") {
                        Task { await model.refreshPaperTradingState() }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("beginner-assets-refresh")
                }

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
                    assetMetric(
                        title: "보유 포지션",
                        value: "\(selectedPositions.count)개",
                        detail: "현재 세션 기준"
                    )
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
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-assets-workspace")
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
                        Text("전략 탭에서 활성화한 설정만 실행 대상 카드로 표시합니다. 실행 제어와 주문 점검은 아래 고급 운영 제어에서 확인합니다.")
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
        if model.workerPausedEffective { return "Worker 일시중지" }
        return "정상 · paper"
    }

    private func activeStrategyCard(_ config: StrategyConfigView) -> some View {
        let evaluation = model.latestAutomationRun?.result.evaluations?.first { $0.strategyId == config.id }
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(config.name)
                        .font(.headline)
                    Text("\(config.symbol) · \(venueLabel(config)) · paper 실행")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
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

                DisclosureGroup("고급 운영 제어") {
                    VStack(alignment: .leading, spacing: 10) {
                        Button(model.workerPausedEffective ? "Worker 다시 시작" : "Worker 일시중지") {
                            Task {
                                await model.setWorkerPaused(!model.workerPausedEffective, reason: "Beginner 자동화 화면")
                                await model.refreshStrategyConfigs(replacingMessage: false)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.workerControlTransitionPending || model.killSwitchTransitionPending)
                        .accessibilityIdentifier("beginner-automation-worker-toggle")

                        Button(model.killSwitchEngaged ? "긴급 중지 해제" : "긴급 중지 켜기", role: model.killSwitchEngaged ? nil : .destructive) {
                            Task {
                                await model.setKillSwitchEngaged(!model.killSwitchEngaged, reason: "Beginner 자동화 화면")
                                await model.refreshStrategyConfigs(replacingMessage: false)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.killSwitchTransitionPending)
                        .accessibilityIdentifier("beginner-automation-kill-switch")

                        Text(model.killSwitchEngaged ? "긴급 중지가 자동화와 모의 주문을 차단하고 있습니다." : model.workerPausedEffective ? "Worker 일시중지가 자동화 실행을 차단하고 있습니다." : "자동화 안전 차단이 해제되어 있습니다.")
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

    private func venueLabel(_ config: StrategyConfigView) -> String {
        switch config.executionVenue {
        case "upbit": return "Upbit"
        case "bithumb": return "Bithumb"
        default: return "Toss 조회"
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
                    Text("연결 관리는 이 화면에서 처리하고, 엔진·점검·배포 도구는 일상 분석 화면에서 분리했습니다.")
                        .font(.caption)
                        .foregroundStyle(BeginnerPalette.muted)
                }

                BeginnerAPIConnectionWorkspace(selectedProvider: $selectedConnectionProvider)

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
                        icon: "checkmark.shield",
                        title: "앱 점검",
                        detail: "sidecar, broker, paper, 자동화 안전 경로를 한 번에 확인합니다.",
                        actionTitle: "점검 열기",
                        identifier: "beginner-settings-self-test",
                        action: { onOpen(.selfTest) }
                    )
                    settingsCard(
                        icon: "shippingbox",
                        title: "배포·설치 확인",
                        detail: "앱 번들, 서명, DMG와 설치 검증 상태를 확인합니다.",
                        actionTitle: "배포 상태",
                        identifier: "beginner-settings-distribution",
                        action: { onOpen(.distribution) }
                    )
                    settingsCard(
                        icon: "doc.text.magnifyingglass",
                        title: "Sidecar 로그",
                        detail: "오류가 발생했을 때 최근 로컬 로그를 확인합니다.",
                        actionTitle: "로그 열기",
                        identifier: "beginner-settings-log",
                        action: {
                            model.refreshSidecarLogTail()
                            onOpen(.sidecarLog)
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

                    Text(statusMessage)
                        .font(.caption2)
                        .foregroundStyle(statusColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(14)
                .background(BeginnerPalette.backgroundDeep.opacity(0.42), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(BeginnerPalette.line)
                }

                Text("API 연결은 선택 사항입니다. 이 버전에서는 연결·조회·사전검증만 제공하며 실제 주문은 계속 차단됩니다.")
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
        }
    }

    private func providerButton(_ provider: BeginnerAPIConnectionProvider) -> some View {
        Button {
            selectedProvider = provider
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
            .padding(.horizontal, 10)
            .background(selectedProvider == provider ? BeginnerPalette.blue.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(selectedProvider == provider ? BeginnerPalette.blue.opacity(0.55) : BeginnerPalette.line)
            }
        }
        .buttonStyle(.plain)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityIdentifier(provider.accessibilityIdentifier)
        .accessibilityValue(selectedProvider == provider ? "선택됨" : "선택 안 됨")
        .accessibilityAddTraits(selectedProvider == provider ? .isSelected : [])
    }

    private func saveCredential() async {
        isSaving = true
        defer { isSaving = false }
        if selectedProvider == .toss {
            await model.registerBrokerCredential(clientId: identifier, clientSecret: secret)
        } else {
            await model.registerCryptoCredential(exchange: selectedProvider.rawValue, accessKey: identifier, secretKey: secret)
        }
        secret = ""
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
