import Foundation

enum BurreteRendererMode {
    static let auto = "auto"
    static let molstar = "molstar"
    static let xyzFast = "xyz-fast"
    static let xyzrenderExternal = "xyzrender-external"

    static func normalize(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "xyz-fast", "fast-xyz", "xyzfast":
            return xyzFast
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

    static func resolve(format: BurreteRendererFormat, requestedMode rawRequestedMode: String) -> BurreteRendererPolicy {
        let requestedMode = BurreteRendererMode.normalize(rawRequestedMode)
        let renderer: String

        if format.isExternalXyzrenderOnly {
            renderer = BurreteRendererMode.xyzrenderExternal
        } else {
            let isXYZ = format.molstarFormat == "xyz" && !format.isBinary
            switch requestedMode {
            case BurreteRendererMode.molstar:
                renderer = BurreteRendererMode.molstar
            case BurreteRendererMode.xyzFast:
                renderer = isXYZ ? BurreteRendererMode.xyzFast : BurreteRendererMode.molstar
            case BurreteRendererMode.xyzrenderExternal:
                renderer = isXYZ ? BurreteRendererMode.xyzrenderExternal : BurreteRendererMode.molstar
            default:
                renderer = isXYZ ? BurreteRendererMode.xyzFast : BurreteRendererMode.molstar
            }
        }

        return BurreteRendererPolicy(
            requestedMode: requestedMode,
            renderer: renderer,
            molstarAvailable: !format.isExternalXyzrenderOnly
        )
    }

    static func fallbackRenderer(for format: BurreteRendererFormat) -> String {
        format.molstarFormat == "xyz" && !format.isBinary ? BurreteRendererMode.xyzFast : BurreteRendererMode.molstar
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
