import Foundation

public struct MenuBarStatusReportInput: Sendable {
    public let sidecarAvailable: Bool
    public let sidecarOK: Bool
    public let statusLine: String
    public let liveGateLabel: String
    public let killSwitchEngaged: Bool
    public let workerPaused: Bool
    public let latestAlertTitles: [String]
    public let latestAlertCount: Int
    public let hasHighImportanceAlert: Bool

    public init(
        sidecarAvailable: Bool,
        sidecarOK: Bool,
        statusLine: String,
        liveGateLabel: String,
        killSwitchEngaged: Bool,
        workerPaused: Bool,
        latestAlertTitles: [String] = [],
        latestAlertCount: Int = 0,
        hasHighImportanceAlert: Bool = false
    ) {
        self.sidecarAvailable = sidecarAvailable
        self.sidecarOK = sidecarOK
        self.statusLine = statusLine
        self.liveGateLabel = liveGateLabel
        self.killSwitchEngaged = killSwitchEngaged
        self.workerPaused = workerPaused
        self.latestAlertTitles = latestAlertTitles
        self.latestAlertCount = latestAlertCount
        self.hasHighImportanceAlert = hasHighImportanceAlert
    }
}

public struct MenuBarStatusSnapshot: Equatable, Sendable {
    public let headline: String
    public let sidecarLabel: String
    public let sidecarOK: Bool
    public let liveGateLabel: String
    public let workerLabel: String
    public let primaryActionTitle: String
    public let isNewsActionEnabled: Bool
    public let killSwitchActionTitle: String
    public let alertSummary: String
    public let latestAlertTitles: [String]
}

public enum MenuBarStatusReport {
    public static func make(from input: MenuBarStatusReportInput) -> MenuBarStatusSnapshot {
        let cleanedStatus = input.statusLine.trimmingCharacters(in: .whitespacesAndNewlines)
        let latestAlertTitles = Array(input.latestAlertTitles.prefix(4))

        return MenuBarStatusSnapshot(
            headline: input.killSwitchEngaged ? "긴급 중지 활성" : (cleanedStatus.isEmpty ? "sidecar stopped" : cleanedStatus),
            sidecarLabel: input.sidecarOK ? "Sidecar 정상" : "오프라인",
            sidecarOK: input.sidecarOK,
            liveGateLabel: input.liveGateLabel,
            workerLabel: input.workerPaused ? "워커 일시중지" : "워커 감시",
            primaryActionTitle: input.sidecarAvailable ? "상태 갱신" : "엔진 시작",
            isNewsActionEnabled: input.sidecarAvailable,
            killSwitchActionTitle: input.killSwitchEngaged ? "긴급 중지 해제" : "긴급 중지",
            alertSummary: alertSummary(for: input),
            latestAlertTitles: latestAlertTitles
        )
    }

    private static func alertSummary(for input: MenuBarStatusReportInput) -> String {
        guard input.latestAlertCount > 0 else {
            return "알림 후보 없음"
        }
        if input.hasHighImportanceAlert {
            return "긴급 \(input.latestAlertCount)개"
        }
        return "알림 후보 \(input.latestAlertCount)개"
    }
}
