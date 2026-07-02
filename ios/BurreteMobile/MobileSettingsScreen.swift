import SwiftUI

/// Settings tab (mockup 09): rendering, appearance, integrations, maintenance,
/// and about. Uses a native grouped `Form`. Preferences are bound to the shared
/// `MobileAppModel` and flow into the Mol* preview runtime.
struct MobileSettingsScreen: View {
    @Bindable var model: MobileAppModel

    @State private var maintenanceMessage: String?
    @State private var showingDiagnostics = false
    @State private var diagnosticsReport = ""

    var body: some View {
        NavigationStack {
            Form {
                renderingSection
                appearanceSection
                integrationsSection
                maintenanceSection
                aboutSection
            }
            .navigationTitle("Settings")
            .alert("Maintenance", isPresented: maintenanceAlertBinding) {
                Button("OK", role: .cancel) { maintenanceMessage = nil }
            } message: {
                Text(maintenanceMessage ?? "")
            }
            .sheet(isPresented: $showingDiagnostics) {
                MobileDiagnosticsSheet(report: diagnosticsReport)
            }
        }
    }

    // MARK: Sections

    private var renderingSection: some View {
        Section("Rendering") {
            Picker("Renderer", selection: $model.renderer) {
                ForEach(MobileRenderer.allCases) { renderer in
                    Text(renderer.displayName).tag(renderer)
                }
            }
            Picker("Mol* quality", selection: $model.molstarQuality) {
                ForEach(MobileMolstarQuality.allCases) { quality in
                    Text(quality.displayName).tag(quality)
                }
            }
            Picker("Default representation", selection: $model.style) {
                ForEach(MobileMolecularStyle.allCases) { style in
                    Text(style.displayName).tag(style)
                }
            }
            Picker("Water", selection: $model.water) {
                ForEach(MobileWaterRepresentation.allCases) { water in
                    Text(water.displayName).tag(water)
                }
            }
        }
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            Picker("Theme", selection: $model.theme) {
                ForEach(MobileThemeSelection.allCases) { theme in
                    Label(theme.displayName, systemImage: theme.systemImage).tag(theme)
                }
            }
            Picker("Preview background", selection: $model.previewBackground) {
                ForEach(MobilePreviewBackground.allCases) { background in
                    Text(background.displayName).tag(background)
                }
            }
        }
    }

    private var integrationsSection: some View {
        Section {
            LabeledContent("xyzrender", value: "Desktop only")
            LabeledContent("VESTA", value: "Desktop only")
            LabeledContent("External editors", value: "Desktop only")
        } header: {
            Text("Integrations")
        } footer: {
            Text("xyzrender SVG export, VESTA, and external chemistry editors run on the macOS app. On iPhone, structures render with the in-app Mol* runtime.")
        }
    }

    private var maintenanceSection: some View {
        Section("Maintenance") {
            Button {
                clearPreviewCache()
            } label: {
                Label("Clear preview cache", systemImage: "trash")
            }
            Button {
                runDiagnostics()
            } label: {
                Label("Run diagnostics", systemImage: "stethoscope")
            }
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version", value: appVersion)
            LabeledContent("License", value: "MIT")
        }
    }

    // MARK: Actions

    private var maintenanceAlertBinding: Binding<Bool> {
        Binding(
            get: { maintenanceMessage != nil },
            set: { if !$0 { maintenanceMessage = nil } }
        )
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        if let build, !build.isEmpty { return "\(version) (\(build))" }
        return version
    }

    private func clearPreviewCache() {
        let fileManager = FileManager.default
        guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            maintenanceMessage = "Caches directory is unavailable."
            return
        }
        let previews = caches
            .appendingPathComponent("BurreteMobile", isDirectory: true)
            .appendingPathComponent("previews", isDirectory: true)
        do {
            if fileManager.fileExists(atPath: previews.path) {
                try fileManager.removeItem(at: previews)
                maintenanceMessage = "Preview cache cleared. The next structure rebuilds the runtime."
            } else {
                maintenanceMessage = "Preview cache is already empty."
            }
        } catch {
            maintenanceMessage = "Could not clear preview cache: \(error.localizedDescription)"
        }
    }

    private func runDiagnostics() {
        var lines: [String] = []
        lines.append("Burrete Mobile \(appVersion)")
        lines.append("Renderer: \(model.renderer.displayName)")
        lines.append("Mol* quality: \(model.molstarQuality.displayName)")
        lines.append("Theme: \(model.theme.displayName)")
        lines.append("Imported files: \(model.importedDocuments.count)")

        let webAvailable = Bundle.main.url(forResource: "Web", withExtension: nil) != nil
        lines.append("Web runtime bundle: \(webAvailable ? "present" : "missing")")
        let rdkit = Bundle.main.url(forResource: "RDKit_minimal", withExtension: "wasm", subdirectory: "Web/rdkit") != nil
        lines.append("RDKit WASM: \(rdkit ? "present" : "missing")")

        diagnosticsReport = lines.joined(separator: "\n")
        showingDiagnostics = true
    }
}

/// Read-only diagnostics report presented as a sheet.
private struct MobileDiagnosticsSheet: View {
    let report: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(report)
                    .font(.system(.footnote, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding()
            }
            .navigationTitle("Diagnostics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
