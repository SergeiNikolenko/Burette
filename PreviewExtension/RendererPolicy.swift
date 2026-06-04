import Foundation

private struct BurreteCoreBridgeFormat: Decodable {
    let molstarFormat: String
    let isBinary: Bool
    let externalOnly: Bool
    let canOpenInVesta: Bool
}

private struct BurreteCoreBridgeRendererPolicy: Decodable {
    let requestedMode: String
    let renderer: String
    let molstarAvailable: Bool
}

enum BurreteCoreBridge {
    private static let executableName = "burrete-core-bridge"
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

    static func format(fileExtension: String) -> BurreteRendererFormat? {
        guard let response: BurreteCoreBridgeFormat = runJSON(arguments: ["format", fileExtension]) else {
            return nil
        }
        return BurreteRendererFormat(
            molstarFormat: response.molstarFormat,
            isBinary: response.isBinary,
            isExternalXyzrenderOnly: response.externalOnly
        )
    }

    static func resolveRenderer(fileExtension: String, requestedMode: String) -> BurreteRendererPolicy? {
        guard let response: BurreteCoreBridgeRendererPolicy = runJSON(arguments: ["resolve-renderer", fileExtension, requestedMode]) else {
            return nil
        }
        return BurreteRendererPolicy(
            requestedMode: response.requestedMode,
            renderer: response.renderer,
            molstarAvailable: response.molstarAvailable
        )
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

enum BurreteRendererMode {
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

struct BurreteRendererFormat: Equatable {
    let molstarFormat: String
    let isBinary: Bool
    let isExternalXyzrenderOnly: Bool
}

struct BurreteRendererPolicy: Equatable {
    let requestedMode: String
    let renderer: String
    let molstarAvailable: Bool

    static func resolve(
        format: BurreteRendererFormat,
        requestedMode rawRequestedMode: String,
        fileExtension: String? = nil
    ) -> BurreteRendererPolicy {
        if let fileExtension,
           let bridgePolicy = BurreteCoreBridge.resolveRenderer(
            fileExtension: fileExtension,
            requestedMode: rawRequestedMode
           ) {
            return bridgePolicy
        }
        let requestedMode = BurreteRendererMode.normalize(rawRequestedMode)
        let renderer: String

        if format.isExternalXyzrenderOnly {
            renderer = BurreteRendererMode.xyzrenderExternal
        } else {
            let isXYZ = format.molstarFormat == "xyz" && !format.isBinary
            let canUseXyzrender = isXYZ || (!format.isBinary && ["sdf", "pdb", "pdbqt", "mmcif", "cifCore"].contains(format.molstarFormat))
            switch requestedMode {
            case BurreteRendererMode.molstar:
                renderer = BurreteRendererMode.molstar
            case BurreteRendererMode.xyzrenderExternal:
                renderer = canUseXyzrender ? BurreteRendererMode.xyzrenderExternal : BurreteRendererMode.molstar
            default:
                renderer = isXYZ ? BurreteRendererMode.xyzrenderExternal : BurreteRendererMode.molstar
            }
        }

        return BurreteRendererPolicy(
            requestedMode: requestedMode,
            renderer: renderer,
            molstarAvailable: !format.isExternalXyzrenderOnly
        )
    }

    static func fallbackRenderer(for format: BurreteRendererFormat) -> String {
        BurreteRendererMode.molstar
    }
}

enum BurreteXyzrenderPreset {
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
        ("graph", "Graph")
    ]

    static let pickerOptions: [(String, String)] = builtInOptions + [("custom", "Custom JSON")]

    static func normalize(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let allowed = Set(pickerOptions.map { $0.0 })
        return allowed.contains(trimmed) ? trimmed : "default"
    }
}
