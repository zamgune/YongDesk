// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "StockAnalysisMac",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "StockAnalysisMacCore", targets: ["StockAnalysisMacCore"]),
        .executable(name: "StockAnalysisMac", targets: ["StockAnalysisMac"]),
        .executable(name: "StockAnalysisMacSmokeTests", targets: ["StockAnalysisMacSmokeTests"])
    ],
    targets: [
        .target(
            name: "StockAnalysisMacCore",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedLibrary("sqlite3")
            ]
        ),
        .executableTarget(
            name: "StockAnalysisMac",
            dependencies: ["StockAnalysisMacCore"]
        ),
        .executableTarget(
            name: "StockAnalysisMacSmokeTests",
            dependencies: ["StockAnalysisMacCore"],
            path: "Tests/StockAnalysisMacSmokeTests"
        )
    ]
)
