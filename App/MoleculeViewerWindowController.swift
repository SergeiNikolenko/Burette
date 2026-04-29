import AppKit
import WebKit

final class MoleculeViewerWindowController: NSWindowController, WKNavigationDelegate, WKScriptMessageHandler {
    private let fileURL: URL
    private let webView: WKWebView
    private var restoredWindowFrame: NSRect?

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
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Burrete - \(fileURL.lastPathComponent)"
        window.minSize = NSSize(width: 660, height: 440)
        window.isOpaque = !transparentBackground
        window.backgroundColor = transparentBackground ? .clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)
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
        if type == "action", (body["message"] as? String) == "fit" {
            toggleFitToScreen()
            return
        }
        let text = (body["message"] as? String) ?? ""
        NSLog("[BurreteAppViewer] %@: %@ %@", fileURL.lastPathComponent, type, text)
    }

    private func toggleFitToScreen() {
        guard let window, let screen = window.screen ?? NSScreen.main else { return }
        if window.styleMask.contains(.fullScreen) {
            window.toggleFullScreen(nil)
            return
        }
        if let frame = restoredWindowFrame {
            window.setFrame(frame, display: true, animate: false)
            restoredWindowFrame = nil
        } else {
            restoredWindowFrame = window.frame
            window.setFrame(screen.visibleFrame.insetBy(dx: 8, dy: 8), display: true, animate: false)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
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
        UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? true
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
        let transparentBackground = UserDefaults.standard.object(forKey: "useTransparentPreviewBackground") as? Bool ?? true
        let config: [String: Any] = [
            "format": format.molstarFormat,
            "binary": format.isBinary,
            "label": fileURL.lastPathComponent,
            "byteCount": data.count,
            "quickLookBuild": "burrete-app",
            "debug": false,
            "uiScale": 0.86,
            "showPanelControls": UserDefaults.standard.object(forKey: "showPreviewPanelControls") as? Bool ?? true,
            "transparentBackground": transparentBackground,
            "sdfGrid": format.molstarFormat == "sdf",
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
        for name in ["molstar.js", "molstar.css", "viewer.js"] {
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
            :root { --buret-viewer-ui-scale: 0.86; }
            html, body, #app { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
            body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; color: #f2f2f2; }
            body.burette-opaque-background,
            body.burette-opaque-background #app {
              background: #111317;
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
              background: #111317 !important;
            }
            body.burette-transparent-background .msp-plugin .msp-layout-left,
            body.burette-transparent-background .msp-plugin .msp-layout-right,
            body.burette-transparent-background .msp-plugin .msp-layout-top,
            body.burette-transparent-background .msp-plugin .msp-layout-bottom {
              background: rgba(238, 236, 231, 0.72) !important;
              -webkit-backdrop-filter: blur(14px);
              backdrop-filter: blur(14px);
            }
            #status {
              position: absolute; left: 12px; top: 12px; z-index: 2147483647;
              max-width: min(880px, calc(100vw - 32px)); box-sizing: border-box;
              padding: 10px 12px; border-radius: 10px; color: rgba(255, 255, 255, 0.96);
              background: rgba(0, 0, 0, 0.76); font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              transform: scale(var(--buret-viewer-ui-scale)); transform-origin: top left;
              white-space: pre-wrap; pointer-events: auto;
            }
            #status.error { color: #ffd4d4; background: rgba(70, 0, 0, 0.82); }
            #status.hidden { display: none; }
            #buret-toolbar {
              position: absolute; top: 12px; right: 12px; z-index: 2147483646;
              display: flex; align-items: center; gap: 6px; padding: 6px;
              border: 1px solid rgba(255, 255, 255, 0.10);
              border-radius: 12px; color: rgba(255, 255, 255, 0.94);
              background: rgba(18, 20, 22, 0.86);
              -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
              box-shadow:
                0 8px 22px rgba(0, 0, 0, 0.22),
                inset 0 1px 0 rgba(255, 255, 255, 0.06);
              user-select: none; touch-action: none;
              transform: scale(var(--buret-viewer-ui-scale)); transform-origin: top right;
            }
            .buret-button {
              min-width: 26px; height: 26px; border: 0; border-radius: 7px; padding: 0 7px;
              color: inherit; background: transparent; font: 600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
              display: grid; place-items: center;
            }
            .buret-button:hover, .buret-button.active { background: rgba(255, 255, 255, 0.14); }
            .buret-button.hidden { display: none; }
            .buret-button svg { width: 15px; height: 15px; display: block; }
            .buret-grip { cursor: move; color: rgba(255, 255, 255, 0.66); }
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
            <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Move controls" title="Move controls">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button" type="button" data-buret-action="fit" aria-label="Fullscreen" title="Fullscreen">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H7.4l3.2 3.2-1.4 1.4L6 7.4V9H4Zm11-5h5v5h-2V7.4l-3.2 3.2-1.4-1.4L16.6 6H15V4ZM9.2 13.4l1.4 1.4L7.4 18H9v2H4v-5h2v1.6l3.2-3.2Zm5.6 0 3.2 3.2V15h2v5h-5v-2h1.6l-3.2-3.2 1.4-1.4Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button buret-panel-toggle active" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel">Log</button>
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
          <script src="../assets/viewer.js"></script>
        </body>
        </html>
        """
    }
}

private struct AppViewerStructureFormat {
    let molstarFormat: String
    let isBinary: Bool

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
    init(contentView: NSView, transparentBackground: Bool) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.10).cgColor
        layer?.backgroundColor = (transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)).cgColor

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

private func escapeHTML(_ value: String) -> String {
    value
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&#39;")
}
