import Darwin
import Foundation

public enum SidecarStartupPhase: String, Sendable {
    case stopped
    case preparing
    case starting
    case ready
    case failed
}

public enum SidecarStartupFailureCode: String, Sendable {
    case missingBundle
    case launchDenied
    case earlyExit
    case healthTimeout
    case unknown
}

public struct SidecarStartupDiagnostic: Equatable, Sendable {
    public let phase: SidecarStartupPhase
    public let failureCode: SidecarStartupFailureCode?
    public let message: String
    public let recoveryAction: String?
    public let exitCode: Int32?

    public init(
        phase: SidecarStartupPhase,
        failureCode: SidecarStartupFailureCode?,
        message: String,
        recoveryAction: String?,
        exitCode: Int32?
    ) {
        self.phase = phase
        self.failureCode = failureCode
        self.message = message
        self.recoveryAction = recoveryAction
        self.exitCode = exitCode
    }

    public static let stopped = SidecarStartupDiagnostic(
        phase: .stopped,
        failureCode: nil,
        message: "분석 엔진이 아직 시작되지 않았습니다.",
        recoveryAction: "엔진을 시작한 뒤 다시 시도하세요.",
        exitCode: nil
    )

    public static let preparing = SidecarStartupDiagnostic(
        phase: .preparing,
        failureCode: nil,
        message: "분석 엔진을 준비하고 있습니다.",
        recoveryAction: nil,
        exitCode: nil
    )

    public static let starting = SidecarStartupDiagnostic(
        phase: .starting,
        failureCode: nil,
        message: "분석 엔진 연결을 기다리고 있습니다.",
        recoveryAction: nil,
        exitCode: nil
    )

    public static let ready = SidecarStartupDiagnostic(
        phase: .ready,
        failureCode: nil,
        message: "분석 엔진이 준비되었습니다.",
        recoveryAction: nil,
        exitCode: nil
    )

    public static func missingBundle() -> SidecarStartupDiagnostic {
        SidecarStartupDiagnostic(
            phase: .failed,
            failureCode: .missingBundle,
            message: "앱에 필요한 분석 엔진 파일이 없습니다.",
            recoveryAction: "배포 파일을 다시 받아 Applications 폴더에 설치하세요.",
            exitCode: nil
        )
    }

    public static func launchDenied() -> SidecarStartupDiagnostic {
        SidecarStartupDiagnostic(
            phase: .failed,
            failureCode: .launchDenied,
            message: "macOS가 분석 엔진 실행을 허용하지 않았습니다.",
            recoveryAction: "정식 서명된 설치본인지 확인한 뒤 앱을 다시 설치하세요.",
            exitCode: nil
        )
    }

    public static func earlyExit(code: Int32) -> SidecarStartupDiagnostic {
        SidecarStartupDiagnostic(
            phase: .failed,
            failureCode: .earlyExit,
            message: "분석 엔진이 준비되기 전에 종료되었습니다. 종료 코드: \(code)",
            recoveryAction: "로그를 확인한 뒤 엔진을 다시 시작하세요.",
            exitCode: code
        )
    }

    public static func healthTimeout() -> SidecarStartupDiagnostic {
        SidecarStartupDiagnostic(
            phase: .failed,
            failureCode: .healthTimeout,
            message: "15초 안에 분석 엔진 연결을 확인하지 못했습니다.",
            recoveryAction: "로그를 확인한 뒤 엔진을 다시 시작하세요.",
            exitCode: nil
        )
    }

    public static func launchFailure(_ error: Error) -> SidecarStartupDiagnostic {
        let nsError = error as NSError
        let permissionCodes = [Int(EPERM), Int(EACCES)]
        if nsError.domain == NSPOSIXErrorDomain && permissionCodes.contains(nsError.code) {
            return launchDenied()
        }
        let normalized = nsError.localizedDescription.lowercased()
        if normalized.contains("permission") || normalized.contains("operation not permitted") {
            return launchDenied()
        }
        return SidecarStartupDiagnostic(
            phase: .failed,
            failureCode: .unknown,
            message: "분석 엔진을 시작하지 못했습니다.",
            recoveryAction: "로그를 확인한 뒤 엔진을 다시 시작하세요.",
            exitCode: nil
        )
    }

    public var displayMessage: String {
        [message, recoveryAction].compactMap { $0 }.joined(separator: " ")
    }
}
