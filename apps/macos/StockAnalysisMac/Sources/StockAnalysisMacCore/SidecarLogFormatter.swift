import Foundation

public struct SidecarLogPresentation: Equatable, Sendable {
    public let text: String
    public let scopeLabel: String
}

public enum SidecarLogFormatter {
    private static let sessionMarker = "--- sidecar start "

    public static func presentation(from rawText: String, skippedBytes: UInt64 = 0) -> SidecarLogPresentation {
        let trimmedText = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty else {
            return SidecarLogPresentation(text: "로그가 비어 있습니다.", scopeLabel: "로그 비어 있음")
        }

        if let latestSessionRange = rawText.range(of: sessionMarker, options: .backwards) {
            let latestSession = String(rawText[latestSessionRange.lowerBound...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !latestSession.isEmpty {
                return SidecarLogPresentation(text: latestSession, scopeLabel: "최근 세션")
            }
        }

        let prefix = skippedBytes > 0
            ? "... 앞부분 \(skippedBytes.formatted()) bytes 생략 ...\n"
            : ""
        return SidecarLogPresentation(text: "\(prefix)\(trimmedText)", scopeLabel: "최근 로그")
    }
}
