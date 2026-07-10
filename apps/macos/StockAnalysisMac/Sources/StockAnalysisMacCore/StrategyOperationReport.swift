import Foundation

public struct StrategyOperationReportInput: Sendable {
    public let generatedAt: String
    public let sidecarOK: Bool
    public let configs: [StrategyConfigView]
    public let latestSimulation: StrategySimulationResultView?
    public let latestTickPreview: String?
    public let liveGateState: String
    public let liveTradingEffective: Bool
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        sidecarOK: Bool,
        configs: [StrategyConfigView],
        latestSimulation: StrategySimulationResultView?,
        latestTickPreview: String?,
        liveGateState: String,
        liveTradingEffective: Bool,
        killSwitchEngaged: Bool,
        workerPaused: Bool
    ) {
        self.generatedAt = generatedAt
        self.sidecarOK = sidecarOK
        self.configs = configs
        self.latestSimulation = latestSimulation
        self.latestTickPreview = latestTickPreview
        self.liveGateState = liveGateState
        self.liveTradingEffective = liveTradingEffective
        self.killSwitchEngaged = killSwitchEngaged
        self.workerPaused = workerPaused
    }
}

public enum StrategyOperationReport {
    public static func make(from input: StrategyOperationReportInput) -> String {
        let enabledCount = input.configs.filter { $0.status == "enabled" }.count
        let draftCount = input.configs.filter { $0.status == "draft" }.count
        let disabledCount = input.configs.filter { $0.status == "disabled" }.count
        var lines = [
            "자동거래 전략 운영 리포트",
            "생성: \(input.generatedAt)",
            "주의: 이 리포트는 설정/검증 상태 요약이며 주문 제출 내역이 아닙니다.",
            "",
            "[상태]",
            "- Sidecar: \(input.sidecarOK ? "정상" : "필요")",
            "- 전략: 전체 \(input.configs.count)개 · 활성 \(enabledCount)개 · 초안 \(draftCount)개 · 일시정지 \(disabledCount)개",
            "- Live gate: \(input.liveGateState) · \(input.liveTradingEffective ? "실거래 제출 가능" : "실거래 제출 차단")",
            "- Kill switch: \(input.killSwitchEngaged ? "ON" : "OFF")",
            "- 워커: \(input.workerPaused ? "일시중지" : "감시")",
            "- 최근 시뮬레이션: \(simulationLabel(input.latestSimulation))",
            "- 최근 tick 점검: \(input.latestTickPreview == nil ? "없음" : "있음")",
            "",
            "[전략별]",
        ]

        if input.configs.isEmpty {
            lines.append("- 저장된 전략 없음")
        } else {
            for config in input.configs.prefix(10) {
                lines.append(contentsOf: strategyLines(config))
            }
            let remaining = input.configs.count - min(input.configs.count, 10)
            if remaining > 0 {
                lines.append("- 외 \(remaining)개 전략 생략")
            }
        }

        lines.append("")
        lines.append("[다음 조치]")
        lines.append(contentsOf: nextActions(for: input).map { "- \($0)" })

        return lines.joined(separator: "\n")
    }

    private static func strategyLines(_ config: StrategyConfigView) -> [String] {
        let readiness = config.automationReadiness
        var lines = [
            "- \(config.name) · \(config.market) \(config.symbol) · \(presetLabel(config.preset)) · \(modeLabel(config.mode)) · \(statusLabel(config.status))",
            "  기준가/현재가: \(formatNumber(config.currentPrice)) · 총 노출: \(formatNumber(totalExposure(config)))",
            "  시뮬레이션: \(simulationState(config))",
            "  모의 자동화: \(readiness?.paperAutomationReady == true ? "준비" : "차단") · 실거래 제출: \(readiness?.liveSubmissionReady == true ? "준비" : "차단")",
        ]
        if let reason = readiness?.liveGateReason, !reason.isEmpty {
            lines.append("  Live gate 사유: \(reason)")
        }
        if let blocker = readiness?.blockers.first {
            lines.append("  차단: \(blocker)")
        } else if let liveBlocker = readiness?.liveBlockers.first {
            lines.append("  실거래 차단: \(liveBlocker)")
        }
        if let action = readiness?.nextActions.first {
            lines.append("  다음: \(action)")
        }
        return lines
    }

    private static func totalExposure(_ config: StrategyConfigView) -> Double {
        if config.mode == "loop-grid" {
            return config.loop?.notional ?? 0
        }
        if let grid = config.grid {
            return grid.rungs.reduce(0) { $0 + $1.notional }
        }
        return config.riskLimits?.maxPositionValue ?? 0
    }

    private static func simulationState(_ config: StrategyConfigView) -> String {
        guard let simulation = config.lastSimulation else {
            return "없음"
        }
        let state = simulation.passed ? "통과" : "차단"
        let freshness = simulationIsStale(config) ? "재검증 필요" : "현재"
        return "\(state) · \(freshness) · \(simulation.summary)"
    }

    private static func simulationIsStale(_ config: StrategyConfigView) -> Bool {
        guard let hash = config.currentConfigHash, let simulationHash = config.lastSimulation?.configHash else {
            return false
        }
        return hash != simulationHash
    }

    private static func simulationLabel(_ simulation: StrategySimulationResultView?) -> String {
        guard let simulation else {
            return "없음"
        }
        return "\(simulation.riskCheck.passed ? "통과" : "차단") · \(simulation.summary)"
    }

    private static func nextActions(for input: StrategyOperationReportInput) -> [String] {
        var actions: [String] = []
        if !input.sidecarOK {
            actions.append("앱에서 sidecar를 시작한 뒤 전략 목록을 새로고침하세요.")
        }
        if input.configs.isEmpty {
            actions.append("전략 화면에서 순환분할 또는 사용자 지정 초안을 저장하세요.")
        }
        if input.configs.contains(where: { $0.lastSimulation?.passed != true || simulationIsStale($0) }) {
            actions.append("활성화 전 각 전략의 시뮬레이션을 실행하고 현재 설정과 일치하는지 확인하세요.")
        }
        if !input.configs.contains(where: { $0.status == "enabled" }) {
            actions.append("시뮬레이션 통과 후 사용할 전략을 활성화하세요.")
        }
        if input.killSwitchEngaged {
            actions.append("자동화 실행 전 긴급 중지가 의도된 상태인지 확인하세요.")
        }
        if input.workerPaused {
            actions.append("자동화 실행 전 워커 일시중지가 의도된 상태인지 확인하세요.")
        }
        if !input.liveTradingEffective {
            actions.append("실거래는 Toss credential, 계좌 선택, live gate, OrderIntent, RiskCheck가 모두 통과해야 제출됩니다.")
        }
        if input.configs.contains(where: { $0.status == "enabled" }) {
            actions.append("주문·리스크 탭에서 자동화 점검 dry-run을 먼저 실행하세요.")
        }
        if actions.isEmpty {
            actions.append("자동화 점검 dry-run과 사전검증을 통과한 뒤에도 실거래 제출은 별도 확인하세요.")
        }
        return actions
    }

    private static func presetLabel(_ preset: String?) -> String {
        switch preset {
        case "magic-split": return "순환분할"
        case "one-percent-loop": return "1% 순환"
        case "defensive-split": return "보수 분할"
        case "custom": return "사용자 지정"
        case "box-range": return "박스/분할"
        case "support-rebound": return "지지반등"
        default: return "커스텀"
        }
    }

    private static func modeLabel(_ mode: String?) -> String {
        switch mode {
        case "loop-grid": return "순환"
        case "percent-grid": return "분할"
        default: return "사다리"
        }
    }

    private static func statusLabel(_ status: String) -> String {
        switch status {
        case "enabled": return "활성"
        case "disabled": return "일시정지"
        default: return "초안"
        }
    }

    private static func formatNumber(_ value: Double) -> String {
        guard value.isFinite else {
            return "-"
        }
        return String(format: "%.2f", value)
    }
}
