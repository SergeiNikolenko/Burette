import AppKit
import SwiftUI

struct ContentView: View {
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
    @State private var section: SettingsSection = .general
    @State private var defaultOpenStatus = BurreteFileAssociations.defaultHandlerSummary

    var body: some View {
        ZStack {
            SettingsColors.background.ignoresSafeArea()
            HStack(spacing: 0) {
                Sidebar(selection: $section)
                    .frame(width: 198)
                    .background(SettingsColors.sidebar)

                Rectangle()
                    .fill(SettingsColors.separator)
                    .frame(width: 1)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(section.title)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.primary)
                            .padding(.bottom, 2)

                        content
                    }
                    .id(section)
                    .frame(maxWidth: 620, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .animation(.easeInOut(duration: 0.16), value: section)
                .animation(.easeInOut(duration: 0.12), value: useTransparentPreviewBackground)
            }
        }
        .frame(minWidth: 660, minHeight: 440)
        .onChange(of: gridPreviewSupportsSDF) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsSMILES) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsCSV) { _ in refreshDefaultOpenStatus() }
        .onChange(of: gridPreviewSupportsTSV) { _ in refreshDefaultOpenStatus() }
        .onReceive(NotificationCenter.default.publisher(for: .burreteOpenSettingsSection)) { notification in
            guard let rawSection = notification.object as? String,
                  let requestedSection = SettingsSection(rawValue: rawSection) else { return }
            section = requestedSection
        }
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .general:
            SettingsSectionTitle("Application Basics")
            SettingsCard {
                SettingsToggleRow(
                    title: "Open settings window at launch",
                    subtitle: "Show this window when Burrete starts from the menu bar.",
                    isOn: $openSettingsAtLaunch
                )
                SettingsDivider()
                SettingsValueRow(
                    icon: "menubar.rectangle",
                    title: "Menu bar icon",
                    subtitle: "Always shown so Settings, logs, cache tools, and Quit remain reachable."
                )
            }

            SettingsSectionTitle("Preview Window")
            SettingsCard {
                SettingsValueRow(
                    icon: "sidebar.left",
                    title: "Default layout",
                    subtitle: "Left panel collapsed; sequence, log, and right panels hidden."
                )
                SettingsDivider()
                SettingsValueRow(
                    icon: "arrow.up.left.and.arrow.down.right.circle",
                    title: "Fullscreen",
                    subtitle: "Use the green window button when you want the full app viewer in native macOS fullscreen."
                )
                SettingsDivider()
                SettingsActionRow(
                    icon: "arrow.clockwise",
                    title: "Reset Quick Look",
                    subtitle: "Refresh the system preview service after installing a new build."
                ) {
                    run("/usr/bin/qlmanage", arguments: ["-r"])
                    run("/usr/bin/qlmanage", arguments: ["-r", "cache"])
                    run("/usr/bin/killall", arguments: ["quicklookd"])
                }
            }

        case .viewer:
            SettingsSectionTitle("Viewer")
            SettingsCard {
                SettingsStringPickerRow(
                    icon: "atom",
                    title: "Renderer",
                    subtitle: "Auto uses Fast XYZ SVG for .xyz and Mol* for the rest. Choose Mol* Interactive when you want live rotation and the full app controls.",
                    selection: $structureRendererMode,
                    options: [
                        ("auto", "Auto"),
                        ("xyz-fast", "Fast XYZ SVG"),
                        ("molstar", "Mol* Interactive"),
                        ("xyzrender-external", "External xyzrender SVG")
                    ]
                )
                SettingsDivider()
                SettingsStringPickerRow(
                    icon: "sparkles",
                    title: "Fast XYZ style",
                    subtitle: "Static SVG style for Quick Look and app .xyz previews.",
                    selection: $xyzFastStyle,
                    options: [
                        ("default", "Default"),
                        ("wire", "Wire"),
                        ("tube", "Tube"),
                        ("spacefill", "Spacefill")
                    ]
                )
                SettingsDivider()
                SettingsStringPickerRow(
                    icon: "terminal",
                    title: "External xyzrender preset",
                    subtitle: "Used only by the standalone app when xyzrender is available on PATH or configured via defaults.",
                    selection: $xyzrenderPreset,
                    options: BurreteXyzrenderPreset.pickerOptions
                )
                SettingsDivider()
                SettingsTextFieldRow(
                    icon: "doc.badge.gearshape",
                    title: "External xyzrender custom config",
                    subtitle: "Used when the preset is Custom JSON. Point this to a local xyzrender config file.",
                    text: $xyzrenderCustomConfigPath,
                    placeholder: "/Users/me/styles/my_style.json"
                )
                SettingsDivider()
                SettingsTextFieldRow(
                    icon: "point.3.connected.trianglepath.dotted",
                    title: "External xyzrender executable",
                    subtitle: "Leave empty to run `xyzrender` from PATH. Set an absolute path when using a custom venv, uv tool, or signed helper.",
                    text: $xyzrenderExecutablePath,
                    placeholder: "/opt/homebrew/bin/xyzrender"
                )
                SettingsDivider()
                SettingsTextFieldRow(
                    icon: "curlybraces",
                    title: "External xyzrender extra flags",
                    subtitle: "Optional app-only CLI flags such as `--cell --idx sn --no-hy`. Output flags are ignored so Burrete can keep displaying the generated SVG.",
                    text: $xyzrenderExtraArguments,
                    placeholder: "--cell --idx sn"
                )
                SettingsDivider()
                SettingsValueRow(icon: "doc.richtext", title: "Formats", subtitle: "PDB, PDBx/mmCIF, BinaryCIF, SDF, MOL, MOL2, XYZ, and GRO")
                SettingsDivider()
                SettingsValueRow(icon: "rotate.3d", title: "Interactive XYZ", subtitle: "Open .xyz in the standalone app and switch to Mol* Interactive from the toolbar to rotate, inspect, and use Mol* panels.")
                SettingsDivider()
                SettingsValueRow(icon: "square.grid.3x3", title: "SDF molecule grid", subtitle: "Multi-record SDF files are laid out as a visible grid when possible.")
                SettingsDivider()
                SettingsValueRow(icon: "bolt.horizontal", title: "Performance", subtitle: "Fast SVG for .xyz; bundled Mol* assets and WebGL fallback for interactive formats.")
            }

            SettingsSectionTitle("Appearance")
            SettingsCard {
                SettingsStringPickerRow(
                    icon: "circle.lefthalf.filled",
                    title: "Theme",
                    subtitle: "Use the system appearance, force dark, or force light.",
                    selection: $viewerTheme,
                    options: [
                        ("auto", "Auto"),
                        ("dark", "Dark"),
                        ("light", "Light")
                    ]
                )
                SettingsDivider()
                SettingsStringPickerRow(
                    icon: "circle.fill",
                    title: "Canvas background",
                    subtitle: "Auto follows the viewer theme: white in light mode and black in dark mode.",
                    selection: $viewerCanvasBackground,
                    options: [
                        ("auto", "Auto"),
                        ("black", "Black"),
                        ("graphite", "Graphite"),
                        ("white", "White"),
                        ("transparent", "Transparent")
                    ]
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "Transparent preview background",
                    subtitle: "Use native macOS material behind transparent canvas areas instead of a fully clear window.",
                    isOn: $useTransparentPreviewBackground
                )
                SettingsDivider()
                SettingsSliderRow(
                    icon: "square.stack.3d.down.forward",
                    title: "Window material opacity",
                    subtitle: "Controls how solid the viewer surface is when transparency is enabled.",
                    value: $viewerWindowOpacity,
                    range: 0.35...0.95
                )
                SettingsDivider()
                SettingsSliderRow(
                    icon: "rectangle.3.group.bubble",
                    title: "Panel readability",
                    subtitle: "Controls toolbar and Mol* panel opacity so controls stay readable over transparent content.",
                    value: $viewerOverlayOpacity,
                    range: 0.72...0.98
                )
                SettingsDivider()
                SettingsValueRow(
                    icon: previewBackgroundIcon,
                    title: previewBackgroundModeTitle,
                    subtitle: previewBackgroundModeSubtitle
                )
            }

            SettingsSectionTitle("Preview Toolbar")
            SettingsCard {
                SettingsToggleRow(
                    title: "Show panel toggles by default",
                    subtitle: "Show the L, R, Seq, and Log buttons in Quick Look and app viewer toolbars.",
                    isOn: $showPreviewPanelControls
                )
                SettingsDivider()
                SettingsValueRow(
                    icon: "rectangle.compress.vertical",
                    title: "Compact controls",
                    subtitle: "Click the dotted handle to collapse the toolbar to a miniature control, then click it again to restore it."
                )
            }

            SettingsSectionTitle("Quick Controls")
            SettingsCard {
                SettingsValueRow(icon: "rectangle.split.3x1", title: "Panels", subtitle: "Use the floating toolbar to show left, right, sequence, and log panes.")
                SettingsDivider()
                SettingsValueRow(icon: "hand.draw", title: "Movable toolbar", subtitle: "Drag the toolbar away from Mol* controls; its position is remembered.")
            }

        case .files:
            SettingsSectionTitle("Molecule Grid File Types")
            SettingsCard {
                SettingsToggleRow(
                    title: "SDF / SD",
                    subtitle: "Show multi-record SDF files as a molecule grid in Quick Look and the app.",
                    isOn: $gridPreviewSupportsSDF
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "SMILES / SMI",
                    subtitle: "Open plain SMILES collections as a 2D molecule grid.",
                    isOn: $gridPreviewSupportsSMILES
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "CSV tables",
                    subtitle: "Open CSV files that contain a SMILES, canonical_smiles, isomeric_smiles, cxsmiles, or smiles_string column.",
                    isOn: $gridPreviewSupportsCSV
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "TSV tables",
                    subtitle: "Open tab-separated molecule tables with a recognized SMILES column.",
                    isOn: $gridPreviewSupportsTSV
                )
            }

            SettingsSectionTitle("Open In Finder")
            SettingsCard {
                SettingsValueRow(
                    icon: "doc.viewfinder",
                    title: "Double-click opens Burrete",
                    subtitle: "Finder opens supported structure files in a standalone Mol* viewer window. Space still uses the Quick Look extension."
                )
                SettingsDivider()
                SettingsActionRow(
                    icon: "checkmark.seal",
                    title: "Make Burrete Default",
                    subtitle: "\(defaultOpenStatus) Uses the enabled file types above."
                ) {
                    defaultOpenStatus = BurreteFileAssociations.registerAsDefaultHandler()
                }
            }

            SettingsSectionTitle("Finder Integration")
            SettingsCard {
                SettingsValueRow(icon: "puzzlepiece.extension", title: "Quick Look extension", subtitle: "com.local.BurreteV10.Preview")
                SettingsDivider()
                SettingsValueRow(icon: "app.badge", title: "Main bundle", subtitle: "com.local.BurreteV10")
                SettingsDivider()
                SettingsValueRow(icon: "eye", title: "Document role", subtitle: "Viewer for double-click/Open With; Quick Look preview remains separate.")
            }

            SettingsSectionTitle("Cache")
            SettingsCard {
                SettingsValueRow(icon: "externaldrive", title: "Preview cache", subtitle: AppDelegate.previewCacheDirectory.path)
                SettingsDivider()
                SettingsActionRow(icon: "trash", title: "Clear Preview Cache", subtitle: "Remove generated preview HTML and temporary structure copies.") {
                    AppDelegate.clearPreviewCache()
                }
            }

        case .logs:
            SettingsSectionTitle("Diagnostics")
            SettingsCard {
                SettingsValueRow(icon: "doc.text.magnifyingglass", title: "Log file", subtitle: AppDelegate.primaryLogURL.path)
                SettingsDivider()
                SettingsActionRow(icon: "folder", title: "Open Logs Folder", subtitle: "Open the sandbox diagnostics directory in Finder.") {
                    AppDelegate.openLogsDirectory()
                }
                SettingsDivider()
                SettingsActionRow(icon: "doc.on.clipboard", title: "Copy Log Path", subtitle: "Copy the current log path to the clipboard.") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(AppDelegate.primaryLogURL.path, forType: .string)
                }
            }

            SettingsFootnote("Quick Look debug UI is hidden by default. Logs stay available here for troubleshooting.")

        case .updates:
            SettingsSectionTitle("Delivery")
            SettingsCard {
                SettingsToggleRow(
                    title: "Check for updates automatically",
                    subtitle: "Burrete checks GitHub Releases in the background at most twice a day.",
                    isOn: $checkUpdatesAutomatically
                )
                SettingsDivider()
                SettingsPickerRow(
                    icon: "arrow.triangle.2.circlepath",
                    title: "Update Channel",
                    subtitle: updateChannel.description,
                    selection: updateChannelBinding
                )
                SettingsDivider()
                SettingsActionRow(
                    icon: updater.availableRelease == nil ? "magnifyingglass" : "square.and.arrow.down",
                    title: updater.primaryActionTitle,
                    subtitle: updater.statusText,
                    isDisabled: updater.isChecking || updater.isDownloading || updater.isInstalling
                ) {
                    Task {
                        await updater.runPrimaryAction(channel: updateChannel)
                    }
                }
                if updater.downloadedFileURL != nil {
                    SettingsDivider()
                    SettingsActionRow(
                        icon: "folder",
                        title: "Reveal Downloaded Update",
                        subtitle: "Open the downloaded update archive in Finder."
                    ) {
                        updater.revealDownloadedUpdate()
                    }
                }
            }

            SettingsFootnote("Updates are read from github.com/\(BurreteUpdateRepository.ownerAndName). App archives are downloaded into Burrete Application Support, installed, and then Burrete restarts automatically.")

        case .about:
            AboutPanel()
        }
    }

    private var updateChannel: BurreteUpdateChannel {
        BurreteUpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    private var updateChannelBinding: Binding<BurreteUpdateChannel> {
        Binding(
            get: { updateChannel },
            set: {
                updateChannelRaw = $0.rawValue
                updater.clearAvailableRelease()
            }
        )
    }

    private var previewBackgroundIcon: String {
        useTransparentPreviewBackground ? "square.stack.3d.down.forward" : "rectangle.fill"
    }

    private var previewBackgroundModeTitle: String {
        useTransparentPreviewBackground ? "Transparent background" : "Opaque background"
    }

    private var previewBackgroundModeSubtitle: String {
        if useTransparentPreviewBackground {
            return "The standalone viewer uses a native material surface; transparent canvas areas no longer remove the window edge."
        }
        return "The viewer uses a regular opaque macOS window surface."
    }

    private func run(_ executable: String, arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        try? process.run()
    }

    private func refreshDefaultOpenStatus() {
        defaultOpenStatus = BurreteFileAssociations.defaultHandlerSummary
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

    var group: String? {
        switch self {
        case .general: return nil
        case .viewer, .files: return "Features"
        case .logs, .updates, .about: return "System"
        }
    }

    var searchTerms: [String] {
        switch self {
        case .general:
            return ["application", "launch", "startup", "menu bar", "icon", "dock", "preview window", "fullscreen"]
        case .viewer:
            return ["renderer", "fast xyz", "xyzrender", "external", "molstar", "formats", "pdb", "cif", "sdf", "mol", "mol2", "xyz", "gro", "background", "transparent", "black", "canvas", "theme", "dark", "light", "auto", "grid", "toolbar", "panels", "sequence", "log"]
        case .files:
            return ["finder", "default", "double-click", "open with", "quick look", "cache", "file", "extension", "sdf", "smiles", "smi", "csv", "tsv", "table", "grid"]
        case .logs:
            return ["diagnostics", "log", "logs", "folder", "clipboard", "path", "troubleshooting"]
        case .updates:
            return ["update", "updates", "release", "github", "stable", "beta", "download", "channel"]
        case .about:
            return ["about", "version", "release notes", "contact"]
        }
    }

    func matchesSearch(_ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        let lowercased = trimmed.lowercased()
        return title.lowercased().contains(lowercased)
            || (group?.lowercased().contains(lowercased) ?? false)
            || searchTerms.contains { $0.localizedCaseInsensitiveContains(lowercased) }
    }
}

private struct Sidebar: View {
    @Binding var selection: SettingsSection
    @State private var searchText = ""

    private var groupedSections: [(String?, [SettingsSection])] {
        var result: [(String?, [SettingsSection])] = []
        for section in SettingsSection.allCases where section.matchesSearch(searchText) {
            if !result.isEmpty, result[result.count - 1].0 == section.group {
                result[result.count - 1].1.append(section)
            } else {
                result.append((section.group, [section]))
            }
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 18)

            SearchField(text: $searchText)
                .padding(.horizontal, 10)
                .padding(.bottom, 10)

            Rectangle()
                .fill(SettingsColors.separator)
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(groupedSections, id: \.0) { group, sections in
                    VStack(alignment: .leading, spacing: 3) {
                        if let group {
                            Text(group)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 10)
                                .padding(.top, 4)
                        }

                        ForEach(sections) { item in
                            SidebarRow(section: item, isSelected: selection == item) {
                                selection = item
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 12)

            Spacer()
        }
    }
}

private struct SidebarRow: View {
    let section: SettingsSection
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: section.icon)
                    .font(.system(size: 13, weight: .medium))
                    .symbolRenderingMode(.hierarchical)
                    .frame(width: 18)

                Text(section.title)
                    .font(.system(size: 13, weight: .medium))

                Spacer(minLength: 0)
            }
            .foregroundStyle(isSelected ? .primary : .secondary)
            .padding(.horizontal, 8)
            .frame(height: 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? SettingsColors.selection : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(.tertiary)

            TextField("Search settings...", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(SettingsColors.search, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct SettingsSectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 2)
    }
}

private struct SettingsCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SettingsColors.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(SettingsColors.separator, lineWidth: 1)
        )
    }
}

private struct SettingsToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool
    var isDisabled = false

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(isDisabled ? .tertiary : .primary)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 10)

                Toggle("", isOn: $isOn)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .allowsHitTesting(false)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
    }
}

private struct SettingsValueRow: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }
}

private struct SettingsPickerRow: View {
    let icon: String
    let title: String
    let subtitle: String
    @Binding var selection: BurreteUpdateChannel

    var body: some View {
        Menu {
            ForEach(BurreteUpdateChannel.allCases) { channel in
                Button(channel.title) {
                    selection = channel
                }
            }
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 10)

                Text(selection.title)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsStringPickerRow: View {
    let icon: String
    let title: String
    let subtitle: String
    @Binding var selection: String
    let options: [(value: String, title: String)]

    var body: some View {
        Menu {
            ForEach(options, id: \.value) { option in
                Button(option.title) {
                    selection = option.value
                }
            }
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 10)

                Text(selectedTitle)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var selectedTitle: String {
        options.first { $0.value == selection }?.title ?? selection
    }
}

private struct SettingsTextFieldRow: View {
    let icon: String
    let title: String
    let subtitle: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, weight: .regular, design: .monospaced))
                .frame(width: 220)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

private struct SettingsSliderRow: View {
    let icon: String
    let title: String
    let subtitle: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            HStack(spacing: 8) {
                Slider(value: $value, in: range)
                    .frame(width: 150)
                Text("\(Int((value * 100).rounded()))%")
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 42, alignment: .trailing)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }
}

private struct SettingsActionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 10)

                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .opacity(isDisabled ? 0.55 : 1)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
    }
}

private struct SettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(SettingsColors.separator)
            .frame(height: 1)
            .padding(.leading, 40)
    }
}

private struct SettingsFootnote: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .regular))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4)
    }
}

private struct AboutPanel: View {
    var body: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 22)

            BurreteBadge()
                .frame(width: 82, height: 82)

            VStack(spacing: 4) {
                Text("Burrete")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.primary)
                Text("Version 0.10.20")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Button("Open Logs") { AppDelegate.openLogsDirectory() }
                Button("Clear Cache") { AppDelegate.clearPreviewCache() }
            }
            .buttonStyle(.bordered)
            .controlSize(.regular)
            .padding(.top, 8)

            Spacer(minLength: 24)

            SettingsCard {
                SettingsValueRow(icon: "sparkles", title: "Release Notes", subtitle: "First Burrete release with native settings, hidden logs, and movable Quick Look controls.")
                SettingsDivider()
                SettingsValueRow(icon: "envelope", title: "Contact", subtitle: "Local build for molecular Quick Look previews.")
            }
            .frame(maxWidth: 500)

            Spacer()
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }
}

private struct BurreteBadge: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(SettingsColors.card)
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(SettingsColors.separator, lineWidth: 1))

            Image(systemName: "atom")
                .font(.system(size: 38, weight: .regular))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.primary)
        }
    }
}

private enum SettingsColors {
    static let background = Color(nsColor: .windowBackgroundColor)
    static let sidebar = Color(nsColor: .controlBackgroundColor)
    static let card = Color(nsColor: .textBackgroundColor)
    static let search = Color(nsColor: .textBackgroundColor)
    static let selection = Color.accentColor.opacity(0.18)
    static let separator = Color(nsColor: .separatorColor).opacity(0.55)
}
