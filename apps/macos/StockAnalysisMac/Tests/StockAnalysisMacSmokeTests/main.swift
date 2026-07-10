import Foundation
import StockAnalysisMacCore

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("Smoke test failed: \(message)\n", stderr)
        exit(1)
    }
}

struct MockHTTPResponse {
    let statusCode: Int
    let body: String
}

struct CapturedHTTPRequest {
    let method: String
    let path: String
    let query: String?
    let body: String

    var pathWithQuery: String {
        if let query, !query.isEmpty {
            return "\(path)?\(query)"
        }
        return path
    }
}

final class EngineClientMockURLProtocolState: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [MockHTTPResponse] = []
    private var capturedRequests: [CapturedHTTPRequest] = []

    func reset(responses: [MockHTTPResponse]) {
        lock.lock()
        self.responses = responses
        self.capturedRequests = []
        lock.unlock()
    }

    func capture(_ request: URLRequest, url: URL) -> MockHTTPResponse {
        let bodyText: String
        if let body = request.httpBody {
            bodyText = String(data: body, encoding: .utf8) ?? ""
        } else if let bodyStream = request.httpBodyStream {
            bodyText = Self.read(stream: bodyStream)
        } else {
            bodyText = ""
        }
        lock.lock()
        capturedRequests.append(CapturedHTTPRequest(
            method: request.httpMethod ?? "GET",
            path: url.path,
            query: url.query,
            body: bodyText
        ))
        let response = responses.isEmpty
            ? MockHTTPResponse(statusCode: 500, body: #"{"error":"missing mock response"}"#)
            : responses.removeFirst()
        lock.unlock()
        return response
    }

    private static func read(stream: InputStream) -> String {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 {
                break
            }
            data.append(buffer, count: count)
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    func captured() -> [CapturedHTTPRequest] {
        lock.lock()
        let requests = capturedRequests
        lock.unlock()
        return requests
    }
}

final class EngineClientMockURLProtocol: URLProtocol {
    private static let state = EngineClientMockURLProtocolState()

    static func reset(responses: [MockHTTPResponse]) {
        state.reset(responses: responses)
    }

    static func captured() -> [CapturedHTTPRequest] {
        state.captured()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "127.0.0.1"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let response = Self.state.capture(request, url: url)

        let httpResponse = HTTPURLResponse(
            url: url,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.body.data(using: .utf8) ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

let root = FileManager.default.temporaryDirectory
    .appending(path: "StockAnalysisMacTests-\(UUID().uuidString)")
let store = try AppSupportStore(rootURL: root)
let settings = AppSettings(enginePort: 39_001, repositoryPath: "/tmp/repo", alertsEnabled: false, workerPaused: true)
try store.saveSettings(settings)
assert(store.loadSettings() == settings, "settings should round-trip through App Support JSON")

let overrideRoot = FileManager.default.temporaryDirectory
    .appending(path: "StockAnalysisMacOverride-\(UUID().uuidString)")
setenv(AppSupportStore.rootOverrideEnvironmentKey, overrideRoot.path(percentEncoded: false), 1)
let overrideStore = try AppSupportStore()
unsetenv(AppSupportStore.rootOverrideEnvironmentKey)
assert(
    overrideStore.rootURL.standardizedFileURL == overrideRoot.standardizedFileURL,
    "app support root override should isolate UI verification storage"
)

let legacySettingsJSON = """
{
  "enginePort": 39002,
  "repositoryPath": "/tmp/legacy-repo",
  "alertsEnabled": false,
  "workerPaused": true
}
""".data(using: .utf8)!
let legacySettings = try JSONDecoder().decode(AppSettings.self, from: legacySettingsJSON)
assert(legacySettings.enginePort == 39_002, "legacy settings should decode engine port")
assert(legacySettings.liveTradingOperatorEnabled == false, "legacy settings should default live trading operator gate off")

let databaseURL = root.appending(path: "stock-analysis.sqlite3")
let database = LocalSQLiteStore(databaseURL: databaseURL)
try database.migrate()
assert(FileManager.default.fileExists(atPath: databaseURL.path(percentEncoded: false)), "SQLite migration should create database")

let risingRSI = AnalysisIndicators.relativeStrengthIndex(
    closes: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]
)
assert(risingRSI == 100, "RSI should report 100 for a fully rising 14-period sequence")

let flatRSI = AnalysisIndicators.relativeStrengthIndex(
    closes: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
)
assert(flatRSI == 50, "RSI should report neutral 50 for a flat sequence")

let insufficientRSI = AnalysisIndicators.relativeStrengthIndex(closes: [100, 101, 102], period: 14)
assert(insufficientRSI == nil, "RSI should be nil when there are not enough closes")

let healthJSON = """
{
  "ok": true,
  "engine": "stock-analysis-local-engine",
  "version": "0.1.0",
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "storageRoot": "/tmp/stock-analysis",
  "localUserId": "local-macos-user",
  "pid": 1234,
  "workingDirectory": "/Applications/StockAnalysis.app/Contents/Resources/sidecar",
  "sidecarBuildId": "build-1"
}
""".data(using: .utf8)!
let health = try JSONDecoder().decode(EngineHealth.self, from: healthJSON)
assert(health.pid == 1234, "health should decode sidecar pid")
assert(health.sidecarBuildId == "build-1", "health should decode sidecar build id")

let legacyBrokerCredentialJSON = """
{
  "credential": null
}
""".data(using: .utf8)!
let legacyBrokerCredential = try JSONDecoder().decode(BrokerCredentialResponse.self, from: legacyBrokerCredentialJSON)
assert(legacyBrokerCredential.credential == nil, "legacy broker response should decode nil credential")
assert(legacyBrokerCredential.accounts == nil, "legacy broker response should keep missing accounts optional")
assert(legacyBrokerCredential.accountPreference == nil, "legacy broker response should keep missing account preference optional")
assert(legacyBrokerCredential.accountsError == nil, "legacy broker response should keep missing accounts error optional")

let verifiedBrokerCredentialJSON = """
{
  "credential": {
    "broker": "toss",
    "maskedIdentifier": "cli***001",
    "status": "verified",
    "lastVerifiedAt": "2026-07-09T00:00:00.000Z",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "accounts": [
    {
      "accountNo": "1234567890",
      "accountSeq": 7,
      "accountType": "BROKERAGE"
    }
  ],
  "accountPreference": {
    "broker": "toss",
    "accountNo": "1234567890",
    "accountSeq": 7,
    "accountType": "BROKERAGE",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "accountsError": null
}
""".data(using: .utf8)!
let verifiedBrokerCredential = try JSONDecoder().decode(BrokerCredentialResponse.self, from: verifiedBrokerCredentialJSON)

let brokerDiagnosticsJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "userId": "local-macos-user",
  "credential": {
    "broker": "toss",
    "maskedIdentifier": "cli***001",
    "status": "verified",
    "lastVerifiedAt": "2026-07-09T00:00:00.000Z",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "egress": {
    "status": "ok",
    "ip": "203.0.113.10",
    "message": "공인 IP 확인 완료",
    "checkedAt": "2026-07-09T00:00:00.000Z"
  },
  "liveGate": {
    "enableLiveTrading": true,
    "credentialEncryptionConfigured": true,
    "storageRoot": "/tmp/stock-analysis",
    "automationOverall": "pass",
    "readinessOverall": "pass",
    "automationBeta": true,
    "brokerCredentials": true,
    "accountPreferenceSelected": true,
    "userLiveTrading": true,
    "liveTradingEffective": true,
    "rawLiveTradingEffective": true,
    "gateStatus": 200,
    "gateReason": null,
    "killSwitchEngaged": false,
    "killSwitchReason": null,
    "workerPaused": false,
    "workerPauseReason": null,
    "automationQueueReady": true
  },
  "readinessItems": [],
  "guidance": []
}
""".data(using: .utf8)!
let brokerDiagnostics = try JSONDecoder().decode(BrokerDiagnosticsResponse.self, from: brokerDiagnosticsJSON)

let tossReadinessJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "ok": true,
  "status": "account-ready",
  "checkedAt": "2026-07-09T00:00:00.000Z",
  "orderSubmissionAttempted": false,
  "credentials": {
    "present": true,
    "clientIdMasked": "cli...01"
  },
  "selectedAccount": {
    "accountSeq": 7,
    "accountType": "BROKERAGE",
    "accountNoMasked": "****-7890"
  },
  "accountHeaderVerified": true,
  "readonlyChecks": {
    "token": true,
    "accounts": true,
    "holdings": true,
    "openOrders": true
  },
  "summary": "Toss 토큰, 계좌 목록, 보유 조회, 미체결 조회가 주문 없이 통과했습니다.",
  "guidance": ["주문 생성 API는 호출하지 않았습니다."],
  "toss": null,
  "credential": {
    "broker": "toss",
    "maskedIdentifier": "cli***001",
    "status": "verified",
    "lastVerifiedAt": "2026-07-09T00:00:00.000Z",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "accountPreference": {
    "broker": "toss",
    "accountNo": "1234567890",
    "accountSeq": 7,
    "accountType": "BROKERAGE",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "automationAccountSelected": true,
  "automationReady": true
}
""".data(using: .utf8)!
let tossReadiness = try JSONDecoder().decode(TossReadinessResponse.self, from: tossReadinessJSON)
assert(tossReadiness.ok == true, "Toss readiness should decode ready state")
assert(tossReadiness.orderSubmissionAttempted == false, "Toss readiness should preserve no-order invariant")
assert(tossReadiness.readonlyChecks.openOrders == true, "Toss readiness should decode read-only account checks")

let localLiveTradingJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "credential": {
    "broker": "toss",
    "maskedIdentifier": "cli***001",
    "status": "verified",
    "lastVerifiedAt": "2026-07-09T00:00:00.000Z",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  },
  "liveTrading": {
    "masterEnabled": true,
    "userEnabled": true,
    "effective": true,
    "status": 200,
    "reason": null,
    "featureEnabled": true,
    "localRuntime": true,
    "storageRoot": "/tmp/stock-analysis"
  },
  "guidance": []
}
""".data(using: .utf8)!
let localLiveTrading = try JSONDecoder().decode(LocalLiveTradingResponse.self, from: localLiveTradingJSON)
let tossReport = TossOperationReport.make(from: TossOperationReportInput(
    generatedAt: "2026-07-09T00:00:00.000Z",
    sidecarOK: true,
    credential: verifiedBrokerCredential.credential,
    keychainCredentialStored: true,
    accountPreference: verifiedBrokerCredential.accountPreference,
    accountCount: verifiedBrokerCredential.accounts?.count ?? 0,
    diagnostics: brokerDiagnostics,
    localLiveTrading: localLiveTrading.liveTrading,
    killSwitchEngaged: false,
    workerPaused: false,
    liveTradingOperatorEnabled: true
))
assert(tossReport.contains("Toss 운영 리포트"), "Toss operation report should include title")
assert(tossReport.contains("cli***001"), "Toss operation report should include masked credential identifier")
assert(tossReport.contains("#7 ****7890 BROKERAGE"), "Toss operation report should mask account number")
assert(tossReport.contains("OrderIntent"), "Toss operation report should keep order safety reminder when ready")
assert(!tossReport.contains("1234567890"), "Toss operation report should not include raw account number")
assert(!tossReport.contains("clientSecret"), "Toss operation report should not include secret field names")

let keychain = KeychainCredentialStore(service: "com.stockanalysis.mac.tests.\(UUID().uuidString)")
let dummyCredential = BrokerCredential(clientId: "test-client", clientSecret: "test-secret")
try keychain.save(dummyCredential)
let savedKeychainCredential = try keychain.read(broker: "toss")
assert(savedKeychainCredential == dummyCredential, "keychain should round-trip broker credential")
try keychain.delete(broker: "toss")
let deletedKeychainCredential = try keychain.read(broker: "toss")
assert(deletedKeychainCredential == nil, "keychain delete should remove broker credential")
let cryptoCredential = BrokerCredential(broker: "upbit", clientId: "upbit-access", clientSecret: "upbit-secret")
try keychain.save(cryptoCredential)
let savedUpbitCredential = try keychain.read(broker: "upbit")
let savedBithumbCredential = try keychain.read(broker: "bithumb")
assert(savedUpbitCredential == cryptoCredential, "keychain should isolate Upbit credential")
assert(savedBithumbCredential == nil, "keychain should keep exchanges isolated")
try keychain.delete(broker: "upbit")

let selfTestJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "overall": "warn",
  "summary": {
    "total": 2,
    "pass": 1,
    "warn": 1,
    "fail": 0,
    "blockingFailures": 0
  },
  "checks": [
    {
      "id": "sidecar-health",
      "label": "Sidecar HTTP",
      "status": "pass",
      "summary": "응답 중",
      "action": "정상입니다.",
      "blocking": true,
      "durationMs": 1
    },
    {
      "id": "toss-live-gate",
      "label": "Toss 실거래 게이트",
      "status": "warn",
      "summary": "Toss credential이 준비되지 않았습니다.",
      "action": "Toss 시트에서 확인하세요.",
      "blocking": false,
      "durationMs": 3
    }
  ]
}
""".data(using: .utf8)!
let selfTest = try JSONDecoder().decode(LocalSelfTestResponse.self, from: selfTestJSON)
assert(selfTest.overall == "warn", "self-test should decode overall status")
assert(selfTest.summary.blockingFailures == 0, "self-test should decode summary")
assert(selfTest.checks.count == 2, "self-test should decode checks")
let selfTestReport = AppSelfTestReport.make(from: AppSelfTestReportInput(
    generatedAt: "2026-07-09T00:00:00.000Z",
    sidecarOK: true,
    selfTest: selfTest,
    liveGateState: "실거래 게이트 OFF",
    killSwitchEngaged: false,
    workerPaused: false,
    releaseReadiness: "로컬 테스트 빌드"
))
assert(selfTestReport.contains("StockAnalysis 앱 점검 리포트"), "app self-test report should include title")
assert(selfTestReport.contains("Toss 실거래 게이트"), "app self-test report should include warning checks")
assert(selfTestReport.contains("Developer ID"), "app self-test report should include distribution next action")
assert(selfTestReport.contains("Toss credential"), "app self-test report should include live gate next action")
assert(!selfTestReport.contains("clientSecret"), "app self-test report should not include secret field names")

let offlineMenuBarReport = MenuBarStatusReport.make(from: MenuBarStatusReportInput(
    sidecarAvailable: false,
    sidecarOK: false,
    statusLine: "sidecar stopped",
    liveGateLabel: "실거래 게이트 OFF",
    killSwitchEngaged: false,
    workerPaused: false
))
assert(offlineMenuBarReport.headline == "sidecar stopped", "offline menu bar should keep status line")
assert(offlineMenuBarReport.sidecarLabel == "오프라인", "offline menu bar should show offline sidecar")
assert(offlineMenuBarReport.primaryActionTitle == "엔진 시작", "offline menu bar should offer sidecar start")
assert(!offlineMenuBarReport.isNewsActionEnabled, "offline menu bar should disable news refresh")
assert(offlineMenuBarReport.killSwitchActionTitle == "긴급 중지", "offline menu bar should offer kill switch engagement")
assert(offlineMenuBarReport.alertSummary == "알림 후보 없음", "offline menu bar should show no alert candidates")

let activeMenuBarReport = MenuBarStatusReport.make(from: MenuBarStatusReportInput(
    sidecarAvailable: true,
    sidecarOK: true,
    statusLine: "sidecar ready",
    liveGateLabel: "긴급 중지",
    killSwitchEngaged: true,
    workerPaused: true,
    latestAlertTitles: ["FOMC 의사록 발표", "NVDA 실적 발표", "TSLA 리콜 공시", "AAPL 공급망 뉴스", "생략될 뉴스"],
    latestAlertCount: 5,
    hasHighImportanceAlert: true
))
assert(activeMenuBarReport.headline == "긴급 중지 활성", "kill switch menu bar should override headline")
assert(activeMenuBarReport.sidecarLabel == "Sidecar 정상", "active menu bar should show healthy sidecar")
assert(activeMenuBarReport.primaryActionTitle == "상태 갱신", "active menu bar should refresh health instead of starting sidecar")
assert(activeMenuBarReport.isNewsActionEnabled, "active menu bar should allow news refresh")
assert(activeMenuBarReport.workerLabel == "워커 일시중지", "active menu bar should expose worker paused state")
assert(activeMenuBarReport.killSwitchActionTitle == "긴급 중지 해제", "active menu bar should offer kill switch release")
assert(activeMenuBarReport.alertSummary == "긴급 5개", "active menu bar should summarize high-importance alerts")
assert(activeMenuBarReport.latestAlertTitles.count == 4, "active menu bar should cap visible alert titles")

let sidecarLogPresentation = SidecarLogFormatter.presentation(from: """
--- sidecar start 2026-07-09T00:00:00Z ---
old warning

--- sidecar start 2026-07-09T01:00:00Z ---
stock-analysis-local-engine listening on http://127.0.0.1:38771
""")
assert(sidecarLogPresentation.scopeLabel == "최근 세션", "sidecar log should prefer latest session")
assert(sidecarLogPresentation.text.contains("2026-07-09T01:00:00Z"), "sidecar log should include latest session timestamp")
assert(!sidecarLogPresentation.text.contains("old warning"), "sidecar log should hide older session noise")

let partialSidecarLogPresentation = SidecarLogFormatter.presentation(from: "request failed\nretrying", skippedBytes: 128)
assert(partialSidecarLogPresentation.scopeLabel == "최근 로그", "sidecar log without session marker should keep recent log scope")
assert(partialSidecarLogPresentation.text.hasPrefix("... 앞부분 128 bytes 생략 ..."), "sidecar log should keep truncation context")

let strategyConfigJSON = """
{
  "configs": [
    {
      "id": "strategy-1",
      "name": "NVDA 순환분할",
      "symbol": "NVDA",
      "market": "US",
      "preset": "magic-split",
      "status": "draft",
      "mode": "percent-grid",
      "currentPrice": 100,
      "currentConfigHash": "hash-1",
      "grid": {
        "basePrice": 100,
        "rungs": [
          { "index": 1, "buyDropPct": 1, "sellRisePct": 1, "notional": 1000 },
          { "index": 2, "buyDropPct": 2, "sellRisePct": 1, "notional": 1000 }
        ]
      },
      "priceAnchor": {
        "source": "manual",
        "price": 100,
        "capturedAt": null
      },
      "riskLimits": {
        "maxDailyBuys": 4,
        "maxDailySells": 4,
        "maxPositionValue": 2000,
        "maxLossPct": 10,
        "maxHoldHours": 8760
      },
      "automationReadiness": {
        "simulationCurrent": false,
        "simulationPassed": false,
        "paperAutomationReady": false,
        "liveSubmissionReady": false,
        "killSwitchEngaged": false,
        "workerPaused": false,
        "credentialVerified": false,
        "accountPreferenceSelected": false,
        "liveGateStatus": 403,
        "liveGateReason": "operator disabled",
        "blockers": ["전략 시뮬레이션을 먼저 실행하세요."],
        "liveBlockers": ["검증 완료된 Toss API 키가 없습니다."],
        "nextActions": ["전략 카드에서 시뮬레이션을 실행하세요."]
      },
      "lastSimulation": null,
      "updatedAt": "2026-07-09T00:00:00.000Z"
    }
  ]
}
""".data(using: .utf8)!
let strategyConfigs = try JSONDecoder().decode(StrategyConfigListResponse.self, from: strategyConfigJSON)
assert(strategyConfigs.configs.first?.grid?.rungs.count == 2, "strategy config should decode grid rungs")
assert(strategyConfigs.configs.first?.riskLimits?.maxLossPct == 10, "strategy config should decode risk limits")
assert(strategyConfigs.configs.first?.automationReadiness?.nextActions.count == 1, "strategy config should decode readiness actions")
let strategyReport = StrategyOperationReport.make(from: StrategyOperationReportInput(
    generatedAt: "2026-07-09T00:00:00.000Z",
    sidecarOK: true,
    configs: strategyConfigs.configs,
    latestSimulation: nil,
    latestTickPreview: nil,
    liveGateState: "실거래 게이트 OFF",
    liveTradingEffective: false,
    killSwitchEngaged: false,
    workerPaused: false
))
assert(strategyReport.contains("자동거래 전략 운영 리포트"), "strategy operation report should include title")
assert(strategyReport.contains("NVDA 순환분할"), "strategy operation report should include strategy name")
assert(strategyReport.contains("총 노출: 2000.00"), "strategy operation report should include total exposure")
assert(strategyReport.contains("전략 시뮬레이션을 먼저 실행하세요."), "strategy operation report should include readiness action")
assert(strategyReport.contains("OrderIntent"), "strategy operation report should keep live-order safety boundary")

let strategyExportJSON = """
{
  "schemaVersion": 1,
  "exportedAt": "2026-07-09T00:00:00.000Z",
  "source": "StockAnalysis macOS local-engine",
  "configCount": 1,
  "safety": {
    "credentialsIncluded": false,
    "accountPreferenceIncluded": false,
    "importedStatus": "draft",
    "importedSimulation": "discarded"
  },
  "configs": [
    {
      "sourceId": "strategy-1",
      "name": "NVDA 순환분할",
      "symbol": "NVDA",
      "market": "US",
      "preset": "magic-split",
      "mode": "percent-grid",
      "supportPrice": 90,
      "resistancePrice": 110,
      "currentPrice": 100,
      "grid": {
        "basePrice": 100,
        "rungs": [
          { "index": 1, "buyDropPct": 1, "sellRisePct": 1, "notional": 1000 }
        ]
      },
      "riskLimits": {
        "maxDailyBuys": 4,
        "maxDailySells": 4,
        "maxPositionValue": 2000,
        "maxLossPct": 10,
        "maxHoldHours": 8760
      },
      "exitRules": {
        "takeProfitPct": 0,
        "stopLossPct": 0,
        "rescueMode": "disable-only"
      }
    }
  ]
}
"""
let strategyExportBundle = try JSONDecoder().decode(StrategyExportBundle.self, from: strategyExportJSON.data(using: .utf8)!)
assert(strategyExportBundle.configCount == 1, "strategy export should decode config count")
assert(strategyExportBundle.safety.credentialsIncluded == false, "strategy export should not include credentials")
assert(strategyExportBundle.safety.importedStatus == "draft", "strategy export should document draft-only import")

let automationCycleJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "dryRun": true,
  "result": {
    "userId": "local-macos-user",
    "status": "preview",
    "reason": "paper-preview-no-credentials",
    "liveTradingEnabled": false,
    "accountSeq": null,
    "strategies": 1,
    "triggers": 1,
    "orders": 1,
    "submitted": 0,
    "rejected": 0,
    "blocked": 1,
    "errors": 0,
    "syncedOrders": 0,
    "newFills": 0,
    "safety": "dry-run: broker 제출 없음",
    "evaluations": [
      {
        "strategyId": "strategy-1",
        "name": "NVDA 순환분할",
        "symbol": "NVDA",
        "mode": "percent-grid",
        "marketPrice": 99,
        "triggers": 1,
        "orders": [
          {
            "stepId": "grid:buy:r1",
            "side": "buy",
            "limitPrice": 99,
            "quantity": 10,
            "clientOrderId": "client-order-1",
            "status": "blocked",
            "brokerOrderId": null,
            "message": "[실거래 비활성] 전송 차단"
          }
        ],
        "logs": [
          {
            "level": "warning",
            "stepId": "grid:buy:r1",
            "message": "[실거래 비활성] 전송 차단"
          }
        ],
        "summary": {
          "headline": "1개 조건 발동, 주문 후보 1건",
          "action": "buy",
          "mode": "분할 그리드",
          "safety": "dry-run: broker 제출 없음",
          "nextAction": "모의 자동화에서 먼저 검증하세요.",
          "nextEntryPrice": 99,
          "triggerDistancePct": 0,
          "submittedOrders": 0,
          "blockedOrders": 1,
          "rejectedOrders": 0,
          "errorOrders": 0,
          "blockers": ["[실거래 비활성] 전송 차단"],
          "scenario": "current"
        }
      }
    ]
  }
}
""".data(using: .utf8)!
let automationCycle = try JSONDecoder().decode(AutomationCycleResponseView.self, from: automationCycleJSON)
assert(automationCycle.dryRun == true, "automation cycle should decode dry-run flag")
assert(automationCycle.result.status == "preview", "automation cycle should decode preview status")
assert(automationCycle.result.evaluations?.first?.orders.first?.status == "blocked", "automation cycle should decode preview orders")
assert(automationCycle.result.evaluations?.first?.summary?.blockedOrders == 1, "automation cycle should decode evaluation summary")

let terminalDashboardJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "symbol": "NVDA",
  "session": "US",
  "orderIntent": {
    "id": "intent-1",
    "symbol": "NVDA",
    "side": "buy",
    "type": "limit",
    "quantity": 10,
    "limitPrice": 99,
    "stopPrice": 95,
    "currency": "USD",
    "status": "draft",
    "rationale": ["순환분할 1차 진입"],
    "createdAt": "2026-07-09T00:00:00.000Z"
  },
  "riskCheck": {
    "passed": false,
    "blockers": ["실거래 게이트 OFF"],
    "warnings": ["Toss credential 없음"],
    "maxPositionValue": 5000,
    "estimatedOrderValue": 990
  },
  "auditTrail": [
    {
      "id": "audit-1",
      "createdAt": "2026-07-09T00:00:00.000Z",
      "symbol": "NVDA",
      "type": "order-intent",
      "title": "OrderIntent 생성",
      "detail": "순환분할 dry-run",
      "state": "blocked",
      "orderIntentId": "intent-1"
    }
  ],
  "riskScenarios": [
    {
      "id": "scenario-1",
      "label": "지수 -2%",
      "shock": "SPX -2%",
      "estimatedPnl": -120,
      "severity": "medium"
    }
  ],
  "watchlistAlerts": [],
  "watchlistAlertEvaluations": [],
  "newsCredibility": [],
  "preTradeChecklist": [
    {
      "id": "live-gate",
      "title": "실거래 게이트",
      "detail": "ENABLE_LIVE_TRADING=false",
      "status": "block"
    }
  ],
  "replayEvents": [],
  "playbook": {
    "symbol": "NVDA",
    "thesis": "테스트",
    "entryRule": "사전검증 통과",
    "invalidationRule": "RiskCheck 차단",
    "addRule": "추가매수 금지",
    "trimRule": "수동 검토",
    "target": "paper-only",
    "workerMode": "paper-only",
    "updatedAt": "2026-07-09T00:00:00.000Z"
  }
}
""".data(using: .utf8)!
let terminalDashboard = try JSONDecoder().decode(TerminalDashboardSnapshot.self, from: terminalDashboardJSON)
let magicSplitDraft = OrderIntentStrategyDraftFactory.makeMagicSplitDraft(from: terminalDashboard, session: "US")
assert(magicSplitDraft != nil, "OrderIntent should create a magic split draft")
assert(magicSplitDraft?.name == "NVDA OrderIntent 순환분할", "magic split draft should use symbol and preset name")
assert(magicSplitDraft?.preset == "magic-split", "magic split draft should use magic-split preset")
assert(magicSplitDraft?.mode == "percent-grid", "magic split draft should use percent-grid mode")
assert(magicSplitDraft?.basePrice == 99, "magic split draft should use OrderIntent limit price")
assert(magicSplitDraft?.notional == 330, "magic split draft should split expected order value into three rungs")
assert(magicSplitDraft?.rungCount == 3, "magic split draft should create three rungs")
let reusableStrategyJSONString = """
{
  "id": "strategy-draft-1",
  "name": "NVDA OrderIntent 순환분할",
  "symbol": "NVDA",
  "market": "US",
  "preset": "magic-split",
  "status": "draft",
  "mode": "percent-grid",
  "currentPrice": 99,
  "currentConfigHash": null,
  "automationReadiness": null,
  "lastSimulation": null,
  "grid": {
    "basePrice": 99,
    "rungs": [
      { "index": 1, "buyDropPct": 1, "sellRisePct": 1.2, "notional": 330 },
      { "index": 2, "buyDropPct": 2, "sellRisePct": 1.2, "notional": 330 },
      { "index": 3, "buyDropPct": 3, "sellRisePct": 1.2, "notional": 330 }
    ]
  },
  "loop": null,
  "priceAnchor": null,
  "riskLimits": null,
  "updatedAt": "2026-07-09T00:01:00.000Z"
}
"""
let enabledStrategyJSON = reusableStrategyJSONString
    .replacingOccurrences(of: "strategy-draft-1", with: "strategy-enabled-1")
    .replacingOccurrences(of: "\"status\": \"draft\"", with: "\"status\": \"enabled\"")
    .replacingOccurrences(of: "2026-07-09T00:01:00.000Z", with: "2026-07-09T00:02:00.000Z")
let reusableStrategy = try JSONDecoder().decode(StrategyConfigView.self, from: reusableStrategyJSONString.data(using: .utf8)!)
let enabledStrategy = try JSONDecoder().decode(StrategyConfigView.self, from: enabledStrategyJSON.data(using: .utf8)!)
assert(
    OrderIntentStrategyDraftFactory.reusableDraft(in: [reusableStrategy], for: magicSplitDraft!)?.id == "strategy-draft-1",
    "OrderIntent strategy drafts should update a reusable draft"
)
assert(
    OrderIntentStrategyDraftFactory.reusableDraft(in: [enabledStrategy], for: magicSplitDraft!) == nil,
    "OrderIntent strategy drafts should not overwrite enabled strategies"
)

let localHoldingJSON = """
{
  "linked": false,
  "held": false,
  "symbol": "NVDA",
  "accountSeq": null,
  "name": null,
  "currency": "USD",
  "quantity": null,
  "averagePurchasePrice": null,
  "lastPrice": null,
  "marketValue": null,
  "profitLoss": null,
  "dailyProfitLoss": null,
  "message": "Toss credential을 먼저 등록하세요."
}
""".data(using: .utf8)!
let localHolding = try JSONDecoder().decode(LocalHoldingResponse.self, from: localHoldingJSON)

let orderPrecheckJSON = """
{
  "ok": false,
  "reason": "live gate blocked",
  "available": null,
  "symbol": "NVDA",
  "side": "buy",
  "quantity": 10,
  "price": 99,
  "currency": "USD",
  "accountSeq": 7,
  "riskCheck": {
    "passed": false,
    "blockers": ["실거래 게이트 OFF"],
    "warnings": ["Toss credential 없음"],
    "maxPositionValue": 5000,
    "estimatedOrderValue": 990
  },
  "liveTradingGate": {
    "effective": false,
    "masterEnabled": false,
    "userEnabled": false,
    "reason": "operator disabled"
  },
  "preview": {
    "id": "preview-1",
    "clientOrderId": "client-order-1",
    "accountSeq": 7,
    "symbol": "NVDA",
    "side": "buy",
    "orderType": "limit",
    "quantity": 10,
    "price": 99,
    "currency": "USD",
    "estimatedOrderValue": 990,
    "available": null,
    "ok": false,
    "blockers": ["실거래 게이트 OFF"],
    "warnings": ["Toss credential 없음"],
    "liveTradingEffective": false,
    "liveTradingBlockedReason": "operator disabled",
    "createdAt": "2026-07-09T00:00:00.000Z",
    "expiresAt": "2026-07-09T00:05:00.000Z",
    "submittedAt": null
  },
  "blockers": ["실거래 게이트 OFF"],
  "warnings": ["Toss credential 없음"],
  "submitReady": false,
  "message": "사전검증 차단"
}
""".data(using: .utf8)!
let orderPrecheck = try JSONDecoder().decode(LocalOrderPrecheckResponse.self, from: orderPrecheckJSON)
let orderRiskReport = OrderRiskOperationReport.make(from: OrderRiskOperationReportInput(
    generatedAt: "2026-07-09T00:00:00.000Z",
    sidecarOK: true,
    selectedSymbol: "NVDA",
    selectedSession: "US",
    dashboard: terminalDashboard,
    holding: localHolding,
    precheck: orderPrecheck,
    automationRun: automationCycle,
    resultPreview: "자동화 점검 요약\\n모드: 주문 제출 없음",
    liveGateState: "실거래 게이트 OFF",
    liveTradingEffective: false,
    killSwitchEngaged: false,
    workerPaused: false
))
assert(orderRiskReport.contains("주문·리스크 운영 리포트"), "order risk report should include title")
assert(orderRiskReport.contains("OrderIntent"), "order risk report should include OrderIntent section")
assert(orderRiskReport.contains("RiskCheck"), "order risk report should include RiskCheck section")
assert(orderRiskReport.contains("preview-1"), "order risk report should include precheck preview id")
assert(orderRiskReport.contains("dry-run"), "order risk report should include automation mode")
assert(orderRiskReport.contains("broker 주문 제출 기록이 아닙니다"), "order risk report should clarify no broker order submission")

let automationHealthJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "overall": "pass",
  "storageMode": "local"
}
"""

let newsResponseJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "newEvents": [],
  "events": [],
  "errors": [],
  "alertCandidates": []
}
"""

let killSwitchJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "killSwitch": {
    "engaged": false,
    "reason": null,
    "updatedAt": "2026-07-09T00:00:00.000Z",
    "updatedBy": "test",
    "blocks": ["paper-trading", "automation-cycle"]
  }
}
"""

let workerControlJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "workerControl": {
    "paused": false,
    "reason": null,
    "updatedAt": "2026-07-09T00:00:00.000Z",
    "updatedBy": "test"
  }
}
"""

let automationSchedulerJSON = """
{
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "scheduler": {
    "enabled": false,
    "intervalSeconds": 60,
    "running": false,
    "lastStartedAt": null,
    "lastCompletedAt": null,
    "lastStatus": "never",
    "lastMessage": null,
    "nextRunAt": null,
    "consecutiveFailures": 0,
    "updatedAt": "2026-07-09T00:00:00.000Z",
    "updatedBy": "test"
  }
}
"""

let strategyConfigResponseJSON = """
{
  "config": \(reusableStrategyJSONString)
}
"""

let strategyImportResponseJSON = """
{
  "ok": true,
  "imported": 1,
  "skipped": 0,
  "status": "draft",
  "safety": {
    "enabledStrategiesImported": 0,
    "lastSimulationDiscarded": true,
    "liveTradingChanged": false
  },
  "configs": [\(reusableStrategyJSONString)],
  "errors": []
}
"""

let strategySimulationResponseJSON = """
{
  "result": {
    "strategyConfigId": "strategy-draft-1",
    "configHash": "hash-1",
    "summary": "시뮬레이션 통과",
    "expectedReturnPct": 2.4,
    "expectedLossPct": 1.1,
    "orderIntents": [],
    "riskCheck": {
      "passed": true,
      "blockers": [],
      "warnings": []
    },
    "logs": [],
    "simulatedAt": "2026-07-09T00:00:00.000Z"
  },
  "config": \(reusableStrategyJSONString)
}
"""

func mockResponse(_ body: String, statusCode: Int = 200) -> MockHTTPResponse {
    MockHTTPResponse(statusCode: statusCode, body: body)
}

func requireRequest(
    _ requests: [CapturedHTTPRequest],
    _ index: Int,
    method: String,
    path: String,
    bodyContains expectedBodyFragments: [String] = []
) {
    assert(index < requests.count, "missing captured request at index \(index)")
    let request = requests[index]
    assert(request.method == method, "request \(index) should use \(method), got \(request.method)")
    assert(request.pathWithQuery == path, "request \(index) should target \(path), got \(request.pathWithQuery)")
    for fragment in expectedBodyFragments {
        assert(request.body.contains(fragment), "request \(index) body should contain \(fragment), got \(request.body)")
    }
}

func verifyEngineClientActionRequests() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [EngineClientMockURLProtocol.self]
    let session = URLSession(configuration: configuration)
    let client = EngineClient(baseURL: URL(string: "http://127.0.0.1:39099")!, session: session)
    let playbook = DashboardPlaybook(
        symbol: "NVDA",
        thesis: "테스트",
        entryRule: "진입",
        invalidationRule: "무효화",
        addRule: "추가",
        trimRule: "축소",
        target: "paper-only",
        workerMode: "manual-approval",
        updatedAt: "2026-07-09T00:00:00.000Z"
    )
    let strategyInput = StrategyDraftInput(
        name: "NVDA 순환분할",
        symbol: "nvda",
        market: "US",
        preset: "magic-split",
        mode: "percent-grid",
        basePrice: 100,
        notional: 330,
        rungCount: 3,
        buyDropPct: 1,
        sellRisePct: 1.2,
        maxDailyTrades: 3,
        maxLossPct: 8,
        cooldownMinutes: 60
    )
    let responses = [
        mockResponse(String(data: healthJSON, encoding: .utf8)!),
        mockResponse(automationHealthJSON),
        mockResponse(newsResponseJSON),
        mockResponse(String(data: terminalDashboardJSON, encoding: .utf8)!),
        mockResponse("""
        {
          "symbol": "NVDA",
          "thesis": "테스트",
          "entryRule": "진입",
          "invalidationRule": "무효화",
          "addRule": "추가",
          "trimRule": "축소",
          "target": "paper-only",
          "workerMode": "manual-approval",
          "updatedAt": "2026-07-09T00:00:00.000Z"
        }
        """),
        mockResponse(String(data: verifiedBrokerCredentialJSON, encoding: .utf8)!),
        mockResponse(String(data: verifiedBrokerCredentialJSON, encoding: .utf8)!),
        mockResponse(String(data: verifiedBrokerCredentialJSON, encoding: .utf8)!),
        mockResponse(String(data: brokerDiagnosticsJSON, encoding: .utf8)!),
        mockResponse(String(data: tossReadinessJSON, encoding: .utf8)!),
        mockResponse(String(data: localLiveTradingJSON, encoding: .utf8)!),
        mockResponse(String(data: localLiveTradingJSON, encoding: .utf8)!),
        mockResponse(killSwitchJSON),
        mockResponse(killSwitchJSON),
        mockResponse(workerControlJSON),
        mockResponse(workerControlJSON),
        mockResponse(automationSchedulerJSON),
        mockResponse(automationSchedulerJSON),
        mockResponse(String(data: verifiedBrokerCredentialJSON, encoding: .utf8)!),
        mockResponse(#"{"ok":true}"#),
        mockResponse(String(data: strategyConfigJSON, encoding: .utf8)!),
        mockResponse(strategyExportJSON),
        mockResponse(strategyImportResponseJSON),
        mockResponse(strategyConfigResponseJSON),
        mockResponse(strategyConfigResponseJSON),
        mockResponse(strategySimulationResponseJSON),
        mockResponse(#"{"dryRun":true,"scenario":"entry-trigger"}"#),
        mockResponse(strategyConfigResponseJSON),
        mockResponse(#"{"ok":true}"#),
        mockResponse(#"{"run":{},"orders":[],"executions":[]}"#),
        mockResponse(#"{"run":{},"orders":[],"executions":[]}"#),
        mockResponse(String(data: automationCycleJSON, encoding: .utf8)!),
        mockResponse(String(data: automationCycleJSON, encoding: .utf8)!),
        mockResponse(#"{"status":"skipped"}"#),
        mockResponse(String(data: localHoldingJSON, encoding: .utf8)!),
        mockResponse(String(data: orderPrecheckJSON, encoding: .utf8)!),
        mockResponse(#"{"symbol":"NVDA","latestClose":100}"#),
        mockResponse(#"{"ok":true}"#),
        mockResponse(#"{"query":"삼성","markets":["KOSPI","KOSDAQ"],"matches":[{"symbol":"005930.KS","displaySymbol":"005930","market":"KOSPI","exchange":"KOSPI","name":"삼성전자","nameKo":"삼성전자","nameEn":"Samsung Electronics","currency":"KRW","assetType":"stock","sector":"반도체","themes":["메모리"],"aliases":[],"score":222,"matchedBy":"삼성전자"}],"warnings":[]}"#),
    ]
    EngineClientMockURLProtocol.reset(responses: responses)

    _ = try await client.health()
    _ = try await client.automationHealth()
    _ = try await client.news(limit: 7)
    _ = try await client.terminalDashboard(symbol: "NVDA", session: "US")
    _ = try await client.savePlaybook(symbol: "NVDA", playbook: playbook)
    _ = try await client.brokerCredential()
    _ = try await client.brokerAccountPreference()
    _ = try await client.updateBrokerAccountPreference(accountSeq: 7)
    _ = try await client.brokerDiagnostics(includePublicIP: true)
    _ = try await client.tossReadiness(symbol: "NVDA")
    _ = try await client.localLiveTrading()
    _ = try await client.updateLocalLiveTrading(enabled: true)
    _ = try await client.localKillSwitch()
    _ = try await client.updateLocalKillSwitch(engaged: true, reason: "테스트")
    _ = try await client.localWorkerControl()
    _ = try await client.updateLocalWorkerControl(paused: true, reason: "테스트")
    _ = try await client.localAutomationScheduler()
    _ = try await client.updateLocalAutomationScheduler(enabled: true, intervalSeconds: 60)
    _ = try await client.registerBrokerCredential(clientId: "client-1", clientSecret: "secret-1")
    _ = try await client.deleteBrokerCredential()
    _ = try await client.strategyConfigs()
    _ = try await client.exportStrategyConfigs()
    _ = try await client.importStrategyConfigs(strategyExportBundle)
    _ = try await client.createStrategyDraft(strategyInput)
    _ = try await client.updateStrategyDraft(id: "strategy-draft-1", input: strategyInput)
    _ = try await client.simulateStrategy(id: "strategy-draft-1")
    _ = try await client.previewStrategyTick(id: "strategy-draft-1", scenario: "entry-trigger")
    _ = try await client.updateStrategyStatus(id: "strategy-draft-1", status: "enabled")
    _ = try await client.deleteStrategy(id: "strategy-draft-1")
    _ = try await client.runPaperTrading(session: "US")
    _ = try await client.submitPaperOrderIntent(terminalDashboard.orderIntent, session: "US")
    _ = try await client.runAutomationCycle()
    _ = try await client.runAutomationDryRun()
    _ = try await client.syncAutomationOrders()
    _ = try await client.localHolding(symbol: "NVDA", accountSeq: 7)
    _ = try await client.localOrderPrecheck(symbol: "NVDA", side: "buy", quantity: 10, price: 99, currency: "USD", accountSeq: 7)
    _ = try await client.analyze(symbol: "NVDA")
    _ = try await client.dailyBriefing(session: "US")
    let symbolSearch = try await client.searchSymbols(query: "삼성", markets: ["KOSPI", "KOSDAQ"], limit: 12)
    assert(symbolSearch.matches.first?.displayLabel == "삼성전자 · Samsung Electronics · 005930", "symbol search should decode bilingual label")

    let requests = EngineClientMockURLProtocol.captured()
    assert(requests.count == responses.count, "EngineClient should issue \(responses.count) captured app action requests")
    requireRequest(requests, 0, method: "GET", path: "/health")
    requireRequest(requests, 1, method: "GET", path: "/api/automation/health")
    requireRequest(requests, 2, method: "GET", path: "/api/news/events?limit=7")
    requireRequest(requests, 3, method: "GET", path: "/api/dashboard/terminal?symbol=NVDA&session=US")
    requireRequest(requests, 4, method: "POST", path: "/api/dashboard/playbook?symbol=NVDA", bodyContains: ["manual-approval"])
    requireRequest(requests, 5, method: "GET", path: "/api/local/broker/credentials")
    requireRequest(requests, 6, method: "GET", path: "/api/local/broker/account-preference")
    requireRequest(requests, 7, method: "PUT", path: "/api/local/broker/account-preference", bodyContains: ["\"accountSeq\":7"])
    requireRequest(requests, 8, method: "GET", path: "/api/local/broker/diagnostics?includeEgress=1")
    requireRequest(requests, 9, method: "GET", path: "/api/local/toss/readiness?symbol=NVDA")
    requireRequest(requests, 10, method: "GET", path: "/api/local/live-trading")
    requireRequest(requests, 11, method: "PUT", path: "/api/local/live-trading", bodyContains: ["\"enabled\":true"])
    requireRequest(requests, 12, method: "GET", path: "/api/local/kill-switch")
    requireRequest(requests, 13, method: "PUT", path: "/api/local/kill-switch", bodyContains: ["\"engaged\":true", "macos-app"])
    requireRequest(requests, 14, method: "GET", path: "/api/local/worker-control")
    requireRequest(requests, 15, method: "PUT", path: "/api/local/worker-control", bodyContains: ["\"paused\":true", "macos-app"])
    requireRequest(requests, 16, method: "GET", path: "/api/local/automation/scheduler")
    requireRequest(requests, 17, method: "PUT", path: "/api/local/automation/scheduler", bodyContains: ["\"enabled\":true", "\"intervalSeconds\":60"])
    requireRequest(requests, 18, method: "POST", path: "/api/local/broker/credentials", bodyContains: ["client-1", "secret-1"])
    requireRequest(requests, 19, method: "DELETE", path: "/api/local/broker/credentials")
    requireRequest(requests, 20, method: "GET", path: "/api/local/strategy-configs")
    requireRequest(requests, 21, method: "GET", path: "/api/local/strategy-configs/export")
    requireRequest(requests, 22, method: "POST", path: "/api/local/strategy-configs/import", bodyContains: ["schemaVersion", "credentialsIncluded", "magic-split"])
    requireRequest(requests, 23, method: "POST", path: "/api/local/strategy-configs", bodyContains: ["magic-split", "NVDA"])
    requireRequest(requests, 24, method: "PUT", path: "/api/local/strategy-configs/strategy-draft-1", bodyContains: ["magic-split"])
    requireRequest(requests, 25, method: "POST", path: "/api/local/strategy-configs/strategy-draft-1/simulate")
    requireRequest(requests, 26, method: "POST", path: "/api/local/strategy-configs/strategy-draft-1/tick-preview", bodyContains: ["entry-trigger"])
    requireRequest(requests, 27, method: "PUT", path: "/api/local/strategy-configs/strategy-draft-1", bodyContains: ["enabled"])
    requireRequest(requests, 28, method: "DELETE", path: "/api/local/strategy-configs/strategy-draft-1")
    requireRequest(requests, 29, method: "POST", path: "/api/paper-trading/run", bodyContains: ["US", "manual"])
    requireRequest(requests, 30, method: "POST", path: "/api/paper-trading/order-intent", bodyContains: ["intent-1", "NVDA"])
    requireRequest(requests, 31, method: "POST", path: "/api/automation/cycle", bodyContains: ["{}"])
    requireRequest(requests, 32, method: "POST", path: "/api/automation/cycle", bodyContains: ["dryRun"])
    requireRequest(requests, 33, method: "POST", path: "/api/local/orders/sync", bodyContains: ["{}"])
    requireRequest(requests, 34, method: "GET", path: "/api/local/holdings?symbol=NVDA&accountSeq=7")
    requireRequest(requests, 35, method: "POST", path: "/api/local/orders/precheck", bodyContains: ["NVDA", "\"quantity\":10"])
    requireRequest(requests, 36, method: "GET", path: "/api/market/NVDA?days=365&tf=1d")
    requireRequest(requests, 37, method: "GET", path: "/api/briefing/daily-market?session=US&force=1")
    requireRequest(requests, 38, method: "GET", path: "/api/local/symbol-search?q=%EC%82%BC%EC%84%B1&markets=KOSPI,KOSDAQ&limit=12")
}

try await verifyEngineClientActionRequests()

print("StockAnalysisMac smoke tests passed")
