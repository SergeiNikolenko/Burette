import AppKit
import WebKit

final class MoleculeViewerWindowController: NSWindowController, WKNavigationDelegate, WKScriptMessageHandler {
    private let fileURL: URL
    private let webView: WKWebView
    private var currentViewerPageZoom: CGFloat = 0.86
    private static let defaultViewerPageZoom: CGFloat = 0.86
    private static let minViewerPageZoom: CGFloat = 0.72
    private static let maxViewerPageZoom: CGFloat = 1.35

    init(fileURL: URL) {
        self.fileURL = fileURL
        let transparentBackground = Self.useTransparentPreviewBackground

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
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullScreen],
            backing: .buffered,
            defer: false
        )
        window.title = "Burrete - \(fileURL.lastPathComponent)"
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = false
        window.isMovableByWindowBackground = true
        window.styleMask.remove(.fullSizeContentView)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.minSize = NSSize(width: 660, height: 440)
        window.appearance = NSAppearance(named: .darkAqua)
        if #available(macOS 11.0, *) {
            window.toolbarStyle = .unifiedCompact
        }
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.contentView = BurreteAppViewerContainerView(contentView: webView, transparentBackground: transparentBackground)

        super.init(window: window)

        userContentController.add(self, name: "burrete")
        webView.navigationDelegate = self
        webView.wantsLayer = true
        webView.layer?.backgroundColor = (transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)).cgColor
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 11.0, *) {
            webView.underPageBackgroundColor = transparentBackground ? .clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)
        }
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
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "burrete")
    }

    func load() {
        do {
            let runtime = try AppViewerRuntime.create(for: fileURL)
            webView.loadFileURL(runtime.indexURL, allowingReadAccessTo: runtime.readAccessURL)
        } catch {
            webView.loadHTMLString(Self.errorHTML(error), baseURL: nil)
        }
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
        let text = (body["message"] as? String) ?? ""
        NSLog("[BurreteAppViewer] %@: %@ %@", fileURL.lastPathComponent, type, text)
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

    private static func errorHTML(_ error: Error) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:100%;height:100%;background:#111317;color:#f2f2f2}
        body{box-sizing:border-box;padding:24px;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
        h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;background:#24262a;padding:12px;border-radius:8px}
        </style></head><body><h1>Burrete could not open this file</h1><pre>\(escapeHTML(String(describing: error)))</pre></body></html>
        """
    }

    private static var useTransparentPreviewBackground: Bool {
        UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? false
    }
}

private struct AppViewerRuntime {
    let indexURL: URL
    let readAccessURL: URL
    private static let maxStructureFileSize: Int64 = 75 * 1024 * 1024

    static func create(for fileURL: URL) throws -> AppViewerRuntime {
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

        let format = AppViewerStructureFormat(url: fileURL, data: data)
        let transparentBackground = UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? false
        let viewerTheme = UserDefaults.standard.string(forKey: "viewerTheme") ?? "dark"
        let canvasBackground = UserDefaults.standard.string(forKey: "viewerCanvasBackground") ?? "black"
        let canvasIsTransparent = canvasBackground == "transparent"
        let config: [String: Any] = [
            "format": format.molstarFormat,
            "binary": format.isBinary,
            "label": fileURL.lastPathComponent,
            "byteCount": data.count,
            "quickLookBuild": "burrete-app",
            "debug": false,
            "theme": viewerTheme,
            "canvasBackground": canvasBackground,
            "uiScale": 0.86,
            "transparentBackground": canvasIsTransparent,
            "sdfGrid": true,
            "showPanelControls": UserDefaults.standard.object(forKey: "showPreviewPanelControls") as? Bool ?? true,
            "defaultLayoutState": [
                "left": "collapsed",
                "right": "hidden",
                "top": "hidden",
                "bottom": "hidden"
            ]
        ]
        let configData = try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys, .withoutEscapingSlashes])
        let configJSON = String(data: configData, encoding: .utf8) ?? "{}"

        try Data(html(title: fileURL.lastPathComponent, transparentBackground: transparentBackground).utf8)
            .write(to: runtimeDirectory.appendingPathComponent("index.html"), options: [.atomic])
        try Data("window.BurreteConfig = \(configJSON);\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        try Data("window.BurreteDataBase64 = \"\(data.base64EncodedString())\";\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])

        return AppViewerRuntime(
            indexURL: runtimeDirectory.appendingPathComponent("index.html"),
            readAccessURL: baseDirectory
        )
    }

    private static func copyAssets(from sourceDirectory: URL, to assetsDirectory: URL) throws {
        for name in ["molstar.js", "molstar.css", "burette-agent.js", "viewer.js"] {
            let source = sourceDirectory.appendingPathComponent(name)
            let destination = assetsDirectory.appendingPathComponent(name)
            try copyAssetAtomically(from: source, to: destination)
        }
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

    private static func fileSize(for url: URL) throws -> Int64 {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func html(title: String, transparentBackground: Bool) -> String {
        let backgroundClass = transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
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
              --buret-canvas-background: #000000;
              --buret-shell-background: #000000;
              --buret-panel-background: rgba(18, 20, 22, 0.82);
              --buret-toolbar-background: rgba(12, 13, 14, 0.90);
              --buret-toolbar-border: rgba(255, 255, 255, 0.10);
              --buret-toolbar-hover: rgba(255, 255, 255, 0.14);
              --buret-toolbar-color: rgba(255, 255, 255, 0.94);
              --buret-molstar-panel-background: rgba(14, 15, 17, 0.94);
              --buret-molstar-row-background: rgba(24, 26, 29, 0.96);
              --buret-molstar-field-background: rgba(32, 35, 39, 0.98);
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
              --buret-shell-background: #f7f7f2;
              --buret-panel-background: rgba(247, 247, 242, 0.86);
              --buret-toolbar-background: rgba(247, 247, 242, 0.90);
              --buret-toolbar-border: rgba(0, 0, 0, 0.12);
              --buret-toolbar-hover: rgba(0, 0, 0, 0.08);
              --buret-toolbar-color: rgba(20, 21, 23, 0.92);
              --buret-molstar-panel-background: rgba(239, 239, 235, 0.94);
              --buret-molstar-row-background: rgba(229, 228, 222, 0.96);
              --buret-molstar-field-background: rgba(248, 247, 244, 0.98);
              --buret-molstar-hover-background: rgba(218, 216, 209, 0.98);
              --buret-molstar-border: rgba(0, 0, 0, 0.13);
              --buret-molstar-text: rgba(32, 33, 35, 0.94);
              --buret-molstar-muted-text: rgba(84, 78, 68, 0.82);
              --buret-molstar-accent: #8a4b10;
              --buret-molstar-shadow: rgba(0, 0, 0, 0.18);
              color: #161719;
            }
            body.buret-theme-dark {
              --buret-shell-background: var(--buret-canvas-background);
              --buret-panel-background: rgba(18, 20, 22, 0.82);
              --buret-toolbar-background: rgba(12, 13, 14, 0.90);
              --buret-toolbar-border: rgba(255, 255, 255, 0.10);
              --buret-toolbar-hover: rgba(255, 255, 255, 0.14);
              --buret-toolbar-color: rgba(255, 255, 255, 0.94);
              --buret-molstar-panel-background: rgba(14, 15, 17, 0.94);
              --buret-molstar-row-background: rgba(24, 26, 29, 0.96);
              --buret-molstar-field-background: rgba(32, 35, 39, 0.98);
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
              background: var(--buret-molstar-panel-background) !important;
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
              overflow: hidden;
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
            #buret-toolbar.collapsed .buret-button:not(.buret-grip) { display: none; }
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
          </div>
          <div id="status" class="hidden">Loading Burrete viewer...</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteDebug = false;
            window.BurretePanelControlsVisible = false;
            window.BurreteCacheBuster = String(Date.now());
          </script>
          <script src="../assets/molstar.js"></script>
          <script src="preview-config.js"></script>
          <script src="preview-data.js"></script>
          <script src="../assets/burette-agent.js"></script>
          <script src="../assets/viewer.js"></script>
        </body>
        </html>
        """
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
    case fileTooLarge(String, Int64, Int64)
    case missingCacheDirectory

    var errorDescription: String? {
        switch self {
        case .missingWebResources:
            return "Bundled Mol* web resources are missing from Burrete.app."
        case .emptyFile(let name):
            return "The structure file is empty: \(name)"
        case .fileTooLarge(let name, let size, let limit):
            return "\(name) is too large for the Burrete app viewer (\(size) bytes; limit \(limit) bytes). Open it in a dedicated molecular viewer."
        case .missingCacheDirectory:
            return "Could not locate the app cache directory."
        }
    }
}

private final class BurreteAppViewerContainerView: NSView {
    private static let contentInset: CGFloat = 7
    private static let cornerRadius: CGFloat = 14

    init(contentView: NSView, transparentBackground: Bool) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.10).cgColor
        layer?.backgroundColor = (transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)).cgColor
        layer?.cornerRadius = Self.cornerRadius
        if #available(macOS 10.15, *) {
            layer?.cornerCurve = .continuous
        }
        layer?.masksToBounds = true

        contentView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(contentView)
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = Self.cornerRadius - Self.contentInset
        if #available(macOS 10.15, *) {
            contentView.layer?.cornerCurve = .continuous
        }
        contentView.layer?.masksToBounds = true
        NSLayoutConstraint.activate([
            contentView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.contentInset),
            contentView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.contentInset),
            contentView.topAnchor.constraint(equalTo: topAnchor, constant: Self.contentInset),
            contentView.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.contentInset)
        ])
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
