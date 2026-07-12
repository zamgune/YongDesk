import Foundation

public enum ManagedChildProcessTerminator {
    public static func terminate(
        _ process: Process,
        gracePeriod: TimeInterval = 1,
        forcePeriod: TimeInterval = 0.5
    ) {
        guard process.isRunning else {
            return
        }
        process.terminate()
        if waitForExit(process, timeout: gracePeriod) {
            return
        }
        let killer = Process()
        killer.executableURL = URL(fileURLWithPath: "/bin/kill")
        killer.arguments = ["-KILL", "\(process.processIdentifier)"]
        try? killer.run()
        killer.waitUntilExit()
        _ = waitForExit(process, timeout: forcePeriod)
    }

    private static func waitForExit(_ process: Process, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        return !process.isRunning
    }
}
