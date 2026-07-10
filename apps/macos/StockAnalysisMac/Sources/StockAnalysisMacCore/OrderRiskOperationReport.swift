import Foundation

public struct OrderRiskOperationReportInput: Sendable {
    public let generatedAt: String
    public let sidecarOK: Bool
    public let selectedSymbol: String
    public let selectedSession: String
    public let dashboard: TerminalDashboardSnapshot?
    public let holding: LocalHoldingResponse?
    public let precheck: LocalOrderPrecheckResponse?
    public let automationRun: AutomationCycleResponseView?
    public let resultPreview: String?
    public let liveGateState: String
    public let liveTradingEffective: Bool
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        sidecarOK: Bool,
        selectedSymbol: String,
        selectedSession: String,
        dashboard: TerminalDashboardSnapshot?,
        holding: LocalHoldingResponse?,
        precheck: LocalOrderPrecheckResponse?,
        automationRun: AutomationCycleResponseView?,
        resultPreview: String?,
        liveGateState: String,
        liveTradingEffective: Bool,
        killSwitchEngaged: Bool,
        workerPaused: Bool
    ) {
        self.generatedAt = generatedAt
        self.sidecarOK = sidecarOK
        self.selectedSymbol = selectedSymbol
        self.selectedSession = selectedSession
        self.dashboard = dashboard
        self.holding = holding
        self.precheck = precheck
        self.automationRun = automationRun
        self.resultPreview = resultPreview
        self.liveGateState = liveGateState
        self.liveTradingEffective = liveTradingEffective
        self.killSwitchEngaged = killSwitchEngaged
        self.workerPaused = workerPaused
    }
}

public enum OrderRiskOperationReport {
    public static func make(from input: OrderRiskOperationReportInput) -> String {
        let dashboard = input.dashboard
        var lines = [
            "주문·리스크 운영 리포트",
            "생성: \(input.generatedAt)",
            "주의: 이 리포트는 주문 전 점검 요약이며 broker 주문 제출 기록이 아닙니다.",
            "",
            "[상태]",
            "- Sidecar: \(input.sidecarOK ? "정상" : "필요")",
            "- 선택: \(input.selectedSession) \(input.selectedSymbol.uppercased())",
            "- Dashboard: \(dashboard == nil ? "미조회" : "조회됨")",
            "- Live gate: \(input.liveGateState) · \(input.liveTradingEffective ? "실거래 제출 가능" : "실거래 제출 차단")",
            "- Kill switch: \(input.killSwitchEngaged ? "ON" : "OFF")",
            "- 워커: \(input.workerPaused ? "일시중지" : "감시")",
            "",
            "[OrderIntent]",
        ]

        if let dashboard {
            lines.append(contentsOf: orderIntentLines(dashboard.orderIntent))
            lines.append("")
            lines.append("[RiskCheck]")
            lines.append(contentsOf: riskCheckLines(dashboard.riskCheck))
            lines.append("")
            lines.append("[주문 전 체크리스트]")
            lines.append(contentsOf: checklistLines(dashboard.preTradeChecklist))
            lines.append("")
            lines.append("[리스크 시나리오]")
            lines.append(contentsOf: scenarioLines(dashboard.riskScenarios))
        } else {
            lines.append("- 대시보드 미조회")
        }

        lines.append("")
        lines.append("[Toss 보유 조회]")
        lines.append(contentsOf: holdingLines(input.holding))

        lines.append("")
        lines.append("[주문 전 사전검증]")
        lines.append(contentsOf: precheckLines(input.precheck))

        lines.append("")
        lines.append("[자동화 점검/실행]")
        lines.append(contentsOf: automationLines(input.automationRun))

        if let preview = input.resultPreview?.trimmingCharacters(in: .whitespacesAndNewlines), !preview.isEmpty {
            lines.append("")
            lines.append("[최근 실행 결과]")
            lines.append(contentsOf: preview.split(separator: "\n").prefix(12).map { "- \($0)" })
        }

        lines.append("")
        lines.append("[다음 조치]")
        lines.append(contentsOf: nextActions(for: input).map { "- \($0)" })

        return lines.joined(separator: "\n")
    }

    private static func orderIntentLines(_ intent: DashboardOrderIntent) -> [String] {
        var lines = [
            "- ID: \(intent.id)",
            "- 종목: \(intent.symbol)",
            "- 방향: \(intent.side == "sell" ? "매도" : "매수")",
            "- 유형: \(intent.type)",
            "- 수량: \(intent.quantity)",
            "- 지정가: \(intent.limitPrice.map { formatMoney($0, currency: intent.currency) } ?? "-")",
            "- 상태: \(intent.status)",
        ]
        if !intent.rationale.isEmpty {
            lines.append("- 근거: \(intent.rationale.prefix(3).joined(separator: " / "))")
        }
        return lines
    }

    private static func riskCheckLines(_ riskCheck: DashboardRiskCheck) -> [String] {
        var lines = [
            "- 결과: \(riskCheck.passed ? "통과" : "차단")",
            "- 예상 주문금액: \(riskCheck.estimatedOrderValue.map { formatNumber($0) } ?? "-")",
            "- 최대 포지션: \(riskCheck.maxPositionValue.map { formatNumber($0) } ?? "-")",
        ]
        if !riskCheck.blockers.isEmpty {
            lines.append("- 차단: \(riskCheck.blockers.prefix(4).joined(separator: " / "))")
        }
        if !riskCheck.warnings.isEmpty {
            lines.append("- 주의: \(riskCheck.warnings.prefix(4).joined(separator: " / "))")
        }
        return lines
    }

    private static func checklistLines(_ items: [DashboardChecklistItem]) -> [String] {
        guard !items.isEmpty else {
            return ["- 항목 없음"]
        }
        return items.prefix(8).map { item in
            "- \(item.title): \(stateLabel(item.status)) · \(item.detail)"
        }
    }

    private static func scenarioLines(_ scenarios: [DashboardRiskScenario]) -> [String] {
        guard !scenarios.isEmpty else {
            return ["- 항목 없음"]
        }
        return scenarios.prefix(6).map { scenario in
            "- \(scenario.label): \(formatNumber(scenario.estimatedPnl)) · \(scenario.severity)"
        }
    }

    private static func holdingLines(_ holding: LocalHoldingResponse?) -> [String] {
        guard let holding else {
            return ["- 아직 보유 조회를 실행하지 않았습니다."]
        }
        if !holding.linked {
            return ["- Toss credential 미연동", "- 메시지: \(holding.message ?? "Toss 설정 필요")"]
        }
        var lines = [
            "- 계좌: \(holding.accountSeq.map { "#\($0)" } ?? "-")",
            "- 종목: \(holding.symbol ?? "-")\(holding.name.map { " · \($0)" } ?? "")",
            "- 보유: \(holding.held ? "있음" : "없음")",
        ]
        if let quantity = holding.quantity {
            lines.append("- 수량: \(formatNumber(quantity))")
        }
        if let marketValue = holding.marketValue {
            lines.append("- 평가금액: \(formatMoney(marketValue, currency: holding.currency ?? "USD"))")
        }
        if let profitLoss = holding.profitLoss {
            lines.append("- 손익: \(formatMoney(profitLoss, currency: holding.currency ?? "USD"))")
        }
        return lines
    }

    private static func precheckLines(_ precheck: LocalOrderPrecheckResponse?) -> [String] {
        guard let precheck else {
            return ["- 아직 사전검증을 실행하지 않았습니다."]
        }
        var lines = [
            "- 주문: \(precheck.side == "sell" ? "매도" : "매수") \(precheck.symbol) \(formatNumber(precheck.quantity))주 @ \(formatMoney(precheck.price, currency: precheck.currency))",
            "- 계좌: #\(precheck.accountSeq)",
            "- 잔고/수량: \(precheck.ok ? "통과" : "차단")",
            "- RiskCheck: \(precheck.riskCheck.passed ? "통과" : "차단")",
            "- Live gate: \(precheck.liveTradingGate.effective ? "통과" : "차단")",
            "- 제출 준비: \(precheck.submitReady ? "가능" : "차단")",
            "- 미리보기 ID: \(precheck.preview.id)",
        ]
        if !precheck.blockers.isEmpty {
            lines.append("- 차단: \(precheck.blockers.prefix(4).joined(separator: " / "))")
        }
        if !precheck.warnings.isEmpty {
            lines.append("- 주의: \(precheck.warnings.prefix(4).joined(separator: " / "))")
        }
        if let reason = precheck.reason {
            lines.append("- 사유: \(reason)")
        }
        return lines
    }

    private static func automationLines(_ run: AutomationCycleResponseView?) -> [String] {
        guard let run else {
            return ["- 아직 자동화 점검 또는 실행을 수행하지 않았습니다."]
        }
        let result = run.result
        var lines = [
            "- 모드: \(run.dryRun == true ? "dry-run" : "실행")",
            "- 상태: \(result.status)",
            "- 실거래 게이트: \(result.liveTradingEnabled == true ? "열림" : "차단")",
            "- 전략/발동/주문후보: \(result.strategies ?? 0)/\(result.triggers ?? 0)/\(result.orders ?? 0)",
            "- 제출/차단/거절/오류: \(result.submitted ?? 0)/\(result.blocked ?? 0)/\(result.rejected ?? 0)/\(result.errors ?? 0)",
            "- 동기화/신규체결: \(result.syncedOrders ?? 0)/\(result.newFills ?? 0)",
        ]
        if let reason = result.reason {
            lines.append("- 사유: \(reason)")
        }
        if let safety = result.safety {
            lines.append("- 안전: \(safety)")
        }
        if let firstEvaluation = result.evaluations?.first {
            lines.append("- 첫 평가: \(firstEvaluation.symbol) \(firstEvaluation.summary?.headline ?? firstEvaluation.name)")
        }
        return lines
    }

    private static func nextActions(for input: OrderRiskOperationReportInput) -> [String] {
        var actions: [String] = []
        if !input.sidecarOK {
            actions.append("앱에서 sidecar를 시작한 뒤 주문·리스크 탭을 다시 확인하세요.")
        }
        if input.dashboard == nil {
            actions.append("분석 또는 상태 갱신으로 OrderIntent/RiskCheck 대시보드를 먼저 불러오세요.")
        }
        if input.holding == nil {
            actions.append("Toss 보유 조회로 실계좌 보유 상태를 확인하세요.")
        }
        if input.precheck == nil {
            actions.append("주문 전 사전검증으로 잔고/수량, RiskCheck, live gate를 확인하세요.")
        } else if input.precheck?.submitReady != true {
            actions.append("사전검증 차단 사유를 해소하기 전에는 실거래 제출을 열지 마세요.")
        }
        if input.automationRun == nil {
            actions.append("자동화 점검 dry-run으로 활성 전략이 broker 제출 없이 어떻게 평가되는지 확인하세요.")
        }
        if input.killSwitchEngaged {
            actions.append("긴급 중지가 의도된 상태인지 확인하세요.")
        }
        if input.workerPaused {
            actions.append("워커 일시중지가 의도된 상태인지 확인하세요.")
        }
        if !input.liveTradingEffective {
            actions.append("실거래는 Toss credential, 계좌 선택, live gate, OrderIntent, RiskCheck를 모두 통과해야 제출됩니다.")
        }
        if actions.isEmpty {
            actions.append("실거래 제출 전에도 주문 확인과 kill switch 상태를 최종 확인하세요.")
        }
        return actions
    }

    private static func stateLabel(_ status: String) -> String {
        switch status {
        case "pass": return "정상"
        case "warn": return "주의"
        case "block": return "차단"
        default: return status
        }
    }

    private static func formatMoney(_ value: Double, currency: String) -> String {
        "\(currency) \(formatNumber(value))"
    }

    private static func formatNumber(_ value: Double) -> String {
        guard value.isFinite else {
            return "-"
        }
        return String(format: "%.2f", value)
    }
}
