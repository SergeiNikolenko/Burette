import AppKit
import SwiftUI

struct ContentView: View {
    @AppStorage("openSettingsAtLaunch") private var openSettingsAtLaunch = true
    @AppStorage("showMenuBarIcon") private var showMenuBarIcon = true
    @AppStorage("showPreviewPanelControls") private var showPreviewPanelControls = false
    @State private var section: SettingsSection = .general

    var body: some View {
        ZStack {
            SettingsColors.background.ignoresSafeArea()
            HStack(spacing: 0) {
                Sidebar(selection: $section)
                    .frame(width: 292)
                    .background(SettingsColors.sidebar)

                Rectangle()
                    .fill(SettingsColors.separator)
                    .frame(width: 1)

                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        Text(section.title)
                            .font(.system(size: 28, weight: .bold))
                            .padding(.bottom, 12)

                        content
                    }
                    .frame(maxWidth: 820, alignment: .leading)
                    .padding(.horizontal, 34)
                    .padding(.vertical, 30)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(minWidth: 860, minHeight: 560)
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .general:
            SettingsSectionTitle("Application Basics")
            SettingsCard {
                SettingsToggleRow(
                    title: "Open settings window at launch",
                    subtitle: "Show this window when Burette starts from the menu bar.",
                    isOn: $openSettingsAtLaunch
                )
                SettingsDivider()
                SettingsToggleRow(
                    title: "Show menu bar icon",
                    subtitle: "Burette runs as a menu bar utility and stays out of the Dock.",
                    isOn: $showMenuBarIcon,
                    isDisabled: true
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
                    icon: "arrow.up.left.and.arrow.down.right",
                    title: "Fit to screen",
                    subtitle: "Uses native window resizing so the macOS title bar stays reachable."
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
                SettingsValueRow(icon: "bolt.horizontal", title: "Performance", subtitle: "Bundled assets, cached runtime previews, and WebGL fallback.")
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
                    icon: "arrow.up.left.and.arrow.down.right",
                    title: "Fullscreen control",
                    subtitle: "The fit button opens a larger viewer with a native window fallback."
                )
            }

            SettingsSectionTitle("Quick Controls")
            SettingsCard {
                SettingsValueRow(icon: "rectangle.split.3x1", title: "Panels", subtitle: "Use the floating toolbar to show left, right, sequence, and log panes.")
                SettingsDivider()
                SettingsValueRow(icon: "hand.draw", title: "Movable toolbar", subtitle: "Drag the toolbar away from Mol* controls; its position is remembered.")
            }

        case .files:
            SettingsSectionTitle("Finder Integration")
            SettingsCard {
                SettingsValueRow(icon: "puzzlepiece.extension", title: "Quick Look extension", subtitle: "com.local.MolstarQuickLookV10.Preview")
                SettingsDivider()
                SettingsValueRow(icon: "app.badge", title: "Main bundle", subtitle: "com.local.MolstarQuickLookV10")
                SettingsDivider()
                SettingsValueRow(icon: "eye", title: "Document role", subtitle: "Viewer")
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
                    NSWorkspace.shared.open(AppDelegate.logsDirectory)
                }
                SettingsDivider()
                SettingsActionRow(icon: "doc.on.clipboard", title: "Copy Log Path", subtitle: "Copy the current log path to the clipboard.") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(AppDelegate.primaryLogURL.path, forType: .string)
                }
            }

            SettingsFootnote("Quick Look debug UI is hidden by default. Logs stay available here for troubleshooting.")

        case .about:
            AboutPanel()
        }
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
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .viewer: return "Viewer"
        case .files: return "Files"
        case .logs: return "Logs"
        case .about: return "About"
        }
    }

    var icon: String {
        switch self {
        case .general: return "gearshape"
        case .viewer: return "atom"
        case .files: return "folder"
        case .logs: return "doc.text.magnifyingglass"
        case .about: return "info.circle"
        }
    }

    var group: String? {
        switch self {
        case .general: return nil
        case .viewer, .files: return "Features"
        case .logs, .about: return "System"
        }
    }
}

private struct Sidebar: View {
    @Binding var selection: SettingsSection
    @State private var searchText = ""

    private var groupedSections: [(String?, [SettingsSection])] {
        var result: [(String?, [SettingsSection])] = []
        for section in SettingsSection.allCases {
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
            Spacer().frame(height: 38)

            SearchField(text: $searchText)
                .padding(.horizontal, 18)
                .padding(.bottom, 18)

            Rectangle()
                .fill(SettingsColors.separator)
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 16) {
                ForEach(groupedSections, id: \.0) { group, sections in
                    VStack(alignment: .leading, spacing: 7) {
                        if let group {
                            Text(group)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(.white.opacity(0.28))
                                .padding(.horizontal, 18)
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
            .padding(.horizontal, 12)
            .padding(.top, 24)

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
            HStack(spacing: 13) {
                Image(systemName: section.icon)
                    .font(.system(size: 17, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .frame(width: 22)

                Text(section.title)
                    .font(.system(size: 16, weight: .semibold))

                Spacer(minLength: 0)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(isSelected ? SettingsColors.selection : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white.opacity(0.38))

            TextField("Search settings...", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.white.opacity(0.82))
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(SettingsColors.search, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

private struct SettingsSectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 13, weight: .bold))
            .foregroundColor(.white.opacity(0.42))
            .padding(.top, 4)
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
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SettingsColors.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct SettingsToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool
    var isDisabled = false

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white.opacity(isDisabled ? 0.52 : 0.9))
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.46))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 16)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.large)
                .disabled(isDisabled)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

private struct SettingsValueRow: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundColor(.white.opacity(0.82))
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.48))
                    .lineLimit(3)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

private struct SettingsActionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundColor(.white.opacity(0.86))
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white.opacity(0.9))
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.48))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white.opacity(0.24))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(SettingsColors.separator)
            .frame(height: 1)
            .padding(.leading, 58)
    }
}

private struct SettingsFootnote: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white.opacity(0.42))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4)
    }
}

private struct AboutPanel: View {
    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 34)

            BuretteBadge()
                .frame(width: 104, height: 104)

            VStack(spacing: 4) {
                Text("Burette")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundColor(.white.opacity(0.92))
                Text("Version 0.10.1")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white.opacity(0.42))
            }

            HStack(spacing: 12) {
                Button("Open Logs") { NSWorkspace.shared.open(AppDelegate.logsDirectory) }
                Button("Clear Cache") { AppDelegate.clearPreviewCache() }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .padding(.top, 16)

            Spacer(minLength: 44)

            SettingsCard {
                SettingsValueRow(icon: "sparkles", title: "Release Notes", subtitle: "First Burette release with native settings, hidden logs, and movable Quick Look controls.")
                SettingsDivider()
                SettingsValueRow(icon: "envelope", title: "Contact", subtitle: "Local build for molecular Quick Look previews.")
            }
            .frame(maxWidth: 560)

            Spacer()
        }
        .frame(maxWidth: .infinity, minHeight: 430)
    }
}

private struct BuretteBadge: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(colors: [Color.black.opacity(0.96), Color.black.opacity(0.82)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Color.white.opacity(0.14), lineWidth: 1))

            Image(systemName: "atom")
                .font(.system(size: 48, weight: .regular))
                .symbolRenderingMode(.hierarchical)
                .foregroundColor(.white.opacity(0.9))
        }
        .shadow(color: .black.opacity(0.34), radius: 12, y: 6)
    }
}

private enum SettingsColors {
    static let background = Color(red: 0.14, green: 0.15, blue: 0.14)
    static let sidebar = Color(red: 0.10, green: 0.12, blue: 0.11).opacity(0.92)
    static let card = Color.white.opacity(0.055)
    static let search = Color.black.opacity(0.16)
    static let selection = Color.accentColor
    static let separator = Color.white.opacity(0.085)
}
