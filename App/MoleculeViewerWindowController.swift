import AppKit
import WebKit

enum AppViewerRendererMode {
    static func normalize(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "xyz-fast", "fast-xyz", "xyzfast":
            return "xyz-fast"
        case "molstar", "mol*", "interactive":
            return "molstar"
        case "xyzrender-external", "external-xyzrender", "xyzrender":
            return "xyzrender-external"
        default:
            return "auto"
        }
    }
}

enum AppViewerXyzrenderPreset {
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

final class MoleculeViewerWindowController: NSWindowController, WKNavigationDelegate, WKScriptMessageHandler {
    private let fileURL: URL
    private let webView: WKWebView
    private var currentViewerPageZoom: CGFloat = 1.0
    private var rendererOverride: String?
    private var xyzrenderPresetOverride: String?
    private var isInNativeFullScreen = false
    private var isEnteringNativeFullScreen = false
    private static let defaultViewerPageZoom: CGFloat = 1.0
    private static let minViewerPageZoom: CGFloat = 1.0
    private static let maxViewerPageZoom: CGFloat = 1.0

    init(fileURL: URL) {
        self.fileURL = fileURL
        let displayPreferences = Self.currentDisplayPreferences

        let userContentController = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = userContentController
        if #available(macOS 11.0, *) {
            let prefs = WKWebpagePreferences()
            prefs.allowsContentJavaScript = true
            configuration.defaultWebpagePreferences = prefs
        } else {
            configuration.preferences.javaScriptEnabled = true
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.pageZoom = Self.defaultViewerPageZoom
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Burrete - \(fileURL.lastPathComponent)"
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = false
        window.isMovableByWindowBackground = true
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.minSize = NSSize(width: 660, height: 440)
        if #available(macOS 11.0, *) {
            window.toolbarStyle = .unifiedCompact
        }
        window.hasShadow = true
        window.contentView = BurreteAppViewerContainerView(contentView: webView, preferences: displayPreferences)

        super.init(window: window)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidEnterFullScreen),
            name: NSWindow.didEnterFullScreenNotification,
            object: window
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidExitFullScreen),
            name: NSWindow.didExitFullScreenNotification,
            object: window
        )
        userContentController.add(self, name: "burrete")
        webView.navigationDelegate = self
        webView.wantsLayer = true
        applyWindowDisplayPreferences(displayPreferences)
        webView.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif
    }

    required init?(coder: NSCoder) {
        nil
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "burrete")
    }

    func load() {
        do {
            let runtime = try AppViewerRuntime.create(
                for: fileURL,
                rendererModeOverride: rendererOverride,
                xyzrenderPresetOverride: xyzrenderPresetOverride
            )
            webView.loadFileURL(runtime.indexURL, allowingReadAccessTo: runtime.readAccessURL)
        } catch {
            webView.loadHTMLString(Self.errorHTML(error), baseURL: nil)
        }
    }

    func reloadDisplayPreferences() {
        applyWindowDisplayPreferences(Self.currentDisplayPreferences)
        load()
    }

    func reloadSettingsPreferences() {
        rendererOverride = nil
        xyzrenderPresetOverride = nil
        reloadDisplayPreferences()
    }

    func enterFullScreen() {
        guard window != nil, !isInNativeFullScreen, !isEnteringNativeFullScreen else { return }
        isEnteringNativeFullScreen = true
        DispatchQueue.main.async { [weak self] in
            guard let self, let window = self.window else { return }
            window.toggleFullScreen(nil)
        }
    }

    @objc private func windowDidEnterFullScreen(_ notification: Notification) {
        isInNativeFullScreen = true
        isEnteringNativeFullScreen = false
    }

    @objc private func windowDidExitFullScreen(_ notification: Notification) {
        isInNativeFullScreen = false
        isEnteringNativeFullScreen = false
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "burrete",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            return
        }
        if type == "viewerZoom", let value = body["value"] as? NSNumber {
            setViewerPageZoom(CGFloat(value.doubleValue))
            return
        }
        if type == "copyText", let text = body["text"] as? String {
            copyToPasteboard(text)
            return
        }
        if type == "exportText",
           let text = body["text"] as? String,
           let name = body["name"] as? String {
            exportText(text, suggestedName: name)
            return
        }
        if type == "setRenderer", let value = body["value"] as? String {
            setRendererOverride(value)
            return
        }
        if type == "setXyzrenderPreset", let value = body["value"] as? String {
            setXyzrenderPresetOverride(value)
            return
        }
        let text = (body["message"] as? String) ?? ""
        NSLog("[BurreteAppViewer] %@: %@ %@", fileURL.lastPathComponent, type, text)
    }

    private func applyWindowDisplayPreferences(_ preferences: AppViewerDisplayPreferences) {
        let backgroundColor = preferences.isWindowTransparent ? NSColor.clear : NSColor.windowBackgroundColor
        window?.appearance = preferences.windowAppearance
        window?.isOpaque = !preferences.isWindowTransparent
        window?.backgroundColor = backgroundColor
        (window?.contentView as? BurreteAppViewerContainerView)?.apply(preferences)
        webView.layer?.backgroundColor = backgroundColor.cgColor
        if #available(macOS 11.0, *) {
            webView.underPageBackgroundColor = backgroundColor
        }
    }

    private func setViewerPageZoom(_ scale: CGFloat) {
        let clamped = min(max(scale, Self.minViewerPageZoom), Self.maxViewerPageZoom)
        guard abs(currentViewerPageZoom - clamped) > 0.001 else { return }
        currentViewerPageZoom = clamped
        webView.pageZoom = clamped
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.webView.evaluateJavaScript("window.BurreteHandleResize && window.BurreteHandleResize();", completionHandler: nil)
        }
    }

    private func copyToPasteboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        NSLog("[BurreteAppViewer] %@: copied %d characters", fileURL.lastPathComponent, text.count)
    }

    private func exportText(_ text: String, suggestedName: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        let writeSelection = { [weak self] in
            guard let self, let url = panel.url else { return }
            do {
                try text.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                NSLog("[BurreteAppViewer] %@: export failed: %@", self.fileURL.lastPathComponent, String(describing: error))
            }
        }
        if let sheetWindow = window ?? NSApp.keyWindow {
            panel.beginSheetModal(for: sheetWindow) { response in
                if response == .OK { writeSelection() }
            }
        } else if panel.runModal() == .OK {
            writeSelection()
        }
    }

    private func setRendererOverride(_ value: String) {
        let renderer = AppViewerRendererMode.normalize(value)
        guard rendererOverride != renderer else { return }
        rendererOverride = renderer
        load()
    }

    private func setXyzrenderPresetOverride(_ value: String) {
        let preset = AppViewerXyzrenderPreset.normalize(value)
        guard xyzrenderPresetOverride != preset else { return }
        xyzrenderPresetOverride = preset
        rendererOverride = "xyzrender-external"
        load()
    }

    private static func errorHTML(_ error: Error) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:100%;height:100%;background:#111317;color:#f2f2f2}
        body{box-sizing:border-box;padding:24px;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
        h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;background:#24262a;padding:12px;border-radius:8px}
        </style></head><body><h1>Burrete could not open this file</h1><pre>\(escapeHTML(String(describing: error)))</pre></body></html>
        """
    }

    private static var currentDisplayPreferences: AppViewerDisplayPreferences {
        AppViewerDisplayPreferences(
            transparentWindow: UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? false,
            theme: UserDefaults.standard.string(forKey: "viewerTheme") ?? "auto",
            windowOpacity: UserDefaults.standard.object(forKey: "viewerWindowOpacity") as? Double ?? 0.82,
            overlayOpacity: UserDefaults.standard.object(forKey: "viewerOverlayOpacity") as? Double ?? 0.90
        )
    }
}

private struct AppViewerDisplayPreferences {
    let transparentWindow: Bool
    let theme: String
    let windowOpacity: Double
    let overlayOpacity: Double

    var isWindowTransparent: Bool {
        transparentWindow
    }

    var clampedWindowOpacity: CGFloat {
        CGFloat(min(max(windowOpacity, 0.35), 0.95))
    }

    var clampedOverlayOpacity: Double {
        min(max(overlayOpacity, 0.72), 0.98)
    }

    var resolvedTheme: String {
        if theme == "dark" || theme == "light" { return theme }
        if let appearance = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]), appearance == .darkAqua {
            return "dark"
        }
        return "light"
    }

    var windowAppearance: NSAppearance? {
        if theme == "dark" { return NSAppearance(named: .darkAqua) }
        if theme == "light" { return NSAppearance(named: .aqua) }
        return nil
    }

    var baseColor: NSColor {
        resolvedTheme == "dark" ? NSColor(calibratedWhite: 0.08, alpha: 1.0) : NSColor.windowBackgroundColor
    }
}

private struct AppViewerRuntime {
    let indexURL: URL
    let readAccessURL: URL
    private static let maxStructureFileSize: Int64 = 75 * 1024 * 1024

    static func create(
        for fileURL: URL,
        rendererModeOverride: String? = nil,
        xyzrenderPresetOverride: String? = nil
    ) throws -> AppViewerRuntime {
        guard let bundledWebDirectory = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
              FileManager.default.fileExists(atPath: bundledWebDirectory.path) else {
            throw AppViewerError.missingWebResources
        }

        let didStartAccess = fileURL.startAccessingSecurityScopedResource()
        defer {
            if didStartAccess {
                fileURL.stopAccessingSecurityScopedResource()
            }
        }
        let size = try fileSize(for: fileURL)
        guard size <= maxStructureFileSize else {
            throw AppViewerError.fileTooLarge(fileURL.lastPathComponent, size, maxStructureFileSize)
        }
        let data = try Data(contentsOf: fileURL)
        guard !data.isEmpty else { throw AppViewerError.emptyFile(fileURL.lastPathComponent) }

        guard let cachesDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw AppViewerError.missingCacheDirectory
        }
        let baseDirectory = cachesDirectory
            .appendingPathComponent("Burrete", isDirectory: true)
            .appendingPathComponent("app-viewer", isDirectory: true)
        let assetsDirectory = baseDirectory.appendingPathComponent("assets", isDirectory: true)
        let runtimeDirectory = baseDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)

        pruneRuntimeDirectories(in: baseDirectory)
        try FileManager.default.createDirectory(at: assetsDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
        try copyAssets(from: bundledWebDirectory, to: assetsDirectory)

        let transparentBackground = UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? false
        let viewerTheme = UserDefaults.standard.string(forKey: "viewerTheme") ?? "auto"
        let canvasBackground = UserDefaults.standard.string(forKey: "viewerCanvasBackground") ?? "auto"
        let canvasIsTransparent = canvasBackground == "transparent"
        let overlayOpacity = AppViewerDisplayPreferences(
            transparentWindow: transparentBackground,
            theme: viewerTheme,
            windowOpacity: UserDefaults.standard.object(forKey: "viewerWindowOpacity") as? Double ?? 0.82,
            overlayOpacity: UserDefaults.standard.object(forKey: "viewerOverlayOpacity") as? Double ?? 0.90
        ).clampedOverlayOpacity

        if let gridPreview = try MoleculeGridPreviewBuilder.makePreview(
            fileURL: fileURL,
            data: data,
            host: .app,
            theme: viewerTheme,
            canvasBackground: canvasBackground,
            transparentBackground: canvasIsTransparent,
            overlayOpacity: overlayOpacity,
            debug: false,
            allowSelection: true,
            allowExport: true,
            maxRecords: 5000,
            fileSupport: MoleculeGridFileSupport.load()
        ) {
            try requireGridRuntimeAssets(in: assetsDirectory)
            let gridRecordsScript = try gridRecordsScriptWithRDKitWasm(
                gridPreview.recordsScript,
                bundledWebDirectory: bundledWebDirectory
            )
            try Data(gridHTML(title: fileURL.lastPathComponent, transparentBackground: transparentBackground).utf8)
                .write(to: runtimeDirectory.appendingPathComponent("index.html"), options: [.atomic])
            try Data("window.BurreteConfig = \(gridPreview.configJSON);\n".utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
            try Data("window.BurreteDataBase64 = null;\n".utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])
            try Data(gridRecordsScript.utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-grid-records.js"), options: [.atomic])
            return AppViewerRuntime(
                indexURL: runtimeDirectory.appendingPathComponent("index.html"),
                readAccessURL: baseDirectory
            )
        }
        if MoleculeGridFileSupport.requiresGridPreview(fileExtension: fileURL.pathExtension) {
            if !MoleculeGridFileSupport.load().supports(fileExtension: fileURL.pathExtension) {
                throw AppViewerError.gridFileTypeDisabled(fileURL.pathExtension)
            }
            throw AppViewerError.unsupportedFile(fileURL.lastPathComponent)
        }

        let format = AppViewerStructureFormat(url: fileURL, data: data)
        let storedRendererMode = UserDefaults.standard.string(forKey: "structureRendererMode") ?? "auto"
        let rendererMode = rendererModeOverride ?? storedRendererMode
        let storedXyzrenderPreset = UserDefaults.standard.string(forKey: "xyzrenderPreset") ?? "default"
        let xyzrenderPreset = AppViewerXyzrenderPreset.normalize(xyzrenderPresetOverride ?? storedXyzrenderPreset)
        var renderer = resolveRenderer(for: format, rendererMode: rendererMode)
        var externalArtifact: ExternalXyzrenderArtifact?
        var externalStatus: [String: Any]?
        if renderer == "xyzrender-external" {
            do {
                externalArtifact = try ExternalXyzrenderWorker.render(
                    inputURL: fileURL,
                    outputDirectory: runtimeDirectory,
                    preset: xyzrenderPreset,
                    customConfigPath: UserDefaults.standard.string(forKey: "xyzrenderCustomConfigPath") ?? "",
                    transparent: canvasIsTransparent,
                    extraArguments: UserDefaults.standard.string(forKey: "xyzrenderExtraArguments") ?? ""
                )
            } catch {
                renderer = format.molstarFormat == "xyz" ? "xyz-fast" : "molstar"
                externalStatus = [
                    "status": "fallback",
                    "requested": "xyzrender-external",
                    "message": error.localizedDescription
                ]
            }
        }
        let xyzFastPayload = renderer == "xyz-fast" ? makeXYZFastPayload(from: data) : nil
        let dataForWeb = xyzFastPayload?.data ?? data

        var config: [String: Any] = [
            "format": format.molstarFormat,
            "molstarFormat": format.molstarFormat,
            "binary": format.isBinary,
            "renderer": renderer,
            "requestedRenderer": rendererMode,
            "storedRenderer": storedRendererMode,
            "allowMolstarFallback": true,
            "label": fileURL.lastPathComponent,
            "byteCount": data.count,
            "previewByteCount": dataForWeb.count,
            "quickLookBuild": "burrete-app",
            "debug": false,
            "theme": viewerTheme,
            "canvasBackground": canvasBackground,
            "uiScale": 1.0,
            "overlayOpacity": overlayOpacity,
            "transparentBackground": canvasIsTransparent,
            "sdfGrid": true,
            "appViewer": true,
            "xyzrenderPreset": xyzrenderPreset,
            "xyzrenderPresetOptions": AppViewerXyzrenderPreset.pickerOptions.map { ["value": $0.0, "label": $0.1] },
            "showPanelControls": UserDefaults.standard.object(forKey: "showPreviewPanelControls") as? Bool ?? true,
            "defaultLayoutState": [
                "left": "collapsed",
                "right": "hidden",
                "top": "hidden",
                "bottom": "hidden"
            ]
        ]
        if renderer == "xyz-fast" {
            var xyzFast: [String: Any] = [
                "style": UserDefaults.standard.string(forKey: "xyzFastStyle") ?? "default",
                "firstFrameOnly": true,
                "showCell": true,
                "sourceByteCount": data.count,
                "previewByteCount": dataForWeb.count
            ]
            if let atomCount = xyzFastPayload?.atomCount { xyzFast["atomCount"] = atomCount }
            if let frameCount = xyzFastPayload?.frameCount { xyzFast["frameCount"] = frameCount }
            if let comment = xyzFastPayload?.comment, !comment.isEmpty { xyzFast["comment"] = comment }
            config["xyzFast"] = xyzFast
        }
        if let externalArtifact {
            config["externalArtifact"] = [
                "path": externalArtifact.relativePath,
                "type": externalArtifact.outputType,
                "renderer": "xyzrender",
                "preset": externalArtifact.preset,
                "config": externalArtifact.configArgument,
                "elapsedMs": externalArtifact.elapsedMs,
                "log": externalArtifact.log
            ]
        }
        if let externalStatus { config["externalRendererStatus"] = externalStatus }
        let configData = try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys, .withoutEscapingSlashes])
        let configJSON = String(data: configData, encoding: .utf8) ?? "{}"

        try Data(html(title: fileURL.lastPathComponent, transparentBackground: transparentBackground, renderer: renderer).utf8)
            .write(to: runtimeDirectory.appendingPathComponent("index.html"), options: [.atomic])
        try Data("window.BurreteConfig = \(configJSON);\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        try Data("window.BurreteDataBase64 = \"\(dataForWeb.base64EncodedString())\";\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])

        return AppViewerRuntime(
            indexURL: runtimeDirectory.appendingPathComponent("index.html"),
            readAccessURL: baseDirectory
        )
    }

    private static func copyAssets(from sourceDirectory: URL, to assetsDirectory: URL) throws {
        for name in ["molstar.js", "molstar.css", "burette-agent.js", "viewer.js", "xyz-fast.js", "grid-viewer.js", "grid.css"] {
            let source = sourceDirectory.appendingPathComponent(name)
            let destination = assetsDirectory.appendingPathComponent(name)
            try copyAssetAtomically(from: source, to: destination)
        }
        let rdkitSource = sourceDirectory.appendingPathComponent("rdkit", isDirectory: true)
        if FileManager.default.fileExists(atPath: rdkitSource.path) {
            try copyDirectoryAtomically(from: rdkitSource, to: assetsDirectory.appendingPathComponent("rdkit", isDirectory: true))
        }
    }

    private static func requireGridRuntimeAssets(in assetsDirectory: URL) throws {
        for relativePath in ["grid-viewer.js", "grid.css", "rdkit/RDKit_minimal.js", "rdkit/RDKit_minimal.wasm"] {
            let url = assetsDirectory.appendingPathComponent(relativePath)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw AppViewerError.missingWebResources
            }
        }
    }

    private static func gridRecordsScriptWithRDKitWasm(_ recordsScript: String, bundledWebDirectory: URL) throws -> String {
        let wasmURL = bundledWebDirectory
            .appendingPathComponent("rdkit", isDirectory: true)
            .appendingPathComponent("RDKit_minimal.wasm")
        let wasmBase64 = try Data(contentsOf: wasmURL).base64EncodedString()
        return recordsScript + "window.BurreteRDKitWasmBase64 = \"\(wasmBase64)\";\n"
    }

    private static func copyAssetAtomically(from source: URL, to destination: URL) throws {
        let fileManager = FileManager.default
        let temporaryURL = destination
            .deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        try? fileManager.removeItem(at: temporaryURL)
        defer { try? fileManager.removeItem(at: temporaryURL) }
        try fileManager.copyItem(at: source, to: temporaryURL)
        if fileManager.fileExists(atPath: destination.path) {
            _ = try fileManager.replaceItemAt(destination, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: destination)
        }
    }

    private static func copyDirectoryAtomically(from source: URL, to destination: URL) throws {
        let fileManager = FileManager.default
        let temporaryURL = destination
            .deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp", isDirectory: true)
        try? fileManager.removeItem(at: temporaryURL)
        defer { try? fileManager.removeItem(at: temporaryURL) }
        try fileManager.copyItem(at: source, to: temporaryURL)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: temporaryURL, to: destination)
    }

    private static func pruneRuntimeDirectories(in baseDirectory: URL) {
        let fileManager = FileManager.default
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .contentModificationDateKey]
        guard let contents = try? fileManager.contentsOfDirectory(at: baseDirectory, includingPropertiesForKeys: Array(keys)) else { return }
        let cutoff = Date().addingTimeInterval(-6 * 60 * 60)
        let runtimeDirectories = contents.compactMap { url -> (url: URL, modified: Date)? in
            guard url.lastPathComponent != "assets",
                  let values = try? url.resourceValues(forKeys: keys),
                  values.isDirectory == true else {
                return nil
            }
            return (url, values.contentModificationDate ?? .distantPast)
        }
        let oldDirectories = runtimeDirectories.filter { $0.modified < cutoff }
        let overflowDirectories = runtimeDirectories
            .sorted { $0.modified > $1.modified }
            .dropFirst(24)
        var removed = Set<String>()
        for entry in oldDirectories + overflowDirectories where removed.insert(entry.url.path).inserted {
            try? fileManager.removeItem(at: entry.url)
        }
    }

    private static func resolveRenderer(for format: AppViewerStructureFormat, rendererMode: String) -> String {
        let isXYZ = format.molstarFormat == "xyz" && !format.isBinary
        switch AppViewerRendererMode.normalize(rendererMode) {
        case "molstar":
            return "molstar"
        case "xyz-fast":
            return isXYZ ? "xyz-fast" : "molstar"
        case "xyzrender-external":
            return isXYZ ? "xyzrender-external" : "molstar"
        default:
            return isXYZ ? "xyz-fast" : "molstar"
        }
    }

    private struct XYZFastPayload {
        let data: Data
        let atomCount: Int?
        let frameCount: Int?
        let comment: String?
    }

    private static func makeXYZFastPayload(from data: Data) -> XYZFastPayload? {
        let text = decodeText(data).replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var start = 0
        while start < lines.count && lines[start].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { start += 1 }
        guard start < lines.count else { return nil }
        let firstToken = lines[start].trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").first
        guard let token = firstToken, let atomCount = Int(token), atomCount > 0 else { return nil }
        let end = min(lines.count, start + atomCount + 2)
        guard end > start + 1 else { return nil }
        var firstFrame = lines[start..<end].joined(separator: "\n")
        if !firstFrame.hasSuffix("\n") { firstFrame += "\n" }
        let frameCount = countXYZFrames(lines: lines, start: start)
        let comment = start + 1 < lines.count ? lines[start + 1] : nil
        return XYZFastPayload(data: Data(firstFrame.utf8), atomCount: atomCount, frameCount: frameCount, comment: comment)
    }

    private static func countXYZFrames(lines: [String], start: Int) -> Int? {
        var index = start
        var frames = 0
        while index < lines.count && frames < 100_000 {
            while index < lines.count && lines[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { index += 1 }
            guard index < lines.count else { break }
            let firstToken = lines[index].trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").first
            guard let token = firstToken, let atomCount = Int(token), atomCount > 0 else { break }
            guard index + atomCount + 1 < lines.count else { break }
            frames += 1
            index += atomCount + 2
        }
        return frames > 0 ? frames : nil
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }

    private static func fileSize(for url: URL) throws -> Int64 {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func gridHTML(title: String, transparentBackground: Bool) -> String {
        let backgroundClass = transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Burrete Grid - \(escapeHTML(title))</title>
          <link rel="stylesheet" href="../assets/grid.css" />
          <script>
            (function () {
              function post(type, message, payload) {
                try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage(Object.assign({ type: type, message: String(message || '') }, payload || {})); } catch (_) {}
              }
              window.__mqlPost = post;
            })();
          </script>
        </head>
        <body class="\(backgroundClass)">
          <div id="app"></div>
          <div id="status">Loading molecule grid...</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteGridMode = true;
            window.BurreteDebug = false;
          </script>
          <script src="preview-config.js"></script>
          <script src="preview-grid-records.js"></script>
          <script src="../assets/rdkit/RDKit_minimal.js"></script>
          <script src="../assets/grid-viewer.js"></script>
        </body>
        </html>
        """
    }

    private static func html(title: String, transparentBackground: Bool, renderer: String) -> String {
        let backgroundClass = transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        let initialStatus: String
        let rendererAssets: String
        switch renderer {
        case "xyz-fast":
            initialStatus = "Loading Fast XYZ viewer..."
            rendererAssets = """
              <script src="../assets/xyz-fast.js"></script>
            """
        case "xyzrender-external":
            initialStatus = "Loading xyzrender artifact..."
            rendererAssets = ""
        default:
            initialStatus = "Loading Mol* viewer..."
            rendererAssets = """
              <script src="../assets/molstar.js"></script>
            """
        }
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Burrete - \(escapeHTML(title))</title>
          <link rel="stylesheet" href="../assets/molstar.css" />
          <style>
            :root {
              --buret-viewer-ui-scale: 0.86;
              --buret-toolbar-safe-top: 18px;
              --buret-overlay-opacity: 0.90;
              --buret-overlay-strong-opacity: 0.96;
              --buret-canvas-background: #000000;
              --buret-shell-background: #000000;
              --buret-panel-background: rgba(18, 20, 22, var(--buret-overlay-opacity));
              --buret-toolbar-background: rgba(12, 13, 14, var(--buret-overlay-opacity));
              --buret-toolbar-border: rgba(255, 255, 255, 0.10);
              --buret-toolbar-hover: rgba(255, 255, 255, 0.14);
              --buret-toolbar-color: rgba(255, 255, 255, 0.94);
              --buret-molstar-panel-background: rgba(14, 15, 17, var(--buret-overlay-strong-opacity));
              --buret-molstar-row-background: rgba(24, 26, 29, var(--buret-overlay-strong-opacity));
              --buret-molstar-field-background: rgba(32, 35, 39, var(--buret-overlay-strong-opacity));
              --buret-molstar-hover-background: rgba(48, 52, 58, 0.98);
              --buret-molstar-border: rgba(255, 255, 255, 0.10);
              --buret-molstar-text: rgba(246, 247, 249, 0.94);
              --buret-molstar-muted-text: rgba(190, 196, 204, 0.82);
              --buret-molstar-accent: #8fc7ff;
              --buret-molstar-shadow: rgba(0, 0, 0, 0.38);
              --buret-molstar-panel-radius: 10px;
            }
            html, body, #app { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
            html.buret-transparent-background,
            html.buret-transparent-background body,
            html.buret-transparent-background #app,
            html.buret-transparent-background .msp-plugin,
            html.buret-transparent-background .msp-viewport,
            html.buret-transparent-background .msp-layout-main,
            html.buret-transparent-background canvas { background: transparent !important; background-color: transparent !important; }
            body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; color: #f2f2f2; }
            body.buret-theme-light {
              --buret-shell-background: #ffffff;
              --buret-panel-background: rgba(248, 248, 248, var(--buret-overlay-opacity));
              --buret-toolbar-background: rgba(248, 248, 248, var(--buret-overlay-opacity));
              --buret-toolbar-border: rgba(0, 0, 0, 0.12);
              --buret-toolbar-hover: rgba(0, 0, 0, 0.08);
              --buret-toolbar-color: rgba(20, 21, 23, 0.92);
              --buret-molstar-panel-background: rgba(248, 248, 248, var(--buret-overlay-strong-opacity));
              --buret-molstar-row-background: rgba(238, 238, 238, var(--buret-overlay-strong-opacity));
              --buret-molstar-field-background: rgba(255, 255, 255, var(--buret-overlay-strong-opacity));
              --buret-molstar-hover-background: rgba(228, 228, 228, 0.98);
              --buret-molstar-border: rgba(0, 0, 0, 0.13);
              --buret-molstar-text: rgba(32, 33, 35, 0.94);
              --buret-molstar-muted-text: rgba(86, 88, 92, 0.82);
              --buret-molstar-accent: #006bd6;
              --buret-molstar-shadow: rgba(0, 0, 0, 0.18);
              color: #161719;
            }
            body.buret-theme-dark {
              --buret-shell-background: var(--buret-canvas-background);
              --buret-panel-background: rgba(18, 20, 22, var(--buret-overlay-opacity));
              --buret-toolbar-background: rgba(12, 13, 14, var(--buret-overlay-opacity));
              --buret-toolbar-border: rgba(255, 255, 255, 0.10);
              --buret-toolbar-hover: rgba(255, 255, 255, 0.14);
              --buret-toolbar-color: rgba(255, 255, 255, 0.94);
              --buret-molstar-panel-background: rgba(14, 15, 17, var(--buret-overlay-strong-opacity));
              --buret-molstar-row-background: rgba(24, 26, 29, var(--buret-overlay-strong-opacity));
              --buret-molstar-field-background: rgba(32, 35, 39, var(--buret-overlay-strong-opacity));
              --buret-molstar-hover-background: rgba(48, 52, 58, 0.98);
              --buret-molstar-border: rgba(255, 255, 255, 0.10);
              --buret-molstar-text: rgba(246, 247, 249, 0.94);
              --buret-molstar-muted-text: rgba(190, 196, 204, 0.82);
              --buret-molstar-accent: #8fc7ff;
              --buret-molstar-shadow: rgba(0, 0, 0, 0.38);
            }
            body.burette-opaque-background,
            body.burette-opaque-background #app {
              background: var(--buret-shell-background);
            }
            #app { position: absolute; inset: 0; }
            body.burette-transparent-background .msp-plugin,
            body.burette-transparent-background .msp-plugin .msp-viewport,
            body.burette-transparent-background .msp-plugin .msp-layout-viewport,
            body.burette-transparent-background .msp-plugin .msp-plugin-content {
              background: transparent !important;
            }
            body.burette-transparent-background .msp-plugin canvas {
              background: transparent !important;
            }
            body.burette-opaque-background .msp-plugin,
            body.burette-opaque-background .msp-plugin .msp-viewport,
            body.burette-opaque-background .msp-plugin .msp-layout-viewport,
            body.burette-opaque-background .msp-plugin .msp-plugin-content,
            body.burette-opaque-background .msp-plugin canvas {
              background: var(--buret-canvas-background) !important;
            }
            body .msp-plugin .msp-layout-left,
            body .msp-plugin .msp-layout-right,
            body .msp-plugin .msp-layout-top,
            body .msp-plugin .msp-layout-bottom {
              background: var(--buret-panel-background) !important;
              -webkit-backdrop-filter: blur(14px);
              backdrop-filter: blur(14px);
            }
            body .msp-plugin,
            body .msp-plugin .msp-plugin-content {
              color: var(--buret-molstar-text) !important;
              background: transparent !important;
            }
            body .msp-plugin .msp-layout-standard,
            body .msp-plugin .msp-layout-top,
            body .msp-plugin .msp-layout-bottom,
            body .msp-plugin .msp-layout-left,
            body .msp-plugin .msp-layout-right,
            body .msp-plugin .msp-sequence-select,
            body .msp-plugin .msp-control-row,
            body .msp-plugin .msp-log li,
            body .msp-plugin .msp-toast-container .msp-toast-entry,
            body .msp-plugin .msp-markdown table,
            body .msp-plugin .msp-markdown th,
            body .msp-plugin .msp-markdown td {
              border-color: var(--buret-molstar-border) !important;
            }
            body .msp-plugin .msp-viewport-controls-panel,
            body .msp-plugin .msp-hover-box-body,
            body .msp-plugin .msp-action-menu-options,
            body .msp-plugin .msp-action-menu-options-no-header,
            body .msp-plugin .msp-animation-viewport-controls-select,
            body .msp-plugin .msp-selection-viewport-controls-actions,
            body .msp-plugin .msp-snapshot-description-wrapper,
            body .msp-plugin .msp-toast-container .msp-toast-entry,
            body .msp-plugin .msp-no-webgl,
            body .msp-plugin .msp-log,
            body .msp-plugin .msp-sequence {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-panel-background) !important;
              max-height: calc(100vh - 76px) !important;
              box-shadow: 0 14px 34px var(--buret-molstar-shadow);
            }
            body .msp-plugin .msp-hover-box-wrapper .msp-hover-box-body,
            body .msp-plugin .msp-action-menu-options,
            body .msp-plugin .msp-action-menu-options-no-header,
            body .msp-plugin .msp-animation-viewport-controls-select,
            body .msp-plugin .msp-selection-viewport-controls-actions,
            body .msp-plugin .msp-panel-description-content,
            body .msp-plugin .msp-simple-help-section,
            body .msp-plugin .msp-help-text,
            body .msp-plugin .msp-no-webgl,
            body .msp-plugin .msp-log,
            body .msp-plugin .msp-toast-container .msp-toast-entry {
              overflow: hidden;
              border: 1px solid var(--buret-molstar-border) !important;
              border-radius: var(--buret-molstar-panel-radius);
              background: var(--buret-molstar-panel-background) !important;
              box-shadow: 0 12px 28px var(--buret-molstar-shadow);
              -webkit-backdrop-filter: blur(12px);
              backdrop-filter: blur(12px);
            }
            body .msp-plugin .msp-action-menu-options .msp-control-group-children,
            body .msp-plugin .msp-viewport-controls-panel .msp-viewport-controls-panel-controls {
              overflow: visible;
              border-radius: inherit;
            }
            body .msp-plugin .msp-sequence-select {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-row-background) !important;
              border-bottom: 1px solid var(--buret-molstar-border);
              box-shadow: none;
            }
            body .msp-plugin .msp-sequence-select > span,
            body .msp-plugin .msp-sequence-select > select {
              color: var(--buret-molstar-text) !important;
              background-color: var(--buret-molstar-field-background) !important;
              border-right: 1px solid var(--buret-molstar-border);
            }
            body .msp-plugin .msp-control-row,
            body .msp-plugin .msp-control-current,
            body .msp-plugin .msp-control-group-header,
            body .msp-plugin .msp-control-group-header > button,
            body .msp-plugin .msp-control-group-header div,
            body .msp-plugin .msp-control-group-header > span,
            body .msp-plugin .msp-flex-row,
            body .msp-plugin .msp-state-image-row,
            body .msp-plugin .msp-row-text,
            body .msp-plugin .msp-section-header,
            body .msp-plugin .msp-current-header,
            body .msp-plugin .msp-description,
            body .msp-plugin .msp-help-text,
            body .msp-plugin .msp-help-row,
            body .msp-plugin .msp-image-preview,
            body .msp-plugin .msp-simple-help-section,
            body .msp-plugin .msp-left-panel-controls-buttons,
            body .msp-plugin .msp-overlay-tasks .msp-task-state > div,
            body .msp-plugin .msp-background-tasks .msp-task-state > div,
            body .msp-plugin .msp-log li {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin .msp-control-row > div,
            body .msp-plugin .msp-control-row > div.msp-control-row-text,
            body .msp-plugin .msp-help-row > div,
            body .msp-plugin .msp-sequence-wrapper-non-empty,
            body .msp-plugin .msp-sequence-wrapper,
            body .msp-plugin .msp-log .msp-log-entry,
            body .msp-plugin .msp-copy-image-wrapper div,
            body .msp-plugin .msp-overlay-tasks .msp-task-state > div > div,
            body .msp-plugin .msp-background-tasks .msp-task-state > div > div {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-field-background) !important;
            }
            body .msp-plugin .msp-sequence-wrapper-non-empty {
              border-top: 1px solid var(--buret-molstar-border);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
            }
            body .msp-plugin .msp-form-control,
            body .msp-plugin .msp-control-row select,
            body .msp-plugin .msp-control-row button,
            body .msp-plugin .msp-control-row input[type=text],
            body .msp-plugin textarea,
            body .msp-plugin .msp-btn {
              color: var(--buret-molstar-text) !important;
              background-color: var(--buret-molstar-field-background) !important;
            }
            body .msp-plugin .msp-form-control:hover,
            body .msp-plugin .msp-control-row select:hover,
            body .msp-plugin .msp-control-row button:hover,
            body .msp-plugin .msp-control-row input[type=text]:hover,
            body .msp-plugin .msp-btn:hover,
            body .msp-plugin .msp-btn-icon:hover,
            body .msp-plugin .msp-btn-icon-small:hover {
              color: var(--buret-molstar-accent) !important;
              background-color: var(--buret-molstar-hover-background) !important;
              outline: 1px solid var(--buret-molstar-border) !important;
            }
            body .msp-plugin .msp-btn-link,
            body .msp-plugin .msp-btn-link:active,
            body .msp-plugin .msp-btn-link:focus,
            body .msp-plugin .msp-btn-link-toggle-on,
            body .msp-plugin .msp-sequence-wrapper .msp-sequence-present,
            body .msp-plugin .msp-svg-text {
              color: var(--buret-molstar-text) !important;
              fill: var(--buret-molstar-text) !important;
            }
            body .msp-plugin .msp-btn-link:hover,
            body .msp-plugin .msp-highlight-info,
            body .msp-plugin .msp-highlight-info-additional,
            body .msp-plugin .msp-sequence-chain-label,
            body .msp-plugin .msp-sequence-wrapper .msp-sequence-label,
            body .msp-plugin .msp-sequence-wrapper .msp-sequence-number {
              color: var(--buret-molstar-accent) !important;
            }
            body .msp-plugin .msp-control-row > span.msp-control-row-label,
            body .msp-plugin .msp-control-row > button.msp-control-button-label,
            body .msp-plugin .msp-control-group-header > button,
            body .msp-plugin .msp-control-group-header div,
            body .msp-plugin .msp-control-group-header > span,
            body .msp-plugin .msp-log .msp-log-timestamp,
            body .msp-plugin .msp-help-row > span,
            body .msp-plugin .msp-row-text > div,
            body .msp-plugin .msp-25-lower-contrast-text,
            body .msp-plugin .msp-sequence-wrapper .msp-sequence-missing {
              color: var(--buret-molstar-muted-text) !important;
            }
            body .msp-plugin .msp-viewport-controls-panel {
              overflow: auto;
              border: 1px solid var(--buret-molstar-border) !important;
              border-radius: var(--buret-molstar-panel-radius);
              background: var(--buret-molstar-panel-background) !important;
              box-shadow: 0 12px 28px var(--buret-molstar-shadow);
              -webkit-backdrop-filter: blur(12px);
              backdrop-filter: blur(12px);
            }
            body .msp-plugin .msp-viewport-controls-panel .msp-control-group-wrapper {
              background: transparent !important;
            }
            body .msp-plugin .msp-viewport-controls-panel .msp-control-group-header,
            body .msp-plugin .msp-viewport-controls-panel .msp-control-group-header > button {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin .msp-viewport-controls-panel .msp-control-group-header > button {
              border-bottom: 1px solid var(--buret-molstar-border) !important;
              font-weight: 700;
            }
            body .msp-plugin .msp-viewport-controls-panel .msp-control-row {
              border-top: 1px solid var(--buret-molstar-border) !important;
              background: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin .msp-viewport-controls-panel .msp-control-row > div,
            body .msp-plugin .msp-viewport-controls-panel .msp-control-row > div.msp-control-row-text,
            body .msp-plugin .msp-viewport-controls-panel .msp-control-current {
              background: var(--buret-molstar-field-background) !important;
            }
            body .msp-plugin .msp-selection-viewport-controls > .msp-flex-row {
              overflow: hidden;
              border: 1px solid var(--buret-molstar-border) !important;
              border-radius: 10px;
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-panel-background) !important;
              box-shadow: 0 12px 28px var(--buret-molstar-shadow);
            }
            body .msp-plugin .msp-selection-viewport-controls > .msp-flex-row > * {
              border-left: 1px solid var(--buret-molstar-border) !important;
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin .msp-selection-viewport-controls > .msp-flex-row > *:first-child {
              border-left: 0 !important;
            }
            body .msp-plugin .msp-selection-viewport-controls button,
            body .msp-plugin .msp-selection-viewport-controls .msp-btn {
              color: var(--buret-molstar-text) !important;
              background: transparent !important;
            }
            body .msp-plugin .msp-selection-viewport-controls button:hover,
            body .msp-plugin .msp-selection-viewport-controls .msp-btn:hover,
            body .msp-plugin .msp-selection-viewport-controls .msp-btn-link-toggle-on {
              color: var(--buret-molstar-accent) !important;
              background: var(--buret-molstar-hover-background) !important;
              outline: 0 !important;
            }
            body .msp-plugin .msp-semi-transparent-background {
              background: var(--buret-molstar-panel-background) !important;
              opacity: 0.76 !important;
            }
            body .msp-plugin .msp-snapshot-description-wrapper,
            body .msp-plugin .msp-highlight-info {
              color: var(--buret-molstar-text) !important;
              background: var(--buret-molstar-panel-background) !important;
              border: 1px solid var(--buret-molstar-border);
              border-radius: 10px;
              opacity: 1 !important;
              -webkit-backdrop-filter: blur(12px);
              backdrop-filter: blur(12px);
            }
            body .msp-plugin .msp-snapshot-description-wrapper *,
            body .msp-plugin .msp-highlight-info * {
              background: transparent !important;
              color: inherit !important;
            }
            body .msp-plugin .msp-snapshot-description-wrapper a,
            body .msp-plugin .msp-highlight-info-additional {
              color: var(--buret-molstar-accent) !important;
            }
            body .msp-plugin .msp-viewport-controls {
              top: 64px !important;
              z-index: 40;
            }
            body .msp-plugin .msp-viewport-controls-buttons > div {
              overflow: hidden;
              border: 1px solid var(--buret-molstar-border);
              border-radius: 8px;
              background: var(--buret-molstar-row-background) !important;
              box-shadow: 0 8px 20px var(--buret-molstar-shadow);
            }
            body .msp-plugin .msp-viewport-controls-buttons button {
              color: var(--buret-molstar-text) !important;
              background: transparent !important;
            }
            body .msp-plugin .msp-viewport-controls-buttons button[disabled] {
              color: var(--buret-molstar-muted-text) !important;
              opacity: 0.55;
            }
            body .msp-plugin .msp-shape-filled,
            body .msp-plugin .msp-transform-header-brand svg {
              fill: var(--buret-molstar-text) !important;
              stroke: var(--buret-molstar-text) !important;
            }
            body .msp-plugin .msp-shape-empty {
              stroke: var(--buret-molstar-text) !important;
            }
            body .msp-plugin .msp-slider-base-rail {
              background-color: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin .msp-slider-base-handle {
              background-color: var(--buret-molstar-text) !important;
              border-color: var(--buret-molstar-row-background) !important;
            }
            body .msp-plugin ::-webkit-scrollbar-track {
              background-color: var(--buret-molstar-panel-background) !important;
            }
            body .msp-plugin ::-webkit-scrollbar-thumb {
              background-color: var(--buret-molstar-hover-background) !important;
              border-color: transparent !important;
            }
            #status {
              position: absolute; left: 12px; top: 12px; z-index: 2147483647;
              max-width: min(880px, calc(100vw - 32px)); box-sizing: border-box;
              padding: 10px 12px; border-radius: 10px; color: rgba(255, 255, 255, 0.96);
              background: rgba(0, 0, 0, 0.76); font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              white-space: pre-wrap; pointer-events: auto;
            }
            #status.error { color: #ffd4d4; background: rgba(70, 0, 0, 0.82); }
            #status.hidden { display: none; }
            #buret-toolbar {
              position: absolute; top: var(--buret-toolbar-safe-top); right: 12px; left: auto; z-index: 2147483646;
              display: flex; align-items: center; gap: 6px; padding: 6px;
              border: 1px solid var(--buret-toolbar-border);
              border-radius: 12px; color: var(--buret-toolbar-color);
              background: var(--buret-toolbar-background);
              -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
              box-shadow:
                0 8px 22px rgba(0, 0, 0, 0.22),
                inset 0 1px 0 rgba(255, 255, 255, 0.06);
              user-select: none; touch-action: none;
            }
            #buret-toolbar.collapsed { gap: 0; }
            #buret-toolbar.collapsed .buret-button:not(.buret-grip),
            #buret-toolbar.collapsed .buret-renderer-control { display: none; }
            #buret-toolbar.collapsed .buret-grip { min-width: 26px; padding: 0; cursor: pointer; }
            .buret-button {
              min-width: 26px; height: 26px; border: 0; border-radius: 7px; padding: 0 7px;
              color: inherit; background: transparent; font: 600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
              display: grid; place-items: center;
            }
            .buret-button:hover, .buret-button.active { background: var(--buret-toolbar-hover); }
            .buret-button.hidden { display: none; }
            .buret-button svg { width: 15px; height: 15px; display: block; }
            .buret-grip { cursor: grab; color: currentColor; opacity: 0.66; }
            .buret-renderer-control {
              display: none; align-items: center; gap: 4px; padding-left: 5px;
              border-left: 1px solid var(--buret-toolbar-border);
            }
            .buret-renderer-control.visible { display: flex; }
            .buret-select {
              height: 26px; max-width: 118px; border: 0; border-radius: 7px; padding: 0 22px 0 8px;
              color: inherit; background: transparent; font: 600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
            }
            .buret-select:hover, .buret-select:focus { background: var(--buret-toolbar-hover); outline: none; }
          </style>
          <script>
            (function () {
              function post(type, message) {
                try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage({ type: type, message: String(message || '') }); } catch (_) {}
              }
              window.__mqlPost = post;
              window.__mqlStatus = function (message, kind) {
                var text = String(message || '');
                var el = document.getElementById('status');
                if (el) {
                  el.textContent = text;
                  if (kind === 'error') el.classList.add('error'); else el.classList.remove('error');
                  if (kind === 'error') el.classList.remove('hidden'); else el.classList.add('hidden');
                }
                post(kind === 'error' ? 'error' : 'status', text);
              };
              window.__mqlAction = function (name) { post('action', name); };
              window.__mqlDebug = function (_) {};
            })();
          </script>
        </head>
        <body class="\(backgroundClass)">
          <div id="app"></div>
          <div id="buret-toolbar" role="toolbar" aria-label="Burrete viewer controls">
            <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button buret-panel-toggle active" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel">Log</button>
            <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch to light theme" title="Switch to light theme">Light</button>
            <div class="buret-renderer-control" data-buret-renderer-control>
              <button class="buret-button" type="button" data-buret-renderer="xyz-fast" aria-label="Use Fast XYZ SVG" title="Use Fast XYZ SVG">Fast</button>
              <button class="buret-button" type="button" data-buret-renderer="molstar" aria-label="Use Mol* Interactive" title="Use Mol* Interactive">Mol*</button>
              <button class="buret-button" type="button" data-buret-renderer="xyzrender-external" aria-label="Use external xyzrender" title="Use external xyzrender">xyzr</button>
              <select class="buret-select" data-buret-xyzrender-preset aria-label="External xyzrender preset" title="External xyzrender preset"></select>
            </div>
          </div>
          <div id="status" class="hidden">\(initialStatus)</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteDebug = false;
            window.BurretePanelControlsVisible = false;
            window.BurreteCacheBuster = String(Date.now());
          </script>
          \(rendererAssets)
          <script src="preview-config.js"></script>
          <script src="preview-data.js"></script>
          <script src="../assets/burette-agent.js"></script>
          <script src="../assets/viewer.js"></script>
        </body>
        </html>
        """
    }
}

private struct ExternalXyzrenderArtifact {
    let relativePath: String
    let outputType: String
    let preset: String
    let configArgument: String
    let elapsedMs: Int
    let log: String
}

private enum ExternalXyzrenderWorker {
    static func render(inputURL: URL, outputDirectory: URL, preset: String, customConfigPath: String, transparent: Bool, extraArguments: String) throws -> ExternalXyzrenderArtifact {
        let fileManager = FileManager.default
        let outputURL = outputDirectory.appendingPathComponent("xyzrender.svg")
        let logURL = outputDirectory.appendingPathComponent("xyzrender.log")
        try? fileManager.removeItem(at: outputURL)
        try? fileManager.removeItem(at: logURL)

        let process = Process()
        let configuredExecutable = UserDefaults.standard.string(forKey: "xyzrenderExecutablePath")?.trimmingCharacters(in: .whitespacesAndNewlines)
        var arguments: [String]
        if let configuredExecutable, !configuredExecutable.isEmpty {
            process.executableURL = URL(fileURLWithPath: configuredExecutable)
            arguments = [inputURL.path, "-o", outputURL.path]
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            arguments = ["xyzrender", inputURL.path, "-o", outputURL.path]
        }
        let safePreset = AppViewerXyzrenderPreset.normalize(preset)
        let configArgument = resolveConfigArgument(preset: safePreset, customConfigPath: customConfigPath)
        let effectivePreset = safePreset == "custom" && configArgument == "default" ? "default" : safePreset
        arguments += ["--config", configArgument]
        if transparent { arguments.append("--transparent") }
        arguments += sanitizedExtraArguments(extraArguments)
        process.arguments = arguments
        process.environment = mergedEnvironment()

        _ = fileManager.createFile(atPath: logURL.path, contents: nil)
        let logHandle = try FileHandle(forWritingTo: logURL)
        defer { logHandle.closeFile() }
        process.standardOutput = logHandle
        process.standardError = logHandle
        let semaphore = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in semaphore.signal() }
        let started = Date()
        try process.run()

        if semaphore.wait(timeout: .now() + 25) == .timedOut {
            process.terminate()
            throw ExternalXyzrenderError.timedOut
        }

        logHandle.synchronizeFile()
        let logData = (try? Data(contentsOf: logURL)) ?? Data()
        let log = String(data: logData, encoding: .utf8) ?? String(decoding: logData, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw ExternalXyzrenderError.failed(status: process.terminationStatus, log: log)
        }
        guard fileManager.fileExists(atPath: outputURL.path) else {
            throw ExternalXyzrenderError.missingOutput
        }
        let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
        return ExternalXyzrenderArtifact(relativePath: "xyzrender.svg", outputType: "svg", preset: effectivePreset, configArgument: configArgument, elapsedMs: elapsedMs, log: log)
    }

    private static func resolveConfigArgument(preset: String, customConfigPath: String) -> String {
        guard preset == "custom" else { return preset }
        let trimmed = customConfigPath.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "default" : trimmed
    }

    private static func sanitizedExtraArguments(_ value: String) -> [String] {
        let outputFlags = Set(["-o", "--output", "-go", "--gif-output", "--config"])
        var result: [String] = []
        var skipNext = false
        for token in splitCommandLine(value) {
            if skipNext {
                skipNext = false
                continue
            }
            if outputFlags.contains(token) {
                skipNext = true
                continue
            }
            if outputFlags.contains(where: { token.hasPrefix($0 + "=") }) { continue }
            result.append(token)
        }
        return result
    }

    private static func splitCommandLine(_ value: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var quote: Character?
        var escaped = false
        for character in value {
            if escaped {
                current.append(character)
                escaped = false
                continue
            }
            if character == "\\" {
                escaped = true
                continue
            }
            if let activeQuote = quote {
                if character == activeQuote {
                    quote = nil
                } else {
                    current.append(character)
                }
                continue
            }
            if character == "\"" || character == "'" {
                quote = character
                continue
            }
            if character.isWhitespace {
                if !current.isEmpty {
                    tokens.append(current)
                    current.removeAll(keepingCapacity: true)
                }
            } else {
                current.append(character)
            }
        }
        if escaped { current.append("\\") }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    private static func mergedEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let defaultPath = "/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        if let path = environment["PATH"], !path.isEmpty {
            environment["PATH"] = defaultPath + ":" + path
        } else {
            environment["PATH"] = defaultPath
        }
        return environment
    }
}

private enum ExternalXyzrenderError: LocalizedError {
    case timedOut
    case missingOutput
    case failed(status: Int32, log: String)

    var errorDescription: String? {
        switch self {
        case .timedOut:
            return "External xyzrender timed out after 25 seconds."
        case .missingOutput:
            return "External xyzrender finished but did not produce an SVG output file."
        case .failed(let status, let log):
            let trimmed = log.trimmingCharacters(in: .whitespacesAndNewlines)
            return "External xyzrender failed with exit status \(status)." + (trimmed.isEmpty ? "" : " \(trimmed.prefix(320))")
        }
    }
}

private struct AppViewerStructureFormat {
    let molstarFormat: String
    let isBinary: Bool
    var prefersTransparentBackground: Bool { molstarFormat == "sdf" }

    init(url: URL, data: Data) {
        let ext = url.pathExtension.lowercased()
        switch ext {
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
        case "smi", "smiles":
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
        let text = String(decoding: data.prefix(262_144), as: UTF8.self).lowercased()
        if text.contains("_atom_site.cartn_x") ||
            text.contains("_atom_site.label_atom_id") ||
            text.contains("_atom_site.auth_atom_id") ||
            text.contains("_entity_poly") ||
            text.contains("_entity_poly_seq") ||
            text.contains("_struct_asym") ||
            text.contains("_chem_comp.") ||
            text.contains("_ma_") ||
            text.contains("mmcif_ma.dic") ||
            text.contains("modelcif") ||
            text.contains("_pdbx_") {
            return "mmcif"
        }
        return "cifCore"
    }
}

private enum AppViewerError: LocalizedError {
    case missingWebResources
    case emptyFile(String)
    case unsupportedFile(String)
    case gridFileTypeDisabled(String)
    case fileTooLarge(String, Int64, Int64)
    case missingCacheDirectory

    var errorDescription: String? {
        switch self {
        case .missingWebResources:
            return "Bundled Mol* web resources are missing from Burrete.app."
        case .emptyFile(let name):
            return "The structure file is empty: \(name)"
        case .unsupportedFile(let name):
            return "Unsupported molecule grid file: \(name)"
        case .gridFileTypeDisabled(let ext):
            return ".\(ext) molecule grid previews are disabled in Burrete Settings."
        case .fileTooLarge(let name, let size, let limit):
            return "\(name) is too large for the Burrete app viewer (\(size) bytes; limit \(limit) bytes). Open it in a dedicated molecular viewer."
        case .missingCacheDirectory:
            return "Could not locate the app cache directory."
        }
    }
}

private final class BurreteAppViewerContainerView: NSView {
    private let materialView = NSVisualEffectView()
    private let backgroundFillView = NSView()

    init(contentView: NSView, preferences: AppViewerDisplayPreferences) {
        super.init(frame: .zero)
        wantsLayer = true

        materialView.translatesAutoresizingMaskIntoConstraints = false
        materialView.blendingMode = .behindWindow
        materialView.state = .active
        materialView.material = .underWindowBackground
        addSubview(materialView)

        backgroundFillView.translatesAutoresizingMaskIntoConstraints = false
        backgroundFillView.wantsLayer = true
        addSubview(backgroundFillView)

        contentView.wantsLayer = true
        contentView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(contentView)
        NSLayoutConstraint.activate([
            materialView.leadingAnchor.constraint(equalTo: leadingAnchor),
            materialView.trailingAnchor.constraint(equalTo: trailingAnchor),
            materialView.topAnchor.constraint(equalTo: topAnchor),
            materialView.bottomAnchor.constraint(equalTo: bottomAnchor),
            backgroundFillView.leadingAnchor.constraint(equalTo: leadingAnchor),
            backgroundFillView.trailingAnchor.constraint(equalTo: trailingAnchor),
            backgroundFillView.topAnchor.constraint(equalTo: topAnchor),
            backgroundFillView.bottomAnchor.constraint(equalTo: bottomAnchor),
            contentView.leadingAnchor.constraint(equalTo: leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: trailingAnchor),
            contentView.topAnchor.constraint(equalTo: topAnchor),
            contentView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        apply(preferences)
    }

    override var mouseDownCanMoveWindow: Bool {
        true
    }

    func apply(_ preferences: AppViewerDisplayPreferences) {
        materialView.isHidden = !preferences.isWindowTransparent
        let fillColor = preferences.baseColor.withAlphaComponent(preferences.isWindowTransparent ? preferences.clampedWindowOpacity : 1.0)
        layer?.backgroundColor = fillColor.cgColor
        backgroundFillView.layer?.backgroundColor = fillColor.cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private func escapeHTML(_ value: String) -> String {
    value
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&#39;")
}
