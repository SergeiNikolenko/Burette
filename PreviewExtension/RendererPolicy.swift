import Foundation

private struct BuretteCoreBridgeFormat: Decodable {
    let molstarFormat: String
    let isBinary: Bool
    let externalOnly: Bool
    let canOpenInVesta: Bool
}

private struct BuretteCoreBridgeRendererPolicy: Decodable {
    let requestedMode: String
    let renderer: String
    let molstarAvailable: Bool
}

struct BurettePreviewPrimary: Decodable, Equatable {
    let role: String
    let format: String
    let binary: Bool
}

struct BurettePreviewConverter: Decodable, Equatable {
    let id: String
    let required: Bool
}

struct BurettePreviewStagedEntry: Decodable, Equatable {
    let role: String
    let format: String
    let representation: String
    let requiredForReady: Bool
}

struct BurettePreviewFallback: Decodable, Equatable {
    let renderer: String
    let converter: String?
}

struct BurettePreviewCapabilities: Decodable, Equatable {
    let canOpenInVesta: Bool
    let canSwitchRenderer: Bool
    let hasTrajectoryControls: Bool
    let hasGridSearch: Bool
    let hasStagedEntries: Bool
}

struct BurettePreviewPlan: Decodable, Equatable {
    let sourceExtension: String
    let strategy: String
    let renderer: String
    let primary: BurettePreviewPrimary?
    let converter: BurettePreviewConverter?
    let staged: [BurettePreviewStagedEntry]
    let fallbacks: [BurettePreviewFallback]
    let capabilities: BurettePreviewCapabilities
}

private struct BundledFormatRegistryDocument: Decodable {
    let formats: [BundledFormatRegistryFormat]
}

private struct BundledFormatRegistryFormat: Decodable {
    let extensions: [String]
}

enum BundledFormatRegistry {
    private static let registryName = "preview-formats"

    static func supportedExtension(_ fileExtension: String) -> Bool? {
        supportedExtensions.map { $0.contains(normalizeExtension(fileExtension)) }
    }

    private static let supportedExtensions: Set<String>? = {
        guard let url = registryURL(),
              let data = try? Data(contentsOf: url),
              let registry = try? JSONDecoder().decode(BundledFormatRegistryDocument.self, from: data) else {
            return nil
        }
        return Set(registry.formats.flatMap { format in
            format.extensions.map(normalizeExtension)
        })
    }()

    private static func registryURL() -> URL? {
        Bundle(for: PreviewViewController.self).url(forResource: registryName, withExtension: "json")
            ?? Bundle.main.url(forResource: registryName, withExtension: "json")
    }

    private static func normalizeExtension(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "mae.gz":
            return "maegz"
        case let normalized:
            return normalized
        }
    }
}

enum BuretteCoreBridge {
    private static let executableName = "burette-core-bridge"
    private static let processTimeout: TimeInterval = 1.0

    static func supportedExtension(_ fileExtension: String) -> Bool? {
        runText(arguments: ["supported-extension", fileExtension]).flatMap { output in
            switch output {
            case "true": return true
            case "false": return false
            default: return nil
            }
        }
    }

    static func quickLookSizeLimit(fileExtension: String) -> Int64? {
        runText(arguments: ["size-limit", fileExtension]).flatMap { Int64($0) }
    }

    static func format(fileExtension: String) -> BuretteRendererFormat? {
        guard let response: BuretteCoreBridgeFormat = runJSON(arguments: ["format", fileExtension]) else {
            return nil
        }
        return BuretteRendererFormat(
            molstarFormat: response.molstarFormat,
            isBinary: response.isBinary,
            isExternalXyzrenderOnly: response.externalOnly
        )
    }

    static func resolveRenderer(fileExtension: String, requestedMode: String) -> BuretteRendererPolicy? {
        guard let response: BuretteCoreBridgeRendererPolicy = runJSON(arguments: ["resolve-renderer", fileExtension, requestedMode]) else {
            return nil
        }
        return BuretteRendererPolicy(
            requestedMode: response.requestedMode,
            renderer: response.renderer,
            molstarAvailable: response.molstarAvailable
        )
    }

    static func previewPlan(fileExtension: String, requestedMode: String) -> BurettePreviewPlan? {
        runJSON(arguments: ["preview-plan", fileExtension, requestedMode])
    }

    private static func runJSON<T: Decodable>(arguments: [String]) -> T? {
        guard let data = runData(arguments: arguments) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func runText(arguments: [String]) -> String? {
        guard let data = runData(arguments: arguments),
              let output = String(data: data, encoding: .utf8) else {
            return nil
        }
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func runData(arguments: [String]) -> Data? {
        guard let executableURL = bridgeExecutableURL() else { return nil }
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        do {
            try process.run()
        } catch {
            return nil
        }

        let deadline = Date().addingTimeInterval(processTimeout)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
        if process.isRunning {
            process.terminate()
            return nil
        }
        guard process.terminationStatus == 0 else { return nil }
        return outputPipe.fileHandleForReading.readDataToEndOfFile()
    }

    private static func bridgeExecutableURL() -> URL? {
        Bundle(for: PreviewViewController.self).url(forResource: executableName, withExtension: nil)
            ?? Bundle.main.url(forResource: executableName, withExtension: nil)
    }
}

enum BuretteRendererMode {
    static let auto = "auto"
    static let molstar = "molstar"
    static let xyzrenderExternal = "xyzrender-external"

    static func normalize(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "molstar", "mol*", "interactive":
            return molstar
        case "xyzrender-external", "external-xyzrender", "xyzrender":
            return xyzrenderExternal
        default:
            return auto
        }
    }
}

struct BuretteRendererFormat: Equatable {
    let molstarFormat: String
    let isBinary: Bool
    let isExternalXyzrenderOnly: Bool
}

struct BuretteRendererPolicy: Equatable {
    let requestedMode: String
    let renderer: String
    let molstarAvailable: Bool

    static func resolve(
        format: BuretteRendererFormat,
        requestedMode rawRequestedMode: String,
        fileExtension: String? = nil,
        previewPlan providedPreviewPlan: BurettePreviewPlan? = nil
    ) -> BuretteRendererPolicy {
        let requestedMode = BuretteRendererMode.normalize(rawRequestedMode)
        let previewPlan = providedPreviewPlan ?? fileExtension.flatMap {
            BuretteCoreBridge.previewPlan(
                fileExtension: $0,
                requestedMode: requestedMode
            )
        }
        if let previewPlan,
           let planPolicy = policyFromPreviewPlan(previewPlan, requestedMode: requestedMode) {
            return planPolicy
        }
        if let fileExtension,
           let bridgePolicy = BuretteCoreBridge.resolveRenderer(
            fileExtension: fileExtension,
            requestedMode: rawRequestedMode
           ) {
            return bridgePolicy
        }
        let renderer: String

        if format.isExternalXyzrenderOnly {
            renderer = requestedMode == BuretteRendererMode.molstar
                ? BuretteRendererMode.molstar
                : BuretteRendererMode.xyzrenderExternal
        } else {
            let isXYZ = format.molstarFormat == "xyz" && !format.isBinary
            let canUseXyzrender = isXYZ || (!format.isBinary && ["sdf", "pdb", "pdbqt", "mmcif", "cifCore"].contains(format.molstarFormat))
            switch requestedMode {
            case BuretteRendererMode.molstar:
                renderer = BuretteRendererMode.molstar
            case BuretteRendererMode.xyzrenderExternal:
                renderer = canUseXyzrender ? BuretteRendererMode.xyzrenderExternal : BuretteRendererMode.molstar
            default:
                renderer = isXYZ ? BuretteRendererMode.xyzrenderExternal : BuretteRendererMode.molstar
            }
        }

        return BuretteRendererPolicy(
            requestedMode: requestedMode,
            renderer: renderer,
            molstarAvailable: !format.isExternalXyzrenderOnly
        )
    }

    static func fallbackRenderer(for format: BuretteRendererFormat) -> String {
        BuretteRendererMode.molstar
    }

    private static func policyFromPreviewPlan(
        _ previewPlan: BurettePreviewPlan,
        requestedMode: String
    ) -> BuretteRendererPolicy? {
        switch previewPlan.strategy {
        case "custom", "grid":
            return nil
        case "external":
            return BuretteRendererPolicy(
                requestedMode: requestedMode,
                renderer: BuretteRendererMode.normalize(previewPlan.renderer),
                molstarAvailable: false
            )
        default:
            return BuretteRendererPolicy(
                requestedMode: requestedMode,
                renderer: BuretteRendererMode.normalize(previewPlan.renderer),
                molstarAvailable: true
            )
        }
    }
}

enum BuretteXyzrenderPreset {
    static let builtInOptions: [(String, String)] = [
        ("default", "Default"),
        ("flat", "Flat"),
        ("paton", "Paton"),
        ("pmol", "PMol"),
        ("skeletal", "Skeletal"),
        ("bubble", "Bubble"),
        ("tube", "Tube"),
        ("btube", "BTube"),
        ("mtube", "MTube"),
        ("wire", "Wire"),
        ("graph", "Graph"),
        ("vdw", "vdW")
    ]

    static let pickerOptions: [(String, String)] = builtInOptions + [("custom", "Custom JSON")]

    static func normalize(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let allowed = Set(pickerOptions.map { $0.0 })
        return allowed.contains(trimmed) ? trimmed : "default"
    }
}
