import AppKit
import CoreServices
import SwiftUI

@main
struct BurreteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            ContentView()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var settingsWindow: NSWindow?
    private var viewerWindows: [URL: MoleculeViewerWindowController] = [:]
    private var openedDocumentAtLaunch = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        installStatusItem()
        BurreteFileAssociations.registerForUnsetDefaults()
        if UserDefaults.standard.object(forKey: "openSettingsAtLaunch") == nil {
            UserDefaults.standard.set(true, forKey: "openSettingsAtLaunch")
        }
        if UserDefaults.standard.bool(forKey: "openSettingsAtLaunch") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                if self?.openedDocumentAtLaunch == false {
                    self?.openSettings()
                }
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        openedDocumentAtLaunch = true
        for url in urls {
            openViewer(for: url)
        }
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        false
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        openedDocumentAtLaunch = true
        openViewer(for: URL(fileURLWithPath: filename))
        return true
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        openedDocumentAtLaunch = true
        for filename in filenames {
            openViewer(for: URL(fileURLWithPath: filename))
        }
        sender.reply(toOpenOrPrint: .success)
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = BurreteIcon.statusImage()
            button.toolTip = "Burrete"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "Open Logs Folder", action: #selector(openLogsFolder), keyEquivalent: "l"))
        menu.addItem(NSMenuItem(title: "Copy Log Path", action: #selector(copyLogPath), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Clear Preview Cache", action: #selector(clearPreviewCache), keyEquivalent: "k"))
        menu.addItem(NSMenuItem(title: "Reset Quick Look", action: #selector(resetQuickLook), keyEquivalent: "r"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Burrete", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        item.menu = menu
        statusItem = item
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            let controller = NSHostingController(rootView: ContentView())
            let window = SettingsWindow(contentViewController: controller)
            window.title = "Burrete Settings"
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 660, height: 460)
            window.setContentSize(NSSize(width: 820, height: 540))
            settingsWindow = window
        }

        settingsWindow?.center()
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openViewer(for url: URL) {
        let fileURL = url.standardizedFileURL
        if let existing = viewerWindows[fileURL] {
            existing.showWindow(nil)
            existing.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let controller = MoleculeViewerWindowController(fileURL: fileURL)
        viewerWindows[fileURL] = controller
        _ = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: controller.window,
            queue: .main
        ) { [weak self] _ in
            self?.viewerWindows[fileURL] = nil
        }
        controller.load()
        controller.showWindow(nil)
        controller.window?.center()
        controller.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openLogsFolder() {
        NSWorkspace.shared.open(Self.logsDirectory)
    }

    @objc private func copyLogPath() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Self.primaryLogURL.path, forType: .string)
    }

    @objc private func clearPreviewCache() {
        Self.clearPreviewCache()
    }

    static func clearPreviewCache() {
        let previewsURL = Self.previewCacheDirectory
        let fileManager = FileManager.default
        guard let contents = try? fileManager.contentsOfDirectory(at: previewsURL, includingPropertiesForKeys: nil) else { return }
        for url in contents where url.lastPathComponent != "assets" {
            try? fileManager.removeItem(at: url)
        }
    }

    @objc private func resetQuickLook() {
        run("/usr/bin/qlmanage", arguments: ["-r"])
        run("/usr/bin/qlmanage", arguments: ["-r", "cache"])
        run("/usr/bin/killall", arguments: ["quicklookd"])
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func run(_ executable: String, arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        try? process.run()
    }

    static var logsDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete", isDirectory: true)
    }

    static var previewCacheDirectory: URL {
        logsDirectory.appendingPathComponent("previews", isDirectory: true)
    }

    static var primaryLogURL: URL {
        logsDirectory.appendingPathComponent("Burrete.log")
    }
}

enum BurreteFileAssociations {
    static let bundleIdentifier = "com.local.BurreteV10"
    private static let legacyBundleIdentifiers = [
        "com.local.molstarquicklook",
        "com.local.molstarquicklookv8",
        "com.local.molstarquicklookv10"
    ]
    static let contentTypes = [
        "com.local.burrete10.pdb",
        "com.local.burrete10.cif",
        "com.local.burrete10.mmcif",
        "com.local.burrete10.bcif",
        "com.local.burrete10.sdf",
        "com.local.burrete10.mol",
        "com.local.burrete10.mol2",
        "com.local.burrete10.xyz",
        "com.local.burrete10.gro",
        "com.local.molstarquicklook10.pdb",
        "com.local.molstarquicklook10.cif",
        "com.local.molstarquicklook10.mmcif",
        "com.local.molstarquicklook10.bcif",
        "com.local.molstarquicklook10.sdf",
        "com.local.molstarquicklook10.mol",
        "com.local.molstarquicklook10.mol2",
        "org.wwpdb.pdb",
        "org.wwpdb.cif",
        "org.wwpdb.mmcif",
        "org.wwpdb.bcif",
        "org.iucr.cif",
        "org.iucr.mmcif",
        "com.schrodinger.pdb",
        "org.openscience.sdf",
        "org.openscience.molfile",
        "org.openscience.mol2",
        "public.pdb",
        "public.cif",
        "public.mmcif"
    ]

    static var defaultHandlerSummary: String {
        let current = contentTypes.filter { defaultHandler(for: $0) == bundleIdentifier }.count
        if current == contentTypes.count {
            return "Burrete is the default app for supported molecular structure files."
        }
        if current == 0 {
            return "Double-click behavior depends on Finder defaults. Use this to make Burrete the default viewer."
        }
        return "Burrete is the default for \(current) of \(contentTypes.count) registered molecular content types."
    }

    @discardableResult
    static func registerAsDefaultHandler() -> String {
        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
        let failures = contentTypes.compactMap { contentType -> String? in
            let status = LSSetDefaultRoleHandlerForContentType(contentType as CFString, .viewer, bundleIdentifier as CFString)
            return status == noErr ? nil : "\(contentType): \(status)"
        }
        if failures.isEmpty {
            return "Burrete is now the default viewer for supported molecular structure files."
        }
        return "Some file types could not be updated: \(failures.prefix(3).joined(separator: "; "))"
    }

    static func registerForUnsetDefaults() {
        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
        for contentType in contentTypes where shouldClaimDefaultHandler(for: contentType) {
            LSSetDefaultRoleHandlerForContentType(contentType as CFString, .viewer, bundleIdentifier as CFString)
        }
    }

    private static func defaultHandler(for contentType: String) -> String? {
        LSCopyDefaultRoleHandlerForContentType(contentType as CFString, .viewer)?.takeRetainedValue() as String?
    }

    private static func shouldClaimDefaultHandler(for contentType: String) -> Bool {
        guard let handler = defaultHandler(for: contentType) else {
            return true
        }
        return legacyBundleIdentifiers.contains(handler.lowercased())
    }
}

private final class SettingsWindow: NSWindow {
    private let defaultContentSize = NSSize(width: 820, height: 540)

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command),
              let key = event.charactersIgnoringModifiers else {
            return super.performKeyEquivalent(with: event)
        }

        switch key {
        case "+", "=":
            resizeContent(by: 1.1)
            return true
        case "-", "_":
            resizeContent(by: 1 / 1.1)
            return true
        case "0":
            setContentSizeKeepingCenter(defaultContentSize)
            return true
        default:
            return super.performKeyEquivalent(with: event)
        }
    }

    private func resizeContent(by factor: CGFloat) {
        let current = contentLayoutRect.size
        let next = NSSize(
            width: min(max(current.width * factor, minSize.width), 1160),
            height: min(max(current.height * factor, minSize.height), 820)
        )
        setContentSizeKeepingCenter(next)
    }

    private func setContentSizeKeepingCenter(_ size: NSSize) {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        setContentSize(size)
        setFrameOrigin(NSPoint(x: center.x - frame.width / 2, y: center.y - frame.height / 2))
    }
}

enum BurreteIcon {
    static func statusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        NSColor.clear.setFill()
        NSRect(x: 0, y: 0, width: 18, height: 18).fill()

        let atom = NSBezierPath(ovalIn: NSRect(x: 7.4, y: 7.4, width: 3.2, height: 3.2))
        NSColor.labelColor.setFill()
        atom.fill()

        let ringA = NSBezierPath(ovalIn: NSRect(x: 2.9, y: 6.2, width: 12.2, height: 5.6))
        NSColor.labelColor.setStroke()
        ringA.lineWidth = 1.35
        ringA.stroke()

        var transformB = AffineTransform(translationByX: 9, byY: 9)
        transformB.rotate(byDegrees: 60)
        transformB.translate(x: -9, y: -9)
        let ringB = NSBezierPath(ovalIn: NSRect(x: 2.9, y: 6.2, width: 12.2, height: 5.6))
        ringB.transform(using: transformB)
        ringB.lineWidth = 1.35
        ringB.stroke()

        var transformC = AffineTransform(translationByX: 9, byY: 9)
        transformC.rotate(byDegrees: -60)
        transformC.translate(x: -9, y: -9)
        let ringC = NSBezierPath(ovalIn: NSRect(x: 2.9, y: 6.2, width: 12.2, height: 5.6))
        ringC.transform(using: transformC)
        ringC.lineWidth = 1.35
        ringC.stroke()

        let path = NSBezierPath()
        NSColor.labelColor.setStroke()
        path.lineWidth = 1.1
        path.lineCapStyle = .round
        path.move(to: NSPoint(x: 12.4, y: 3.6))
        path.line(to: NSPoint(x: 14.4, y: 2.1))
        path.stroke()

        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}
