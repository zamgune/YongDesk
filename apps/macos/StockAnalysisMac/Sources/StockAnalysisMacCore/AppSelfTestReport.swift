import Foundation

public struct AppSelfTestReportInput: Sendable {
    public let generatedAt: String
    public let sidecarOK: Bool
    public let selfTest: LocalSelfTestResponse?
    public let liveGateState: String
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool
    public let releaseReadiness: String?

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        sidecarOK: Bool,
        selfTest: LocalSelfTestResponse?,
        liveGateState: String,
        killSwitchEngaged: Bool,
        workerPaused: Bool,
        releaseReadiness: String? = nil
    ) {
        self.generatedAt = generatedAt
        self.sidecarOK = sidecarOK
        self.selfTest = selfTest
        self.liveGateState = liveGateState
        self.killSwitchEngaged = killSwitchEngaged
        self.workerPaused = workerPaused
        self.releaseReadiness = releaseReadiness
    }
}

public enum AppSelfTestReport {
    public static func make(from input: AppSelfTestReportInput) -> String {
        var lines = [
            "Yong'Desk 앱 점검 리포트",
            "생성: \(input.generatedAt)",
            "주의: 이 리포트는 로컬 앱/sidecar 상태 요약이며 API secret, 계좌 원문, 주문 제출 내역을 포함하지 않습니다.",
            "",
            "[상태]",
            "- Sidecar: \(input.sidecarOK ? "정상" : "오프라인")",
            "- Live gate: \(input.liveGateState)",
            "- Kill switch: \(input.killSwitchEngaged ? "ON" : "OFF")",
            "- 워커: \(input.workerPaused ? "일시중지" : "감시")",
            "- 배포 상태: \(input.releaseReadiness ?? "미확인")",
        ]

        if let selfTest = input.selfTest {
            lines.append(contentsOf: [
                "- 앱 점검: \(overallLabel(selfTest.overall))",
                "- 항목: 전체 \(selfTest.summary.total) · 통과 \(selfTest.summary.pass) · 경고 \(selfTest.summary.warn) · 실패 \(selfTest.summary.fail) · 차단 실패 \(selfTest.summary.blockingFailures)",
                "",
                "[확인 필요]",
            ])
            let attention = selfTest.checks.filter { $0.status != "pass" }
            if attention.isEmpty {
                lines.append("- 확인 필요 항목 없음")
            } else {
                for check in attention.prefix(12) {
                    lines.append("- \(check.label): \(statusLabel(check.status)) · \(check.summary)")
                    lines.append("  다음: \(check.action)")
                }
                let remaining = attention.count - min(attention.count, 12)
                if remaining > 0 {
                    lines.append("- 외 \(remaining)개 확인 필요 항목 생략")
                }
            }

            lines.append("")
            lines.append("[전체 점검 항목]")
            for check in selfTest.checks.prefix(30) {
                lines.append("- \(check.label): \(statusLabel(check.status)) · \(check.summary)")
            }
            let remaining = selfTest.checks.count - min(selfTest.checks.count, 30)
            if remaining > 0 {
                lines.append("- 외 \(remaining)개 점검 항목 생략")
            }
        } else {
            lines.append(contentsOf: [
                "- 앱 점검: 미실행",
                "",
                "[확인 필요]",
                "- 앱 점검 시트에서 점검 실행을 먼저 누르세요.",
            ])
        }

        lines.append("")
        lines.append("[다음 조치]")
        lines.append(contentsOf: nextActions(for: input).map { "- \($0)" })

        return lines.joined(separator: "\n")
    }

    private static func nextActions(for input: AppSelfTestReportInput) -> [String] {
        var actions: [String] = []
        if !input.sidecarOK {
            actions.append("엔진 시작을 눌러 local sidecar를 시작한 뒤 앱 점검을 다시 실행하세요.")
        }
        if input.selfTest == nil {
            actions.append("앱 점검 실행 후 실패/경고 항목을 확인하세요.")
        }
        if let selfTest = input.selfTest {
            if selfTest.summary.blockingFailures > 0 {
                actions.append("차단 실패 항목은 로그 열기에서 sidecar 로그를 확인하고 먼저 해결하세요.")
            }
            if selfTest.summary.warn > 0 {
                actions.append("경고 항목은 Toss credential, 공인 IP, live gate, 뉴스 provider 상태를 순서대로 확인하세요.")
            }
            if selfTest.summary.fail == 0 && selfTest.summary.blockingFailures == 0 {
                actions.append("자동거래 전 전략 시뮬레이션, 주문·리스크 dry-run, Toss 사전검증을 순서대로 다시 실행하세요.")
            }
        }
        if input.killSwitchEngaged {
            actions.append("자동화 실행 전 긴급 중지가 의도된 상태인지 확인하세요.")
        }
        if input.workerPaused {
            actions.append("자동화 실행 전 워커 일시중지가 의도된 상태인지 확인하세요.")
        }
        if input.releaseReadiness?.contains("외부 배포") != true {
            actions.append("다른 Mac에 경고 없이 배포하려면 Developer ID 서명과 Apple 공증을 완료하세요.")
        }
        if !input.liveGateState.contains("ON") && !input.liveGateState.contains("준비") {
            actions.append("실거래는 Toss credential, 계좌 선택, 사용자 토글, ENABLE_LIVE_TRADING, kill switch가 모두 통과해야 합니다.")
        }
        return unique(actions)
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    private static func overallLabel(_ status: String) -> String {
        switch status {
        case "pass": return "통과"
        case "warn": return "확인 필요"
        case "fail": return "실패"
        default: return status
        }
    }

    private static func statusLabel(_ status: String) -> String {
        switch status {
        case "pass": return "통과"
        case "warn": return "경고"
        case "fail": return "실패"
        default: return status
        }
    }
}
