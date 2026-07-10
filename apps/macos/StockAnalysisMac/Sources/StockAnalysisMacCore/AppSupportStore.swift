import Foundation

public final class AppSupportStore: Sendable {
    public static let rootOverrideEnvironmentKey = "STOCK_ANALYSIS_MAC_APP_SUPPORT_ROOT"

    public let rootURL: URL

    public init(
        fileManager: FileManager = .default,
        bundleIdentifier: String = "com.stockanalysis.mac"
    ) throws {
        if let overrideRoot = Self.rootOverrideURL() {
            self.rootURL = overrideRoot
            try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
            return
        }
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        self.rootURL = base.appending(path: bundleIdentifier, directoryHint: .isDirectory)
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    public init(rootURL: URL, fileManager: FileManager = .default) throws {
        self.rootURL = rootURL
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    public var settingsURL: URL {
        rootURL.appending(path: "settings.json")
    }

    public var sqliteURL: URL {
        rootURL.appending(path: "stock-analysis.sqlite3")
    }

    public var sidecarStorageRoot: URL {
        rootURL.appending(path: "sidecar", directoryHint: .isDirectory)
    }

    public var logsURL: URL {
        rootURL.appending(path: "logs", directoryHint: .isDirectory)
    }

    public var sidecarLogURL: URL {
        logsURL.appending(path: "sidecar.log")
    }

    public var brokerEncryptionKeyURL: URL {
        rootURL.appending(path: "broker-credential.key")
    }

    public func loadSettings() -> AppSettings {
        guard let data = try? Data(contentsOf: settingsURL) else {
            return AppSettings()
        }
        return (try? JSONDecoder().decode(AppSettings.self, from: data)) ?? AppSettings()
    }

    public func saveSettings(_ settings: AppSettings) throws {
        let data = try JSONEncoder.pretty.encode(settings)
        try data.write(to: settingsURL, options: [.atomic])
    }

    public func prepareSidecarStorage() throws {
        try FileManager.default.createDirectory(at: sidecarStorageRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: logsURL, withIntermediateDirectories: true)
    }

    private static func rootOverrideURL() -> URL? {
        guard let value = ProcessInfo.processInfo.environment[rootOverrideEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        let expanded = (value as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded, isDirectory: true)
    }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}
