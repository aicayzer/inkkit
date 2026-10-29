// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "InkKitRTF",
    platforms: [.macOS("27.0"), .iOS("27.0")],
    products: [
        .library(name: "InkKitRTF", targets: ["InkKitRTF"]),
    ],
    targets: [
        .target(
            name: "InkKitRTF",
            path: "apple/Sources/InkKitRTF"
        ),
        .testTarget(
            name: "InkKitRTFTests",
            dependencies: ["InkKitRTF"],
            path: "apple/Tests/InkKitRTFTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
