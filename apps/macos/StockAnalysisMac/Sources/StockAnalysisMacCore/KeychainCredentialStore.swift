import Foundation
import LocalAuthentication
import Security

public protocol CredentialStoring: Sendable {
    func save(_ credential: BrokerCredential) throws
    func reauthorize(_ credential: BrokerCredential) throws
    func saveSecret(_ value: String, account: String) throws
    func readSecret(account: String) throws -> String?
    func readSecretInteractively(account: String) throws -> String?
    func read(broker: String) throws -> BrokerCredential?
    func readInteractively(broker: String) throws -> BrokerCredential?
    func delete(broker: String) throws
}

public final class KeychainCredentialStore: CredentialStoring, Sendable {
    private let service: String

    public init(service: String = "com.stockanalysis.mac.broker") {
        self.service = service
    }

    public func save(_ credential: BrokerCredential) throws {
        let data = try JSONEncoder().encode(credential)
        try saveData(data, account: credential.broker)
    }

    public func reauthorize(_ credential: BrokerCredential) throws {
        let data = try JSONEncoder().encode(credential)
        try replaceDataAuthorization(data, account: credential.broker)
    }

    public func saveSecret(_ value: String, account: String) throws {
        try saveData(Data(value.utf8), account: account)
    }

    private func saveData(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.unhandled(updateStatus)
        }
        try addData(data, account: account)
    }

    private func replaceDataAuthorization(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let deleteStatus = SecItemDelete(query as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw KeychainError.unhandled(deleteStatus)
        }
        do {
            try addData(data, account: account)
        } catch {
            try? addData(data, account: account)
            throw error
        }
    }

    private func addData(_ data: Data, account: String) throws {
        var addQuery = baseQuery(account: account)
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status)
        }
    }

    public func readSecret(account: String) throws -> String? {
        try readSecret(account: account, allowInteraction: false)
    }

    public func readSecretInteractively(account: String) throws -> String? {
        try readSecret(account: account, allowInteraction: true)
    }

    private func readSecret(account: String, allowInteraction: Bool) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        configureAuthentication(in: &query, allowInteraction: allowInteraction)
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandled(status)
        }
        return String(data: data, encoding: .utf8)
    }

    public func read(broker: String = "toss") throws -> BrokerCredential? {
        try read(broker: broker, allowInteraction: false)
    }

    public func readInteractively(broker: String = "toss") throws -> BrokerCredential? {
        try read(broker: broker, allowInteraction: true)
    }

    private func read(broker: String, allowInteraction: Bool) throws -> BrokerCredential? {
        var query = baseQuery(account: broker)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        configureAuthentication(in: &query, allowInteraction: allowInteraction)
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandled(status)
        }
        return try JSONDecoder().decode(BrokerCredential.self, from: data)
    }

    public func delete(broker: String = "toss") throws {
        let status = SecItemDelete(baseQuery(account: broker) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func configureAuthentication(in query: inout [String: Any], allowInteraction: Bool) {
        guard !allowInteraction else {
            return
        }
        let context = LAContext()
        context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    }
}

public struct StartupCredentialSnapshot: Sendable {
    public let reddit: BrokerCredential?

    public init(reddit: BrokerCredential?) {
        self.reddit = reddit
    }
}

public enum StartupCredentialLoader {
    public static func load(using store: any CredentialStoring) throws -> StartupCredentialSnapshot {
        StartupCredentialSnapshot(reddit: try store.read(broker: "reddit"))
    }
}

public struct KeychainAccessResetResult: Sendable {
    public let credentialCount: Int
    public let hasToss: Bool
    public let hasReddit: Bool
}

public enum KeychainAccessResetter {
    public static func reset(using store: any CredentialStoring) throws -> KeychainAccessResetResult {
        var credentials = try ["toss", "upbit", "bithumb", "reddit"].compactMap {
            try store.readInteractively(broker: $0)
        }
        if !credentials.contains(where: { $0.broker == "reddit" }),
           let legacyClientId = try store.readSecretInteractively(account: "reddit-client-id"),
           let legacyClientSecret = try store.readSecretInteractively(account: "reddit-client-secret") {
            credentials.append(BrokerCredential(
                broker: "reddit",
                clientId: legacyClientId,
                clientSecret: legacyClientSecret
            ))
        }
        for credential in credentials {
            try store.reauthorize(credential)
        }
        try? store.delete(broker: "reddit-client-id")
        try? store.delete(broker: "reddit-client-secret")
        return KeychainAccessResetResult(
            credentialCount: credentials.count,
            hasToss: credentials.contains { $0.broker == "toss" },
            hasReddit: credentials.contains { $0.broker == "reddit" }
        )
    }
}

public enum KeychainError: Error, Equatable, Sendable {
    case unhandled(OSStatus)
}
