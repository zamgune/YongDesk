import Foundation
import LocalAuthentication
import Security

public final class KeychainCredentialStore: Sendable {
    private let service: String

    public init(service: String = "com.stockanalysis.mac.broker") {
        self.service = service
    }

    public func save(_ credential: BrokerCredential) throws {
        let data = try JSONEncoder().encode(credential)
        try saveData(data, account: credential.broker)
    }

    public func saveSecret(_ value: String, account: String) throws {
        try saveData(Data(value.utf8), account: account)
    }

    private func saveData(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        SecItemDelete(query as CFDictionary)
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status)
        }
    }

    public func readSecret(account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = noninteractiveContext()
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
        var query = baseQuery(account: broker)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = noninteractiveContext()
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

    private func noninteractiveContext() -> LAContext {
        let context = LAContext()
        context.interactionNotAllowed = true
        return context
    }
}

public enum KeychainError: Error, Equatable, Sendable {
    case unhandled(OSStatus)
}
