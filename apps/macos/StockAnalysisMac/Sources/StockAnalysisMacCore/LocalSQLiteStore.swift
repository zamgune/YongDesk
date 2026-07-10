import Foundation
import SQLite3

public final class LocalSQLiteStore: Sendable {
    public let databaseURL: URL

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL
    }

    public func migrate() throws {
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let db = try open()
        defer { sqlite3_close(db) }
        try execute("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS news_events (
                dedupe_key TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                published_at TEXT,
                importance TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notification_log (
                id TEXT PRIMARY KEY,
                event_key TEXT NOT NULL,
                delivered_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
            VALUES (1, datetime('now'));
            """, db: db)
    }

    private func open() throws -> OpaquePointer {
        var db: OpaquePointer?
        let status = sqlite3_open(databaseURL.path(percentEncoded: false), &db)
        guard status == SQLITE_OK, let db else {
            throw SQLiteStoreError.openFailed(message: String(cString: sqlite3_errmsg(db)))
        }
        return db
    }

    private func execute(_ sql: String, db: OpaquePointer) throws {
        var error: UnsafeMutablePointer<CChar>?
        let status = sqlite3_exec(db, sql, nil, nil, &error)
        guard status == SQLITE_OK else {
            let message = error.map { String(cString: $0) } ?? "sqlite error \(status)"
            sqlite3_free(error)
            throw SQLiteStoreError.executionFailed(message: message)
        }
    }
}

public enum SQLiteStoreError: Error, Equatable, Sendable {
    case openFailed(message: String)
    case executionFailed(message: String)
}
