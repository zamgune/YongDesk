import Charts
import AppKit
import CryptoKit
import Foundation
import Security
import SwiftUI
import UserNotifications
import StockAnalysisMacCore

@main
struct StockAnalysisMacApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Yong'Desk", id: "main") {
            BeginnerFirstRootView()
                .environmentObject(model)
                .task {
                    await model.bootstrap()
                }
        }
        .defaultSize(width: 1440, height: 900)
        .windowResizability(.contentMinSize)

        MenuBarExtra("Yong'Desk", systemImage: model.menuBarIcon) {
            MenuBarStatusView()
                .environmentObject(model)
        }
        .menuBarExtraStyle(.window)
        .commands {
            CommandMenu("지원") {
                Button("연결 상태 점검") {
                    NotificationCenter.default.post(name: .openBeginnerSupportSelfTest, object: nil)
                }
                Button("진단 로그 열기") {
                    NotificationCenter.default.post(name: .openBeginnerSupportLog, object: nil)
                }
                if Self.developerModeEnabled {
                    Divider()
                    Button("개발자 QA") {
                        NotificationCenter.default.post(name: .openBeginnerSupportSelfTest, object: nil)
                    }
                }
            }
        }
    }

    private static var developerModeEnabled: Bool {
#if DEBUG
        true
#else
        ProcessInfo.processInfo.environment["STOCK_ANALYSIS_DEVELOPER_MODE"] == "1"
#endif
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var settings: AppSettings
    @Published var health: EngineHealth?
    @Published var automationHealth: AutomationHealth?
    @Published var newsEvents: [LocalNewsEvent] = []
    @Published var latestAlerts: [LocalNewsEvent] = []
    @Published var newsSourceErrors: [NewsSourceError] = []
    @Published var newsLastGeneratedAt: String?
    @Published var newsSourceStatusMessage = "공식/RSS 소스 상태는 뉴스 갱신 후 표시됩니다."
    @Published var communitySentiment: CommunitySentimentSnapshot?
    @Published var communitySentimentMessage = "종목별 커뮤니티 반응은 뉴스·알림 화면에서 불러올 수 있습니다."
    @Published var redditCredentialStored = false
    @Published var redditCredentialMessage = "Reddit OAuth는 선택 사항입니다. 연결하면 미국 종목의 게시글·댓글 근거를 함께 수집합니다."
    @Published var paperTradingState: PaperTradingStateView?
    @Published var paperTradingMessage = "모의 주문을 실행하면 paper 계좌와 포지션이 여기에 표시됩니다."
    @Published var realPortfolio: RealPortfolioResponseView?
    @Published var realPortfolioMessage = "연결된 API의 실제 자산을 읽기 전용으로 불러옵니다."
    @Published var terminalDashboard: TerminalDashboardSnapshot?
    @Published var latestMarketAnalysis: MarketAnalysisSnapshot?
    @Published var latestChartAnalysis: MarketAnalysisSnapshot?
    @Published var latestWorkspaceAnalysis: WorkspaceAnalysis?
    @Published var workspaceAnalysisMessage = "종목을 선택하면 1시간·4시간·일봉 기준을 함께 계산합니다."
    @Published private(set) var isWorkspaceAnalysisLoading = false
    @Published var watchlistItems: [LocalWatchlistSummaryItem] = []
    @Published var watchlistMaxItems = 20
    @Published var watchlistMessage = "관심종목을 추가하면 현재가와 등락을 한 화면에서 비교할 수 있습니다."
    @Published var watchlistSignals: [WatchlistSignalItem] = []
    @Published var watchlistSignalMessage = "급락 감시를 켜면 Toss 확정 5분봉으로 관심종목을 확인합니다."
    @Published var watchlistSignalMarketContext: WatchlistSignalMarketContext?
    @Published var watchlistSignalResponseIsAdvisoryOnly = false
    @Published var sectorStrength: SectorStrengthResponseView?
    @Published var sectorStrengthMessage = "한국 또는 미국 시장을 선택하면 섹터 강도를 비교합니다."
    @Published private(set) var isSectorStrengthLoading = false
    @Published var brokerCredential: BrokerCredentialView?
    @Published var brokerAccounts: [BrokerAccountView] = []
    @Published var brokerAccountPreference: BrokerAccountPreferenceView?
    @Published var brokerCredentialMessage = "토스 API 키를 등록하면 계좌·보유·미체결을 읽기 전용으로 확인할 수 있습니다."
    @Published var brokerAccountMessage = "검증 완료된 Toss API 키가 있으면 자동거래 계좌를 선택할 수 있습니다."
    @Published var keychainCredentialStored = false
    @Published var keychainCredentialMessage = "Keychain 상태를 아직 확인하지 않았습니다."
    @Published var brokerDiagnostics: BrokerDiagnosticsResponse?
    @Published var brokerDiagnosticsMessage = "로컬 진단은 자동으로 실행됩니다. 공인 IP는 버튼을 눌렀을 때만 외부 서비스로 조회합니다."
    @Published var tossReadiness: TossReadinessResponse?
    @Published var tossReadinessMessage = "운영 준비 점검은 저장된 Toss credential로 토큰/계좌/보유/미체결 조회를 주문 없이 확인합니다."
    @Published var localLiveTrading: LocalLiveTradingState?
    @Published var localLiveTradingMessage = "Toss 실거래는 기본 OFF입니다. 자동 readiness·이용 동의·별도 수동/자동화 토글을 모두 통과해야 합니다."
    @Published var killSwitchState: LocalKillSwitchState?
    @Published var killSwitchMessage = "긴급 중지는 모의 주문과 자동화 큐를 sidecar에서 차단합니다."
    @Published var workerControlState: LocalWorkerControlState?
    @Published var workerControlMessage = "워커 일시중지는 자동화 큐 실행을 sidecar에서 차단합니다."
    @Published var automationSchedulerState: LocalAutomationSchedulerState?
    @Published var automationSchedulerMessage = "연속 자동 실행은 기본 OFF입니다. 주기를 선택하고 명시적으로 시작해야 합니다."
    @Published var cryptoExchanges: [CryptoExchangeStateView] = []
    @Published var cryptoExchangeMessage = "Upbit·Bithumb API 키를 검증하면 잔고와 주문 가능 정보를 읽기 전용으로 확인합니다."
    @Published var cryptoReadiness: CryptoReadinessResponse?
    @Published var cryptoOrderPrecheck: CryptoOrderPrecheckResponse?
    @Published var upbitOrderTest: UpbitOrderTestResponse?
    @Published var cryptoLiveTrading: CryptoManualLiveTradingState?
    @Published var cryptoLiveOrderPrecheck: CryptoManualOrderPrecheckResponse?
    @Published var cryptoLiveOrderSubmission: CryptoManualOrderSubmissionResponse?
    @Published var strategyConfigs: [StrategyConfigView] = []
    @Published var requestedStrategyConfigId: String?
    @Published var strategyMessage = "전략은 초안 저장 후 시뮬레이션을 통과해야 활성화할 수 있습니다."
    @Published var latestStrategySimulation: StrategySimulationResultView?
    @Published var latestStrategyTickPreview: String?
    @Published var latestAutomationRun: AutomationCycleResponseView?
    @Published var latestHolding: LocalHoldingResponse?
    @Published var latestOrderPrecheck: LocalOrderPrecheckResponse?
    @Published var latestLiveOrderSubmission: LocalLiveOrderSubmissionResponse?
    @Published var appSelfTest: LocalSelfTestResponse?
    @Published var appSelfTestMessage = "점검을 실행하면 앱 핵심 동작 경로를 한 번에 확인합니다."
    @Published var sidecarLogText = "로그를 아직 불러오지 않았습니다."
    @Published var sidecarLogMessage = "sidecar 로그는 앱 지원 폴더에 저장됩니다."
    @Published var statusLine = "sidecar stopped"
    @Published var sidecarStartupDiagnostic = SidecarStartupDiagnostic.stopped
    @Published var activeEnginePort: Int

    private static let sidecarLoaderImport = #"data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("./scripts/ts_path_loader.mjs", pathToFileURL("./"));"#
    private static let marketAnalysisCandleRetentionLimit = 400
    @Published var isStartingSidecar = false
    @Published var killSwitchEngaged = false
    @Published private(set) var killSwitchTransitionPending = false
    @Published private(set) var workerControlTransitionPending = false
    @Published var lastUpdated = "-"

    let store: AppSupportStore
    let database: LocalSQLiteStore
    private let keychain: any CredentialStoring
    private let notifier = NotificationService()
    private var sidecar: Process?
    private var sidecarLogHandle: FileHandle?
    private var newsRefreshTask: Task<Void, Never>?
    private var watchlistSignalRefreshTask: Task<Void, Never>?
    private var bootstrapStarted = false
    private var communityRefreshGeneration = 0
    private var workspaceAnalysisGeneration = 0

    var menuBarIcon: String {
        if killSwitchEngaged {
            return "hand.raised.fill"
        }
        return health?.ok == true ? "chart.line.uptrend.xyaxis" : "exclamationmark.triangle"
    }

    var liveGateLabel: String {
        if killSwitchEngaged {
            return "긴급 중지"
        }
        return "PAPER ONLY"
    }

    var liveGateTone: PillTone {
        if killSwitchEngaged {
            return .red
        }
        return .green
    }

    var workerPausedEffective: Bool {
        executionBlocked || workerControlState?.paused == true || settings.workerPaused
    }

    var executionBlocked: Bool {
        killSwitchEngaged || killSwitchTransitionPending || workerControlTransitionPending
    }

    var client: EngineClient {
        EngineClient(baseURL: URL(string: "http://127.0.0.1:\(activeEnginePort)")!)
    }

    init(keychain: any CredentialStoring = KeychainCredentialStore()) {
        self.keychain = keychain
        do {
            let store = try AppSupportStore()
            var settings = store.loadSettings()
            if settings.liveTradingOperatorEnabled {
                settings.liveTradingOperatorEnabled = false
                try? store.saveSettings(settings)
            }
            if settings.cryptoLiveTradingOperatorEnabled {
                settings.cryptoLiveTradingOperatorEnabled = false
                try? store.saveSettings(settings)
            }
            self.store = store
            self.database = LocalSQLiteStore(databaseURL: store.sqliteURL)
            self.settings = settings
            self.activeEnginePort = settings.enginePort
        } catch {
            let fallback = URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "StockAnalysisMac")
            let settings = AppSettings()
            self.store = try! AppSupportStore(rootURL: fallback)
            self.database = LocalSQLiteStore(databaseURL: fallback.appending(path: "stock-analysis.sqlite3"))
            self.settings = settings
            self.activeEnginePort = settings.enginePort
            self.statusLine = "app support fallback"
        }
        Task { [weak self] in
            await self?.bootstrap()
        }
    }

    func bootstrap() async {
        guard !bootstrapStarted else { return }
        bootstrapStarted = true
        do {
            try store.prepareSidecarStorage()
            try database.migrate()
            repairRepositoryPathIfNeeded()
            try store.saveSettings(settings)
        } catch {
            statusLine = error.localizedDescription
        }
        await refreshHealth()
        if health?.ok == true, !isCurrentBundledSidecar(health) {
            terminateManagedSidecar(on: activeEnginePort, reason: "stale sidecar build")
            health = nil
        }
        if health?.ok == true {
            await refreshNews()
            startNewsRefreshLoop()
            await refreshBrokerCredential()
            await refreshBrokerAccounts()
            await refreshBrokerDiagnostics()
            await refreshLocalLiveTrading()
            await refreshKillSwitch()
            await refreshWorkerControl()
            await refreshAutomationScheduler()
            await refreshCryptoExchanges()
            await refreshRealPortfolio()
            await refreshPaperTradingState()
            await refreshStrategyConfigs()
            await refreshWatchlist()
            await refreshWatchlistSignals(scan: settings.crashSignalMonitoringEnabled && Self.isKRRegularSession())
            startWatchlistSignalRefreshLoop()
        } else {
            startSidecar()
        }
    }

    func startSidecar() {
        guard sidecar == nil, !isStartingSidecar else {
            return
        }
        let workingDirectory = sidecarWorkingDirectory()
        guard isValidSidecarDirectory(workingDirectory) else {
            sidecarStartupDiagnostic = .missingBundle()
            statusLine = "sidecar bundle missing"
            return
        }
        if isPackagedApp {
            guard let nodeURL = bundledNodeCandidateURL(),
                  FileManager.default.fileExists(atPath: nodeURL.path(percentEncoded: false)) else {
                sidecarStartupDiagnostic = .missingBundle()
                statusLine = "bundled node missing"
                return
            }
            guard FileManager.default.isExecutableFile(atPath: nodeURL.path(percentEncoded: false)) else {
                sidecarStartupDiagnostic = .launchDenied()
                statusLine = "bundled node execution denied"
                return
            }
        }
        isStartingSidecar = true
        activeEnginePort = resolveSidecarPort()
        statusLine = "sidecar preparing"
        sidecarStartupDiagnostic = .preparing
        let store = self.store
        let keychain = self.keychain
        Task.detached { [weak self, workingDirectory, store, keychain] in
            let brokerEncryptionKey = Self.resolveLocalBrokerEncryptionKey(store: store)
            let redditCredential = try? StartupCredentialLoader.load(using: keychain).reddit
            await MainActor.run {
                self?.redditCredentialStored = redditCredential != nil
                self?.redditCredentialMessage = redditCredential == nil
                    ? "Reddit OAuth는 선택 사항입니다. 연결하면 미국 종목의 게시글·댓글 근거를 함께 수집합니다."
                    : "Reddit 공식 OAuth 키가 이 Mac의 Keychain에 저장되어 있습니다."
                self?.runSidecar(
                    workingDirectory: workingDirectory,
                    brokerEncryptionKey: brokerEncryptionKey,
                    redditClientId: redditCredential?.clientId,
                    redditClientSecret: redditCredential?.clientSecret
                )
            }
        }
    }

    private func runSidecar(
        workingDirectory: URL,
        brokerEncryptionKey: String,
        redditClientId: String?,
        redditClientSecret: String?
    ) {
        guard sidecar == nil, isStartingSidecar else {
            return
        }
        let process = Process()
        let nodeURL = bundledNodeURL() ?? URL(fileURLWithPath: "/usr/bin/env")
        process.executableURL = nodeURL
        let engineArguments = [
            "--import",
            Self.sidecarLoaderImport,
            "--experimental-strip-types",
            "scripts/local_engine.mts",
            "--port=\(activeEnginePort)",
            "--parent-pid=\(ProcessInfo.processInfo.processIdentifier)"
        ]
        process.arguments = bundledNodeURL() == nil ? ["node"] + engineArguments : engineArguments
        process.currentDirectoryURL = workingDirectory
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "REDDIT_CLIENT_ID")
        environment.removeValue(forKey: "REDDIT_CLIENT_SECRET")
        environment["PATH"] = [
            bundledNodeURL()?.deletingLastPathComponent().path(percentEncoded: false),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ].compactMap { $0 }.joined(separator: ":")
        environment["STOCK_ANALYSIS_STORAGE_ROOT"] = store.sidecarStorageRoot.path(percentEncoded: false)
        environment["STOCK_ANALYSIS_LOCAL_ENGINE_PORT"] = "\(activeEnginePort)"
        environment["STOCK_ANALYSIS_RUNTIME"] = "macos-local"
        environment["ENABLE_LIVE_TRADING"] = "false"
        environment["ENABLE_CRYPTO_LIVE_TRADING"] = "false"
        environment["BROKER_CREDENTIAL_ENC_KEY"] = brokerEncryptionKey
        if let redditClientId, !redditClientId.isEmpty,
           let redditClientSecret, !redditClientSecret.isEmpty {
            environment["REDDIT_CLIENT_ID"] = redditClientId
            environment["REDDIT_CLIENT_SECRET"] = redditClientSecret
        }
        if let buildId = bundledSidecarBuildId() {
            environment["STOCK_ANALYSIS_SIDECAR_BUILD_ID"] = buildId
        }
        process.environment = environment
        attachSidecarLog(to: process)
        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor in
                guard let self else {
                    return
                }
                if let currentProcess = self.sidecar, currentProcess !== terminatedProcess {
                    return
                }
                let stoppedBeforeReady = self.health?.ok != true
                try? self.sidecarLogHandle?.close()
                self.sidecarLogHandle = nil
                self.sidecar = nil
                self.isStartingSidecar = false
                self.health = nil
                self.automationHealth = nil
                self.localLiveTrading = nil
                if stoppedBeforeReady {
                    self.sidecarStartupDiagnostic = .earlyExit(code: terminatedProcess.terminationStatus)
                    self.statusLine = "sidecar exited (\(terminatedProcess.terminationStatus))"
                } else {
                    self.sidecarStartupDiagnostic = .stopped
                    self.statusLine = "sidecar stopped"
                }
            }
        }
        do {
            try process.run()
            sidecar = process
            statusLine = "sidecar starting"
            sidecarStartupDiagnostic = .starting
            Task {
                await refreshSidecarStartupState()
            }
        } catch {
            isStartingSidecar = false
            try? sidecarLogHandle?.close()
            sidecarLogHandle = nil
            sidecarStartupDiagnostic = .launchFailure(error)
            statusLine = "sidecar launch failed"
        }
    }

    private func refreshSidecarStartupState() async {
        for attempt in 1...30 {
            try? await Task.sleep(for: .milliseconds(500))
            await refreshHealth()
            if health?.ok == true {
                sidecarStartupDiagnostic = .ready
                await refreshBrokerCredential()
                await refreshBrokerAccounts()
                await refreshBrokerDiagnostics()
                await refreshLocalLiveTrading()
                if brokerCredential?.status == "verified", brokerAccountPreference != nil {
                    _ = await syncAutomationOrders(startupReconciliation: true)
                    await refreshLocalLiveTrading()
                }
                await refreshKillSwitch()
                await refreshWorkerControl()
                await refreshAutomationScheduler()
                await refreshCryptoExchanges()
                await refreshPaperTradingState()
                await refreshStrategyConfigs()
                await refreshNews()
                startNewsRefreshLoop()
                await refreshWatchlist()
                await refreshWatchlistSignals(scan: settings.crashSignalMonitoringEnabled && Self.isKRRegularSession())
                startWatchlistSignalRefreshLoop()
                return
            }
            if sidecar == nil {
                return
            }
            sidecarStartupDiagnostic = .starting
            statusLine = "sidecar starting (\(attempt)/30)"
        }
        isStartingSidecar = false
        sidecarStartupDiagnostic = .healthTimeout()
        statusLine = "sidecar health check timeout"
    }

    func stopSidecar() {
        newsRefreshTask?.cancel()
        newsRefreshTask = nil
        watchlistSignalRefreshTask?.cancel()
        watchlistSignalRefreshTask = nil
        if let process = sidecar {
            ManagedChildProcessTerminator.terminate(process)
        }
        sidecar = nil
        isStartingSidecar = false
        try? sidecarLogHandle?.close()
        sidecarLogHandle = nil
        health = nil
        localLiveTrading = nil
        sidecarStartupDiagnostic = .stopped
        statusLine = "sidecar stopped"
    }

    func restartSidecar(reason: String) {
        stopSidecar()
        statusLine = "sidecar restarting: \(reason)"
        startSidecar()
    }

    func ensureSidecarReadyForCredentialRegistration() async -> Bool {
        await refreshHealth()
        if health?.ok == true {
            sidecarStartupDiagnostic = .ready
            return true
        }
        if sidecar == nil, !isStartingSidecar {
            startSidecar()
        }
        for _ in 1...30 {
            try? await Task.sleep(for: .milliseconds(500))
            await refreshHealth()
            if health?.ok == true {
                sidecarStartupDiagnostic = .ready
                return true
            }
            if sidecarStartupDiagnostic.phase == .failed, sidecar == nil, !isStartingSidecar {
                return false
            }
        }
        isStartingSidecar = false
        sidecarStartupDiagnostic = .healthTimeout()
        statusLine = "sidecar health check timeout"
        return false
    }

    func refreshRedditCredentialStatus() {
        do {
            redditCredentialStored = try keychain.readInteractively(broker: "reddit") != nil
            redditCredentialMessage = redditCredentialStored
                ? "Reddit 공식 OAuth 키가 이 Mac의 Keychain에 저장되어 있습니다. 다음 민심 갱신부터 게시글·댓글을 수집합니다."
                : "Reddit OAuth는 선택 사항입니다. 연결하면 미국 종목의 게시글·댓글 근거를 함께 수집합니다."
        } catch {
            redditCredentialStored = false
            redditCredentialMessage = "Reddit Keychain 상태 확인 실패: \(Self.errorMessage(error))"
        }
    }

    func saveRedditCredential(clientId: String, clientSecret: String) {
        let normalizedClientId = clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedClientSecret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedClientId.isEmpty, !normalizedClientSecret.isEmpty else {
            redditCredentialMessage = "Reddit Client ID와 Client Secret을 모두 입력하세요."
            return
        }
        do {
            try keychain.save(BrokerCredential(
                broker: "reddit",
                clientId: normalizedClientId,
                clientSecret: normalizedClientSecret
            ))
            try? keychain.delete(broker: "reddit-client-id")
            try? keychain.delete(broker: "reddit-client-secret")
            redditCredentialStored = true
            redditCredentialMessage = "Reddit 공식 OAuth 키가 이 Mac의 Keychain에 저장되어 있습니다."
            communityRefreshGeneration += 1
            communitySentiment = nil
            communitySentimentMessage = "Reddit OAuth 반영을 위해 엔진을 다시 시작합니다. 잠시 후 민심을 갱신하세요."
            restartSidecar(reason: "Reddit OAuth credential changed")
        } catch {
            redditCredentialStored = false
            redditCredentialMessage = "Reddit OAuth 저장 실패: \(Self.errorMessage(error))"
        }
    }

    func deleteRedditCredential() {
        do {
            try keychain.delete(broker: "reddit")
            try? keychain.delete(broker: "reddit-client-id")
            try? keychain.delete(broker: "reddit-client-secret")
            redditCredentialStored = false
            redditCredentialMessage = "Reddit OAuth 연결을 삭제했습니다. 미국 민심은 다른 허용 소스만 사용합니다."
            communityRefreshGeneration += 1
            communitySentiment = nil
            restartSidecar(reason: "Reddit OAuth credential removed")
        } catch {
            redditCredentialMessage = "Reddit OAuth 삭제 실패: \(Self.errorMessage(error))"
        }
    }

    func openSidecarLog() {
        NSWorkspace.shared.open(store.sidecarLogURL)
    }

    func revealSidecarLog() {
        NSWorkspace.shared.activateFileViewerSelecting([store.sidecarLogURL])
    }

    func releaseArtifacts() -> [ReleaseArtifactInfo] {
        guard let status = bundledReleaseStatus() else {
            return discoveredReleaseArtifacts()
        }
        return status.files.map { file in
            let url = releaseArtifactURL(fileName: file.fileName)
            return ReleaseArtifactInfo(
                title: releaseArtifactTitle(kind: file.kind),
                detail: url.map { $0.path(percentEncoded: false) } ?? "명세에는 있으나 이 Mac에서 파일을 찾지 못했습니다.",
                exists: url != nil,
                url: url,
                fileName: file.fileName
            )
        }
    }

    func releaseManifestSummary() -> ReleaseManifestSummary? {
        if let status = bundledReleaseStatus() {
            let distribution = status.distribution
            return ReleaseManifestSummary(
                fileName: status.files.first { $0.kind == "manifest" }?.fileName ?? "release-status.json",
                builtAt: status.builtAt,
                signingIdentity: status.signingIdentity,
                arch: distribution?.architecture ?? status.arch,
                notarizationRequested: status.notarization.requested,
                notarizationStapled: status.notarization.stapled,
                readinessLabel: distribution?.label,
                readinessStatus: distribution?.status,
                readyForExternalDistribution: distribution?.readyForExternalDistribution,
                gatekeeperRisk: distribution?.gatekeeperRisk,
                minimumMacOS: status.compatibility?.minimumMacOS,
                supportedArchitectures: status.compatibility?.supportedArchitectures,
                bundledNodeVersion: status.compatibility?.bundledNodeVersion,
                sidecarVerified: status.compatibility?.sidecarVerified,
                warnings: distribution?.warnings,
                nextSteps: distribution?.nextSteps,
                operatorChecklist: distribution?.operatorChecklist
            )
        }
        return discoveredManifestSummary()
    }

    func loadReleaseStateSnapshot() async -> ReleaseStateSnapshot {
        let loader = ReleaseStateLoader(
            bundleURL: Bundle.main.bundleURL,
            releaseStatusURL: Bundle.main.url(forResource: "release-status", withExtension: "json"),
            repositoryPath: settings.repositoryPath,
            appVersion: Self.appVersion,
            arch: Self.hostArchitecture
        )
        return await Task.detached {
            loader.load()
        }.value
    }

    func revealCurrentApp() {
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
    }

    func openReleaseFolder() {
        guard let url = releaseDirectoryURL() else {
            revealCurrentApp()
            return
        }
        NSWorkspace.shared.open(url)
    }

    func revealReleaseArtifact(_ artifact: ReleaseArtifactInfo) {
        guard let url = artifact.url else {
            openReleaseFolder()
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func refreshSidecarLogTail(limitBytes: UInt64 = 64_000) {
        do {
            try store.prepareSidecarStorage()
            let path = store.sidecarLogURL.path(percentEncoded: false)
            guard FileManager.default.fileExists(atPath: path) else {
                sidecarLogText = "아직 sidecar 로그 파일이 없습니다.\n엔진을 시작하거나 상태 갱신을 실행하면 로그가 생성됩니다."
                sidecarLogMessage = "로그 파일 없음"
                return
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            let fileSize = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
            let handle = try FileHandle(forReadingFrom: store.sidecarLogURL)
            defer { try? handle.close() }
            let offset = fileSize > limitBytes ? fileSize - limitBytes : 0
            try handle.seek(toOffset: offset)
            let data = try handle.readToEnd() ?? Data()
            let text = String(data: data, encoding: .utf8) ?? "\(data.count) bytes"
            let presentation = SidecarLogFormatter.presentation(from: text, skippedBytes: offset)
            sidecarLogText = presentation.text
            sidecarLogMessage = "\(presentation.scopeLabel) · 전체 \(fileSize.formatted()) bytes · \(Self.timeFormatter.string(from: Date()))"
        } catch {
            sidecarLogText = "로그를 읽지 못했습니다.\n\(error.localizedDescription)"
            sidecarLogMessage = "로그 조회 실패"
        }
    }

    private func repairRepositoryPathIfNeeded() {
        let resolved = sidecarWorkingDirectory()
        let resolvedPath = resolved.path(percentEncoded: false)
        if settings.repositoryPath != resolvedPath {
            settings.repositoryPath = resolvedPath
        }
    }

    private func sidecarWorkingDirectory() -> URL {
        if let sidecarURL = Bundle.main.resourceURL?.appending(path: "sidecar", directoryHint: .isDirectory),
           isValidSidecarDirectory(sidecarURL) {
            return sidecarURL
        }
        if let recordedURL = recordedRepositoryURL(),
           isValidSidecarDirectory(recordedURL) {
            return recordedURL
        }
        let configuredURL = URL(fileURLWithPath: settings.repositoryPath, isDirectory: true)
        if isValidSidecarDirectory(configuredURL) {
            return configuredURL
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    }

    private var isPackagedApp: Bool {
        Bundle.main.bundleURL.pathExtension == "app"
    }

    private func recordedRepositoryURL() -> URL? {
        guard let url = Bundle.main.url(forResource: "repository-path", withExtension: "txt"),
              let value = try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: value, isDirectory: true)
    }

    private func isValidSidecarDirectory(_ url: URL) -> Bool {
        let fileManager = FileManager.default
        let root = url.path(percentEncoded: false)
        return fileManager.fileExists(atPath: "\(root)/package.json") &&
            fileManager.fileExists(atPath: "\(root)/scripts/local_engine.mts") &&
            fileManager.fileExists(atPath: "\(root)/scripts/ts_path_loader.mjs") &&
            fileManager.fileExists(atPath: "\(root)/src")
    }

    private func isCurrentBundledSidecar(_ health: EngineHealth?) -> Bool {
        guard let health, health.ok else {
            return false
        }
        guard let expectedBuildId = bundledSidecarBuildId() else {
            return true
        }
        guard health.sidecarBuildId == expectedBuildId else {
            statusLine = "stale sidecar detected"
            return false
        }
        guard let expectedSidecarURL = Bundle.main.resourceURL?.appending(path: "sidecar", directoryHint: .isDirectory),
              let workingDirectory = health.workingDirectory else {
            return true
        }
        let expectedPath = expectedSidecarURL.standardizedFileURL.path(percentEncoded: false)
        let actualPath = URL(fileURLWithPath: workingDirectory, isDirectory: true).standardizedFileURL.path(percentEncoded: false)
        return expectedPath == actualPath
    }

    private func bundledSidecarBuildId() -> String? {
        bundledSidecarBuild()?.builtAt
    }

    private func bundledSidecarBuild() -> SidecarBuildResource? {
        guard let url = Bundle.main.url(forResource: "sidecar-build", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? JSONDecoder().decode(SidecarBuildResource.self, from: data)
    }

    private func resolveSidecarPort() -> Int {
        if processListening(on: settings.enginePort) == nil {
            return settings.enginePort
        }
        terminateManagedSidecar(on: settings.enginePort, reason: "configured port occupied")
        if processListening(on: settings.enginePort) == nil {
            return settings.enginePort
        }
        guard let fallbackPort = availableFallbackPort() else {
            statusLine = "port \(settings.enginePort) is busy"
            return settings.enginePort
        }
        statusLine = "port \(settings.enginePort) busy; using \(fallbackPort)"
        return fallbackPort
    }

    private func availableFallbackPort() -> Int? {
        for _ in 0..<40 {
            let port = Int.random(in: 38_800...39_999)
            if processListening(on: port) == nil {
                return port
            }
        }
        return nil
    }

    private func terminateManagedSidecar(on port: Int, reason: String) {
        guard let pid = processListening(on: port) else {
            return
        }
        guard pid != ProcessInfo.processInfo.processIdentifier else {
            return
        }
        let command = processCommandLine(pid: pid) ?? ""
        guard command.contains("scripts/local_engine.mts"),
              command.contains("StockAnalysis.app/Contents/Resources") else {
            statusLine = "port \(port) is used by an external process"
            return
        }
        _ = systemCommandOutput("/bin/kill", ["-TERM", "\(pid)"])
        for _ in 0..<10 {
            Thread.sleep(forTimeInterval: 0.1)
            if processListening(on: port) != pid {
                statusLine = "terminated stale sidecar: \(reason)"
                return
            }
        }
        _ = systemCommandOutput("/bin/kill", ["-KILL", "\(pid)"])
        statusLine = "force-terminated stale sidecar: \(reason)"
    }

    private func processListening(on port: Int) -> Int32? {
        guard let output = systemCommandOutput("/usr/sbin/lsof", ["-nP", "-tiTCP:\(port)", "-sTCP:LISTEN"]) else {
            return nil
        }
        return output
            .split(whereSeparator: \.isNewline)
            .compactMap { Int32($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .first
    }

    private func processCommandLine(pid: Int32) -> String? {
        systemCommandOutput("/bin/ps", ["-p", "\(pid)", "-o", "command="])?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func systemCommandOutput(_ executable: String, _ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                return nil
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }

    private func bundledReleaseStatus() -> ReleaseStatusResource? {
        guard let url = Bundle.main.url(forResource: "release-status", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? JSONDecoder().decode(ReleaseStatusResource.self, from: data)
    }

    private func releaseArtifactTitle(kind: String) -> String {
        switch kind {
        case "dmg": return "DMG 설치 파일"
        case "zip": return "ZIP 백업 파일"
        case "manifest": return "릴리즈 명세"
        case "install-guide": return "설치 안내"
        case "release-index": return "통합 릴리즈 인덱스"
        default: return kind.uppercased()
        }
    }

    private func releaseArtifactURL(fileName: String) -> URL? {
        releaseDirectoryCandidates()
            .map { $0.appending(path: fileName) }
            .first { FileManager.default.fileExists(atPath: $0.path(percentEncoded: false)) }
    }

    private func releaseDirectoryURL() -> URL? {
        releaseDirectoryCandidates().first { url in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: url.path(percentEncoded: false), isDirectory: &isDirectory) && isDirectory.boolValue
        }
    }

    private func releaseDirectoryCandidates() -> [URL] {
        var candidates: [URL] = [
            Bundle.main.bundleURL
                .deletingLastPathComponent()
                .appending(path: "release", directoryHint: .isDirectory),
        ]
        if let recordedURL = recordedRepositoryURL() {
            candidates.append(recordedURL.appending(path: "dist/macos/release", directoryHint: .isDirectory))
        }
        candidates.append(URL(fileURLWithPath: settings.repositoryPath, isDirectory: true).appending(path: "dist/macos/release", directoryHint: .isDirectory))

        var seen = Set<String>()
        return candidates.filter { url in
            let path = url.standardizedFileURL.path(percentEncoded: false)
            if seen.contains(path) {
                return false
            }
            seen.insert(path)
            return true
        }
    }

    private func discoveredReleaseArtifacts() -> [ReleaseArtifactInfo] {
        let files = releaseDirectoryFiles()
        return [
            discoveredReleaseArtifact(kind: "dmg", title: "DMG 설치 파일", fileExtension: "dmg", files: files),
            discoveredReleaseArtifact(kind: "zip", title: "ZIP 백업 파일", fileExtension: "zip", files: files),
            discoveredReleaseArtifact(kind: "manifest", title: "릴리즈 명세", fileExtension: "json", files: files),
            discoveredReleaseArtifact(kind: "install-guide", title: "설치 안내", fileExtension: "md", files: files),
            discoveredReleaseArtifact(kind: "release-index", title: "통합 릴리즈 인덱스", fileExtension: "json", files: files),
        ]
    }

    private func discoveredReleaseArtifact(kind: String, title: String, fileExtension: String, files: [URL]) -> ReleaseArtifactInfo {
        let file = files
            .filter { url in
                guard url.pathExtension == fileExtension else {
                    return false
                }
                switch kind {
                case "manifest":
                    return url.lastPathComponent.contains(".manifest.")
                case "release-index":
                    return url.lastPathComponent.contains("release-index")
                case "install-guide":
                    return url.lastPathComponent.contains("install")
                default:
                    return true
                }
            }
            .sorted { lhs, rhs in
                modificationDate(lhs) > modificationDate(rhs)
            }
            .first
        return ReleaseArtifactInfo(
            title: title,
            detail: file.map { $0.path(percentEncoded: false) } ?? "npm run mac:package 후 표시",
            exists: file != nil,
            url: file
        )
    }

    private func releaseDirectoryFiles() -> [URL] {
        guard let releaseDirectory = releaseDirectoryURL(),
              let files = try? FileManager.default.contentsOfDirectory(
                at: releaseDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
              ) else {
            return []
        }
        return files.filter { $0.lastPathComponent.hasPrefix("StockAnalysis-") }
    }

    private func discoveredManifestSummary() -> ReleaseManifestSummary? {
        guard let manifestURL = discoveredReleaseArtifacts().first(where: { $0.title == "릴리즈 명세" })?.url,
              let data = try? Data(contentsOf: manifestURL),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return nil
        }
        let notarization = json["notarization"] as? [String: Any]
        let distribution = json["distribution"] as? [String: Any]
        let compatibility = json["compatibility"] as? [String: Any]
        return ReleaseManifestSummary(
            fileName: manifestURL.lastPathComponent,
            builtAt: Self.string(json["builtAt"]) ?? "-",
            signingIdentity: Self.string(json["signingIdentity"]) ?? "-",
            arch: Self.string(distribution?["architecture"]) ?? Self.string(json["arch"]) ?? "unknown",
            notarizationRequested: Self.bool(notarization?["requested"]) ?? false,
            notarizationStapled: Self.bool(notarization?["stapled"]) ?? false,
            readinessLabel: Self.string(distribution?["label"]),
            readinessStatus: Self.string(distribution?["status"]),
            readyForExternalDistribution: Self.bool(distribution?["readyForExternalDistribution"]),
            gatekeeperRisk: Self.string(distribution?["gatekeeperRisk"]),
            minimumMacOS: Self.string(compatibility?["minimumMacOS"]),
            supportedArchitectures: Self.stringArray(compatibility?["supportedArchitectures"]),
            bundledNodeVersion: Self.string(compatibility?["bundledNodeVersion"]),
            sidecarVerified: Self.bool(compatibility?["sidecarVerified"]),
            warnings: Self.stringArray(distribution?["warnings"]),
            nextSteps: Self.stringArray(distribution?["nextSteps"]),
            operatorChecklist: Self.stringArray(distribution?["operatorChecklist"])
        )
    }

    private func modificationDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    private func bundledNodeURL() -> URL? {
        guard let nodeURL = bundledNodeCandidateURL(),
              FileManager.default.isExecutableFile(atPath: nodeURL.path(percentEncoded: false)) else {
            return nil
        }
        return nodeURL
    }

    private func bundledNodeCandidateURL() -> URL? {
        Bundle.main.resourceURL?.appending(path: "node/bin/node")
    }

    private func attachSidecarLog(to process: Process) {
        do {
            let logURL = store.sidecarLogURL
            if !FileManager.default.fileExists(atPath: logURL.path(percentEncoded: false)) {
                FileManager.default.createFile(atPath: logURL.path(percentEncoded: false), contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logURL)
            try handle.seekToEnd()
            if let header = "\n--- sidecar start \(Date().ISO8601Format()) ---\n".data(using: .utf8) {
                try handle.write(contentsOf: header)
            }
            process.standardOutput = handle
            process.standardError = handle
            sidecarLogHandle = handle
        } catch {
            statusLine = "sidecar 로그 준비 실패: \(error.localizedDescription)"
        }
    }

    func refreshHealth() async {
        do {
            let nextHealth = try await client.health()
            guard isCurrentBundledSidecar(nextHealth) else {
                terminateManagedSidecar(on: activeEnginePort, reason: "stale sidecar health")
                health = nil
                automationHealth = nil
                statusLine = "stale sidecar detected"
                return
            }
            health = nextHealth
            automationHealth = try? await client.automationHealth()
            if let response = try? await client.localKillSwitch() {
                applyKillSwitch(response.killSwitch)
            }
            if let response = try? await client.localWorkerControl() {
                applyWorkerControl(response.workerControl)
            }
            if let response = try? await client.localAutomationScheduler() {
                automationSchedulerState = response.scheduler
            }
            isStartingSidecar = false
            statusLine = "sidecar online"
            sidecarStartupDiagnostic = .ready
            lastUpdated = Self.timeFormatter.string(from: Date())
        } catch {
            health = nil
            statusLine = "sidecar offline"
        }
    }

    private func ensureSidecarReadyForRequest() async -> Bool {
        await refreshHealth()
        if health?.ok == true {
            return true
        }
        startSidecar()
        for _ in 1...12 {
            try? await Task.sleep(for: .milliseconds(500))
            await refreshHealth()
            if health?.ok == true {
                return true
            }
            if sidecar == nil, !isStartingSidecar {
                startSidecar()
            }
        }
        return false
    }

    func refreshNews() async {
        await refreshNews(silent: false)
    }

    private func refreshNews(silent: Bool) async {
        do {
            let response = try await loadNews(limit: 60)
            if !silent {
                statusLine = "news refreshed · \(response.events.count) events"
            }
        } catch {
            newsSourceStatusMessage = "뉴스 갱신 실패: \(Self.errorMessage(error))"
            if !silent {
                statusLine = error.localizedDescription
            }
        }
    }

    private func startNewsRefreshLoop() {
        guard newsRefreshTask == nil else {
            return
        }
        newsRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(120))
                guard !Task.isCancelled else {
                    return
                }
                guard let self else {
                    return
                }
                guard self.health?.ok == true else {
                    continue
                }
                await self.refreshNews(silent: true)
            }
        }
    }

    func refreshCommunitySentiment(symbol: String, market: String) async {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        communityRefreshGeneration += 1
        let requestGeneration = communityRefreshGeneration
        communitySentiment = nil
        guard !normalizedSymbol.isEmpty else {
            communitySentimentMessage = "민심을 조회할 종목을 먼저 선택하세요."
            return
        }
        communitySentimentMessage = "\(normalizedSymbol) 민심 근거를 수집 중입니다."
        do {
            let response = try await client.communitySentiment(
                symbol: normalizedSymbol,
                market: market,
                includeBroad: false,
                refresh: true
            )
            guard requestGeneration == communityRefreshGeneration else {
                return
            }
            communitySentiment = response
            communitySentimentMessage = response.lowEvidence
                ? "\(normalizedSymbol) 민심 표본이 부족합니다. 소스 상태와 근거 수를 함께 확인하세요."
                : "\(normalizedSymbol) 민심 갱신 · 근거 \(response.evidenceCount)건 · 신뢰도 \(response.confidence)%"
        } catch {
            guard requestGeneration == communityRefreshGeneration else {
                return
            }
            communitySentiment = nil
            communitySentimentMessage = "\(normalizedSymbol) 민심 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func completeOnboarding() {
        settings.hasCompletedOnboarding = true
        try? store.saveSettings(settings)
    }

    func refreshNewsSummary() async -> String {
        do {
            let response = try await loadNews(limit: 60)
            statusLine = "news refreshed"
            return Self.newsPreview(response)
        } catch {
            statusLine = error.localizedDescription
            return "뉴스 갱신 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshStatusSummary() async -> String {
        await refreshHealth()
        if health?.ok == true {
            await refreshPaperTradingState()
            await refreshStrategyConfigs(replacingMessage: false)
        }
        var lines = ["상태 갱신 요약"]
        if let health {
            lines.append("Sidecar: 정상 · pid \(health.pid.map(String.init) ?? "-")")
            lines.append("포트: \(activeEnginePort)")
            lines.append("저장소: \(health.storageRoot ?? "미확인")")
            lines.append("작업 폴더: \(health.workingDirectory ?? "-")")
            if let buildId = health.sidecarBuildId {
                lines.append("빌드: \(buildId)")
            }
        } else {
            lines.append("Sidecar: 오프라인")
            lines.append("다음 행동: 엔진 시작 버튼으로 local-engine을 시작하세요.")
        }
        if let automationHealth {
            lines.append("자동화 health: \(automationHealth.overall) · 저장소 \(automationHealth.storageMode)")
        }
        lines.append("긴급 중지: \(killSwitchEngaged ? "ON" : "OFF")")
        lines.append("워커: \(workerPausedEffective ? "일시중지" : "감시")")
        lines.append("연속 자동 실행: \(automationSchedulerState?.enabled == true ? "ON" : "OFF")")
        lines.append("실거래 게이트: \(liveGateLabel)")
        let enabledStrategyCount = strategyConfigs.filter { $0.status == "enabled" }.count
        lines.append("전략: 전체 \(strategyConfigs.count)개 · 활성 \(enabledStrategyCount)개")
        if let paperTradingState {
            let usCash = paperTradingState.accounts["US"].map { price($0.cash, currency: $0.currency) } ?? "-"
            let krCash = paperTradingState.accounts["KR"].map { price($0.cash, currency: $0.currency) } ?? "-"
            lines.append("모의 계좌: US \(usCash) · KR \(krCash) · 포지션 \(paperTradingState.positions.count)개")
        }
        return lines.joined(separator: "\n")
    }

    func refreshPaperTradingState() async {
        do {
            let response = try await client.paperTradingState()
            paperTradingState = response.state
            paperTradingMessage = response.repaired
                ? "paper state가 복구되어 기본 계좌로 다시 준비됐습니다."
                : "paper state 갱신 · 포지션 \(response.state.positions.count)개 · 주문 \(response.state.orders.count)건"
        } catch {
            paperTradingMessage = "paper state 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshRealPortfolio(forceRefresh: Bool = false) async {
        do {
            let response = try await client.realPortfolio(forceRefresh: forceRefresh)
            realPortfolio = response
            let connected = response.providers.filter { $0.connectionStatus == "connected" }.count
            let warnings = response.providers.filter { $0.partial || $0.stale || $0.error != nil }.count
            realPortfolioMessage = warnings > 0
                ? "실자산 갱신 · 연결 \(connected)곳 · 확인 필요 \(warnings)곳"
                : "실자산 갱신 · 연결 \(connected)곳 · 주문 제출 없음"
        } catch {
            realPortfolioMessage = "실자산 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func resetPaperTradingState(symbol: String, session: String) async -> String {
        do {
            let response = try await client.resetPaperTradingState()
            paperTradingState = response.state
            paperTradingMessage = "paper 계좌를 기본 현금으로 초기화했습니다."
            await refreshTerminalDashboard(symbol: symbol, session: session)
            statusLine = "paper state reset"
            let usCash = response.state.accounts["US"].map { price($0.cash, currency: $0.currency) } ?? "-"
            let krCash = response.state.accounts["KR"].map { price($0.cash, currency: $0.currency) } ?? "-"
            return "모의 계좌를 초기화했습니다. US \(usCash) · KR \(krCash)"
        } catch {
            let message = Self.errorMessage(error)
            paperTradingMessage = "paper state 초기화 실패: \(message)"
            statusLine = message
            return "모의 계좌 초기화 실패: \(message)"
        }
    }

    private func loadNews(limit: Int) async throws -> NewsPollResponse {
        let response = try await client.news(limit: limit)
        newsEvents = response.events
        latestAlerts = response.alertCandidates
        newsSourceErrors = response.errors
        newsLastGeneratedAt = response.generatedAt
        newsSourceStatusMessage = response.errors.isEmpty
            ? "공식/RSS 소스 갱신 완료 · 오류 없음"
            : "공식/RSS 소스 \(response.errors.count)곳에서 오류가 발생했습니다. 정상 소스의 저장 이벤트는 유지됩니다."
        lastUpdated = Self.timeFormatter.string(from: Date())
        if settings.alertsEnabled {
            await notifier.requestAuthorization()
            for event in response.alertCandidates.prefix(3) {
                await notifier.deliver(event: event)
            }
        }
        return response
    }

    func runAppSelfTest() async {
        guard health != nil else {
            appSelfTestMessage = "sidecar가 꺼져 있어 점검을 실행할 수 없습니다."
            return
        }
        do {
            let response = try await client.localSelfTest()
            appSelfTest = response
            let label: String
            switch response.overall {
            case "pass": label = "통과"
            case "warn": label = "경고"
            case "fail": label = "실패"
            default: label = response.overall
            }
            appSelfTestMessage = "점검 \(label) · 통과 \(response.summary.pass) · 경고 \(response.summary.warn) · 실패 \(response.summary.fail)"
            statusLine = "self-test \(response.overall)"
        } catch {
            if Self.isCancellation(error) {
                return
            }
            appSelfTestMessage = "점검 실패: \(Self.errorMessage(error))"
            statusLine = "self-test failed"
        }
    }

    func refreshBrokerCredential() async {
        do {
            let response = try await client.brokerCredential()
            applyBrokerCredentialResponse(response)
        } catch {
            brokerCredentialMessage = "Toss 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshKeychainCredentialStatus() {
        do {
            keychainCredentialStored = try keychain.readInteractively(broker: "toss") != nil
            keychainCredentialMessage = keychainCredentialStored
                ? "macOS Keychain에 Toss credential 백업이 있습니다."
                : "macOS Keychain에 저장된 Toss credential이 없습니다."
        } catch {
            keychainCredentialStored = false
            keychainCredentialMessage = "Keychain 조회 실패: \(Self.errorMessage(error))"
        }
    }

    @discardableResult
    func resetKeychainAccess() -> Bool {
        guard Self.isDeveloperIDApplicationSigned() else {
            keychainCredentialMessage = "Keychain 권한 재설정은 Developer ID로 서명·공증한 /Applications 설치본에서만 실행할 수 있습니다."
            return false
        }
        do {
            let result = try KeychainAccessResetter.reset(using: keychain)
            keychainCredentialStored = result.hasToss
            redditCredentialStored = result.hasReddit
            keychainCredentialMessage = result.credentialCount == 0
                ? "재설정할 Keychain credential이 없습니다."
                : "Keychain credential \(result.credentialCount)개의 앱 접근 권한을 현재 서명 기준으로 다시 저장했습니다."
            return true
        } catch {
            keychainCredentialMessage = "Keychain 권한 재설정 실패: \(Self.errorMessage(error)). API 키를 삭제하지 않았습니다."
            return false
        }
    }

    func restoreBrokerCredentialFromKeychain() async {
        do {
            guard let credential = try keychain.readInteractively(broker: "toss") else {
                keychainCredentialStored = false
                keychainCredentialMessage = "Keychain에 복구할 Toss credential이 없습니다."
                return
            }
            let response = try await client.registerBrokerCredential(
                clientId: credential.clientId,
                clientSecret: credential.clientSecret
            )
            applyBrokerCredentialResponse(response)
            brokerCredentialMessage = response.credential?.status == "verified"
                ? "Keychain credential로 Toss 검증과 sidecar 저장소 복구를 완료했습니다."
                : "Keychain credential을 sidecar로 보냈지만 검증 완료 상태가 아닙니다."
            keychainCredentialStored = true
            keychainCredentialMessage = "Keychain credential을 사용해 sidecar 저장소를 복구했습니다."
            await refreshHealth()
            await refreshBrokerDiagnostics()
            await runTossReadiness()
            await refreshLocalLiveTrading()
        } catch {
            keychainCredentialMessage = "Keychain 복구 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshBrokerAccounts() async {
        do {
            let response = try await client.brokerAccountPreference()
            applyBrokerCredentialResponse(response)
            if let accountsError = response.accountsError, !accountsError.isEmpty {
                brokerAccountMessage = "계좌 조회 실패: \(accountsError)"
            } else if let preference = response.accountPreference {
                brokerAccountMessage = "자동거래 계좌 #\(preference.accountSeq)를 사용합니다."
            } else if brokerAccounts.isEmpty {
                brokerAccountMessage = "검증 완료된 Toss API 키가 있어야 계좌를 조회할 수 있습니다."
            } else {
                brokerAccountMessage = "자동거래에 사용할 계좌를 선택하세요."
            }
        } catch {
            brokerAccountMessage = "Toss 계좌 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func selectBrokerAccount(_ account: BrokerAccountView) async {
        do {
            let response = try await client.updateBrokerAccountPreference(accountSeq: account.accountSeq)
            applyBrokerCredentialResponse(response)
            brokerAccountMessage = "자동거래 계좌 #\(account.accountSeq)를 선택했습니다."
            await refreshBrokerDiagnostics()
            await runTossReadiness()
            await refreshLocalLiveTrading()
        } catch {
            brokerAccountMessage = "자동거래 계좌 선택 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshBrokerDiagnostics(includePublicIP: Bool = false) async {
        do {
            let response = try await client.brokerDiagnostics(includePublicIP: includePublicIP)
            brokerDiagnostics = response
            let gate = response.liveGate.automationQueueReady
                ? "paper 자동화 준비"
                : "paper 자동화 점검 필요"
            let ip = response.egress.ip ?? (response.egress.status == "not-requested" ? "공인 IP 미조회" : "공인 IP 미확인")
            brokerDiagnosticsMessage = "\(gate) · \(ip) · \(response.liveGate.readinessOverall)"
        } catch {
            brokerDiagnosticsMessage = "Toss 진단 실패: \(Self.errorMessage(error))"
        }
    }

    func runTossReadiness(symbol: String = "NVDA") async {
        do {
            let response = try await client.tossReadiness(symbol: symbol)
            tossReadiness = response
            brokerCredential = response.credential ?? brokerCredential
            brokerAccountPreference = response.accountPreference ?? brokerAccountPreference
            let statusLabel: String
            switch response.status {
            case "account-ready":
                statusLabel = "조회 준비"
            case "account-selection-required":
                statusLabel = "계좌 선택 필요"
            case "credential-missing":
                statusLabel = "credential 필요"
            case "api-error":
                statusLabel = "Toss 오류"
            default:
                statusLabel = response.status
            }
            tossReadinessMessage = "\(statusLabel) · \(response.summary)"
            statusLine = response.ok ? "toss readiness pass" : "toss readiness attention"
        } catch {
            if Self.isCancellation(error) {
                return
            }
            tossReadinessMessage = "Toss 운영 준비 점검 실패: \(Self.errorMessage(error))"
            statusLine = "toss readiness failed"
        }
    }

    func refreshLocalLiveTrading() async {
        do {
            let response = try await client.localLiveTrading()
            localLiveTrading = response.liveTrading
            brokerCredential = response.credential ?? brokerCredential
            localLiveTradingMessage = liveTradingMessage(response.liveTrading)
        } catch {
            localLiveTradingMessage = "실거래 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshKillSwitch() async {
        do {
            let response = try await client.localKillSwitch()
            applyKillSwitch(response.killSwitch)
            killSwitchMessage = response.killSwitch.engaged
                ? "sidecar 긴급 중지 활성 · \(response.killSwitch.reason ?? "사유 없음")"
                : "sidecar 긴급 중지 해제 · 모의 주문과 자동화 큐를 실행할 수 있습니다."
        } catch {
            killSwitchMessage = "긴급 중지 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func setKillSwitchEngaged(_ engaged: Bool, reason: String) async {
        guard !killSwitchTransitionPending else { return }
        killSwitchTransitionPending = true
        defer { killSwitchTransitionPending = false }
        killSwitchMessage = engaged ? "sidecar 긴급 중지를 요청 중입니다." : "sidecar 긴급 중지 해제를 요청 중입니다."
        statusLine = engaged ? "kill switch request pending" : "kill switch release pending"
        do {
            let response = try await client.updateLocalKillSwitch(engaged: engaged, reason: reason)
            applyKillSwitch(response.killSwitch)
            statusLine = response.killSwitch.engaged ? "kill switch engaged" : "kill switch released"
            killSwitchMessage = response.killSwitch.engaged
                ? "sidecar 긴급 중지 활성 · \(response.killSwitch.reason ?? reason)"
                : "sidecar 긴급 중지를 해제했습니다."
        } catch {
            statusLine = "kill switch request failed"
            killSwitchMessage = "긴급 중지 상태 변경 실패 · 마지막 확인 상태를 유지합니다: \(Self.errorMessage(error))"
        }
        await refreshWorkerControl()
        await refreshCurrentTerminalDashboard()
    }

    func refreshWorkerControl() async {
        do {
            let response = try await client.localWorkerControl()
            applyWorkerControl(response.workerControl)
            workerControlMessage = response.workerControl.paused
                ? "sidecar 워커 일시중지 · \(response.workerControl.reason ?? "사유 없음")"
                : "sidecar 워커 감시 중 · 자동화 큐를 실행할 수 있습니다."
        } catch {
            workerControlMessage = "워커 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func setWorkerPaused(_ paused: Bool, reason: String) async {
        guard !workerControlTransitionPending else { return }
        workerControlTransitionPending = true
        defer { workerControlTransitionPending = false }
        workerControlMessage = paused ? "sidecar 워커 일시중지를 요청 중입니다." : "sidecar 워커 재개를 요청 중입니다."
        statusLine = paused ? "worker pause pending" : "worker resume pending"
        do {
            let response = try await client.updateLocalWorkerControl(paused: paused, reason: reason)
            applyWorkerControl(response.workerControl)
            statusLine = response.workerControl.paused ? "worker paused" : "worker resumed"
            workerControlMessage = response.workerControl.paused
                ? "sidecar 워커 일시중지 · \(response.workerControl.reason ?? reason)"
                : "sidecar 워커 일시중지를 해제했습니다."
        } catch {
            statusLine = "worker state request failed"
            workerControlMessage = "워커 상태 변경 실패 · 마지막 확인 상태를 유지합니다: \(Self.errorMessage(error))"
        }
    }

    func refreshAutomationScheduler() async {
        do {
            let response = try await client.localAutomationScheduler()
            automationSchedulerState = response.scheduler
            automationSchedulerMessage = schedulerMessage(response.scheduler)
        } catch {
            automationSchedulerMessage = "연속 자동 실행 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func setAutomationSchedulerEnabled(_ enabled: Bool, intervalSeconds: Int) async {
        if enabled, executionBlocked || workerPausedEffective {
            automationSchedulerMessage = "긴급 중지 또는 워커 일시중지 전환 중에는 연속 자동 실행을 시작할 수 없습니다."
            return
        }
        do {
            let response = try await client.updateLocalAutomationScheduler(
                enabled: enabled,
                intervalSeconds: intervalSeconds
            )
            automationSchedulerState = response.scheduler
            automationSchedulerMessage = schedulerMessage(response.scheduler)
        } catch {
            automationSchedulerMessage = "연속 자동 실행 설정 실패: \(Self.errorMessage(error))"
        }
    }

    private func schedulerMessage(_ state: LocalAutomationSchedulerState) -> String {
        if !state.enabled {
            return "연속 자동 실행 OFF · 활성 전략은 자동으로 실행되지 않습니다."
        }
        let nextRun = state.nextRunAt ?? "계산 중"
        let last = state.lastMessage ?? "실행 이력 없음"
        return "연속 자동 실행 ON · \(state.intervalSeconds)초 주기 · 다음 \(nextRun) · \(last)"
    }

    func consentLocalLiveTrading(confirmation: String) async {
        do {
            let response = try await client.consentLocalLiveTrading(confirmation: confirmation)
            localLiveTrading = response.liveTrading
            brokerCredential = response.credential ?? brokerCredential
            localLiveTradingMessage = "Toss 실거래 위험 이용 동의를 기록했습니다. 수동 주문은 계속 OFF입니다."
            await refreshBrokerDiagnostics()
        } catch {
            localLiveTradingMessage = "실거래 이용 동의 실패: \(Self.errorMessage(error))"
        }
    }

    func setLocalLiveTradingUserEnabled(_ enabled: Bool, confirmation: String? = nil) async {
        do {
            let response = try await client.updateLocalLiveTrading(enabled: enabled, confirmation: confirmation)
            localLiveTrading = response.liveTrading
            brokerCredential = response.credential ?? brokerCredential
            localLiveTradingMessage = enabled
                ? liveTradingMessage(response.liveTrading)
                : "Toss 자동화는 paper 전용입니다."
            await refreshBrokerDiagnostics()
        } catch {
            localLiveTradingMessage = "실거래 토글 변경 실패: \(Self.errorMessage(error))"
        }
    }

    func setLocalAutomationLiveTradingEnabled(_ enabled: Bool, confirmation: String? = nil) async {
        do {
            let response = try await client.updateLocalAutomationLiveTrading(enabled: enabled, confirmation: confirmation)
            localLiveTrading = response.liveTrading
            localLiveTradingMessage = enabled
                ? "자동화 실거래 토글이 켜졌습니다. 각 주문은 여전히 지정가·한도·전략 위험 한도를 다시 통과합니다."
                : "자동화 실거래 토글을 껐습니다."
            await refreshBrokerDiagnostics()
        } catch {
            localLiveTradingMessage = "자동화 실거래 토글 변경 실패: \(Self.errorMessage(error))"
        }
    }

    func verifyLocalLiveTradingSafetyGates() async {
        do {
            let response = try await client.verifyLocalLiveTradingSafetyGates()
            localLiveTrading = response.liveTrading
            localLiveTradingMessage = "kill switch와 worker pause 차단 점검이 기록되었습니다."
        } catch {
            localLiveTradingMessage = "안전 게이트 점검 기록 실패: \(Self.errorMessage(error))"
        }
    }

    func setLocalLiveTradingOperatorEnabled(_ enabled: Bool) {
        settings.liveTradingOperatorEnabled = false
        try? store.saveSettings(settings)
        localLiveTradingMessage = enabled
            ? "실거래 정책은 자동 readiness·계좌 바인딩·이용 동의·typed confirmation으로만 변경할 수 있습니다."
            : "Toss 자동화는 별도 자동화 실거래 토글을 켜기 전 paper 전용입니다."
        if enabled {
            statusLine = "use local live trading policy controls"
        }
    }

    func setCryptoLiveTradingOperatorEnabled(_ enabled: Bool) {
        settings.cryptoLiveTradingOperatorEnabled = false
        try? store.saveSettings(settings)
        cryptoExchangeMessage = enabled
            ? "코인 실거래는 거래소별 자동 readiness·이용 동의·수동/자동 토글·주문 요약 재입력 경로에서만 변경할 수 있습니다."
            : "Upbit·Bithumb 지정가 실거래 토글은 기본 OFF입니다."
        if enabled {
            statusLine = "use Upbit local manual live trading controls"
        }
    }

    func registerBrokerCredential(clientId: String, clientSecret: String) async -> Bool {
        do {
            let response = try await client.registerBrokerCredential(clientId: clientId, clientSecret: clientSecret)
            if response.credential?.status == "verified" {
                do {
                    try keychain.save(BrokerCredential(clientId: clientId, clientSecret: clientSecret))
                    keychainCredentialStored = true
                    keychainCredentialMessage = "검증 완료된 Toss credential을 macOS Keychain에도 저장했습니다."
                } catch {
                    keychainCredentialMessage = "Toss 검증은 완료됐지만 Keychain 저장 실패: \(Self.errorMessage(error))"
                }
            }
            applyBrokerCredentialResponse(response)
            brokerCredentialMessage = response.credential?.status == "verified"
                ? "Toss 검증 완료. 계좌 \(brokerAccounts.count)개를 확인했습니다."
                : "Toss API 키를 저장했습니다."
            if let preference = response.accountPreference {
                brokerAccountMessage = "자동거래 계좌 #\(preference.accountSeq)를 사용합니다."
            } else if brokerAccounts.count > 1 {
                brokerAccountMessage = "여러 계좌가 확인되었습니다. 자동거래 계좌를 선택하세요."
            }
            await refreshHealth()
            await refreshBrokerDiagnostics()
            await runTossReadiness()
            await refreshLocalLiveTrading()
            return true
        } catch {
            brokerCredentialMessage = "Toss 등록 실패: \(Self.errorMessage(error))"
            return false
        }
    }

    func deleteBrokerCredential() async {
        do {
            _ = try await client.deleteBrokerCredential()
            do {
                try keychain.delete(broker: "toss")
                keychainCredentialStored = false
                keychainCredentialMessage = "macOS Keychain의 Toss credential도 삭제했습니다."
            } catch {
                keychainCredentialMessage = "sidecar credential은 삭제했지만 Keychain 삭제 실패: \(Self.errorMessage(error))"
            }
            brokerCredential = nil
            brokerAccounts = []
            brokerAccountPreference = nil
            brokerCredentialMessage = "Toss API 키를 삭제했고 실거래 권한 플래그를 해제했습니다."
            brokerAccountMessage = "Toss API 키를 다시 등록하면 자동거래 계좌를 선택할 수 있습니다."
            tossReadiness = nil
            tossReadinessMessage = "운영 준비 점검은 저장된 Toss credential로 토큰/계좌/보유/미체결 조회를 주문 없이 확인합니다."
            await refreshHealth()
            await refreshBrokerDiagnostics()
            await refreshLocalLiveTrading()
        } catch {
            brokerCredentialMessage = "Toss 삭제 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshStrategyConfigs(replacingMessage: Bool = true) async {
        do {
            let response = try await client.strategyConfigs()
            strategyConfigs = response.configs
            if replacingMessage {
                strategyMessage = response.configs.isEmpty
                    ? "저장된 전략이 없습니다. 분할 또는 순환 전략을 초안으로 저장하세요."
                    : "전략 \(response.configs.count)개를 불러왔습니다."
            }
        } catch {
            strategyMessage = "전략 목록 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func copyStrategyBackupToClipboard() async {
        do {
            let bundle = try await client.exportStrategyConfigs()
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(bundle)
            guard let text = String(data: data, encoding: .utf8) else {
                strategyMessage = "전략 백업 JSON을 만들 수 없습니다."
                return
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            strategyMessage = "전략 \(bundle.configCount)개 백업 JSON을 클립보드에 복사했습니다. Toss 키와 계좌 정보는 포함하지 않았습니다."
        } catch {
            strategyMessage = "전략 백업 실패: \(Self.errorMessage(error))"
        }
    }

    func importStrategyBackupFromClipboard() async {
        guard let text = NSPasteboard.general.string(forType: .string),
              let data = text.data(using: .utf8) else {
            strategyMessage = "클립보드에 전략 백업 JSON이 없습니다."
            return
        }
        do {
            let bundle = try JSONDecoder().decode(StrategyExportBundle.self, from: data)
            let response = try await client.importStrategyConfigs(bundle)
            await refreshStrategyConfigs(replacingMessage: false)
            strategyMessage = "전략 \(response.imported)개를 초안으로 가져왔습니다. 활성화 전 시뮬레이션을 다시 실행하세요."
        } catch {
            strategyMessage = "전략 가져오기 실패: \(Self.errorMessage(error))"
        }
    }

    @discardableResult
    func createStrategyDraft(_ input: StrategyDraftInput) async -> StrategyConfigView? {
        do {
            let response = try await client.createStrategyDraft(input)
            latestStrategyTickPreview = nil
            strategyMessage = "\(response.config.name) 초안을 저장했습니다. 활성화 전 시뮬레이션이 필요합니다."
            await refreshStrategyConfigs(replacingMessage: false)
            return response.config
        } catch {
            strategyMessage = "전략 저장 실패: \(Self.errorMessage(error))"
            return nil
        }
    }

    @discardableResult
    func updateStrategyDraft(_ config: StrategyConfigView, input: StrategyDraftInput) async -> StrategyConfigView? {
        do {
            let response = try await client.updateStrategyDraft(id: config.id, input: input)
            if latestStrategySimulation?.strategyConfigId == config.id {
                latestStrategySimulation = nil
            }
            if latestStrategyTickPreview != nil {
                latestStrategyTickPreview = nil
            }
            strategyMessage = "\(response.config.name) 전략을 수정했습니다. 변경된 설정은 다시 시뮬레이션해야 활성화할 수 있습니다."
            await refreshStrategyConfigs(replacingMessage: false)
            return response.config
        } catch {
            strategyMessage = "전략 수정 실패: \(Self.errorMessage(error))"
            return nil
        }
    }

    func simulateStrategy(_ config: StrategyConfigView) async {
        do {
            let response = try await client.simulateStrategy(id: config.id)
            latestStrategySimulation = response.result
            strategyMessage = response.result.summary
            await refreshStrategyConfigs(replacingMessage: false)
        } catch {
            strategyMessage = "시뮬레이션 실패: \(Self.errorMessage(error))"
        }
    }

    func previewStrategyTick(_ config: StrategyConfigView, scenario: String) async {
        do {
            let data = try await client.previewStrategyTick(id: config.id, scenario: scenario)
            latestStrategyTickPreview = Self.strategyTickPreview(data)
            strategyMessage = "\(config.name) 전략 tick 점검을 완료했습니다. 실거래 주문은 전송하지 않았습니다."
        } catch {
            latestStrategyTickPreview = nil
            strategyMessage = "전략 tick 점검 실패: \(Self.errorMessage(error))"
        }
    }

    func setStrategyStatus(_ config: StrategyConfigView, status: String) async {
        do {
            let response = try await client.updateStrategyStatus(id: config.id, status: status)
            latestStrategyTickPreview = nil
            strategyMessage = response.config.status == "enabled"
                ? "\(response.config.name) 전략을 활성화했습니다. 현재 \(liveGateLabel) 상태입니다."
                : "\(response.config.name) 전략을 일시정지했습니다."
            await refreshStrategyConfigs(replacingMessage: false)
        } catch {
            strategyMessage = "전략 상태 변경 실패: \(Self.errorMessage(error))"
        }
    }

    func deleteStrategy(_ config: StrategyConfigView) async {
        do {
            _ = try await client.deleteStrategy(id: config.id)
            strategyMessage = "\(config.name) 전략을 삭제했습니다."
            if latestStrategySimulation?.strategyConfigId == config.id {
                latestStrategySimulation = nil
            }
            latestStrategyTickPreview = nil
            await refreshStrategyConfigs(replacingMessage: false)
        } catch {
            strategyMessage = "전략 삭제 실패: \(Self.errorMessage(error))"
        }
    }

    func strategyPriceSuggestion(symbol: String) -> StrategyPriceSuggestion? {
        let normalized = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else {
            return nil
        }
        if latestMarketAnalysis?.symbol == normalized, let latestClose = latestMarketAnalysis?.latestClose, latestClose > 0 {
            return StrategyPriceSuggestion(price: latestClose, source: "최근 분석 현재가")
        }
        if terminalDashboard?.symbol == normalized, let limitPrice = terminalDashboard?.orderIntent.limitPrice, limitPrice > 0 {
            return StrategyPriceSuggestion(price: limitPrice, source: "OrderIntent 지정가")
        }
        if let config = strategyConfigs.first(where: { $0.symbol.uppercased() == normalized }), config.currentPrice > 0 {
            return StrategyPriceSuggestion(price: config.currentPrice, source: "저장된 전략 기준가")
        }
        return nil
    }

    func refreshTerminalDashboard(symbol: String, session: String) async {
        do {
            terminalDashboard = try await client.terminalDashboard(symbol: symbol, session: session)
            lastUpdated = Self.timeFormatter.string(from: Date())
            statusLine = "\(symbol.uppercased()) dashboard loaded"
        } catch {
            statusLine = Self.errorMessage(error)
        }
    }

    func refreshCurrentTerminalDashboard() async {
        guard let dashboard = terminalDashboard else {
            return
        }
        await refreshTerminalDashboard(symbol: dashboard.symbol, session: dashboard.session)
    }

    func refreshWatchlist() async {
        do {
            let response = try await client.watchlistSummary()
            watchlistItems = response.items
            watchlistMaxItems = response.maxItems
            watchlistMessage = response.items.isEmpty
                ? "관심종목이 없습니다. 차트에서 현재 종목을 추가해보세요."
                : "관심종목 \(response.items.count)개를 갱신했습니다."
            lastUpdated = Self.timeFormatter.string(from: Date())
        } catch {
            watchlistMessage = "관심종목 갱신 실패: \(Self.errorMessage(error))"
        }
    }

    func watchlistSignal(for symbol: String) -> WatchlistSignalItem? {
        let normalized = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return watchlistSignals.first { $0.symbol.uppercased() == normalized }
    }

    func refreshWatchlistSignals(scan: Bool = true) async {
        do {
            let response = try await (scan ? client.scanWatchlistSignals() : client.watchlistSignals())
            watchlistSignals = response.items
            watchlistSignalMarketContext = response.marketContext
            watchlistSignalMessage = response.monitoringMessage
            let responseIsAdvisoryOnly = response.isBrokerStopEligible == false
                && response.orderSubmissionAttempted == false
            watchlistSignalResponseIsAdvisoryOnly = responseIsAdvisoryOnly
            if scan && settings.crashSignalMonitoringEnabled && responseIsAdvisoryOnly {
                let alerts = response.items.filter {
                    $0.notificationEligible
                        && !$0.stale
                        && $0.signal.orderSubmissionAttempted == false
                        && $0.signal.exitPlan?.isBrokerStopEligible == false
                        && $0.tradePlan?.isCalibratedWatchlistEntryEligible == true
                }
                if !alerts.isEmpty {
                    await notifier.requestAuthorization()
                    for item in alerts.prefix(3) {
                        await notifier.deliverCrashSignal(item)
                    }
                }
            }
        } catch {
            watchlistSignalResponseIsAdvisoryOnly = false
            watchlistSignalMessage = "급락 감시 실패: \(Self.errorMessage(error))"
        }
    }

    func toggleCrashSignalMonitoring() async {
        settings.crashSignalMonitoringEnabled.toggle()
        try? store.saveSettings(settings)
        if settings.crashSignalMonitoringEnabled {
            await notifier.requestAuthorization()
            await refreshWatchlistSignals(scan: Self.isKRRegularSession())
            startWatchlistSignalRefreshLoop()
        } else {
            watchlistSignalRefreshTask?.cancel()
            watchlistSignalRefreshTask = nil
            watchlistSignalMessage = "급락 감시가 꺼져 있습니다. 저장된 마지막 결과만 표시합니다."
        }
    }

    private func startWatchlistSignalRefreshLoop() {
        guard settings.crashSignalMonitoringEnabled, watchlistSignalRefreshTask == nil else { return }
        watchlistSignalRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled, let self else { return }
                guard self.health?.ok == true, Self.isKRRegularSession() else { continue }
                await self.refreshWatchlistSignals(scan: true)
            }
        }
    }

    private static func isKRRegularSession(_ date: Date = Date()) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let weekday = calendar.component(.weekday, from: date)
        let hour = calendar.component(.hour, from: date)
        let minute = calendar.component(.minute, from: date)
        guard weekday >= 2 && weekday <= 6 else { return false }
        let minutes = hour * 60 + minute
        return minutes >= 9 * 60 && minutes < 15 * 60 + 30
    }

    func addWatchlistItem(symbol: String, assetClass: String, market: String, name: String? = nil) async {
        do {
            let response = try await client.addWatchlistItem(
                LocalWatchlistItemInput(symbol: symbol, assetClass: assetClass, market: market, name: name)
            )
            watchlistMaxItems = response.maxItems
            watchlistMessage = "\(symbol.uppercased())을(를) 관심종목에 추가했습니다."
            await refreshWatchlist()
        } catch {
            watchlistMessage = "관심종목 추가 실패: \(Self.errorMessage(error))"
        }
    }

    func removeWatchlistItem(id: String) async {
        do {
            let response = try await client.deleteWatchlistItem(id: id)
            watchlistMaxItems = response.maxItems
            watchlistMessage = "관심종목에서 제거했습니다."
            await refreshWatchlist()
        } catch {
            watchlistMessage = "관심종목 제거 실패: \(Self.errorMessage(error))"
        }
    }

    func savePlaybook(_ playbook: DashboardPlaybook, session: String) async -> String {
        do {
            let saved = try await client.savePlaybook(symbol: playbook.symbol, playbook: playbook)
            statusLine = "\(saved.symbol) playbook saved"
            await refreshTerminalDashboard(symbol: saved.symbol, session: session)
            return "\(saved.symbol) 플레이북을 저장했습니다. 워커 모드: \(saved.workerMode)"
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "플레이북 저장 실패: \(message)"
        }
    }

    func saveOrderIntentPlan(_ dashboard: TerminalDashboardSnapshot, session: String) async -> String {
        let intent = dashboard.orderIntent
        let limit = intent.limitPrice.map { price($0, currency: intent.currency) } ?? "시장가"
        let stop = intent.stopPrice.map { price($0, currency: intent.currency) } ?? "RiskCheck 재평가"
        let side = intent.side == "buy" ? "매수" : "매도"
        let rationale = intent.rationale.isEmpty ? "OrderIntent 근거 없음" : intent.rationale.joined(separator: " / ")
        let blockerText = dashboard.riskCheck.blockers.isEmpty
            ? "실거래 전 precheck 재확인"
            : dashboard.riskCheck.blockers.joined(separator: " / ")
        let warningText = dashboard.riskCheck.warnings.isEmpty
            ? "추가 조건은 플레이북 탭에서 보강"
            : dashboard.riskCheck.warnings.joined(separator: " / ")
        let playbook = DashboardPlaybook(
            symbol: dashboard.symbol,
            thesis: "OrderIntent 후보 저장: \(rationale)",
            entryRule: "\(side) \(intent.quantity)주, \(intent.type == "limit" ? "지정가" : intent.type) \(limit)",
            invalidationRule: "손절/무효화: \(stop) · \(blockerText)",
            addRule: "추가매수/재진입: RiskCheck 통과 전 금지 · \(warningText)",
            trimRule: "축소/청산: 뉴스 영향 또는 리스크 경고 발생 시 수동 재검토",
            target: "실거래 게이트 통과 전 paper-only 검증",
            workerMode: "paper-only",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        do {
            let saved = try await client.savePlaybook(symbol: dashboard.symbol, playbook: playbook)
            statusLine = "\(saved.symbol) order plan saved"
            await refreshTerminalDashboard(symbol: saved.symbol, session: session)
            return "\(saved.symbol) OrderIntent 계획을 플레이북에 저장했습니다."
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "계획 저장 실패: \(message)"
        }
    }

    func createMagicSplitDraft(from dashboard: TerminalDashboardSnapshot, session: String) async -> String {
        guard let input = OrderIntentStrategyDraftFactory.makeMagicSplitDraft(from: dashboard, session: session) else {
            return "전략 초안 생성 실패: 지정가와 수량이 있는 OrderIntent가 필요합니다."
        }
        do {
            let latestConfigs = try await client.strategyConfigs()
            strategyConfigs = latestConfigs.configs
            let reusableDraft = OrderIntentStrategyDraftFactory.reusableDraft(in: latestConfigs.configs, for: input)
            let response: StrategyConfigResponse
            if let reusableDraft {
                response = try await client.updateStrategyDraft(id: reusableDraft.id, input: input)
            } else {
                response = try await client.createStrategyDraft(input)
            }
            latestStrategySimulation = nil
            latestStrategyTickPreview = nil
            let actionLabel = reusableDraft == nil ? "저장" : "업데이트"
            strategyMessage = "\(response.config.name) 초안을 \(actionLabel)했습니다. 전략 화면에서 시뮬레이션 후 활성화하세요."
            statusLine = "\(response.config.symbol) 순환분할 초안 \(reusableDraft == nil ? "생성" : "업데이트")"
            await refreshStrategyConfigs(replacingMessage: false)
            return [
                "\(response.config.name) 전략 초안을 \(actionLabel)했습니다.",
                "기준가: \(price(input.basePrice, currency: input.market == "KR" ? "KRW" : "USD")) · \(input.rungCount)차 분할 · 차수당 \(price(input.notional, currency: input.market == "KR" ? "KRW" : "USD"))",
                "다음 행동: 전략 화면에서 시뮬레이션을 통과시킨 뒤 활성화하세요.",
                "확인: broker 주문 제출은 수행하지 않았습니다.",
            ].joined(separator: "\n")
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            strategyMessage = "전략 초안 생성 실패: \(message)"
            return "전략 초안 생성 실패: \(message)"
        }
    }

    func analyze(symbol: String, session: String) async -> String {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let targetSymbol = normalizedSymbol.isEmpty ? "NVDA" : normalizedSymbol
        do {
            let data = try await client.analyze(symbol: targetSymbol)
            latestMarketAnalysis = Self.parseMarketAnalysis(data)
            await refreshPaperTradingState()
            await refreshTerminalDashboard(symbol: targetSymbol, session: session)
            statusLine = "\(targetSymbol) analysis and dashboard loaded"
            return Self.marketAnalysisPreview(data) + "\n\n동기화: OrderIntent/RiskCheck dashboard와 paper state를 \(targetSymbol) 기준으로 갱신했습니다."
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "분석 실패: \(message)"
        }
    }

    func refreshWorkspaceAnalysis(
        symbol: String,
        assetClass: AnalysisAssetClass,
        session: String,
        entryPrice: Double? = nil,
        planMode: AnalysisHoldingPlanMode = .newEntry
    ) async -> String {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let targetSymbol = normalizedSymbol.isEmpty
            ? (assetClass == .crypto ? "KRW-BTC" : "005930.KS")
            : normalizedSymbol
        workspaceAnalysisGeneration += 1
        let requestGeneration = workspaceAnalysisGeneration
        isWorkspaceAnalysisLoading = true
        workspaceAnalysisMessage = "\(targetSymbol) 멀티 타임프레임 데이터를 계산 중입니다."
        defer {
            if requestGeneration == workspaceAnalysisGeneration {
                isWorkspaceAnalysisLoading = false
            }
        }

        do {
            let data = try await client.workspaceAnalysisData(
                symbol: targetSymbol,
                assetClass: assetClass,
                source: .auto,
                entryPrice: entryPrice,
                planMode: planMode
            )
            let workspace = try JSONDecoder().decode(WorkspaceAnalysis.self, from: data)
            guard requestGeneration == workspaceAnalysisGeneration else {
                return "이전 종목 분석 응답을 폐기했습니다."
            }
            guard workspace.orderSubmissionAttempted == false else {
                throw NSError(
                    domain: "YongStockDesk.WorkspaceAnalysis",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "분석 응답이 주문 제출 안전 계약을 위반했습니다."]
                )
            }

            latestWorkspaceAnalysis = workspace
            let dailyData = Self.workspaceAnalysisData(data, key: "daily")
            latestMarketAnalysis = dailyData.flatMap(Self.parseMarketAnalysis)
            workspaceAnalysisMessage = Self.workspaceAnalysisSummary(workspace)
            statusLine = "\(targetSymbol) multi-timeframe analysis loaded"

            let paperResponse = try? await client.paperTradingState()
            guard requestGeneration == workspaceAnalysisGeneration else {
                return "이전 종목 후속 응답을 폐기했습니다."
            }
            if let paperResponse {
                paperTradingState = paperResponse.state
                paperTradingMessage = "paper state 갱신 · 포지션 \(paperResponse.state.positions.count)개 · 주문 \(paperResponse.state.orders.count)건"
            }

            if assetClass == .stock {
                let dashboard = try? await client.terminalDashboard(symbol: targetSymbol, session: session)
                guard requestGeneration == workspaceAnalysisGeneration else {
                    return "이전 종목 대시보드 응답을 폐기했습니다."
                }
                terminalDashboard = dashboard
            } else {
                terminalDashboard = nil
            }
            lastUpdated = Self.timeFormatter.string(from: Date())

            let preview = dailyData.map(Self.marketAnalysisPreview)
                ?? "\(targetSymbol) 일봉 상세 분석 데이터가 없습니다."
            return preview + "\n\n" + Self.workspaceAnalysisSummary(workspace)
        } catch {
            guard requestGeneration == workspaceAnalysisGeneration else {
                return "이전 종목 분석 오류를 폐기했습니다."
            }
            let message = Self.errorMessage(error)
            latestWorkspaceAnalysis = nil
            latestMarketAnalysis = nil
            terminalDashboard = nil
            workspaceAnalysisMessage = "\(targetSymbol) 분석 실패: \(message)"
            statusLine = message
            return workspaceAnalysisMessage
        }
    }

    func refreshChart(
        symbol: String,
        assetClass: AnalysisAssetClass,
        timeframe: AnalysisTimeframe
    ) async {
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalizedSymbol.isEmpty else { return }
        do {
            let data = try await client.chartData(
                symbol: normalizedSymbol,
                assetClass: assetClass,
                timeframe: timeframe
            )
            guard let chart = Self.parseMarketAnalysis(data), chart.timeframe == timeframe.rawValue else {
                throw NSError(
                    domain: "YongStockDesk.Chart",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "차트 응답의 주기를 확인할 수 없습니다."]
                )
            }
            latestChartAnalysis = chart
        } catch {
            latestChartAnalysis = nil
            workspaceAnalysisMessage = "\(timeframe.rawValue) 차트 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshSectorStrength(market: String, forceRefresh: Bool = false) async {
        isSectorStrengthLoading = true
        sectorStrengthMessage = "\(market == "US" ? "미국" : "한국") 섹터 시세를 불러오는 중입니다."
        defer { isSectorStrengthLoading = false }
        do {
            let response = try await client.sectorStrength(market: market, forceRefresh: forceRefresh)
            sectorStrength = response
            let loaded = response.sectors.count
            let warning = response.errors.isEmpty ? "" : " · 일부 조회 실패 \(response.errors.count)개"
            let stale = response.stale ? " · 이전 데이터" : ""
            sectorStrengthMessage = "섹터 \(loaded)개 조회\(warning)\(stale)"
            statusLine = "\(market) sector strength loaded"
            lastUpdated = Self.timeFormatter.string(from: Date())
        } catch {
            let message = Self.errorMessage(error)
            sectorStrengthMessage = "섹터 강도 조회 실패: \(message)"
            statusLine = message
        }
    }

    func searchSymbols(query: String, session: String) async throws -> [LocalSymbolSearchItem] {
        let markets = session == "KR" ? ["KOSPI", "KOSDAQ"] : ["US", "CRYPTO"]
        return try await client.searchSymbols(query: query, markets: markets).matches
    }

    func refreshCryptoExchanges() async {
        guard health != nil else { return }
        do {
            cryptoExchanges = try await client.cryptoExchanges().exchanges
            let verified = cryptoExchanges.filter { $0.credential?.status == "verified" }.map(\.exchange)
            cryptoExchangeMessage = verified.isEmpty
                ? "연결된 코인 거래소가 없습니다. API 키는 읽기 전용 계좌 조회로 먼저 검증합니다."
                : "검증 완료: \(verified.joined(separator: ", "))"
        } catch {
            cryptoExchangeMessage = "코인 거래소 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func cryptoCredentialFromKeychain(exchange: String) throws -> BrokerCredential? {
        try keychain.readInteractively(broker: exchange)
    }

    func registerCryptoCredential(exchange: String, accessKey: String, secretKey: String) async -> Bool {
        do {
            let response = try await client.registerCryptoCredential(
                exchange: exchange,
                accessKey: accessKey,
                secretKey: secretKey
            )
            try keychain.save(BrokerCredential(broker: exchange, clientId: accessKey, clientSecret: secretKey))
            cryptoExchangeMessage = "\(exchange) 검증 완료 · 자산 \(response.accountCount)개 · 주문 제출 없음 · Keychain 저장 완료"
            await refreshCryptoExchanges()
            await refreshCryptoLiveTrading(exchange: exchange)
            return true
        } catch {
            cryptoExchangeMessage = "\(exchange) 등록 실패: \(Self.errorMessage(error))"
            return false
        }
    }

    func deleteCryptoCredential(exchange: String) async {
        do {
            _ = try await client.deleteCryptoCredential(exchange: exchange)
            try keychain.delete(broker: exchange)
            cryptoReadiness = nil
            cryptoOrderPrecheck = nil
            cryptoLiveTrading = nil
            cryptoLiveOrderPrecheck = nil
            cryptoLiveOrderSubmission = nil
            cryptoExchangeMessage = "\(exchange) API 키를 sidecar와 Keychain에서 삭제했습니다."
            await refreshCryptoExchanges()
        } catch {
            cryptoExchangeMessage = "\(exchange) 삭제 실패: \(Self.errorMessage(error))"
        }
    }

    func runCryptoReadiness(exchange: String, market: String) async {
        cryptoReadiness = nil
        do {
            let response = try await client.cryptoReadiness(exchange: exchange, market: market)
            cryptoReadiness = response
            cryptoExchangeMessage = "\(exchange) \(market) \(response.ready ? "준비 점검 통과" : "준비 점검 차단") · \(response.message)"
        } catch {
            cryptoReadiness = nil
            cryptoExchangeMessage = "\(exchange) 준비 점검 실패: \(Self.errorMessage(error))"
        }
    }

    func runCryptoOrderPrecheck(exchange: String, market: String, side: String, volume: Double, price: Double) async {
        cryptoOrderPrecheck = nil
        do {
            let response = try await client.cryptoOrderPrecheck(
                exchange: exchange,
                market: market,
                side: side,
                volume: volume,
                price: price
            )
            cryptoOrderPrecheck = response
            let blocker = response.blockers.first.map { " · \($0)" } ?? ""
            cryptoExchangeMessage = "\(exchange) 사전검증 \(response.passed ? "통과" : "차단") · 예상 \(response.estimatedValue) KRW · 주문 제출 없음\(blocker)"
        } catch {
            cryptoOrderPrecheck = nil
            cryptoExchangeMessage = "\(exchange) 주문 사전검증 실패: \(Self.errorMessage(error))"
        }
    }

    func runUpbitOrderTest(market: String, side: String, volume: Double, price: Double) async {
        upbitOrderTest = nil
        do {
            let response = try await client.testUpbitOrder(market: market, side: side, volume: volume, price: price)
            upbitOrderTest = response
            cryptoExchangeMessage = response.message ?? "Upbit 공식 무실주문 테스트를 완료했습니다. 실제 주문은 제출하지 않았습니다."
        } catch {
            cryptoExchangeMessage = "Upbit 주문 테스트 실패: \(Self.errorMessage(error))"
        }
    }

    func refreshCryptoLiveTrading(exchange: String = "upbit") async {
        do {
            let response = try await client.cryptoManualLiveTrading(exchange: exchange)
            cryptoLiveTrading = response.liveTrading
        } catch {
            cryptoExchangeMessage = "\(exchange) 실거래 상태 조회 실패: \(Self.errorMessage(error))"
        }
    }

    func consentCryptoLiveTrading(exchange: String, confirmation: String) async {
        do {
            let response = try await client.consentCryptoLiveTrading(exchange: exchange, confirmation: confirmation)
            cryptoLiveTrading = response.liveTrading
            cryptoExchangeMessage = "\(exchange) 실거래 위험 이용 동의를 기록했습니다. 주문 토글은 아직 OFF입니다."
        } catch {
            cryptoExchangeMessage = "\(exchange) 실거래 이용 동의 실패: \(Self.errorMessage(error))"
        }
    }

    func setCryptoLiveTrading(exchange: String, mode: String = "manual", enabled: Bool, confirmation: String? = nil) async {
        do {
            let response = try await client.updateCryptoLiveTrading(exchange: exchange, mode: mode, enabled: enabled, confirmation: confirmation)
            cryptoLiveTrading = response.liveTrading
            cryptoExchangeMessage = enabled
                ? "\(exchange) \(mode == "automation" ? "지정가 자동매매" : "수동 지정가 주문")를 열었습니다."
                : "\(exchange) \(mode == "automation" ? "자동" : "수동") 실거래를 껐습니다."
        } catch {
            cryptoExchangeMessage = "\(exchange) 실거래 변경 실패: \(Self.errorMessage(error))"
        }
    }

    func runCryptoManualLiveOrderPrecheck(exchange: String, market: String, side: String, volume: Double, price: Double) async {
        cryptoLiveOrderPrecheck = nil
        cryptoLiveOrderSubmission = nil
        do {
            let response = try await client.cryptoManualLiveOrderPrecheck(
                exchange: exchange,
                market: market,
                side: side,
                volume: volume,
                price: price
            )
            cryptoLiveOrderPrecheck = response
            let blocker = response.blockers.first.map { " · \($0)" } ?? ""
            cryptoExchangeMessage = response.submitReady
                ? "\(exchange) 수동 주문 사전검증 통과 · 주문 요약 재입력 후에만 제출 가능"
                : "\(exchange) 수동 주문 사전검증 차단\(blocker)"
        } catch {
            cryptoLiveOrderPrecheck = nil
            cryptoExchangeMessage = "\(exchange) 수동 주문 사전검증 실패: \(Self.errorMessage(error))"
        }
    }

    func submitCryptoManualLiveOrder(exchange: String, previewId: String, confirmation: String) async {
        do {
            let response = try await client.submitCryptoManualLiveOrder(exchange: exchange, previewId: previewId, confirmation: confirmation)
            cryptoLiveOrderSubmission = response
            cryptoExchangeMessage = response.status == "submitted"
                ? "\(exchange) 주문이 제출되었습니다. 주문 ID와 거래소 주문 내역을 대조하세요."
                : response.error ?? "\(exchange) 주문 제출 결과를 확인하세요."
            await refreshCryptoLiveTrading(exchange: exchange)
        } catch {
            cryptoExchangeMessage = "\(exchange) 주문 제출 실패: \(Self.errorMessage(error))"
            await refreshCryptoLiveTrading(exchange: exchange)
        }
    }

    func reconcileCryptoManualLiveOrder(exchange: String) async {
        do {
            let response = try await client.reconcileCryptoManualLiveOrder(exchange: exchange)
            cryptoLiveOrderSubmission = response
            cryptoExchangeMessage = response.status == "reconciled"
                ? "\(exchange) 주문 식별자 기반 재조정을 완료했습니다."
                : response.error ?? "결과 불명 주문이 없습니다."
            await refreshCryptoLiveTrading(exchange: exchange)
        } catch {
            cryptoExchangeMessage = "\(exchange) 주문 재조정 실패: \(Self.errorMessage(error))"
        }
    }

    func cancelAllCryptoOpenOrders(exchange: String, confirmation: String) async {
        do {
            _ = try await client.cancelAllCryptoOpenOrders(exchange: exchange, confirmation: confirmation)
            cryptoExchangeMessage = "\(exchange) 미체결 주문 일괄 취소 요청 결과를 동기화했습니다."
            await refreshCryptoLiveTrading(exchange: exchange)
            await refreshRealPortfolio(forceRefresh: true)
        } catch {
            cryptoExchangeMessage = "\(exchange) 미체결 일괄 취소 실패: \(Self.errorMessage(error))"
        }
    }

    func dailyBriefing(session: String) async -> String {
        do {
            let data = try await client.dailyBriefing(session: session)
            statusLine = "\(session) briefing loaded"
            return Self.dailyBriefingPreview(data)
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "브리핑 실패: \(message)"
        }
    }

    func runPaper(session: String) async -> String {
        guard !executionBlocked else {
            statusLine = "kill switch blocks paper run"
            return "긴급 중지 상태라 모의 주문 실행을 차단했습니다."
        }
        do {
            let data = try await client.runPaperTrading(session: session)
            await refreshPaperTradingState()
            statusLine = "paper \(session) completed"
            return Self.paperRunPreview(data)
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "모의 주문 실패: \(message)"
        }
    }

    func runPaperOrderIntent(_ dashboard: TerminalDashboardSnapshot, session: String) async -> String {
        guard !executionBlocked else {
            statusLine = "kill switch blocks paper order intent"
            return "긴급 중지 상태라 선택 OrderIntent 모의 주문을 차단했습니다."
        }
        do {
            let data = try await client.submitPaperOrderIntent(dashboard.orderIntent, session: session)
            let preview = Self.paperRunPreview(data)
            await refreshPaperTradingState()
            await refreshTerminalDashboard(symbol: dashboard.symbol, session: session)
            statusLine = "\(dashboard.symbol) paper order intent completed"
            return preview
        } catch {
            let message = Self.errorMessage(error)
            statusLine = message
            return "선택 OrderIntent 모의 주문 실패: \(message)"
        }
    }

    func runAutomationCycle() async -> String {
        guard !executionBlocked else {
            statusLine = "kill switch blocks automation"
            return "긴급 중지 상태라 자동화 큐 실행을 차단했습니다."
        }
        guard !workerPausedEffective else {
            statusLine = "worker pause blocks automation"
            return "워커 일시중지 상태라 자동화 큐 실행을 차단했습니다."
        }
        guard await ensureSidecarReadyForRequest() else {
            latestAutomationRun = nil
            statusLine = "sidecar restart required"
            return "자동화 실행 전 엔진 연결을 복구하지 못했습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
        }
        do {
            let data = try await client.runAutomationCycle()
            latestAutomationRun = Self.automationCycleResponse(data)
            await refreshPaperTradingState()
            await refreshStrategyConfigs(replacingMessage: false)
            await refreshAutomationScheduler()
            statusLine = "automation cycle completed"
            return Self.automationCyclePreview(data)
        } catch {
            latestAutomationRun = nil
            let message = Self.errorMessage(error)
            await refreshHealth()
            statusLine = message
            if health == nil {
                return "자동화 실행 실패: 엔진 연결이 끊겼습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
            }
            return "자동화 실행 실패: \(message)"
        }
    }

    func runAutomationDryRun() async -> String {
        guard await ensureSidecarReadyForRequest() else {
            latestAutomationRun = nil
            statusLine = "sidecar restart required"
            return "자동화 점검 전 엔진 연결을 복구하지 못했습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
        }
        do {
            let data = try await client.runAutomationDryRun()
            latestAutomationRun = Self.automationCycleResponse(data)
            statusLine = "automation dry-run completed"
            return Self.automationCyclePreview(data)
        } catch {
            latestAutomationRun = nil
            let message = Self.errorMessage(error)
            await refreshHealth()
            statusLine = message
            if health == nil {
                return "자동화 점검 실패: 엔진 연결이 끊겼습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
            }
            return "자동화 점검 실패: \(message)"
        }
    }

    func syncAutomationOrders(startupReconciliation: Bool = false) async -> String {
        guard await ensureSidecarReadyForRequest() else {
            statusLine = "sidecar restart required"
            return "체결 동기화 전 엔진 연결을 복구하지 못했습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
        }
        do {
            let data = try await client.syncAutomationOrders(startupReconciliation: startupReconciliation)
            statusLine = "order sync completed"
            return Self.orderSyncPreview(data)
        } catch {
            let message = Self.errorMessage(error)
            await refreshHealth()
            statusLine = message
            if health == nil {
                return "체결 동기화 실패: 엔진 연결이 끊겼습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
            }
            return "체결 동기화 실패: \(message)"
        }
    }

    func refreshBrokerHolding(symbol: String) async -> String {
        guard await ensureSidecarReadyForRequest() else {
            latestHolding = nil
            statusLine = "sidecar restart required"
            return "보유 조회 전 엔진 연결을 복구하지 못했습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
        }
        do {
            let response = try await client.localHolding(symbol: symbol, accountSeq: brokerAccountPreference?.accountSeq)
            latestHolding = response
            statusLine = "\(symbol.uppercased()) holdings checked"
            return Self.holdingPreview(response)
        } catch {
            latestHolding = nil
            let message = Self.errorMessage(error)
            statusLine = message
            return "보유 조회 실패: \(message)"
        }
    }

    func runOrderPrecheck(_ dashboard: TerminalDashboardSnapshot) async -> String {
        guard await ensureSidecarReadyForRequest() else {
            latestOrderPrecheck = nil
            statusLine = "sidecar restart required"
            return "주문 전 사전검증 전 엔진 연결을 복구하지 못했습니다. 엔진 시작 또는 상태 갱신 후 다시 실행하세요."
        }
        guard let limitPrice = dashboard.orderIntent.limitPrice, limitPrice > 0 else {
            latestOrderPrecheck = nil
            return "주문 전 사전검증 실패: 지정가 OrderIntent만 사전검증할 수 있습니다."
        }
        do {
            let response = try await client.localOrderPrecheck(
                symbol: dashboard.orderIntent.symbol,
                side: dashboard.orderIntent.side,
                quantity: Double(dashboard.orderIntent.quantity),
                price: limitPrice,
                currency: dashboard.orderIntent.currency,
                accountSeq: brokerAccountPreference?.accountSeq
            )
            latestOrderPrecheck = response
            statusLine = "\(dashboard.orderIntent.symbol) order precheck completed"
            return Self.orderPrecheckPreview(response)
        } catch {
            latestOrderPrecheck = nil
            let message = Self.errorMessage(error)
            statusLine = message
            return "주문 전 사전검증 실패: \(message)"
        }
    }

    func submitLocalLiveOrder(_ precheck: LocalOrderPrecheckResponse, confirmation: String) async -> String {
        guard await ensureSidecarReadyForRequest() else {
            return "실주문 제출 실패: 엔진 연결을 복구한 뒤 다시 확인하세요."
        }
        do {
            let response = try await client.submitLocalLiveOrder(
                previewId: precheck.preview.id,
                confirmation: confirmation
            )
            latestLiveOrderSubmission = response
            await refreshLocalLiveTrading()
            await refreshBrokerDiagnostics()
            switch response.status {
            case "submitted":
                return "Toss 지정가 주문을 제출했습니다. 주문 상태 재조정으로 broker order ID와 체결 상태를 확인하세요."
            case "unknown":
                return "주문 결과가 불명확해 실거래를 잠갔습니다. 자동 재시도하지 말고 Toss 주문 이력과 clientOrderId를 대조하세요."
            default:
                return response.error ?? "실주문이 거부되었습니다."
            }
        } catch {
            let message = Self.errorMessage(error)
            await refreshLocalLiveTrading()
            return "실주문 제출 실패: \(message)"
        }
    }

    func toggleAlerts() {
        settings.alertsEnabled.toggle()
        try? store.saveSettings(settings)
    }

    private static func prettyPreview(_ data: Data) -> String {
        let object = try? JSONSerialization.jsonObject(with: data)
        let pretty = object.flatMap {
            try? JSONSerialization.data(withJSONObject: $0, options: [.prettyPrinted, .sortedKeys])
        }
        let text = String(data: pretty ?? data, encoding: .utf8) ?? "\(data.count) bytes"
        if text.count > 14_000 {
            return String(text.prefix(14_000)) + "\n... truncated ..."
        }
        return text
    }

    private static func automationCycleResponse(_ data: Data) -> AutomationCycleResponseView? {
        try? JSONDecoder().decode(AutomationCycleResponseView.self, from: data)
    }

    private static func paperRunPreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        var lines = ["모의 주문 실행 요약"]
        let run = json["run"] as? [String: Any]
        let orders = json["orders"] as? [[String: Any]] ?? []
        let executions = json["executions"] as? [[String: Any]] ?? []
        let logs = json["logs"] as? [[String: Any]] ?? []

        if let run {
            appendLine(&lines, title: "상태", value: paperRunStatusLabel(string(run["status"])))
            appendLine(&lines, title: "요약", value: string(run["summary"]))
            let candidateCount = wholeNumberText(run["candidateCount"]) ?? "0"
            let tradableCount = wholeNumberText(run["tradableCount"]) ?? "0"
            let probeCount = wholeNumberText(run["probeCount"]) ?? "0"
            lines.append("후보 \(candidateCount)개 · 거래 가능 \(tradableCount)개 · 관찰 \(probeCount)개")
            lines.append("주문 \(orders.count)건 · 체결 \(executions.count)건")
        }

        if let account = json["nextAccount"] as? [String: Any] {
            let currency = string(account["currency"]) ?? "USD"
            if let cash = number(account["cash"]) {
                lines.append("남은 현금 \(price(cash, currency: currency))")
            }
            if let realizedPnl = number(account["realizedPnl"]) {
                lines.append("실현 손익 \(money(realizedPnl, currency: currency))")
            }
        }

        if !orders.isEmpty {
            lines.append("생성 주문")
            for order in orders.prefix(5) {
                let side = string(order["side"]) == "sell" ? "매도" : "매수"
                let symbol = string(order["symbol"]) ?? "-"
                let quantity = wholeNumberText(order["quantity"]) ?? "0"
                let currency = string(order["currency"]) ?? "USD"
                let orderPrice = number(order["price"]).map { price($0, currency: currency) } ?? "-"
                let reason = string(order["reason"]) ?? ""
                lines.append("- \(side) \(symbol) \(quantity)주 @ \(orderPrice)\(reason.isEmpty ? "" : " · \(reason)")")
            }
        }

        let warnings = logs.filter { log in
            let level = string(log["level"]) ?? "info"
            return level == "warning" || level == "error"
        }
        if !warnings.isEmpty {
            lines.append("주의 로그")
            for log in warnings.prefix(4) {
                let level = string(log["level"]) == "error" ? "오류" : "주의"
                lines.append("- \(level): \(string(log["message"]) ?? "-")")
            }
        }

        appendLine(&lines, title: "스냅샷", value: string(json["snapshotPath"]))
        return lines.joined(separator: "\n")
    }

    private static func holdingPreview(_ holding: LocalHoldingResponse) -> String {
        var lines = ["실계좌 보유 조회 요약"]
        let symbol = holding.symbol ?? "-"
        if !holding.linked {
            lines.append("상태: Toss credential 미연동")
            lines.append("종목: \(symbol)")
            lines.append("확인: 주문 제출 없음")
            if let message = holding.message {
                lines.append("다음 행동: \(message)")
            }
            return lines.joined(separator: "\n")
        }
        lines.append("계좌: \(holding.accountSeq.map { "#\($0)" } ?? "-")")
        lines.append("종목: \(symbol)\(holding.name.map { " · \($0)" } ?? "")")
        guard holding.held else {
            lines.append("보유: 없음")
            lines.append("확인: 주문 제출 없음")
            if let message = holding.message {
                lines.append(message)
            }
            return lines.joined(separator: "\n")
        }
        let currency = holding.currency ?? "USD"
        lines.append("보유 수량: \(quantityLabel(holding.quantity))주")
        if let averagePurchasePrice = holding.averagePurchasePrice {
            lines.append("평단: \(price(averagePurchasePrice, currency: currency))")
        }
        if let lastPrice = holding.lastPrice {
            lines.append("현재가: \(price(lastPrice, currency: currency))")
        }
        if let marketValue = holding.marketValue {
            lines.append("평가금액: \(price(marketValue, currency: currency))")
        }
        if let profitLoss = holding.profitLoss {
            lines.append("손익: \(money(profitLoss, currency: currency))")
        }
        lines.append("확인: 조회 전용이며 주문 제출 없음")
        return lines.joined(separator: "\n")
    }

    private static func orderPrecheckPreview(_ precheck: LocalOrderPrecheckResponse) -> String {
        var lines = ["주문 전 사전검증 요약"]
        let side = precheck.side == "sell" ? "매도" : "매수"
        lines.append("\(side) \(precheck.symbol) \(quantityLabel(precheck.quantity))주 @ \(price(precheck.price, currency: precheck.currency))")
        lines.append("계좌: #\(precheck.accountSeq)")
        lines.append("잔고/수량 검증: \(precheck.ok ? "통과" : "차단")")
        lines.append("RiskCheck: \(precheck.riskCheck.passed ? "통과" : "차단")")
        lines.append("실거래 게이트: \(precheck.liveTradingGate.effective ? "통과" : "차단")")
        lines.append("최종 제출 준비: \(precheck.submitReady ? "가능" : "차단")")
        if let available = precheck.available {
            let label = precheck.side == "sell" ? "\(quantityLabel(available))주" : price(available, currency: precheck.currency)
            lines.append("검증 한도: \(label)")
        }
        if !precheck.blockers.isEmpty {
            lines.append("차단 사유")
            for blocker in precheck.blockers.prefix(4) {
                lines.append("- \(blocker)")
            }
        }
        if !precheck.warnings.isEmpty {
            lines.append("주의")
            for warning in precheck.warnings.prefix(3) {
                lines.append("- \(warning)")
            }
        }
        lines.append("미리보기 ID: \(precheck.preview.id)")
        lines.append("확인: 이 버튼은 주문 제출을 수행하지 않습니다.")
        return lines.joined(separator: "\n")
    }

    private static func automationCyclePreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        let isDryRun = bool(json["dryRun"]) == true
        var lines = [isDryRun ? "자동화 점검 요약" : "자동화 1회 실행 요약"]
        if isDryRun {
            lines.append("모드: 주문 제출 없음")
        }
        appendLine(&lines, title: "생성 시각", value: string(json["generatedAt"]))

        guard let result = json["result"] as? [String: Any] else {
            return lines.joined(separator: "\n")
        }

        let status = string(result["status"]) ?? "unknown"
        let reasonText = string(result["reason"])
        lines.append("상태: \(automationStatusLabel(status))")
        appendLine(&lines, title: "사용자", value: string(result["userId"]))
        if let reason = reasonText {
            lines.append("이유: \(automationReasonLabel(reason))")
        }
        if let liveTradingEnabled = bool(result["liveTradingEnabled"]) {
            lines.append("실거래 게이트: \(liveTradingEnabled ? "열림" : "차단")")
        }
        if let accountSeq = wholeNumberText(result["accountSeq"]) {
            lines.append("계좌 시퀀스: #\(accountSeq)")
        }

        let strategies = wholeNumberText(result["strategies"]) ?? "0"
        let triggers = wholeNumberText(result["triggers"]) ?? "0"
        let orderCandidates = wholeNumberText(result["orders"]) ?? "0"
        let submitted = wholeNumberText(result["submitted"]) ?? "0"
        let rejected = wholeNumberText(result["rejected"]) ?? "0"
        let blocked = wholeNumberText(result["blocked"]) ?? "0"
        let errors = wholeNumberText(result["errors"]) ?? "0"
        let syncedOrders = wholeNumberText(result["syncedOrders"]) ?? "0"
        let newFills = wholeNumberText(result["newFills"]) ?? "0"
        lines.append("전략 \(strategies)개 · 발동 \(triggers)개 · 주문 후보 \(orderCandidates)건")
        lines.append("제출 \(submitted)건 · 차단 \(blocked)건 · 거절 \(rejected)건 · 오류 \(errors)건")
        lines.append("추적 주문 동기화 \(syncedOrders)건 · 신규 체결 \(newFills)건")
        if isDryRun {
            lines.append("확인: dry-run은 Toss broker 제출을 수행하지 않습니다.")
        }
        if let evaluations = result["evaluations"] as? [[String: Any]], !evaluations.isEmpty {
            lines.append("전략별 리허설")
            for evaluation in evaluations.prefix(4) {
                let symbol = string(evaluation["symbol"]) ?? "-"
                let name = string(evaluation["name"]) ?? "전략"
                let evaluationTriggers = wholeNumberText(evaluation["triggers"]) ?? "0"
                let evaluationOrders = (evaluation["orders"] as? [[String: Any]])?.count ?? 0
                let headline = (evaluation["summary"] as? [String: Any]).flatMap { string($0["headline"]) } ?? "-"
                lines.append("- \(symbol) \(name): 발동 \(evaluationTriggers)개 · 주문 \(evaluationOrders)건 · \(headline)")
            }
        }
        if reasonText == "paper-preview-no-credentials" && strategies != "0" {
            lines.append("확인: Toss credential이 없어도 활성 전략 \(strategies)개를 broker 제출 없이 리허설했습니다.")
        }
        if status == "skipped" {
            lines.append("다음 행동: \(automationNextAction(string(result["reason"])))")
        } else if status == "error" {
            lines.append("다음 행동: Toss 진단과 sidecar 로그를 확인한 뒤 다시 실행하세요.")
        } else if submitted == "0" && blocked == "0" && rejected == "0" && orderCandidates == "0" {
            lines.append("다음 행동: 활성 전략의 기준가와 현재가 조건이 맞는지 전략 시뮬레이션을 먼저 확인하세요.")
        }

        return lines.joined(separator: "\n")
    }

    private static func orderSyncPreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        var lines = ["체결 동기화 요약"]
        appendLine(&lines, title: "생성 시각", value: string(json["generatedAt"]))
        let status = string(json["status"]) ?? "snapshot"
        lines.append("상태: \(automationStatusLabel(status))")
        if let reason = string(json["reason"]) {
            lines.append("이유: \(automationReasonLabel(reason))")
        }
        if let accountSeq = wholeNumberText(json["accountSeq"]) {
            lines.append("계좌 시퀀스: #\(accountSeq)")
        }
        let synced = wholeNumberText(json["synced"]) ?? "0"
        let updates = wholeNumberText(json["updates"]) ?? "0"
        let newFills = wholeNumberText(json["newFills"]) ?? "0"
        lines.append("조회 대상 \(synced)건 · 상태 갱신 \(updates)건 · 신규 체결 \(newFills)건")
        if let summary = json["summary"] as? [String: Any] {
            let orders = wholeNumberText(summary["orders"]) ?? "0"
            let openOrders = wholeNumberText(summary["openOrders"]) ?? "0"
            let fills = wholeNumberText(summary["fills"]) ?? "0"
            lines.append("로컬 원장: 추적 주문 \(orders)건 · 미종결 \(openOrders)건 · 체결 \(fills)건")
        }
        let logs = json["logs"] as? [[String: Any]] ?? []
        if !logs.isEmpty {
            lines.append("동기화 로그")
            for log in logs.prefix(6) {
                let level = string(log["level"]) ?? "info"
                let orderId = string(log["brokerOrderId"]) ?? "-"
                let message = string(log["message"]) ?? "-"
                lines.append("- \(strategyLogLevelText(level)) \(orderId): \(message)")
            }
        }
        if status == "skipped" {
            lines.append("다음 행동: \(automationNextAction(string(json["reason"])))")
        } else if status == "ran" && synced == "0" {
            lines.append("확인: 추적 중인 미종결 Toss 주문이 없습니다. 자동화가 실제 제출한 주문만 동기화 대상입니다.")
        }
        lines.append("확인: 이 동기화는 주문 제출을 수행하지 않습니다.")
        return lines.joined(separator: "\n")
    }

    private static func strategyTickPreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        var lines = ["전략 tick 점검 요약"]
        lines.append("모드: 주문 제출 없음")
        appendLine(&lines, title: "생성 시각", value: string(json["generatedAt"]))
        let scenario = string(json["scenario"]) ?? "current"
        let config = json["config"] as? [String: Any]
        let currency = string(config?["market"]) == "KR" ? "KRW" : "USD"
        lines.append("시나리오: \(strategyTickScenarioLabel(scenario))")
        if let marketPrice = number(json["marketPrice"]) {
            lines.append("점검 가격: \(price(marketPrice, currency: currency))")
        }
        appendLine(&lines, title: "원래 상태", value: string(json["originalStatus"]).map(strategyStatusText))
        if let summary = json["summary"] as? [String: Any] {
            appendLine(&lines, title: "판정", value: string(summary["headline"]))
            appendLine(&lines, title: "전략 모드", value: string(summary["mode"]))
            appendLine(&lines, title: "안전 상태", value: string(summary["safety"]))
            if let nextEntryPrice = number(summary["nextEntryPrice"]) {
                lines.append("다음 매수선: \(price(nextEntryPrice, currency: currency))")
            }
            if let triggerDistancePct = number(summary["triggerDistancePct"]) {
                let label = triggerDistancePct >= 0
                    ? "발동가보다 \(String(format: "%.2f%%", triggerDistancePct)) 위"
                    : "발동가를 \(String(format: "%.2f%%", abs(triggerDistancePct))) 하회"
                lines.append("발동 거리: \(label)")
            }
            if let blockedOrders = wholeNumberText(summary["blockedOrders"]) {
                let rejectedOrders = wholeNumberText(summary["rejectedOrders"]) ?? "0"
                let errorOrders = wholeNumberText(summary["errorOrders"]) ?? "0"
                lines.append("차단/거부/오류: \(blockedOrders) / \(rejectedOrders) / \(errorOrders)")
            }
            appendLine(&lines, title: "다음 행동", value: string(summary["nextAction"]))
            if let blockers = summary["blockers"] as? [String], !blockers.isEmpty {
                lines.append("주요 차단 사유")
                for blocker in blockers.prefix(3) {
                    lines.append("- \(blocker)")
                }
            }
        }

        guard let result = json["result"] as? [String: Any] else {
            return lines.joined(separator: "\n")
        }
        appendLine(&lines, title: "종목", value: string(result["symbol"]))
        if let liveTradingEnabled = bool(result["liveTradingEnabled"]) {
            lines.append("실거래 게이트: \(liveTradingEnabled ? "열림" : "차단")")
        }
        let triggers = wholeNumberText(result["triggers"]) ?? "0"
        let orders = result["orders"] as? [[String: Any]] ?? []
        let logs = result["logs"] as? [[String: Any]] ?? []
        lines.append("발동 \(triggers)개 · 주문 후보 \(orders.count)건")
        if !orders.isEmpty {
            lines.append("주문 후보")
            for order in orders.prefix(5) {
                let side = string(order["side"]) == "sell" ? "매도" : "매수"
                let status = string(order["status"]).map(strategyOrderStatusText) ?? "-"
                let quantity = wholeNumberText(order["quantity"]) ?? "0"
                let priceText = number(order["limitPrice"]).map { price($0, currency: currency) } ?? "시장가"
                let message = string(order["message"]) ?? ""
                lines.append("- \(side) \(quantity)주 @ \(priceText) · \(status)\(message.isEmpty ? "" : " · \(message)")")
            }
        }
        if !logs.isEmpty {
            lines.append("tick 로그")
            for log in logs.prefix(5) {
                let level = string(log["level"]).map(strategyLogLevelText) ?? "정보"
                lines.append("- \(level): \(string(log["message"]) ?? "-")")
            }
        }
        if orders.isEmpty && logs.isEmpty {
            lines.append("현재 조건에서는 발동된 주문이 없습니다. 발동가 테스트로 다음 매수선을 확인하세요.")
        }
        return lines.joined(separator: "\n")
    }

    private static func workspaceAnalysisData(_ data: Data, key: String) -> Data? {
        guard let json = jsonDictionary(data),
              let analyses = json["analyses"] as? [String: Any],
              let analysis = analyses[key] as? [String: Any],
              JSONSerialization.isValidJSONObject(analysis) else {
            return nil
        }
        return try? JSONSerialization.data(withJSONObject: analysis)
    }

    private static func workspaceAnalysisSummary(_ workspace: WorkspaceAnalysis) -> String {
        let source = workspace.dataSource?.rawValue.uppercased() ?? "AUTO"
        let quoteAt = workspace.quoteAt ?? workspace.generatedAt ?? "기준 시각 없음"
        let statuses = workspace.horizonPlans.map { plan in
            let horizon: String
            switch plan.horizon {
            case .day: horizon = "1~3일 단기"
            case .swing: horizon = "스윙"
            case .long: horizon = "장기"
            case let .unknown(value): horizon = value
            }
            let status: String
            switch plan.status {
            case .actionable: status = "계획 계산됨"
            case .wait: status = "조건 대기"
            case .unavailable: status = "계산 불가"
            case let .unknown(value): status = value
            }
            return "\(horizon) \(status)"
        }.joined(separator: " · ")
        let delayed = workspace.stale == true ? " · 데이터 지연 가능" : ""
        let planLine = statuses.isEmpty ? "기간별 계획 데이터 없음" : statuses
        let warningLine = workspace.warnings.first.map { "\n주의: \($0)" } ?? ""
        return "멀티 타임프레임: \(planLine)\n데이터: \(source) · \(workspace.currency ?? "-") · \(quoteAt)\(delayed)\(warningLine)\n확인: 분석 과정에서 주문을 제출하지 않았습니다."
    }

    private static func parseMarketAnalysis(_ data: Data) -> MarketAnalysisSnapshot? {
        guard let json = jsonDictionary(data) else {
            return nil
        }
        let rawCandles = json["candles"] as? [[String: Any]] ?? []
        let candles = rawCandles.enumerated().compactMap { index, item -> AnalysisCandle? in
            guard let open = number(item["open"]),
                  let high = number(item["high"]),
                  let low = number(item["low"]),
                  let close = number(item["close"]) else {
                return nil
            }
            let time = Int(number(item["time"]) ?? Double(index))
            return AnalysisCandle(
                id: time == 0 ? index : time,
                time: time,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: number(item["volume"]) ?? 0
            )
        }
        let tradeSetup = json["tradeSetup"] as? [String: Any]
        let quality = json["chartQuality"] as? [String: Any]
        let reliability = json["signalReliability"] as? [String: Any]
        let breakout = json["breakoutSignal"] as? [String: Any]
        let rawIndicators = json["indicators"] as? [String: Any]
        let rawSma = rawIndicators?["sma"] as? [String: Any]
        func indicatorPoints(_ raw: Any?) -> [AnalysisIndicatorPoint] {
            (raw as? [[String: Any]] ?? []).compactMap { item in
                guard let time = number(item["time"]), let value = number(item["value"]) else {
                    return nil
                }
                return AnalysisIndicatorPoint(time: Int(time), value: value)
            }
        }
        let indicators = AnalysisChartIndicators(
            sma5: indicatorPoints(rawSma?["5"]),
            sma20: indicatorPoints(rawSma?["20"]),
            sma60: indicatorPoints(rawSma?["60"]),
            rsi: indicatorPoints(rawIndicators?["rsi"])
        )
        let rawSignals = json["signals"] as? [[String: Any]] ?? []
        let recentSignals = rawSignals.suffix(80).enumerated().map { index, signal in
            let label = string(signal["label"]) ?? string(signal["type"]) ?? "signal"
            let time = Int(number(signal["time"]) ?? Double(index))
            return AnalysisSignal(
                id: "\(time)-\(label)-\(index)",
                time: time,
                type: string(signal["type"]) ?? "signal",
                label: label,
                reason: string(signal["reason"]) ?? "-",
                price: number(signal["price"])
            )
        }
        let signalEvents: [AnalysisTradeSignalEvent] = {
            guard let raw = json["signalEvents"],
                  JSONSerialization.isValidJSONObject(raw),
                  let data = try? JSONSerialization.data(withJSONObject: raw) else {
                return []
            }
            return (try? JSONDecoder().decode([AnalysisTradeSignalEvent].self, from: data)) ?? []
        }()

        return MarketAnalysisSnapshot(
            symbol: string(json["symbol"]) ?? "UNKNOWN",
            latestClose: candles.last?.close,
            previousClose: candles.dropLast().last?.close,
            market: string(json["market"]),
            currency: string(json["currency"]) ?? "USD",
            dataSource: string(json["dataSource"]),
            timeframe: string(json["timeframe"]),
            quoteAt: string(json["quoteAt"]),
            stale: bool(json["stale"]) ?? false,
            candles: Array(candles.suffix(Self.marketAnalysisCandleRetentionLimit)),
            tradeLabel: tradeSetup.flatMap { string($0["label"]) },
            entryPlan: tradeSetup.flatMap { string($0["entryPlan"]) },
            validIf: tradeSetup.flatMap { string($0["validIf"]) },
            invalidIf: tradeSetup.flatMap { string($0["invalidIf"]) },
            chartQualityScore: quality.flatMap { number($0["score"]) },
            chartQualityGrade: quality.flatMap { string($0["grade"]) },
            reliabilityGrade: reliability.flatMap { string($0["grade"]) },
            reliabilityScore: reliability.flatMap { number($0["score"]) },
            reliabilityRiskReward: reliability.flatMap { number($0["riskReward"]) },
            breakoutStatus: breakout.flatMap { string($0["status"]) },
            breakoutPattern: breakout.flatMap { string($0["pattern"]) },
            indicators: indicators,
            breakoutTime: breakout.flatMap { number($0["time"]) }.map(Int.init),
            breakoutPrice: breakout.flatMap { number($0["price"]) },
            recentSignals: Array(recentSignals),
            signalEvents: signalEvents,
            isBrokerStopEligible: bool(json["isBrokerStopEligible"]) ?? false,
            orderSubmissionAttempted: bool(json["orderSubmissionAttempted"]) ?? false
        )
    }

    private static func marketAnalysisPreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        let symbol = string(json["symbol"]) ?? "UNKNOWN"
        let currency = string(json["currency"]) ?? "USD"
        var lines = ["\(symbol) 분석 요약"]
        if let candles = json["candles"] as? [[String: Any]],
           let latest = candles.last,
           let close = number(latest["close"]) {
            let previousClose = candles.dropLast().last.flatMap { number($0["close"]) }
            let change = previousClose.flatMap { $0 == 0 ? nil : (close / $0) - 1 }
            lines.append("현재가 \(price(close, currency: currency))\(change.map { " · 직전 봉 대비 \(percent($0))" } ?? "")")
        }
        if let tradeSetup = json["tradeSetup"] as? [String: Any] {
            appendLine(&lines, title: "판단", value: string(tradeSetup["label"]))
            appendLine(&lines, title: "진입 계획", value: string(tradeSetup["entryPlan"]))
            appendLine(&lines, title: "유효 조건", value: string(tradeSetup["validIf"]))
            appendLine(&lines, title: "무효 조건", value: string(tradeSetup["invalidIf"]))
        }
        if let breakout = json["breakoutSignal"] as? [String: Any] {
            let status = string(breakout["status"]) ?? "unknown"
            let pattern = string(breakout["pattern"]) ?? "-"
            let level = number(breakout["breakoutLevel"]).map { price($0, currency: currency) } ?? "-"
            lines.append("돌파 신호 \(status) · \(pattern) · 기준 \(level)")
            appendLine(&lines, title: "돌파 계획", value: string(breakout["entryPlan"]))
            appendLine(&lines, title: "돌파 무효화", value: string(breakout["invalidation"]))
        }
        if let quality = json["chartQuality"] as? [String: Any] {
            let score = number(quality["score"]).map { String(format: "%.0f", $0) } ?? "-"
            let grade = string(quality["grade"]) ?? "-"
            lines.append("차트 품질 \(score)/100 · \(grade)")
            appendReasons(&lines, title: "품질 근거", values: quality["reasons"], limit: 3)
        }
        if let reliability = json["signalReliability"] as? [String: Any] {
            let grade = string(reliability["grade"]) ?? "-"
            let sampleSize = number(reliability["sampleSize"]).map { String(format: "%.0f", $0) } ?? "0"
            let riskReward = number(reliability["riskReward"]).map { String(format: "%.2fR", $0) } ?? "-"
            lines.append("신호 신뢰도 \(grade) · 표본 \(sampleSize)개 · 손익비 \(riskReward)")
            appendReasons(&lines, title: "신뢰도 근거", values: reliability["reasons"], limit: 3)
        }
        if let signals = json["signals"] as? [[String: Any]], !signals.isEmpty {
            lines.append("최근 신호")
            for signal in signals.suffix(3) {
                let label = string(signal["label"]) ?? string(signal["type"]) ?? "signal"
                let reason = string(signal["reason"]) ?? "-"
                lines.append("- \(label): \(reason)")
            }
        }
        return lines.joined(separator: "\n")
    }

    private static func dailyBriefingPreview(_ data: Data) -> String {
        guard let json = jsonDictionary(data) else {
            return prettyPreview(data)
        }
        var lines = ["시장 브리핑 요약"]
        appendLine(&lines, title: "세션", value: string(json["sessionLabel"]))
        appendLine(&lines, title: "기준일", value: string(json["tradingDate"]))
        appendLine(&lines, title: "스캔 상태", value: string(json["scanStatus"]))
        guard let report = (json["reports"] as? [[String: Any]])?.first else {
            return lines.joined(separator: "\n")
        }
        appendLine(&lines, title: "시장 판단", value: string(report["headline"]))
        if let health = report["marketHealth"] as? [String: Any] {
            let breadth = number(health["breadth"]).map { percent($0) } ?? "-"
            let loaded = number(health["loadedSymbols"]).map { String(format: "%.0f", $0) } ?? "-"
            let total = number(health["totalSymbols"]).map { String(format: "%.0f", $0) } ?? "-"
            let pass = bool(health["pass"]) == true ? "통과" : "주의"
            lines.append("시장폭 \(breadth) · \(pass) · 분석 \(loaded)/\(total)")
        }
        appendThemeSummary(&lines, report: report)
        appendCandidateSummary(&lines, title: "진입 후보", key: "entryCandidates", report: report)
        appendCandidateSummary(&lines, title: "돌파 후보", key: "breakoutCandidates", report: report)
        appendCandidateSummary(&lines, title: "주의 후보", key: "cautionCandidates", report: report)
        appendReasons(&lines, title: "요약", values: report["summary"], limit: 4)
        return lines.joined(separator: "\n")
    }

    private static func newsPreview(_ response: NewsPollResponse) -> String {
        var lines = ["뉴스/RSS 갱신 요약"]
        lines.append("전체 이벤트 \(response.events.count)개 · 신규 \(response.newEvents.count)개 · 알림 후보 \(response.alertCandidates.count)개")
        if !response.errors.isEmpty {
            lines.append("소스 오류 \(response.errors.count)개")
            for error in response.errors.prefix(3) {
                lines.append("- \(error.sourceId): \(error.message)")
            }
        }

        let primaryEvents = response.newEvents.isEmpty ? response.events : response.newEvents
        if !primaryEvents.isEmpty {
            lines.append(response.newEvents.isEmpty ? "최근 이벤트" : "신규 이벤트")
            for event in primaryEvents.prefix(5) {
                let tickers = event.tickers.isEmpty ? "" : " · \(event.tickers.prefix(4).joined(separator: ", "))"
                lines.append("- [\(newsImportanceLabel(event.importance))] \(event.title)\(tickers)")
            }
        } else {
            lines.append("표시할 뉴스 이벤트가 없습니다. RSS 소스나 네트워크 상태를 확인하세요.")
        }

        if !response.alertCandidates.isEmpty {
            lines.append("알림 후보")
            for event in response.alertCandidates.prefix(3) {
                lines.append("- \(event.sourceName): \(event.title)")
            }
        }
        return lines.joined(separator: "\n")
    }

    private static func jsonDictionary(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String, !value.isEmpty {
            return value
        }
        return nil
    }

    private static func stringArray(_ value: Any?) -> [String]? {
        if let value = value as? [String], !value.isEmpty {
            return value
        }
        return nil
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? Double {
            return value
        }
        if let value = value as? Int {
            return Double(value)
        }
        if let value = value as? NSNumber {
            return value.doubleValue
        }
        return nil
    }

    private static func currencyNumber(_ value: String) -> Double? {
        let cleaned = value
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: "₩", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Double(cleaned)
    }

    private static func bool(_ value: Any?) -> Bool? {
        if let value = value as? Bool {
            return value
        }
        if let value = value as? NSNumber {
            return value.boolValue
        }
        return nil
    }

    private static func wholeNumberText(_ value: Any?) -> String? {
        number(value).map { String(format: "%.0f", $0) }
    }

    private static func paperRunStatusLabel(_ status: String?) -> String {
        switch status {
        case "executed": return "실행 완료"
        case "completed": return "완료"
        case "skipped": return "건너뜀"
        case "failed": return "실패"
        case .some(let value): return value
        case .none: return "알 수 없음"
        }
    }

    private static func automationStatusLabel(_ status: String) -> String {
        switch status {
        case "ran": return "실행 완료"
        case "ready": return "실행 준비"
        case "preview": return "리허설 완료"
        case "blocked": return "차단"
        case "skipped": return "건너뜀"
        case "error": return "오류"
        default: return status
        }
    }

    private static func automationReasonLabel(_ reason: String) -> String {
        switch reason {
        case "no-credentials": return "검증된 Toss API 키가 없습니다."
        case "paper-preview-no-credentials": return "Toss API 키 없이 paper 리허설을 실행했습니다."
        case "paper-preview-account-selection-required": return "자동화 계좌 선택 전 상태로 paper 리허설을 실행했습니다."
        case "paper-preview-ready": return "paper dry-run으로 broker 주문 제출 없이 리허설했습니다."
        case "paper-preview-live-gate-closed": return "1.0.0 paper-only 정책에 따라 broker 제출 없이 리허설했습니다."
        case "paper-automation-no-credentials": return "Toss API 키 없이 로컬 모의 계좌에 자동화 결과를 기록했습니다."
        case "paper-automation-account-selection-required": return "자동화 계좌 선택 전 상태로 로컬 모의 계좌에 결과를 기록했습니다."
        case "paper-automation-live-gate-closed": return "1.0.0 paper-only 정책에 따라 로컬 모의 계좌에 자동화 결과를 기록했습니다."
        case "no-enabled-strategies": return "활성화된 자동매매 전략이 없습니다."
        case "no-account": return "Toss 계좌를 찾지 못했습니다."
        case "account-selection-required": return "자동거래 계좌 선택이 필요합니다."
        case "preferred-account-unavailable": return "선택한 자동거래 계좌를 현재 Toss 계좌 목록에서 찾지 못했습니다."
        case "kill-switch": return "긴급 중지가 켜져 자동화 큐를 차단했습니다."
        case "worker-paused": return "워커 일시중지 상태라 자동화 큐를 차단했습니다."
        default: return reason
        }
    }

    private static func automationNextAction(_ reason: String?) -> String {
        switch reason {
        case "no-credentials": return "상단 Toss 화면에서 credential을 검증 후 저장하세요."
        case "no-enabled-strategies": return "상단 전략 화면에서 초안을 저장하고 시뮬레이션 통과 후 활성화하세요."
        case "no-account": return "Toss credential 검증과 계좌 조회 결과를 확인하세요."
        case "account-selection-required": return "Toss 화면에서 계좌 새로고침 후 자동거래에 사용할 계좌를 선택하세요."
        case "preferred-account-unavailable": return "Toss 화면에서 계좌 목록을 새로고침하고 사용할 계좌를 다시 선택하세요."
        case "paper-automation-no-credentials", "paper-automation-account-selection-required", "paper-automation-live-gate-closed":
            return "모의 계좌 결과를 확인한 뒤 Toss 조회 상태와 RiskCheck를 점검하세요. 1.0.0은 실제 주문을 제출하지 않습니다."
        default: return "Toss 진단, 전략 활성 상태, paper 안전 경계를 순서대로 확인하세요."
        }
    }

    private static func strategyTickScenarioLabel(_ scenario: String) -> String {
        switch scenario {
        case "entry-trigger": return "다음 매수선 발동가"
        default: return "현재 기준가"
        }
    }

    private static func strategyStatusText(_ status: String) -> String {
        switch status {
        case "enabled": return "활성"
        case "disabled": return "일시정지"
        case "draft": return "초안"
        default: return status
        }
    }

    private static func strategyOrderStatusText(_ status: String) -> String {
        switch status {
        case "submitted": return "제출"
        case "blocked": return "차단"
        case "rejected": return "거절"
        case "error": return "오류"
        default: return status
        }
    }

    private static func strategyLogLevelText(_ level: String) -> String {
        switch level {
        case "warning": return "주의"
        case "error": return "오류"
        default: return "정보"
        }
    }

    private static func newsImportanceLabel(_ importance: String) -> String {
        switch importance {
        case "high": return "중요"
        case "medium": return "관찰"
        case "low": return "낮음"
        default: return importance
        }
    }

    private static func percent(_ value: Double) -> String {
        let sign = value >= 0 ? "+" : "-"
        return "\(sign)\(String(format: "%.2f", abs(value) * 100))%"
    }

    private static func appendLine(_ lines: inout [String], title: String, value: String?) {
        guard let value, !value.isEmpty else {
            return
        }
        lines.append("\(title): \(value)")
    }

    private static func appendReasons(_ lines: inout [String], title: String, values: Any?, limit: Int) {
        guard let reasons = values as? [String], !reasons.isEmpty else {
            return
        }
        lines.append(title)
        for reason in reasons.prefix(limit) {
            lines.append("- \(reason)")
        }
    }

    private static func appendThemeSummary(_ lines: inout [String], report: [String: Any]) {
        guard let themes = report["leadingThemes"] as? [[String: Any]], !themes.isEmpty else {
            return
        }
        lines.append("상위 테마")
        for theme in themes.prefix(3) {
            let name = string(theme["theme"]) ?? string(theme["sector"]) ?? "-"
            let return5 = number(theme["averageReturn5"]).map { percent($0) } ?? "-"
            let return50 = number(theme["averageReturn50"]).map { percent($0) } ?? "-"
            let read = string(theme["read"]) ?? ""
            lines.append("- \(name): 5일 \(return5), 50일 \(return50)\(read.isEmpty ? "" : " · \(read)")")
        }
    }

    private static func appendCandidateSummary(_ lines: inout [String], title: String, key: String, report: [String: Any]) {
        guard let candidates = report[key] as? [[String: Any]], !candidates.isEmpty else {
            return
        }
        lines.append(title)
        for candidate in candidates.prefix(3) {
            let symbol = string(candidate["symbol"]) ?? "-"
            let name = string(candidate["name"]) ?? ""
            let decision = string(candidate["decision"]) ?? string(candidate["automationStatus"]) ?? "-"
            let priceText = number(candidate["price"]).map { price($0, currency: "USD") } ?? "-"
            let reason = string(candidate["reason"]) ?? string(candidate["entryRange"]) ?? ""
            lines.append("- \(symbol)\(name.isEmpty ? "" : " \(name)"): \(priceText) · \(decision)\(reason.isEmpty ? "" : " · \(reason)")")
        }
    }

    nonisolated private static func resolveLocalBrokerEncryptionKey(
        store: AppSupportStore
    ) -> String {
        if let legacy = try? String(contentsOf: store.brokerEncryptionKeyURL, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !legacy.isEmpty {
            return legacy
        }

        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            bytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
        }
        let value = "local-macos:\(Data(bytes).base64EncodedString())"
        if let data = "\(value)\n".data(using: .utf8) {
            try? data.write(to: store.brokerEncryptionKeyURL, options: [.atomic])
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: store.brokerEncryptionKeyURL.path(percentEncoded: false)
            )
        }
        return value
    }

    nonisolated private static func isDeveloperIDApplicationSigned() -> Bool {
        var staticCode: SecStaticCode?
        guard Bundle.main.bundleURL.path(percentEncoded: false).hasPrefix("/Applications/"),
              SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, [], &staticCode) == errSecSuccess,
              let staticCode,
              SecStaticCodeCheckValidity(staticCode, [], nil) == errSecSuccess else {
            return false
        }
        var signingInfo: CFDictionary?
        guard
              SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &signingInfo) == errSecSuccess,
              let info = signingInfo as? [String: Any],
              let certificates = info[kSecCodeInfoCertificates as String] as? [SecCertificate],
              let leaf = certificates.first,
              let subject = SecCertificateCopySubjectSummary(leaf) as String? else {
            return false
        }
        return subject.hasPrefix("Developer ID Application:")
    }

    private func credentialStatusLabel(_ status: String) -> String {
        switch status {
        case "verified": return "검증 완료"
        case "pending": return "검증 대기"
        case "failed": return "검증 실패"
        default: return status
        }
    }

    private func applyBrokerCredentialResponse(_ response: BrokerCredentialResponse) {
        brokerCredential = response.credential
        brokerAccounts = response.accounts ?? []
        brokerAccountPreference = response.accountPreference
        brokerCredentialMessage = response.credential == nil
            ? "등록된 Toss API 키가 없습니다."
            : "Toss API 키 상태: \(credentialStatusLabel(response.credential?.status ?? "-"))"
    }

    private func applyKillSwitch(_ state: LocalKillSwitchState) {
        killSwitchState = state
        killSwitchEngaged = state.engaged
    }

    private func applyWorkerControl(_ state: LocalWorkerControlState) {
        workerControlState = state
        settings.workerPaused = state.paused
        try? store.saveSettings(settings)
    }

    private func liveTradingMessage(_ state: LocalLiveTradingState) -> String {
        state.reason ?? (state.effective
            ? "수동 Toss 지정가 실거래가 이 Mac과 선택 계좌에서만 열려 있습니다."
            : "Toss 실거래는 기본 OFF입니다. readiness·이용 동의·계좌 바인딩·수동 토글을 확인하세요.")
    }

    private static func errorMessage(_ error: Error) -> String {
        if case let EngineClientError.http(statusCode, message) = error {
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if let data = trimmed.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let errorText = json["error"] as? String, !errorText.isEmpty {
                    return errorText
                }
                if let messageText = json["message"] as? String, !messageText.isEmpty {
                    return messageText
                }
            }
            return trimmed.isEmpty ? "HTTP \(statusCode)" : trimmed
        }
        return error.localizedDescription
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }
        return false
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "개발 빌드"
    }

    private static var hostArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }
}

struct ReleaseStateSnapshot: Sendable {
    let artifacts: [ReleaseArtifactInfo]
    let handoffEntries: [ReleaseHandoffEntryInfo]
    let manifest: ReleaseManifestSummary?
    let releaseCheck: MacReleaseCheckSummary?
    let installVerification: DmgInstallVerificationSummary?
    let message: String
}

private struct ReleaseStateLoader: Sendable {
    let bundleURL: URL
    let releaseStatusURL: URL?
    let repositoryPath: String
    let appVersion: String
    let arch: String

    func load() -> ReleaseStateSnapshot {
        if let releaseStatusURL,
           let data = try? Data(contentsOf: releaseStatusURL),
           let status = try? JSONDecoder().decode(ReleaseStatusResource.self, from: data) {
            let artifacts = status.files.map { file in
                let url = artifactURL(fileName: file.fileName)
                return ReleaseArtifactInfo(
                    title: artifactTitle(kind: file.kind),
                    detail: url.map { $0.path(percentEncoded: false) } ?? "명세에는 있으나 이 Mac에서 파일을 찾지 못했습니다.",
                    exists: url != nil,
                    url: url,
                    fileName: file.fileName
                )
            }
            let handoffEntries = releaseHandoffEntries()
            let manifest = manifestSummary(from: status)
            let releaseCheck = releaseCheckSummary()
            let installVerification = installVerificationSummary()
            return ReleaseStateSnapshot(
                artifacts: artifacts,
                handoffEntries: handoffEntries,
                manifest: manifest,
                releaseCheck: releaseCheck,
                installVerification: installVerification,
                message: summaryMessage(
                    artifacts: artifacts,
                    handoffEntries: handoffEntries,
                    manifest: manifest,
                    releaseCheck: releaseCheck,
                    installVerification: installVerification
                )
            )
        }

        let expected = expectedArtifacts()
        let manifest = packagedManifestSummary() ?? lightweightManifestSummary(artifacts: expected)
        let handoffEntries = releaseHandoffEntries()
        let releaseCheck = releaseCheckSummary()
        let installVerification = installVerificationSummary()
        return ReleaseStateSnapshot(
            artifacts: expected,
            handoffEntries: handoffEntries,
            manifest: manifest,
            releaseCheck: releaseCheck,
            installVerification: installVerification,
            message: summaryMessage(
                artifacts: expected,
                handoffEntries: handoffEntries,
                manifest: manifest,
                releaseCheck: releaseCheck,
                installVerification: installVerification
            )
        )
    }

    private func expectedArtifacts() -> [ReleaseArtifactInfo] {
        [
            expectedArtifact(kind: "dmg", title: "DMG 설치 파일", fileName: "StockAnalysis-\(appVersion)-macos-\(arch).dmg"),
            expectedArtifact(kind: "zip", title: "ZIP 백업 파일", fileName: "StockAnalysis-\(appVersion)-macos-\(arch).zip"),
            expectedArtifact(kind: "manifest", title: "릴리즈 명세", fileName: "StockAnalysis-\(appVersion)-macos-\(arch).manifest.json"),
            expectedArtifact(kind: "install-guide", title: "설치 안내", fileName: "StockAnalysis-\(appVersion)-macos-install.md"),
            expectedArtifact(kind: "release-index", title: "통합 릴리즈 인덱스", fileName: "StockAnalysis-\(appVersion)-macos-release-index.json"),
            expectedArtifact(kind: "release-check", title: "배포 게이트 검증", fileName: "StockAnalysis-\(appVersion)-macos-release-check.json"),
            expectedArtifact(kind: "install-verification", title: "DMG 설치본 검증", fileName: "StockAnalysis-\(appVersion)-macos-install-verification.json"),
        ]
    }

    private func expectedArtifact(kind _: String, title: String, fileName: String) -> ReleaseArtifactInfo {
        let url = artifactURL(fileName: fileName)
        return ReleaseArtifactInfo(
            title: title,
            detail: url.map { $0.path(percentEncoded: false) } ?? "npm run mac:package 후 표시",
            exists: url != nil,
            url: url,
            fileName: fileName
        )
    }

    private func artifactURL(fileName: String) -> URL? {
        releaseDirectoryCandidates()
            .map { $0.appending(path: fileName) }
            .first { FileManager.default.fileExists(atPath: $0.path(percentEncoded: false)) }
    }

    private func releaseDirectoryCandidates() -> [URL] {
        let candidates = [
            bundleURL.deletingLastPathComponent().appending(path: "release", directoryHint: .isDirectory),
            URL(fileURLWithPath: repositoryPath, isDirectory: true).appending(path: "dist/macos/release", directoryHint: .isDirectory),
        ]
        var seen = Set<String>()
        return candidates.filter { url in
            let path = url.standardizedFileURL.path(percentEncoded: false)
            if seen.contains(path) {
                return false
            }
            seen.insert(path)
            return true
        }
    }

    private func packagedManifestSummary() -> ReleaseManifestSummary? {
        let fileName = "StockAnalysis-\(appVersion)-macos-\(arch).manifest.json"
        guard let url = artifactURL(fileName: fileName),
              let data = try? Data(contentsOf: url),
              let status = try? JSONDecoder().decode(ReleaseStatusResource.self, from: data) else {
            return nil
        }
        return manifestSummary(from: status, manifestFileName: url.lastPathComponent)
    }

    private func releaseHandoffEntries() -> [ReleaseHandoffEntryInfo] {
        let fileName = "StockAnalysis-\(appVersion)-macos-release-index.json"
        guard let url = artifactURL(fileName: fileName),
              let data = try? Data(contentsOf: url),
              let index = try? JSONDecoder().decode(ReleaseIndexResource.self, from: data) else {
            return []
        }
        return index.entries.map { entry in
            ReleaseHandoffEntryInfo(
                arch: entry.arch,
                label: entry.label,
                readyForExternalDistribution: entry.readyForExternalDistribution,
                status: entry.status,
                sidecarVerified: entry.sidecarVerified,
                minimumMacOS: entry.minimumMacOS,
                supportedArchitectures: entry.supportedArchitectures,
                files: entry.files.map { file in
                    let url = artifactURL(fileName: file.fileName)
                    return ReleaseHandoffFileInfo(
                        kind: file.kind,
                        fileName: file.fileName,
                        exists: url != nil && file.exists,
                        sha256: file.sha256,
                        checksumMatches: checksumMatches(url: url, expectedSHA256: file.sha256),
                        url: url
                    )
                }
            )
        }
    }

    private func releaseCheckSummary() -> MacReleaseCheckSummary? {
        let fileName = "StockAnalysis-\(appVersion)-macos-release-check.json"
        guard let url = artifactURL(fileName: fileName),
              let data = try? Data(contentsOf: url),
              let resource = try? JSONDecoder().decode(MacReleaseCheckResource.self, from: data) else {
            return nil
        }
        return MacReleaseCheckSummary(
            fileName: url.lastPathComponent,
            status: resource.status ?? "unknown",
            label: resource.label ?? "배포 검증 미확인",
            ok: resource.ok ?? false,
            readyForExternalDistribution: resource.readyForExternalDistribution ?? false,
            gatekeeperRisk: resource.gatekeeperRisk ?? "high",
            developerIdReady: resource.developerIdReady,
            sidecarVerified: resource.sidecarVerified,
            issues: resource.issues ?? [],
            warnings: resource.warnings ?? [],
            nextSteps: resource.nextSteps ?? [],
            files: (resource.files ?? []).map {
                MacReleaseCheckFileInfo(
                    arch: $0.arch ?? "-",
                    label: $0.label ?? $0.arch ?? "-",
                    fileName: $0.fileName ?? URL(fileURLWithPath: $0.path ?? "").lastPathComponent,
                    kind: $0.kind ?? "other",
                    exists: $0.exists ?? false,
                    sha256Matches: $0.sha256Matches,
                    staplerValidated: $0.staplerValidated,
                    gatekeeperAccepted: $0.gatekeeperAccepted,
                    staplerDetail: $0.staplerDetail,
                    gatekeeperDetail: $0.gatekeeperDetail
                )
            }
        )
    }

    private func installVerificationSummary() -> DmgInstallVerificationSummary? {
        let fileName = "StockAnalysis-\(appVersion)-macos-install-verification.json"
        guard let url = artifactURL(fileName: fileName),
              let data = try? Data(contentsOf: url),
              let resource = try? JSONDecoder().decode(DmgInstallVerificationResource.self, from: data) else {
            return nil
        }
        return DmgInstallVerificationSummary(
            fileName: url.lastPathComponent,
            generatedAt: resource.generatedAt ?? "-",
            checked: resource.checked ?? 0,
            ok: resource.ok ?? false,
            results: (resource.results ?? []).map {
                DmgInstallVerificationResultInfo(
                    fileName: $0.fileName ?? "unknown.dmg",
                    sidecarVerified: $0.sidecarVerified ?? false,
                    sidecarEndpointChecks: $0.sidecarEndpointChecks.map {
                        SidecarEndpointCheckInfo(
                            health: $0.health ?? false,
                            tossOpenApiContract: $0.tossOpenApiContract ?? false,
                            brokerCredentials: $0.brokerCredentials ?? false,
                            publicIpCheckSkipped: $0.publicIpCheckSkipped ?? false,
                            automationScheduler: $0.automationScheduler ?? false,
                            symbolSearch: $0.symbolSearch ?? false,
                            cryptoExchangeSafety: $0.cryptoExchangeSafety ?? false,
                            cryptoStrategyLifecycle: $0.cryptoStrategyLifecycle ?? false,
                            strategyConfigs: $0.strategyConfigs ?? false,
                            strategyLifecycle: $0.strategyLifecycle ?? false,
                            strategyBackupImport: $0.strategyBackupImport ?? false,
                            holdingsNoCredential: $0.holdingsNoCredential ?? false,
                            orderSyncNoCredential: $0.orderSyncNoCredential ?? false,
                            orderPrecheckNoCredential: $0.orderPrecheckNoCredential ?? false
                        )
                    },
                    appLaunchVerified: $0.appLaunchVerified ?? false,
                    uiSmokeVerified: $0.uiSmokeVerified ?? false,
                    uiSmokeChecks: $0.uiSmokeChecks.map {
                        UiSmokeCheckInfo(
                            launchedWindow: $0.launchedWindow ?? false,
                            sidecarVisible: $0.sidecarVisible ?? false,
                            menuBarExtra: $0.menuBarExtra ?? false,
                            topCommandButtons: $0.topCommandButtons ?? false,
                            decisionPanelButtons: $0.decisionPanelButtons ?? false,
                            paperResetConfirmation: $0.paperResetConfirmation ?? false,
                            firstRunSetup: $0.firstRunSetup ?? false,
                            firstRunSetupActions: $0.firstRunSetupActions ?? false,
                            workspaceTabs: $0.workspaceTabs ?? false,
                            orderRiskButtons: $0.orderRiskButtons ?? false,
                            orderRiskReportCopy: $0.orderRiskReportCopy ?? false,
                            orderSyncButton: $0.orderSyncButton ?? false,
                            newsReplayPlaybookButtons: $0.newsReplayPlaybookButtons ?? false,
                            tossSheetNoCredentialState: $0.tossSheetNoCredentialState ?? false,
                            publicIpCheckButton: $0.publicIpCheckButton ?? false,
                            publicIpCopyButton: $0.publicIpCopyButton ?? false,
                            tossCredentialControls: $0.tossCredentialControls ?? false,
                            tossReadinessButton: $0.tossReadinessButton ?? false,
                            strategyDraftCreation: $0.strategyDraftCreation ?? false,
                            strategyReportCopy: $0.strategyReportCopy ?? false,
                            strategyBackupImport: $0.strategyBackupImport ?? false,
                            strategyCardActions: $0.strategyCardActions ?? false,
                            automationRunConfirmation: $0.automationRunConfirmation ?? false,
                            continuousAutomationScheduler: $0.continuousAutomationScheduler ?? false,
                            koreanSymbolSearch: $0.koreanSymbolSearch ?? false,
                            cryptoExchangeSheet: $0.cryptoExchangeSheet ?? false,
                            selfTestSheet: $0.selfTestSheet ?? false,
                            selfTestReportCopy: $0.selfTestReportCopy ?? false,
                            distributionInstallReadiness: $0.distributionInstallReadiness ?? false,
                            releaseChecksumCopy: $0.releaseChecksumCopy,
                            sidecarLogSheet: $0.sidecarLogSheet ?? false,
                            killSwitchToggle: $0.killSwitchToggle ?? false,
                            killSwitchButtonGuards: $0.killSwitchButtonGuards ?? false
                        )
                    },
                    nodeVersion: $0.nodeVersion
                )
            },
            issues: resource.issues ?? []
        )
    }

    private func manifestSummary(from status: ReleaseStatusResource, manifestFileName: String? = nil) -> ReleaseManifestSummary {
        let distribution = status.distribution
        return ReleaseManifestSummary(
            fileName: manifestFileName ?? status.files.first { $0.kind == "manifest" }?.fileName ?? "release-status.json",
            builtAt: status.builtAt,
            signingIdentity: status.signingIdentity,
            arch: distribution?.architecture ?? status.arch,
            notarizationRequested: status.notarization.requested,
            notarizationStapled: status.notarization.stapled,
            readinessLabel: distribution?.label,
            readinessStatus: distribution?.status,
            readyForExternalDistribution: distribution?.readyForExternalDistribution,
            gatekeeperRisk: distribution?.gatekeeperRisk,
            minimumMacOS: status.compatibility?.minimumMacOS,
            supportedArchitectures: status.compatibility?.supportedArchitectures,
            bundledNodeVersion: status.compatibility?.bundledNodeVersion,
            sidecarVerified: status.compatibility?.sidecarVerified,
            warnings: distribution?.warnings,
            nextSteps: distribution?.nextSteps,
            operatorChecklist: distribution?.operatorChecklist
        )
    }

    private func lightweightManifestSummary(artifacts: [ReleaseArtifactInfo]) -> ReleaseManifestSummary {
        ReleaseManifestSummary(
            fileName: "StockAnalysis-\(appVersion)-macos-\(arch).manifest.json",
            builtAt: "npm run mac:package 결과 확인 필요",
            signingIdentity: "npm run mac:release-check에서 확인",
            arch: arch,
            notarizationRequested: false,
            notarizationStapled: false,
            readinessLabel: "릴리즈 파일 확인",
            readinessStatus: artifacts.allSatisfy(\.exists) ? "partial" : "incomplete",
            readyForExternalDistribution: false,
            gatekeeperRisk: "high",
            minimumMacOS: "14.0",
            supportedArchitectures: [arch],
            bundledNodeVersion: nil,
            sidecarVerified: nil,
            warnings: [
                "앱 UI는 릴리즈 파일 존재만 확인합니다. checksum, 서명, 공증은 npm run mac:release-check에서 확인하세요.",
            ],
            nextSteps: [
                "정식 배포 전 Developer ID 서명과 Apple 공증을 적용하세요.",
            ],
            operatorChecklist: [
                "새 Mac에서 Toss API 키를 다시 저장하고 자동거래 계좌를 선택하세요.",
                "Toss 개발자 콘솔 허용 IP와 앱 연결 진단의 공인 IP가 일치하는지 확인하세요.",
                "OrderIntent, RiskCheck, kill switch 상태를 확인하세요. 1.0.0은 paper-only입니다.",
            ]
        )
    }

    private func artifactTitle(kind: String) -> String {
        switch kind {
        case "dmg": return "DMG 설치 파일"
        case "zip": return "ZIP 백업 파일"
        case "manifest": return "릴리즈 명세"
        case "install-guide": return "설치 안내"
        case "release-index": return "통합 릴리즈 인덱스"
        case "release-check": return "배포 게이트 검증"
        case "install-verification": return "DMG 설치본 검증"
        default: return kind.uppercased()
        }
    }

    private func summaryMessage(
        artifacts: [ReleaseArtifactInfo],
        handoffEntries: [ReleaseHandoffEntryInfo],
        manifest: ReleaseManifestSummary?,
        releaseCheck: MacReleaseCheckSummary?,
        installVerification: DmgInstallVerificationSummary?
    ) -> String {
        let readyCount = artifacts.filter(\.exists).count
        let readiness = manifest?.readinessDisplayLabel ?? "배포 준비도 없음"
        let notarization = manifest?.notarizationLabel ?? "공증 정보 없음"
        let distributionGate = releaseCheck?.displayLabel ?? "배포 게이트 없음"
        let install = installVerification?.displayLabel ?? "설치본 검증 없음"
        if !handoffEntries.isEmpty {
            let handoffFiles = handoffEntries.flatMap { entry in
                entry.requiredFiles.compactMap { $0 }
            }
            let verifiedCount = handoffFiles.filter { file in
                file.exists && file.checksumMatches == true
            }.count
            return "\(readiness) · \(notarization) · \(distributionGate) · \(install) · Mac별 파일 \(verifiedCount)/\(handoffFiles.count)개 SHA 확인 · 현재 앱 \(readyCount)/\(artifacts.count)개"
        }
        return "\(readiness) · \(notarization) · \(distributionGate) · \(install) · 아티팩트 \(readyCount)/\(artifacts.count)개 확인"
    }

    private func checksumMatches(url: URL?, expectedSHA256: String?) -> Bool? {
        guard let url, let expectedSHA256, !expectedSHA256.isEmpty else {
            return nil
        }
        guard let actual = sha256HexDigest(url: url) else {
            return false
        }
        return actual.caseInsensitiveCompare(expectedSHA256) == .orderedSame
    }

    private func sha256HexDigest(url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return nil
        }
        defer {
            try? handle.close()
        }

        var hasher = SHA256()
        while true {
            let chunk = try? handle.read(upToCount: 1024 * 1024)
            guard let chunk, !chunk.isEmpty else {
                break
            }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

enum WorkspaceTab: String, CaseIterable, Identifiable {
    case overview
    case orderRisk
    case newsAlerts
    case replay
    case playbook

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "분석·차트"
        case .orderRisk: return "주문·자동화"
        case .newsAlerts: return "뉴스·알림"
        case .replay: return "실행 기록"
        case .playbook: return "전략 노트"
        }
    }

    var purpose: String {
        switch self {
        case .overview:
            return "선택 종목의 차트, 기술 신호, 시장 상태를 한 화면에서 분석합니다."
        case .orderRisk:
            return "주문 전 위험을 점검하고 paper 자동화의 실행 상태를 관리합니다."
        case .newsAlerts:
            return "종목과 시장 뉴스를 갱신하고 중요한 이벤트와 알림 조건을 확인합니다."
        case .replay:
            return "OrderIntent와 RiskCheck 이력을 시간순으로 복기해 실행 품질을 점검합니다."
        case .playbook:
            return "종목별 투자 가설, 진입·청산 조건, 자동화 운용 원칙을 저장합니다."
        }
    }

    var badge: String {
        switch self {
        case .overview: return "6"
        case .orderRisk: return "P0"
        case .newsAlerts: return "P1"
        case .replay: return "P1"
        case .playbook: return "P1"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "chart.xyaxis.line"
        case .orderRisk: return "shield.lefthalf.filled"
        case .newsAlerts: return "bell.badge"
        case .replay: return "timeline.selection"
        case .playbook: return "checklist"
        }
    }
}

struct ReleaseArtifactInfo: Identifiable, Sendable {
    let title: String
    let detail: String
    let exists: Bool
    let url: URL?
    let fileName: String

    var id: String { title }

    init(title: String, detail: String, exists: Bool, url: URL?, fileName: String? = nil) {
        self.title = title
        self.detail = detail
        self.exists = exists
        self.url = url
        self.fileName = fileName ?? url?.lastPathComponent ?? "생성 전"
    }
}

struct ReleaseHandoffEntryInfo: Identifiable, Sendable, Equatable {
    let arch: String
    let label: String
    let readyForExternalDistribution: Bool?
    let status: String?
    let sidecarVerified: Bool?
    let minimumMacOS: String?
    let supportedArchitectures: [String]
    let files: [ReleaseHandoffFileInfo]

    var id: String { arch }

    var dmgFile: ReleaseHandoffFileInfo? {
        files.first { $0.kind == "dmg" }
    }

    var zipFile: ReleaseHandoffFileInfo? {
        files.first { $0.kind == "zip" }
    }

    var manifestFile: ReleaseHandoffFileInfo? {
        files.first { $0.kind == "manifest" }
    }

    var requiredFiles: [ReleaseHandoffFileInfo?] {
        [dmgFile, zipFile, manifestFile]
    }

    var hasRequiredFiles: Bool {
        requiredFiles.allSatisfy { file in
            file?.exists == true && file?.checksumMatches == true
        }
    }

    var hasMissingRequiredFile: Bool {
        requiredFiles.contains { $0?.exists != true }
    }

    var hasChecksumMismatch: Bool {
        requiredFiles.contains { $0?.checksumMatches == false }
    }

    var hasUnverifiedChecksum: Bool {
        requiredFiles.contains { file in
            file?.exists == true && file?.checksumMatches == nil
        }
    }

    var handoffStatusLabel: String {
        if hasMissingRequiredFile {
            return "누락"
        }
        if hasChecksumMismatch {
            return "SHA 불일치"
        }
        if hasUnverifiedChecksum {
            return "SHA 미확인"
        }
        return "검증"
    }

    var handoffStatusTone: PillTone {
        if hasMissingRequiredFile || hasChecksumMismatch {
            return .red
        }
        if hasUnverifiedChecksum {
            return .amber
        }
        return .green
    }

    var fileSummary: String {
        "DMG \(fileStatus(dmgFile)) · ZIP \(fileStatus(zipFile)) · Manifest \(fileStatus(manifestFile))"
    }

    var targetSummary: String {
        "\(label) · macOS \(minimumMacOS ?? "미확인")+ · \(supportedArchitectures.joined(separator: " / "))"
    }

    var readinessLabel: String {
        if readyForExternalDistribution == true {
            return "외부 배포 준비"
        }
        return status == "local-test" ? "로컬 테스트" : status ?? "상태 미확인"
    }

    private func fileStatus(_ file: ReleaseHandoffFileInfo?) -> String {
        guard let file, file.exists else {
            return "없음"
        }
        if file.checksumMatches == true {
            return "SHA 정상"
        }
        if file.checksumMatches == false {
            return "SHA 불일치"
        }
        return "SHA 미확인"
    }
}

struct ReleaseHandoffFileInfo: Identifiable, Sendable, Equatable {
    let kind: String
    let fileName: String
    let exists: Bool
    let sha256: String?
    let checksumMatches: Bool?
    let url: URL?

    var id: String { "\(kind)-\(fileName)" }

    var shortChecksum: String {
        guard let sha256, sha256.count > 12 else {
            return sha256 ?? "checksum 없음"
        }
        let prefix = sha256.prefix(12)
        let suffix = sha256.suffix(8)
        return "\(prefix)…\(suffix)"
    }

    var checksumLabel: String {
        if checksumMatches == true {
            return "SHA 정상"
        }
        if checksumMatches == false {
            return "SHA 불일치"
        }
        return "SHA 미확인"
    }

    var checksumTone: PillTone {
        if checksumMatches == true {
            return .green
        }
        if checksumMatches == false {
            return .red
        }
        return .amber
    }
}

struct MacReleaseCheckSummary: Sendable {
    let fileName: String
    let status: String
    let label: String
    let ok: Bool
    let readyForExternalDistribution: Bool
    let gatekeeperRisk: String
    let developerIdReady: Bool?
    let sidecarVerified: Bool?
    let issues: [String]
    let warnings: [String]
    let nextSteps: [String]
    let files: [MacReleaseCheckFileInfo]

    var displayLabel: String {
        readyForExternalDistribution ? "외부 배포 검증" : ok ? "로컬 배포 검증" : "배포 검증 실패"
    }

    var tone: PillTone {
        if readyForExternalDistribution {
            return .green
        }
        return ok ? .amber : .red
    }

    var staplerPassed: Int {
        dmgFiles.filter { $0.staplerValidated == true }.count
    }

    var gatekeeperPassed: Int {
        dmgFiles.filter { $0.gatekeeperAccepted == true }.count
    }

    var checksumPassed: Int {
        files.filter { $0.sha256Matches == true }.count
    }

    var dmgFiles: [MacReleaseCheckFileInfo] {
        files.filter { $0.kind == "dmg" }
    }

    var detail: String {
        "DMG \(dmgFiles.count)개 · stapler \(staplerPassed)/\(dmgFiles.count) · Gatekeeper \(gatekeeperPassed)/\(dmgFiles.count) · SHA \(checksumPassed)/\(files.count)"
    }

    var gatekeeperLabel: String {
        gatekeeperRisk == "low" ? "낮음" : "높음"
    }
}

struct MacReleaseCheckFileInfo: Identifiable, Sendable {
    let arch: String
    let label: String
    let fileName: String
    let kind: String
    let exists: Bool
    let sha256Matches: Bool?
    let staplerValidated: Bool?
    let gatekeeperAccepted: Bool?
    let staplerDetail: String?
    let gatekeeperDetail: String?

    var id: String { "\(arch)-\(kind)-\(fileName)" }

    var shaLabel: String {
        if sha256Matches == true {
            return "SHA 정상"
        }
        if sha256Matches == false {
            return "SHA 불일치"
        }
        return "SHA 미확인"
    }

    var staplerLabel: String {
        if kind != "dmg" {
            return "stapler 대상 아님"
        }
        if staplerValidated == true {
            return "stapler 통과"
        }
        if staplerValidated == false {
            return "stapler 실패"
        }
        return "stapler 미확인"
    }

    var gatekeeperLabel: String {
        if kind != "dmg" {
            return "Gatekeeper 대상 아님"
        }
        if gatekeeperAccepted == true {
            return "Gatekeeper 통과"
        }
        if gatekeeperAccepted == false {
            return "Gatekeeper 실패"
        }
        return "Gatekeeper 미확인"
    }

    var staplerTone: PillTone {
        if kind != "dmg" || staplerValidated == nil {
            return .amber
        }
        return staplerValidated == true ? .green : .red
    }

    var gatekeeperTone: PillTone {
        if kind != "dmg" || gatekeeperAccepted == nil {
            return .amber
        }
        return gatekeeperAccepted == true ? .green : .red
    }
}

struct ReleaseManifestSummary: Sendable {
    let fileName: String
    let builtAt: String
    let signingIdentity: String
    let arch: String
    let notarizationRequested: Bool
    let notarizationStapled: Bool
    let readinessLabel: String?
    let readinessStatus: String?
    let readyForExternalDistribution: Bool?
    let gatekeeperRisk: String?
    let minimumMacOS: String?
    let supportedArchitectures: [String]?
    let bundledNodeVersion: String?
    let sidecarVerified: Bool?
    let warnings: [String]?
    let nextSteps: [String]?
    let operatorChecklist: [String]?

    var notarizationLabel: String {
        if notarizationStapled {
            return "공증 완료"
        }
        return notarizationRequested ? "공증 요청됨" : "공증 미요청"
    }

    var notarizationTone: PillTone {
        if notarizationStapled {
            return .green
        }
        return notarizationRequested ? .amber : .red
    }

    var readinessDisplayLabel: String {
        if let readinessLabel, !readinessLabel.isEmpty {
            return readinessLabel
        }
        if readyForExternalDistribution == true {
            return "외부 배포 준비"
        }
        return "로컬 테스트 빌드"
    }

    var readinessTone: PillTone {
        if readyForExternalDistribution == true {
            return .green
        }
        if readinessStatus == "incomplete" {
            return .red
        }
        return .amber
    }

    var gatekeeperLabel: String {
        gatekeeperRisk == "low" ? "낮음" : "높음"
    }

    var developerSigningLabel: String {
        signingIdentity.starts(with: "Developer ID Application:") ? "Developer ID" : "ad-hoc"
    }

    var minimumMacOSLabel: String {
        minimumMacOS ?? "미확인"
    }

    var supportedArchitectureLabel: String {
        guard let supportedArchitectures, !supportedArchitectures.isEmpty else {
            return arch
        }
        return supportedArchitectures.joined(separator: " / ")
    }

    var bundledNodeLabel: String {
        bundledNodeVersion ?? "미확인"
    }

    var sidecarVerificationLabel: String {
        if sidecarVerified == true {
            return "Sidecar 검증 통과"
        }
        if sidecarVerified == false {
            return "Sidecar 검증 실패"
        }
        return "Sidecar 검증 미확인"
    }

    var sidecarVerificationTone: PillTone {
        if sidecarVerified == true {
            return .green
        }
        if sidecarVerified == false {
            return .red
        }
        return .amber
    }

    var readinessWarnings: [String] {
        warnings ?? []
    }

    var readinessNextSteps: [String] {
        nextSteps ?? []
    }

    var readinessOperatorChecklist: [String] {
        operatorChecklist ?? [
            "새 Mac에서는 Toss API 키를 앱 설정에서 다시 검증해 sidecar 저장소와 macOS Keychain에 저장해야 합니다.",
            "Toss 개발자 콘솔의 허용 IP와 앱의 연결 진단 공인 IP가 일치해야 합니다.",
            "1.0.0 데스크톱은 credential 상태와 관계없이 실제 주문을 차단하고 paper 계좌에만 기록합니다.",
        ]
    }
}

struct ReleaseStatusResource: Codable {
    let app: String
    let bundleIdentifier: String
    let version: String
    let platform: String
    let arch: String
    let builtAt: String
    let signingIdentity: String
    let notarization: ReleaseStatusNotarization
    let compatibility: ReleaseStatusCompatibility?
    let distribution: ReleaseStatusDistribution?
    let files: [ReleaseStatusFile]
}

struct ReleaseStatusNotarization: Codable {
    let requested: Bool
    let stapled: Bool
}

struct ReleaseStatusFile: Codable {
    let kind: String
    let fileName: String
}

struct ReleaseStatusCompatibility: Codable {
    let minimumMacOS: String?
    let targetArch: String?
    let supportedArchitectures: [String]?
    let supportsAppleSilicon: Bool?
    let supportsIntel: Bool?
    let bundledNodeVersion: String?
    let sidecarVerified: Bool?
}

struct ReleaseStatusDistribution: Codable {
    let status: String?
    let label: String?
    let readyForExternalDistribution: Bool?
    let developerIdSigned: Bool?
    let notarizationStapled: Bool?
    let gatekeeperRisk: String?
    let architecture: String?
    let warnings: [String]?
    let nextSteps: [String]?
    let operatorChecklist: [String]?
}

private struct MacReleaseCheckResource: Codable {
    let ok: Bool?
    let readyForExternalDistribution: Bool?
    let status: String?
    let label: String?
    let developerIdReady: Bool?
    let sidecarVerified: Bool?
    let gatekeeperRisk: String?
    let issues: [String]?
    let warnings: [String]?
    let nextSteps: [String]?
    let files: [MacReleaseCheckFileResource]?
}

private struct MacReleaseCheckFileResource: Codable {
    let arch: String?
    let label: String?
    let fileName: String?
    let path: String?
    let kind: String?
    let exists: Bool?
    let sha256Matches: Bool?
    let staplerValidated: Bool?
    let staplerDetail: String?
    let gatekeeperAccepted: Bool?
    let gatekeeperDetail: String?
}

private struct ReleaseIndexResource: Codable {
    let entries: [ReleaseIndexEntry]
}

private struct ReleaseIndexEntry: Codable {
    let arch: String
    let label: String
    let readyForExternalDistribution: Bool?
    let status: String?
    let sidecarVerified: Bool?
    let minimumMacOS: String?
    let supportedArchitectures: [String]
    let files: [ReleaseIndexFile]
}

private struct ReleaseIndexFile: Codable {
    let kind: String
    let fileName: String
    let exists: Bool
    let sha256: String?
}

private struct DmgInstallVerificationResource: Codable {
    let ok: Bool?
    let generatedAt: String?
    let checked: Int?
    let results: [DmgInstallVerificationResultResource]?
    let issues: [String]?
}

private struct DmgInstallVerificationResultResource: Codable {
    let fileName: String?
    let sidecarVerified: Bool?
    let sidecarEndpointChecks: SidecarEndpointCheckResource?
    let appLaunchVerified: Bool?
    let uiSmokeVerified: Bool?
    let uiSmokeChecks: UiSmokeCheckResource?
    let nodeVersion: String?
}

private struct SidecarEndpointCheckResource: Codable {
    let health: Bool?
    let tossOpenApiContract: Bool?
    let brokerCredentials: Bool?
    let publicIpCheckSkipped: Bool?
    let automationScheduler: Bool?
    let symbolSearch: Bool?
    let cryptoExchangeSafety: Bool?
    let cryptoStrategyLifecycle: Bool?
    let strategyConfigs: Bool?
    let strategyLifecycle: Bool?
    let strategyBackupImport: Bool?
    let holdingsNoCredential: Bool?
    let orderSyncNoCredential: Bool?
    let orderPrecheckNoCredential: Bool?
}

private struct UiSmokeCheckResource: Codable {
    let launchedWindow: Bool?
    let sidecarVisible: Bool?
    let menuBarExtra: Bool?
    let topCommandButtons: Bool?
    let decisionPanelButtons: Bool?
    let paperResetConfirmation: Bool?
    let firstRunSetup: Bool?
    let firstRunSetupActions: Bool?
    let workspaceTabs: Bool?
    let orderRiskButtons: Bool?
    let orderRiskReportCopy: Bool?
    let orderSyncButton: Bool?
    let newsReplayPlaybookButtons: Bool?
    let tossSheetNoCredentialState: Bool?
    let publicIpCheckButton: Bool?
    let publicIpCopyButton: Bool?
    let tossCredentialControls: Bool?
    let tossReadinessButton: Bool?
    let strategyDraftCreation: Bool?
    let strategyReportCopy: Bool?
    let strategyBackupImport: Bool?
    let strategyCardActions: Bool?
    let automationRunConfirmation: Bool?
    let continuousAutomationScheduler: Bool?
    let koreanSymbolSearch: Bool?
    let cryptoExchangeSheet: Bool?
    let selfTestSheet: Bool?
    let selfTestReportCopy: Bool?
    let distributionInstallReadiness: Bool?
    let releaseChecksumCopy: Bool?
    let sidecarLogSheet: Bool?
    let killSwitchToggle: Bool?
    let killSwitchButtonGuards: Bool?
}

struct DmgInstallVerificationSummary: Sendable {
    let fileName: String
    let generatedAt: String
    let checked: Int
    let ok: Bool
    let results: [DmgInstallVerificationResultInfo]
    let issues: [String]

    var verifiedSidecars: Int {
        results.filter(\.sidecarVerified).count
    }

    var verifiedEndpointChecks: Int {
        results.filter(\.sidecarEndpointVerified).count
    }

    var verifiedAppLaunches: Int {
        results.filter(\.appLaunchVerified).count
    }

    var verifiedUiSmokeChecks: Int {
        results.filter(\.uiSmokeVerified).count
    }

    var sidecarVerified: Bool {
        ok &&
        checked > 0 &&
        results.count == checked &&
        verifiedSidecars == checked &&
        verifiedEndpointChecks == checked &&
        verifiedAppLaunches == checked &&
        verifiedUiSmokeChecks == checked
    }

    var displayLabel: String {
        sidecarVerified ? "설치본 검증 통과" : ok ? "설치본 일부 확인" : "설치본 검증 실패"
    }

    var tone: PillTone {
        sidecarVerified ? .green : ok ? .amber : .red
    }

    var detail: String {
        let total = max(checked, results.count)
        return "DMG \(checked)개 · sidecar \(verifiedSidecars)/\(total)개 · endpoint \(verifiedEndpointChecks)/\(total)개 · 실행 \(verifiedAppLaunches)/\(total)개 · UI \(verifiedUiSmokeChecks)/\(total)개 · \(generatedAt)"
    }
}

struct DmgInstallVerificationResultInfo: Identifiable, Sendable {
    let fileName: String
    let sidecarVerified: Bool
    let sidecarEndpointChecks: SidecarEndpointCheckInfo?
    let appLaunchVerified: Bool
    let uiSmokeVerified: Bool
    let uiSmokeChecks: UiSmokeCheckInfo?
    let nodeVersion: String?

    var id: String { fileName }

    var sidecarEndpointVerified: Bool {
        sidecarEndpointChecks?.allPassed == true
    }

    var endpointLabel: String {
        sidecarEndpointVerified ? "전략/Toss/IP/백업/체결 검증" : "endpoint 미확인"
    }

    var endpointDetail: String {
        sidecarEndpointChecks?.summary ?? "세부 endpoint 체크 없음"
    }

    var appLaunchLabel: String {
        appLaunchVerified ? "앱 실행 검증" : "앱 실행 미확인"
    }

    var uiSmokeLabel: String {
        uiSmokeVerified ? "버튼 검증" : "버튼 미확인"
    }

    var uiSmokeDetail: String {
        uiSmokeChecks?.summary ?? "UI smoke 체크 없음"
    }
}

struct SidecarEndpointCheckInfo: Sendable {
    let health: Bool
    let tossOpenApiContract: Bool
    let brokerCredentials: Bool
    let publicIpCheckSkipped: Bool
    let automationScheduler: Bool
    let symbolSearch: Bool
    let cryptoExchangeSafety: Bool
    let cryptoStrategyLifecycle: Bool
    let strategyConfigs: Bool
    let strategyLifecycle: Bool
    let strategyBackupImport: Bool
    let holdingsNoCredential: Bool
    let orderSyncNoCredential: Bool
    let orderPrecheckNoCredential: Bool

    var allPassed: Bool {
            health &&
            tossOpenApiContract &&
            brokerCredentials &&
            publicIpCheckSkipped &&
            automationScheduler &&
            symbolSearch &&
            cryptoExchangeSafety &&
            cryptoStrategyLifecycle &&
            strategyConfigs &&
            strategyLifecycle &&
            strategyBackupImport &&
            holdingsNoCredential &&
            orderSyncNoCredential &&
            orderPrecheckNoCredential
    }

    var summary: String {
        [
            label("health", health),
            label("toss-contract", tossOpenApiContract),
            label("credential", brokerCredentials),
            label("public-ip", publicIpCheckSkipped),
            label("scheduler", automationScheduler),
            label("symbol-search", symbolSearch),
            label("crypto-safety", cryptoExchangeSafety),
            label("crypto-strategy", cryptoStrategyLifecycle),
            label("strategy", strategyConfigs),
            label("lifecycle", strategyLifecycle),
            label("backup", strategyBackupImport),
            label("holdings", holdingsNoCredential),
            label("order-sync", orderSyncNoCredential),
            label("precheck", orderPrecheckNoCredential),
        ].joined(separator: " · ")
    }

    private func label(_ title: String, _ passed: Bool) -> String {
        "\(title) \(passed ? "통과" : "실패")"
    }
}

struct UiSmokeCheckInfo: Sendable {
    let launchedWindow: Bool
    let sidecarVisible: Bool
    let menuBarExtra: Bool
    let topCommandButtons: Bool
    let decisionPanelButtons: Bool
    let paperResetConfirmation: Bool
    let firstRunSetup: Bool
    let firstRunSetupActions: Bool
    let workspaceTabs: Bool
    let orderRiskButtons: Bool
    let orderRiskReportCopy: Bool
    let orderSyncButton: Bool
    let newsReplayPlaybookButtons: Bool
    let tossSheetNoCredentialState: Bool
    let publicIpCheckButton: Bool
    let publicIpCopyButton: Bool
    let tossCredentialControls: Bool
    let tossReadinessButton: Bool
    let strategyDraftCreation: Bool
    let strategyReportCopy: Bool
    let strategyBackupImport: Bool
    let strategyCardActions: Bool
    let automationRunConfirmation: Bool
    let continuousAutomationScheduler: Bool
    let koreanSymbolSearch: Bool
    let cryptoExchangeSheet: Bool
    let selfTestSheet: Bool
    let selfTestReportCopy: Bool
    let distributionInstallReadiness: Bool
    let releaseChecksumCopy: Bool?
    let sidecarLogSheet: Bool
    let killSwitchToggle: Bool
    let killSwitchButtonGuards: Bool

    var allPassed: Bool {
        [
            launchedWindow,
            sidecarVisible,
            menuBarExtra,
            topCommandButtons,
            decisionPanelButtons,
            paperResetConfirmation,
            firstRunSetup,
            firstRunSetupActions,
            workspaceTabs,
            orderRiskButtons,
            orderRiskReportCopy,
            orderSyncButton,
            newsReplayPlaybookButtons,
            tossSheetNoCredentialState,
            publicIpCheckButton,
            publicIpCopyButton,
            tossCredentialControls,
            tossReadinessButton,
            strategyDraftCreation,
            strategyReportCopy,
            strategyBackupImport,
            strategyCardActions,
            automationRunConfirmation,
            continuousAutomationScheduler,
            koreanSymbolSearch,
            cryptoExchangeSheet,
            selfTestSheet,
            selfTestReportCopy,
            distributionInstallReadiness,
            sidecarLogSheet,
            killSwitchToggle,
            killSwitchButtonGuards,
        ].allSatisfy { $0 }
    }

    var summary: String {
        var checks = [
            launchedWindow ? "window" : "window 실패",
            sidecarVisible ? "sidecar" : "sidecar 실패",
            menuBarExtra ? "menubar" : "menubar 실패",
            topCommandButtons ? "top" : "top 실패",
            decisionPanelButtons ? "decision" : "decision 실패",
            paperResetConfirmation ? "paper reset" : "paper reset 실패",
            firstRunSetup ? "first-run" : "first-run 실패",
            firstRunSetupActions ? "first-run actions" : "first-run actions 실패",
            workspaceTabs ? "tabs" : "tabs 실패",
            orderRiskButtons ? "order-risk" : "order-risk 실패",
            orderRiskReportCopy ? "order-risk report" : "order-risk report 실패",
            orderSyncButton ? "order-sync" : "order-sync 실패",
            newsReplayPlaybookButtons ? "news/replay/playbook" : "news/replay/playbook 실패",
            tossSheetNoCredentialState ? "Toss safety" : "Toss safety 실패",
            publicIpCheckButton ? "public IP" : "public IP 실패",
            publicIpCopyButton ? "public IP copy" : "public IP copy 실패",
            tossCredentialControls ? "credential controls" : "credential controls 실패",
            tossReadinessButton ? "readiness" : "readiness 실패",
            strategyDraftCreation ? "strategy draft" : "strategy draft 실패",
            strategyReportCopy ? "strategy report" : "strategy report 실패",
            strategyBackupImport ? "strategy backup" : "strategy backup 실패",
            strategyCardActions ? "strategy actions" : "strategy actions 실패",
            automationRunConfirmation ? "automation confirm" : "automation confirm 실패",
            continuousAutomationScheduler ? "automation scheduler" : "automation scheduler 실패",
            koreanSymbolSearch ? "Korean symbol search" : "Korean symbol search 실패",
            cryptoExchangeSheet ? "crypto exchange" : "crypto exchange 실패",
            selfTestSheet ? "self-test" : "self-test 실패",
            selfTestReportCopy ? "self-test report" : "self-test report 실패",
            distributionInstallReadiness ? "distribution" : "distribution 실패",
            sidecarLogSheet ? "logs" : "logs 실패",
            killSwitchToggle ? "kill switch" : "kill switch 실패",
            killSwitchButtonGuards ? "button guards" : "button guards 실패",
        ]
        if let releaseChecksumCopy {
            checks.insert(releaseChecksumCopy ? "release SHA" : "release SHA 실패", at: checks.count - 3)
        }
        return checks.joined(separator: " · ")
    }
}

struct SidecarBuildResource: Codable {
    let builtAt: String
    let repoRoot: String?
    let node: String?
    let platform: String?
    let arch: String?
    let mode: String?
}

struct MarketAnalysisSnapshot: Equatable {
    let symbol: String
    let latestClose: Double?
    let previousClose: Double?
    let market: String?
    let currency: String
    let dataSource: String?
    let timeframe: String?
    let quoteAt: String?
    let stale: Bool
    let candles: [AnalysisCandle]
    let tradeLabel: String?
    let entryPlan: String?
    let validIf: String?
    let invalidIf: String?
    let chartQualityScore: Double?
    let chartQualityGrade: String?
    let reliabilityGrade: String?
    let reliabilityScore: Double?
    let reliabilityRiskReward: Double?
    let breakoutStatus: String?
    let breakoutPattern: String?
    let indicators: AnalysisChartIndicators
    let breakoutTime: Int?
    let breakoutPrice: Double?
    let recentSignals: [AnalysisSignal]
    let signalEvents: [AnalysisTradeSignalEvent]
    let isBrokerStopEligible: Bool
    let orderSubmissionAttempted: Bool

    var changeRatio: Double? {
        guard let latestClose, let previousClose, previousClose != 0 else {
            return nil
        }
        return latestClose / previousClose - 1
    }
}

struct AnalysisCandle: Identifiable, Equatable {
    let id: Int
    let time: Int
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double
}

struct AnalysisSignal: Identifiable, Equatable {
    let id: String
    let time: Int
    let type: String
    let label: String
    let reason: String
    let price: Double?
}

struct AnalysisIndicatorPoint: Equatable {
    let time: Int
    let value: Double
}

struct AnalysisChartIndicators: Equatable {
    let sma5: [AnalysisIndicatorPoint]
    let sma20: [AnalysisIndicatorPoint]
    let sma60: [AnalysisIndicatorPoint]
    let rsi: [AnalysisIndicatorPoint]

    static let empty = AnalysisChartIndicators(sma5: [], sma20: [], sma60: [], rsi: [])
}

struct StrategyPriceSuggestion {
    let price: Double
    let source: String
}

enum WatchAssetFilter: String, CaseIterable, Identifiable {
    case us = "US"
    case kr = "KR"
    case etf = "ETF"
    case crypto = "CRYPTO"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .us: return "US"
        case .kr: return "KR"
        case .etf: return "ETF"
        case .crypto: return "가상자산"
        }
    }

    static func inferred(symbol: String) -> WatchAssetFilter {
        let normalized = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if normalized.range(of: #"^\d{6}$"#, options: .regularExpression) != nil {
            return .kr
        }
        if normalized.contains("USDT") ||
            normalized.contains("-USD") ||
            normalized.contains("BTC") ||
            normalized.contains("ETH") ||
            normalized.contains("SOL") {
            return .crypto
        }
        let etfs: Set<String> = ["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "SOXL", "TQQQ", "SQQQ", "TLT"]
        if etfs.contains(normalized) {
            return .etf
        }
        return .us
    }
}

struct WatchSymbol: Identifiable {
    let symbol: String
    let name: String
    let price: String
    let change: String
    let isUp: Bool
    let alert: String
    let assetClass: WatchAssetFilter

    var id: String { symbol }

    init(
        symbol: String,
        name: String,
        price: String,
        change: String,
        isUp: Bool,
        alert: String,
        assetClass: WatchAssetFilter? = nil
    ) {
        self.symbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        self.name = name
        self.price = price
        self.change = change
        self.isUp = isUp
        self.alert = alert
        self.assetClass = assetClass ?? WatchAssetFilter.inferred(symbol: symbol)
    }

    static let starterMetadata: [(symbol: String, name: String)] = [
        ("NVDA", "NVIDIA Corp"),
        ("TSLA", "Tesla Inc"),
        ("AAPL", "Apple Inc"),
        ("MSFT", "Microsoft"),
        ("AMD", "Advanced Micro"),
        ("META", "Meta Platforms"),
        ("PLTR", "Palantir"),
        ("SPY", "S&P 500 ETF"),
    ]
}

enum PillTone {
    case green
    case red
    case amber
    case blue
    case violet
    case muted

    var color: Color {
        switch self {
        case .green: return .terminalGreen
        case .red: return .terminalRed
        case .amber: return .terminalAmber
        case .blue: return .terminalBlue
        case .violet: return .terminalViolet
        case .muted: return .terminalMuted
        }
    }
}

struct MainDashboardView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedSymbol = "NVDA"
    @State private var selectedSession = "US"
    @State private var selectedTab: WorkspaceTab = .overview
    @State private var resultPreview = ""
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 0) {
            TopCommandBar(
                selectedSymbol: $selectedSymbol,
                selectedSession: $selectedSession,
                resultPreview: $resultPreview,
                isLoading: $isLoading
            )

            HStack(spacing: 0) {
                WatchlistSidebar(selectedSymbol: $selectedSymbol)
                    .frame(width: 286)

                VStack(spacing: 0) {
                    WorkspaceTabBar(selectedTab: $selectedTab)
                    WorkspacePurposeBar(selectedTab: selectedTab)
                    WorkspaceContent(
                        selectedTab: selectedTab,
                        selectedSymbol: selectedSymbol,
                        selectedSession: selectedSession,
                        resultPreview: $resultPreview,
                        isLoading: $isLoading
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    EventTapeView(selectedSymbol: selectedSymbol)
                        .frame(height: 188)
                }

                DecisionPanel(
                    selectedSymbol: selectedSymbol,
                    selectedSession: selectedSession,
                    resultPreview: $resultPreview,
                    isLoading: $isLoading
                )
                .frame(width: 390)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipped()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            if model.health == nil && !model.isStartingSidecar {
                model.startSidecar()
            }
            if model.health?.ok == true, model.newsEvents.isEmpty {
                await model.refreshNews()
            }
            if model.health?.ok == true, model.terminalDashboard == nil {
                await model.refreshTerminalDashboard(symbol: selectedSymbol, session: selectedSession)
            }
        }
        .task(id: "\(selectedSymbol.uppercased())-\(selectedSession)-\(model.health?.ok == true)") {
            if model.health?.ok == true {
                await model.refreshTerminalDashboard(symbol: selectedSymbol, session: selectedSession)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            model.stopSidecar()
        }
    }
}

struct TopCommandBar: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selectedSymbol: String
    @Binding var selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    @State private var showingSetupGuide = false
    @State private var showingTossSettings = false
    @State private var showingStrategySettings = false
    @State private var showingSelfTest = false
    @State private var showingDistribution = false
    @State private var showingSidecarLog = false
    @State private var showingCryptoSettings = false
    @State private var activeAction: CommandAction?
    @State private var didEvaluateFirstRun = false

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "command")
                    .foregroundStyle(.secondary)
                SymbolSearchField(
                    selectedSymbol: $selectedSymbol,
                    selectedSession: selectedSession,
                    onAnalyze: { Task { await analyze() } }
                )
                Text("K")
                    .font(.system(.caption2, design: .monospaced).weight(.bold))
                    .foregroundStyle(Color.terminalMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.terminalLine))
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            Picker("", selection: $selectedSession) {
                Text("US").tag("US")
                Text("KR").tag("KR")
            }
            .pickerStyle(.segmented)
            .frame(width: 94)

            Button(activeAction == .analyze ? "분석 중" : "분석") {
                Task { await analyze() }
            }
            .disabled(isLoading)

            Button(activeAction == .briefing ? "브리핑 중" : "브리핑") {
                Task { await briefing() }
            }
            .disabled(isLoading)

            Spacer(minLength: 8)

            StatusPill(model.health?.ok == true ? "Sidecar 정상" : "Sidecar 오프라인", tone: model.health?.ok == true ? .green : .red)
            StatusPill("모의투자 활성", tone: .green)
            StatusPill(model.liveGateLabel, tone: model.liveGateTone)
            StatusPill("갱신 \(model.lastUpdated)", tone: .amber)

            Button(model.health == nil ? "엔진 시작" : activeAction == .status ? "상태 확인 중" : "상태 갱신") {
                if model.health == nil {
                    model.startSidecar()
                    resultPreview = "엔진 시작 요청을 보냈습니다. 몇 초 뒤 상태 갱신 또는 앱 점검으로 sidecar health를 확인하세요."
                } else {
                    Task { await refreshStatus() }
                }
            }
            .disabled(model.health != nil && isLoading)

            Button(activeAction == .news ? "뉴스 갱신 중" : "뉴스") {
                Task { await refreshNews() }
            }
            .disabled(model.health == nil || isLoading)

            Button("시작") {
                showingSetupGuide = true
            }

            Button("Toss") {
                showingTossSettings = true
            }

            Button("전략") {
                showingStrategySettings = true
            }

            Button("점검") {
                showingSelfTest = true
            }

            Button("배포") {
                showingDistribution = true
            }

            Button("로그") {
                showingSidecarLog = true
                model.refreshSidecarLogTail()
            }

            Button("코인") {
                showingCryptoSettings = true
            }

            Button(model.killSwitchEngaged ? "중지 해제" : "긴급 중지", role: model.killSwitchEngaged ? nil : .destructive) {
                Task {
                    await model.setKillSwitchEngaged(
                        !model.killSwitchEngaged,
                        reason: model.killSwitchEngaged ? "macOS 앱에서 긴급 중지 해제" : "macOS 앱 긴급 중지 버튼"
                    )
                }
            }
            .disabled(model.killSwitchTransitionPending)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.terminalTopbar)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
        .sheet(isPresented: $showingSetupGuide) {
            FirstRunSetupSheet(
                selectedSymbol: selectedSymbol,
                openToss: {
                    model.completeOnboarding()
                    showingSetupGuide = false
                    showingTossSettings = true
                },
                openCrypto: {
                    model.completeOnboarding()
                    showingSetupGuide = false
                    showingCryptoSettings = true
                },
                openStrategy: {
                    model.completeOnboarding()
                    showingSetupGuide = false
                    showingStrategySettings = true
                },
                openSelfTest: {
                    model.completeOnboarding()
                    showingSetupGuide = false
                    showingSelfTest = true
                },
                openDistribution: {
                    model.completeOnboarding()
                    showingSetupGuide = false
                    showingDistribution = true
                }
            )
            .environmentObject(model)
        }
        .sheet(isPresented: $showingTossSettings) {
            TossCredentialSheet()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingStrategySettings) {
            StrategySettingsSheet(selectedSymbol: selectedSymbol, selectedSession: selectedSession)
                .environmentObject(model)
        }
        .sheet(isPresented: $showingSelfTest) {
            AppSelfTestSheet(
                openSidecarLog: {
                    showingSelfTest = false
                    DispatchQueue.main.async {
                        showingSidecarLog = true
                        model.refreshSidecarLogTail()
                    }
                }
            )
                .environmentObject(model)
        }
        .sheet(isPresented: $showingDistribution) {
            DistributionSheet()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingSidecarLog) {
            SidecarLogSheet()
                .environmentObject(model)
        }
        .sheet(isPresented: $showingCryptoSettings) {
            CryptoExchangeSheet()
                .environmentObject(model)
        }
        .task {
            guard !didEvaluateFirstRun else {
                return
            }
            didEvaluateFirstRun = true
            if !model.settings.hasCompletedOnboarding {
                showingSetupGuide = true
            }
        }
    }

    private func analyze() async {
        let normalizedSymbol = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        selectedSymbol = normalizedSymbol.isEmpty ? "NVDA" : normalizedSymbol
        await runAction(.analyze) {
            await model.analyze(symbol: selectedSymbol, session: selectedSession)
        }
    }

    private func briefing() async {
        await runAction(.briefing) {
            await model.dailyBriefing(session: selectedSession)
        }
    }

    private func refreshNews() async {
        await runAction(.news) {
            await model.refreshNewsSummary()
        }
    }

    private func refreshStatus() async {
        await runAction(.status) {
            await model.refreshStatusSummary()
        }
    }

    private func runAction(_ action: CommandAction, operation: () async -> String) async {
        guard !isLoading else {
            return
        }
        activeAction = action
        isLoading = true
        resultPreview = action.progressMessage
        defer {
            isLoading = false
            activeAction = nil
        }
        resultPreview = await operation()
    }

    private enum CommandAction: Equatable {
        case analyze
        case briefing
        case news
        case status

        var progressMessage: String {
            switch self {
            case .analyze:
                return "종목 분석을 실행 중입니다. 시세, 신호, 리스크 데이터를 local-engine에서 불러오고 있습니다."
            case .briefing:
                return "시장 브리핑을 생성 중입니다. 자동 후보 스캔과 세션 리포트를 정리하고 있습니다."
            case .news:
                return "공식/RSS 뉴스를 갱신 중입니다. 중복 제거와 알림 후보 계산을 실행하고 있습니다."
            case .status:
                return "앱 상태를 확인 중입니다. sidecar, paper state, 자동화 안전 상태를 갱신합니다."
            }
        }
    }
}

private struct SymbolSearchField: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selectedSymbol: String
    let selectedSession: String
    let onAnalyze: () -> Void
    @State private var searchText = ""
    @State private var matches: [LocalSymbolSearchItem] = []
    @State private var searchMessage = ""
    @State private var showingSuggestions = false
    @FocusState private var focused: Bool

    private var trimmedQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        TextField("한글·영문 종목명 또는 종목코드", text: $searchText)
            .textFieldStyle(.plain)
            .font(.system(.body, design: .monospaced))
            .focused($focused)
            .accessibilityIdentifier("symbol-search-field")
            .onSubmit { submitCurrentValue() }
            .onChange(of: focused) { _, isFocused in
                if isFocused && (searchText.isEmpty || searchText == selectedSymbol) {
                    searchText = ""
                } else if !isFocused && searchText.isEmpty {
                    searchText = selectedSymbol
                }
            }
            .onChange(of: selectedSymbol) { _, symbol in
                if !focused {
                    searchText = symbol
                }
            }
            .onChange(of: selectedSession) { _, _ in
                matches = []
                showingSuggestions = false
                if focused {
                    searchText = ""
                }
            }
            .task {
                if searchText.isEmpty {
                    searchText = selectedSymbol
                }
            }
            .task(id: "\(selectedSession):\(trimmedQuery):\(focused)") {
                guard focused, trimmedQuery.count >= 1 else {
                    matches = []
                    showingSuggestions = false
                    return
                }
                do {
                    try await Task.sleep(for: .milliseconds(180))
                    let results = try await model.searchSymbols(query: trimmedQuery, session: selectedSession)
                    guard !Task.isCancelled else { return }
                    matches = results
                    searchMessage = results.isEmpty ? "검색 결과가 없습니다. 종목코드를 직접 입력할 수 있습니다." : ""
                    showingSuggestions = true
                } catch is CancellationError {
                    return
                } catch {
                    matches = []
                    searchMessage = "검색 실패 · 종목코드를 직접 입력할 수 있습니다."
                    showingSuggestions = true
                }
            }
            .popover(isPresented: $showingSuggestions, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedSession == "KR" ? "한국 종목 검색" : "미국·코인 종목 검색")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                        .padding(.horizontal, 10)
                        .padding(.top, 8)
                    if matches.isEmpty {
                        Text(searchMessage)
                            .font(.caption)
                            .foregroundStyle(Color.terminalMuted)
                            .padding(10)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 2) {
                                ForEach(matches) { item in
                                    Button {
                                        select(item)
                                    } label: {
                                        HStack(spacing: 10) {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(item.bilingualName)
                                                    .font(.body.weight(.semibold))
                                                    .foregroundStyle(Color.terminalText)
                                                Text([item.market, item.exchange, item.sector]
                                                    .compactMap { $0 }
                                                    .joined(separator: " · "))
                                                    .font(.caption2)
                                                    .foregroundStyle(Color.terminalMuted)
                                            }
                                            Spacer()
                                            Text(item.displaySymbol)
                                                .font(.system(.body, design: .monospaced).weight(.bold))
                                                .foregroundStyle(Color.terminalBlue)
                                        }
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 7)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("\(item.displayLabel) 선택")
                                }
                            }
                        }
                        .frame(maxHeight: 330)
                    }
                }
                .frame(width: 430)
                .background(Color.terminalPanel2)
            }
    }

    private func select(_ item: LocalSymbolSearchItem) {
        selectedSymbol = item.symbol
        searchText = item.displayLabel
        matches = []
        showingSuggestions = false
        focused = false
    }

    private func submitCurrentValue() {
        if let exact = matches.first(where: {
            $0.symbol.caseInsensitiveCompare(trimmedQuery) == .orderedSame ||
                $0.displaySymbol.caseInsensitiveCompare(trimmedQuery) == .orderedSame ||
                $0.name.caseInsensitiveCompare(trimmedQuery) == .orderedSame ||
                $0.nameKo?.caseInsensitiveCompare(trimmedQuery) == .orderedSame ||
                $0.nameEn?.caseInsensitiveCompare(trimmedQuery) == .orderedSame
        }) ?? matches.first {
            select(exact)
            onAnalyze()
            return
        }
        let manual = trimmedQuery.uppercased()
        selectedSymbol = manual.isEmpty ? "NVDA" : manual
        searchText = selectedSymbol
        showingSuggestions = false
        focused = false
        onAnalyze()
    }
}

struct FirstRunSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let openToss: () -> Void
    let openCrypto: () -> Void
    let openStrategy: () -> Void
    let openSelfTest: () -> Void
    let openDistribution: () -> Void
    @State private var isRefreshing = false

    private var setupItems: [SetupGuideItem] {
        let hasVerifiedCredential = model.brokerCredential?.status == "verified"
        let verifiedCryptoExchanges = model.cryptoExchanges
            .filter { $0.credential?.status == "verified" }
            .map { $0.exchange.uppercased() }
        let selfTestOverall = model.appSelfTest?.overall

        return [
            SetupGuideItem(
                title: "1. 엔진 시작",
                detail: model.health?.ok == true ? "Sidecar 정상 · \(model.health?.storageRoot ?? "App Support")" : model.statusLine,
                action: model.health?.ok == true ? "로컬 분석 엔진이 준비됐습니다." : "엔진 시작 후 상태 갱신을 실행하세요.",
                status: model.health?.ok == true ? "pass" : "fail"
            ),
            SetupGuideItem(
                title: "2. 분석 모드",
                detail: "\(selectedSymbol.uppercased()) · 뉴스 · 종목 민심 · 차트 · 모의투자",
                action: "API 키 없이 바로 사용할 수 있습니다. 실주문은 생성하지 않습니다.",
                status: model.health?.ok == true ? "pass" : "warn"
            ),
            SetupGuideItem(
                title: "3. Toss API 키",
                detail: hasVerifiedCredential ? "검증 완료 · 읽기 전용 계좌 기능 사용 가능" : "선택 사항 · 연결 없음",
                action: hasVerifiedCredential ? "계좌·보유·미체결 조회와 주문 사전검증을 사용할 수 있습니다." : "실계좌 조회가 필요할 때만 연결하세요.",
                status: hasVerifiedCredential ? "pass" : "optional"
            ),
            SetupGuideItem(
                title: "4. Upbit·Bithumb API 키",
                detail: verifiedCryptoExchanges.isEmpty ? "선택 사항 · 연결 없음" : "검증 완료: \(verifiedCryptoExchanges.joined(separator: ", "))",
                action: verifiedCryptoExchanges.isEmpty ? "코인 잔고·사전검증이 필요할 때 읽기 전용 점검부터 연결하세요." : "거래소별 준비 점검과 주문 사전검증을 사용할 수 있습니다.",
                status: verifiedCryptoExchanges.isEmpty ? "optional" : "pass"
            ),
            SetupGuideItem(
                title: "5. 안전 모드",
                detail: "PAPER ONLY · Toss·Upbit·Bithumb 실제 주문 차단",
                action: "1.0.0에서는 분석, 조회, 사전검증, 모의 자동화만 실행합니다.",
                status: "pass"
            ),
            SetupGuideItem(
                title: "6. 앱 점검",
                detail: model.appSelfTest.map { "통과 \($0.summary.pass) · 경고 \($0.summary.warn) · 실패 \($0.summary.fail)" } ?? "선택 사항 · 미실행",
                action: selfTestOverall == "fail" ? "실패 항목을 확인하세요." : "문제가 있을 때 앱 점검과 로그를 사용하세요.",
                status: selfTestOverall == "pass" ? "pass" : selfTestOverall == "fail" ? "fail" : "optional"
            ),
        ]
    }

    private var passCount: Int {
        setupItems.filter { $0.status == "pass" }.count
    }

    private var warningCount: Int {
        setupItems.filter { $0.status == "warn" }.count
    }

    private var failureCount: Int {
        setupItems.filter { $0.status == "fail" }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("첫 실행 설정")
                        .font(.title3.weight(.semibold))
                    Text("분석만 바로 시작하거나, 필요할 때 Toss·Upbit·Bithumb을 선택해 연결할 수 있습니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                }
                Spacer()
                Button("나중에") {
                    model.completeOnboarding()
                    dismiss()
                }
                .accessibilityLabel("나중에")
                .accessibilityIdentifier("나중에")
            }

            HStack(spacing: 8) {
                StatusPill("통과 \(passCount)", tone: .green)
                StatusPill("주의 \(warningCount)", tone: warningCount > 0 ? .amber : .green)
                StatusPill("실패 \(failureCount)", tone: failureCount > 0 ? .red : .green)
                StatusPill("종목 \(selectedSymbol.uppercased())", tone: .blue)
            }

            Text(nextActionSummary)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(setupItems) { item in
                        SetupGuideRow(item: item)
                    }
                }
            }
            .frame(maxHeight: 440)
            .padding(12)
            .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

            HStack {
                Button(model.health == nil ? "엔진 시작" : isRefreshing ? "갱신 중" : "상태 갱신") {
                    if model.health == nil {
                        model.startSidecar()
                    } else {
                        Task { await refreshSetupStatus() }
                    }
                }
                .disabled(isRefreshing)
                .accessibilityLabel(model.health == nil ? "엔진 시작" : "상태 갱신")
                .accessibilityIdentifier(model.health == nil ? "엔진 시작" : "상태 갱신")
                Button("Toss 설정") {
                    openToss()
                }
                .accessibilityLabel("Toss 설정")
                .accessibilityIdentifier("Toss 설정")
                Button("코인 설정") {
                    openCrypto()
                }
                .accessibilityLabel("코인 설정")
                .accessibilityIdentifier("코인 설정")
                Button("전략 설정") {
                    openStrategy()
                }
                .accessibilityLabel("전략 설정")
                .accessibilityIdentifier("전략 설정")
                Button("앱 점검") {
                    openSelfTest()
                }
                .accessibilityLabel("앱 점검")
                .accessibilityIdentifier("앱 점검")
                Button("배포 점검") {
                    openDistribution()
                }
                .accessibilityLabel("배포 점검")
                .accessibilityIdentifier("배포 점검")
                Spacer()
                Button("분석 모드로 시작") {
                    model.completeOnboarding()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .accessibilityLabel("분석 모드로 시작")
                .accessibilityIdentifier("분석 모드로 시작")
            }
        }
        .padding(18)
        .frame(width: 780)
        .frame(maxHeight: 720)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            if model.health?.ok == true {
                await refreshSetupStatus()
            }
        }
    }

    private var nextActionSummary: String {
        if model.health?.ok != true {
            return "먼저 엔진을 시작하세요. 분석과 뉴스·민심 기능은 엔진이 준비되면 사용할 수 있습니다."
        }
        if model.brokerCredential?.status != "verified" && model.cryptoExchanges.allSatisfy({ $0.credential?.status != "verified" }) {
            return "준비됐습니다. 분석 모드로 시작하고, 계좌 조회가 필요할 때만 Toss 또는 코인 거래소를 연결하세요."
        }
        return "선택한 API 연결 상태를 확인했습니다. 1.0.0은 연결 여부와 관계없이 실제 주문을 생성하지 않습니다."
    }

    private func refreshSetupStatus() async {
        isRefreshing = true
        defer {
            isRefreshing = false
        }
        await model.refreshHealth()
        if model.health != nil {
            await model.refreshBrokerCredential()
            await model.refreshBrokerAccounts()
            await model.refreshBrokerDiagnostics()
            await model.refreshLocalLiveTrading()
            await model.refreshKillSwitch()
            await model.refreshWorkerControl()
            await model.refreshAutomationScheduler()
            await model.refreshStrategyConfigs()
            await model.refreshCryptoExchanges()
        }
    }

}

struct SetupGuideItem: Identifiable, Equatable {
    let title: String
    let detail: String
    let action: String
    let status: String

    var id: String { title }
}

struct SetupGuideRow: View {
    let item: SetupGuideItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusPill(statusLabel, tone: statusTone)
                .frame(width: 74, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.caption.weight(.semibold))
                Text(item.detail)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.terminalText)
                    .lineLimit(2)
                    .truncationMode(.middle)
                Text(item.action)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private var statusLabel: String {
        switch item.status {
        case "pass": return "통과"
        case "warn": return "주의"
        case "fail": return "실패"
        case "optional": return "선택"
        default: return item.status
        }
    }

    private var statusTone: PillTone {
        switch item.status {
        case "pass": return .green
        case "warn": return .amber
        case "fail": return .red
        case "optional": return .blue
        default: return .blue
        }
    }
}

struct TossCredentialSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @State private var clientId = ""
    @State private var clientSecret = ""
    @State private var isSaving = false
    @State private var isRefreshing = false
    @State private var isDiagnosing = false
    @State private var isCheckingReadiness = false
    @State private var isLoadingAccounts = false
    @State private var isRestoringFromKeychain = false
    @State private var selectingAccountSeq: Int?
    @State private var copiedOperationReport = false
    @State private var showingCredentialDeleteConfirmation = false

    private var canSubmit: Bool {
        model.health?.ok == true &&
            !isSaving &&
            !clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !clientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Toss API 연결")
                        .font(.title3.weight(.semibold))
                    Text("토스증권 Open API credential은 로컬 sidecar가 검증하고 암호화 저장합니다. Swift 앱은 broker를 직접 호출하지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    HStack(spacing: 8) {
                        Button("Toss 문서") {
                            openTossDocs()
                        }
                        Button(copiedOperationReport ? "리포트 복사됨" : "운영 리포트 복사") {
                            copyOperationReport()
                        }
                        Button("닫기") {
                            dismiss()
                        }
                    }
                    if copiedOperationReport {
                        Text("민감정보 없는 Toss 운영 리포트를 클립보드에 복사했습니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalGreen)
                    }
                }
            }

            HStack(spacing: 8) {
                StatusPill(model.health?.ok == true ? "Sidecar 정상" : "Sidecar 필요", tone: model.health?.ok == true ? .green : .red)
                StatusPill(credentialStatusLabel(model.brokerCredential?.status), tone: credentialTone(model.brokerCredential?.status))
                StatusPill(model.liveGateLabel, tone: model.liveGateTone)
            }

            Text(model.brokerCredentialMessage)
                .font(.callout)
                .foregroundStyle(Color.terminalText)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            Text(model.keychainCredentialMessage)
                .font(.caption)
                .foregroundStyle(model.keychainCredentialStored ? Color.terminalGreen : Color.terminalMuted)
                .padding(.horizontal, 2)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    BrokerDiagnosticsPanel(
                        diagnostics: model.brokerDiagnostics,
                        message: model.brokerDiagnosticsMessage,
                        isLoading: isDiagnosing,
                        onRefresh: {
                            Task {
                                isDiagnosing = true
                                await model.refreshBrokerDiagnostics(includePublicIP: true)
                                isDiagnosing = false
                            }
                        }
                    )

                    TossReadinessPanel(
                        readiness: model.tossReadiness,
                        message: model.tossReadinessMessage,
                        isLoading: isCheckingReadiness,
                        onRun: {
                            Task {
                                isCheckingReadiness = true
                                await model.runTossReadiness()
                                isCheckingReadiness = false
                            }
                        }
                    )

                    LiveTradingControlPanel()

                    VStack(alignment: .leading, spacing: 9) {
                        Text("현재 등록 상태")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        if let credential = model.brokerCredential {
                            CredentialInfoRow(title: "Broker", value: credential.broker.uppercased())
                            CredentialInfoRow(title: "Client ID", value: credential.maskedIdentifier)
                            CredentialInfoRow(title: "상태", value: credentialStatusLabel(credential.status))
                            CredentialInfoRow(title: "업데이트", value: credential.updatedAt)
                        } else {
                            EmptyState("등록된 Toss API 키가 없습니다.")
                        }
                        CredentialInfoRow(title: "Keychain", value: model.keychainCredentialStored ? "보관됨" : "없음")
                    }
                    .padding(12)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Text("자동거래 계좌")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.terminalMuted)
                            Spacer()
                            Button(isLoadingAccounts ? "조회 중" : "계좌 새로고침") {
                                Task {
                                    isLoadingAccounts = true
                                    await model.refreshBrokerAccounts()
                                    isLoadingAccounts = false
                                }
                            }
                            .disabled(model.health == nil || isLoadingAccounts)
                        }
                        Text(model.brokerAccountMessage)
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                            .fixedSize(horizontal: false, vertical: true)
                        if model.brokerAccounts.isEmpty {
                            EmptyState("검증 완료된 Toss API 키가 있으면 계좌가 여기에 표시됩니다.")
                        } else {
                            ForEach(model.brokerAccounts) { account in
                                let selected = model.brokerAccountPreference?.accountSeq == account.accountSeq
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text(account.accountNo)
                                                .font(.system(.body, design: .monospaced).weight(.semibold))
                                            if selected {
                                                StatusPill("자동거래 사용", tone: .green)
                                            }
                                        }
                                        Text("#\(account.accountSeq)")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(Color.terminalMuted)
                                    }
                                    Spacer()
                                    StatusPill(account.accountType, tone: .blue)
                                    Button(selectingAccountSeq == account.accountSeq ? "선택 중" : selected ? "선택됨" : "이 계좌 사용") {
                                        Task {
                                            selectingAccountSeq = account.accountSeq
                                            await model.selectBrokerAccount(account)
                                            selectingAccountSeq = nil
                                        }
                                    }
                                    .disabled(selected || selectingAccountSeq != nil || account.accountType != "BROKERAGE")
                                }
                                .padding(.vertical, 5)
                            }
                        }
                    }
                    .padding(12)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                TextField("Client ID", text: $clientId)
                    .textFieldStyle(.roundedBorder)
                SecureField("Client Secret", text: $clientSecret)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button(isRefreshing ? "조회 중" : "상태 새로고침") {
                        Task {
                            isRefreshing = true
                            await model.refreshBrokerCredential()
                            await model.refreshBrokerAccounts()
                            await model.refreshBrokerDiagnostics()
                            await model.runTossReadiness()
                            await model.refreshLocalLiveTrading()
                            isRefreshing = false
                        }
                    }
                    .disabled(model.health == nil || isRefreshing)

                    Button(isRestoringFromKeychain ? "복구 중" : "Keychain에서 복구") {
                        Task {
                            isRestoringFromKeychain = true
                            await model.restoreBrokerCredentialFromKeychain()
                            isRestoringFromKeychain = false
                        }
                    }
                    .disabled(model.health == nil || isRestoringFromKeychain || !model.keychainCredentialStored)

                    Button(isSaving ? "검증 중" : "검증 후 저장") {
                        Task {
                            isSaving = true
                            _ = await model.registerBrokerCredential(clientId: clientId, clientSecret: clientSecret)
                            isSaving = false
                            clientSecret = ""
                        }
                    }
                    .disabled(!canSubmit)

                    Spacer()

                    Button("삭제", role: .destructive) {
                        showingCredentialDeleteConfirmation = true
                    }
                    .disabled(model.health == nil || model.brokerCredential == nil)
                }
            }
            .padding(12)
            .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
        }
        .padding(18)
        .frame(width: 640)
        .frame(maxHeight: 820)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            if model.health?.ok == true {
                await model.refreshBrokerCredential()
                await model.refreshBrokerAccounts()
                await model.refreshBrokerDiagnostics()
                await model.runTossReadiness()
                await model.refreshLocalLiveTrading()
            }
        }
        .confirmationDialog(
            "Toss API 키 삭제",
            isPresented: $showingCredentialDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Toss API 키 삭제", role: .destructive) {
                Task {
                    await model.deleteBrokerCredential()
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("sidecar 암호화 저장소와 macOS Keychain 백업에서 Toss credential을 삭제합니다. 삭제 후 계좌·보유·미체결 조회와 자동화 계좌 선택을 다시 설정해야 합니다.")
        }
    }

    private func credentialStatusLabel(_ status: String?) -> String {
        switch status {
        case "verified": return "검증 완료"
        case "pending": return "검증 대기"
        case "failed": return "검증 실패"
        case .some(let value): return value
        case .none: return "미등록"
        }
    }

    private func credentialTone(_ status: String?) -> PillTone {
        switch status {
        case "verified": return .green
        case "pending": return .amber
        case "failed": return .red
        default: return .muted
        }
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

    private func openTossDocs() {
        if let url = URL(string: "https://developers.tossinvest.com/docs") {
            NSWorkspace.shared.open(url)
        }
    }
}

struct LiveTradingControlPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("실거래 게이트")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.terminalMuted)
                Spacer()
                Button("상태 갱신") {
                    Task {
                        await model.refreshLocalLiveTrading()
                        await model.refreshBrokerDiagnostics()
                    }
                }
                .disabled(model.health == nil)
            }

            HStack(spacing: 8) {
                StatusPill("PAPER ONLY", tone: .green)
                StatusPill(model.brokerCredential?.status == "verified" ? "Toss 조회 연결" : "Toss 미연결", tone: model.brokerCredential?.status == "verified" ? .green : .muted)
                StatusPill(model.localLiveTrading?.localRuntime == true ? "로컬 sidecar" : "런타임 미확인", tone: model.localLiveTrading?.localRuntime == true ? .green : .amber)
                StatusPill(model.localLiveTrading?.effective == true ? "수동 지정가 가능" : "수동 실주문 차단", tone: model.localLiveTrading?.effective == true ? .green : .red)
            }

            Text("Toss 실거래는 단일 Mac·선택 계좌의 QA와 수동 토글을 통과한 KR/US 지정가만 지원합니다. 자동화와 코인은 별도 정책이 열리기 전 paper 전용입니다.")
                .font(.caption)
                .foregroundStyle(Color.terminalText)
                .fixedSize(horizontal: false, vertical: true)
            Text(model.localLiveTradingMessage)
                .font(.caption2)
                .foregroundStyle(Color.terminalMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }
}

struct TossReadinessPanel: View {
    let readiness: TossReadinessResponse?
    let message: String
    let isLoading: Bool
    let onRun: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Toss 운영 준비")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.terminalMuted)
                Spacer()
                Button(isLoading ? "점검 중" : "운영 준비 점검") {
                    onRun()
                }
                .disabled(isLoading)
            }

            Text(message)
                .font(.caption)
                .foregroundStyle(Color.terminalText)
                .fixedSize(horizontal: false, vertical: true)

            if let readiness {
                HStack(spacing: 8) {
                    StatusPill(readiness.ok ? "자동거래 준비" : readinessStatusLabel(readiness.status), tone: readiness.ok ? .green : readinessTone(readiness.status))
                    StatusPill(readiness.orderSubmissionAttempted ? "주문 호출 감지" : "주문 호출 없음", tone: readiness.orderSubmissionAttempted ? .red : .green)
                    StatusPill(readiness.accountHeaderVerified ? "계좌 헤더 확인" : "계좌 헤더 미확인", tone: readiness.accountHeaderVerified ? .green : .amber)
                    StatusPill(readiness.automationAccountSelected == true ? "자동거래 계좌 선택" : "계좌 선택 필요", tone: readiness.automationAccountSelected == true ? .green : .red)
                }

                VStack(alignment: .leading, spacing: 7) {
                    ReadinessCheckRow(title: "OAuth 토큰", passed: readiness.readonlyChecks.token)
                    ReadinessCheckRow(title: "계좌 목록", passed: readiness.readonlyChecks.accounts)
                    ReadinessCheckRow(title: "보유 조회", passed: readiness.readonlyChecks.holdings)
                    ReadinessCheckRow(title: "미체결 조회", passed: readiness.readonlyChecks.openOrders)
                    CredentialInfoRow(title: "Client ID", value: readiness.credentials.clientIdMasked ?? (readiness.credentials.present ? "등록됨" : "없음"))
                    if let account = readiness.selectedAccount {
                        CredentialInfoRow(title: "점검 계좌", value: "#\(account.accountSeq) \(account.accountNoMasked) \(account.accountType)")
                    }
                    CredentialInfoRow(title: "마지막 점검", value: readiness.checkedAt)
                    if let toss = readiness.toss {
                        CredentialInfoRow(title: "Toss 오류", value: [toss.code, toss.requestId].compactMap { $0 }.joined(separator: " · "))
                    }
                }

                if !readiness.guidance.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(readiness.guidance.prefix(4), id: \.self) { entry in
                            Text("· \(entry)")
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else {
                EmptyState("저장된 Toss API 키로 read-only 운영 준비 점검을 실행할 수 있습니다. 주문 생성, 정정, 취소 API는 호출하지 않습니다.")
            }
        }
        .padding(12)
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }

    private func readinessStatusLabel(_ status: String) -> String {
        switch status {
        case "credential-missing": return "credential 필요"
        case "account-ready": return "조회 준비"
        case "account-selection-required": return "계좌 선택 필요"
        case "account-missing": return "계좌 없음"
        case "api-error": return "Toss 오류"
        case "invalid-env": return "환경값 오류"
        default: return status
        }
    }

    private func readinessTone(_ status: String) -> PillTone {
        switch status {
        case "account-ready": return .green
        case "credential-missing", "account-selection-required", "account-missing", "invalid-env": return .amber
        case "api-error", "unexpected-error": return .red
        default: return .muted
        }
    }
}

struct ReadinessCheckRow: View {
    let title: String
    let passed: Bool

    var body: some View {
        HStack(spacing: 8) {
            StatusPill(passed ? "통과" : "대기", tone: passed ? .green : .muted)
            Text(title)
                .font(.caption)
            Spacer()
        }
    }
}

struct BrokerDiagnosticsPanel: View {
    let diagnostics: BrokerDiagnosticsResponse?
    let message: String
    let isLoading: Bool
    let onRefresh: () -> Void
    @State private var copiedPublicIP: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Toss 연결 진단")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.terminalMuted)
                Spacer()
                Button(isLoading ? "확인 중" : "공인 IP 확인") {
                    onRefresh()
                }
                .disabled(isLoading)
            }

            Text(message)
                .font(.caption)
                .foregroundStyle(Color.terminalText)
                .fixedSize(horizontal: false, vertical: true)

            if let diagnostics {
                HStack(spacing: 8) {
                    StatusPill(egressStatusLabel(diagnostics.egress.status), tone: egressTone(diagnostics.egress.status))
                    StatusPill(diagnostics.liveGate.liveTradingEffective ? "Live 제출 가능" : "Live 제출 차단", tone: diagnostics.liveGate.liveTradingEffective ? .green : .red)
                    StatusPill(diagnostics.liveGate.automationQueueReady ? "자동화 큐 가능" : "자동화 큐 차단", tone: diagnostics.liveGate.automationQueueReady ? .green : .red)
                    StatusPill(diagnostics.liveGate.credentialEncryptionConfigured ? "암호화 OK" : "암호화 필요", tone: diagnostics.liveGate.credentialEncryptionConfigured ? .green : .red)
                }
                HStack(spacing: 8) {
                    StatusPill(diagnostics.liveGate.killSwitchEngaged ? "긴급 중지 ON" : "긴급 중지 OFF", tone: diagnostics.liveGate.killSwitchEngaged ? .red : .green)
                    StatusPill(diagnostics.liveGate.workerPaused ? "워커 일시중지" : "워커 감시", tone: diagnostics.liveGate.workerPaused ? .amber : .green)
                    StatusPill(diagnostics.liveGate.accountPreferenceSelected ? "계좌 선택됨" : "계좌 필요", tone: diagnostics.liveGate.accountPreferenceSelected ? .green : .red)
                }

                VStack(alignment: .leading, spacing: 7) {
                    if let publicIP = diagnostics.egress.ip {
                        HStack(spacing: 8) {
                            Text("공인 IP")
                                .font(.caption)
                                .foregroundStyle(Color.terminalMuted)
                            Spacer()
                            Text(publicIP)
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(1)
                                .textSelection(.enabled)
                            Button(copiedPublicIP == publicIP ? "복사됨" : "IP 복사") {
                                copyPublicIP(publicIP)
                            }
                        }
                        Text(copiedPublicIP == publicIP
                            ? "복사한 IP를 Toss 개발자 콘솔의 Open API 허용 IP에 붙여넣으세요."
                            : "Toss에서 IP address not allowed가 나오면 이 공인 IP를 허용 IP에 등록하세요.")
                            .font(.caption2)
                            .foregroundStyle(copiedPublicIP == publicIP ? Color.terminalGreen : Color.terminalMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        CredentialInfoRow(title: "공인 IP", value: diagnostics.egress.status == "not-requested" ? "미조회" : "확인 안 됨")
                        if diagnostics.egress.status == "not-requested" {
                            Text("공인 IP는 자동 조회하지 않습니다. 버튼을 누르면 외부 IP 확인 서비스로 현재 공인 IP를 조회합니다.")
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    CredentialInfoRow(title: "IP 확인", value: diagnostics.egress.message)
                    CredentialInfoRow(title: "저장소", value: diagnostics.liveGate.storageRoot ?? "앱 로컬 저장소")
                    CredentialInfoRow(title: "사용자", value: diagnostics.userId)
                    CredentialInfoRow(title: "Readiness", value: diagnostics.liveGate.readinessOverall)
                    CredentialInfoRow(title: "Gate 사유", value: diagnostics.liveGate.gateReason ?? "차단 사유 없음")
                    CredentialInfoRow(title: "긴급 중지", value: diagnostics.liveGate.killSwitchReason ?? (diagnostics.liveGate.killSwitchEngaged ? "활성" : "해제"))
                    CredentialInfoRow(title: "워커", value: diagnostics.liveGate.workerPauseReason ?? (diagnostics.liveGate.workerPaused ? "일시중지" : "감시 중"))
                }

                Divider().overlay(Color.terminalLine)

                VStack(alignment: .leading, spacing: 7) {
                    ForEach(diagnostics.readinessItems.prefix(6)) { item in
                        DiagnosticsItemRow(item: item)
                    }
                }

                if !diagnostics.guidance.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(diagnostics.guidance, id: \.self) { entry in
                            Text("· \(entry)")
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else {
                EmptyState("공인 IP 확인을 누르면 외부 IP 확인 서비스로 현재 공인 IP를 조회하고 Toss 허용 IP 안내를 표시합니다.")
            }
        }
        .padding(12)
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }

    private func copyPublicIP(_ publicIP: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(publicIP, forType: .string)
        copiedPublicIP = publicIP
    }

    private func egressStatusLabel(_ status: String) -> String {
        switch status {
        case "checked": return "IP 확인"
        case "not-requested": return "IP 미조회"
        case "skipped": return "IP 스킵"
        case "unavailable": return "IP 실패"
        default: return status
        }
    }

    private func egressTone(_ status: String) -> PillTone {
        switch status {
        case "checked": return .green
        case "not-requested": return .muted
        case "skipped": return .amber
        case "unavailable": return .red
        default: return .muted
        }
    }
}

struct DiagnosticsItemRow: View {
    let item: BrokerDiagnosticsItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                StatusPill(statusLabel(item.status), tone: statusTone(item.status))
                Text(item.label)
                    .font(.caption.weight(.semibold))
                Spacer()
                if item.blocking && item.status != "pass" {
                    StatusPill("차단", tone: .red)
                } else if item.blocking {
                    StatusPill("필수", tone: .muted)
                }
            }
            Text(item.summary)
                .font(.caption2)
                .foregroundStyle(Color.terminalMuted)
                .fixedSize(horizontal: false, vertical: true)
            if item.status != "pass" {
                Text(item.action)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalAmber)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "pass": return "통과"
        case "warn": return "주의"
        case "fail": return "실패"
        default: return status
        }
    }

    private func statusTone(_ status: String) -> PillTone {
        switch status {
        case "pass": return .green
        case "warn": return .amber
        case "fail": return .red
        default: return .muted
        }
    }
}

struct CredentialInfoRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct SidecarLogSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Sidecar 로그")
                        .font(.title3.weight(.semibold))
                    Text("로컬 엔진 시작, health check, API 오류를 앱 안에서 바로 확인합니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                }
                Spacer()
                Button("닫기") {
                    dismiss()
                }
            }

            HStack(spacing: 8) {
                StatusPill(model.health?.ok == true ? "Sidecar 정상" : "Sidecar 오프라인", tone: model.health?.ok == true ? .green : .red)
                StatusPill(model.sidecarLogMessage, tone: .blue)
            }

            ScrollView {
                Text(model.sidecarLogText.isEmpty ? "로그가 비어 있습니다." : model.sidecarLogText)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .frame(minHeight: 360)
            .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

            HStack {
                Button("새로고침") {
                    model.refreshSidecarLogTail()
                }
                Button("파일 열기") {
                    model.openSidecarLog()
                }
                Button("Finder에서 보기") {
                    model.revealSidecarLog()
                }
                Spacer()
                Text(model.store.sidecarLogURL.path(percentEncoded: false))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.terminalMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(18)
        .frame(width: 780, height: 560)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            model.refreshSidecarLogTail()
        }
    }
}

struct AppSelfTestSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let openSidecarLog: () -> Void
    @State private var isRunning = false
    @State private var copiedSelfTestReport = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("앱 점검")
                        .font(.title3.weight(.semibold))
                    Text("핵심 버튼 경로를 주문 제출 없이 점검합니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    HStack(spacing: 8) {
                        Button(copiedSelfTestReport ? "리포트 복사됨" : "점검 리포트 복사") {
                            copySelfTestReport()
                        }
                        .disabled(model.appSelfTest == nil)
                        Button("닫기") {
                            dismiss()
                        }
                    }
                    if copiedSelfTestReport {
                        Text("앱 점검 리포트를 클립보드에 복사했습니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalGreen)
                    }
                }
            }

            HStack(spacing: 8) {
                StatusPill(model.health?.ok == true ? "Sidecar 정상" : "Sidecar 오프라인", tone: model.health?.ok == true ? .green : .red)
                if let selfTest = model.appSelfTest {
                    StatusPill(overallLabel(selfTest.overall), tone: overallTone(selfTest.overall))
                    StatusPill("통과 \(selfTest.summary.pass)", tone: .green)
                    StatusPill("경고 \(selfTest.summary.warn)", tone: selfTest.summary.warn > 0 ? .amber : .green)
                    StatusPill("실패 \(selfTest.summary.fail)", tone: selfTest.summary.fail > 0 ? .red : .green)
                } else {
                    StatusPill("점검 전", tone: .amber)
                }
            }

            Text(model.appSelfTestMessage)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            if let selfTest = model.appSelfTest {
                AppSelfTestAttentionSummary(checks: selfTest.checks)

                VStack(alignment: .leading, spacing: 9) {
                    Text("점검 항목")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(selfTest.checks) { check in
                                AppSelfTestCheckRow(check: check)
                            }
                        }
                    }
                    .frame(maxHeight: 420)
                }
                .padding(12)
                .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                VStack(alignment: .leading, spacing: 7) {
                    CredentialInfoRow(title: "생성 시각", value: selfTest.generatedAt)
                    CredentialInfoRow(title: "차단 실패", value: "\(selfTest.summary.blockingFailures)")
                    CredentialInfoRow(title: "총 항목", value: "\(selfTest.summary.total)")
                }
                .padding(12)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
            } else {
                EmptyState(model.health == nil ? "sidecar를 시작한 뒤 점검을 실행하세요." : "점검 실행 버튼을 누르면 결과가 표시됩니다.")
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
            }

            HStack {
                Button(model.health == nil ? "엔진 시작" : isRunning ? "점검 중" : "점검 실행") {
                    if model.health == nil {
                        model.startSidecar()
                    } else {
                        Task { await runSelfTest() }
                    }
                }
                .disabled(isRunning)
                Button("상태 갱신") {
                    Task {
                        await model.refreshHealth()
                    }
                }
                .disabled(isRunning)
                Spacer()
                Button("로그 열기") {
                    openSidecarLog()
                }
            }
        }
        .padding(18)
        .frame(width: 760)
        .frame(maxHeight: 720)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            if model.health?.ok == true, model.appSelfTest == nil {
                await runSelfTest()
            }
        }
    }

    private func runSelfTest() async {
        isRunning = true
        defer {
            isRunning = false
        }
        await model.runAppSelfTest()
        copiedSelfTestReport = false
    }

    private func copySelfTestReport() {
        let report = AppSelfTestReport.make(from: AppSelfTestReportInput(
            sidecarOK: model.health?.ok == true,
            selfTest: model.appSelfTest,
            liveGateState: model.liveGateLabel,
            killSwitchEngaged: model.killSwitchEngaged,
            workerPaused: model.workerPausedEffective,
            releaseReadiness: model.releaseManifestSummary()?.readinessLabel
        ))
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
        copiedSelfTestReport = true
    }

    private func overallLabel(_ status: String) -> String {
        switch status {
        case "pass": return "전체 통과"
        case "warn": return "확인 필요"
        case "fail": return "실패"
        default: return status
        }
    }

    private func overallTone(_ status: String) -> PillTone {
        switch status {
        case "pass": return .green
        case "warn": return .amber
        case "fail": return .red
        default: return .blue
        }
    }
}

struct AppSelfTestAttentionSummary: View {
    let checks: [LocalSelfTestCheck]

    private var attentionChecks: [LocalSelfTestCheck] {
        checks.filter { $0.status != "pass" }
    }

    var body: some View {
        if attentionChecks.isEmpty {
            HStack(spacing: 8) {
                StatusPill("전체 통과", tone: .green)
                Text("핵심 버튼 경로에서 추가 조치가 필요한 항목이 없습니다.")
                    .font(.caption)
                    .foregroundStyle(Color.terminalText)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.terminalGreen.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalGreen.opacity(0.22)))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    StatusPill("조치 필요 \(attentionChecks.count)", tone: attentionChecks.contains { $0.status == "fail" } ? .red : .amber)
                    Text("먼저 확인할 점검 항목")
                        .font(.caption.weight(.semibold))
                }
                ForEach(attentionChecks.prefix(3)) { check in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(statusLabel(check.status)) · \(check.label)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(check.status == "fail" ? Color.terminalRed : Color.terminalAmber)
                        Text(check.summary)
                            .font(.caption)
                            .foregroundStyle(Color.terminalText)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(check.action)
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.terminalAmber.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalAmber.opacity(0.24)))
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "warn": return "경고"
        case "fail": return "실패"
        default: return status
        }
    }
}

struct AppSelfTestCheckRow: View {
    let check: LocalSelfTestCheck

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusPill(statusLabel(check.status), tone: statusTone(check.status))
                .frame(width: 74, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(check.label)
                        .font(.caption.weight(.semibold))
                    StatusPill(check.blocking ? "핵심" : "운영", tone: check.blocking ? .blue : .amber)
                }
                Text(check.summary)
                    .font(.caption)
                    .foregroundStyle(Color.terminalText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(check.action)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text("\(check.durationMs)ms")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "pass": return "통과"
        case "warn": return "경고"
        case "fail": return "실패"
        default: return status
        }
    }

    private func statusTone(_ status: String) -> PillTone {
        switch status {
        case "pass": return .green
        case "warn": return .amber
        case "fail": return .red
        default: return .blue
        }
    }
}

struct DistributionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @State private var artifacts = [
        ReleaseArtifactInfo(title: "DMG 설치 파일", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "ZIP 백업 파일", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "릴리즈 명세", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "설치 안내", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "통합 릴리즈 인덱스", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "배포 게이트 검증", detail: "패키징 정보 미포함", exists: false, url: nil),
        ReleaseArtifactInfo(title: "DMG 설치본 검증", detail: "패키징 정보 미포함", exists: false, url: nil),
    ]
    @State private var manifest: ReleaseManifestSummary?
    @State private var handoffEntries: [ReleaseHandoffEntryInfo] = []
    @State private var releaseCheck: MacReleaseCheckSummary?
    @State private var installVerification: DmgInstallVerificationSummary?
    @State private var didReadReleaseState = false
    @State private var isReadingReleaseState = false
    @State private var isRefreshingInstallReadiness = false
    @State private var copiedInstallReport = false
    @State private var releaseMessage = "번들 상태 읽기를 누르면 앱 내부 release-status.json만 확인합니다."

    private var hasDmg: Bool {
        artifacts.contains { $0.title == "DMG 설치 파일" && $0.exists }
    }

    private var installChecks: [InstallChecklistItem] {
        let appPath = Bundle.main.bundleURL.path(percentEncoded: false)
        let inApplications = appPath == "/Applications/StockAnalysis.app" || appPath.hasPrefix("/Applications/")
        let storagePath = model.health?.storageRoot ?? model.store.sidecarStorageRoot.path(percentEncoded: false)
        let appSupportReady = storagePath.contains("/Library/Application Support/")
        let releaseReady = releaseCheck?.readyForExternalDistribution == true || manifest?.readyForExternalDistribution == true
        let minimumMacOS = manifest?.minimumMacOS ?? "14.0"
        let macOSSupported = currentMacOSMeets(minimumMacOS)
        let supportedArchitectures = effectiveSupportedArchitectures
        let architectureSupported = supportedArchitectures.contains(currentArchitecture) || supportedArchitectures.contains("universal")
        let egressStatus = model.brokerDiagnostics?.egress.status
        let egressIp = model.brokerDiagnostics?.egress.ip
        let egressDisplay = publicIpDisplay(for: egressStatus)
        let selfTestOverall = model.appSelfTest?.overall
        let selfTestFailures = model.appSelfTest?.summary.blockingFailures ?? 0
        let handoffReady = !handoffEntries.isEmpty && handoffEntries.allSatisfy(\.hasRequiredFiles)
        let handoffChecksumFailed = handoffEntries.contains { $0.hasChecksumMismatch }
        let handoffSummary = handoffEntries.isEmpty
            ? "release-index 없음"
            : handoffEntries.map { "\($0.arch): \($0.handoffStatusLabel)" }.joined(separator: " · ")

        return [
            InstallChecklistItem(
                title: "앱 위치",
                detail: appPath,
                action: inApplications ? "Applications에서 실행 중입니다." : "DMG에서 Applications로 옮긴 뒤 실행하면 새 Mac에서 경로가 안정적입니다.",
                status: inApplications ? "pass" : "warn"
            ),
            InstallChecklistItem(
                title: "macOS 호환성",
                detail: "현재 \(currentMacOSVersion) · 최소 \(minimumMacOS)",
                action: macOSSupported ? "이 Mac의 macOS 버전은 앱 최소 요구사항을 충족합니다." : "이 앱은 macOS \(minimumMacOS) 이상에서 실행하도록 빌드됐습니다.",
                status: macOSSupported ? "pass" : "fail"
            ),
            InstallChecklistItem(
                title: "CPU 아키텍처",
                detail: "현재 \(currentArchitecture) · 지원 \(supportedArchitectures.joined(separator: " / "))",
                action: architectureSupported ? "이 Mac의 CPU 아키텍처가 릴리즈 대상에 포함됩니다." : "이 Mac을 지원하려면 해당 아키텍처용 DMG 또는 universal 빌드가 필요합니다.",
                status: architectureSupported ? "pass" : "fail"
            ),
            InstallChecklistItem(
                title: "번들 sidecar",
                detail: model.health?.workingDirectory ?? "sidecar 상태 미확인",
                action: model.health?.ok == true ? "앱 내부 엔진이 응답 중입니다." : "엔진 시작 또는 상태 갱신을 실행하세요.",
                status: model.health?.ok == true ? "pass" : "fail"
            ),
            InstallChecklistItem(
                title: "패키징 검증",
                detail: manifest?.sidecarVerificationLabel ?? "릴리즈 명세 미확인",
                action: manifest?.sidecarVerified == true ? "패키징 시 번들 Node와 local-engine health check가 통과했습니다." : "npm run mac:package로 sidecar health check를 통과한 릴리즈를 다시 생성하세요.",
                status: manifest?.sidecarVerified == true ? "pass" : manifest?.sidecarVerified == false ? "fail" : "warn"
            ),
            InstallChecklistItem(
                title: "DMG 설치본 검증",
                detail: installVerification?.detail ?? "install-verification 리포트 없음",
                action: installVerification?.sidecarVerified == true ? "DMG에서 복사한 앱이 bundled Node, 순환분할 전략 lifecycle, Toss 안전 endpoint, 앱 실행, UI 버튼 검증을 통과했습니다." : "npm run mac:package:all을 다시 실행해 DMG 복사본 검증 리포트를 생성하세요.",
                status: installVerification == nil ? "warn" : installVerification?.sidecarVerified == true ? "pass" : "fail"
            ),
            InstallChecklistItem(
                title: "대상 Mac별 DMG",
                detail: handoffSummary,
                action: handoffReady ? "Apple Silicon/Intel 대상 파일과 SHA-256 검증이 모두 준비됐습니다. 받을 Mac CPU에 맞는 DMG를 전달하세요." : "arm64와 x64 패키지를 모두 생성한 뒤 파일 존재와 SHA-256 일치 여부를 확인하세요.",
                status: handoffReady ? "pass" : handoffChecksumFailed ? "fail" : "warn"
            ),
            InstallChecklistItem(
                title: "App Support 저장소",
                detail: storagePath,
                action: appSupportReady ? "설정, 뉴스, paper state, 전략을 앱 로컬 저장소에 기록합니다." : "repo .cache가 아니라 App Support 저장소로 실행되어야 합니다.",
                status: appSupportReady ? "pass" : "warn"
            ),
            InstallChecklistItem(
                title: "배포 서명",
                detail: manifest?.developerSigningLabel ?? "릴리즈 명세 미확인",
                action: releaseReady ? "Gatekeeper 배포 조건을 충족했습니다." : "다른 Mac 무경고 배포에는 Developer ID 서명과 Apple 공증이 필요합니다.",
                status: releaseReady ? "pass" : "warn"
            ),
            InstallChecklistItem(
                title: "DMG Gatekeeper",
                detail: releaseCheck?.detail ?? "release-check 리포트 없음",
                action: releaseCheck?.readyForExternalDistribution == true ? "실제 DMG가 stapler와 Gatekeeper 평가를 통과했습니다." : "무경고 외부 배포 전 release-check의 staplerValidated/gatekeeperAccepted 증거가 필요합니다.",
                status: releaseCheck == nil ? "warn" : releaseCheck?.ok == false ? "fail" : releaseCheck?.readyForExternalDistribution == true ? "pass" : "warn"
            ),
            InstallChecklistItem(
                title: "Toss API 키",
                detail: model.brokerCredential == nil ? "등록 없음" : "상태 \(model.brokerCredential?.status ?? "-")",
                action: model.brokerCredential?.status == "verified" ? "검증 완료된 키가 sidecar 저장소와 Keychain 상태로 관리됩니다." : "새 Mac에서는 Toss 시트에서 API 키를 다시 검증해 저장하세요.",
                status: model.brokerCredential?.status == "verified" ? "pass" : "warn"
            ),
            InstallChecklistItem(
                title: "자동거래 계좌",
                detail: model.brokerAccountPreference.map { "#\($0.accountSeq) \($0.accountNo)" } ?? "선택 없음",
                action: model.brokerAccountPreference == nil ? "검증 완료 후 자동거래에 사용할 BROKERAGE 계좌를 선택하세요." : "OrderIntent/RiskCheck가 사용할 계좌가 선택되어 있습니다.",
                status: model.brokerAccountPreference == nil ? "warn" : "pass"
            ),
            InstallChecklistItem(
                title: "Toss 허용 IP",
                detail: egressIp ?? egressDisplay.detail,
                action: egressIp == nil ? egressDisplay.action : "표시된 공인 IP가 Toss 개발자 콘솔 허용 IP에 등록되어야 합니다.",
                status: egressIp == nil ? "warn" : "pass"
            ),
            InstallChecklistItem(
                title: "주문 모드",
                detail: model.liveGateLabel,
                action: "1.0.0 데스크톱은 조회·사전검증·paper 자동화만 지원하며 실제 주문 제출은 항상 차단합니다.",
                status: "pass"
            ),
            InstallChecklistItem(
                title: "자동화 안전 상태",
                detail: "긴급 중지 \(model.killSwitchEngaged ? "ON" : "OFF") · 워커 \(model.workerPausedEffective ? "일시중지" : "감시")",
                action: model.killSwitchEngaged || model.workerPausedEffective ? "자동화 실행 전 차단 상태를 의도적으로 유지할지 확인하세요." : "자동화 큐를 막는 로컬 안전 차단은 없습니다.",
                status: model.killSwitchEngaged ? "fail" : model.workerPausedEffective ? "warn" : "pass"
            ),
            InstallChecklistItem(
                title: "앱 점검",
                detail: model.appSelfTest.map { "통과 \($0.summary.pass) · 경고 \($0.summary.warn) · 실패 \($0.summary.fail)" } ?? "미실행",
                action: selfTestOverall == nil ? "설치 후 점검을 실행하세요." : selfTestFailures > 0 ? "핵심 실패 항목을 먼저 해결하세요." : "핵심 버튼 경로 점검이 완료됐습니다.",
                status: selfTestOverall == "fail" ? "fail" : selfTestOverall == "pass" ? "pass" : "warn"
            ),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("앱 배포")
                        .font(.title3.weight(.semibold))
                    Text("다른 Mac에는 DMG 또는 ZIP 아티팩트를 전달합니다. Toss 키, 자동거래 계좌, 허용 IP는 Mac마다 다시 확인해야 합니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button("닫기") {
                    dismiss()
                }
            }

            HStack(spacing: 8) {
                StatusPill(manifest?.readinessDisplayLabel ?? (didReadReleaseState ? "배포 준비도 없음" : "배포 미확인"), tone: manifest?.readinessTone ?? .amber)
                StatusPill(dmgStatusLabel, tone: didReadReleaseState ? (hasDmg ? .green : .red) : .amber)
                StatusPill(handoffStatusLabel, tone: handoffStatusTone)
                StatusPill(installVerification?.displayLabel ?? (didReadReleaseState ? "설치본 검증 없음" : "설치본 미확인"), tone: installVerification?.tone ?? .amber)
                StatusPill(releaseCheck?.displayLabel ?? (didReadReleaseState ? "배포 게이트 없음" : "배포 게이트 미확인"), tone: releaseCheck?.tone ?? .amber)
                StatusPill(manifestStatusLabel, tone: didReadReleaseState ? (manifest == nil ? .red : .blue) : .amber)
                StatusPill(manifest?.notarizationLabel ?? (didReadReleaseState ? "공증 정보 없음" : "공증 미확인"), tone: manifest?.notarizationTone ?? .amber)
            }

            Text(releaseMessage)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {

                VStack(alignment: .leading, spacing: 9) {
                    Text("릴리즈 아티팩트")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    ForEach(artifacts) { artifact in
                        ReleaseArtifactRow(
                            artifact: artifact,
                            didReadReleaseState: didReadReleaseState,
                            onReveal: {
                                model.revealReleaseArtifact(artifact)
                            }
                        )
                    }
                }
                .padding(12)
                .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Text("Mac별 전달 파일")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        Spacer()
                        Text("대상 CPU에 맞는 DMG를 전달")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                    }
                    if handoffEntries.isEmpty {
                        EmptyState(didReadReleaseState ? "통합 릴리즈 인덱스가 없으면 arm64/x64 전달 상태를 표시할 수 없습니다." : "번들 상태 읽기 후 표시됩니다.")
                    } else {
                        ForEach(handoffEntries) { entry in
                            ReleaseHandoffEntryRow(entry: entry)
                        }
                    }
                }
                .padding(12)
                .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                VStack(alignment: .leading, spacing: 9) {
                    Text("현재 앱")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    CredentialInfoRow(title: "Bundle", value: Bundle.main.bundleURL.path(percentEncoded: false))
                    CredentialInfoRow(title: "Sidecar", value: model.health?.ok == true ? "정상" : model.statusLine)
                    CredentialInfoRow(title: "Live gate", value: model.liveGateLabel)
                }
                .padding(12)
                .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                if let manifest {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("릴리즈 명세")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        CredentialInfoRow(title: "파일", value: manifest.fileName)
                        CredentialInfoRow(title: "빌드", value: manifest.builtAt)
                        CredentialInfoRow(title: "서명", value: manifest.signingIdentity)
                        CredentialInfoRow(title: "서명 유형", value: manifest.developerSigningLabel)
                        CredentialInfoRow(title: "아키텍처", value: manifest.arch)
                        CredentialInfoRow(title: "지원 아키텍처", value: releaseSupportedArchitectureLabel)
                        CredentialInfoRow(title: "최소 macOS", value: manifest.minimumMacOSLabel)
                        CredentialInfoRow(title: "번들 Node", value: manifest.bundledNodeLabel)
                        CredentialInfoRow(title: "Sidecar 검증", value: manifest.sidecarVerificationLabel)
                        CredentialInfoRow(title: "공증", value: manifest.notarizationLabel)
                        CredentialInfoRow(title: "Gatekeeper 리스크", value: manifest.gatekeeperLabel)
                    }
                    .padding(12)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                } else {
                    EmptyState(didReadReleaseState ? "npm run mac:package 결과가 있으면 릴리즈 명세가 표시됩니다." : "번들 상태 읽기 전에는 manifest를 조회하지 않습니다.")
                        .padding(12)
                        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                }

                if let releaseCheck {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("배포 게이트 검증")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        HStack(spacing: 8) {
                            StatusPill(releaseCheck.displayLabel, tone: releaseCheck.tone)
                            StatusPill("stapler \(releaseCheck.staplerPassed)/\(releaseCheck.dmgFiles.count)", tone: releaseCheck.readyForExternalDistribution ? .green : .amber)
                            StatusPill("Gatekeeper \(releaseCheck.gatekeeperPassed)/\(releaseCheck.dmgFiles.count)", tone: releaseCheck.readyForExternalDistribution ? .green : .amber)
                            StatusPill("SHA \(releaseCheck.checksumPassed)/\(releaseCheck.files.count)", tone: releaseCheck.ok ? .green : .red)
                            StatusPill("Gatekeeper 리스크 \(releaseCheck.gatekeeperLabel)", tone: releaseCheck.gatekeeperRisk == "low" ? .green : .red)
                        }
                        CredentialInfoRow(title: "파일", value: releaseCheck.fileName)
                        CredentialInfoRow(title: "상태", value: "\(releaseCheck.label) · \(releaseCheck.status)")
                        ForEach(releaseCheck.files) { file in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    StatusPill(file.shaLabel, tone: file.sha256Matches == true ? .green : file.sha256Matches == false ? .red : .amber)
                                    if file.kind == "dmg" {
                                        StatusPill(file.staplerLabel, tone: file.staplerTone)
                                        StatusPill(file.gatekeeperLabel, tone: file.gatekeeperTone)
                                    }
                                    Text("\(file.label) · \(file.fileName)")
                                        .font(.system(.caption2, design: .monospaced))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Spacer()
                                }
                                if file.kind == "dmg" {
                                    Text(file.staplerDetail ?? "stapler detail 없음")
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(Color.terminalMuted)
                                        .lineLimit(2)
                                    Text(file.gatekeeperDetail ?? "Gatekeeper detail 없음")
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(Color.terminalMuted)
                                        .lineLimit(2)
                                }
                            }
                        }
                        if !releaseCheck.issues.isEmpty {
                            ReleaseBulletList(title: "배포 게이트 이슈", items: releaseCheck.issues)
                        }
                        if !releaseCheck.warnings.isEmpty {
                            ReleaseBulletList(title: "배포 게이트 주의", items: releaseCheck.warnings)
                        }
                        if !releaseCheck.nextSteps.isEmpty {
                            ReleaseBulletList(title: "배포 게이트 다음 조치", items: releaseCheck.nextSteps)
                        }
                    }
                    .padding(12)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                } else {
                    EmptyState(didReadReleaseState ? "npm run mac:release-check:all -- --write-report 결과가 있으면 실제 DMG stapler/Gatekeeper 검증이 표시됩니다." : "번들 상태 읽기 전에는 배포 게이트 리포트를 조회하지 않습니다.")
                        .padding(12)
                        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                }

                if let installVerification {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("DMG 설치본 검증")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        HStack(spacing: 8) {
                            StatusPill(installVerification.displayLabel, tone: installVerification.tone)
                            StatusPill("검증 \(installVerification.verifiedSidecars)/\(installVerification.checked)", tone: installVerification.sidecarVerified ? .green : .amber)
                            StatusPill("전략/Toss/IP/체결 \(installVerification.verifiedEndpointChecks)/\(installVerification.checked)", tone: installVerification.verifiedEndpointChecks == installVerification.checked ? .green : .amber)
                            StatusPill("실행 \(installVerification.verifiedAppLaunches)/\(installVerification.checked)", tone: installVerification.verifiedAppLaunches == installVerification.checked ? .green : .amber)
                            StatusPill("버튼 \(installVerification.verifiedUiSmokeChecks)/\(installVerification.checked)", tone: installVerification.verifiedUiSmokeChecks == installVerification.checked ? .green : .amber)
                        }
                        CredentialInfoRow(title: "파일", value: installVerification.fileName)
                        CredentialInfoRow(title: "생성", value: installVerification.generatedAt)
                        ForEach(installVerification.results) { result in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    StatusPill(result.sidecarVerified ? "Sidecar 통과" : "Sidecar 실패", tone: result.sidecarVerified ? .green : .red)
                                    StatusPill(result.endpointLabel, tone: result.sidecarEndpointVerified ? .green : .red)
                                    StatusPill(result.appLaunchLabel, tone: result.appLaunchVerified ? .green : .red)
                                    StatusPill(result.uiSmokeLabel, tone: result.uiSmokeVerified ? .green : .red)
                                    Text(result.fileName)
                                        .font(.system(.caption2, design: .monospaced))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Spacer()
                                    Text(result.nodeVersion ?? "Node 미확인")
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(Color.terminalMuted)
                                }
                                Text(result.endpointDetail)
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(Color.terminalMuted)
                                    .lineLimit(2)
                                Text(result.uiSmokeDetail)
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(Color.terminalMuted)
                                    .lineLimit(2)
                            }
                        }
                        if !installVerification.issues.isEmpty {
                            ReleaseBulletList(title: "설치본 검증 이슈", items: installVerification.issues)
                        }
                    }
                    .padding(12)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                }

                if let manifest {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("배포 준비도")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.terminalMuted)
                        HStack(spacing: 8) {
                            StatusPill(manifest.readinessDisplayLabel, tone: manifest.readinessTone)
                            StatusPill("Gatekeeper \(manifest.gatekeeperLabel)", tone: manifest.gatekeeperRisk == "low" ? .green : .red)
                            StatusPill(manifest.developerSigningLabel, tone: manifest.developerSigningLabel == "Developer ID" ? .green : .amber)
                            StatusPill(manifest.sidecarVerificationLabel, tone: manifest.sidecarVerificationTone)
                        }
                        if !releaseReadinessWarnings.isEmpty {
                            ReleaseBulletList(title: "주의", items: releaseReadinessWarnings)
                        }
                        if !manifest.readinessNextSteps.isEmpty {
                            ReleaseBulletList(title: "다음 조치", items: manifest.readinessNextSteps)
                        }
                        ReleaseBulletList(title: "Toss/paper 운영 체크", items: manifest.readinessOperatorChecklist)
                    }
                    .padding(12)
                    .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("새 Mac 설치 후 점검")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    ForEach(installChecks) { item in
                        InstallChecklistRow(item: item)
                    }
                }
                .padding(12)
                .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                VStack(alignment: .leading, spacing: 8) {
                    Text("다른 Mac에서 필요한 확인")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    Text("· 공증 미완료 DMG는 Gatekeeper 경고가 날 수 있습니다. 정식 배포는 Developer ID 서명과 Apple 공증이 필요합니다.")
                    Text("· 현재 manifest의 최소 macOS와 지원 아키텍처가 새 Mac과 맞는지 먼저 확인하세요.")
                    Text("· DMG/ZIP 실파일은 앱 내부가 아니라 패키징 결과 폴더에 생성됩니다.")
                    Text("· Toss API 키는 새 Mac에서 다시 검증해 sidecar 저장소와 macOS Keychain에 저장하고, 자동거래 계좌를 다시 선택해야 합니다.")
                    Text("· 공인 IP가 바뀌면 Toss 개발자 콘솔 허용 IP와 앱의 연결 진단 결과가 일치해야 합니다.")
                    Text("· 새 Mac의 Upbit 수동 지정가는 다시 읽기 전용 QA와 typed 수동 토글을 완료해야 열립니다. Bithumb과 코인 자동매매는 paper 전용입니다.")
                }
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))

                }
            }

            HStack {
                Button(isReadingReleaseState ? "읽는 중" : "번들 상태 읽기") {
                    Task {
                        await refreshReleaseState()
                    }
                }
                .disabled(isReadingReleaseState || isRefreshingInstallReadiness)
                Button(isRefreshingInstallReadiness ? "점검 중" : "설치 후 점검") {
                    Task {
                        await refreshInstallReadiness()
                    }
                }
                .disabled(isReadingReleaseState || isRefreshingInstallReadiness)
                Button(copiedInstallReport ? "리포트 복사됨" : "점검 리포트 복사") {
                    Task {
                        if !didReadReleaseState {
                            await refreshReleaseState()
                        }
                        copyInstallReport()
                    }
                }
                .disabled(isReadingReleaseState || isRefreshingInstallReadiness)
                Button("릴리즈 폴더") {
                    model.openReleaseFolder()
                }
                Spacer()
                Button("현재 앱 Finder") {
                    model.revealCurrentApp()
                }
            }
        }
        .padding(18)
        .frame(width: 760)
        .frame(maxHeight: 720)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            if !didReadReleaseState {
                await refreshReleaseState()
            }
        }
    }

    private var dmgStatusLabel: String {
        didReadReleaseState ? (hasDmg ? "DMG 준비" : "DMG 없음") : "DMG 미확인"
    }

    private var manifestStatusLabel: String {
        didReadReleaseState ? (manifest == nil ? "Manifest 없음" : "Manifest 확인") : "Manifest 미확인"
    }

    private var handoffStatusLabel: String {
        if !didReadReleaseState {
            return "대상 Mac 미확인"
        }
        if handoffEntries.isEmpty {
            return "대상 Mac 없음"
        }
        let readyCount = handoffEntries.filter(\.hasRequiredFiles).count
        return "대상 Mac \(readyCount)/\(handoffEntries.count)"
    }

    private var handoffStatusTone: PillTone {
        guard didReadReleaseState else {
            return .amber
        }
        guard !handoffEntries.isEmpty else {
            return .red
        }
        return handoffEntries.allSatisfy(\.hasRequiredFiles) ? .green : .amber
    }

    private var hasCompleteMultiArchitectureHandoff: Bool {
        let architectures = Set(handoffEntries.map(\.arch))
        return architectures.isSuperset(of: ["arm64", "x64"]) &&
            handoffEntries.allSatisfy(\.hasRequiredFiles)
    }

    private var effectiveSupportedArchitectures: [String] {
        if !handoffEntries.isEmpty {
            var seen = Set<String>()
            let architectures = handoffEntries
                .flatMap { $0.supportedArchitectures.isEmpty ? [$0.arch] : $0.supportedArchitectures }
                .filter { architecture in
                    if seen.contains(architecture) {
                        return false
                    }
                    seen.insert(architecture)
                    return true
                }
            if !architectures.isEmpty {
                return architectures
            }
        }
        if let supportedArchitectures = manifest?.supportedArchitectures, !supportedArchitectures.isEmpty {
            return supportedArchitectures
        }
        return [currentArchitecture]
    }

    private var releaseSupportedArchitectureLabel: String {
        effectiveSupportedArchitectures.joined(separator: " / ")
    }

    private var releaseReadinessWarnings: [String] {
        guard let manifest else {
            return []
        }
        if hasCompleteMultiArchitectureHandoff {
            return manifest.readinessWarnings.filter { !$0.contains("전용") }
        }
        return manifest.readinessWarnings
    }

    private var currentArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }

    private func publicIpDisplay(for status: String?) -> (detail: String, action: String) {
        switch status {
        case "not-requested":
            return (
                "공인 IP 미조회",
                "Toss 설정의 공인 IP 확인 버튼으로 현재 공인 IP를 조회하고 개발자 콘솔 허용 IP와 맞추세요."
            )
        case "skipped":
            return (
                "공인 IP 조회 스킵",
                "오프라인 또는 수동 점검 중이면 Toss 개발자 콘솔 허용 IP를 직접 확인하세요."
            )
        case "unavailable":
            return (
                "공인 IP 확인 실패",
                "네트워크 연결을 확인한 뒤 Toss 설정에서 공인 IP 확인을 다시 실행하세요."
            )
        case "checked":
            return (
                "공인 IP 값 없음",
                "Toss 설정에서 공인 IP 확인을 다시 실행하고 개발자 콘솔 허용 IP와 맞추세요."
            )
        case let status?:
            return (
                "공인 IP 상태 미확인",
                "알 수 없는 진단 상태(\(status))입니다. Toss 설정에서 공인 IP 확인을 다시 실행하세요."
            )
        case nil:
            return (
                "공인 IP 미조회",
                "Toss 설정의 공인 IP 확인 버튼으로 현재 공인 IP를 조회하고 개발자 콘솔 허용 IP와 맞추세요."
            )
        }
    }

    private var currentMacOSVersion: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    private func currentMacOSMeets(_ minimum: String) -> Bool {
        let current = ProcessInfo.processInfo.operatingSystemVersion
        let parts = minimum
            .split(separator: ".")
            .compactMap { Int($0) }
        let requiredMajor = parts.first ?? 0
        let requiredMinor = parts.dropFirst().first ?? 0
        let requiredPatch = parts.dropFirst(2).first ?? 0
        if current.majorVersion != requiredMajor {
            return current.majorVersion > requiredMajor
        }
        if current.minorVersion != requiredMinor {
            return current.minorVersion > requiredMinor
        }
        return current.patchVersion >= requiredPatch
    }

    private func refreshReleaseState() async {
        isReadingReleaseState = true
        let snapshot = await model.loadReleaseStateSnapshot()
        artifacts = snapshot.artifacts
        handoffEntries = snapshot.handoffEntries
        manifest = snapshot.manifest
        releaseCheck = snapshot.releaseCheck
        installVerification = snapshot.installVerification
        didReadReleaseState = true
        releaseMessage = "\(snapshot.message) · \(Date().formatted(date: .omitted, time: .standard))"
        copiedInstallReport = false
        isReadingReleaseState = false
    }

    private func refreshInstallReadiness() async {
        isRefreshingInstallReadiness = true
        if !didReadReleaseState {
            await refreshReleaseState()
        }
        await model.refreshHealth()
        if model.health != nil {
            await model.refreshBrokerCredential()
            await model.refreshBrokerAccounts()
            await model.refreshBrokerDiagnostics()
            await model.refreshLocalLiveTrading()
            await model.refreshKillSwitch()
            await model.refreshWorkerControl()
            await model.refreshAutomationScheduler()
            await model.runAppSelfTest()
        }
        isRefreshingInstallReadiness = false
        copiedInstallReport = false
    }

    private func copyInstallReport() {
        let lines = installReportLines()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.joined(separator: "\n"), forType: .string)
        releaseMessage = "설치 점검 리포트를 클립보드에 복사했습니다. 다른 Mac 문제를 진단할 때 그대로 공유할 수 있습니다."
        copiedInstallReport = true
    }

    private func installReportLines() -> [String] {
        var lines = [
            "Yong'Desk macOS 설치 점검 리포트",
            "생성: \(Date().formatted(date: .numeric, time: .standard))",
            "앱: \(Bundle.main.bundleURL.path(percentEncoded: false))",
            "Sidecar: \(model.health?.ok == true ? "정상" : model.statusLine)",
            "Live gate: \(model.liveGateLabel)",
            "",
            "배포 상태",
            "- 준비도: \(manifest?.readinessDisplayLabel ?? "릴리즈 미확인")",
            "- 공증: \(manifest?.notarizationLabel ?? "공증 미확인")",
            "- Gatekeeper 리스크: \(manifest?.gatekeeperLabel ?? "미확인")",
            "- 서명: \(manifest?.developerSigningLabel ?? "미확인")",
            "- 최소 macOS: \(manifest?.minimumMacOSLabel ?? "미확인")",
            "- 지원 아키텍처: \(releaseSupportedArchitectureLabel)",
            "- 배포 게이트 검증: \(releaseCheck?.displayLabel ?? "미확인") · \(releaseCheck?.detail ?? "release-check 리포트 없음")",
            "- DMG 설치본 검증: \(installVerification?.displayLabel ?? "미확인")",
            "- 릴리즈 메시지: \(releaseMessage)",
            "",
            "릴리즈 아티팩트",
        ]

        if artifacts.isEmpty {
            lines.append("- 없음")
        } else {
            for artifact in artifacts {
                lines.append("- \(artifact.title): \(artifact.exists ? "있음" : "없음") · \(artifact.fileName) · \(artifact.detail)")
            }
        }

        lines.append("")
        lines.append("Mac별 전달 파일")
        if handoffEntries.isEmpty {
            lines.append("- release-index 없음")
        } else {
            for entry in handoffEntries {
                lines.append("- \(entry.label) (\(entry.arch)): \(entry.handoffStatusLabel) · \(entry.fileSummary)")
                if let dmg = entry.dmgFile {
                    lines.append("  DMG: \(dmg.fileName) · \(dmg.checksumLabel) · SHA-256 \(dmg.sha256 ?? "미확인")")
                }
            }
        }

        lines.append("")
        lines.append("배포 게이트 검증")
        if let releaseCheck {
            lines.append("- \(releaseCheck.displayLabel) · \(releaseCheck.detail)")
            for file in releaseCheck.files {
                lines.append("- \(file.label) \(file.fileName): \(file.shaLabel) · \(file.staplerLabel) · \(file.gatekeeperLabel)")
                if file.kind == "dmg" {
                    lines.append("  stapler: \(file.staplerDetail ?? "detail 없음")")
                    lines.append("  Gatekeeper: \(file.gatekeeperDetail ?? "detail 없음")")
                }
            }
        } else {
            lines.append("- release-check 리포트 없음")
        }

        lines.append("")
        lines.append("DMG 설치본 검증")
        if let installVerification {
            lines.append("- \(installVerification.displayLabel) · \(installVerification.detail)")
            for result in installVerification.results {
                lines.append("- \(result.fileName): sidecar \(result.sidecarVerified ? "통과" : "실패") · endpoint \(result.sidecarEndpointVerified ? "통과" : "실패") · 실행 \(result.appLaunchVerified ? "통과" : "실패") · 버튼 \(result.uiSmokeVerified ? "통과" : "실패") · \(result.nodeVersion ?? "Node 미확인")")
                lines.append("  endpoint: \(result.endpointDetail)")
                lines.append("  UI: \(result.uiSmokeDetail)")
            }
        } else {
            lines.append("- install-verification 리포트 없음")
        }

        lines.append("")
        lines.append("설치 후 점검")
        for item in installChecks {
            lines.append("- [\(installStatusLabel(item.status))] \(item.title): \(item.detail)")
            lines.append("  조치: \(item.action)")
        }

        if let manifest {
            if !releaseReadinessWarnings.isEmpty {
                lines.append("")
                lines.append("배포 주의")
                lines.append(contentsOf: releaseReadinessWarnings.map { "- \($0)" })
            }
            if !manifest.readinessNextSteps.isEmpty {
                lines.append("")
                lines.append("다음 조치")
                lines.append(contentsOf: manifest.readinessNextSteps.map { "- \($0)" })
            }
        }

        return lines
    }

    private func installStatusLabel(_ status: String) -> String {
        switch status {
        case "pass": return "통과"
        case "warn": return "주의"
        case "fail": return "실패"
        default: return status
        }
    }
}

struct ReleaseArtifactRow: View {
    let artifact: ReleaseArtifactInfo
    let didReadReleaseState: Bool
    let onReveal: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            StatusPill(statusLabel, tone: statusTone)
            VStack(alignment: .leading, spacing: 3) {
                Text(artifact.title)
                    .font(.caption.weight(.semibold))
                Text(artifact.detail)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.terminalMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Text(artifact.fileName)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
                .lineLimit(1)
            Button("Finder") {
                onReveal()
            }
            .disabled(artifact.url == nil)
        }
        .padding(.vertical, 5)
    }

    private var statusLabel: String {
        didReadReleaseState ? (artifact.exists ? "있음" : "없음") : "미확인"
    }

    private var statusTone: PillTone {
        didReadReleaseState ? (artifact.exists ? .green : .red) : .amber
    }
}

struct ReleaseHandoffEntryRow: View {
    let entry: ReleaseHandoffEntryInfo
    @State private var copiedChecksum = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusPill(entry.handoffStatusLabel, tone: entry.handoffStatusTone)
                .frame(width: 74, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(entry.label)
                        .font(.caption.weight(.semibold))
                    StatusPill(entry.readinessLabel, tone: entry.readyForExternalDistribution == true ? .green : .amber)
                    StatusPill(entry.sidecarVerified == true ? "Sidecar 검증" : "Sidecar 미확인", tone: entry.sidecarVerified == true ? .green : .amber)
                }
                Text(entry.targetSummary)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                Text(entry.fileSummary)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                Text(entry.dmgFile?.fileName ?? "DMG 파일 없음")
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let checksum = entry.dmgFile?.shortChecksum {
                    HStack(spacing: 6) {
                        Text("SHA-256 \(checksum)")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Color.terminalMuted)
                            .lineLimit(1)
                        StatusPill(entry.dmgFile?.checksumLabel ?? "SHA 미확인", tone: entry.dmgFile?.checksumTone ?? .amber)
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 7) {
                Button("DMG Finder") {
                    reveal(entry.dmgFile?.url)
                }
                .disabled(entry.dmgFile?.url == nil)
                Button(copiedChecksum ? "SHA 복사됨" : "SHA 복사") {
                    copyChecksum()
                }
                .disabled(entry.dmgFile?.sha256 == nil)
            }
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private func reveal(_ url: URL?) {
        guard let url else {
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func copyChecksum() {
        guard let sha256 = entry.dmgFile?.sha256 else {
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(sha256, forType: .string)
        copiedChecksum = true
    }
}

struct InstallChecklistItem: Identifiable, Equatable {
    let title: String
    let detail: String
    let action: String
    let status: String

    var id: String { title }
}

struct InstallChecklistRow: View {
    let item: InstallChecklistItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusPill(statusLabel, tone: statusTone)
                .frame(width: 74, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.caption.weight(.semibold))
                Text(item.detail)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.terminalText)
                    .lineLimit(2)
                    .truncationMode(.middle)
                Text(item.action)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private var statusLabel: String {
        switch item.status {
        case "pass": return "통과"
        case "warn": return "주의"
        case "fail": return "실패"
        default: return item.status
        }
    }

    private var statusTone: PillTone {
        switch item.status {
        case "pass": return .green
        case "warn": return .amber
        case "fail": return .red
        default: return .blue
        }
    }
}

struct ReleaseBulletList: View {
    let title: String
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Text("· \(item)")
                    .font(.caption)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct StrategyPresetOption: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let mode: String
    let backendPreset: String
    let rungCount: Int
    let buyDropPct: Double
    let sellRisePct: Double
    let maxLossPct: Double
    let maxDailyTrades: Int
    let cooldownMinutes: Int

    static let all: [StrategyPresetOption] = [
        StrategyPresetOption(
            id: "magic-split",
            title: "순환분할",
            subtitle: "기준가에서 1%, 2%, 3% 하락마다 분할 매수하고 각 차수를 +1%에서 개별 익절합니다.",
            mode: "percent-grid",
            backendPreset: "magic-split",
            rungCount: 10,
            buyDropPct: 1,
            sellRisePct: 1,
            maxLossPct: 15,
            maxDailyTrades: 20,
            cooldownMinutes: 5
        ),
        StrategyPresetOption(
            id: "one-percent-loop",
            title: "1% 순환",
            subtitle: "단일 포지션을 1% 하락 매수, 1% 상승 매도로 반복합니다. 쿨다운으로 과매매를 제한합니다.",
            mode: "loop-grid",
            backendPreset: "one-percent-loop",
            rungCount: 1,
            buyDropPct: 1,
            sellRisePct: 1,
            maxLossPct: 8,
            maxDailyTrades: 10,
            cooldownMinutes: 5
        ),
        StrategyPresetOption(
            id: "defensive-split",
            title: "보수 분할",
            subtitle: "2% 간격으로 느리게 분할 매수하고 +1.5%에서 회수합니다. 변동성 큰 종목용입니다.",
            mode: "percent-grid",
            backendPreset: "defensive-split",
            rungCount: 5,
            buyDropPct: 2,
            sellRisePct: 1.5,
            maxLossPct: 10,
            maxDailyTrades: 6,
            cooldownMinutes: 10
        ),
        StrategyPresetOption(
            id: "custom",
            title: "사용자 지정",
            subtitle: "아래 수치를 직접 조정합니다. 저장 전 총 노출과 손실 중단선을 반드시 확인하세요.",
            mode: "percent-grid",
            backendPreset: "custom",
            rungCount: 5,
            buyDropPct: 1,
            sellRisePct: 1,
            maxLossPct: 15,
            maxDailyTrades: 10,
            cooldownMinutes: 5
        ),
    ]

    static func option(id: String) -> StrategyPresetOption {
        all.first { $0.id == id } ?? all[0]
    }
}

struct CryptoExchangeSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var exchange = "upbit"
    @State private var accessKey = ""
    @State private var secretKey = ""
    @State private var market = "KRW-BTC"
    @State private var side = "buy"
    @State private var volume = "0.001"
    @State private var price = "100000000"
    @State private var isWorking = false
    @State private var credentialSaveFailure: String?

    private var currentState: CryptoExchangeStateView? {
        model.cryptoExchanges.first { $0.exchange == exchange }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("코인 거래소 연결")
                        .font(.title2.weight(.bold))
                    Text("Upbit·Bithumb을 읽기 전용으로 점검합니다. Upbit 수동 지정가는 기본 설정의 연결 관리에서만 별도로 열 수 있으며, Bithumb과 코인 자동매매는 paper 전용입니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                }
                Spacer()
                Button("닫기") { dismiss() }
            }

            Picker("거래소", selection: $exchange) {
                Text("Upbit").tag("upbit")
                Text("Bithumb").tag("bithumb")
            }
            .pickerStyle(.segmented)

            PanelCard(title: "API Key", badge: currentState?.credential?.status == "verified" ? "VERIFIED" : "OFF", tone: currentState?.credential?.status == "verified" ? .green : .amber) {
                SecureField("Access Key", text: $accessKey)
                    .textFieldStyle(.roundedBorder)
                SecureField("Secret Key", text: $secretKey)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button("Keychain 불러오기") {
                        do {
                            if let credential = try model.cryptoCredentialFromKeychain(exchange: exchange) {
                                accessKey = credential.clientId
                                secretKey = credential.clientSecret
                                model.cryptoExchangeMessage = "\(exchange) Keychain credential을 입력칸에 불러왔습니다. 검증 저장을 눌러 연결을 복구하세요."
                            } else {
                                model.cryptoExchangeMessage = "\(exchange) Keychain credential이 없습니다."
                            }
                        } catch {
                            model.cryptoExchangeMessage = "Keychain 조회 실패: \(error.localizedDescription)"
                        }
                    }
                    Button("검증 후 저장") {
                        Task {
                            isWorking = true
                            credentialSaveFailure = nil
                            let saved = await model.registerCryptoCredential(exchange: exchange, accessKey: accessKey, secretKey: secretKey)
                            secretKey = ""
                            if saved {
                                accessKey = ""
                            } else {
                                credentialSaveFailure = model.cryptoExchangeMessage
                            }
                            isWorking = false
                        }
                    }
                    .disabled(accessKey.isEmpty || secretKey.isEmpty || isWorking || model.health == nil)
                    Button("삭제", role: .destructive) {
                        Task {
                            isWorking = true
                            await model.deleteCryptoCredential(exchange: exchange)
                            accessKey = ""
                            secretKey = ""
                            isWorking = false
                        }
                    }
                    .disabled(currentState?.credential == nil || isWorking)
                }
                if let credentialSaveFailure {
                    Label(credentialSaveFailure, systemImage: "xmark.octagon.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalRed)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let credential = currentState?.credential {
                    Text("\(credential.maskedIdentifier) · \(credential.status) · \(currentState?.contract.baseUrl ?? "")")
                        .font(.caption.monospaced())
                        .foregroundStyle(Color.terminalMuted)
                }
            }

            PanelCard(title: "읽기 전용 운영 점검", badge: "NO ORDER", tone: .blue) {
                TextField("마켓", text: $market)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Picker("방향", selection: $side) {
                        Text("매수").tag("buy")
                        Text("매도").tag("sell")
                    }
                    .frame(width: 160)
                    TextField("수량", text: $volume)
                        .textFieldStyle(.roundedBorder)
                    TextField("지정가", text: $price)
                        .textFieldStyle(.roundedBorder)
                }
                HStack {
                    Button("계좌·주문가능 점검") {
                        Task {
                            isWorking = true
                            await model.runCryptoReadiness(exchange: exchange, market: market.uppercased())
                            isWorking = false
                        }
                    }
                    Button("주문 사전검증") {
                        Task {
                            isWorking = true
                            await model.runCryptoOrderPrecheck(
                                exchange: exchange,
                                market: market.uppercased(),
                                side: side,
                                volume: Double(volume) ?? 0,
                                price: Double(price) ?? 0
                            )
                            isWorking = false
                        }
                    }
                    .disabled((Double(volume) ?? 0) <= 0 || (Double(price) ?? 0) <= 0)
                    Spacer()
                    StatusPill(
                        model.cryptoReadiness == nil ? "점검 대기" : model.cryptoReadiness?.ready == true ? "준비 통과" : "준비 차단",
                        tone: model.cryptoReadiness == nil ? .muted : model.cryptoReadiness?.ready == true ? .green : .red
                    )
                }
                if let readiness = model.cryptoReadiness, readiness.exchange == exchange, readiness.market == market.uppercased() {
                    Text(readiness.message)
                        .font(.caption2)
                        .foregroundStyle(readiness.ready ? Color.terminalGreen : Color.terminalAmber)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 7) {
                        if let ticker = readiness.ticker {
                            StatusPill("현재가 ₩\(Int(ticker.tradePrice.rounded()).formatted())", tone: ticker.fresh ? .blue : .red)
                        }
                        if let minTotal = readiness.orderConstraints?.bid.minTotal {
                            StatusPill("최소 매수 ₩\(Int(minTotal.rounded()).formatted())", tone: .muted)
                        }
                        StatusPill("주문 제출 없음", tone: .green)
                    }
                }
                if let precheck = model.cryptoOrderPrecheck, precheck.exchange == exchange, precheck.market == market.uppercased() {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(precheck.passed ? "사전검증 통과" : "사전검증 차단")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(precheck.passed ? Color.terminalGreen : Color.terminalRed)
                        ForEach(Array(precheck.blockers.prefix(4).enumerated()), id: \.offset) { _, blocker in
                            Text("· \(blocker)")
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                        }
                    }
                }
                Text("이 두 점검 버튼은 실제 주문을 생성하지 않습니다. 1.0.0의 코인 자동 전략은 paper 계좌에서만 실행됩니다.")
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }

            PanelCard(
                title: "코인 자동화 모드",
                badge: "PAPER ONLY",
                tone: .green
            ) {
                Text("API 키 검증, 잔고·주문가능정보 조회, 주문 사전검증은 지원합니다. 실제 주문은 체결·부분체결·재시작 멱등성 동기화가 포함되기 전까지 차단합니다.")
                    .font(.caption)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(model.cryptoExchangeMessage)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(width: 720, height: 700, alignment: .top)
        .background(Color.terminalBackground)
        .task { await model.refreshCryptoExchanges() }
        .onChange(of: exchange) { _, _ in
            accessKey = ""
            secretKey = ""
            model.cryptoReadiness = nil
            model.cryptoOrderPrecheck = nil
        }
    }
}

struct StrategySettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String

    @State private var name = "내 분할 전략"
    @State private var symbol = ""
    @State private var market = "US"
    @State private var executionVenue = "toss"
    @State private var selectedPresetId = "magic-split"
    @State private var editingConfigId: String?
    @State private var pendingDeleteConfig: StrategyConfigView?
    @State private var suppressPresetChange = false
    @State private var mode = "percent-grid"
    @State private var basePrice = 100.0
    @State private var basePriceSource = "기본값"
    @State private var notional = 1_000.0
    @State private var orderSizingMode: String?
    @State private var quantity = 1.0
    @State private var rungCount = 5
    @State private var buyDropPct = 1.0
    @State private var rungGapPct = 1.0
    @State private var sellRisePct = 1.0
    @State private var stopLossPct = 3.0
    @State private var maxDailyTrades = 10
    @State private var maxLossPct = 15.0
    @State private var cooldownMinutes = 5
    @State private var isWorking = false
    @State private var copiedStrategyReport = false

    private var totalExposure: Double {
        if orderSizingMode == "quantity" {
            let count = mode == "loop-grid" ? 1 : rungCount
            return (0..<count).reduce(0) { total, index in
                let drop = buyDropPct + rungGapPct * Double(index)
                let entry = max(basePrice * (1 - drop / 100), 0)
                return total + entry * quantity
            }
        }
        return mode == "loop-grid" ? notional : notional * Double(rungCount)
    }

    private var selectedPreset: StrategyPresetOption {
        StrategyPresetOption.option(id: selectedPresetId)
    }

    private var buyLevel: Double {
        basePrice * (1 - buyDropPct / 100)
    }

    private var sellLevel: Double {
        buyLevel * (1 + sellRisePct / 100)
    }

    private var currency: String {
        market == "US" ? "USD" : "KRW"
    }

    private var editingConfig: StrategyConfigView? {
        guard let editingConfigId else {
            return nil
        }
        return model.strategyConfigs.first { $0.id == editingConfigId }
    }

    private var formIsValid: Bool {
        model.health?.ok == true &&
            !symbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            basePrice.isFinite &&
            basePrice > 0 &&
            ((orderSizingMode == "quantity" && quantity.isFinite && quantity > 0) ||
             (orderSizingMode != "quantity" && notional.isFinite && notional > 0)) &&
            buyDropPct > 0 &&
            sellRisePct > 0 &&
            maxLossPct > 0 &&
            maxDailyTrades > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("자동매매 전략")
                        .font(.title3.weight(.semibold))
                    Text("전략은 로컬 엔진에 초안으로 저장되고, 시뮬레이션 통과 후에만 활성화됩니다. 1.0.0의 활성 전략은 종목별 paper 계좌에서만 실행됩니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    HStack(spacing: 8) {
                        Button(copiedStrategyReport ? "리포트 복사됨" : "전략 리포트 복사") {
                            copyStrategyReport()
                        }
                        .disabled(model.health == nil)
                        Button("닫기") {
                            dismiss()
                        }
                        Button("백업 복사") {
                            Task { await run { await model.copyStrategyBackupToClipboard() } }
                        }
                        .disabled(model.health == nil || isWorking)
                        Button("백업 가져오기") {
                            Task { await run { await model.importStrategyBackupFromClipboard() } }
                        }
                        .disabled(model.health == nil || isWorking)
                    }
                    if copiedStrategyReport {
                        Text("자동거래 전략 운영 리포트를 클립보드에 복사했습니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalGreen)
                    }
                }
            }

            HStack(spacing: 8) {
                StatusPill(model.health?.ok == true ? "Sidecar 정상" : "Sidecar 필요", tone: model.health?.ok == true ? .green : .red)
                StatusPill("\(model.strategyConfigs.filter { $0.status == "enabled" }.count) 활성", tone: .green)
                if editingConfig != nil {
                    StatusPill("편집 중", tone: .amber)
                }
                StatusPill(model.liveGateLabel, tone: model.liveGateTone)
            }

            Text(model.strategyMessage)
                .font(.callout)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

            HStack(alignment: .top, spacing: 12) {
                strategyEditor
                    .frame(width: 390)
                strategyList
                    .frame(width: 500)
            }
        }
        .onChange(of: selectedPresetId) { _, presetId in
            if suppressPresetChange {
                suppressPresetChange = false
                return
            }
            applyPreset(presetId, updateName: true)
        }
        .padding(18)
        .frame(width: 940, height: 720)
        .background(Color.terminalBackground)
        .foregroundStyle(Color.terminalText)
        .task {
            primeDefaultsIfNeeded()
            if model.health?.ok == true {
                await model.refreshTerminalDashboard(symbol: selectedSymbol, session: selectedSession)
                await model.refreshStrategyConfigs()
                applySuggestedBasePrice(force: false)
            }
        }
        .confirmationDialog(
            "전략 삭제",
            isPresented: Binding(
                get: { pendingDeleteConfig != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingDeleteConfig = nil
                    }
                }
            ),
            presenting: pendingDeleteConfig
        ) { config in
            Button("\(config.name) 삭제", role: .destructive) {
                Task { await deleteStrategy(config) }
            }
            Button("취소", role: .cancel) {
                pendingDeleteConfig = nil
            }
        } message: { config in
            Text("\(config.symbol) 전략 설정과 시뮬레이션 기록이 로컬 저장소에서 제거됩니다. 주문 제출은 실행되지 않습니다.")
        }
    }

    private var strategyEditor: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: editingConfig == nil ? "전략 작성" : "전략 편집", trailing: selectedPreset.title)

                VStack(alignment: .leading, spacing: 8) {
                    Text("프리셋")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.terminalMuted)
                    Picker("프리셋", selection: $selectedPresetId) {
                        ForEach(StrategyPresetOption.all) { option in
                            Text(option.title).tag(option.id)
                        }
                    }
                    .pickerStyle(.menu)
                    Text(selectedPreset.subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        StatusPill(modeLabel(mode), tone: .blue)
                        StatusPill(mode == "loop-grid" ? "쿨다운 \(cooldownMinutes)분" : "\(rungCount)차", tone: .green)
                        StatusPill("중단선 \(String(format: "%.1f%%", maxLossPct))", tone: .amber)
                    }
                }
                .padding(10)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))

                Picker("모드", selection: $mode) {
                    Text("분할").tag("percent-grid")
                    Text("1% 순환").tag("loop-grid")
                }
                .pickerStyle(.segmented)

                VStack(alignment: .leading, spacing: 8) {
                    StrategyTextField(title: "전략 이름", text: $name)
                    StrategyTextField(title: "종목", text: $symbol)
                    Picker("시장", selection: $market) {
                        Text("미국 주식").tag("US")
                        Text("국내 주식").tag("KR")
                        Text("코인(KRW)").tag("CRYPTO")
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: market) { _, nextMarket in
                        if nextMarket == "CRYPTO" {
                            executionVenue = executionVenue == "bithumb" ? "bithumb" : "upbit"
                            if !symbol.contains("-") {
                                symbol = "KRW-BTC"
                                basePrice = 100_000_000
                                basePriceSource = "코인 수동 기준가"
                                applyPreset(selectedPresetId, updateName: true)
                            }
                        } else {
                            executionVenue = "toss"
                        }
                    }
                    if market == "CRYPTO" {
                        Picker("실행 거래소", selection: $executionVenue) {
                            Text("Upbit").tag("upbit")
                            Text("Bithumb").tag("bithumb")
                        }
                        .pickerStyle(.segmented)
                        Text("코인 전략은 연속 스케줄러와 paper 계좌에서 검증합니다. 1.0.0에서는 Upbit·Bithumb 실제 주문 제출이 항상 차단됩니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                    }
                }

                StrategyNumberField(title: "기준가", value: $basePrice)
                HStack(spacing: 8) {
                    FieldTile(title: "기준가 출처", value: basePriceSource)
                    Button("현재가로 갱신") {
                        applySuggestedBasePrice(force: true)
                    }
                    .disabled(model.strategyPriceSuggestion(symbol: symbol)?.price == nil)
                }
                StrategyNumberField(title: mode == "loop-grid" ? "1회 매수 금액" : "차수당 금액", value: $notional)
                if orderSizingMode == "quantity" {
                    StrategyNumberField(title: "1회 주문 수량", value: $quantity)
                    Text("고정 수량 전략입니다. 가격이 바뀌어도 주문 수량을 유지합니다.")
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                } else if orderSizingMode == "notional" {
                    Text("고정 주문금액 전략입니다. 실행 가격에서 수량을 다시 계산합니다.")
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                }
                StrategyNumberField(title: "매수 하락률 %", value: $buyDropPct)
                if mode == "percent-grid" {
                    StrategyNumberField(title: "차수 간격 %", value: $rungGapPct)
                }
                StrategyNumberField(title: "매도 상승률 %", value: $sellRisePct)
                StrategyNumberField(title: "손절률 %", value: $stopLossPct)
                StrategyNumberField(title: "추가매수 중단선 %", value: $maxLossPct)

                if mode == "percent-grid" {
                    Stepper("차수 \(rungCount)", value: $rungCount, in: 1...20)
                } else {
                    Stepper("쿨다운 \(cooldownMinutes)분", value: $cooldownMinutes, in: 0...1440, step: 5)
                }
                Stepper("일일 매매 한도 \(maxDailyTrades)", value: $maxDailyTrades, in: 1...50)

                VStack(alignment: .leading, spacing: 8) {
                    FieldTile(title: "총 노출", value: money(totalExposure, currency: currency))
                    FieldTile(title: "다음 매수선", value: price(buyLevel, currency: currency))
                    FieldTile(title: "1차 익절선", value: price(sellLevel, currency: currency))
                    FieldTile(title: "프리셋", value: selectedPreset.title)
                }

                HStack(spacing: 8) {
                    Button(isWorking ? "저장 중" : editingConfig == nil ? "초안 저장" : "수정 저장") {
                        Task { await saveDraft() }
                    }
                    .disabled(!formIsValid || isWorking)

                    if editingConfig != nil {
                        Button("새 전략") {
                            clearEditing()
                            primeDefaultsIfNeeded(reset: true)
                        }
                        .disabled(isWorking)
                    }
                }
            }
            .padding(12)
        }
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }

    private var strategyList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "전략 관리", trailing: "\(model.strategyConfigs.count)개")

                if model.strategyConfigs.isEmpty {
                    EmptyState("저장된 전략이 없습니다. 왼쪽에서 초안을 저장하세요.")
                } else {
                    ForEach(model.strategyConfigs) { config in
                        StrategyConfigRow(
                            config: config,
                            isWorking: isWorking,
                            isEditing: editingConfigId == config.id,
                            onEdit: { loadForEditing(config) },
                            onPreviewCurrent: { Task { await run { await model.previewStrategyTick(config, scenario: "current") } } },
                            onPreviewTrigger: { Task { await run { await model.previewStrategyTick(config, scenario: "entry-trigger") } } },
                            onSimulate: { Task { await run { await model.simulateStrategy(config) } } },
                            onEnable: { Task { await run { await model.setStrategyStatus(config, status: "enabled") } } },
                            onPause: { Task { await run { await model.setStrategyStatus(config, status: "disabled") } } },
                            onDelete: { pendingDeleteConfig = config }
                        )
                    }
                }

                if let simulation = model.latestStrategySimulation {
                    PanelCard(title: "최근 시뮬레이션", badge: simulation.riskCheck.passed ? "통과" : "차단", tone: simulation.riskCheck.passed ? .green : .red) {
                        Text(simulation.summary)
                            .font(.caption)
                            .foregroundStyle(Color.terminalText)
                        HStack {
                            FieldTile(title: "예상 수익", value: String(format: "%.2f%%", simulation.expectedReturnPct))
                            FieldTile(title: "예상 하방", value: String(format: "%.2f%%", simulation.expectedLossPct))
                            FieldTile(title: "주문의도", value: "\(simulation.orderIntents.count)개")
                        }
                        if !simulation.riskCheck.blockers.isEmpty || !simulation.riskCheck.warnings.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(simulation.riskCheck.blockers.prefix(3), id: \.self) { blocker in
                                    Text("차단 · \(blocker)")
                                        .font(.caption2)
                                        .foregroundStyle(Color.terminalRed)
                                }
                                ForEach(simulation.riskCheck.warnings.prefix(3), id: \.self) { warning in
                                    Text("주의 · \(warning)")
                                        .font(.caption2)
                                        .foregroundStyle(Color.terminalAmber)
                                }
                            }
                        }
                        if !simulation.orderIntents.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("주문의도 미리보기")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Color.terminalMuted)
                                ForEach(simulation.orderIntents.prefix(6)) { intent in
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            StatusPill(intent.side == "buy" ? "매수" : "매도", tone: intent.side == "buy" ? .green : .amber)
                                            StatusPill(intent.status == "draft" ? "초안" : "차단", tone: intent.status == "draft" ? .blue : .red)
                                            Text("\(intent.symbol) \(quantityLabel(intent.quantity))주 · \(price(intent.limitPrice, currency: simulationCurrency(simulation))) · \(money(intent.notional, currency: simulationCurrency(simulation)))")
                                                .font(.caption2.monospacedDigit())
                                                .foregroundStyle(Color.terminalText)
                                            Spacer()
                                        }
                                        Text(intent.reason)
                                            .font(.caption2)
                                            .foregroundStyle(Color.terminalMuted)
                                            .lineLimit(2)
                                    }
                                    .padding(7)
                                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 6))
                                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.terminalLine.opacity(0.8)))
                                }
                                if simulation.orderIntents.count > 6 {
                                    Text("외 \(simulation.orderIntents.count - 6)개 주문의도는 리포트/엔진 응답에 포함됩니다.")
                                        .font(.caption2)
                                        .foregroundStyle(Color.terminalMuted)
                                }
                            }
                        }
                        ForEach(simulation.logs.prefix(3), id: \.self) { log in
                            Text(log)
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                        }
                    }
                }

                if let tickPreview = model.latestStrategyTickPreview {
                    PanelCard(title: "최근 tick 점검", badge: "dry-run", tone: .blue) {
                        Text(tickPreview)
                            .font(.caption)
                            .foregroundStyle(Color.terminalText)
                            .textSelection(.enabled)
                    }
                }

                if editingConfig != nil {
                    PanelCard(title: "편집 안내", badge: "재검증", tone: .amber) {
                        Text("기존 전략을 수정 저장하면 활성 상태와 마지막 시뮬레이션이 무효화됩니다. 저장 후 시뮬레이션을 다시 통과해야 활성화할 수 있습니다.")
                            .font(.caption)
                            .foregroundStyle(Color.terminalText)
                    }
                }

                Button("전략 목록 새로고침") {
                    Task { await run { await model.refreshStrategyConfigs() } }
                }
                .disabled(model.health == nil || isWorking)
            }
            .padding(12)
        }
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }

    private func saveDraft() async {
        let input = StrategyDraftInput(
            name: name,
            symbol: symbol,
            market: market,
            preset: selectedPreset.backendPreset,
            mode: mode,
            basePrice: basePrice,
            notional: notional,
            rungCount: rungCount,
            buyDropPct: buyDropPct,
            sellRisePct: sellRisePct,
            maxDailyTrades: maxDailyTrades,
            maxLossPct: maxLossPct,
            cooldownMinutes: cooldownMinutes,
            executionVenue: market == "CRYPTO" ? executionVenue : "toss",
            orderSizingMode: orderSizingMode,
            quantity: orderSizingMode == "quantity" ? quantity : nil,
            rungGapPct: rungGapPct,
            stopLossPct: stopLossPct,
            priceAnchorSource: basePriceSource == "최근 분석 현재가" ? "market" : "manual",
            priceAnchorCapturedAt: basePriceSource == "최근 분석 현재가" ? model.latestMarketAnalysis?.quoteAt : nil
        )
        await run {
            if let editingConfig {
                _ = await model.updateStrategyDraft(editingConfig, input: input)
                editingConfigId = nil
            } else {
                _ = await model.createStrategyDraft(input)
            }
        }
    }

    private func run(_ action: @escaping () async -> Void) async {
        isWorking = true
        await action()
        isWorking = false
    }

    private func deleteStrategy(_ config: StrategyConfigView) async {
        pendingDeleteConfig = nil
        await run {
            await model.deleteStrategy(config)
        }
        if editingConfigId == config.id {
            clearEditing()
            primeDefaultsIfNeeded(reset: true)
        }
    }

    private func primeDefaultsIfNeeded(reset: Bool = false) {
        guard reset || symbol.isEmpty else {
            return
        }
        if reset {
            editingConfigId = nil
        }
        let normalized = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        symbol = normalized.isEmpty ? "NVDA" : normalized
        let isCryptoSymbol = normalized.hasPrefix("KRW-") ||
            normalized.hasSuffix("-USD") ||
            normalized.hasSuffix("USDT") ||
            normalized.hasSuffix("USDC")
        market = isCryptoSymbol ? "CRYPTO" : selectedSession == "KR" ? "KR" : "US"
        executionVenue = isCryptoSymbol ? "upbit" : "toss"
        applyPreset(selectedPresetId, updateName: true)
        applySuggestedBasePrice(force: true)
    }

    private func applyPreset(_ presetId: String, updateName: Bool) {
        let option = StrategyPresetOption.option(id: presetId)
        if option.id != "custom" {
            mode = option.mode
            rungCount = option.rungCount
            buyDropPct = option.buyDropPct
            rungGapPct = option.buyDropPct
            sellRisePct = option.sellRisePct
            maxLossPct = option.maxLossPct
            maxDailyTrades = option.maxDailyTrades
            cooldownMinutes = option.cooldownMinutes
        }
        if updateName {
            let normalized = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            let prefix = normalized.isEmpty ? "내" : normalized
            name = "\(prefix) \(option.title)"
        }
    }

    private func loadForEditing(_ config: StrategyConfigView) {
        editingConfigId = config.id
        name = config.name
        symbol = config.symbol.uppercased()
        market = config.market == "CRYPTO" ? "CRYPTO" : config.market == "KR" ? "KR" : "US"
        executionVenue = config.executionVenue == "bithumb" ? "bithumb" : config.executionVenue == "upbit" ? "upbit" : "toss"
        let presetId = config.preset ?? "custom"
        suppressPresetChange = true
        selectedPresetId = StrategyPresetOption.all.contains { $0.id == presetId } ? presetId : "custom"
        mode = config.mode == "loop-grid" ? "loop-grid" : "percent-grid"
        orderSizingMode = config.orderSizing?.mode
        quantity = config.orderSizing?.quantity ?? quantity
        if config.orderSizing?.mode == "notional", let configuredNotional = config.orderSizing?.notional {
            notional = configuredNotional
        }
        stopLossPct = config.exitRules?.stopLossPct ?? stopLossPct
        if mode == "loop-grid" {
            let loop = config.loop
            basePrice = loop?.anchorPrice ?? config.priceAnchor?.price ?? config.currentPrice
            notional = loop?.notional ?? notional
            buyDropPct = loop?.buyDropPct ?? buyDropPct
            sellRisePct = loop?.sellRisePct ?? sellRisePct
            cooldownMinutes = loop?.cooldownMinutes ?? cooldownMinutes
            rungCount = 1
        } else {
            let grid = config.grid
            let rungs = grid?.rungs.sorted { $0.index < $1.index } ?? []
            basePrice = grid?.basePrice ?? config.priceAnchor?.price ?? config.currentPrice
            rungCount = max(1, min(rungs.count == 0 ? rungCount : rungs.count, 20))
            notional = rungs.first?.notional ?? notional
            buyDropPct = rungs.first?.buyDropPct ?? buyDropPct
            rungGapPct = estimateRungStep(rungs.map { $0.buyDropPct }, fallback: rungGapPct)
            sellRisePct = rungs.first?.sellRisePct ?? sellRisePct
        }
        if let riskLimits = config.riskLimits {
            maxDailyTrades = max(1, max(riskLimits.maxDailyBuys, riskLimits.maxDailySells))
            maxLossPct = riskLimits.maxLossPct
        }
        basePriceSource = "저장된 전략"
    }

    private func clearEditing() {
        editingConfigId = nil
        basePriceSource = "기본값"
    }

    private func estimateRungStep(_ values: [Double], fallback: Double) -> Double {
        let normalized = values
            .filter { $0.isFinite && $0 > 0 }
            .sorted()
        guard let first = normalized.first else {
            return fallback
        }
        if normalized.count >= 2 {
            let second = normalized[1]
            let interval = second - first
            if interval.isFinite && interval > 0 {
                return interval
            }
        }
        return first
    }

    private func applySuggestedBasePrice(force: Bool) {
        guard force || basePrice <= 0 || basePrice == 100 else {
            return
        }
        guard let suggestion = model.strategyPriceSuggestion(symbol: symbol) else {
            basePriceSource = "수동 입력"
            return
        }
        basePrice = suggestion.price
        basePriceSource = suggestion.source
    }

    private func copyStrategyReport() {
        let report = StrategyOperationReport.make(from: StrategyOperationReportInput(
            sidecarOK: model.health?.ok == true,
            configs: model.strategyConfigs,
            latestSimulation: model.latestStrategySimulation,
            latestTickPreview: model.latestStrategyTickPreview,
            liveGateState: model.liveGateLabel,
            liveTradingEffective: model.localLiveTrading?.effective == true || model.brokerDiagnostics?.liveGate.liveTradingEffective == true,
            killSwitchEngaged: model.killSwitchEngaged,
            workerPaused: model.workerPausedEffective
        ))
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
        copiedStrategyReport = true
    }

    private func simulationCurrency(_ simulation: StrategySimulationResultView) -> String {
        let config = model.strategyConfigs.first { $0.id == simulation.strategyConfigId }
        return config?.market == "US" ? "USD" : "KRW"
    }

    private func modeLabel(_ value: String) -> String {
        value == "loop-grid" ? "순환" : "분할"
    }
}

struct StrategyTextField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
            TextField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct StrategyNumberField: View {
    let title: String
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
            TextField(title, value: $value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct StrategyConfigRow: View {
    let config: StrategyConfigView
    let isWorking: Bool
    let isEditing: Bool
    let onEdit: () -> Void
    let onPreviewCurrent: () -> Void
    let onPreviewTrigger: () -> Void
    let onSimulate: () -> Void
    let onEnable: () -> Void
    let onPause: () -> Void
    let onDelete: () -> Void

    private var stale: Bool {
        guard let hash = config.currentConfigHash, let simulationHash = config.lastSimulation?.configHash else {
            return false
        }
        return hash != simulationHash
    }

    private var canEnable: Bool {
        config.lastSimulation?.passed == true && !stale
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(config.name)
                        .font(.subheadline.weight(.semibold))
                    Text("\(config.market) \(config.symbol) · \(config.executionVenue ?? "toss") · \(presetLabel(config.preset)) · \(modeLabel(config.mode)) · 기준가 \(price(config.currentPrice, currency: config.market == "US" ? "USD" : "KRW"))")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                }
                Spacer()
                if isEditing {
                    StatusPill("편집", tone: .amber)
                }
                Button(isEditing ? "편집 중" : "편집", action: onEdit)
                    .font(.caption)
                    .disabled(isWorking || isEditing)
                StatusPill(statusLabel(config.status), tone: statusTone(config.status))
            }

            Text(config.lastSimulation?.summary ?? "시뮬레이션 기록 없음")
                .font(.caption)
                .foregroundStyle(Color.terminalText)
                .lineLimit(2)

            if let readiness = config.automationReadiness {
                HStack(spacing: 6) {
                    StatusPill(
                        readiness.paperAutomationReady ? "모의 자동화 준비" : "모의 자동화 차단",
                        tone: readiness.paperAutomationReady ? .green : .red
                    )
                    StatusPill("자동화 실거래 별도 gate", tone: .amber)
                    StatusPill(
                        readiness.workerPaused ? "워커 정지" : "워커 대기",
                        tone: readiness.workerPaused ? .amber : .muted
                    )
                }
                if let message = readinessMessage(readiness) {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(readinessMessageColor(readiness))
                        .lineLimit(2)
                }
            }

            if stale {
                Text("설정 변경 후 재검증 필요")
                    .font(.caption2)
                    .foregroundStyle(Color.terminalAmber)
            }
            if let blocker = config.lastSimulation?.blockers.first {
                Text(blocker)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalRed)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86), spacing: 8)], alignment: .leading, spacing: 8) {
                Button(isEditing ? "편집 중" : "편집", action: onEdit)
                    .disabled(isWorking || isEditing)
                Button("현재 틱", action: onPreviewCurrent)
                    .disabled(isWorking)
                Button("발동가 테스트", action: onPreviewTrigger)
                    .disabled(isWorking)
                Button("시뮬레이션", action: onSimulate)
                    .disabled(isWorking)
                if config.status == "enabled" {
                    Button("일시정지", action: onPause)
                        .disabled(isWorking)
                } else {
                    Button("활성화", action: onEnable)
                        .disabled(isWorking || !canEnable)
                }
                Button("삭제", role: .destructive, action: onDelete)
                    .disabled(isWorking)
            }
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private func modeLabel(_ mode: String?) -> String {
        switch mode {
        case "loop-grid": return "1% 순환"
        case "percent-grid": return "분할"
        default: return "사다리"
        }
    }

    private func presetLabel(_ preset: String?) -> String {
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

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "enabled": return "활성"
        case "disabled": return "일시정지"
        default: return "초안"
        }
    }

    private func statusTone(_ status: String) -> PillTone {
        switch status {
        case "enabled": return .green
        case "disabled": return .amber
        default: return .muted
        }
    }

    private func readinessMessage(_ readiness: StrategyAutomationReadinessView) -> String? {
        if let blocker = readiness.blockers.first {
            return "자동화 차단: \(blocker)"
        }
        if readiness.paperAutomationReady {
            return "모의 자동화를 사용할 수 있습니다. 1.0.0에서는 Toss 연결 여부와 관계없이 실제 주문을 제출하지 않습니다."
        }
        if let nextAction = readiness.nextActions.first {
            return "다음 조치: \(nextAction)"
        }
        return nil
    }

    private func readinessMessageColor(_ readiness: StrategyAutomationReadinessView) -> Color {
        if !readiness.blockers.isEmpty {
            return Color.terminalRed
        }
        if readiness.paperAutomationReady {
            return Color.terminalGreen
        }
        return Color.terminalMuted
    }
}

struct WatchlistSidebar: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selectedSymbol: String
    @State private var selectedAssetFilter: WatchAssetFilter = .us

    private var allWatchSymbols: [WatchSymbol] {
        var items: [WatchSymbol] = []
        var seen = Set<String>()

        func append(_ item: WatchSymbol) {
            if seen.insert(item.symbol).inserted {
                items.append(item)
            }
        }

        if let dashboard = model.terminalDashboard {
            let intent = dashboard.orderIntent
            let priceText = intent.limitPrice.map { price($0, currency: intent.currency) } ?? "대기"
            append(WatchSymbol(
                symbol: dashboard.symbol,
                name: knownName(dashboard.symbol),
                price: priceText,
                change: dashboard.riskCheck.passed ? "Risk OK" : "차단 \(dashboard.riskCheck.blockers.count)",
                isUp: dashboard.riskCheck.passed,
                alert: intent.status == "draft" ? "OrderIntent" : intent.status,
                assetClass: dashboard.session == "KR" ? .kr : WatchAssetFilter.inferred(symbol: dashboard.symbol)
            ))
        } else {
            let normalized = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            if !normalized.isEmpty {
                append(WatchSymbol(symbol: normalized, name: knownName(normalized), price: "대기", change: "-", isUp: true, alert: "대시보드 대기"))
            }
        }

        for config in model.strategyConfigs {
            append(WatchSymbol(
                symbol: config.symbol,
                name: knownName(config.symbol),
                price: price(config.currentPrice, currency: config.market == "KR" ? "KRW" : "USD"),
                change: strategyStatusLabel(config.status),
                isUp: config.status == "enabled",
                alert: config.mode == "loop-grid" ? "순환 전략" : "분할 전략",
                assetClass: config.market == "KR" ? .kr : WatchAssetFilter.inferred(symbol: config.symbol)
            ))
        }

        for evaluation in model.terminalDashboard?.watchlistAlertEvaluations ?? [] {
            append(WatchSymbol(
                symbol: evaluation.symbol,
                name: knownName(evaluation.symbol),
                price: "대기",
                change: alertEvaluationLabel(evaluation.state),
                isUp: evaluation.state == "clear",
                alert: evaluation.title
            ))
        }

        for event in model.newsEvents {
            for ticker in event.tickers {
                append(WatchSymbol(
                    symbol: ticker,
                    name: knownName(ticker),
                    price: "뉴스",
                    change: event.importance == "high" ? "중요" : event.importance,
                    isUp: event.importance != "high",
                    alert: event.sourceName
                ))
            }
        }

        if items.isEmpty {
            return WatchSymbol.starterMetadata.prefix(6).map {
                WatchSymbol(symbol: $0.symbol, name: $0.name, price: "대기", change: "-", isUp: true, alert: "엔진 시작")
            }
        }
        return Array(items.prefix(12))
    }

    private var watchSymbols: [WatchSymbol] {
        allWatchSymbols.filter { $0.assetClass == selectedAssetFilter }
    }

    private var activeStrategyCount: Int {
        model.strategyConfigs.filter { $0.status == "enabled" }.count
    }

    private var riskSummary: (value: String, delta: String, tone: PillTone) {
        guard let dashboard = model.terminalDashboard else {
            return ("대기", "대시보드 필요", .muted)
        }
        if dashboard.riskCheck.passed {
            return ("통과", "\(dashboard.riskCheck.warnings.count) 주의", .green)
        }
        return ("차단", "\(dashboard.riskCheck.blockers.count) 사유", .red)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("시장 인텔리전스")
                            .font(.headline)
                        Text("공식 뉴스, 시그널, 리스크를 로컬에서 감시")
                            .font(.caption)
                            .foregroundStyle(Color.terminalMuted)
                    }
                    Spacer()
                    StatusPill("로컬", tone: .green)
                }
            }
            .padding(14)
            .background(Color.terminalPanel)

            LazyVGrid(columns: [GridItem(), GridItem()], spacing: 0) {
                MiniStat(title: "감시 종목", value: "\(watchSymbols.count)", delta: model.health?.ok == true ? "sidecar 연결" : "엔진 필요", tone: model.health?.ok == true ? .green : .red)
                MiniStat(title: "전략", value: "\(model.strategyConfigs.count)", delta: "\(activeStrategyCount) 활성", tone: activeStrategyCount > 0 ? .green : .muted)
                MiniStat(title: "리스크", value: riskSummary.value, delta: riskSummary.delta, tone: riskSummary.tone)
                MiniStat(title: "뉴스", value: "\(model.newsEvents.count)", delta: "긴급 \(model.latestAlerts.count)", tone: model.latestAlerts.isEmpty ? .muted : .amber)
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.terminalLine).frame(height: 1)
            }

            VStack(spacing: 10) {
                Picker("", selection: $selectedAssetFilter) {
                    ForEach(WatchAssetFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)

                HStack {
                    ScannerChip("시그널", active: model.terminalDashboard != nil)
                    ScannerChip("전략", active: activeStrategyCount > 0)
                    ScannerChip("뉴스", active: !model.newsEvents.isEmpty)
                    ScannerChip("리스크", active: model.terminalDashboard?.riskCheck.passed == false)
                }
            }
            .padding(12)
            .background(Color.terminalPanel)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.terminalLine).frame(height: 1)
            }

            HStack {
                Text("관심목록 / 전략 + 뉴스")
                Spacer()
                Text(model.lastUpdated)
            }
            .font(.system(.caption2, design: .monospaced).weight(.semibold))
            .foregroundStyle(Color.terminalMuted)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Color.terminalPanel2)

            ScrollView {
                LazyVStack(spacing: 0) {
                    if watchSymbols.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(selectedAssetFilter.title) 필터 결과 없음")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.terminalText)
                            Text("전략을 추가하거나 뉴스를 갱신하면 이 자산군의 감시 대상이 표시됩니다.")
                                .font(.caption2)
                                .foregroundStyle(Color.terminalMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                    } else {
                        ForEach(watchSymbols) { item in
                            Button {
                                selectedSymbol = item.symbol
                            } label: {
                                WatchRow(item: item, active: selectedSymbol.uppercased() == item.symbol)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .background(Color.terminalPanel)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.terminalLine).frame(width: 1)
        }
    }

    private func knownName(_ symbol: String) -> String {
        WatchSymbol.starterMetadata.first { $0.symbol == symbol.uppercased() }?.name ?? "\(symbol.uppercased()) 감시"
    }

    private func strategyStatusLabel(_ status: String) -> String {
        switch status {
        case "enabled": return "활성"
        case "disabled": return "일시정지"
        default: return "초안"
        }
    }

    private func alertEvaluationLabel(_ state: String) -> String {
        switch state {
        case "triggered": return "발동"
        case "clear": return "정상"
        case "blocked": return "꺼짐"
        case "limited": return "제한 평가"
        case "unsupported": return "준비중"
        default: return state
        }
    }
}

struct WorkspaceTabBar: View {
    @Binding var selectedTab: WorkspaceTab

    var body: some View {
        HStack(spacing: 6) {
            ForEach(WorkspaceTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: tab.systemImage)
                        Text(tab.title)
                        Text(tab.badge)
                            .font(.system(.caption2, design: .monospaced).weight(.bold))
                            .foregroundStyle(selectedTab == tab ? Color.terminalBackground : Color.terminalMuted)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(selectedTab == tab ? Color.terminalGreen : Color.terminalPanel3, in: Capsule())
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(selectedTab == tab ? Color.terminalText : Color.terminalMuted)
                    .padding(.horizontal, 10)
                    .frame(height: 31)
                    .background(selectedTab == tab ? Color.terminalPanel3 : Color.terminalPanel, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(selectedTab == tab ? Color.terminalGreen.opacity(0.45) : Color.terminalLine))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.terminalPanel2)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
    }
}

struct WorkspacePurposeBar: View {
    let selectedTab: WorkspaceTab

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: selectedTab.systemImage)
                .foregroundStyle(Color.terminalGreen)
                .frame(width: 18)
            Text(selectedTab.title)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.terminalText)
            Text(selectedTab.purpose)
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text("현재 작업")
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(Color.terminalGreen)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.terminalGreen.opacity(0.1), in: Capsule())
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(Color.terminalPanel)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(selectedTab.title). \(selectedTab.purpose)")
    }
}

struct WorkspaceContent: View {
    let selectedTab: WorkspaceTab
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool

    var body: some View {
        Group {
            switch selectedTab {
            case .overview:
                OverviewTab(selectedSymbol: selectedSymbol, selectedSession: selectedSession, resultPreview: $resultPreview)
            case .orderRisk:
                OrderRiskTab(selectedSymbol: selectedSymbol, selectedSession: selectedSession, resultPreview: $resultPreview, isLoading: $isLoading)
            case .newsAlerts:
                NewsAlertsTab(selectedSymbol: selectedSymbol, selectedSession: selectedSession, resultPreview: $resultPreview)
            case .replay:
                ReplayTab(selectedSymbol: selectedSymbol, selectedSession: selectedSession, resultPreview: $resultPreview)
            case .playbook:
                PlaybookTab(selectedSymbol: selectedSymbol, selectedSession: selectedSession, resultPreview: $resultPreview)
            }
        }
        .background(Color.terminalBackground)
    }
}

struct OverviewTab: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @State private var chartControls = ChartControlState()

    private var resultTitle: String {
        if resultPreview.hasPrefix("시장 브리핑 요약") {
            return "\(selectedSession) 시장 브리핑"
        }
        if resultPreview.hasPrefix("뉴스/RSS 갱신 요약") {
            return "뉴스/RSS 갱신 결과"
        }
        if resultPreview.hasPrefix("상태 갱신 요약") {
            return "앱 상태 갱신 결과"
        }
        return "\(selectedSymbol.uppercased()) 분석 결과"
    }

    private var analysis: MarketAnalysisSnapshot? {
        guard model.latestMarketAnalysis?.symbol == selectedSymbol.uppercased() else {
            return nil
        }
        return model.latestMarketAnalysis
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                MarketStrip(selectedSymbol: selectedSymbol, selectedSession: selectedSession, analysis: analysis)

                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        ChartHeader(selectedSymbol: selectedSymbol, analysis: analysis, controls: $chartControls)
                        PriceChart(selectedSymbol: selectedSymbol, analysis: analysis, controls: chartControls)
                    }
                    PriceAxis(analysis: analysis)
                        .frame(width: 74)
                }
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Color.terminalLine).frame(height: 1)
                }

                HStack(spacing: 0) {
                    SignalStackPanel(analysis: analysis)
                    NewsImpactPanel(events: model.newsEvents, selectedSymbol: selectedSymbol)
                    PositionMetricsPanel(selectedSymbol: selectedSymbol, analysis: analysis)
                }
                .frame(height: 214)

                if !resultPreview.isEmpty {
                    ResultPreviewView(title: resultTitle, resultPreview: resultPreview)
                        .padding(12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

struct OrderRiskTab: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    @State private var copiedOrderRiskReport = false
    @State private var showingAutomationRunConfirmation = false
    @State private var showingSchedulerStartConfirmation = false
    @State private var schedulerIntervalSeconds = 60

    private var dashboard: TerminalDashboardSnapshot? {
        model.terminalDashboard?.symbol == selectedSymbol.uppercased() ? model.terminalDashboard : nil
    }

    private func runAutomationCycle() {
        Task {
            isLoading = true
            resultPreview = await model.runAutomationCycle()
            isLoading = false
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                TabIntro(
                    title: "주문·리스크",
                    subtitle: "P0/P1 구현 대상인 OrderIntent 감사 로그, 리스크 시나리오, 주문 전 체크리스트를 한 탭으로 묶습니다."
                ) {
                    StatusPill("실거래 차단", tone: .red)
                    StatusPill("모의 주문 가능", tone: .green)
                }

                HStack(alignment: .top, spacing: 12) {
                    PanelCard(title: "주문 전 체크리스트", badge: "P1", tone: .amber) {
                        if let dashboard {
                            ForEach(dashboard.preTradeChecklist) { item in
                                ChecklistRow(
                                    ok: item.status == "pass",
                                    title: item.title,
                                    detail: item.detail,
                                    state: checklistStateLabel(item.status),
                                    tone: checklistTone(item.status)
                                )
                            }
                        } else {
                            EmptyState("Sidecar dashboard endpoint를 불러오면 체크리스트가 표시됩니다.")
                        }
                    }

                    PanelCard(title: "리스크 시나리오", badge: "P0", tone: .green) {
                        if let dashboard {
                            ForEach(dashboard.riskScenarios) { scenario in
                                let ratio = min(max(abs(scenario.estimatedPnl) / 300, 0.12), 1)
                                ScenarioRow(
                                    title: scenario.label,
                                    value: money(scenario.estimatedPnl, currency: dashboard.orderIntent.currency),
                                    ratio: ratio,
                                    tone: scenario.severity == "high" ? .red : scenario.severity == "medium" ? .amber : .green
                                )
                            }
                        } else {
                            EmptyState("리스크 시나리오를 불러오려면 엔진을 시작하세요.")
                        }
                    }
                }

                PanelCard(title: "OrderIntent 감사 로그", badge: "P0", tone: .green) {
                    HStack {
                        Button(copiedOrderRiskReport ? "리포트 복사됨" : "리포트 복사") {
                            copyOrderRiskReport()
                        }
                        .disabled(model.health == nil)
                        Button("모의 \(selectedSession) 실행") {
                            Task {
                                isLoading = true
                                resultPreview = await model.runPaper(session: selectedSession)
                                isLoading = false
                            }
                        }
                        .disabled(model.health == nil || model.executionBlocked || isLoading)
                        Button("자동화 점검") {
                            Task {
                                isLoading = true
                                resultPreview = await model.runAutomationDryRun()
                                isLoading = false
                            }
                        }
                        .disabled(model.health == nil || isLoading)
                        Button("체결 동기화") {
                            Task {
                                isLoading = true
                                resultPreview = await model.syncAutomationOrders()
                                isLoading = false
                            }
                        }
                        .disabled(model.health == nil || isLoading)
                        Button("보유 조회") {
                            Task {
                                isLoading = true
                                resultPreview = await model.refreshBrokerHolding(symbol: selectedSymbol)
                                isLoading = false
                            }
                        }
                        .disabled(model.health == nil || isLoading)
                        Button("사전검증") {
                            Task {
                                guard let dashboard else {
                                    return
                                }
                                isLoading = true
                                resultPreview = await model.runOrderPrecheck(dashboard)
                                isLoading = false
                            }
                        }
                        .disabled(model.health == nil || dashboard == nil || isLoading)
                        Button("자동화 1회 실행") {
                            showingAutomationRunConfirmation = true
                        }
                        .disabled(model.health == nil || model.executionBlocked || model.workerPausedEffective || isLoading)
                    }
                    .padding(.bottom, 8)

                    AutomationRunPreviewPanel(run: model.latestAutomationRun)
                    BrokerCheckSummaryPanel(holding: model.latestHolding, precheck: model.latestOrderPrecheck)

                    if copiedOrderRiskReport {
                        Text("주문·리스크 운영 리포트를 클립보드에 복사했습니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalGreen)
                    }

                    if let dashboard {
                        ForEach(dashboard.auditTrail.prefix(12)) { entry in
                            AuditRow(time: shortTime(entry.createdAt), title: entry.title, detail: entry.detail, state: auditStateLabel(entry.state))
                        }
                    } else {
                        EmptyState("감사 로그를 불러오려면 엔진을 시작하세요.")
                    }
                }

                PanelCard(title: "연속 자동 실행", badge: "APP", tone: model.automationSchedulerState?.enabled == true ? .green : .amber) {
                    HStack(spacing: 10) {
                        Button(model.automationSchedulerState?.enabled == true ? "연속 자동 실행 중지" : "연속 자동 실행 시작") {
                            if model.automationSchedulerState?.enabled == true {
                                Task {
                                    await model.setAutomationSchedulerEnabled(false, intervalSeconds: schedulerIntervalSeconds)
                                }
                            } else {
                                showingSchedulerStartConfirmation = true
                            }
                        }
                        .disabled(
                            model.health == nil ||
                            isLoading ||
                            (model.automationSchedulerState?.enabled != true && (model.executionBlocked || model.workerPausedEffective))
                        )
                        Button("스케줄러 상태 갱신") {
                            Task {
                                await model.refreshAutomationScheduler()
                            }
                        }
                        .disabled(model.health == nil)
                        Picker("주기", selection: $schedulerIntervalSeconds) {
                            Text("30초").tag(30)
                            Text("1분").tag(60)
                            Text("2분").tag(120)
                            Text("5분").tag(300)
                            Text("15분").tag(900)
                        }
                        .pickerStyle(.menu)
                        .disabled(model.automationSchedulerState?.enabled == true)
                        Spacer()
                        StatusPill(
                            model.automationSchedulerState?.running == true
                                ? "실행 중"
                                : model.automationSchedulerState?.enabled == true ? "자동 실행 ON" : "자동 실행 OFF",
                            tone: model.automationSchedulerState?.running == true
                                ? .amber
                                : model.automationSchedulerState?.enabled == true ? .green : .red
                        )
                    }
                    Text(model.automationSchedulerMessage)
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("앱과 Sidecar가 실행 중일 때만 동작합니다. 1.0.0의 연속 자동 실행은 항상 paper 계좌에만 기록되며 실제 주문을 제출하지 않습니다.")
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ResultPreviewView(title: "주문·리스크 실행 결과", resultPreview: resultPreview)
            }
            .padding(12)
        }
        .confirmationDialog(
            "자동화 1회 실행",
            isPresented: $showingAutomationRunConfirmation,
            titleVisibility: .visible
        ) {
            Button("자동화 1회 실행", role: .destructive) {
                runAutomationCycle()
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("활성 전략을 한 번 실행합니다. 현재 \(model.liveGateLabel) 상태이며 결과는 paper 계좌에만 기록됩니다. 실행 전 RiskCheck와 kill switch를 확인하세요.")
        }
        .confirmationDialog(
            "연속 자동 실행 시작",
            isPresented: $showingSchedulerStartConfirmation,
            titleVisibility: .visible
        ) {
            Button("\(schedulerIntervalSeconds)초 주기로 시작", role: .destructive) {
                Task {
                    await model.setAutomationSchedulerEnabled(true, intervalSeconds: schedulerIntervalSeconds)
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("활성 전략을 앱이 열린 동안 반복 실행합니다. 현재 \(model.liveGateLabel) 상태이며 모든 결과는 paper 계좌에만 기록됩니다. 시작 전 RiskCheck와 kill switch를 확인하세요.")
        }
        .task {
            await model.refreshAutomationScheduler()
            if let interval = model.automationSchedulerState?.intervalSeconds {
                schedulerIntervalSeconds = interval
            }
        }
    }

    private func copyOrderRiskReport() {
        let report = OrderRiskOperationReport.make(from: OrderRiskOperationReportInput(
            sidecarOK: model.health?.ok == true,
            selectedSymbol: selectedSymbol,
            selectedSession: selectedSession,
            dashboard: dashboard,
            holding: model.latestHolding,
            precheck: model.latestOrderPrecheck,
            automationRun: model.latestAutomationRun,
            resultPreview: resultPreview,
            liveGateState: model.liveGateLabel,
            liveTradingEffective: model.localLiveTrading?.effective == true || model.brokerDiagnostics?.liveGate.liveTradingEffective == true,
            killSwitchEngaged: model.killSwitchEngaged,
            workerPaused: model.workerPausedEffective
        ))
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
        copiedOrderRiskReport = true
    }

    private func checklistStateLabel(_ status: String) -> String {
        switch status {
        case "pass": return "정상"
        case "warn": return "주의"
        case "block": return "차단"
        default: return status
        }
    }

    private func checklistTone(_ status: String) -> PillTone {
        switch status {
        case "pass": return .green
        case "warn": return .amber
        case "block": return .red
        default: return .muted
        }
    }

    private func auditStateLabel(_ state: String) -> String {
        switch state {
        case "ok": return "정상"
        case "blocked": return "차단"
        case "warning": return "주의"
        case "stored": return "저장"
        default: return state
        }
    }
}

struct BrokerCheckSummaryPanel: View {
    let holding: LocalHoldingResponse?
    let precheck: LocalOrderPrecheckResponse?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "실계좌 보유", trailing: holdingStatus)
                MetricLine(title: "종목", value: holding?.symbol ?? "-")
                MetricLine(title: "계좌", value: holding?.accountSeq.map { "#\($0)" } ?? "-")
                MetricLine(title: "수량", value: holding?.held == true ? "\(quantityLabel(holding?.quantity))주" : holding == nil ? "-" : "없음")
                MetricLine(title: "평단", value: holding?.averagePurchasePrice.map { price($0, currency: holding?.currency ?? "USD") } ?? "-")
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "주문 전 사전검증", trailing: precheckStatus)
                MetricLine(title: "검증", value: precheck == nil ? "-" : precheck?.ok == true ? "잔고/수량 통과" : "잔고/수량 차단")
                MetricLine(title: "RiskCheck", value: precheck == nil ? "-" : precheck?.riskCheck.passed == true ? "통과" : "차단")
                MetricLine(title: "실거래 게이트", value: precheck == nil ? "-" : precheck?.liveTradingGate.effective == true ? "통과" : "차단")
                MetricLine(title: "제출 준비", value: precheck == nil ? "-" : precheck?.submitReady == true ? "가능" : "차단")
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(10)
        .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
        .padding(.bottom, 8)
    }

    private var holdingStatus: String {
        guard let holding else {
            return "미실행"
        }
        if !holding.linked {
            return "미연동"
        }
        return holding.held ? "보유" : "없음"
    }

    private var precheckStatus: String {
        guard let precheck else {
            return "미실행"
        }
        return precheck.submitReady ? "통과" : "차단"
    }
}

struct NewsAlertsTab: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @State private var isRefreshing = false
    @State private var redditClientId = ""
    @State private var redditClientSecret = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                TabIntro(
                    title: "뉴스·알림",
                    subtitle: "관심목록 단위 알림과 뉴스 신뢰도 점수를 묶어 알림 피로도와 입력값 품질을 관리합니다."
                ) {
                    StatusPill("긴급 \(model.latestAlerts.count)개", tone: model.latestAlerts.isEmpty ? .muted : .amber)
                    StatusPill("중복 제거 ON", tone: .green)
                    Button(isRefreshing ? "갱신 중" : "뉴스·알림 갱신") {
                        Task { await refreshNewsAndAlerts() }
                    }
                    .disabled(model.health == nil || isRefreshing)
                }

                ResultPreviewView(title: "뉴스·알림 갱신 결과", resultPreview: tabResultPreview)

                HStack(alignment: .top, spacing: 12) {
                    PanelCard(title: "관심목록 단위 알림", badge: "P0", tone: .green) {
                        if let dashboard = model.terminalDashboard {
                            ForEach(dashboard.watchlistAlerts) { rule in
                                AlertRuleRow(
                                    scope: alertScopeLabel(rule.scope),
                                    title: rule.title,
                                    detail: "\(rule.detail) · 쿨다운 \(rule.cooldownMinutes)분",
                                    state: rule.enabled ? alertPriorityLabel(rule.priority) : "꺼짐"
                                )
                            }
                        } else {
                            EmptyState("관심목록 알림 규칙을 불러오려면 엔진을 시작하세요.")
                        }
                    }

                    PanelCard(title: "뉴스 신뢰도 점수", badge: "P1", tone: .amber) {
                        if let dashboard = model.terminalDashboard {
                            ForEach(dashboard.newsCredibility) { source in
                                SourceScoreRow(
                                    source: source.sourceName,
                                    grade: source.grade,
                                    score: source.grade == "D" ? "차단" : String(format: "%.2f", source.score),
                                    detail: source.rationale
                                )
                            }
                        } else {
                            EmptyState("뉴스 신뢰도 점수를 불러오려면 엔진을 시작하세요.")
                        }
                    }
                }

                CommunitySentimentPanel(
                    snapshot: model.communitySentiment,
                    selectedSymbol: selectedSymbol,
                    message: model.communitySentimentMessage
                )

                PanelCard(
                    title: "미국 Reddit 민심 연결",
                    badge: model.redditCredentialStored ? "OAUTH ON" : "선택 사항",
                    tone: model.redditCredentialStored ? .green : .blue
                ) {
                    Text("Reddit 개발자 앱의 Client ID와 Secret을 이 Mac의 Keychain에만 저장합니다. 연결하면 미국 종목 민심에 공식 OAuth 게시글·댓글 근거가 추가됩니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        TextField("Reddit Client ID", text: $redditClientId)
                            .textFieldStyle(.roundedBorder)
                        SecureField("Reddit Client Secret", text: $redditClientSecret)
                            .textFieldStyle(.roundedBorder)
                    }
                    HStack {
                        Button("저장 후 엔진 재시작") {
                            model.saveRedditCredential(
                                clientId: redditClientId,
                                clientSecret: redditClientSecret
                            )
                            redditClientSecret = ""
                        }
                        .disabled(
                            redditClientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                redditClientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                        Button("연결 삭제", role: .destructive) {
                            model.deleteRedditCredential()
                            redditClientId = ""
                            redditClientSecret = ""
                        }
                        .disabled(!model.redditCredentialStored)
                        Spacer()
                        StatusPill(model.redditCredentialStored ? "Keychain 저장됨" : "미연결", tone: model.redditCredentialStored ? .green : .muted)
                    }
                    Text(model.redditCredentialMessage)
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                PanelCard(title: "조건 평가 결과", badge: "실제 데이터", tone: .blue) {
                    if let dashboard = model.terminalDashboard {
                        ForEach(dashboard.watchlistAlertEvaluations) { evaluation in
                            AlertEvaluationRow(
                                scope: alertScopeLabel(evaluation.scope),
                                title: evaluation.title,
                                detail: evaluation.detail,
                                state: alertEvaluationLabel(evaluation.state),
                                tone: alertEvaluationTone(evaluation.state),
                                evidence: evaluation.evidence
                            )
                        }
                    } else {
                        EmptyState("조건 평가 결과를 불러오려면 엔진을 시작하세요.")
                    }
                }

                PanelCard(title: "공식 뉴스 피드", badge: "\(model.newsEvents.count)", tone: .blue) {
                    Text(model.newsSourceStatusMessage)
                        .font(.caption2)
                        .foregroundStyle(model.newsSourceErrors.isEmpty ? Color.terminalMuted : Color.terminalAmber)
                    if let generatedAt = model.newsLastGeneratedAt {
                        Text("마지막 sidecar 갱신: \(generatedAt)")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Color.terminalMuted)
                    }
                    ForEach(Array(model.newsSourceErrors.prefix(3).enumerated()), id: \.offset) { _, sourceError in
                        Text("· \(sourceError.sourceId): \(sourceError.message)")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalAmber)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if model.newsEvents.isEmpty {
                        EmptyState(model.health == nil ? "엔진을 시작하면 공식/RSS 뉴스 이벤트를 불러올 수 있습니다." : "아직 불러온 뉴스가 없습니다. 상단의 뉴스 갱신 버튼으로 공식/RSS 이벤트를 가져오세요.")
                    } else {
                        Text("앱 실행 중에는 2분마다 자동 갱신하고 중복 이벤트는 저장하지 않습니다.")
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                        ForEach(model.newsEvents.prefix(14)) { event in
                            NewsEventRow(event: event)
                        }
                    }
                }
            }
            .padding(12)
        }
    }

    private var communityMarket: String {
        let normalized = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if normalized.hasPrefix("KRW-") || normalized.hasSuffix("-USD") || normalized.hasSuffix("USDT") {
            return "CRYPTO"
        }
        if selectedSession.uppercased() == "KR" {
            return normalized.hasSuffix(".KQ") ? "KOSDAQ" : "KOSPI"
        }
        return "US"
    }

    private var tabResultPreview: String {
        if resultPreview.hasPrefix("뉴스·알림") || resultPreview.contains("뉴스와 관심목록") {
            return resultPreview
        }
        return ""
    }

    private func refreshNewsAndAlerts() async {
        let requestedSymbol = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let symbol = requestedSymbol.isEmpty ? "NVDA" : requestedSymbol
        isRefreshing = true
        defer { isRefreshing = false }
        resultPreview = "\(symbol) 뉴스와 관심목록 알림 조건을 갱신 중입니다."
        async let newsRefresh: Void = model.refreshNews()
        async let communityRefresh: Void = model.refreshCommunitySentiment(symbol: symbol, market: communityMarket)
        async let dashboardRefresh: Void = model.refreshTerminalDashboard(symbol: symbol, session: selectedSession)
        _ = await (newsRefresh, communityRefresh, dashboardRefresh)
        let dashboard = model.terminalDashboard?.symbol == symbol ? model.terminalDashboard : nil
        let evaluations = dashboard?.watchlistAlertEvaluations ?? []
        let triggered = evaluations.filter { $0.state == "triggered" }.count
        let credibilityCount = dashboard?.newsCredibility.count ?? 0
        let requestedCanonicalSymbol = canonicalCommunitySymbol(symbol)
        let currentCommunity = model.communitySentiment.flatMap { snapshot in
            snapshot.canonicalSymbol.uppercased() == requestedCanonicalSymbol ? snapshot : nil
        }
        resultPreview = [
            "뉴스·알림 갱신 요약",
            "- 종목: \(symbol) · 세션: \(selectedSession)",
            "- 공식/RSS 뉴스: \(model.newsEvents.count)건",
            "- 커뮤니티 근거: \(currentCommunity?.evidenceCount ?? 0)건 · 신뢰도 \(currentCommunity?.confidence ?? 0)%",
            "- 관심목록 조건 평가: \(evaluations.count)건",
            "- 발동 조건: \(triggered)건",
            "- 뉴스 신뢰도 소스: \(credibilityCount)개",
        ].joined(separator: "\n")
    }

    private func alertScopeLabel(_ scope: String) -> String {
        switch scope {
        case "momentum": return "모멘텀"
        case "position-risk": return "보유 리스크"
        case "news": return "뉴스"
        case "earnings": return "실적"
        default: return scope
        }
    }

    private func alertPriorityLabel(_ priority: String) -> String {
        switch priority {
        case "urgent": return "긴급"
        case "high": return "중요"
        default: return "활성"
        }
    }

    private func alertEvaluationLabel(_ state: String) -> String {
        switch state {
        case "triggered": return "발동"
        case "clear": return "정상"
        case "blocked": return "꺼짐"
        case "limited": return "제한 평가"
        case "unsupported": return "준비중"
        default: return state
        }
    }

    private func alertEvaluationTone(_ state: String) -> PillTone {
        switch state {
        case "triggered": return .amber
        case "clear": return .green
        case "blocked": return .red
        case "limited": return .amber
        case "unsupported": return .muted
        default: return .blue
        }
    }
}

struct ReplayTab: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @State private var isRefreshing = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                TabIntro(
                    title: "리플레이",
                    subtitle: "캔들, 뉴스, 시그널, RiskCheck, 주문 이벤트를 시간축으로 복기해 운영 판단을 개선합니다."
                ) {
                    Button(isRefreshing ? "갱신 중" : "리플레이 갱신") {
                        Task { await refreshReplay() }
                    }
                    .disabled(model.health == nil || isRefreshing)
                }

                ResultPreviewView(title: "리플레이 갱신 결과", resultPreview: tabResultPreview)

                HStack(alignment: .top, spacing: 12) {
                    PanelCard(title: "세션 리플레이 타임라인", badge: "P1", tone: .amber) {
                        ReplayRail()
                        if let events = model.terminalDashboard?.replayEvents, !events.isEmpty {
                            ForEach(events.prefix(8)) { event in
                                TimelineRow(
                                    time: shortTime(event.occurredAt),
                                    title: event.title,
                                    detail: event.detail,
                                    state: replayKindLabel(event.kind)
                                )
                            }
                        } else if model.newsEvents.isEmpty {
                            TimelineRow(time: "대기", title: "이벤트 없음", detail: "대시보드나 뉴스 이벤트를 불러오면 타임라인에 표시됩니다.", state: "대기")
                        } else {
                            ForEach(Array(model.newsEvents.prefix(5).enumerated()), id: \.element.id) { index, event in
                                TimelineRow(
                                    time: event.publishedAt?.prefix(16).description ?? "T-\(index)",
                                    title: event.title,
                                    detail: event.tickers.isEmpty ? event.sourceName : event.tickers.joined(separator: ", "),
                                    state: event.importance
                                )
                            }
                        }
                    }

                    PanelCard(title: "리플레이 판정", badge: "학습", tone: .green) {
                        MetricLine(title: "저장된 리플레이 이벤트", value: "\(model.terminalDashboard?.replayEvents.count ?? 0)개")
                        MetricLine(title: "차단 근거", value: model.liveGateLabel)
                        MetricLine(title: "놓친 알림", value: "0개")
                        MetricLine(title: "다음 개선", value: "쿨다운")
                        UnsupportedNote("리플레이는 백테스트 점수보다 운영 판단을 복기하는 용도입니다. 현재 OrderIntent/RiskCheck 이벤트를 로컬 저장소에 누적합니다.")
                    }
                }
            }
            .padding(12)
        }
    }

    private var tabResultPreview: String {
        if resultPreview.hasPrefix("리플레이") || resultPreview.contains("리플레이 이벤트") {
            return resultPreview
        }
        return ""
    }

    private func refreshReplay() async {
        let requestedSymbol = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let symbol = requestedSymbol.isEmpty ? "NVDA" : requestedSymbol
        isRefreshing = true
        resultPreview = "\(symbol) 리플레이 이벤트를 갱신 중입니다."
        await model.refreshNews()
        await model.refreshTerminalDashboard(symbol: symbol, session: selectedSession)
        let dashboard = model.terminalDashboard?.symbol == symbol ? model.terminalDashboard : nil
        let replayCount = dashboard?.replayEvents.count ?? 0
        let auditCount = dashboard?.auditTrail.count ?? 0
        resultPreview = [
            "리플레이 갱신 요약",
            "- 종목: \(symbol) · 세션: \(selectedSession)",
            "- 리플레이 이벤트: \(replayCount)건",
            "- 감사 로그: \(auditCount)건",
            "- 공식/RSS 뉴스: \(model.newsEvents.count)건",
            "- 실거래 게이트: \(model.liveGateLabel)",
        ].joined(separator: "\n")
        isRefreshing = false
    }

    private func replayKindLabel(_ kind: String) -> String {
        switch kind {
        case "candle": return "캔들"
        case "risk-check": return "리스크"
        case "live-gate": return "게이트"
        case "paper-order": return "모의"
        case "paper-execution": return "체결"
        case "news": return "뉴스"
        default: return "시그널"
        }
    }
}

struct PlaybookTab: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @State private var thesis = ""
    @State private var entryRule = ""
    @State private var invalidationRule = ""
    @State private var addRule = ""
    @State private var trimRule = ""
    @State private var target = ""
    @State private var workerMode = "paper-only"
    @State private var isSaving = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                TabIntro(
                    title: "포지션 플레이북",
                    subtitle: "진입, 손절, 추가매수, 축소/청산 조건을 저장해 수동 판단과 자동 워커가 같은 규칙을 보게 합니다."
                ) {
                    StatusPill(selectedSymbol.uppercased(), tone: .blue)
                    StatusPill(model.workerPausedEffective ? "워커 일시중지" : "워커 감시", tone: model.workerPausedEffective ? .amber : .green)
                }

                HStack(spacing: 10) {
                    FieldTile(title: "가설", value: model.terminalDashboard?.playbook.thesis ?? "대시보드 로드 필요")
                    FieldTile(title: "진입 방식", value: model.terminalDashboard?.playbook.entryRule ?? "-")
                    FieldTile(title: "무효화", value: model.terminalDashboard?.playbook.invalidationRule ?? "-")
                    FieldTile(title: "목표", value: model.terminalDashboard?.playbook.target ?? "-")
                }

                PanelCard(title: "플레이북 편집", badge: "CRUD", tone: .green) {
                    PlaybookEditorField(title: "가설", text: $thesis)
                    PlaybookEditorField(title: "진입", text: $entryRule)
                    PlaybookEditorField(title: "무효화", text: $invalidationRule)
                    PlaybookEditorField(title: "추가", text: $addRule)
                    PlaybookEditorField(title: "축소/청산", text: $trimRule)
                    PlaybookEditorField(title: "목표", text: $target)
                    HStack {
                        Picker("워커 모드", selection: $workerMode) {
                            Text("모의 전용").tag("paper-only")
                            Text("수동 승인").tag("manual-approval")
                            Text("비활성").tag("disabled")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 330)
                        Spacer()
                        Button(isSaving ? "저장 중" : "플레이북 저장") {
                            Task { await save() }
                        }
                        .disabled(model.health == nil || isSaving || thesis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(.top, 8)
                }

                HStack(alignment: .top, spacing: 12) {
                    PanelCard(title: "규칙 목록", badge: "P1", tone: .amber) {
                        if let playbook = model.terminalDashboard?.playbook {
                            PlaybookRuleRow(type: "진입", title: playbook.entryRule, detail: playbook.thesis, value: "지정가", state: "대기")
                            PlaybookRuleRow(type: "손절", title: playbook.invalidationRule, detail: "조건 충족 시 자동 축소 후보 생성", value: "보호", state: "보호")
                            PlaybookRuleRow(type: "추가", title: playbook.addRule, detail: "최대 추가 수량은 RiskCheck에서 제한", value: "제한", state: "제한")
                            PlaybookRuleRow(type: "청산", title: playbook.trimRule, detail: "workerMode=\(playbook.workerMode)", value: playbook.target, state: "계획")
                        } else {
                            EmptyState("플레이북을 불러오려면 엔진을 시작하세요.")
                        }
                    }

                    PanelCard(title: "자동 워커 연결", badge: "운영", tone: .blue) {
                        ChecklistRow(ok: true, title: "모의 실행 허용", detail: "플레이북 조건 충족 시 paper state에 주문 기록", state: "ON", tone: .green)
                        ChecklistRow(ok: false, title: "실거래 실행 차단", detail: "1.0.0 desktop policy로 broker submit 호출 금지", state: "OFF", tone: .red)
                        ChecklistRow(ok: model.terminalDashboard?.playbook.workerMode == "paper-only", title: "플레이북 저장소", detail: "local-engine dashboard store에서 종목별 플레이북을 유지합니다.", state: model.terminalDashboard?.playbook.workerMode ?? "대기", tone: .green)
                        ChecklistRow(ok: !model.workerPausedEffective, title: "워커 제어", detail: model.workerControlMessage, state: model.workerPausedEffective ? "일시중지" : "감시", tone: model.workerPausedEffective ? .amber : .green)
                        Toggle("워커 일시중지", isOn: Binding(
                            get: { model.workerPausedEffective },
                            set: { paused in
                                Task {
                                    await model.setWorkerPaused(
                                        paused,
                                        reason: paused ? "플레이북 탭 워커 일시중지" : "플레이북 탭 워커 재개"
                                    )
                                }
                            }
                        ))
                        .padding(.top, 8)
                        .disabled(model.workerControlTransitionPending || model.killSwitchTransitionPending)
                    }
                }
            }
            .padding(12)
        }
        .onAppear {
            loadFromDashboard()
        }
        .onChange(of: model.terminalDashboard?.playbook.updatedAt) {
            loadFromDashboard()
        }
    }

    private func loadFromDashboard() {
        guard let playbook = model.terminalDashboard?.playbook else {
            return
        }
        thesis = playbook.thesis
        entryRule = playbook.entryRule
        invalidationRule = playbook.invalidationRule
        addRule = playbook.addRule
        trimRule = playbook.trimRule
        target = playbook.target
        workerMode = playbook.workerMode
    }

    private func save() async {
        let now = ISO8601DateFormatter().string(from: Date())
        let playbook = DashboardPlaybook(
            symbol: selectedSymbol.uppercased(),
            thesis: thesis,
            entryRule: entryRule,
            invalidationRule: invalidationRule,
            addRule: addRule,
            trimRule: trimRule,
            target: target,
            workerMode: workerMode,
            updatedAt: now
        )
        isSaving = true
        resultPreview = "\(playbook.symbol) 플레이북을 저장 중입니다."
        resultPreview = await model.savePlaybook(playbook, session: selectedSession)
        isSaving = false
    }
}

struct DecisionPanel: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    @Binding var resultPreview: String
    @Binding var isLoading: Bool
    @State private var showingPaperResetConfirmation = false

    private var dashboard: TerminalDashboardSnapshot? {
        model.terminalDashboard?.symbol == selectedSymbol.uppercased() ? model.terminalDashboard : nil
    }

    private var actionSummary: String? {
        let lines = resultPreview
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("---") && !$0.hasPrefix("{") && !$0.hasPrefix("}") }
        guard !lines.isEmpty else {
            return nil
        }
        return lines.prefix(3).joined(separator: " · ")
    }

    private var actionTone: PillTone {
        if resultPreview.contains("실패") || resultPreview.contains("차단") {
            return .red
        }
        if resultPreview.contains("건너뜀") || resultPreview.contains("주의") {
            return .amber
        }
        if resultPreview.contains("저장") || resultPreview.contains("요약") || resultPreview.contains("완료") {
            return .green
        }
        return .amber
    }

    private var actionStatusLabel: String {
        switch actionTone {
        case .red: return "확인 필요"
        case .amber: return "확인"
        default: return "완료"
        }
    }

    private var liveSubmissionReady: Bool {
        !model.killSwitchEngaged && (model.localLiveTrading?.effective == true || model.brokerDiagnostics?.liveGate.liveTradingEffective == true)
    }

    private var liveGateGuardDetail: String {
        if liveSubmissionReady {
            return "로컬 운영자 게이트와 사용자 live 권한이 열려 있습니다. 주문은 여전히 OrderIntent/RiskCheck를 통과해야 합니다."
        }
        return "ENABLE_LIVE_TRADING, Toss credential/account, 사용자 live 권한, 공인 IP, kill switch 조건을 모두 확인합니다."
    }

    private func resetPaperTradingState() async {
        guard model.health != nil else {
            resultPreview = "로컬 엔진이 오프라인이라 모의 계좌를 초기화할 수 없습니다."
            return
        }
        isLoading = true
        resultPreview = "\(selectedSession) 모의 계좌를 기본 현금으로 초기화하는 중입니다."
        defer {
            isLoading = false
        }
        resultPreview = await model.resetPaperTradingState(symbol: selectedSymbol, session: selectedSession)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 7) {
                Text("판단 패널")
                    .font(.headline)
                Text("추천은 주문이 아니라 OrderIntent 후보입니다. 1.0.0에서는 RiskCheck를 통과해도 paper 주문만 생성합니다.")
                    .font(.caption)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.terminalPanel)

            HStack(spacing: 12) {
                ScoreRing(score: 67)
                VStack(alignment: .leading, spacing: 7) {
                    Text("매수 관찰 · 조건부 진입")
                        .font(.subheadline.weight(.semibold))
                    Text("추세와 수급은 우호적이지만, 실거래는 차단하고 지정가 모의 주문 후보만 생성합니다.")
                        .font(.caption)
                        .foregroundStyle(Color.terminalMuted)
                    StatusPill("리스크 중간", tone: .violet)
                }
            }
            .padding(14)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.terminalLine).frame(height: 1)
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "OrderIntent 미리보기", trailing: "미전송")
                LazyVGrid(columns: [GridItem(), GridItem()], spacing: 8) {
                    FieldTile(title: "방향", value: dashboard?.orderIntent.side == "buy" ? "매수" : "매도")
                    FieldTile(title: "유형", value: dashboard?.orderIntent.type == "limit" ? "지정가" : dashboard?.orderIntent.type ?? "-")
                    FieldTile(title: "수량", value: dashboard.map { "\($0.orderIntent.quantity)" } ?? "-")
                    FieldTile(title: "지정가", value: dashboard?.orderIntent.limitPrice.map { price($0, currency: dashboard?.orderIntent.currency ?? "USD") } ?? "-")
                    FieldTile(title: "손절", value: dashboard?.orderIntent.stopPrice.map { price($0, currency: dashboard?.orderIntent.currency ?? "USD") } ?? "-")
                    FieldTile(title: "유효시간", value: "20분")
                }
                HStack {
                    Button(isLoading ? "처리 중" : "모의 주문") {
                        Task {
                            guard let dashboard else {
                                return
                            }
                            isLoading = true
                            resultPreview = "\(dashboard.symbol) OrderIntent 모의 주문을 실행 중입니다. 실거래 broker 호출은 하지 않습니다."
                            defer {
                                isLoading = false
                            }
                            resultPreview = await model.runPaperOrderIntent(dashboard, session: selectedSession)
                        }
                    }
                    .disabled(model.health == nil || dashboard == nil || model.executionBlocked || isLoading)
                    Button(isLoading ? "처리 중" : "계획 저장") {
                        Task {
                            guard let dashboard else {
                                return
                            }
                            isLoading = true
                            resultPreview = "\(dashboard.symbol) OrderIntent 계획을 플레이북에 저장 중입니다."
                            defer {
                                isLoading = false
                            }
                            resultPreview = await model.saveOrderIntentPlan(dashboard, session: selectedSession)
                        }
                    }
                    .disabled(model.health == nil || dashboard == nil || isLoading)
                    Button(isLoading ? "처리 중" : "전략 초안") {
                        Task {
                            guard let dashboard else {
                                return
                            }
                            isLoading = true
                            resultPreview = "\(dashboard.symbol) OrderIntent에서 순환분할 전략 초안을 생성 중입니다."
                            defer {
                                isLoading = false
                            }
                            resultPreview = await model.createMagicSplitDraft(from: dashboard, session: selectedSession)
                        }
                    }
                    .disabled(model.health == nil || dashboard?.orderIntent.limitPrice == nil || isLoading)
                    Button(isLoading ? "처리 중" : "모의 초기화") {
                        showingPaperResetConfirmation = true
                    }
                    .disabled(model.health == nil || isLoading)
                }
                if let actionSummary {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("최근 액션")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.terminalMuted)
                            Spacer()
                            StatusPill(actionStatusLabel, tone: actionTone)
                        }
                        Text(actionSummary)
                            .font(.caption)
                            .foregroundStyle(Color.terminalText)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
                }
            }
            .padding(14)
            .background(Color.terminalPanel2)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.terminalLine).frame(height: 1)
            }

            ScrollView {
                VStack(spacing: 0) {
                    SectionHeader(title: "안전 게이트", trailing: "차단 우선")
                    GuardRow(ok: model.health?.ok == true, title: "Sidecar 상태", detail: model.health?.ok == true ? "로컬 엔진이 응답 중입니다." : "엔진 시작이 필요합니다.", state: model.health?.ok == true ? "정상" : "오프라인", tone: model.health?.ok == true ? .green : .red)
                    GuardRow(
                        ok: dashboard?.riskCheck.passed == true,
                        title: dashboard?.riskCheck.passed == true ? "RiskCheck 통과" : "RiskCheck 차단",
                        detail: dashboard?.riskCheck.blockers.joined(separator: " / ") ?? "SwiftUI는 broker 직접 호출 없이 sidecar 경계를 사용합니다.",
                        state: dashboard?.riskCheck.passed == true ? "정상" : "차단",
                        tone: dashboard?.riskCheck.passed == true ? .green : .red
                    )
                    GuardRow(
                        ok: liveSubmissionReady,
                        title: liveSubmissionReady ? "실거래 게이트 통과" : "실거래 게이트 차단",
                        detail: liveGateGuardDetail,
                        state: model.liveGateLabel,
                        tone: model.liveGateTone
                    )
                    GuardRow(ok: !model.killSwitchEngaged, title: "긴급 중지", detail: model.killSwitchMessage, state: model.killSwitchEngaged ? "중지" : "정상", tone: model.killSwitchEngaged ? .red : .green)
                    GuardRow(ok: dashboard?.auditTrail.isEmpty == false, title: "감사 로그", detail: "local-engine dashboard store에 OrderIntent/RiskCheck 스냅샷을 저장합니다.", state: dashboard?.auditTrail.isEmpty == false ? "저장" : "대기", tone: dashboard?.auditTrail.isEmpty == false ? .green : .amber)
                }
                .padding(14)
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "자동화 큐", trailing: model.workerPausedEffective ? "일시중지" : "감시")
                QueueRow(kind: "모의", title: "\(selectedSymbol.uppercased()) 계획 실행", status: model.workerPausedEffective ? "차단" : "대기")
                QueueRow(kind: "알림", title: "손절선 이탈 감시", status: "대기")
                QueueRow(kind: "브리핑", title: "장마감 리포트 생성", status: "16:05")
            }
            .padding(14)
            .background(Color.terminalPanel)
        }
        .background(Color.terminalPanel)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.terminalLine).frame(width: 1)
        }
        .confirmationDialog(
            "모의 계좌 초기화",
            isPresented: $showingPaperResetConfirmation,
            titleVisibility: .visible
        ) {
            Button("모의 계좌 초기화", role: .destructive) {
                Task {
                    await resetPaperTradingState()
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("paper state의 주문, 포지션, 현금 상태를 초기값으로 되돌립니다. 실거래 broker 주문은 제출하지 않습니다.")
        }
    }
}

struct EventTapeView: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String

    var body: some View {
        HStack(spacing: 0) {
            TapePane(title: "이벤트 테이프", trailing: "최신 저장") {
                if model.newsEvents.isEmpty {
                    TapeRow(time: "대기", title: "뉴스 이벤트 없음", detail: "뉴스 버튼으로 공식/RSS 이벤트를 불러오세요.", tag: "뉴스")
                } else {
                    ForEach(model.newsEvents.prefix(4)) { event in
                        TapeRow(time: event.publishedAt?.prefix(16).description ?? "now", title: event.title, detail: event.sourceName, tag: "뉴스")
                    }
                }
            }
            TapePane(title: "알림 매트릭스", trailing: "규칙") {
                if let evaluations = model.terminalDashboard?.watchlistAlertEvaluations, !evaluations.isEmpty {
                    ForEach(evaluations.prefix(3)) { evaluation in
                        TapeRow(
                            time: evaluation.symbol,
                            title: evaluation.title,
                            detail: evaluation.detail,
                            tag: alertEvaluationTag(evaluation.state)
                        )
                    }
                } else {
                    TapeRow(time: "대기", title: "알림 평가 없음", detail: "대시보드를 불러오면 관심목록 조건 평가가 표시됩니다.", tag: "대기")
                }
            }
            TapePane(title: "섹터 열지도", trailing: "1D") {
                HeatmapGrid()
            }
            TapePane(title: "모의 포트폴리오", trailing: paperSession) {
                if let state = model.paperTradingState {
                    if let account = paperAccount(in: state) {
                        TapeRow(
                            time: account.session,
                            title: "현금 \(price(account.cash, currency: account.currency))",
                            detail: "실현손익 \(money(account.realizedPnl, currency: account.currency)) · 포지션 \(state.positions.filter { $0.session == account.session }.count)개",
                            tag: "계좌"
                        )
                    }
                    if let position = selectedPosition(in: state) {
                        TapeRow(
                            time: position.symbol,
                            title: "\(quantityText(position.quantity))주 보유",
                            detail: "평단 \(price(position.averagePrice, currency: position.currency)) · 현재 \(price(position.lastPrice, currency: position.currency)) · 평가 \(money(unrealizedPnl(position), currency: position.currency))",
                            tag: "보유"
                        )
                    } else {
                        TapeRow(time: selectedSymbol.uppercased(), title: "보유 포지션 없음", detail: "모의 주문 실행 후 paper 포지션이 표시됩니다.", tag: "대기")
                    }
                    if let order = latestOrder(in: state) {
                        TapeRow(
                            time: shortTime(order.createdAt),
                            title: "\(order.symbol) \(order.side == "sell" ? "매도" : "매수") \(quantityText(order.quantity))주",
                            detail: "\(price(order.price, currency: order.currency)) · \(order.reason)",
                            tag: "주문"
                        )
                    }
                } else {
                    TapeRow(time: "대기", title: "모의 계좌 미조회", detail: model.paperTradingMessage, tag: "대기")
                }
            }
        }
        .background(Color.terminalPanel)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
    }

    private func alertEvaluationTag(_ state: String) -> String {
        switch state {
        case "triggered": return "발동"
        case "clear": return "정상"
        case "blocked": return "차단"
        case "limited": return "제한"
        case "unsupported": return "준비중"
        default: return state
        }
    }

    private var paperSession: String {
        model.terminalDashboard?.session == "KR" ? "KR" : "US"
    }

    private func paperAccount(in state: PaperTradingStateView) -> PaperTradingAccountView? {
        state.accounts[paperSession]
    }

    private func selectedPosition(in state: PaperTradingStateView) -> PaperTradingPositionView? {
        state.positions.first { position in
            position.session == paperSession &&
                position.symbol.uppercased() == selectedSymbol.uppercased()
        }
    }

    private func latestOrder(in state: PaperTradingStateView) -> PaperTradingOrderView? {
        state.orders.first { order in
            order.session == paperSession &&
                (order.symbol.uppercased() == selectedSymbol.uppercased() || selectedPosition(in: state) == nil)
        }
    }

    private func unrealizedPnl(_ position: PaperTradingPositionView) -> Double {
        (position.lastPrice - position.averagePrice) * position.quantity
    }

    private func quantityText(_ quantity: Double) -> String {
        if quantity.rounded() == quantity {
            return Int(quantity).formatted()
        }
        return String(format: "%.3f", quantity)
    }
}

struct MenuBarStatusView: View {
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var model: AppModel

    private var report: MenuBarStatusSnapshot {
        MenuBarStatusReport.make(from: MenuBarStatusReportInput(
            sidecarAvailable: model.health != nil,
            sidecarOK: model.health?.ok == true,
            statusLine: model.statusLine,
            liveGateLabel: model.liveGateLabel,
            killSwitchEngaged: model.killSwitchEngaged,
            workerPaused: model.workerPausedEffective,
            latestAlertTitles: model.latestAlerts.map(\.title),
            latestAlertCount: model.latestAlerts.count,
            hasHighImportanceAlert: model.latestAlerts.contains { $0.importance == "high" }
        ))
    }

    private var alertTone: PillTone {
        if report.alertSummary == "알림 후보 없음" {
            return .muted
        }
        return report.alertSummary.hasPrefix("긴급") ? .amber : .blue
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: model.menuBarIcon)
                Text(report.headline)
                    .font(.headline)
            }
            HStack {
                Button("열기") {
                    openWindow(id: "main")
                }
                Button(report.primaryActionTitle) {
                    if model.health == nil {
                        model.startSidecar()
                    } else {
                        Task { await model.refreshHealth() }
                    }
                }
                Button("뉴스") {
                    Task { await model.refreshNews() }
                }
                .disabled(!report.isNewsActionEnabled)
                Button("로그") {
                    model.openSidecarLog()
                }
            }
            HStack {
                StatusPill(report.sidecarLabel, tone: report.sidecarOK ? .green : .red)
                StatusPill(report.liveGateLabel, tone: model.liveGateTone)
                StatusPill(report.alertSummary, tone: alertTone)
            }
            Toggle("알림", isOn: Binding(
                get: { model.settings.alertsEnabled },
                set: { _ in model.toggleAlerts() }
            ))
            Toggle(report.workerLabel, isOn: Binding(
                get: { model.workerPausedEffective },
                set: { paused in
                    Task {
                        await model.setWorkerPaused(
                            paused,
                            reason: paused ? "메뉴바 워커 일시중지" : "메뉴바 워커 재개"
                        )
                    }
                }
            ))
            .disabled(model.workerControlTransitionPending || model.killSwitchTransitionPending)
            Button(report.killSwitchActionTitle) {
                Task {
                    await model.setKillSwitchEngaged(
                        !model.killSwitchEngaged,
                        reason: model.killSwitchEngaged ? "메뉴바에서 긴급 중지 해제" : "메뉴바 긴급 중지 버튼"
                    )
                }
            }
            .disabled(model.killSwitchTransitionPending)
            if !report.latestAlertTitles.isEmpty {
                Divider()
                ForEach(Array(report.latestAlertTitles.enumerated()), id: \.offset) { _, title in
                    Text(title)
                        .font(.caption)
                        .lineLimit(2)
                }
            }
        }
        .padding()
        .frame(width: 340)
    }
}

struct MarketStrip: View {
    @EnvironmentObject private var model: AppModel
    let selectedSymbol: String
    let selectedSession: String
    let analysis: MarketAnalysisSnapshot?

    private var selectedPriceValue: String {
        guard let analysis, let latestClose = analysis.latestClose else {
            return "분석 대기"
        }
        return price(latestClose, currency: analysis.currency)
    }

    private var selectedPriceDelta: String {
        analysis?.changeRatio.map { signedPercent($0) } ?? "분석 버튼"
    }

    private var selectedPriceTone: PillTone {
        guard let changeRatio = analysis?.changeRatio else {
            return .muted
        }
        return changeRatio >= 0 ? .green : .red
    }

    private var riskValue: String {
        guard let dashboard = currentDashboard else {
            return "대기"
        }
        return dashboard.riskCheck.passed ? "통과" : "차단"
    }

    private var riskDelta: String {
        guard let dashboard = currentDashboard else {
            return "RiskCheck 필요"
        }
        if dashboard.riskCheck.passed {
            return "\(dashboard.riskCheck.warnings.count) 주의"
        }
        return "\(dashboard.riskCheck.blockers.count) 사유"
    }

    private var riskTone: PillTone {
        guard let dashboard = currentDashboard else {
            return .muted
        }
        return dashboard.riskCheck.passed ? .green : .red
    }

    private var newsDelta: String {
        if model.latestAlerts.isEmpty {
            return model.newsEvents.isEmpty ? "뉴스 버튼" : "알림 후보 없음"
        }
        return "알림 후보 \(model.latestAlerts.count)"
    }

    private var newsTone: PillTone {
        model.latestAlerts.contains { $0.importance == "high" } ? .amber : model.newsEvents.isEmpty ? .muted : .blue
    }

    private var strategyValue: String {
        "\(activeStrategyCount)/\(model.strategyConfigs.count)"
    }

    private var strategyDelta: String {
        let drafts = model.strategyConfigs.filter { $0.status == "draft" }.count
        if model.strategyConfigs.isEmpty {
            return "전략 없음"
        }
        return drafts > 0 ? "초안 \(drafts)" : "자동화 준비"
    }

    private var strategyTone: PillTone {
        activeStrategyCount > 0 ? .green : model.strategyConfigs.isEmpty ? .muted : .amber
    }

    private var paperValue: String {
        guard let account = paperAccount else {
            return "미조회"
        }
        return price(account.cash, currency: account.currency)
    }

    private var paperDelta: String {
        guard let state = model.paperTradingState else {
            return "paper 상태 필요"
        }
        return "포지션 \(state.positions.count) · 주문 \(state.orders.count)"
    }

    private var paperTone: PillTone {
        paperAccount == nil ? .muted : .blue
    }

    private var currentDashboard: TerminalDashboardSnapshot? {
        guard model.terminalDashboard?.symbol.uppercased() == selectedSymbol.uppercased() else {
            return nil
        }
        return model.terminalDashboard
    }

    private var activeStrategyCount: Int {
        model.strategyConfigs.filter { $0.status == "enabled" }.count
    }

    private var paperAccount: PaperTradingAccountView? {
        model.paperTradingState?.accounts[selectedSession]
            ?? model.paperTradingState?.accounts[selectedSession.uppercased()]
            ?? model.paperTradingState?.accounts.values.first
    }

    var body: some View {
        HStack(spacing: 0) {
            MarketBox(title: selectedSymbol.uppercased(), value: selectedPriceValue, delta: selectedPriceDelta, tone: selectedPriceTone)
            MarketBox(title: "RiskCheck", value: riskValue, delta: riskDelta, tone: riskTone)
            MarketBox(title: "뉴스/RSS", value: "\(model.newsEvents.count)건", delta: newsDelta, tone: newsTone)
            MarketBox(title: "전략 활성", value: strategyValue, delta: strategyDelta, tone: strategyTone)
            MarketBox(title: "Paper 현금", value: paperValue, delta: paperDelta, tone: paperTone)
            MarketBox(title: "주문 모드", value: model.liveGateLabel, delta: model.killSwitchEngaged ? "긴급 중지" : "실주문 차단", tone: model.liveGateTone)
        }
        .frame(height: 76)
        .background(Color.terminalPanel)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
    }
}

struct ChartControlState: Equatable {
    var timeframe = "90d"
    var showHMA = true
    var showRSI = false
    var showVolume = true
    var showSignalMarkers = true

    var visibleCandleLimit: Int {
        switch timeframe {
        case "5m", "15m", "30m": return 180
        case "1h", "4h": return 160
        case "1wk": return 104
        default: return 120
        }
    }

    var timeframeLabel: String {
        switch timeframe {
        case "5m": return "5분봉"
        case "15m": return "15분봉"
        case "30m": return "30분봉"
        case "1h": return "1시간봉"
        case "4h": return "4시간봉"
        case "1wk": return "주봉"
        default: return "일봉"
        }
    }
}

struct ChartHeader: View {
    let selectedSymbol: String
    let analysis: MarketAnalysisSnapshot?
    @Binding var controls: ChartControlState

    private var priceText: String {
        guard let analysis, let latestClose = analysis.latestClose else {
            return "분석 대기"
        }
        return price(latestClose, currency: analysis.currency)
    }

    private var changeText: String {
        analysis?.changeRatio.map { signedPercent($0) } ?? "-"
    }

    private var changeTone: Color {
        guard let changeRatio = analysis?.changeRatio else {
            return .terminalMuted
        }
        return changeRatio >= 0 ? .terminalGreen : .terminalRed
    }

    private var subtitle: String {
        analysis?.tradeLabel ?? "분석 버튼으로 업데이트"
    }

    var body: some View {
        HStack {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Text(selectedSymbol.uppercased())
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                Text(priceText)
                    .foregroundStyle(Color.terminalMuted)
                Text(changeText)
                    .foregroundStyle(changeTone)
                Text(subtitle)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            HStack(spacing: 6) {
                SmallControlButton("30일", active: controls.timeframe == "30d") {
                    controls.timeframe = "30d"
                }
                SmallControlButton("90일", active: controls.timeframe == "90d") {
                    controls.timeframe = "90d"
                }
                SmallControlButton("1년", active: controls.timeframe == "1y") {
                    controls.timeframe = "1y"
                }
                SmallControlButton("HMA", active: controls.showHMA) {
                    controls.showHMA.toggle()
                }
                SmallControlButton("RSI", active: controls.showRSI) {
                    controls.showRSI.toggle()
                }
                SmallControlButton("거래량", active: controls.showVolume) {
                    controls.showVolume.toggle()
                }
                SmallControlButton("신호 마커", active: controls.showSignalMarkers) {
                    controls.showSignalMarkers.toggle()
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 54)
        .background(Color.terminalTopbar)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
    }
}

struct PriceChart: View {
    let selectedSymbol: String
    let analysis: MarketAnalysisSnapshot?
    let controls: ChartControlState

    private var currentSignalText: String {
        analysis?.tradeLabel ?? "분석 대기"
    }

    private var qualityText: String {
        guard let score = analysis?.chartQualityScore else {
            return "-"
        }
        return "\(String(format: "%.0f", score)) / 100"
    }

    private var qualityTone: PillTone {
        guard let score = analysis?.chartQualityScore else {
            return .muted
        }
        if score >= 70 {
            return .green
        }
        return score >= 50 ? .amber : .red
    }

    private var breakoutStateText: String {
        analysis?.breakoutStatus.map { analysisStatusLabel($0) } ?? "돌파 대기"
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            ChartGrid()
            CandlestickChart(analysis: analysis, controls: controls)
            VStack(spacing: 7) {
                BadgeLine(title: "현재 시그널", value: currentSignalText, tone: analysis == nil ? .muted : .green)
                BadgeLine(title: "모델 신뢰도", value: qualityText, tone: qualityTone)
                BadgeLine(title: "돌파 상태", value: breakoutStateText, tone: analysis == nil ? .muted : .amber)
                BadgeLine(title: "차트 보기", value: chartControlSummary, tone: .blue)
            }
            .frame(width: 270)
            .padding(14)
        }
        .frame(maxWidth: .infinity, minHeight: 360)
        .background(Color.terminalBackground)
    }

    private var chartControlSummary: String {
        [
            controls.timeframeLabel,
            controls.showHMA ? "HMA" : nil,
            controls.showRSI ? "RSI" : nil,
            controls.showVolume ? "VOL" : nil,
            controls.showSignalMarkers ? "SIGNAL" : nil,
        ]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

struct ChartGrid: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let xStep = proxy.size.width / 10
                let yStep = proxy.size.height / 7
                for index in 0...10 {
                    let x = CGFloat(index) * xStep
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: proxy.size.height))
                }
                for index in 0...7 {
                    let y = CGFloat(index) * yStep
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: proxy.size.width, y: y))
                }
            }
            .stroke(Color.white.opacity(0.04), lineWidth: 1)
        }
    }
}

struct CandlestickChart: View {
    let analysis: MarketAnalysisSnapshot?
    let controls: ChartControlState

    private var candles: [AnalysisCandle] {
        analysis?.candles ?? []
    }

    private var chartMarkers: [(label: String, color: Color)] {
        guard let analysis else {
            return []
        }

        var markers = analysis.recentSignals.prefix(2).map { signal in
            (
                label: chartSignalLabel(signal.label),
                color: chartSignalColor(signal.label)
            )
        }

        if let status = analysis.breakoutStatus, status != "none" {
            markers.append((label: "돌파", color: .terminalAmber))
        }

        if markers.isEmpty, !analysis.candles.isEmpty {
            markers.append((label: "신호 없음", color: .terminalMuted))
        }

        return Array(markers.prefix(3))
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if candles.count >= 2 {
                    let visible = Array(candles.suffix(controls.visibleCandleLimit))
                    let minLow = visible.map(\.low).min() ?? 0
                    let maxHigh = visible.map(\.high).max() ?? 1
                    let range = max(maxHigh - minLow, 0.01)
                    let step = visible.count > 1 ? proxy.size.width * 0.84 / CGFloat(visible.count - 1) : 0
                    let bodyWidth = min(max(proxy.size.width / CGFloat(max(visible.count, 1)) * 0.45, 5), 15)
                    let yForPrice: (Double) -> CGFloat = { value in
                        let normalized = (value - minLow) / range
                        return proxy.size.height * (0.88 - CGFloat(normalized) * 0.76)
                    }

                    if controls.showVolume {
                        let maxVolume = max(visible.map(\.volume).max() ?? 1, 1)
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, candle in
                            let x = proxy.size.width * 0.08 + CGFloat(index) * step
                            let height = max(CGFloat(candle.volume / maxVolume) * proxy.size.height * 0.16, 2)
                            Rectangle()
                                .fill(Color.terminalBlue.opacity(0.22))
                                .frame(width: max(bodyWidth * 0.72, 3), height: height)
                                .position(x: x, y: proxy.size.height * 0.94 - height / 2)
                        }
                    }

                    if controls.showHMA {
                        Path { path in
                            for (index, candle) in visible.enumerated() {
                                let point = CGPoint(
                                    x: proxy.size.width * 0.08 + CGFloat(index) * step,
                                    y: yForPrice(candle.close)
                                )
                                if index == 0 {
                                    path.move(to: point)
                                } else {
                                    path.addLine(to: point)
                                }
                            }
                        }
                        .stroke(Color.terminalBlue, style: StrokeStyle(lineWidth: 2, dash: [6, 7]))
                    }

                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, candle in
                        let x = proxy.size.width * 0.08 + CGFloat(index) * step
                        let openY = yForPrice(candle.open)
                        let closeY = yForPrice(candle.close)
                        let highY = yForPrice(candle.high)
                        let lowY = yForPrice(candle.low)
                        let color = candle.close >= candle.open ? Color.terminalGreen : Color.terminalRed
                        Rectangle()
                            .fill(color)
                            .frame(width: 2, height: max(abs(highY - lowY), 1))
                            .position(x: x, y: (highY + lowY) / 2)
                        Rectangle()
                            .fill(color)
                            .frame(width: bodyWidth, height: max(abs(openY - closeY), 2))
                            .position(x: x, y: (openY + closeY) / 2)
                    }

                    if controls.showRSI {
                        let latestRSI = AnalysisIndicators.relativeStrengthIndex(closes: visible.map(\.close))
                        IndicatorBand(
                            title: "RSI",
                            value: latestRSI.map { String(format: "%.0f", $0) } ?? "대기",
                            tone: rsiTone(latestRSI)
                        )
                            .position(x: proxy.size.width * 0.18, y: proxy.size.height * 0.91)
                    }
                } else {
                    EmptyChartState()
                        .position(x: proxy.size.width * 0.5, y: proxy.size.height * 0.48)

                    if controls.showRSI {
                        IndicatorBand(title: "RSI", value: "대기", tone: .muted)
                            .position(x: proxy.size.width * 0.18, y: proxy.size.height * 0.91)
                    }
                }

                if controls.showSignalMarkers {
                    ForEach(Array(chartMarkers.enumerated()), id: \.offset) { index, marker in
                        ChartMarker(label: marker.label, color: marker.color)
                            .position(
                                x: proxy.size.width * markerXPosition(index),
                                y: proxy.size.height * markerYPosition(index)
                            )
                    }
                }
            }
        }
    }

    private func chartSignalLabel(_ label: String) -> String {
        let normalized = label.lowercased()
        if normalized.contains("buy") || normalized.contains("매수") {
            return "매수"
        }
        if normalized.contains("sell") || normalized.contains("매도") {
            return "매도"
        }
        if normalized.contains("risk") || normalized.contains("리스크") {
            return "리스크"
        }
        if normalized.contains("news") || normalized.contains("뉴스") {
            return "뉴스"
        }
        return String(label.prefix(4))
    }

    private func chartSignalColor(_ label: String) -> Color {
        let normalized = label.lowercased()
        if normalized.contains("sell") || normalized.contains("매도") || normalized.contains("risk") || normalized.contains("리스크") {
            return .terminalRed
        }
        if normalized.contains("buy") || normalized.contains("매수") {
            return .terminalGreen
        }
        if normalized.contains("news") || normalized.contains("뉴스") {
            return .terminalAmber
        }
        return .terminalBlue
    }

    private func markerXPosition(_ index: Int) -> CGFloat {
        [0.58, 0.67, 0.84][min(index, 2)]
    }

    private func markerYPosition(_ index: Int) -> CGFloat {
        [0.27, 0.21, 0.25][min(index, 2)]
    }
}

struct PriceAxis: View {
    let analysis: MarketAnalysisSnapshot?

    private var labels: [String] {
        guard let candles = analysis?.candles, !candles.isEmpty else {
            return ["-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]
        }
        let minLow = candles.map(\.low).min() ?? 0
        let maxHigh = candles.map(\.high).max() ?? 1
        let range = max(maxHigh - minLow, 0.01)
        return (0..<10).map { index in
            let value = maxHigh - range * Double(index) / 9
            if value >= 1_000 {
                return String(format: "%.0f", value)
            }
            return String(format: "%.2f", value)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { _, value in
                Text(value)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.terminalMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(height: 1)
                    }
            }
        }
        .background(Color.terminalPanel2)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.terminalLine).frame(width: 1)
        }
    }
}

struct SignalStackPanel: View {
    let analysis: MarketAnalysisSnapshot?

    var body: some View {
        DetailPane(title: "시그널 스택", trailing: "엔진") {
            if let analysis {
                SignalRow(
                    tag: "판단",
                    text: analysis.tradeLabel ?? "분석 판단 없음",
                    value: analysis.reliabilityGrade.map { analysisGradeLabel($0) } ?? "-",
                    tone: .green
                )
                SignalRow(
                    tag: "품질",
                    text: analysis.chartQualityGrade.map { analysisGradeLabel($0) } ?? "차트 품질 점수 없음",
                    value: analysis.chartQualityScore.map { String(format: "%.0f", $0) } ?? "-",
                    tone: qualityTone(analysis.chartQualityScore)
                )
                SignalRow(
                    tag: "돌파",
                    text: analysis.breakoutPattern.map { analysisPatternLabel($0) } ?? "돌파 패턴 없음",
                    value: analysis.breakoutStatus.map { analysisStatusLabel($0) } ?? "-",
                    tone: analysis.breakoutStatus == nil ? .muted : .amber
                )
                if analysis.recentSignals.isEmpty {
                    SignalRow(tag: "신호", text: "최근 신호가 없습니다.", value: "-", tone: .muted)
                } else {
                    ForEach(analysis.recentSignals.prefix(2)) { signal in
                        SignalRow(tag: String(signal.label.prefix(5)), text: signal.reason, value: "최근", tone: .blue)
                    }
                }
            } else {
                SignalRow(tag: "대기", text: "상단 분석 버튼을 누르면 엔진 신호가 표시됩니다.", value: "-", tone: .muted)
                SignalRow(tag: "품질", text: "차트 품질 점수 준비 전입니다.", value: "-", tone: .muted)
                SignalRow(tag: "돌파", text: "돌파 신호 준비 전입니다.", value: "-", tone: .muted)
                SignalRow(tag: "신뢰", text: "신호 신뢰도 준비 전입니다.", value: "-", tone: .muted)
                SignalRow(tag: "리스크", text: "주문·리스크 탭에서 RiskCheck를 확인하세요.", value: "탭", tone: .amber)
            }
        }
    }
}

struct NewsImpactPanel: View {
    let events: [LocalNewsEvent]
    let selectedSymbol: String

    private var relevantEvents: [LocalNewsEvent] {
        let normalized = selectedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let macroTags: Set<String> = ["rate-policy", "employment", "gdp", "trade"]
        let isCrypto = normalized.contains("BTC") || normalized.contains("ETH") || normalized.hasPrefix("KRW-")
        return events.filter { event in
            event.tickers.contains { $0.uppercased() == normalized } ||
                !macroTags.isDisjoint(with: Set(event.tags)) ||
                (isCrypto && event.tags.contains("crypto"))
        }
    }

    var body: some View {
        DetailPane(title: "관련 뉴스", trailing: "종목+거시") {
            if events.isEmpty {
                SignalRow(tag: "대기", text: "뉴스 버튼으로 공식/RSS 이벤트를 불러오세요.", value: "-", tone: .muted)
            } else if relevantEvents.isEmpty {
                SignalRow(tag: "없음", text: "선택 종목 또는 주요 거시지표와 직접 연결된 뉴스가 없습니다.", value: selectedSymbol.uppercased(), tone: .muted)
            } else {
                ForEach(relevantEvents.prefix(5)) { event in
                    SignalRow(tag: event.importance, text: event.title, value: event.tickers.first ?? "뉴스", tone: event.importance == "high" ? .amber : .blue)
                }
            }
        }
    }
}

struct PositionMetricsPanel: View {
    let selectedSymbol: String
    let analysis: MarketAnalysisSnapshot?

    var body: some View {
        DetailPane(title: "포지션 지표", trailing: "포트폴리오") {
            MetricLine(title: "현재가", value: analysis.flatMap { snapshot in snapshot.latestClose.map { price($0, currency: snapshot.currency) } } ?? "분석 대기")
            MetricLine(title: "직전 캔들 대비", value: analysis?.changeRatio.map { signedPercent($0) } ?? "-")
            MetricLine(title: "진입 계획", value: analysis?.entryPlan ?? "분석 대기")
            MetricLine(title: "무효 조건", value: analysis?.invalidIf ?? "주문·리스크 탭 확인")
            MetricLine(title: "보상 / 리스크", value: analysis?.reliabilityRiskReward.map { String(format: "%.2fR", $0) } ?? "-")
        }
    }
}

struct PanelCard<Content: View>: View {
    let title: String
    let badge: String
    let tone: PillTone
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusPill(badge, tone: tone)
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(Color.terminalPanel2)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.terminalLine).frame(height: 1)
            }
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.terminalPanel)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }
}

struct TabIntro<Trailing: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            HStack(spacing: 7) {
                trailing
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.terminalPanel)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }
}

struct DetailPane<Content: View>: View {
    let title: String
    let trailing: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            SectionHeader(title: title, trailing: trailing)
            VStack(spacing: 0) {
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.terminalPanel)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.terminalLine).frame(width: 1)
        }
    }
}

struct SectionHeader: View {
    let title: String
    let trailing: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(trailing)
        }
        .font(.system(.caption2, design: .monospaced).weight(.semibold))
        .foregroundStyle(Color.terminalMuted)
        .frame(height: 34)
        .padding(.horizontal, 12)
        .background(Color.terminalPanel2)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine).frame(height: 1)
        }
    }
}

struct StatusPill: View {
    let text: String
    let tone: PillTone

    init(_ text: String, tone: PillTone) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .font(.system(.caption2, design: .rounded).weight(.bold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(minHeight: 22)
            .foregroundStyle(tone.color)
            .background(tone.color.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(tone.color.opacity(0.35)))
    }
}

struct MiniStat: View {
    let title: String
    let value: String
    let delta: String
    let tone: PillTone

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
            Text(value)
                .font(.system(.body, design: .monospaced).weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(delta)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(width: 1)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(height: 1)
        }
    }
}

struct ScannerChip: View {
    let title: String
    let active: Bool

    init(_ title: String, active: Bool) {
        self.title = title
        self.active = active
    }

    var body: some View {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(active ? Color.terminalGreen : Color.terminalMuted)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(active ? Color.terminalGreen.opacity(0.1) : Color.terminalPanel2, in: Capsule())
            .overlay(Capsule().stroke(active ? Color.terminalGreen.opacity(0.35) : Color.terminalLine))
    }
}

struct WatchRow: View {
    let item: WatchSymbol
    let active: Bool

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.symbol)
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                Text(item.name)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .lineLimit(1)
            }
            .frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.price)
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                Text(item.alert)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .lineLimit(1)
            }
            Spacer()
            Sparkline(up: item.isUp)
                .frame(width: 46, height: 18)
            Text(item.change)
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
                .foregroundStyle(item.isUp ? Color.terminalGreen : Color.terminalRed)
                .frame(width: 44, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .frame(height: 46)
        .background(active ? Color.terminalPanel3 : Color.terminalPanel)
        .overlay(alignment: .leading) {
            if active {
                Rectangle().fill(Color.terminalGreen).frame(width: 3)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(height: 1)
        }
    }
}

struct Sparkline: View {
    let up: Bool

    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let points: [CGPoint] = up
                    ? [
                        CGPoint(x: 0.02, y: 0.78), CGPoint(x: 0.18, y: 0.66), CGPoint(x: 0.34, y: 0.7),
                        CGPoint(x: 0.5, y: 0.42), CGPoint(x: 0.68, y: 0.48), CGPoint(x: 0.98, y: 0.18)
                    ]
                    : [
                        CGPoint(x: 0.02, y: 0.22), CGPoint(x: 0.2, y: 0.38), CGPoint(x: 0.38, y: 0.34),
                        CGPoint(x: 0.56, y: 0.58), CGPoint(x: 0.74, y: 0.54), CGPoint(x: 0.98, y: 0.78)
                    ]
                for (index, point) in points.enumerated() {
                    let mapped = CGPoint(x: point.x * proxy.size.width, y: point.y * proxy.size.height)
                    if index == 0 {
                        path.move(to: mapped)
                    } else {
                        path.addLine(to: mapped)
                    }
                }
            }
            .stroke(up ? Color.terminalGreen : Color.terminalRed, lineWidth: 2)
        }
    }
}

struct MarketBox: View {
    let title: String
    let value: String
    let delta: String
    let tone: PillTone

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
            Text(value)
                .font(.system(.body, design: .monospaced).weight(.bold))
            Text(delta)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(tone.color)
        }
        .padding(11)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.terminalLine.opacity(0.8)).frame(width: 1)
        }
    }
}

struct SmallControl: View {
    let title: String
    let active: Bool

    init(_ title: String, active: Bool = false) {
        self.title = title
        self.active = active
    }

    var body: some View {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(active ? Color.terminalText : Color.terminalMuted)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(active ? Color.terminalPanel3 : Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.terminalLine))
    }
}

struct SmallControlButton: View {
    let title: String
    let active: Bool
    let action: () -> Void

    init(_ title: String, active: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.active = active
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(active ? Color.terminalText : Color.terminalMuted)
                .padding(.horizontal, 8)
                .frame(height: 26)
                .background(active ? Color.terminalPanel3 : Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? Color.terminalGreen.opacity(0.45) : Color.terminalLine))
        }
        .buttonStyle(.plain)
        .help(active ? "\(title) 표시 중" : "\(title) 표시")
    }
}

struct BadgeLine: View {
    let title: String
    let value: String
    let tone: PillTone

    var body: some View {
        HStack {
            Text(title)
                .foregroundStyle(Color.terminalMuted)
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.bold))
                .foregroundStyle(tone.color)
        }
        .font(.caption)
        .padding(.horizontal, 9)
        .frame(height: 31)
        .background(Color.terminalBackground.opacity(0.88), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }
}

struct IndicatorBand: View {
    let title: String
    let value: String
    let tone: PillTone

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
            Capsule()
                .fill(tone.color.opacity(0.22))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(tone.color.opacity(0.85))
                        .frame(width: 42)
                }
                .frame(width: 92, height: 7)
            Text(value)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(Color.terminalBackground.opacity(0.9), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.terminalLine))
    }
}

struct EmptyChartState: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("캔들 데이터 없음")
                .font(.system(.callout, design: .monospaced).weight(.bold))
                .foregroundStyle(Color.terminalText)
            Text("분석 결과가 도착하면 실제 캔들과 지표만 표시합니다.")
                .font(.caption)
                .foregroundStyle(Color.terminalMuted)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(Color.terminalPanel.opacity(0.94), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
    }
}

struct ChartMarker: View {
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 9, height: 9)
            Text(label)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(color)
        }
    }
}

struct SignalRow: View {
    let tag: String
    let text: String
    let value: String
    let tone: PillTone

    var body: some View {
        HStack(spacing: 8) {
            StatusPill(tag, tone: tone)
                .frame(width: 66, alignment: .leading)
            Text(text)
                .font(.caption)
                .lineLimit(2)
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(tone.color)
        }
        .frame(minHeight: 35)
        .padding(.horizontal, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(height: 1)
        }
    }
}

struct MetricLine: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .foregroundStyle(Color.terminalMuted)
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
        }
        .font(.caption)
        .frame(minHeight: 35)
        .padding(.horizontal, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.7)).frame(height: 1)
        }
    }
}

struct ChecklistRow: View {
    let ok: Bool
    let title: String
    let detail: String
    let state: String
    let tone: PillTone

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Circle()
                .fill(ok ? Color.terminalGreen : tone.color)
                .frame(width: 10, height: 10)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            StatusPill(state, tone: tone)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct ScenarioRow: View {
    let title: String
    let value: String
    let ratio: Double
    let tone: PillTone

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(.caption, design: .monospaced))
                .frame(width: 102, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.terminalBackground)
                    Capsule().fill(tone.color).frame(width: proxy.size.width * ratio)
                }
            }
            .frame(height: 8)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(tone.color)
                .frame(width: 76, alignment: .trailing)
        }
        .padding(.vertical, 7)
    }
}

struct AuditRow: View {
    let time: String
    let title: String
    let detail: String
    let state: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(time)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 54, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            StatusPill(state, tone: state == "차단" ? .red : state == "준비중" ? .amber : .blue)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct AlertRuleRow: View {
    let scope: String
    let title: String
    let detail: String
    let state: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(scope)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 82, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            StatusPill(state, tone: state == "준비중" ? .amber : .green)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct AlertEvaluationRow: View {
    let scope: String
    let title: String
    let detail: String
    let state: String
    let tone: PillTone
    let evidence: [String]

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(scope)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 82, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                if !evidence.isEmpty {
                    Text(evidence.prefix(2).joined(separator: " · "))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.terminalBlue)
                        .lineLimit(2)
                }
            }
            Spacer()
            StatusPill(state, tone: tone)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct SourceScoreRow: View {
    let source: String
    let grade: String
    let score: String
    let detail: String

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(source)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            Text(grade)
                .font(.system(.body, design: .monospaced).weight(.bold))
            StatusPill(score, tone: grade == "D" ? .red : grade == "C" ? .amber : .green)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct NewsEventRow: View {
    let event: LocalNewsEvent

    private var destination: URL? {
        guard let url = URL(string: event.url),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }
        return url
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: event.importance == "high" ? "bell.badge" : "newspaper")
                .foregroundStyle(event.importance == "high" ? Color.terminalAmber : Color.terminalMuted)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(event.sourceName)
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                    StatusPill(event.importance, tone: event.importance == "high" ? .amber : .blue)
                }
                if let destination {
                    Link(event.title, destination: destination)
                        .font(.caption.weight(.semibold))
                        .lineLimit(2)
                } else {
                    Text(event.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(2)
                }
                if !event.tickers.isEmpty {
                    Text(event.tickers.joined(separator: "  "))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.terminalGreen)
                }
            }
            Spacer()
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

private func canonicalCommunitySymbol(_ value: String) -> String {
    var symbol = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if symbol.hasSuffix(".KS") || symbol.hasSuffix(".KQ") {
        symbol.removeLast(3)
    }
    if symbol.hasPrefix("KRW-") {
        symbol.removeFirst(4)
    }
    if symbol.hasSuffix("USDT") {
        symbol.removeLast(4)
    } else if symbol.hasSuffix("-USD") {
        symbol.removeLast(4)
    }
    return symbol
}

struct CommunitySentimentPanel: View {
    let snapshot: CommunitySentimentSnapshot?
    let selectedSymbol: String
    let message: String

    private var normalizedSelectedSymbol: String {
        canonicalCommunitySymbol(selectedSymbol)
    }

    private var currentSnapshot: CommunitySentimentSnapshot? {
        guard snapshot?.canonicalSymbol.uppercased() == normalizedSelectedSymbol else {
            return nil
        }
        return snapshot
    }

    var body: some View {
        PanelCard(
            title: "종목 민심",
            badge: currentSnapshot.map { "신뢰도 \($0.confidence)%" } ?? "대기",
            tone: currentSnapshot?.lowEvidence == false ? .green : .amber
        ) {
            if let snapshot = currentSnapshot {
                HStack(spacing: 8) {
                    StatusPill("공포 \(snapshot.painScore)", tone: snapshot.painScore >= 45 ? .red : .muted)
                    StatusPill("FOMO \(snapshot.gajuaScore)", tone: snapshot.gajuaScore >= 45 ? .amber : .muted)
                    StatusPill("분열 \(snapshot.divisionScore)", tone: snapshot.divisionScore >= 45 ? .amber : .muted)
                    StatusPill("근거 \(snapshot.evidenceCount)", tone: snapshot.lowEvidence ? .amber : .blue)
                    StatusPill(communityRegimeLabel(snapshot.sentimentRegime), tone: snapshot.lowEvidence ? .amber : .green)
                }
                Text(snapshot.lowEvidence ? "근거가 부족해 방향을 단정하지 않습니다. 아래 원문과 소스 상태를 먼저 확인하세요." : snapshot.verdict)
                    .font(.caption)
                    .foregroundStyle(Color.terminalText)
                    .fixedSize(horizontal: false, vertical: true)

                DisclosureGroup("수집 근거 자세히") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("핵심 요인")
                                    .font(.caption.weight(.semibold))
                                ForEach(snapshot.factors.sorted { $0.score > $1.score }.prefix(3)) { factor in
                                    Text("· \(factor.label) \(factor.value) · \(factor.score)")
                                        .font(.caption2)
                                        .foregroundStyle(Color.terminalMuted)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)

                            VStack(alignment: .leading, spacing: 5) {
                                Text("소스 상태")
                                    .font(.caption.weight(.semibold))
                                ForEach(snapshot.sourceStats.prefix(6)) { source in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("· \(source.label): \(communitySourceStatusLabel(source.status)) · \(source.itemCount)건")
                                            .font(.caption2)
                                            .foregroundStyle(source.status == "error" ? Color.terminalRed : Color.terminalMuted)
                                        if let reason = source.reason?.trimmingCharacters(in: .whitespacesAndNewlines),
                                           !reason.isEmpty {
                                            Text("  \(reason)")
                                                .font(.caption2)
                                                .foregroundStyle(Color.terminalMuted)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        ForEach(snapshot.snippets.prefix(3)) { snippet in
                            if let url = safeWebURL(snippet.url) {
                                Link(destination: url) {
                                    HStack {
                                        Text("[\(snippet.sourceLabel)] \(snippet.title)")
                                            .font(.caption2)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(snippet.reason)
                                            .font(.caption2)
                                            .foregroundStyle(Color.terminalMuted)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            } else {
                EmptyState(message)
            }
        }
    }

    private func communityRegimeLabel(_ value: String) -> String {
        switch value {
        case "panic": return "공포 우세"
        case "hype": return "과열 우세"
        case "divided": return "의견 분열"
        case "calm": return "차분"
        default: return "표본 부족"
        }
    }

    private func communitySourceStatusLabel(_ value: String) -> String {
        switch value {
        case "ok": return "정상"
        case "empty": return "근거 없음"
        case "configuration-required": return "API 설정 필요"
        case "spike-only": return "수동 확인"
        case "skipped": return "비활성"
        case "error": return "오류"
        default: return value
        }
    }

    private func safeWebURL(_ value: String) -> URL? {
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }
        return url
    }
}

struct ReplayRail: View {
    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.terminalBackground)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
            ForEach([0.18, 0.42, 0.57, 0.64, 0.78], id: \.self) { position in
                Circle()
                    .fill(position == 0.64 ? Color.terminalRed : position == 0.42 || position == 0.78 ? Color.terminalAmber : Color.terminalGreen)
                    .frame(width: 12, height: 12)
                    .offset(x: CGFloat(position) * 520, y: position == 0.64 ? 30 : position == 0.42 ? -2 : -26)
            }
            Rectangle()
                .fill(Color.terminalBlue)
                .frame(width: 2)
                .offset(x: 0.64 * 520)
        }
        .frame(height: 112)
        .padding(.bottom, 10)
    }
}

struct TimelineRow: View {
    let time: String
    let title: String
    let detail: String
    let state: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(time)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            StatusPill(state, tone: state == "high" ? .amber : .blue)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct PlaybookRuleRow: View {
    let type: String
    let title: String
    let detail: String
    let value: String
    let state: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(type)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
            }
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.bold))
                .frame(width: 70, alignment: .trailing)
            StatusPill(state, tone: state == "보호" ? .red : .blue)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct FieldTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.bold))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }
}

struct PlaybookEditorField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
            TextField(title, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.caption)
                .lineLimit(1...3)
                .padding(8)
                .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
        }
        .padding(.vertical, 5)
    }
}

struct GuardRow: View {
    let ok: Bool
    let title: String
    let detail: String
    let state: String
    let tone: PillTone

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Circle()
                .fill(tone.color)
                .frame(width: 10, height: 10)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            StatusPill(state, tone: tone)
        }
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct QueueRow: View {
    let kind: String
    let title: String
    let status: String

    var body: some View {
        HStack {
            StatusPill(kind, tone: kind == "모의" ? .green : .blue)
            Text(title)
                .font(.caption)
                .lineLimit(1)
            Spacer()
            Text(status)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
        }
        .frame(height: 30)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.5)).frame(height: 1)
        }
    }
}

struct ScoreRing: View {
    let score: Int

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.terminalGreen.opacity(0.14), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(score) / 100)
                .stroke(Color.terminalGreen, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(score)")
                .font(.system(size: 22, weight: .bold, design: .monospaced))
        }
        .frame(width: 86, height: 86)
    }
}

struct TapePane<Content: View>: View {
    let title: String
    let trailing: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            SectionHeader(title: title, trailing: trailing)
            VStack(spacing: 0) {
                content
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity)
        .background(Color.terminalPanel)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.terminalLine).frame(width: 1)
        }
    }
}

struct TapeRow: View {
    let time: String
    let title: String
    let detail: String
    let tag: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(time)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.terminalMuted)
                .frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .lineLimit(2)
            }
            Spacer()
            StatusPill(tag, tone: tag == "잠금" ? .red : .blue)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.terminalLine.opacity(0.65)).frame(height: 1)
        }
    }
}

struct HeatmapGrid: View {
    private let cells = [
        ("NVDA", true), ("AMD", true), ("TSLA", false), ("MSFT", true), ("SPY", true),
        ("AVGO", true), ("META", false), ("AAPL", true), ("QQQ", true), ("PLTR", true)
    ]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 5), spacing: 5) {
            ForEach(cells, id: \.0) { cell in
                Text(cell.0)
                    .font(.system(.caption2, design: .monospaced).weight(.bold))
                    .foregroundStyle(Color.terminalBackground)
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .background(cell.1 ? Color.terminalGreen : Color.terminalRed, in: RoundedRectangle(cornerRadius: 5))
            }
        }
        .padding(10)
    }
}

struct AutomationRunPreviewPanel: View {
    let run: AutomationCycleResponseView?

    var body: some View {
        if let run {
            PanelCard(title: "자동화 리허설", badge: run.dryRun == true ? "dry-run" : "실행", tone: runTone(run.result.status)) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 8) {
                        FieldTile(title: "상태", value: statusLabel(run.result.status))
                        FieldTile(title: "전략", value: "\(run.result.strategies ?? 0)개")
                        FieldTile(title: "발동", value: "\(run.result.triggers ?? 0)개")
                        FieldTile(title: "주문 후보", value: "\(run.result.orders ?? 0)건")
                    }
                    HStack(alignment: .top, spacing: 8) {
                        FieldTile(title: "차단", value: "\(run.result.blocked ?? 0)건")
                        FieldTile(title: "거절", value: "\(run.result.rejected ?? 0)건")
                        FieldTile(title: "제출", value: "\(run.result.submitted ?? 0)건")
                        FieldTile(title: "체결 동기화", value: "\(run.result.newFills ?? 0)건")
                    }

                    if let reason = run.result.reason {
                        GuardRow(
                            ok: run.result.status == "ready" || run.result.status == "preview",
                            title: "현재 차단/준비 사유",
                            detail: reasonLabel(reason),
                            state: run.result.liveTradingEnabled == true ? "Live 가능" : "paper-only",
                            tone: run.result.liveTradingEnabled == true ? .green : .amber
                        )
                    }

                    if let safety = run.result.safety {
                        Text(safety)
                            .font(.caption2)
                            .foregroundStyle(Color.terminalMuted)
                    }

                    let evaluations = run.result.evaluations ?? []
                    if evaluations.isEmpty {
                        EmptyState(emptyEvaluationMessage(for: run))
                    } else {
                        ForEach(evaluations.prefix(5)) { evaluation in
                            AutomationEvaluationRow(evaluation: evaluation)
                        }
                    }
                }
            }
        }
    }

    private func runTone(_ status: String) -> PillTone {
        switch status {
        case "ready", "preview", "ran": return .green
        case "blocked", "error": return .red
        case "skipped": return .amber
        default: return .muted
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "ready": return "실행 준비"
        case "preview": return "리허설 완료"
        case "ran": return "실행 완료"
        case "blocked": return "차단"
        case "skipped": return "건너뜀"
        case "error": return "오류"
        default: return status
        }
    }

    private func emptyEvaluationMessage(for run: AutomationCycleResponseView) -> String {
        let strategies = run.result.strategies ?? 0
        guard strategies > 0 else {
            return "활성 전략 리허설 결과가 없습니다. 전략을 시뮬레이션 후 활성화하고 자동화 점검을 실행하세요."
        }
        if let reason = run.result.reason {
            return "활성 전략 \(strategies)개를 확인했지만 이번 실행은 건너뛰었습니다. \(reasonLabel(reason))"
        }
        if run.result.status == "skipped" {
            return "활성 전략 \(strategies)개를 확인했지만 이번 실행은 건너뛰었습니다. Toss 조회 설정, RiskCheck, worker 상태를 확인하세요."
        }
        return "활성 전략 \(strategies)개를 확인했습니다. 이번 tick에서는 발동 조건이 없어 주문 후보가 생성되지 않았습니다."
    }

    private func reasonLabel(_ reason: String) -> String {
        switch reason {
        case "no-credentials": return "검증된 Toss API 키가 없어 자동화 실행을 건너뛰었습니다. Toss 설정에서 credential을 검증 후 저장하세요."
        case "paper-preview-no-credentials": return "Toss API 키 없이 활성 전략을 paper 모드로 리허설했습니다."
        case "paper-preview-account-selection-required": return "자동화 계좌 선택 전 상태로 활성 전략을 paper 모드로 리허설했습니다."
        case "paper-preview-ready": return "paper dry-run으로 broker 주문 제출 없이 리허설했습니다."
        case "paper-preview-live-gate-closed": return "1.0.0 paper-only 정책에 따라 broker 제출 없이 리허설했습니다."
        case "paper-automation-no-credentials": return "Toss API 키 없이 로컬 모의 계좌에 자동화 결과를 기록했습니다."
        case "paper-automation-account-selection-required": return "자동화 계좌 선택 전 상태로 로컬 모의 계좌에 결과를 기록했습니다."
        case "paper-automation-live-gate-closed": return "1.0.0 paper-only 정책에 따라 로컬 모의 계좌에 자동화 결과를 기록했습니다."
        case "no-enabled-strategies": return "활성화된 자동매매 전략이 없습니다."
        case "no-account": return "Toss 계좌를 찾지 못했습니다."
        case "account-selection-required": return "자동거래 계좌 선택이 필요합니다."
        case "preferred-account-unavailable": return "선택한 자동거래 계좌를 현재 Toss 계좌 목록에서 찾지 못했습니다."
        case "kill-switch": return "긴급 중지가 켜져 자동화 큐를 차단했습니다."
        case "worker-paused": return "워커 일시중지 상태라 자동화 큐를 차단했습니다."
        default: return reason
        }
    }
}

struct AutomationEvaluationRow: View {
    let evaluation: AutomationStrategyEvaluationView

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                StatusPill(evaluation.symbol, tone: evaluation.triggers > 0 ? .amber : .muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(evaluation.name)
                        .font(.caption.weight(.semibold))
                    Text(evaluation.summary?.headline ?? "전략 평가 요약이 없습니다.")
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(evaluation.marketPrice.map { String(format: "%.2f", $0) } ?? "-")
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                    Text(modeLabel(evaluation.summary?.mode ?? evaluation.mode))
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                }
            }

            HStack(spacing: 6) {
                StatusPill("발동 \(evaluation.triggers)", tone: evaluation.triggers > 0 ? .amber : .muted)
                StatusPill("주문 \(evaluation.orders.count)", tone: evaluation.orders.isEmpty ? .muted : .blue)
                StatusPill("차단 \(evaluation.summary?.blockedOrders ?? blockedCount)", tone: blockedCount > 0 ? .red : .muted)
                StatusPill("거절 \(evaluation.summary?.rejectedOrders ?? rejectedCount)", tone: rejectedCount > 0 ? .amber : .muted)
            }

            if !evaluation.orders.isEmpty {
                ForEach(evaluation.orders.prefix(3)) { order in
                    Text(orderText(order))
                        .font(.caption2)
                        .foregroundStyle(order.status == "blocked" ? Color.terminalAmber : order.status == "error" ? Color.terminalRed : Color.terminalText)
                        .lineLimit(2)
                }
            } else if let nextAction = evaluation.summary?.nextAction {
                Text("다음 행동: \(nextAction)")
                    .font(.caption2)
                    .foregroundStyle(Color.terminalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let blocker = evaluation.summary?.blockers?.first {
                Text("차단 근거: \(blocker)")
                    .font(.caption2)
                    .foregroundStyle(Color.terminalAmber)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalLine))
    }

    private var blockedCount: Int {
        evaluation.orders.filter { $0.status == "blocked" }.count
    }

    private var rejectedCount: Int {
        evaluation.orders.filter { $0.status == "rejected" }.count
    }

    private func modeLabel(_ mode: String) -> String {
        switch mode {
        case "1% 순환매매", "loop-grid": return "1% 순환"
        case "분할 그리드", "percent-grid": return "분할"
        default: return mode
        }
    }

    private func orderText(_ order: AutomationOrderOutcomeView) -> String {
        let side = order.side == "sell" ? "매도" : "매수"
        let priceText = order.limitPrice.map { String(format: "%.2f", $0) } ?? "시장가"
        let quantityText = String(format: "%.0f", order.quantity)
        return "- \(side) \(quantityText)주 @ \(priceText) · \(orderStatusLabel(order.status)) · \(order.message)"
    }

    private func orderStatusLabel(_ status: String) -> String {
        switch status {
        case "submitted": return "제출"
        case "blocked": return "차단"
        case "rejected": return "거절"
        case "error": return "오류"
        default: return status
        }
    }
}

struct ResultPreviewView: View {
    let title: String
    let resultPreview: String

    var body: some View {
        if !resultPreview.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(title)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("원문")
                        .font(.caption2)
                        .foregroundStyle(Color.terminalMuted)
                }
                ScrollView {
                    Text(resultPreview)
                        .font(.system(.caption2, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 220)
            }
            .padding(12)
            .background(Color.terminalPanel, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.terminalLine))
        }
    }
}

struct EmptyState: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Color.terminalMuted)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(Color.terminalPanel2, in: RoundedRectangle(cornerRadius: 7))
    }
}

struct UnsupportedNote: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(Color.terminalAmber)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.terminalAmber.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.terminalAmber.opacity(0.24)))
            .padding(.top, 8)
    }
}

private func shortTime(_ isoString: String) -> String {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let standardFormatter = ISO8601DateFormatter()
    if let date = fractionalFormatter.date(from: isoString) ?? standardFormatter.date(from: isoString) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    return String(isoString.prefix(5))
}

private func money(_ value: Double, currency: String) -> String {
    let sign = value >= 0 ? "+" : "-"
    return "\(sign)\(price(abs(value), currency: currency))"
}

private func price(_ value: Double, currency: String) -> String {
    if currency == "KRW" {
        return "₩\(Int(value.rounded()).formatted())"
    }
    return "$\(String(format: "%.2f", value))"
}

private func quantityLabel(_ quantity: Double?) -> String {
    guard let quantity else {
        return "-"
    }
    if quantity.rounded() == quantity {
        return Int(quantity).formatted()
    }
    return String(format: "%.3f", quantity)
}

private func signedPercent(_ value: Double) -> String {
    let sign = value > 0 ? "+" : ""
    return "\(sign)\(String(format: "%.2f", value * 100))%"
}

private func qualityTone(_ score: Double?) -> PillTone {
    guard let score else {
        return .muted
    }
    if score >= 70 {
        return .green
    }
    return score >= 50 ? .amber : .red
}

private func rsiTone(_ value: Double?) -> PillTone {
    guard let value else {
        return .muted
    }
    if value >= 70 || value <= 30 {
        return .amber
    }
    return .blue
}

private func analysisStatusLabel(_ status: String) -> String {
    switch status {
    case "triggered": return "발동"
    case "confirmed", "active": return "확인"
    case "watch", "watching": return "관찰"
    case "pending": return "대기"
    case "risk-off": return "위험 우선"
    case "failed", "invalid": return "무효"
    case "none": return "없음"
    default: return status
    }
}

private func analysisGradeLabel(_ grade: String) -> String {
    switch grade {
    case "high": return "높음"
    case "medium", "mid": return "보통"
    case "low": return "낮음"
    case "watch": return "관찰"
    default: return grade
    }
}

private func analysisPatternLabel(_ pattern: String) -> String {
    switch pattern {
    case "ma-reclaim": return "이평선 회복"
    case "new-high": return "신고가 돌파"
    case "support-bounce": return "지지 반등"
    case "range-breakout": return "박스권 돌파"
    default: return pattern
    }
}

@MainActor
final class NotificationService {
    func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    func deliver(event: LocalNewsEvent) async {
        let content = UNMutableNotificationContent()
        content.title = event.sourceName
        content.body = event.title
        content.sound = .default
        content.userInfo = ["url": event.url]
        let request = UNNotificationRequest(
            identifier: "news-\(event.dedupeKey)",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    func deliverCrashSignal(_ item: WatchlistSignalItem) async {
        guard let plan = item.signal.exitPlan else { return }
        let content = UNMutableNotificationContent()
        content.title = "\(item.name ?? item.symbol) · 매수 검토 가능"
        content.body = "기준 \(Self.price(plan.entryPrice)) · 손절 \(Self.price(plan.stopPrice)) · 1차 \(Self.price(plan.firstTakeProfit)) · 자동 주문 아님"
        content.sound = .default
        content.userInfo = ["symbol": item.symbol, "kind": "crash-reversal"]
        let request = UNNotificationRequest(
            identifier: "crash-\(item.notificationId ?? item.symbol)",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    private static func price(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(value >= 1_000 ? 0 : 2)))
    }
}

private extension Color {
    static let terminalBackground = Color(red: 0.027, green: 0.063, blue: 0.098)
    static let terminalTopbar = Color(red: 0.035, green: 0.075, blue: 0.114)
    static let terminalPanel = Color(red: 0.047, green: 0.090, blue: 0.133)
    static let terminalPanel2 = Color(red: 0.067, green: 0.122, blue: 0.173)
    static let terminalPanel3 = Color(red: 0.082, green: 0.145, blue: 0.204)
    static let terminalLine = Color(red: 0.129, green: 0.208, blue: 0.275)
    static let terminalText = Color(red: 0.933, green: 0.965, blue: 0.973)
    static let terminalMuted = Color(red: 0.569, green: 0.659, blue: 0.718)
    static let terminalGreen = Color(red: 0.263, green: 0.839, blue: 0.682)
    static let terminalRed = Color(red: 1.000, green: 0.490, blue: 0.525)
    static let terminalAmber = Color(red: 0.953, green: 0.718, blue: 0.416)
    static let terminalBlue = Color(red: 0.431, green: 0.667, blue: 1.000)
    static let terminalViolet = Color(red: 0.647, green: 0.549, blue: 0.894)
}
