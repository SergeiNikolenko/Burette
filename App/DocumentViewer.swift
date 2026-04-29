import AppKit
import WebKit

final class BuretteDocumentViewerController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private let fileURL: URL
    private let webView: WKWebView
    private var restoredWindowFrame: NSRect?
    var onClose: ((BuretteDocumentViewerController) -> Void)?

    init(fileURL: URL) {
        self.fileURL = fileURL

        let userContentController = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if #available(macOS 11.0, *) {
            let preferences = WKWebpagePreferences()
            preferences.allowsContentJavaScript = true
            configuration.defaultWebpagePreferences = preferences
        } else {
            configuration.preferences.javaScriptEnabled = true
        }
        configuration.userContentController = userContentController

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1.0).cgColor

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = fileURL.lastPathComponent
        window.minSize = NSSize(width: 760, height: 520)
        window.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1.0)
        window.contentView = BuretteDocumentContainerView(contentView: webView)

        super.init(window: window)

        userContentController.add(self, name: "molstarQuickLook")
        webView.navigationDelegate = self
        window.delegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "molstarQuickLook")
    }

    func open() {
        window?.center()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        loadFile()
    }

    func windowWillClose(_ notification: Notification) {
        onClose?(self)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "molstarQuickLook",
              let body = message.body as? [String: Any] else {
            return
        }
        let type = body["type"] as? String ?? "unknown"
        let text = body["message"] as? String ?? String(describing: body)
        if type == "action" {
            handleJavaScriptAction(text)
        } else if type == "ready" {
            window?.title = fileURL.lastPathComponent
        } else if type == "error" {
            NSLog("[MolstarQuickLookV10] document viewer error: \(text)")
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.loadHTMLString(Self.errorHTML(title: "WebKit process terminated", details: "The embedded WebKit process crashed while initializing Mol*."), baseURL: nil)
    }

    private func loadFile() {
        DispatchQueue.global(qos: .userInitiated).async { [fileURL] in
            do {
                let runtime = try Self.prepareRuntime(for: fileURL)
                DispatchQueue.main.async { [weak self] in
                    self?.webView.loadFileURL(runtime.indexURL, allowingReadAccessTo: runtime.readAccessURL)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.webView.loadHTMLString(Self.errorHTML(title: "Burette could not open \(fileURL.lastPathComponent)", details: Self.describe(error)), baseURL: nil)
                }
            }
        }
    }

    private func handleJavaScriptAction(_ action: String) {
        switch action {
        case "fit":
            toggleFitToScreen()
        default:
            NSLog("[MolstarQuickLookV10] unknown document viewer action: \(action)")
        }
    }

    private func toggleFitToScreen() {
        guard let window, let screen = window.screen ?? NSScreen.main else { return }
        if let frame = restoredWindowFrame {
            window.setFrame(frame, display: true, animate: true)
            restoredWindowFrame = nil
        } else {
            restoredWindowFrame = window.frame
            window.setFrame(screen.visibleFrame.insetBy(dx: 12, dy: 12), display: true, animate: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.webView.evaluateJavaScript("window.MolstarQuickLookHandleResize && window.MolstarQuickLookHandleResize();", completionHandler: nil)
        }
    }

    private struct Runtime {
        let indexURL: URL
        let readAccessURL: URL
    }

    private static func prepareRuntime(for fileURL: URL) throws -> Runtime {
        let accessGranted = fileURL.startAccessingSecurityScopedResource()
        defer { if accessGranted { fileURL.stopAccessingSecurityScopedResource() } }

        let fileManager = FileManager.default
        try ensureUbiquitousFileIsAvailable(fileURL, fileManager: fileManager)

        let webDirectory = try locateBundledWebDirectory(fileManager: fileManager)
        let structureData = try Data(contentsOf: fileURL)
        guard !structureData.isEmpty else { throw DocumentViewerError.emptyStructureFile(fileURL.lastPathComponent) }

        guard let cachesDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw DocumentViewerError.couldNotCreateRuntime("Caches directory is unavailable")
        }
        let runtimeRoot = cachesDirectory
            .appendingPathComponent("Burette", isDirectory: true)
            .appendingPathComponent("document-viewer", isDirectory: true)
        try fileManager.createDirectory(at: runtimeRoot, withIntermediateDirectories: true)
        pruneRuntimeDirectories(in: runtimeRoot, fileManager: fileManager)

        let runtimeDirectory = runtimeRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)

        for assetName in ["index.html", "molstar.js", "molstar.css", "viewer.js"] {
            try fileManager.copyItem(at: webDirectory.appendingPathComponent(assetName), to: runtimeDirectory.appendingPathComponent(assetName))
        }

        let format = BuretteStructureFormat(url: fileURL, data: structureData)
        let payload: [String: Any] = [
            "format": format.molstarFormat,
            "binary": format.isBinary,
            "label": fileURL.lastPathComponent,
            "byteCount": structureData.count,
            "quickLookBuild": "v10-product",
            "debug": false
        ]
        let configData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        try Data("window.MolstarQuickLookConfig = \(String(data: configData, encoding: .utf8) ?? "{}");\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        try Data("window.MolstarQuickLookDataBase64 = \"\(structureData.base64EncodedString())\";\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])

        return Runtime(indexURL: runtimeDirectory.appendingPathComponent("index.html"), readAccessURL: runtimeRoot)
    }

    private static func locateBundledWebDirectory(fileManager: FileManager) throws -> URL {
        var candidates: [URL] = []
        if let pluginsURL = Bundle.main.builtInPlugInsURL {
            candidates.append(pluginsURL.appendingPathComponent("MolstarQuickLookPreview.appex/Contents/Resources/Web", isDirectory: true))
        }
        if let resourceURL = Bundle.main.resourceURL {
            candidates.append(resourceURL.appendingPathComponent("Web", isDirectory: true))
        }

        for candidate in candidates where fileManager.fileExists(atPath: candidate.appendingPathComponent("viewer.js").path) {
            return candidate
        }
        throw DocumentViewerError.missingWebDirectory(candidates.map(\.path).joined(separator: "\n"))
    }

    private static func pruneRuntimeDirectories(in runtimeRoot: URL, fileManager: FileManager) {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .contentModificationDateKey]
        guard let contents = try? fileManager.contentsOfDirectory(at: runtimeRoot, includingPropertiesForKeys: Array(keys)) else { return }
        let cutoff = Date().addingTimeInterval(-12 * 60 * 60)
        let directories = contents.compactMap { url -> (url: URL, modified: Date)? in
            guard let values = try? url.resourceValues(forKeys: keys), values.isDirectory == true else { return nil }
            return (url, values.contentModificationDate ?? .distantPast)
        }
        let expired = directories.filter { $0.modified < cutoff }
        let overflow = directories.sorted { $0.modified > $1.modified }.dropFirst(32)
        var removed = Set<String>()
        for entry in expired + overflow where removed.insert(entry.url.path).inserted {
            try? fileManager.removeItem(at: entry.url)
        }
    }

    private static func ensureUbiquitousFileIsAvailable(_ url: URL, fileManager: FileManager) throws {
        let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        guard values?.isUbiquitousItem == true else { return }
        if values?.ubiquitousItemDownloadingStatus == .current || values?.ubiquitousItemDownloadingStatus == .downloaded { return }
        try? fileManager.startDownloadingUbiquitousItem(at: url)
        for _ in 0..<50 {
            let nextValues = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
            if nextValues?.ubiquitousItemDownloadingStatus == .current || nextValues?.ubiquitousItemDownloadingStatus == .downloaded { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
    }

    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        var lines = ["\(type(of: error)): \(error.localizedDescription)", "domain=\(nsError.domain) code=\(nsError.code)"]
        if !nsError.userInfo.isEmpty { lines.append("userInfo=\(nsError.userInfo)") }
        return lines.joined(separator: "\n")
    }

    private static func errorHTML(title: String, details: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:100%;height:100%;background:#111317;color:#f2f2f2}
        body{box-sizing:border-box;padding:24px;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
        h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;background:#24262a;padding:12px;border-radius:8px}
        </style></head><body><h1>\(escapeHTML(title))</h1><pre>\(escapeHTML(details))</pre></body></html>
        """
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}

private final class BuretteDocumentContainerView: NSView {
    init(contentView: NSView) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.10).cgColor
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1.0).cgColor

        contentView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(contentView)
        NSLayoutConstraint.activate([
            contentView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 1),
            contentView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -1),
            contentView.topAnchor.constraint(equalTo: topAnchor, constant: 1),
            contentView.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -1)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private struct BuretteStructureFormat {
    let molstarFormat: String
    let isBinary: Bool

    init(url: URL, data: Data) {
        switch url.pathExtension.lowercased() {
        case "pdb", "ent", "pqr":
            molstarFormat = "pdb"
            isBinary = false
        case "pdbqt":
            molstarFormat = "pdbqt"
            isBinary = false
        case "cif":
            molstarFormat = Self.detectCIFFormat(data: data)
            isBinary = false
        case "mmcif", "mcif":
            molstarFormat = "mmcif"
            isBinary = false
        case "bcif":
            molstarFormat = "mmcif"
            isBinary = true
        case "sdf", "sd":
            molstarFormat = "sdf"
            isBinary = false
        case "mol":
            molstarFormat = "mol"
            isBinary = false
        case "mol2":
            molstarFormat = "mol2"
            isBinary = false
        case "xyz":
            molstarFormat = "xyz"
            isBinary = false
        case "gro":
            molstarFormat = "gro"
            isBinary = false
        default:
            molstarFormat = "mmcif"
            isBinary = false
        }
    }

    private static func detectCIFFormat(data: Data) -> String {
        let text = decodeText(Data(data.prefix(262_144))).lowercased()
        if text.contains("_atom_site.cartn_x") ||
            text.contains("_atom_site.label_atom_id") ||
            text.contains("_entity_poly") ||
            text.contains("_chem_comp.") ||
            text.contains("_ma_") ||
            text.contains("modelcif") ||
            text.contains("_pdbx_") {
            return "mmcif"
        }
        return "cifCore"
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }
}

private enum DocumentViewerError: LocalizedError {
    case missingWebDirectory(String)
    case emptyStructureFile(String)
    case couldNotCreateRuntime(String)

    var errorDescription: String? {
        switch self {
        case .missingWebDirectory(let paths):
            return "Could not locate bundled Mol* web resources. Checked:\n\(paths)"
        case .emptyStructureFile(let name):
            return "The structure file is empty or not downloaded locally: \(name)"
        case .couldNotCreateRuntime(let reason):
            return "Could not create document viewer runtime files: \(reason)"
        }
    }
}
