import SwiftUI
import StockAnalysisMacCore

struct BeginnerStrategyWorkspace: View {
    @EnvironmentObject private var model: AppModel

    let selectedSymbol: String
    let selectedSession: String
    let assetClass: BeginnerAssetClass
    let analysis: MarketAnalysisSnapshot?
    let compact: Bool
    let onRefreshQuote: () -> Void
    let onOpenAutomation: () -> Void

    @State private var name = ""
    @State private var symbol = ""
    @State private var market = "KR"
    @State private var executionVenue = "toss"
    @State private var mode = "percent-grid"
    @State private var basePrice = 0.0
    @State private var anchorSource = "manual"
    @State private var anchorCapturedAt: String?
    @State private var orderSizingMode: String? = "quantity"
    @State private var quantity = 1.0
    @State private var notional = 50_000.0
    @State private var rungCount = 3
    @State private var firstBuyDropPct = 2.0
    @State private var rungGapPct = 2.0
    @State private var takeProfitPct = 5.0
    @State private var stopLossPct = 3.0
    @State private var maxLossPct = 15.0
    @State private var maxDailyTrades = 10
    @State private var cooldownMinutes = 5
    @State private var draftConfigId: String?
    @State private var previewedHash: String?
    @State private var hasUnsavedChanges = true
    @State private var suppressDirtyTracking = false
    @State private var isWorking = false
    @State private var initialized = false
    @State private var preservedGridRungs: [StrategyGridRungDraftInput]?
    @State private var preservedGridFingerprint: String?

    private var matchingAnalysis: MarketAnalysisSnapshot? {
        guard let analysis,
              beginnerCanonicalSymbol(analysis.symbol) == beginnerCanonicalSymbol(symbol.isEmpty ? selectedSymbol : symbol) else {
            return nil
        }
        return analysis
    }

    private var currentQuote: Double? {
        matchingAnalysis?.latestClose
    }

    private var quoteCanAnchor: Bool {
        guard let currentQuote, currentQuote > 0 else { return false }
        return matchingAnalysis?.stale != true
    }

    private var currency: String {
        market == "US" ? "USD" : "KRW"
    }

    private var isCrypto: Bool {
        market == "CRYPTO"
    }

    private var effectiveRungCount: Int {
        mode == "loop-grid" ? 1 : rungCount
    }

    private var savedConfig: StrategyConfigView? {
        guard let draftConfigId else { return nil }
        return model.strategyConfigs.first { $0.id == draftConfigId }
    }

    private var selectedInstrument: InstrumentDisplayView? {
        savedConfig?.instrument
            ?? model.strategyConfigs.first(where: { beginnerCanonicalSymbol($0.symbol) == beginnerCanonicalSymbol(symbol.isEmpty ? selectedSymbol : symbol) })?.instrument
            ?? model.watchlistItems.first(where: { beginnerCanonicalSymbol($0.symbol) == beginnerCanonicalSymbol(symbol.isEmpty ? selectedSymbol : symbol) })?.instrument
    }

    private var simulationCurrent: Bool {
        guard let savedConfig,
              let currentHash = savedConfig.currentConfigHash,
              let simulation = savedConfig.lastSimulation else {
            return false
        }
        return simulation.passed && simulation.configHash == currentHash
    }

    private var workflowStage: Int {
        if hasUnsavedChanges || savedConfig == nil { return 0 }
        if savedConfig?.status == "enabled" { return 4 }
        if simulationCurrent { return 3 }
        if previewedHash == savedConfig?.currentConfigHash { return 2 }
        return 1
    }

    private var formIsValid: Bool {
        guard model.health?.ok == true,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !symbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              basePrice.isFinite,
              basePrice > 0,
              firstBuyDropPct > 0,
              takeProfitPct > 0,
              stopLossPct > 0,
              maxLossPct >= deepestDropPct,
              maxDailyTrades >= effectiveRungCount else {
            return false
        }
        if orderSizingMode == "quantity" {
            return quantity.isFinite && quantity >= 1 && (isCrypto || quantity.rounded() == quantity)
        }
        return notional.isFinite && notional > 0
    }

    private var deepestDropPct: Double {
        firstBuyDropPct + rungGapPct * Double(max(effectiveRungCount - 1, 0))
    }

    private var draftFingerprint: String {
        [
            name,
            symbol,
            market,
            executionVenue,
            mode,
            String(basePrice),
            anchorSource,
            orderSizingMode ?? "legacy",
            String(quantity),
            String(notional),
            String(rungCount),
            String(firstBuyDropPct),
            String(rungGapPct),
            String(takeProfitPct),
            String(stopLossPct),
            String(maxLossPct),
            String(maxDailyTrades),
            String(cooldownMinutes),
        ].joined(separator: "|")
    }

    private var gridShapeFingerprint: String {
        [
            mode,
            String(rungCount),
            String(firstBuyDropPct),
            String(rungGapPct),
        ].joined(separator: "|")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                workspaceHeader
                workflowHeader
                if compact {
                    VStack(spacing: 14) {
                        editor
                        preview
                    }
                } else {
                    HStack(alignment: .top, spacing: 16) {
                        editor
                        preview
                            .frame(width: 360)
                    }
                }
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("beginner-strategy-workspace")
        .task {
            await model.refreshStrategyConfigs()
            guard !initialized else { return }
            initialized = true
            if let requestedId = model.requestedStrategyConfigId,
               let requested = model.strategyConfigs.first(where: { $0.id == requestedId }) {
                load(requested)
                model.requestedStrategyConfigId = nil
                return
            }
            resetForCurrentSelection()
        }
        .onChange(of: draftFingerprint) { _, _ in
            guard !suppressDirtyTracking else { return }
            hasUnsavedChanges = true
            previewedHash = nil
        }
        .onChange(of: selectedSymbol) { _, _ in
            guard draftConfigId == nil, !isWorking else { return }
            resetForCurrentSelection()
        }
        .onChange(of: assetClass) { _, _ in
            guard draftConfigId == nil, !isWorking else { return }
            resetForCurrentSelection()
        }
        .onChange(of: model.requestedStrategyConfigId) { _, requestedId in
            guard let requestedId,
                  let requested = model.strategyConfigs.first(where: { $0.id == requestedId }) else { return }
            load(requested)
            model.requestedStrategyConfigId = nil
        }
    }

    private var workspaceHeader: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("처음 만드는 자동매매")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(BeginnerPalette.green)
                Text("매매 문장으로 전략 만들기")
                    .font(.system(size: 27, weight: .bold))
                Text("현재 가격을 확인한 뒤 주식은 몇 주, 코인은 얼마를 살지 정합니다. 입력 결과는 오른쪽에서 실제 가격과 최대 투자금으로 확인합니다.")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                HStack(spacing: 6) {
                    Text(beginnerInstrumentPrimary(selectedInstrument, fallbackCode: symbol.isEmpty ? selectedSymbol : symbol))
                        .font(.subheadline.weight(.semibold))
                    Text(beginnerInstrumentCode(selectedInstrument, fallbackCode: symbol.isEmpty ? selectedSymbol : symbol))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(BeginnerPalette.muted)
                }
            }
            Spacer()
            Menu {
                if model.strategyConfigs.isEmpty {
                    Text("저장된 전략 없음")
                } else {
                    ForEach(model.strategyConfigs) { config in
                        Button("\(beginnerInstrumentPrimary(config.instrument, fallbackCode: config.symbol)) · \(beginnerInstrumentCode(config.instrument, fallbackCode: config.symbol)) · \(config.name)") {
                            load(config)
                        }
                    }
                }
                Divider()
                Button("전략 백업 복사") { Task { await model.copyStrategyBackupToClipboard() } }
                Button("전략 백업 가져오기") { Task { await model.importStrategyBackupFromClipboard() } }
            } label: {
                Label("내 전략 \(model.strategyConfigs.count)개", systemImage: "tray.full")
            }
            .menuStyle(.borderlessButton)
            .accessibilityIdentifier("beginner-strategy-library")

            Button("새 전략") {
                draftConfigId = nil
                resetForCurrentSelection()
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("beginner-strategy-new")
        }
    }

    private var workflowHeader: some View {
        BeginnerSurface {
            HStack(spacing: 8) {
                workflowStep(1, "초안 저장")
                Image(systemName: "chevron.right").foregroundStyle(BeginnerPalette.muted)
                workflowStep(2, "조건 확인")
                Image(systemName: "chevron.right").foregroundStyle(BeginnerPalette.muted)
                workflowStep(3, "시뮬레이션")
                Image(systemName: "chevron.right").foregroundStyle(BeginnerPalette.muted)
                workflowStep(4, "활성화")
            }
        }
        .accessibilityIdentifier("beginner-strategy-workflow")
    }

    private func workflowStep(_ index: Int, _ title: String) -> some View {
        HStack(spacing: 7) {
            Text("\(index)")
                .font(.caption.weight(.bold))
                .foregroundStyle(workflowStage >= index ? BeginnerPalette.backgroundDeep : BeginnerPalette.muted)
                .frame(width: 24, height: 24)
                .background(workflowStage >= index ? BeginnerPalette.green : BeginnerPalette.surfaceSoft, in: Circle())
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(workflowStage >= index ? BeginnerPalette.text : BeginnerPalette.muted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("\(index)단계 \(title)")
        .accessibilityValue(workflowStage >= index ? "완료" : "대기")
    }

    private var editor: some View {
        VStack(spacing: 14) {
            instrumentSection
            sizingSection
            conditionSection
        }
        .frame(maxWidth: .infinity)
    }

    private var instrumentSection: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader(number: "1", title: "무엇을 거래할까요?", detail: "최근 확인 가격과 저장되는 전략 기준가를 분리합니다.")

                HStack(spacing: 10) {
                    Text(isCrypto ? "코인" : market == "US" ? "미국 주식" : "한국 주식")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(BeginnerPalette.blue)
                    Text(beginnerInstrumentPrimary(selectedInstrument, fallbackCode: symbol))
                        .font(.body.weight(.bold))
                    Text(beginnerInstrumentCode(selectedInstrument, fallbackCode: symbol))
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .foregroundStyle(BeginnerPalette.muted)
                    Spacer()
                    TextField("전략 이름", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 270)
                        .accessibilityIdentifier("beginner-strategy-name")
                }

                HStack(alignment: .top, spacing: 10) {
                    quoteCard
                    anchorCard
                }

                if matchingAnalysis?.stale == true {
                    notice("시세가 오래되어 현재 가격 자동 적용을 막았습니다. 새로고침하거나 수동 기준가를 입력하세요.", color: BeginnerPalette.amber)
                } else {
                    notice("가격 새로고침은 최근 확인 가격만 바꿉니다. 전략 기준가는 ‘현재가 적용’을 눌렀을 때만 변경됩니다.", color: BeginnerPalette.blue)
                }
            }
        }
        .accessibilityIdentifier("beginner-strategy-instrument")
    }

    private var quoteCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("최근 확인 가격")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BeginnerPalette.muted)
            Text(formattedPrice(currentQuote))
                .font(.system(size: 22, weight: .bold, design: .rounded))
            Text(quoteMetadata)
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button("가격 새로고침", action: onRefreshQuote)
                .buttonStyle(.bordered)
                .disabled(isWorking)
                .accessibilityIdentifier("beginner-strategy-refresh-quote")
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).stroke(BeginnerPalette.line) }
    }

    private var anchorCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("전략 기준가")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeginnerPalette.muted)
                Spacer()
                BeginnerStatusBadge(anchorSource == "market" ? "현재가 고정" : "수동", color: BeginnerPalette.blue)
            }
            TextField("전략 기준가", value: $basePrice, format: .number)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("beginner-strategy-anchor-price")
                .onChange(of: basePrice) { _, _ in
                    guard !suppressDirtyTracking else { return }
                    anchorSource = "manual"
                    anchorCapturedAt = nil
                }
            Button("현재가 적용") { applyCurrentQuote() }
                .buttonStyle(.bordered)
                .disabled(!quoteCanAnchor || isWorking)
                .accessibilityIdentifier("beginner-strategy-apply-quote")
            Text(anchorCapturedAt.map(beginnerTimestamp) ?? "저장 시 고정 · 자동 추적 안 함")
                .font(.caption2)
                .foregroundStyle(BeginnerPalette.muted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).stroke(BeginnerPalette.line) }
    }

    private var sizingSection: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader(number: "2", title: "한 번에 얼마나 살까요?", detail: isCrypto ? "원화 주문금액을 정하고 예상 코인 수량을 확인합니다." : "주식은 가격 대신 고정 수량을 먼저 정합니다.")

                Picker("매매 방식", selection: $mode) {
                    Text("분할 매수").tag("percent-grid")
                    Text("반복 매매").tag("loop-grid")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("beginner-strategy-mode")

                if orderSizingMode == nil {
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            BeginnerStatusBadge("기존 금액 기준", color: BeginnerPalette.amber)
                            Text("이 전략은 변경 전 방식대로 차수당 금액에서 수량을 계산합니다.")
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        TextField("차수당 금액", value: $notional, format: .number)
                            .textFieldStyle(.roundedBorder)
                        if !isCrypto {
                            Button("수량 기준으로 전환") { convertLegacyToQuantity() }
                                .buttonStyle(.borderedProminent)
                                .tint(BeginnerPalette.green)
                                .foregroundStyle(BeginnerPalette.backgroundDeep)
                                .accessibilityIdentifier("beginner-strategy-convert-quantity")
                        }
                    }
                } else if orderSizingMode == "quantity" {
                    HStack(spacing: 14) {
                        Stepper(value: $quantity, in: 1...10_000, step: 1) {
                            Text("한 번에 \(quantityText(quantity))\(quantityUnit)")
                                .font(.headline)
                        }
                        .accessibilityIdentifier("beginner-strategy-quantity")
                        Spacer()
                        Text("첫 주문 예상 \(formattedPrice(firstOrderNotional))")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BeginnerPalette.muted)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 9) {
                        TextField("한 번에 쓸 금액", value: $notional, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("beginner-strategy-notional")
                        HStack(spacing: 7) {
                            ForEach([10_000.0, 50_000.0, 100_000.0], id: \.self) { value in
                                Button(value == 10_000 ? "1만원" : value == 50_000 ? "5만원" : "10만원") {
                                    notional = value
                                }
                                .buttonStyle(.bordered)
                            }
                            Spacer()
                            Text("예상 \(quantityText(firstOrderQuantity)) \(cryptoUnit)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                    }
                }

                if mode == "percent-grid" {
                    Stepper("나누어 살 횟수 \(rungCount)회", value: $rungCount, in: 1...20)
                        .accessibilityIdentifier("beginner-strategy-rung-count")
                }

                HStack(spacing: 8) {
                    metric(title: "첫 주문 예상", value: orderSizeLabel(price: entryPrice(index: 0)))
                    metric(title: "최대 보유", value: maximumPositionLabel)
                    metric(title: "예상 최대투자", value: formattedPrice(maximumExposure))
                }
            }
        }
        .accessibilityIdentifier("beginner-strategy-sizing")
    }

    private var conditionSection: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader(number: "3", title: "언제 사고, 언제 정리할까요?", detail: "퍼센트를 실제 예상 가격으로 함께 보여줍니다.")

                sliderField(title: "첫 매수 하락폭", value: $firstBuyDropPct, range: 0.5...20, suffix: "기준가 -", help: "1차 매수선 \(formattedPrice(entryPrice(index: 0)))")
                    .accessibilityIdentifier("beginner-strategy-first-drop")
                if mode == "percent-grid" {
                    sliderField(title: "차수 간격", value: $rungGapPct, range: 0.5...10, suffix: "", help: "마지막 매수 하락폭 -\(deepestDropPct.formatted(.number.precision(.fractionLength(1))))%")
                        .accessibilityIdentifier("beginner-strategy-rung-gap")
                }
                sliderField(title: "익절 기준", value: $takeProfitPct, range: 0.5...30, suffix: "체결가 +", help: "1차 체결가 기준 \(formattedPrice(entryPrice(index: 0) * (1 + takeProfitPct / 100)))")
                    .accessibilityIdentifier("beginner-strategy-take-profit")
                sliderField(title: "손절 기준", value: $stopLossPct, range: 0.5...20, suffix: "평단가 -", help: "보유 평단 기준 전량 paper 청산 후 전략 일시중지")
                    .accessibilityIdentifier("beginner-strategy-stop-loss")

                DisclosureGroup("고급 안전 제한") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("추가매수 중단선은 손절과 다르게 신규 매수만 막습니다.")
                            .font(.caption2)
                            .foregroundStyle(BeginnerPalette.muted)
                        TextField("추가매수 중단선 %", value: $maxLossPct, format: .number)
                            .textFieldStyle(.roundedBorder)
                        Stepper("일일 최대 매매 \(maxDailyTrades)회", value: $maxDailyTrades, in: 1...50)
                        if mode == "loop-grid" {
                            Stepper("반복 쿨다운 \(cooldownMinutes)분", value: $cooldownMinutes, in: 0...1_440, step: 5)
                        }
                    }
                    .padding(.top, 8)
                }
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("beginner-strategy-advanced-risk")

                if maxLossPct < deepestDropPct {
                    notice("추가매수 중단선이 마지막 매수 하락폭보다 작습니다. 최소 \(deepestDropPct.formatted(.number.precision(.fractionLength(1))))% 이상으로 설정하세요.", color: BeginnerPalette.red)
                }
            }
        }
        .accessibilityIdentifier("beginner-strategy-conditions")
    }

    private var preview: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    Text("내 전략 미리보기")
                        .font(.headline)
                    Spacer()
                    BeginnerStatusBadge(workflowStatusLabel, color: workflowStatusColor)
                }
                HStack(spacing: 7) {
                    Text(beginnerInstrumentPrimary(selectedInstrument, fallbackCode: symbol))
                        .font(.title3.weight(.bold))
                    Text(beginnerInstrumentCode(selectedInstrument, fallbackCode: symbol))
                        .font(.system(.caption, design: .monospaced).weight(.bold))
                        .foregroundStyle(BeginnerPalette.muted)
                }
                Text(strategySentence)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 7) {
                    ForEach(0..<effectiveRungCount, id: \.self) { index in
                        HStack {
                            BeginnerStatusBadge("\(index + 1)차", color: BeginnerPalette.blue)
                            Text("\(formattedPrice(entryPrice(index: index))) 이하")
                                .font(.caption.monospacedDigit().weight(.semibold))
                            Spacer()
                            Text(orderSizeLabel(price: entryPrice(index: index)))
                                .font(.caption)
                                .foregroundStyle(BeginnerPalette.muted)
                        }
                        .padding(8)
                        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 9))
                    }
                }

                HStack(spacing: 8) {
                    metric(title: "익절", value: "체결가 +\(takeProfitPct.formatted(.number.precision(.fractionLength(1))))%")
                    metric(title: "손절", value: "평단가 -\(stopLossPct.formatted(.number.precision(.fractionLength(1))))%")
                }
                metric(title: "예상 최대투자", value: formattedPrice(maximumExposure))

                notice("손절 청산이 완료되면 전략은 자동 일시중지되고 이전 시뮬레이션은 폐기됩니다.", color: BeginnerPalette.amber)

                Divider().overlay(BeginnerPalette.line)

                Text(model.strategyMessage)
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    Button("1. 초안 저장") { Task { await saveDraft() } }
                        .buttonStyle(.bordered)
                        .disabled(!formIsValid || isWorking)
                        .accessibilityIdentifier("beginner-strategy-save")
                    Button("2. 현재 조건 확인") { Task { await previewCurrentTick() } }
                        .buttonStyle(.bordered)
                        .disabled(workflowStage < 1 || hasUnsavedChanges || isWorking)
                        .accessibilityIdentifier("beginner-strategy-preview")
                    Button("발동가 테스트") { Task { await previewTrigger() } }
                        .buttonStyle(.bordered)
                        .disabled(workflowStage < 1 || hasUnsavedChanges || isWorking)
                        .accessibilityIdentifier("beginner-strategy-trigger-preview")
                    Button("3. 모의 시뮬레이션") { Task { await simulate() } }
                        .buttonStyle(.bordered)
                        .disabled(workflowStage < 2 || hasUnsavedChanges || isWorking)
                        .accessibilityIdentifier("beginner-strategy-simulate")
                    Button("4. 전략 활성화") { Task { await enable() } }
                        .buttonStyle(.borderedProminent)
                        .tint(BeginnerPalette.green)
                        .foregroundStyle(BeginnerPalette.backgroundDeep)
                        .disabled(workflowStage < 3 || hasUnsavedChanges || isWorking)
                        .accessibilityIdentifier("beginner-strategy-enable")
                    Button("자동화 탭에서 보기", action: onOpenAutomation)
                        .buttonStyle(.bordered)
                        .disabled(savedConfig?.status != "enabled")
                        .accessibilityIdentifier("beginner-strategy-open-automation")
                }
            }
        }
        .accessibilityIdentifier("beginner-strategy-preview-card")
    }

    private func sectionHeader(number: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(.caption.weight(.bold))
                .foregroundStyle(BeginnerPalette.backgroundDeep)
                .frame(width: 28, height: 28)
                .background(BeginnerPalette.green, in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail).font(.caption).foregroundStyle(BeginnerPalette.muted)
            }
        }
    }

    private func sliderField(title: String, value: Binding<Double>, range: ClosedRange<Double>, suffix: String, help: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.caption.weight(.semibold))
                Spacer()
                Text("\(suffix)\(value.wrappedValue.formatted(.number.precision(.fractionLength(1))))%")
                    .font(.caption.monospacedDigit().weight(.bold))
            }
            Slider(value: value, in: range, step: 0.5)
                .tint(BeginnerPalette.green)
            Text(help).font(.caption2).foregroundStyle(BeginnerPalette.muted)
        }
        .padding(10)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 10))
    }

    private func metric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2).foregroundStyle(BeginnerPalette.muted)
            Text(value).font(.caption.weight(.semibold)).lineLimit(2)
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BeginnerPalette.background, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).stroke(BeginnerPalette.line.opacity(0.8)) }
    }

    private func notice(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(color)
            .padding(9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
            .overlay { RoundedRectangle(cornerRadius: 9).stroke(color.opacity(0.28)) }
    }

    private var quoteMetadata: String {
        guard let analysis = matchingAnalysis else {
            return "가격 정보 없음 · 차트에서 분석하거나 직접 기준가를 입력하세요."
        }
        let source = analysis.dataSource?.uppercased() ?? "AUTO"
        let timeframe = analysis.timeframe ?? "주기 확인 중"
        let stale = analysis.stale ? " · 지연" : ""
        return "\(source) · \(timeframe) · \(beginnerTimestamp(analysis.quoteAt))\(stale)"
    }

    private var strategySentence: String {
        let size = orderSizingMode == "quantity"
            ? "\(quantityText(quantity))\(quantityUnit)씩"
            : orderSizingMode == "notional"
                ? "\(formattedPrice(notional))씩"
                : "기존 금액 방식으로"
        if mode == "loop-grid" {
            return "기준가 \(formattedPrice(basePrice))에서 \(firstBuyDropPct.formatted(.number.precision(.fractionLength(1))))% 내려오면 \(size) 사고, 체결가에서 \(takeProfitPct.formatted(.number.precision(.fractionLength(1))))% 오르면 정리합니다."
        }
        return "기준가 \(formattedPrice(basePrice))에서 \(rungGapPct.formatted(.number.precision(.fractionLength(1))))% 간격으로 \(size), 최대 \(rungCount)회 나누어 삽니다."
    }

    private var workflowStatusLabel: String {
        switch workflowStage {
        case 4: return "활성"
        case 3: return "활성화 대기"
        case 2: return "조건 확인"
        case 1: return "초안"
        default: return hasUnsavedChanges ? "저장 필요" : "작성 중"
        }
    }

    private var workflowStatusColor: Color {
        switch workflowStage {
        case 4: return BeginnerPalette.green
        case 2, 3: return BeginnerPalette.blue
        case 1: return BeginnerPalette.amber
        default: return BeginnerPalette.red
        }
    }

    private var maximumExposure: Double {
        (0..<effectiveRungCount).reduce(0) { sum, index in
            sum + orderNotional(price: entryPrice(index: index))
        }
    }

    private var firstOrderNotional: Double {
        orderNotional(price: entryPrice(index: 0))
    }

    private var firstOrderQuantity: Double {
        orderQuantity(price: entryPrice(index: 0))
    }

    private var maximumPositionLabel: String {
        orderSizingMode == "quantity"
            ? "\(quantityText(quantity * Double(effectiveRungCount)))\(quantityUnit)"
            : "최대 \(effectiveRungCount)회"
    }

    /// Stocks use whole shares while a legacy/advanced crypto quantity strategy
    /// is shown with the selected quote asset (for example BTC), so the UI does
    /// not imply that a coin order is measured in shares.
    private var quantityUnit: String {
        isCrypto ? cryptoUnit : "주"
    }

    private var cryptoUnit: String {
        symbol.uppercased().split(separator: "-").last.map(String.init) ?? "코인"
    }

    private func entryPrice(index: Int) -> Double {
        let drop = firstBuyDropPct + rungGapPct * Double(index)
        return max(basePrice * (1 - drop / 100), 0)
    }

    private func orderQuantity(price: Double) -> Double {
        guard price > 0 else { return 0 }
        if orderSizingMode == "quantity" {
            return isCrypto ? floor(quantity * 100_000_000) / 100_000_000 : floor(quantity)
        }
        return isCrypto
            ? floor((notional / price) * 100_000_000) / 100_000_000
            : max(1, floor(notional / price))
    }

    private func orderNotional(price: Double) -> Double {
        orderSizingMode == "quantity" ? orderQuantity(price: price) * price : notional
    }

    private func orderSizeLabel(price: Double) -> String {
        if orderSizingMode == "quantity" {
            return "\(quantityText(orderQuantity(price: price)))\(quantityUnit) · \(formattedPrice(orderNotional(price: price)))"
        }
        if isCrypto {
            return "\(formattedPrice(notional)) · \(quantityText(orderQuantity(price: price))) \(cryptoUnit)"
        }
        return "약 \(quantityText(orderQuantity(price: price)))주 · \(formattedPrice(notional))"
    }

    private func formattedPrice(_ value: Double?) -> String {
        beginnerPrice(value, currency: currency)
    }

    private func quantityText(_ value: Double) -> String {
        if value.rounded() == value {
            return Int(value).formatted()
        }
        return value.formatted(.number.precision(.fractionLength(8)))
    }

    private func strategyStatusLabel(_ value: String) -> String {
        switch value {
        case "enabled": return "활성"
        case "disabled": return "일시중지"
        default: return "초안"
        }
    }

    private func resetForCurrentSelection() {
        suppressDirtyTracking = true
        symbol = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        market = assetClass == .crypto ? "CRYPTO" : selectedSession == "KR" ? "KR" : "US"
        executionVenue = assetClass == .crypto ? "upbit" : "toss"
        name = "\(symbol.isEmpty ? "내" : symbol) 초보 분할"
        mode = "percent-grid"
        orderSizingMode = assetClass == .crypto ? "notional" : "quantity"
        quantity = 1
        notional = 50_000
        rungCount = 3
        firstBuyDropPct = 2
        rungGapPct = 2
        takeProfitPct = 5
        stopLossPct = 3
        maxLossPct = 15
        maxDailyTrades = 10
        cooldownMinutes = 5
        if quoteCanAnchor, let currentQuote {
            basePrice = currentQuote
            anchorSource = "market"
            anchorCapturedAt = matchingAnalysis?.quoteAt
        } else {
            basePrice = 0
            anchorSource = "manual"
            anchorCapturedAt = nil
        }
        previewedHash = nil
        preservedGridRungs = nil
        preservedGridFingerprint = nil
        hasUnsavedChanges = true
        DispatchQueue.main.async { suppressDirtyTracking = false }
    }

    private func applyCurrentQuote() {
        guard quoteCanAnchor, let currentQuote else { return }
        basePrice = currentQuote
        anchorSource = "market"
        anchorCapturedAt = matchingAnalysis?.quoteAt
        hasUnsavedChanges = true
        previewedHash = nil
    }

    private func convertLegacyToQuantity() {
        let price = entryPrice(index: 0)
        guard price > 0 else { return }
        quantity = max(1, floor(notional / price))
        orderSizingMode = "quantity"
        hasUnsavedChanges = true
        previewedHash = nil
    }

    private func load(_ config: StrategyConfigView) {
        suppressDirtyTracking = true
        draftConfigId = config.id
        name = config.name
        symbol = config.symbol.uppercased()
        market = config.market
        executionVenue = config.executionVenue ?? (config.market == "CRYPTO" ? "upbit" : "toss")
        mode = config.mode == "loop-grid" ? "loop-grid" : "percent-grid"
        orderSizingMode = config.orderSizing?.mode
        quantity = config.orderSizing?.quantity ?? 1
        if let explicitNotional = config.orderSizing?.notional {
            notional = explicitNotional
        }
        if mode == "loop-grid" {
            basePrice = config.loop?.anchorPrice ?? config.priceAnchor?.price ?? config.currentPrice
            firstBuyDropPct = config.loop?.buyDropPct ?? firstBuyDropPct
            rungGapPct = firstBuyDropPct
            takeProfitPct = config.loop?.sellRisePct ?? config.exitRules?.takeProfitPct ?? takeProfitPct
            notional = config.orderSizing?.notional ?? config.loop?.notional ?? notional
            cooldownMinutes = config.loop?.cooldownMinutes ?? cooldownMinutes
            rungCount = 1
            preservedGridRungs = nil
            preservedGridFingerprint = nil
        } else {
            let rungs = config.grid?.rungs.sorted { $0.index < $1.index } ?? []
            basePrice = config.grid?.basePrice ?? config.priceAnchor?.price ?? config.currentPrice
            rungCount = max(1, min(rungs.count, 20))
            firstBuyDropPct = rungs.first?.buyDropPct ?? firstBuyDropPct
            rungGapPct = inferredGap(rungs.map(\.buyDropPct), fallback: firstBuyDropPct)
            takeProfitPct = rungs.first?.sellRisePct ?? config.exitRules?.takeProfitPct ?? takeProfitPct
            notional = config.orderSizing?.notional ?? rungs.first?.notional ?? notional
            preservedGridRungs = rungs.map {
                StrategyGridRungDraftInput(
                    index: $0.index,
                    buyDropPct: $0.buyDropPct,
                    sellRisePct: $0.sellRisePct,
                    notional: $0.notional
                )
            }
            preservedGridFingerprint = gridShapeFingerprint
        }
        stopLossPct = max(config.exitRules?.stopLossPct ?? stopLossPct, 0.5)
        maxLossPct = config.riskLimits?.maxLossPct ?? maxLossPct
        maxDailyTrades = max(config.riskLimits?.maxDailyBuys ?? 1, config.riskLimits?.maxDailySells ?? 1)
        anchorSource = config.priceAnchor?.source ?? "manual"
        anchorCapturedAt = config.priceAnchor?.capturedAt
        previewedHash = nil
        hasUnsavedChanges = false
        DispatchQueue.main.async { suppressDirtyTracking = false }
    }

    private func inferredGap(_ values: [Double], fallback: Double) -> Double {
        guard values.count >= 2 else { return fallback }
        let gap = values[1] - values[0]
        return gap > 0 ? gap : fallback
    }

    private func draftInput() -> StrategyDraftInput {
        StrategyDraftInput(
            name: name,
            symbol: symbol,
            market: market,
            preset: mode == "loop-grid" ? "one-percent-loop" : "magic-split",
            mode: mode,
            basePrice: basePrice,
            notional: notional,
            rungCount: effectiveRungCount,
            buyDropPct: firstBuyDropPct,
            sellRisePct: takeProfitPct,
            maxDailyTrades: maxDailyTrades,
            maxLossPct: maxLossPct,
            cooldownMinutes: cooldownMinutes,
            executionVenue: isCrypto ? executionVenue : "toss",
            orderSizingMode: orderSizingMode,
            quantity: orderSizingMode == "quantity" ? quantity : nil,
            rungGapPct: rungGapPct,
            stopLossPct: stopLossPct,
            priceAnchorSource: anchorSource,
            priceAnchorCapturedAt: anchorCapturedAt,
            preservedGridRungs: preservedGridFingerprint == gridShapeFingerprint ? preservedGridRungs : nil
        )
    }

    private func saveDraft() async {
        guard formIsValid else { return }
        isWorking = true
        defer { isWorking = false }
        let response: StrategyConfigView?
        if let savedConfig {
            response = await model.updateStrategyDraft(savedConfig, input: draftInput())
        } else {
            response = await model.createStrategyDraft(draftInput())
        }
        guard let response else { return }
        draftConfigId = response.id
        hasUnsavedChanges = false
        previewedHash = nil
    }

    private func previewCurrentTick() async {
        guard let savedConfig else { return }
        isWorking = true
        await model.previewStrategyTick(savedConfig, scenario: "current")
        await model.refreshStrategyConfigs(replacingMessage: false)
        previewedHash = model.strategyConfigs.first { $0.id == savedConfig.id }?.currentConfigHash
        isWorking = false
    }

    private func previewTrigger() async {
        guard let savedConfig else { return }
        isWorking = true
        await model.previewStrategyTick(savedConfig, scenario: "entry-trigger")
        await model.refreshStrategyConfigs(replacingMessage: false)
        previewedHash = model.strategyConfigs.first { $0.id == savedConfig.id }?.currentConfigHash
        isWorking = false
    }

    private func simulate() async {
        guard let savedConfig else { return }
        isWorking = true
        await model.simulateStrategy(savedConfig)
        isWorking = false
    }

    private func enable() async {
        guard let savedConfig else { return }
        isWorking = true
        await model.setStrategyStatus(savedConfig, status: "enabled")
        isWorking = false
    }
}
