import SwiftUI

struct ContentView: View {
    var body: some View {
        SettingsView()
    }
}

struct SettingsView: View {
    @AppStorage("openSettingsAtLaunch") private var openSettingsAtLaunch = false
    @AppStorage("showPreviewPanelControls") private var showPreviewPanelControls = true
    @AppStorage("useTransparentPreviewBackground") private var useTransparentPreviewBackground = false
    @AppStorage("viewerTheme") private var viewerTheme = "auto"
    @AppStorage("viewerCanvasBackground") private var viewerCanvasBackground = "auto"
    @AppStorage("viewerWindowOpacity") private var viewerWindowOpacity = 0.82
    @AppStorage("viewerOverlayOpacity") private var viewerOverlayOpacity = 0.90
    @AppStorage("structureRendererMode") private var structureRendererMode = "auto"
    @AppStorage("xyzFastStyle") private var xyzFastStyle = "default"
    @AppStorage("xyzrenderPreset") private var xyzrenderPreset = "default"
    @AppStorage("xyzrenderCustomConfigPath") private var xyzrenderCustomConfigPath = ""
    @AppStorage("xyzrenderExecutablePath") private var xyzrenderExecutablePath = ""
    @AppStorage("xyzrenderExtraArguments") private var xyzrenderExtraArguments = ""
    @AppStorage(MoleculeGridFileSupport.sdfKey) private var gridPreviewSupportsSDF = true
    @AppStorage(MoleculeGridFileSupport.smilesKey) private var gridPreviewSupportsSMILES = true
    @AppStorage(MoleculeGridFileSupport.csvKey) private var gridPreviewSupportsCSV = true
    @AppStorage(MoleculeGridFileSupport.tsvKey) private var gridPreviewSupportsTSV = true
    @AppStorage("checkUpdatesAutomatically") private var checkUpdatesAutomatically = true
    @AppStorage("updateChannel") private var updateChannelRaw = BurreteUpdateChannel.stable.rawValue
    @StateObject private var updater = BurreteUpdater.shared
    @State private var selectedSection: SettingsSection? = .general
    @State private var defaultOpenStatus = PlatformActions.defaultHandlerSummary

    var body: some View {
        Group {
            if #available(macOS 13.0, *) {
                NavigationSplitView {
                    settingsSidebar
                } detail: {
                    detailView
                }
            } else {
                NavigationView {
                    settingsSidebar
                    detailView
                }
            }
        }
        .frame(minWidth: 780, idealWidth: 900, minHeight: 560, idealHeight: 640)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(selectedSectionValue.title)
                    .font(.headline)
            }
        }
        .onChange(of: gridPreviewSupportsSDF) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsSMILES) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsCSV) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsTSV) { _ in refreshDefaultOpenStatus() }
        .onReceive(NotificationCenter.default.publisher(for: .burreteOpenSettingsSection)) { notification in
            guard let rawSection = notification.object as? String,
                  let requestedSection = SettingsSection(rawValue: rawSection) else { return }
            selectedSection = requestedSection
        }
    }

    private var settingsSidebar: some View {
        List(SettingsSection.allCases, selection: $selectedSection) { section in
            HStack(spacing: 10) {
                Image(systemName: section.icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(section.title)
                    .lineLimit(1)
            }
                .tag(Optional(section))
        }
        .listStyle(.sidebar)
        .navigationTitle("Burrete")
    }

    @ViewBuilder
    private var detailView: some View {
        HStack(spacing: 0) {
            Form {
                switch selectedSectionValue {
                case .general:
                    generalSettings
                case .viewer:
                    viewerSettings
                case .files:
                    fileSettings
                case .logs:
                    logSettings
                case .updates:
                    updateSettings
                case .about:
                    aboutSettings
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.regular)
            .frame(maxWidth: 680, alignment: .topLeading)
            .padding(.horizontal, 28)
            .padding(.vertical, 22)

            Spacer(minLength: 0)
        }
        .navigationTitle(selectedSectionValue.title)
    }

    private var generalSettings: some View {
        Group {
            Section("Application") {
                Toggle("Open settings at launch", isOn: $openSettingsAtLaunch)
                SettingsContentRow(title: "Menu bar") {
                    Text("Icon-only status item")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Preview Window") {
                SettingsTextRow(title: "Default layout", value: "Left panel collapsed")
                SettingsTextRow(title: "Fullscreen", value: "Use the green window button")
                Button("Reset Quick Look") {
                    PlatformActions.resetQuickLook()
                }
            }
        }
    }

    private var viewerSettings: some View {
        Group {
            Section("Renderer") {
                Picker("Renderer", selection: $structureRendererMode) {
                    Text("Auto").tag("auto")
                    Text("Fast XYZ SVG").tag("xyz-fast")
                    Text("Mol* Interactive").tag("molstar")
                    Text("External xyzrender SVG").tag("xyzrender-external")
                }
                Picker("Fast XYZ style", selection: $xyzFastStyle) {
                    Text("Default").tag("default")
                    Text("Wire").tag("wire")
                    Text("Tube").tag("tube")
                    Text("Spacefill").tag("spacefill")
                }
                Picker("External xyzrender preset", selection: $xyzrenderPreset) {
                    ForEach(BurreteXyzrenderPreset.pickerOptions, id: \.0) { value, title in
                        Text(title).tag(value)
                    }
                }
                TextField("Custom config path", text: $xyzrenderCustomConfigPath)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
                TextField("Executable path", text: $xyzrenderExecutablePath)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
                TextField("Extra flags", text: $xyzrenderExtraArguments)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
            }

            Section("Appearance") {
                Picker("Theme", selection: $viewerTheme) {
                    Text("Auto").tag("auto")
                    Text("Dark").tag("dark")
                    Text("Light").tag("light")
                }
                Picker("Canvas background", selection: $viewerCanvasBackground) {
                    Text("Auto").tag("auto")
                    Text("Black").tag("black")
                    Text("Graphite").tag("graphite")
                    Text("White").tag("white")
                    Text("Transparent").tag("transparent")
                }
                Toggle("Transparent preview background", isOn: $useTransparentPreviewBackground)
                SliderRow(title: "Window material opacity", value: $viewerWindowOpacity, range: 0.35...0.95)
                SliderRow(title: "Panel readability", value: $viewerOverlayOpacity, range: 0.72...0.98)
            }

            Section("Toolbar") {
                Toggle("Show panel toggles by default", isOn: $showPreviewPanelControls)
                SettingsTextRow(title: "Controls", value: "Movable and collapsible")
            }
        }
    }

    private var fileSettings: some View {
        Group {
            Section("Molecule Grid File Types") {
                Toggle("SDF / SD", isOn: $gridPreviewSupportsSDF)
                Toggle("SMILES / SMI", isOn: $gridPreviewSupportsSMILES)
                Toggle("CSV tables", isOn: $gridPreviewSupportsCSV)
                Toggle("TSV tables", isOn: $gridPreviewSupportsTSV)
            }

            Section("Open In Finder") {
                SettingsTextRow(title: "Double-click", value: "Open in Burrete")
                Button("Make Burrete Default") {
                    defaultOpenStatus = PlatformActions.registerAsDefaultHandler()
                }
                Text(defaultOpenStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Finder Integration") {
                SettingsTextRow(title: "Quick Look extension", value: "com.local.BurreteV10.Preview")
                SettingsTextRow(title: "Main bundle", value: "com.local.BurreteV10")
                SettingsTextRow(title: "Document role", value: "Viewer")
            }

            Section("Cache") {
                SettingsContentRow(title: "Preview cache") {
                    Text(PlatformActions.previewCacheDirectory.path)
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                }
                Button("Clear Preview Cache") {
                    PlatformActions.clearPreviewCache()
                }
            }
        }
    }

    private var logSettings: some View {
        Section("Diagnostics") {
            SettingsContentRow(title: "Log file") {
                Text(PlatformActions.primaryLogURL.path)
                    .textSelection(.enabled)
                    .foregroundStyle(.secondary)
            }
            Button("Open Logs Folder") {
                PlatformActions.openLogsDirectory()
            }
            Button("Copy Log Path") {
                PlatformActions.copyLogPath()
            }
            Text("Quick Look debug UI is hidden. Runtime logs stay available here for troubleshooting.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var updateSettings: some View {
        Section("Delivery") {
            Toggle("Check for updates automatically", isOn: $checkUpdatesAutomatically)
            Picker("Update Channel", selection: updateChannelBinding) {
                ForEach(BurreteUpdateChannel.allCases) { channel in
                    Text(channel.title).tag(channel)
                }
            }
            Button(updater.primaryActionTitle) {
                Task {
                    await updater.runPrimaryAction(channel: updateChannel)
                }
            }
            .disabled(updater.isChecking || updater.isDownloading || updater.isInstalling)
            Text(updater.statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if updater.downloadedFileURL != nil {
                Button("Reveal Downloaded Update") {
                    updater.revealDownloadedUpdate()
                }
            }
        }
    }

    private var aboutSettings: some View {
        Group {
            Section {
                VStack(spacing: 10) {
                    Image(systemName: "atom")
                        .font(.system(size: 52, weight: .regular))
                        .symbolRenderingMode(.hierarchical)
                    Text("Burrete")
                        .font(.title2.weight(.semibold))
                    Text("Version 0.10.27")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Open Logs") { PlatformActions.openLogsDirectory() }
                        Button("Clear Cache") { PlatformActions.clearPreviewCache() }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            Section("Release Notes") {
                Text("Native settings, hidden logs, movable Quick Look controls, and modern molecular preview surfaces.")
            }
        }
    }

    private var selectedSectionValue: SettingsSection {
        selectedSection ?? .general
    }

    private var updateChannel: BurreteUpdateChannel {
        BurreteUpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    private var updateChannelBinding: Binding<BurreteUpdateChannel> {
        Binding(
            get: { updateChannel },
            set: { channel in
                updateChannelRaw = channel.rawValue
                updater.clearAvailableRelease()
            }
        )
    }

    private func refreshDefaultOpenStatus() {
        defaultOpenStatus = PlatformActions.defaultHandlerSummary
    }
}

private enum SettingsSection: String, CaseIterable, Identifiable {
    case general
    case viewer
    case files
    case logs
    case updates
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .viewer: return "Viewer"
        case .files: return "Files"
        case .logs: return "Logs"
        case .updates: return "Updates"
        case .about: return "About"
        }
    }

    var icon: String {
        switch self {
        case .general: return "gearshape"
        case .viewer: return "atom"
        case .files: return "folder"
        case .logs: return "doc.text.magnifyingglass"
        case .updates: return "arrow.triangle.2.circlepath"
        case .about: return "info.circle"
        }
    }
}

private struct SettingsTextRow: View {
    let title: String
    let value: String

    var body: some View {
        SettingsContentRow(title: title) {
            Text(value)
                .foregroundStyle(.secondary)
        }
    }
}

private struct SettingsContentRow<Content: View>: View {
    let title: String
    let content: () -> Content

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
            Spacer(minLength: 24)
            content()
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct SliderRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int((value * 100).rounded()))%")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range)
        }
    }
}
