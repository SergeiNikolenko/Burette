import Cocoa
import QuickLookUI
import WebKit

final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var logTextView: NSTextView!
    private var pendingCompletion: ((Error?) -> Void)?
    private var activePreviewRequestID = UUID()
    private var renderTimeoutWorkItem: DispatchWorkItem?
    private var logLines: [String] = []
    private let previewID = String(UUID().uuidString.prefix(8))
    private var hasRenderedTerminationError = false
    private var restoredWindowFrame: NSRect?
    private var currentViewerPageZoom: CGFloat = 0.86
    private static let showDebugOverlay = false
    private static let verboseLogging = false
    private static let defaultViewerPageZoom: CGFloat = 0.86
    private static let minViewerPageZoom: CGFloat = 0.72
    private static let maxViewerPageZoom: CGFloat = 1.35

    deinit {
        renderTimeoutWorkItem?.cancel()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "burrete")
        appendLog("deinit")
    }

    override func loadView() {
        let transparentBackground = PreviewPreferences.load().transparentBackground
        let container = NSView(frame: .zero)
        container.wantsLayer = true
        container.layer?.backgroundColor = (transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)).cgColor

        let userContentController = WKUserContentController()
        userContentController.add(self, name: "burrete")
        if Self.showDebugOverlay {
            userContentController.addUserScript(WKUserScript(source: Self.documentStartProbeJavaScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
            userContentController.addUserScript(WKUserScript(source: Self.documentEndProbeJavaScript, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        }

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if #available(macOS 11.0, *) {
            let prefs = WKWebpagePreferences()
            prefs.allowsContentJavaScript = true
            configuration.defaultWebpagePreferences = prefs
        } else {
            configuration.preferences.javaScriptEnabled = true
        }
        configuration.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        if Self.showDebugOverlay, #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.pageZoom = Self.defaultViewerPageZoom
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.wantsLayer = true
        webView.setValue(false, forKey: "drawsBackground")
        webView.layer?.backgroundColor = (transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)).cgColor
        if #available(macOS 11.0, *) {
            webView.underPageBackgroundColor = transparentBackground ? .clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)
        }
        container.addSubview(webView)

        let label = NSTextField(labelWithString: "Burrete debug boot...")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        label.textColor = NSColor(calibratedWhite: 0.94, alpha: 1.0)
        label.alignment = .left
        label.maximumNumberOfLines = 8
        label.lineBreakMode = .byWordWrapping
        label.wantsLayer = true
        label.layer?.backgroundColor = NSColor(calibratedWhite: 0.0, alpha: 0.58).cgColor
        label.layer?.cornerRadius = 8
        label.isHidden = !Self.showDebugOverlay
        container.addSubview(label)

        let scrollView = NSScrollView(frame: .zero)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.wantsLayer = true
        scrollView.layer?.backgroundColor = NSColor(calibratedWhite: 0.0, alpha: 0.76).cgColor
        scrollView.layer?.cornerRadius = 10

        let textView = NSTextView(frame: .zero)
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textColor = NSColor(calibratedWhite: 0.94, alpha: 1.0)
        textView.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        textView.textContainerInset = NSSize(width: 10, height: 8)
        scrollView.documentView = textView
        scrollView.isHidden = !Self.showDebugOverlay
        container.addSubview(scrollView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),

            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -12),
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 980),

            scrollView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            scrollView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            scrollView.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
            scrollView.heightAnchor.constraint(equalToConstant: 270)
        ])

        self.webView = webView
        self.statusLabel = label
        self.logTextView = textView
        self.view = container
        appendLog("loadView finished; WKWebView created")
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let requestID = UUID()
        activePreviewRequestID = requestID
        pendingCompletion = handler
        resetLog()
        hasRenderedTerminationError = false
        appendLog("preparePreviewOfFile called")
        appendLog("previewID=\(previewID)")
        appendLog("file.path=\(url.path)")
        appendLog("file.absoluteString=\(url.absoluteString)")
        appendFileDiagnostics(url)
        webView.stopLoading()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let result = try Self.buildInlinePreviewHTML(for: url)
                DispatchQueue.main.async { [weak self] in
                    guard let self else {
                        handler(nil)
                        return
                    }
                    guard self.activePreviewRequestID == requestID else {
                        self.appendLog("ignoring stale preview build for \(url.lastPathComponent)")
                        handler(nil)
                        return
                    }
                    for line in result.diagnostics { self.appendLog(line) }
                    self.statusLabel.stringValue = "[native] Loading file preview into WKWebView…\n\(url.lastPathComponent)"
                    self.appendLog("calling WKWebView.loadFileURL; html.bytes=\(result.html.utf8.count); indexURL=\(result.indexURL.path); readAccessURL=\(result.readAccessURL.path)")
                    self.webView.loadFileURL(result.indexURL, allowingReadAccessTo: result.readAccessURL)
                    self.scheduleRenderTimeout(for: requestID)
                    if Self.showDebugOverlay {
                        self.scheduleJavaScriptProbes()
                    }
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    guard let self else {
                        handler(nil)
                        return
                    }
                    guard self.activePreviewRequestID == requestID else {
                        self.appendLog("ignoring stale preview error for \(url.lastPathComponent): \(Self.describe(error))")
                        handler(nil)
                        return
                    }
                    self.appendLog("native build error: \(Self.describe(error))")
                    self.renderNativeError(error, fileURL: url)
                    self.finishPreviewIfNeeded(nil, requestID: requestID)
                }
            }
        }
    }

    private func appendFileDiagnostics(_ url: URL) {
        let fm = FileManager.default
        appendLog("file.exists=\(fm.fileExists(atPath: url.path))")
        if let attrs = try? fm.attributesOfItem(atPath: url.path) {
            if let size = attrs[.size] { appendLog("file.size=\(size) bytes") }
            if let modified = attrs[.modificationDate] { appendLog("file.modified=\(modified)") }
        }
        if let values = try? url.resourceValues(forKeys: [.typeIdentifierKey, .localizedTypeDescriptionKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]) {
            appendLog("resource.typeIdentifier=\(values.typeIdentifier ?? "nil")")
            appendLog("resource.localizedTypeDescription=\(values.localizedTypeDescription ?? "nil")")
            appendLog("resource.isUbiquitousItem=\(String(describing: values.isUbiquitousItem))")
            appendLog("resource.ubiquitousItemDownloadingStatus=\(String(describing: values.ubiquitousItemDownloadingStatus))")
        } else {
            appendLog("resourceValues unavailable")
        }
        appendLog("Bundle.main.bundlePath=\(Bundle.main.bundlePath)")
        appendLog("Bundle(for: PreviewViewController.self).bundlePath=\(Bundle(for: PreviewViewController.self).bundlePath)")
    }

    private struct BuildResult {
        let html: String
        let indexURL: URL
        let readAccessURL: URL
        let diagnostics: [String]
    }

    private static func buildInlinePreviewHTML(for url: URL) throws -> BuildResult {
        var diagnostics: [String] = []
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let accessGranted = url.startAccessingSecurityScopedResource()
        diag("securityScopedAccess=\(accessGranted)")
        defer { if accessGranted { url.stopAccessingSecurityScopedResource() } }

        let fileManager = FileManager.default
        try ensureUbiquitousFileIsAvailable(url, fileManager: fileManager)

        let webDirectory = try locateBundledWebDirectory(fileManager: fileManager, diagnostics: &diagnostics)
        diag("webDirectory=\(webDirectory.path)")
        try validateVendoredMolstarAssets(in: webDirectory, fileManager: fileManager, diagnostics: &diagnostics)

        let structureSize = try fileSize(for: url, fileManager: fileManager)
        let sizeLimit = quickLookSizeLimit(for: url)
        guard structureSize <= sizeLimit else {
            throw PreviewError.fileTooLarge(url.lastPathComponent, structureSize, sizeLimit)
        }
        let structureData = try Data(contentsOf: url)
        guard !structureData.isEmpty else { throw PreviewError.emptyStructureFile(url.lastPathComponent) }
        diag("structureData.bytes=\(structureData.count)")

        let format = StructureFormat(url: url, data: structureData)
        diag("detected.format=\(format.molstarFormat) binary=\(format.isBinary)")

        let preferences = PreviewPreferences.load()
        let configJSON = try previewConfigJSON(
            format: format,
            label: url.lastPathComponent,
            byteCount: structureData.count,
            preferences: preferences
        )
        let base64 = structureData.base64EncodedString(options: [])
        diag("structure.base64.chars=\(base64.count)")

        let html = inlineHTML(title: url.lastPathComponent, preferences: preferences)
        diag("inlineHTML.bytes=\(html.utf8.count)")
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: configJSON,
            structureBase64: base64,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        let indexURL = runtimePreview.indexURL
        diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diag("runtime.index.exists=\(fileManager.fileExists(atPath: indexURL.path))")
        return BuildResult(html: html, indexURL: indexURL, readAccessURL: runtimePreview.readAccessURL, diagnostics: diagnostics)
    }

    private struct RuntimePreview {
        let runtimeDirectory: URL
        let indexURL: URL
        let readAccessURL: URL
    }

    private static func createRuntimePreview(
        bundledWebDirectory: URL,
        html: String,
        configJSON: String,
        structureBase64: String,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> RuntimePreview {
        guard let cachesDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw PreviewError.couldNotCreateRuntimePreview("Caches directory is unavailable")
        }
        let previewsDirectory = cachesDirectory
            .appendingPathComponent("Burrete", isDirectory: true)
            .appendingPathComponent("previews", isDirectory: true)
        try fileManager.createDirectory(at: previewsDirectory, withIntermediateDirectories: true)
        pruneRuntimePreviews(in: previewsDirectory, fileManager: fileManager, diagnostics: &diagnostics)
        try ensureRuntimeAssets(
            bundledWebDirectory: bundledWebDirectory,
            previewsDirectory: previewsDirectory,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )

        let runtimeDirectory = previewsDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)

        let indexURL = runtimeDirectory.appendingPathComponent("index.html")
        try Data(html.utf8).write(to: indexURL, options: [.atomic])
        try Data("window.BurreteConfig = \(configJSON);\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        try Data("window.BurreteDataBase64 = \"\(structureBase64)\";\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])
        return RuntimePreview(runtimeDirectory: runtimeDirectory, indexURL: indexURL, readAccessURL: previewsDirectory)
    }

    private static func pruneRuntimePreviews(
        in previewsDirectory: URL,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .contentModificationDateKey]
        guard let contents = try? fileManager.contentsOfDirectory(at: previewsDirectory, includingPropertiesForKeys: Array(keys)) else { return }
        let cutoff = Date().addingTimeInterval(-6 * 60 * 60)
        let previewDirectories = contents.compactMap { url -> (url: URL, modified: Date)? in
            guard url.lastPathComponent != "assets",
                  let values = try? url.resourceValues(forKeys: keys),
                  values.isDirectory == true else {
                return nil
            }
            return (url, values.contentModificationDate ?? .distantPast)
        }
        let oldDirectories = previewDirectories.filter { $0.modified < cutoff }
        let overflowDirectories = previewDirectories
            .sorted { $0.modified > $1.modified }
            .dropFirst(24)
        var removed = 0
        var removedPaths = Set<String>()
        for entry in oldDirectories + overflowDirectories {
            guard removedPaths.insert(entry.url.path).inserted else { continue }
            if (try? fileManager.removeItem(at: entry.url)) != nil { removed += 1 }
        }
        if removed > 0 {
            diagnostics.append("[build] pruned.previewDirectories=\(removed)")
        }
    }

    private static func ensureRuntimeAssets(
        bundledWebDirectory: URL,
        previewsDirectory: URL,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws {
        let assetsDirectory = previewsDirectory.appendingPathComponent("assets", isDirectory: true)
        try fileManager.createDirectory(at: assetsDirectory, withIntermediateDirectories: true)
        for assetName in ["molstar.js", "molstar.css", "viewer.js"] {
            let source = bundledWebDirectory.appendingPathComponent(assetName)
            let destination = assetsDirectory.appendingPathComponent(assetName)
            try copyAssetAtomically(from: source, to: destination, fileManager: fileManager)
            let size = ((try? fileManager.attributesOfItem(atPath: destination.path)[.size]) as? NSNumber)?.intValue ?? -1
            diagnostics.append("[build] runtime.asset.\(assetName).exists=\(fileManager.fileExists(atPath: destination.path)) size=\(size) copied=true")
        }
    }

    private static func copyAssetAtomically(from source: URL, to destination: URL, fileManager: FileManager) throws {
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

    private static func fileSize(for url: URL, fileManager: FileManager) throws -> Int64 {
        let attrs = try fileManager.attributesOfItem(atPath: url.path)
        return (attrs[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func previewConfigJSON(format: StructureFormat, label: String, byteCount: Int, preferences: PreviewPreferences) throws -> String {
        let payload: [String: Any] = [
            "format": format.molstarFormat,
            "binary": format.isBinary,
            "label": label,
            "byteCount": byteCount,
            "quickLookBuild": "v10-product",
            "debug": showDebugOverlay,
            "uiScale": 0.86,
            "transparentBackground": format.prefersTransparentBackground && preferences.transparentSDFBackground,
            "sdfGrid": true,
            "showPanelControls": preferences.showPanelControls,
            "defaultLayoutState": preferences.defaultLayoutState
        ]
        let jsonData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: jsonData, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
    }

    private static func inlineHTML(title: String, preferences: PreviewPreferences) -> String {
        let safeTitle = escapeHTML(title)
        let backgroundClass = preferences.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Burrete - \(safeTitle)</title>
          <link rel="stylesheet" href="../assets/molstar.css" />
          <style>
            :root { --buret-viewer-ui-scale: 0.86; }
            html, body, #app { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
            html.buret-transparent-background,
            html.buret-transparent-background body,
            html.buret-transparent-background #app,
            html.buret-transparent-background .msp-plugin,
            html.buret-transparent-background .msp-viewport,
            html.buret-transparent-background .msp-layout-main,
            html.buret-transparent-background canvas { background: transparent !important; background-color: transparent !important; }
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
              position: absolute; left: 12px; top: 12px;
              z-index: 2147483647; max-width: min(880px, calc(100vw - 32px)); max-height: calc(50vh - 32px); overflow: auto;
              box-sizing: border-box; padding: 10px 12px; border-radius: 10px; color: rgba(255, 255, 255, 0.96);
              background: rgba(0, 0, 0, 0.76); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 11px; font-weight: 500; line-height: 1.35; white-space: pre-wrap; pointer-events: auto;
            }
            #status.error { color: #ffd4d4; background: rgba(70, 0, 0, 0.82); }
            #status.hidden { display: none; }
            #buret-toolbar {
              position: absolute; top: 12px; right: 12px; z-index: 2147483646;
              display: flex; align-items: center; gap: 6px; padding: 6px;
              border: 1px solid rgba(255, 255, 255, 0.10);
              border-radius: 12px; color: rgba(255, 255, 255, 0.94);
              background: rgba(18, 20, 22, 0.86);
              -webkit-backdrop-filter: blur(10px);
              backdrop-filter: blur(10px);
              box-shadow:
                0 8px 22px rgba(0, 0, 0, 0.22),
                inset 0 1px 0 rgba(255, 255, 255, 0.06);
              user-select: none; touch-action: none;
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
              function shouldReportStatus(text, kind) {
                if (kind === 'error' || window.BurreteDebug) return true;
                return text.indexOf('[web] About to load molstar.js') === 0 ||
                  text.indexOf('[web] molstar.js parsed') === 0 ||
                  text.indexOf('[web] About to load viewer.js') === 0 ||
                  text.indexOf('[web] Loading Mol* engine') === 0 ||
                  text.indexOf('[web] Mol* engine loaded') === 0 ||
                  text.indexOf('[web] WebGL viewer created') === 0 ||
                  text.indexOf('[web] Parsing structure') === 0 ||
                  text.indexOf('[web] Rendered ') === 0;
              }
              window.__mqlPost = post;
              window.__mqlStatus = function (message, kind) {
                var text = String(message || '');
                var el = document.getElementById('status');
                if (el) {
                  el.textContent = text;
                  if (kind === 'error') el.classList.add('error'); else el.classList.remove('error');
                  if (kind === 'error' || window.BurreteDebug) el.classList.remove('hidden'); else el.classList.add('hidden');
                }
                if (shouldReportStatus(text, kind)) {
                  post(kind === 'error' ? 'error' : 'status', text);
                }
              };
              window.__mqlAction = function (name) { post('action', name); };
              window.__mqlDebug = function (message) {
                if (window.BurreteDebug) post('debug', String(message || ''));
              };
              ['log', 'warn', 'error'].forEach(function (name) {
                var original = console[name];
                console[name] = function () {
                  try {
                    if (window.BurreteDebug || name === 'error') {
                      post('console.' + name, Array.prototype.map.call(arguments, function (x) { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (_) { return String(x); } }).join(' '));
                    }
                  } catch (_) {}
                  return original.apply(console, arguments);
                };
              });
              window.addEventListener('error', function (event) {
                var message = (event.error && event.error.stack) || event.message || String(event);
                window.__mqlStatus('[web] JavaScript error\\n\\n' + message, 'error');
              });
              window.addEventListener('unhandledrejection', function (event) {
                var reason = event.reason || {};
                var message = reason.stack || reason.message || String(reason);
                window.__mqlStatus('[web] Unhandled promise rejection\\n\\n' + message, 'error');
              });
              window.__mqlDebug('[web] inline head bootstrap installed');
            })();
          </script>
        </head>
        <body class="\(backgroundClass)">
          <div id="app"></div>
          <div id="buret-toolbar" role="toolbar" aria-label="Burrete preview controls">
            <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Move controls" title="Move controls">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button" type="button" data-buret-action="fit" aria-label="Fit window to screen" title="Fit window to screen">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H7.4l3.2 3.2-1.4 1.4L6 7.4V9H4Zm11-5h5v5h-2V7.4l-3.2 3.2-1.4-1.4L16.6 6H15V4ZM9.2 13.4l1.4 1.4L7.4 18H9v2H4v-5h2v1.6l3.2-3.2Zm5.6 0 3.2 3.2V15h2v5h-5v-2h1.6l-3.2-3.2 1.4-1.4Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel">Log</button>
          </div>
          <div id="status" class="hidden">[web] HTML body created. Waiting for embedded data and Mol* script…</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteDebug = \(showDebugOverlay ? "true" : "false");
            window.BurretePanelControlsVisible = \(PreviewPreferences.load().showPanelControls ? "true" : "false");
            window.BurreteCacheBuster = String(Date.now());
          </script>
          <script>
            window.__mqlStatus && window.__mqlStatus('[web] About to load molstar.js from bundled resource…');
          </script>
          <script src="../assets/molstar.js"></script>
          <script>
            window.__mqlStatus && window.__mqlStatus('[web] molstar.js parsed. typeof molstar=' + typeof window.molstar + '; Viewer=' + (window.molstar && typeof window.molstar.Viewer));
          </script>
          <script>
            window.__mqlStatus && window.__mqlStatus('[web] About to load viewer.js from bundled resource…');
          </script>
          <script src="../assets/viewer.js"></script>
          <script>
            window.__mqlDebug && window.__mqlDebug('[web] viewer.js script tag parsed. async startup may still be running.');
          </script>
        </body>
        </html>
        """
    }

    private static func locateBundledWebDirectory(fileManager: FileManager, diagnostics: inout [String]) throws -> URL {
        let bundles = [Bundle.main, Bundle(for: PreviewViewController.self)]
        let candidates = bundles.compactMap { bundle -> URL? in
            diagnostics.append("[build] bundle.candidate=\(bundle.bundlePath) resourceURL=\(bundle.resourceURL?.path ?? "nil")")
            return bundle.resourceURL?.appendingPathComponent("Web", isDirectory: true)
        }

        for candidate in candidates {
            diagnostics.append("[build] checking.webDirectory=\(candidate.path) exists=\(fileManager.fileExists(atPath: candidate.path))")
            if fileManager.fileExists(atPath: candidate.path) { return candidate }
        }
        let debugDescription = candidates.map(\.path).joined(separator: "\n")
        throw PreviewError.missingWebDirectory(debugDescription.isEmpty ? "no resource bundle candidates" : debugDescription)
    }

    private static func validateVendoredMolstarAssets(in webDirectory: URL, fileManager: FileManager, diagnostics: inout [String]) throws {
        let required = ["viewer.js", "molstar.js", "molstar.css"]
        for name in required {
            let url = webDirectory.appendingPathComponent(name)
            let exists = fileManager.fileExists(atPath: url.path)
            let size = ((try? fileManager.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.intValue ?? -1
            diagnostics.append("[build] asset.\(name).exists=\(exists) size=\(size)")
            guard exists else { throw PreviewError.missingWebAsset(name) }
        }
        let molstarURL = webDirectory.appendingPathComponent("molstar.js")
        let attributes = try fileManager.attributesOfItem(atPath: molstarURL.path)
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        if size < 1024 * 1024 { throw PreviewError.molstarAssetsNotVendored(size) }
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
        throw PreviewError.ubiquitousFileNotDownloaded(url.lastPathComponent)
    }

    private static func quickLookSizeLimit(for url: URL) -> Int64 {
        let mib: Int64 = 1024 * 1024
        switch url.pathExtension.lowercased() {
        case "pdb", "ent", "pdbqt", "pqr":
            return 35 * mib
        case "cif", "mmcif", "mcif":
            return 40 * mib
        case "bcif":
            return 50 * mib
        case "sdf", "sd", "mol", "mol2", "xyz", "gro":
            return 25 * mib
        default:
            return 20 * mib
        }
    }

    private func scheduleRenderTimeout(for requestID: UUID) {
        renderTimeoutWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.appendLog("render timeout waiting for JS ready")
            self.renderNativeError(PreviewError.webRenderTimedOut, fileURL: nil)
            self.finishPreviewIfNeeded(nil, requestID: requestID)
        }
        renderTimeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: workItem)
    }

    private func finishPreviewIfNeeded(_ error: Error?, requestID: UUID? = nil) {
        if let requestID, requestID != activePreviewRequestID {
            appendLog("skipping Quick Look completion for stale preview request")
            return
        }
        guard let completion = pendingCompletion else { return }
        renderTimeoutWorkItem?.cancel()
        renderTimeoutWorkItem = nil
        pendingCompletion = nil
        appendLog("calling Quick Look completion handler; error=\(error.map { Self.describe($0) } ?? "nil")")
        completion(error)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        appendLog("WK didStartProvisionalNavigation url=\(webView.url?.absoluteString ?? "nil")")
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        appendLog("WK didCommit url=\(webView.url?.absoluteString ?? "nil")")
        if Self.showDebugOverlay {
            probeJavaScript(label: "didCommit")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        appendLog("WK didFinish url=\(webView.url?.absoluteString ?? "nil")")
        if Self.showDebugOverlay {
            probeJavaScript(label: "didFinish")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        appendLog("WK didFail error=\(Self.describe(error))")
        renderNativeError(error, fileURL: nil)
        finishPreviewIfNeeded(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        appendLog("WK didFailProvisionalNavigation error=\(Self.describe(error))")
        renderNativeError(error, fileURL: nil)
        finishPreviewIfNeeded(nil)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        appendLog("WK webContentProcessDidTerminate")
        guard !hasRenderedTerminationError else { return }
        hasRenderedTerminationError = true
        let html = Self.staticErrorHTML(title: "WebKit process terminated", details: "The embedded WebKit process crashed while parsing Mol* or initializing WebGL. Use Burrete Settings or ./scripts/tail-log.sh for logs.")
        webView.loadHTMLString(html, baseURL: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "burrete" else { return }
        if let body = message.body as? [String: Any] {
            let type = body["type"] as? String ?? "unknown"
            let text = body["message"] as? String ?? String(describing: body)
            if type == "action" {
                handleJavaScriptAction(text)
                return
            }
            if type == "viewerZoom", let value = body["value"] as? NSNumber {
                setViewerPageZoom(CGFloat(value.doubleValue))
                return
            }
            appendLog("JS message type=\(type): \(text.prefix(1600))")
            if type == "ready" {
                finishPreviewIfNeeded(nil, requestID: activePreviewRequestID)
            } else if type == "error" {
                finishPreviewIfNeeded(nil, requestID: activePreviewRequestID)
            }
            if Self.showDebugOverlay || type == "error" {
                statusLabel.isHidden = false
                statusLabel.stringValue = "[web:\(type)] \(text.prefix(900))"
            }
        } else {
            appendLog("JS message raw: \(String(describing: message.body))")
        }
    }

    private func handleJavaScriptAction(_ action: String) {
        appendLog("JS action=\(action)")
        switch action {
        case "fit":
            toggleFitToScreen()
        default:
            appendLog("unknown JS action=\(action)")
        }
    }

    private func setViewerPageZoom(_ scale: CGFloat) {
        let clamped = min(max(scale, Self.minViewerPageZoom), Self.maxViewerPageZoom)
        guard abs(currentViewerPageZoom - clamped) > 0.001 else { return }
        currentViewerPageZoom = clamped
        webView.pageZoom = clamped
        appendLog("viewer pageZoom=\(String(format: "%.2f", Double(clamped)))")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.webView.evaluateJavaScript("window.BurreteHandleResize && window.BurreteHandleResize();", completionHandler: nil)
        }
    }

    private func toggleFitToScreen() {
        guard let window = view.window, let screen = window.screen ?? NSScreen.main else {
            appendLog("fit action ignored: no preview window")
            return
        }
        if window.styleMask.contains(.fullScreen) {
            window.toggleFullScreen(nil)
            return
        }
        if let frame = restoredWindowFrame {
            window.setFrame(frame, display: true, animate: false)
            restoredWindowFrame = nil
        } else {
            restoredWindowFrame = window.frame
            let targetFrame = screen.visibleFrame.insetBy(dx: 8, dy: 8)
            if window.styleMask.contains(.resizable) {
                window.setFrame(targetFrame, display: true, animate: false)
            } else {
                window.toggleFullScreen(nil)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.webView.evaluateJavaScript("window.BurreteHandleResize && window.BurreteHandleResize();", completionHandler: nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        appendLog("JS alert: \(message)")
        completionHandler()
    }

    private func scheduleJavaScriptProbes() {
        [0.25, 1.0, 2.5, 5.0, 10.0, 20.0].forEach { delay in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.probeJavaScript(label: "t+\(delay)s")
            }
        }
    }

    private func probeJavaScript(label: String) {
        let safeLabel = label.replacingOccurrences(of: "'", with: "\\'")
        let js = """
        (function () {
          var status = document.getElementById('status');
          var app = document.getElementById('app');
          var info = {
            label: '\(safeLabel)',
            href: String(location.href),
            readyState: document.readyState,
            title: document.title,
            hasBody: !!document.body,
            bodyTextPrefix: document.body ? document.body.innerText.slice(0, 1000) : null,
            statusText: status ? status.innerText.slice(0, 2000) : null,
            appChildren: app ? app.children.length : -1,
            canvasCount: document.getElementsByTagName('canvas').length,
            scriptCount: document.getElementsByTagName('script').length,
            typeofMolstar: typeof window.molstar,
            typeofViewer: window.molstar ? typeof window.molstar.Viewer : 'no molstar',
            typeofConfig: typeof window.BurreteConfig,
            dataBase64Chars: window.BurreteDataBase64 ? window.BurreteDataBase64.length : -1,
            webgl2: (function(){ try { var c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch(e) { return 'error:' + e; } })(),
            webgl1: (function(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch(e) { return 'error:' + e; } })()
          };
          return JSON.stringify(info, null, 2);
        })();
        """
        webView.evaluateJavaScript(js) { [weak self] result, error in
            if let error = error {
                self?.appendLog("JS probe \(label) error=\(Self.describe(error))")
            } else {
                self?.appendLog("JS probe \(label) result=\(String(describing: result))")
            }
        }
    }

    private func resetLog() {
        logLines.removeAll()
        logTextView?.string = ""
        Self.resetLogFiles()
    }

    private func appendLog(_ message: String) {
        guard Self.shouldRecordLog(message) else { return }
        let line = "[\(Self.timestamp())] [\(previewID)] \(message)"
        NSLog("[BurreteV10] \(line)")
        Self.writeLogLine(line)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.logLines.append(line)
            if self.logLines.count > 800 { self.logLines.removeFirst(self.logLines.count - 800) }
            self.logTextView?.string = self.logLines.joined(separator: "\n")
            self.logTextView?.scrollToEndOfDocument(nil)
            if self.statusLabel?.stringValue.isEmpty ?? true {
                self.statusLabel?.stringValue = line
            }
        }
    }

    private static func shouldRecordLog(_ message: String) -> Bool {
        if verboseLogging { return true }
        if message == "preparePreviewOfFile called" { return true }
        if message.hasPrefix("file.path=") { return true }
        if message.hasPrefix("resource.typeIdentifier=") { return true }
        if message.hasPrefix("[build] detected.format=") { return true }
        if message.hasPrefix("calling WKWebView.loadFileURL") { return true }
        if message.hasPrefix("WK didCommit") { return true }
        if message.hasPrefix("WK didFinish") { return true }
        if message.hasPrefix("WK didFail") { return true }
        if message.hasPrefix("WK webContentProcessDidTerminate") { return true }
        if message.hasPrefix("native build error") { return true }
        if message.hasPrefix("renderNativeError") { return true }
        if message.hasPrefix("JS action=") { return true }
        if message.hasPrefix("fit action ignored") { return true }
        if message.hasPrefix("JS alert:") { return true }
        if message.contains("JS message type=error") { return true }
        if message.contains("JS message type=console.error") { return true }
        if message.contains("JS message type=status: [web] About to load molstar.js") { return true }
        if message.contains("JS message type=status: [web] molstar.js parsed") { return true }
        if message.contains("JS message type=status: [web] About to load viewer.js") { return true }
        if message.contains("JS message type=status: [web] Loading Mol* engine") { return true }
        if message.contains("JS message type=status: [web] Mol* engine loaded") { return true }
        if message.contains("JS message type=status: [web] WebGL viewer created") { return true }
        if message.contains("JS message type=status: [web] Parsing structure") { return true }
        if message.contains("JS message type=status: [web] Rendered") { return true }
        if message.contains("JS message type=ready: ready") { return true }
        return false
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: Date())
    }

    private static var logURLs: [URL] {
        var urls: [URL] = []
        let fileManager = FileManager.default
        for directory in [.cachesDirectory, .applicationSupportDirectory] as [FileManager.SearchPathDirectory] {
            if let base = fileManager.urls(for: directory, in: .userDomainMask).first {
                let logDirectory = base.appendingPathComponent("Burrete", isDirectory: true)
                urls.append(logDirectory.appendingPathComponent("BurreteV10.log"))
                urls.append(logDirectory.appendingPathComponent("Burrete.log"))
            }
        }
        var seen = Set<String>()
        return urls.filter { seen.insert($0.path).inserted }
    }

    private static func resetLogFiles() {
        for url in logURLs { try? FileManager.default.removeItem(at: url) }
    }

    private static func writeLogLine(_ line: String) {
        let data = Data((line + "\n").utf8)
        for url in logURLs {
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                if FileManager.default.fileExists(atPath: url.path) {
                    let handle = try FileHandle(forWritingTo: url)
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                } else {
                    try data.write(to: url, options: [.atomic])
                }
            } catch {
                NSLog("[BurreteV10] could not write log to \(url.path): \(String(describing: error))")
            }
        }
    }

    private func renderNativeError(_ error: Error, fileURL: URL?) {
        let fileName = fileURL?.lastPathComponent ?? "file"
        appendLog("renderNativeError for \(fileName): \(Self.describe(error))")
        webView.loadHTMLString(Self.staticErrorHTML(title: "Burrete could not preview \(fileName)", details: Self.describe(error)), baseURL: nil)
    }

    private static func describe(_ error: Error) -> String {
        let ns = error as NSError
        var lines = ["\(type(of: error)): \(error.localizedDescription)", "domain=\(ns.domain) code=\(ns.code)"]
        if !ns.userInfo.isEmpty { lines.append("userInfo=\(ns.userInfo)") }
        return lines.joined(separator: "\n")
    }

    private static func staticErrorHTML(title: String, details: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:100%;height:100%;background:#111317;color:#f2f2f2}
        body{box-sizing:border-box;padding:24px;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
        h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;background:#24262a;padding:12px;border-radius:8px}
        </style></head><body><h1>\(escapeHTML(title))</h1><pre>\(escapeHTML(details))</pre></body></html>
        """
    }

    private static var documentStartProbeJavaScript: String {
        """
        (function(){
          function post(type, message) {
            try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage({ type: type, message: String(message || '') }); } catch (_) {}
          }
          post('debug', '[probe] document-start. href=' + String(location.href));
          window.addEventListener('DOMContentLoaded', function(){ post('debug', '[probe] DOMContentLoaded. body=' + !!document.body); });
          window.addEventListener('load', function(){ post('debug', '[probe] window-load. bodyText=' + (document.body ? document.body.innerText.slice(0, 300) : 'no body')); });
          window.addEventListener('error', function(e){ post('error', '[probe] error: ' + ((e.error && e.error.stack) || e.message || e)); });
          window.addEventListener('unhandledrejection', function(e){ var r=e.reason||{}; post('error', '[probe] unhandledrejection: ' + (r.stack || r.message || String(r))); });
        })();
        """
    }

    private static var documentEndProbeJavaScript: String {
        """
        (function(){
          try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage({ type: 'debug', message: '[probe] document-end. readyState=' + document.readyState + '; title=' + document.title }); } catch (_) {}
        })();
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

    private static func escapeScriptEnd(_ value: String) -> String {
        value.replacingOccurrences(of: "</script", with: "<\\/script", options: [.caseInsensitive])
    }

    private static func escapeStyleEnd(_ value: String) -> String {
        value.replacingOccurrences(of: "</style", with: "<\\/style", options: [.caseInsensitive])
    }
}

private struct StructureFormat {
    let molstarFormat: String
    let isBinary: Bool
    var prefersTransparentBackground: Bool { molstarFormat == "sdf" }

    init(url: URL, data: Data) {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "pdb", "ent", "pqr":
            self.molstarFormat = "pdb"
            self.isBinary = false
        case "pdbqt":
            self.molstarFormat = "pdbqt"
            self.isBinary = false
        case "cif":
            self.molstarFormat = Self.detectCIFFormat(data: data)
            self.isBinary = false
        case "mmcif", "mcif":
            self.molstarFormat = "mmcif"
            self.isBinary = false
        case "bcif":
            self.molstarFormat = "mmcif"
            self.isBinary = true
        case "sdf", "sd":
            self.molstarFormat = "sdf"
            self.isBinary = false
        case "mol":
            self.molstarFormat = "mol"
            self.isBinary = false
        case "mol2":
            self.molstarFormat = "mol2"
            self.isBinary = false
        case "xyz":
            self.molstarFormat = "xyz"
            self.isBinary = false
        case "gro":
            self.molstarFormat = "gro"
            self.isBinary = false
        default:
            self.molstarFormat = "mmcif"
            self.isBinary = false
        }
    }

    private static func detectCIFFormat(data: Data) -> String {
        let prefix = data.prefix(262_144)
        let text = decodeText(Data(prefix)).lowercased()
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
        if text.contains("_atom_site_fract_x") ||
            text.contains("_cell_length_a") ||
            text.contains("_symmetry_space_group_name") ||
            text.contains("_space_group_name_h-m") {
            return "cifCore"
        }
        return "cifCore"
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }
}

private struct PreviewPreferences {
    let showPanelControls: Bool
    let transparentBackground: Bool
    let transparentSDFBackground: Bool
    let defaultLayoutState: [String: String]

    static func load() -> PreviewPreferences {
        let appID = "com.local.BurreteV10" as CFString
        let showPanelControls = (CFPreferencesCopyAppValue("showPreviewPanelControls" as CFString, appID) as? Bool) ?? true
        let transparentBackground = (CFPreferencesCopyAppValue("useTransparentPreviewBackground" as CFString, appID) as? Bool) ?? true
        let transparentSDFBackground = (CFPreferencesCopyAppValue("transparentSDFBackground" as CFString, appID) as? Bool) ?? true
        return PreviewPreferences(
            showPanelControls: showPanelControls,
            transparentBackground: transparentBackground,
            transparentSDFBackground: transparentSDFBackground,
            defaultLayoutState: [
                "left": "collapsed",
                "right": "hidden",
                "top": "hidden",
                "bottom": "hidden"
            ]
        )
    }
}

private enum PreviewError: LocalizedError {
    case missingWebDirectory(String)
    case missingWebAsset(String)
    case molstarAssetsNotVendored(Int)
    case emptyStructureFile(String)
    case fileTooLarge(String, Int64, Int64)
    case ubiquitousFileNotDownloaded(String)
    case webRenderFailed(String)
    case webRenderTimedOut
    case couldNotCreatePreviewConfig
    case couldNotCreateRuntimePreview(String)

    var errorDescription: String? {
        switch self {
        case .missingWebDirectory(let path):
            return "Could not locate bundled Web resources. Checked:\n\(path)"
        case .missingWebAsset(let name):
            return "Missing bundled Web asset: \(name)"
        case .molstarAssetsNotVendored(let size):
            return "Mol* assets were not vendored into the extension. molstar.js is only \(size) bytes. Run ./scripts/build.sh so npm copies build/viewer/molstar.js and molstar.css before Xcode signs the app."
        case .emptyStructureFile(let name):
            return "The structure file is empty or not downloaded locally: \(name)"
        case .fileTooLarge(let name, let size, let limit):
            return "\(name) is too large for Quick Look preview (\(size) bytes; limit \(limit) bytes). Open it in the Burrete app viewer or use a smaller file."
        case .ubiquitousFileNotDownloaded(let name):
            return "\(name) is in iCloud and is not downloaded locally. Download it in Finder, then open Quick Look again."
        case .webRenderFailed(let message):
            return "Mol* web rendering failed: \(message)"
        case .webRenderTimedOut:
            return "Mol* web rendering did not become ready within 30 seconds."
        case .couldNotCreatePreviewConfig:
            return "Could not create Mol* preview config."
        case .couldNotCreateRuntimePreview(let reason):
            return "Could not create runtime preview files: \(reason)"
        }
    }
}
