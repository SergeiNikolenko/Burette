import Foundation
import SwiftUI
import Observation

/// Renderer selection surfaced in Settings. On iPhone only the in-app Mol*
/// runtime renders live; `xyzrender` is a desktop-only external process, so it
/// is exposed as an honest, non-live option for parity with the desktop app.
enum MobileRenderer: String, CaseIterable, Identifiable {
    case auto
    case molstar
    case xyzrender

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .auto: "Auto"
        case .molstar: "Mol*"
        case .xyzrender: "xyzrender"
        }
    }
}

/// Mol* quality preset threaded into the preview runtime config.
enum MobileMolstarQuality: String, CaseIterable, Identifiable {
    case automatic
    case high
    case balanced
    case performance

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .automatic: "Auto"
        case .high: "High"
        case .balanced: "Balanced"
        case .performance: "Performance"
        }
    }

    /// Maps to the runtime `molstarResolutionMode` config value.
    var resolutionMode: String {
        switch self {
        case .automatic: "auto"
        case .high: "native"
        case .balanced: "balanced"
        case .performance: "scaled"
        }
    }
}

/// Preview canvas background, independent from the UI theme.
enum MobilePreviewBackground: String, CaseIterable, Identifiable {
    case matchTheme
    case dark
    case light

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .matchTheme: "Match theme"
        case .dark: "Dark"
        case .light: "Light"
        }
    }
}

/// Shared, observable app state. Single source of truth for rendering
/// preferences, the active document, imports, and cross-tab navigation.
@Observable
final class MobileAppModel {
    // MARK: Rendering preferences (persisted)
    var theme: MobileThemeSelection {
        didSet { persist(theme.rawValue, for: Keys.theme) }
    }
    var style: MobileMolecularStyle {
        didSet { persist(style.rawValue, for: Keys.style) }
    }
    var water: MobileWaterRepresentation {
        didSet { persist(water.rawValue, for: Keys.water) }
    }
    var renderer: MobileRenderer {
        didSet { persist(renderer.rawValue, for: Keys.renderer) }
    }
    var molstarQuality: MobileMolstarQuality {
        didSet { persist(molstarQuality.rawValue, for: Keys.quality) }
    }
    var previewBackground: MobilePreviewBackground {
        didSet { persist(previewBackground.rawValue, for: Keys.background) }
    }

    // MARK: Documents
    var importedDocuments: [MobilePreviewDocument]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = MobileThemeSelection(rawValue: defaults.string(forKey: Keys.theme) ?? "") ?? .system
        style = MobileMolecularStyle(rawValue: defaults.string(forKey: Keys.style) ?? "") ?? .illustrative
        water = MobileWaterRepresentation(rawValue: defaults.string(forKey: Keys.water) ?? "") ?? .line
        renderer = MobileRenderer(rawValue: defaults.string(forKey: Keys.renderer) ?? "") ?? .auto
        molstarQuality = MobileMolstarQuality(rawValue: defaults.string(forKey: Keys.quality) ?? "") ?? .high
        previewBackground = MobilePreviewBackground(rawValue: defaults.string(forKey: Keys.background) ?? "") ?? .matchTheme
        importedDocuments = MobileImportedDocumentStore.loadImportedDocuments()
    }

    // MARK: Actions

    @discardableResult
    func importDocument(from url: URL) throws -> MobilePreviewDocument {
        let document = try MobileImportedDocumentStore.importDocument(from: url)
        importedDocuments.removeAll { $0 == document }
        importedDocuments.insert(document, at: 0)
        return document
    }

    func deleteImportedDocument(_ document: MobilePreviewDocument) throws {
        try MobileImportedDocumentStore.deleteDocument(document)
        importedDocuments.removeAll { $0 == document }
    }

    private func persist(_ value: String, for key: String) {
        defaults.set(value, forKey: key)
    }

    private enum Keys {
        static let theme = "mobile.theme"
        static let style = "mobile.style"
        static let water = "mobile.water"
        static let renderer = "mobile.renderer"
        static let quality = "mobile.molstarQuality"
        static let background = "mobile.previewBackground"
    }
}
