import Foundation

public struct TossOperationReportInput: Sendable {
    public let generatedAt: String
    public let sidecarOK: Bool
    public let credential: BrokerCredentialView?
    public let keychainCredentialStored: Bool
    public let accountPreference: BrokerAccountPreferenceView?
    public let accountCount: Int
    public let diagnostics: BrokerDiagnosticsResponse?
    public let localLiveTrading: LocalLiveTradingState?
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool
    public let liveTradingOperatorEnabled: Bool

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        sidecarOK: Bool,
        credential: BrokerCredentialView?,
        keychainCredentialStored: Bool,
        accountPreference: BrokerAccountPreferenceView?,
        accountCount: Int,
        diagnostics: BrokerDiagnosticsResponse?,
        localLiveTrading: LocalLiveTradingState?,
        killSwitchEngaged: Bool,
        workerPaused: Bool,
        liveTradingOperatorEnabled: Bool
    ) {
        self.generatedAt = generatedAt
        self.sidecarOK = sidecarOK
        self.credential = credential
        self.keychainCredentialStored = keychainCredentialStored
        self.accountPreference = accountPreference
        self.accountCount = accountCount
        self.diagnostics = diagnostics
        self.localLiveTrading = localLiveTrading
        self.killSwitchEngaged = killSwitchEngaged
        self.workerPaused = workerPaused
        self.liveTradingOperatorEnabled = liveTradingOperatorEnabled
    }
}

public enum TossOperationReport {
    public static func make(from input: TossOperationReportInput) -> String {
        var lines = [
            "Toss 운영 리포트",
            "생성: \(input.generatedAt)",
            "민감정보: client secret/access token/refresh token/원본 계좌번호 미포함",
            "",
            "[상태]",
            "- Sidecar: \(input.sidecarOK ? "정상" : "필요")",
            "- Credential: \(credentialLabel(input.credential))",
            "- Keychain 백업: \(input.keychainCredentialStored ? "있음" : "없음")",
            "- 자동거래 계좌: \(accountLabel(input.accountPreference))",
            "- 계좌 조회 수: \(input.accountCount)",
            "- 공인 IP: \(egressLabel(input.diagnostics?.egress))",
            "- 로컬 운영자 게이트 ENABLE_LIVE_TRADING: \(input.liveTradingOperatorEnabled ? "ON" : "OFF")",
            "- 사용자 실거래 토글: \(input.localLiveTrading?.userEnabled == true ? "ON" : "OFF")",
            "- 실거래 유효 상태: \(effectiveLiveTrading(input) ? "가능" : "차단")",
            "- Kill switch: \(input.killSwitchEngaged ? "ON" : "OFF")",
            "- 워커: \(input.workerPaused ? "일시중지" : "감시")",
            "- Readiness: \(input.diagnostics?.liveGate.readinessOverall ?? "미확인")",
            "- Gate 사유: \(input.diagnostics?.liveGate.gateReason ?? input.localLiveTrading?.reason ?? "차단 사유 없음")",
            "- 저장소: \(input.diagnostics?.liveGate.storageRoot ?? input.localLiveTrading?.storageRoot ?? "앱 로컬 저장소")",
            "",
            "[다음 조치]",
        ]

        lines.append(contentsOf: nextActions(for: input).map { "- \($0)" })
        return lines.joined(separator: "\n")
    }

    private static func credentialLabel(_ credential: BrokerCredentialView?) -> String {
        guard let credential else {
            return "미등록"
        }
        return "\(credentialStatusLabel(credential.status)) (\(credential.broker.uppercased()) \(credential.maskedIdentifier), 업데이트 \(credential.updatedAt))"
    }

    private static func credentialStatusLabel(_ status: String) -> String {
        switch status {
        case "verified": return "검증 완료"
        case "pending": return "검증 대기"
        case "failed": return "검증 실패"
        default: return status
        }
    }

    private static func accountLabel(_ account: BrokerAccountPreferenceView?) -> String {
        guard let account else {
            return "미선택"
        }
        return "#\(account.accountSeq) \(maskedAccountNo(account.accountNo)) \(account.accountType)"
    }

    private static func maskedAccountNo(_ accountNo: String) -> String {
        let trimmed = accountNo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return "****"
        }
        let suffix = trimmed.suffix(min(4, trimmed.count))
        return "****\(suffix)"
    }

    private static func egressLabel(_ egress: BrokerDiagnosticsEgress?) -> String {
        guard let egress else {
            return "미확인"
        }
        if let ip = egress.ip, !ip.isEmpty {
            return "\(ip) (\(egress.message))"
        }
        switch egress.status {
        case "not-requested": return "미조회 (\(egress.message))"
        case "skipped": return "조회 스킵 (\(egress.message))"
        case "failed": return "확인 실패 (\(egress.message))"
        default: return "\(egress.status) (\(egress.message))"
        }
    }

    private static func effectiveLiveTrading(_ input: TossOperationReportInput) -> Bool {
        input.localLiveTrading?.effective == true ||
            input.diagnostics?.liveGate.liveTradingEffective == true
    }

    private static func nextActions(for input: TossOperationReportInput) -> [String] {
        var actions: [String] = []

        if !input.sidecarOK {
            actions.append("앱에서 sidecar를 시작한 뒤 다시 상태 새로고침을 실행하세요.")
        }
        if input.credential?.status != "verified" {
            actions.append("Toss 시트에서 Client ID와 Client Secret을 검증 후 저장하세요.")
        }
        if input.credential?.status == "verified" && !input.keychainCredentialStored {
            actions.append("검증 완료 credential이 macOS Keychain에도 백업됐는지 확인하세요.")
        }
        if input.accountPreference == nil {
            actions.append("계좌 새로고침 후 자동거래에 사용할 BROKERAGE 계좌를 선택하세요.")
        }
        if input.diagnostics?.egress.ip == nil {
            actions.append("공인 IP 확인을 실행하고 Toss 개발자 콘솔 허용 IP와 맞추세요.")
        }
        if !input.liveTradingOperatorEnabled || input.localLiveTrading?.masterEnabled == false {
            actions.append("실거래를 사용할 때만 로컬 운영자 게이트 ENABLE_LIVE_TRADING을 켜세요.")
        }
        if input.localLiveTrading?.userEnabled != true {
            actions.append("credential과 계좌 선택 후 사용자 실거래 토글을 명시적으로 켜세요.")
        }
        if input.killSwitchEngaged || input.diagnostics?.liveGate.killSwitchEngaged == true {
            actions.append("긴급 중지가 의도된 상태인지 확인하고, 주문 전 필요하면 해제하세요.")
        }
        if input.workerPaused || input.diagnostics?.liveGate.workerPaused == true {
            actions.append("자동화 실행 전 워커 일시중지가 의도된 상태인지 확인하세요.")
        }
        if actions.isEmpty {
            actions.append("주문 전 사전검증에서 OrderIntent, RiskCheck, 매수/매도 가능 수량을 확인하세요.")
        }

        return actions
    }
}
