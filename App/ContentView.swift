import AppKit
import SwiftUI

struct ContentView: View {
    @AppStorage("openSettingsAtLaunch") private var openSettingsAtLaunch = false
    @AppStorage("showPreviewPanelControls") private var showPreviewPanelControls = true
    @AppStorage("useTransparentPreviewBackground") private var useTransparentPreviewBackground = false
    @AppStorage("viewerTheme") private var viewerTheme = "dark"
    @AppStorage("viewerCanvasBackground") private var viewerCanvasBackground = "black"
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
                    subtitle: "The green window button opens the full app viewer in native macOS fullscreen."
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
                SettingsValueRow(icon: "atom", title: "Engine", subtitle: "Mol* Viewer")
                SettingsDivider()
                SettingsValueRow(icon: "doc.richtext", title: "Formats", subtitle: "PDB, PDBx/mmCIF, BinaryCIF, SDF, MOL, and MOL2")
                SettingsDivider()
                SettingsValueRow(icon: "square.grid.3x3", title: "SDF molecule grid", subtitle: "Multi-record SDF files are laid out as a visible grid when possible.")
                SettingsDivider()
                SettingsValueRow(icon: "bolt.horizontal", title: "Performance", subtitle: "Bundled assets, cached runtime previews, and WebGL fallback.")
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
                    subtitle: "The molecule canvas uses black by default; choose another surface when needed.",
                    selection: $viewerCanvasBackground,
                    options: [
                        ("black", "Black"),
                        ("graphite", "Graphite"),
                        ("white", "White"),
                        ("transparent", "Transparent")
                    ]
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "Transparent preview background",
                    subtitle: "Use native Quick Look glass around the canvas; the canvas background stays controlled above.",
                    isOn: $useTransparentPreviewBackground
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
                    subtitle: defaultOpenStatus
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
            return "Quick Look glass is visible behind the molecule."
        }
        return "Mol* uses its classic opaque viewer surface."
    }

    private func run(_ executable: String, arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        try? process.run()
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
            return ["molstar", "formats", "pdb", "cif", "sdf", "mol", "mol2", "xyz", "gro", "background", "transparent", "black", "canvas", "theme", "dark", "light", "auto", "grid", "toolbar", "panels", "sequence", "log"]
        case .files:
            return ["finder", "default", "double-click", "open with", "quick look", "cache", "file", "extension"]
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
                Text("Version 0.10.9")
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
    static let sidebar = Color(nsColor: .underPageBackgroundColor)
    static let card = Color(nsColor: .controlBackgroundColor)
    static let search = Color(nsColor: .textBackgroundColor)
    static let selection = Color.accentColor.opacity(0.18)
    static let separator = Color(nsColor: .separatorColor).opacity(0.55)
}
