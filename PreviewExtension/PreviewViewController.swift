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
    private var currentViewerPageZoom: CGFloat = 1.0
    private var currentPreviewURL: URL?
    private var currentRuntimeDirectory: URL?
    private var rendererOverride: String?
    private var xyzrenderPresetOverride: String?
    private var xyzrenderOrientationRefText: String?
    private static let showDebugOverlay = false
    private static let verboseLogging = false
    private static let defaultViewerPageZoom: CGFloat = 1.0
    private static let minViewerPageZoom: CGFloat = 1.0
    private static let maxViewerPageZoom: CGFloat = 1.0

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
        currentPreviewURL = url
        currentRuntimeDirectory = nil
        rendererOverride = nil
        xyzrenderPresetOverride = nil
        xyzrenderOrientationRefText = nil
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
                let result = try Self.buildInlinePreviewHTML(for: url, requestID: requestID.uuidString)
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
                    self.currentRuntimeDirectory = result.indexURL.deletingLastPathComponent()
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
                    if Self.shouldAllowSystemFallback(for: error, fileExtension: Self.structurePathExtension(for: url)) {
                        self.finishPreviewIfNeeded(error, requestID: requestID)
                    } else {
                        self.renderNativeError(error, fileURL: url)
                        self.finishPreviewIfNeeded(nil, requestID: requestID)
                    }
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

    private static let supportedStructureExtensions: Set<String> = [
        "bcif", "cif", "cms", "csv", "cub", "cube", "dcd", "ent", "gro", "in", "lammpstrj", "log", "mae", "maegz", "mcif", "mmcif", "mol", "mol2", "nctraj", "out", "pdb", "pdbqt", "pqr", "prmtop", "psf", "sd", "sdf", "smi", "smiles", "top", "trr", "tsv", "vasp", "xtc", "xyz"
    ]

    private static func buildInlinePreviewHTML(
        for url: URL,
        requestID: String,
        rendererOverride: String? = nil,
        xyzrenderPresetOverride: String? = nil,
        xyzrenderOrientationRefText: String? = nil
    ) throws -> BuildResult {
        var diagnostics: [String] = []
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let pathExtension = structurePathExtension(for: url)
        guard supportedStructureExtensions.contains(pathExtension) else {
            throw PreviewError.unsupportedStructureFile(url.lastPathComponent)
        }

        let accessGranted = url.startAccessingSecurityScopedResource()
        diag("securityScopedAccess=\(accessGranted)")
        defer { if accessGranted { url.stopAccessingSecurityScopedResource() } }

        let fileManager = FileManager.default
        try ensureUbiquitousFileIsAvailable(url, fileManager: fileManager)

        let webDirectory = try locateBundledWebDirectory(fileManager: fileManager, diagnostics: &diagnostics)
        diag("webDirectory=\(webDirectory.path)")
        try validateVendoredWebAssets(in: webDirectory, fileManager: fileManager, diagnostics: &diagnostics)

        let structureSize = try fileSize(for: url, fileManager: fileManager)
        let sizeLimit = quickLookSizeLimit(for: url)
        guard structureSize <= sizeLimit else {
            throw PreviewError.fileTooLarge(url.lastPathComponent, structureSize, sizeLimit)
        }
        let structureData = try Data(contentsOf: url)
        guard !structureData.isEmpty else { throw PreviewError.emptyStructureFile(url.lastPathComponent) }
        diag("structureData.bytes=\(structureData.count)")

        let preferences = PreviewPreferences.load()
        let gridFileSupport = preferences.gridFileSupport
        if let gridPreview = try MoleculeGridPreviewBuilder.makePreview(
            fileURL: url,
            data: structureData,
            host: .quickLook,
            theme: preferences.viewerTheme,
            canvasBackground: preferences.canvasBackground,
            transparentBackground: preferences.canvasBackground == "transparent",
            overlayOpacity: preferences.overlayOpacity,
            debug: showDebugOverlay,
            allowSelection: false,
            allowExport: false,
            maxRecords: 750,
            fileSupport: gridFileSupport
        ) {
            diag("detected.previewMode=grid2d format=\(gridPreview.format) records=\(gridPreview.recordsIncluded)/\(gridPreview.recordsTotal)")
            try validateVendoredMoleculeGridAssets(in: webDirectory, fileManager: fileManager, diagnostics: &diagnostics)
            let html = gridInlineHTML(title: url.lastPathComponent, preferences: preferences)
            diag("gridInlineHTML.bytes=\(html.utf8.count)")
            let gridRecordsScript = try gridRecordsScriptWithRDKitWasm(
                gridPreview.recordsScript,
                bundledWebDirectory: webDirectory
            )
            let runtimePreview = try createRuntimePreview(
                bundledWebDirectory: webDirectory,
                html: html,
                configJSON: configJSONWithRequestID(gridPreview.configJSON, requestID: requestID),
                structureBase64: nil,
                gridRecordsScript: gridRecordsScript,
                requiredAssets: ["grid-viewer.js", "grid.css"],
                requiresRDKit: true,
                externalArtifactSourceURL: nil,
                fileManager: fileManager,
                diagnostics: &diagnostics
            )
            let indexURL = runtimePreview.indexURL
            diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
            diag("runtime.index.exists=\(fileManager.fileExists(atPath: indexURL.path))")
            return BuildResult(html: html, indexURL: indexURL, readAccessURL: runtimePreview.readAccessURL, diagnostics: diagnostics)
        }
        if MoleculeGridFileSupport.requiresGridPreview(fileExtension: pathExtension) {
            if !gridFileSupport.supports(fileExtension: pathExtension) {
                throw PreviewError.gridFileTypeDisabled(pathExtension)
            }
            throw PreviewError.unsupportedStructureFile(url.lastPathComponent)
        }

        var format = StructureFormat(url: url, data: structureData)
        let rendererPolicy = BurreteRendererPolicy.resolve(
            format: BurreteRendererFormat(format),
            requestedMode: rendererOverride ?? preferences.rendererMode
        )
        let requestedRendererMode = rendererPolicy.requestedMode
        var renderer = rendererPolicy.renderer
        var structureDataForWeb = structureData
        var externalArtifact: PreviewExternalXyzrenderArtifact?
        var externalArtifactSourceURL: URL?
        var externalStatus: [String: Any]?
        var temporaryExternalDirectory: URL?
        let xyzrenderPreset = BurreteXyzrenderPreset.normalize(xyzrenderPresetOverride ?? preferences.xyzrenderPreset)
        if renderer == BurreteRendererMode.xyzrenderExternal,
           rendererOverride == nil,
           format.isExternalXyzrenderOnly,
           let convertedXYZ = PreviewStructureTextConverter.xyzData(
            from: structureData,
            fileExtension: pathExtension,
            label: url.lastPathComponent
           ) {
            renderer = BurreteRendererMode.xyzFast
            format = .xyzFastCompatible
            structureDataForWeb = convertedXYZ
            diag("xyzrender.default=built-in-text-parser")
        }
        if renderer == BurreteRendererMode.xyzrenderExternal {
            let renderDirectory = fileManager.temporaryDirectory
                .appendingPathComponent("BurreteXYZRender-\(UUID().uuidString)", isDirectory: true)
            temporaryExternalDirectory = renderDirectory
            do {
                try fileManager.createDirectory(at: renderDirectory, withIntermediateDirectories: true)
                externalArtifact = try PreviewExternalXyzrenderWorker.render(
                    inputData: structureData,
                    sourceFilename: url.lastPathComponent,
                    outputDirectory: renderDirectory,
                    preset: xyzrenderPreset,
                    customConfigPath: preferences.xyzrenderCustomConfigPath,
                    transparent: preferences.canvasBackground == "transparent",
                    executablePath: preferences.xyzrenderExecutablePath,
                    extraArguments: preferences.xyzrenderExtraArguments,
                    orientationRefText: xyzrenderOrientationRefText
                )
                externalArtifactSourceURL = renderDirectory.appendingPathComponent("xyzrender.svg")
            } catch {
                if format.isExternalXyzrenderOnly,
                   let convertedXYZ = PreviewStructureTextConverter.xyzData(
                    from: structureData,
                    fileExtension: pathExtension,
                    label: url.lastPathComponent
                   ) {
                    renderer = BurreteRendererMode.xyzFast
                    format = .xyzFastCompatible
                    structureDataForWeb = convertedXYZ
                    externalStatus = [
                        "status": "fallback",
                        "requested": BurreteRendererMode.xyzrenderExternal,
                        "message": "Using built-in text structure parser because external xyzrender is unavailable in Quick Look."
                    ]
                    diag("xyzrender.fallback=built-in-text-parser error=\(error.localizedDescription)")
                } else if format.isExternalXyzrenderOnly {
                    throw error
                } else {
                    renderer = BurreteRendererPolicy.fallbackRenderer(for: BurreteRendererFormat(format))
                    externalStatus = [
                        "status": "fallback",
                        "requested": BurreteRendererMode.xyzrenderExternal,
                        "message": error.localizedDescription
                    ]
                    diag("xyzrender.fallback=\(error.localizedDescription)")
                }
            }
        }
        defer {
            if let temporaryExternalDirectory {
                try? fileManager.removeItem(at: temporaryExternalDirectory)
            }
        }
        let xyzFastPayload = renderer == BurreteRendererMode.xyzFast ? makeXYZFastPayload(from: structureDataForWeb) : nil
        structureDataForWeb = xyzFastPayload?.data ?? structureDataForWeb
        diag("detected.format=\(format.molstarFormat) binary=\(format.isBinary) renderer=\(renderer)")
        if let xyzFastPayload {
            diag("xyzFast.firstFrame.bytes=\(xyzFastPayload.data.count) atoms=\(xyzFastPayload.atomCount ?? -1) frames=\(xyzFastPayload.frameCount ?? -1)")
        }

        let configJSON = try previewConfigJSON(
            format: format,
            label: url.lastPathComponent,
            requestID: requestID,
            requestedRendererMode: requestedRendererMode,
            byteCount: structureData.count,
            previewByteCount: structureDataForWeb.count,
            renderer: renderer,
            xyzFastPayload: xyzFastPayload,
            externalArtifact: externalArtifact,
            externalStatus: externalStatus,
            xyzrenderPreset: xyzrenderPreset,
            originalFileExtension: pathExtension,
            rendererPolicy: rendererPolicy,
            preferences: preferences
        )
        let base64 = structureDataForWeb.base64EncodedString(options: [])
        diag("structure.base64.chars=\(base64.count)")

        let html = inlineHTML(title: url.lastPathComponent, preferences: preferences, renderer: renderer)
        diag("inlineHTML.bytes=\(html.utf8.count)")
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: configJSON,
            structureBase64: base64,
            gridRecordsScript: nil,
            requiredAssets: runtimeAssets(for: renderer),
            requiresRDKit: false,
            externalArtifactSourceURL: externalArtifactSourceURL,
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
        structureBase64: String?,
        gridRecordsScript: String?,
        requiredAssets: [String],
        requiresRDKit: Bool,
        externalArtifactSourceURL: URL?,
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
            requiredAssets: requiredAssets,
            requiresRDKit: requiresRDKit,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )

        let runtimeDirectory = previewsDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)

        let indexURL = runtimeDirectory.appendingPathComponent("index.html")
        try Data(html.utf8).write(to: indexURL, options: [.atomic])
        try Data("window.BurreteConfig = \(configJSON);\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        let dataScript = structureBase64.map { "window.BurreteDataBase64 = \"\($0)\";\n" } ?? "window.BurreteDataBase64 = null;\n"
        try Data(dataScript.utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])
        if let gridRecordsScript {
            try Data(gridRecordsScript.utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-grid-records.js"), options: [.atomic])
        }
        if let externalArtifactSourceURL {
            let destination = runtimeDirectory.appendingPathComponent(externalArtifactSourceURL.lastPathComponent)
            _ = try copyAssetIfNeeded(from: externalArtifactSourceURL, to: destination, fileManager: fileManager)
            diagnostics.append("[build] runtime.externalArtifact=\(destination.lastPathComponent)")
        }
        return RuntimePreview(runtimeDirectory: runtimeDirectory, indexURL: indexURL, readAccessURL: previewsDirectory)
    }

    private static func configJSONWithRequestID(_ configJSON: String, requestID: String) throws -> String {
        let data = Data(configJSON.utf8)
        var payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        payload["previewRequestID"] = requestID
        let nextData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: nextData, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
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
        requiredAssets: [String],
        requiresRDKit: Bool,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws {
        let assetsDirectory = previewsDirectory.appendingPathComponent("assets", isDirectory: true)
        try fileManager.createDirectory(at: assetsDirectory, withIntermediateDirectories: true)
        for assetName in requiredAssets {
            let source = bundledWebDirectory.appendingPathComponent(assetName)
            let destination = assetsDirectory.appendingPathComponent(assetName)
            let copied = try copyAssetIfNeeded(from: source, to: destination, fileManager: fileManager)
            let size = ((try? fileManager.attributesOfItem(atPath: destination.path)[.size]) as? NSNumber)?.intValue ?? -1
            diagnostics.append("[build] runtime.asset.\(assetName).exists=\(fileManager.fileExists(atPath: destination.path)) size=\(size) copied=\(copied)")
        }
        if requiresRDKit {
            let rdkitSource = bundledWebDirectory.appendingPathComponent("rdkit", isDirectory: true)
            if fileManager.fileExists(atPath: rdkitSource.path) {
                let copied = try copyDirectoryIfNeeded(from: rdkitSource, to: assetsDirectory.appendingPathComponent("rdkit", isDirectory: true), fileManager: fileManager)
                diagnostics.append("[build] runtime.asset.rdkit.exists=true copied=\(copied)")
            }
        }
    }

    private static func runtimeAssets(for renderer: String) -> [String] {
        if renderer == BurreteRendererMode.xyzFast {
            return ["xyz-fast.js", "burette-agent.js", "viewer.js"]
        }
        if renderer == BurreteRendererMode.xyzrenderExternal {
            return ["molstar.css", "burette-agent.js", "viewer.js"]
        }
        return ["molstar.js", "molstar.css", "burette-agent.js", "viewer.js"]
    }

    private static func gridRecordsScriptWithRDKitWasm(_ recordsScript: String, bundledWebDirectory: URL) throws -> String {
        let wasmURL = bundledWebDirectory
            .appendingPathComponent("rdkit", isDirectory: true)
            .appendingPathComponent("RDKit_minimal.wasm")
        let wasmBase64 = try Data(contentsOf: wasmURL).base64EncodedString()
        return recordsScript + "window.BurreteRDKitWasmBase64 = \"\(wasmBase64)\";\n"
    }

    private static func copyAssetIfNeeded(from source: URL, to destination: URL, fileManager: FileManager) throws -> Bool {
        if try fileExistsAndMatches(source: source, destination: destination, fileManager: fileManager) {
            return false
        }
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
        return true
    }

    private static func copyDirectoryIfNeeded(from source: URL, to destination: URL, fileManager: FileManager) throws -> Bool {
        if try directoryExistsAndMatches(source: source, destination: destination, fileManager: fileManager) {
            return false
        }
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
        return true
    }

    private static func fileExistsAndMatches(source: URL, destination: URL, fileManager: FileManager) throws -> Bool {
        guard fileManager.fileExists(atPath: destination.path) else { return false }
        let sourceAttributes = try fileManager.attributesOfItem(atPath: source.path)
        let destinationAttributes = try fileManager.attributesOfItem(atPath: destination.path)
        return (sourceAttributes[.size] as? NSNumber)?.int64Value == (destinationAttributes[.size] as? NSNumber)?.int64Value &&
            sourceAttributes[.modificationDate] as? Date == destinationAttributes[.modificationDate] as? Date
    }

    private static func directoryExistsAndMatches(source: URL, destination: URL, fileManager: FileManager) throws -> Bool {
        guard fileManager.fileExists(atPath: destination.path) else { return false }
        for name in ["RDKit_minimal.js", "RDKit_minimal.wasm"] {
            let sourceFile = source.appendingPathComponent(name)
            let destinationFile = destination.appendingPathComponent(name)
            if !(try fileExistsAndMatches(source: sourceFile, destination: destinationFile, fileManager: fileManager)) {
                return false
            }
        }
        return true
    }

    private static func fileSize(for url: URL, fileManager: FileManager) throws -> Int64 {
        let attrs = try fileManager.attributesOfItem(atPath: url.path)
        return (attrs[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func previewConfigJSON(
        format: StructureFormat,
        label: String,
        requestID: String,
        requestedRendererMode: String,
        byteCount: Int,
        previewByteCount: Int,
        renderer: String,
        xyzFastPayload: XYZFastPayload?,
        externalArtifact: PreviewExternalXyzrenderArtifact?,
        externalStatus: [String: Any]?,
        xyzrenderPreset: String,
        originalFileExtension: String,
        rendererPolicy: BurreteRendererPolicy,
        preferences: PreviewPreferences
    ) throws -> String {
        var payload: [String: Any] = [
            "format": format.molstarFormat,
            "molstarFormat": format.molstarFormat,
            "binary": format.isBinary,
            "renderer": renderer,
            "requestedRenderer": requestedRendererMode,
            "allowMolstarFallback": true,
            "label": label,
            "previewRequestID": requestID,
            "byteCount": byteCount,
            "previewByteCount": previewByteCount,
            "quickLookBuild": "v10-product",
            "debug": showDebugOverlay,
            "theme": preferences.viewerTheme,
            "canvasBackground": preferences.canvasBackground,
            "uiScale": 1.0,
            "overlayOpacity": preferences.overlayOpacity,
            "transparentBackground": preferences.canvasBackground == "transparent",
            "sdfGrid": true,
            "showPanelControls": preferences.showPanelControls,
            "defaultLayoutState": preferences.defaultLayoutState,
            "canOpenInVesta": canOpenInVesta(fileExtension: originalFileExtension)
        ]
        if renderer == BurreteRendererMode.xyzrenderExternal {
            payload["xyzrenderViewer"] = true
            payload["molstarAvailable"] = rendererPolicy.molstarAvailable
            payload["quickLookViewer"] = true
            payload["xyzrenderPreset"] = xyzrenderPreset
            payload["xyzrenderPresetOptions"] = BurreteXyzrenderPreset.pickerOptions.map { ["value": $0.0, "label": $0.1] }
        }
        if format.molstarFormat == "xyz" && !format.isBinary {
            payload["quickLookViewer"] = true
            payload["xyzrenderPreset"] = xyzrenderPreset
            payload["xyzrenderPresetOptions"] = BurreteXyzrenderPreset.pickerOptions.map { ["value": $0.0, "label": $0.1] }
        }
        if renderer == BurreteRendererMode.xyzFast {
            var xyzFast: [String: Any] = [
                "style": preferences.xyzFastStyle,
                "firstFrameOnly": true,
                "showCell": true,
                "sourceByteCount": byteCount,
                "previewByteCount": previewByteCount
            ]
            if let atomCount = xyzFastPayload?.atomCount { xyzFast["atomCount"] = atomCount }
            if let frameCount = xyzFastPayload?.frameCount { xyzFast["frameCount"] = frameCount }
            if let comment = xyzFastPayload?.comment, !comment.isEmpty { xyzFast["comment"] = comment }
            payload["xyzFast"] = xyzFast
        }
        if let externalArtifact {
            payload["externalArtifact"] = [
                "path": externalArtifact.relativePath,
                "type": externalArtifact.outputType,
                "renderer": "xyzrender",
                "preset": externalArtifact.preset,
                "config": externalArtifact.configArgument,
                "orientationRef": externalArtifact.usedOrientationRef,
                "elapsedMs": externalArtifact.elapsedMs,
                "log": externalArtifact.log
            ]
            payload["xyzrenderPreset"] = externalArtifact.preset
        }
        if let externalStatus { payload["externalRendererStatus"] = externalStatus }
        let jsonData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: jsonData, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
    }

    private static func gridInlineHTML(title: String, preferences: PreviewPreferences) -> String {
        let safeTitle = escapeHTML(title)
        let backgroundClass = preferences.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Burrete Grid - \(safeTitle)</title>
          <link rel="stylesheet" href="../assets/grid.css" />
          <script>
            (function () {
              function post(type, message, payload) {
                var body = Object.assign({ type: type, message: String(message || '') }, payload || {});
                if (window.BurreteConfig && window.BurreteConfig.previewRequestID) body.requestID = String(window.BurreteConfig.previewRequestID);
                try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage(body); } catch (_) {}
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
            window.BurreteDebug = \(showDebugOverlay ? "true" : "false");
          </script>
          <script src="preview-config.js"></script>
          <script src="preview-grid-records.js"></script>
          <script src="../assets/rdkit/RDKit_minimal.js"></script>
          <script src="../assets/grid-viewer.js"></script>
        </body>
        </html>
        """
    }

    private static func inlineHTML(title: String, preferences: PreviewPreferences, renderer: String) -> String {
        let safeTitle = escapeHTML(title)
        let backgroundClass = preferences.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        let initialStatus: String
        let rendererAssets: String
        if renderer == "xyz-fast" {
            initialStatus = "[web] HTML body created. Waiting for Fast XYZ renderer…"
            rendererAssets = """
              <script src="../assets/xyz-fast.js"></script>
              <script>
                window.__mqlStatus && window.__mqlStatus('[web] xyz-fast.js parsed. typeof BurreteXYZFast=' + typeof window.BurreteXYZFast);
              </script>
            """
        } else if renderer == "xyzrender-external" {
            initialStatus = "[web] HTML body created. Waiting for xyzrender artifact…"
            rendererAssets = ""
        } else {
            initialStatus = "[web] HTML body created. Waiting for embedded data and Mol* script…"
            rendererAssets = """
              <script>
                window.__mqlStatus && window.__mqlStatus('[web] About to load molstar.js from bundled resource…');
              </script>
              <script src="../assets/molstar.js"></script>
              <script>
                window.__mqlStatus && window.__mqlStatus('[web] molstar.js parsed. typeof molstar=' + typeof window.molstar + '; Viewer=' + (window.molstar && typeof window.molstar.Viewer));
              </script>
            """
        }
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Burrete - \(safeTitle)</title>
          <link rel="stylesheet" href="../assets/molstar.css" />
          <style>
            :root {
              --buret-viewer-ui-scale: 0.86;
              --buret-toolbar-safe-top: 12px;
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
              position: absolute; top: var(--buret-toolbar-safe-top); right: 12px; left: auto; z-index: 2147483646;
              display: flex; align-items: center; gap: 6px; padding: 6px;
              border: 1px solid var(--buret-toolbar-border);
              border-radius: 12px; color: var(--buret-toolbar-color);
              background: var(--buret-toolbar-background);
              -webkit-backdrop-filter: blur(10px);
              backdrop-filter: blur(10px);
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
              function post(type, message, payload) {
                var body = Object.assign({ type: type, message: String(message || '') }, payload || {});
                if (window.BurreteConfig && window.BurreteConfig.previewRequestID) body.requestID = String(window.BurreteConfig.previewRequestID);
                try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage(body); } catch (_) {}
              }
              function shouldReportStatus(text, kind) {
                if (kind === 'error' || window.BurreteDebug) return true;
                return text.indexOf('[web] About to load molstar.js') === 0 ||
                  text.indexOf('[web] molstar.js parsed') === 0 ||
                  text.indexOf('[web] About to load viewer.js') === 0 ||
                  text.indexOf('[web] Loading Mol* engine') === 0 ||
                  text.indexOf('[web] Mol* engine loaded') === 0 ||
                  text.indexOf('[web] Loading Fast XYZ renderer') === 0 ||
                  text.indexOf('[web] Fast XYZ renderer loaded') === 0 ||
                  text.indexOf('[web] Loading xyzrender artifact') === 0 ||
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
            <button class="buret-button buret-grip" type="button" data-drag-handle aria-label="Collapse controls" aria-expanded="true" title="Collapse controls">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor"/></svg>
            </button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="left" aria-label="Toggle left panel" title="Toggle left panel">L</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="right" aria-label="Toggle right panel" title="Toggle right panel">R</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="sequence" aria-label="Toggle sequence panel" title="Toggle sequence panel">Seq</button>
            <button class="buret-button buret-panel-toggle" type="button" data-buret-toggle="log" aria-label="Toggle log panel" title="Toggle log panel">Log</button>
            <button class="buret-button" type="button" data-buret-action="theme" aria-label="Switch to light theme" title="Switch to light theme">Light</button>
            <button class="buret-button hidden" type="button" data-buret-action="open-vesta" aria-label="Open in VESTA" title="Open in VESTA">VESTA</button>
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
            window.BurreteDebug = \(showDebugOverlay ? "true" : "false");
            window.BurretePanelControlsVisible = \(preferences.showPanelControls ? "true" : "false");
            window.BurreteCacheBuster = String(Date.now());
          </script>
          \(rendererAssets)
          <script>
            window.__mqlStatus && window.__mqlStatus('[web] About to load viewer.js from bundled resource…');
          </script>
          <script src="../assets/burette-agent.js"></script>
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

    private static func validateVendoredWebAssets(in webDirectory: URL, fileManager: FileManager, diagnostics: inout [String]) throws {
        let required = ["viewer.js", "burette-agent.js", "xyz-fast.js", "molstar.js", "molstar.css"]
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

    private static func validateVendoredMoleculeGridAssets(in webDirectory: URL, fileManager: FileManager, diagnostics: inout [String]) throws {
        let required = [
            "grid-viewer.js",
            "grid.css",
            "rdkit/RDKit_minimal.js",
            "rdkit/RDKit_minimal.wasm"
        ]
        for name in required {
            let url = webDirectory.appendingPathComponent(name)
            let exists = fileManager.fileExists(atPath: url.path)
            let size = ((try? fileManager.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.intValue ?? -1
            diagnostics.append("[build] grid.asset.\(name).exists=\(exists) size=\(size)")
            guard exists else {
                throw PreviewError.couldNotCreateRuntimePreview("Missing vendored molecule grid asset: \(name). Run npm install --ignore-scripts && npm run vendor:rdkit")
            }
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
        throw PreviewError.ubiquitousFileNotDownloaded(url.lastPathComponent)
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

    private static func quickLookSizeLimit(for url: URL) -> Int64 {
        let mib: Int64 = 1024 * 1024
        switch structurePathExtension(for: url) {
        case "pdb", "ent", "pdbqt", "pqr":
            return 35 * mib
        case "cif", "mmcif", "mcif":
            return 40 * mib
        case "bcif":
            return 50 * mib
        case "csv", "sdf", "sd", "mol", "mol2", "xyz", "gro", "smi", "smiles", "tsv", "cub", "cube", "in", "log", "out", "vasp", "lammpstrj", "top", "psf", "prmtop", "mae", "maegz", "cms":
            return 25 * mib
        case "xtc", "trr", "dcd", "nctraj":
            return 75 * mib
        default:
            return 20 * mib
        }
    }

    private static func structurePathExtension(for url: URL) -> String {
        if url.lastPathComponent.lowercased().hasSuffix(".mae.gz") {
            return "maegz"
        }
        return url.pathExtension.lowercased()
    }

    private static func canOpenInVesta(fileExtension: String) -> Bool {
        ["xyz", "cub", "cube"].contains(fileExtension.lowercased())
    }

    private static func shouldAllowSystemFallback(for error: Error, fileExtension: String) -> Bool {
        let lowercasedExtension = fileExtension.lowercased()
        guard ["csv", "tsv"].contains(lowercasedExtension) else { return false }
        guard let previewError = error as? PreviewError else { return false }
        switch previewError {
        case .unsupportedStructureFile, .gridFileTypeDisabled:
            return true
        default:
            return false
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

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            appendLog("blocked navigation with missing URL")
            decisionHandler(.cancel)
            return
        }
        if isTrustedRuntimeURL(url) || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        appendLog("blocked navigation to \(url.absoluteString)")
        decisionHandler(.cancel)
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
        guard isTrustedScriptMessage(message) else { return }
        if let body = message.body as? [String: Any] {
            let type = body["type"] as? String ?? "unknown"
            let text = body["message"] as? String ?? String(describing: body)
            let messageRequestID = (body["requestID"] as? String).flatMap(UUID.init(uuidString:))
            if let messageRequestID, messageRequestID != activePreviewRequestID {
                appendLog("ignoring stale JS message type=\(type) requestID=\(messageRequestID.uuidString)")
                return
            }
            if type == "action" {
                handleJavaScriptAction(text)
                return
            }
            if type == "viewerZoom", let value = body["value"] as? NSNumber {
                setViewerPageZoom(CGFloat(value.doubleValue))
                return
            }
            if type == "setRenderer", let value = body["value"] as? String {
                setRendererOverride(value, orientationRefText: body["orientationRef"] as? String)
                return
            }
            if type == "setXyzrenderPreset", let value = body["value"] as? String {
                setXyzrenderPresetOverride(value)
                return
            }
            if type == "setXyzrenderOrientation" {
                setXyzrenderOrientation(body["text"] as? String ?? body["value"] as? String)
                return
            }
            appendLog("JS message type=\(type): \(text.prefix(1600))")
            if type == "ready" {
                guard let messageRequestID else {
                    appendLog("ignoring ready without requestID")
                    return
                }
                finishPreviewIfNeeded(nil, requestID: messageRequestID)
            } else if type == "error" {
                guard let messageRequestID else {
                    appendLog("ignoring error without requestID")
                    return
                }
                finishPreviewIfNeeded(nil, requestID: messageRequestID)
            }
            if Self.showDebugOverlay || type == "error" {
                statusLabel.isHidden = false
                statusLabel.stringValue = "[web:\(type)] \(text.prefix(900))"
            }
        } else {
            appendLog("JS message raw: \(String(describing: message.body))")
        }
    }

    private func isTrustedScriptMessage(_ message: WKScriptMessage) -> Bool {
        guard message.name == "burrete" else { return false }
        guard message.webView === webView, message.frameInfo.isMainFrame else { return false }
        let messageURL = message.frameInfo.request.url ?? webView.url
        guard let messageURL, messageURL.isFileURL else { return false }
        return isTrustedRuntimeURL(messageURL)
    }

    private func isTrustedRuntimeURL(_ url: URL) -> Bool {
        guard url.isFileURL else { return false }
        guard let currentRuntimeDirectory else { return false }
        let rootPath = currentRuntimeDirectory.standardizedFileURL.path
        let messagePath = url.standardizedFileURL.path
        return messagePath == rootPath || messagePath.hasPrefix(rootPath + "/")
    }

    private func handleJavaScriptAction(_ action: String) {
        appendLog("JS action=\(action)")
        if action == "open-vesta" {
            openCurrentPreviewInVesta()
            return
        }
        appendLog("unknown JS action=\(action)")
    }

    private func openCurrentPreviewInVesta() {
        guard let url = currentPreviewURL else {
            appendLog("openInVesta.missingCurrentURL")
            return
        }
        guard Self.canOpenInVesta(fileExtension: Self.structurePathExtension(for: url)) else {
            appendLog("openInVesta.unsupportedExtension=\(Self.structurePathExtension(for: url))")
            return
        }
        VestaLauncher.open(fileURL: url) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.appendLog("openInVesta.launched=\(url.path)")
            case .failure(let error):
                self.appendLog("openInVesta.failed=\(error.localizedDescription)")
            }
        }
    }

    private func setRendererOverride(_ value: String, orientationRefText: String? = nil) {
        let renderer = BurreteRendererMode.normalize(value)
        let hasNewOrientation = setXyzrenderOrientation(orientationRefText)
        if renderer != BurreteRendererMode.xyzrenderExternal {
            xyzrenderOrientationRefText = nil
        }
        guard rendererOverride != renderer || hasNewOrientation else { return }
        rendererOverride = renderer
        reloadCurrentPreview()
    }

    private func setXyzrenderPresetOverride(_ value: String) {
        let preset = BurreteXyzrenderPreset.normalize(value)
        guard xyzrenderPresetOverride != preset || rendererOverride != BurreteRendererMode.xyzrenderExternal else { return }
        xyzrenderPresetOverride = preset
        rendererOverride = BurreteRendererMode.xyzrenderExternal
        reloadCurrentPreview()
    }

    @discardableResult
    private func setXyzrenderOrientation(_ text: String?) -> Bool {
        let normalized = Self.normalizedXyzrenderOrientationRef(text)
        guard xyzrenderOrientationRefText != normalized else { return false }
        xyzrenderOrientationRefText = normalized
        return true
    }

    private static func normalizedXyzrenderOrientationRef(_ text: String?) -> String? {
        guard let text else { return nil }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        guard normalized.utf8.count <= 4 * 1024 * 1024 else { return nil }
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false)
        guard let first = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines),
              let atomCount = Int(first),
              atomCount > 0,
              lines.count >= atomCount + 2 else {
            return nil
        }
        return normalized.hasSuffix("\n") ? normalized : normalized + "\n"
    }

    private func reloadCurrentPreview() {
        guard let url = currentPreviewURL else { return }
        let requestID = UUID()
        activePreviewRequestID = requestID
        renderTimeoutWorkItem?.cancel()
        hasRenderedTerminationError = false
        let rendererOverride = rendererOverride
        let xyzrenderPresetOverride = xyzrenderPresetOverride
        let xyzrenderOrientationRefText = xyzrenderOrientationRefText
        appendLog("reloading preview rendererOverride=\(rendererOverride ?? "nil") xyzrenderPresetOverride=\(xyzrenderPresetOverride ?? "nil") orientationRef=\(xyzrenderOrientationRefText == nil ? "nil" : "set")")
        statusLabel.stringValue = "[native] Switching renderer...\n\(url.lastPathComponent)"
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let result = try Self.buildInlinePreviewHTML(
                    for: url,
                    requestID: requestID.uuidString,
                    rendererOverride: rendererOverride,
                    xyzrenderPresetOverride: xyzrenderPresetOverride,
                    xyzrenderOrientationRefText: xyzrenderOrientationRefText
                )
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.activePreviewRequestID == requestID else { return }
                    for line in result.diagnostics { self.appendLog(line) }
                    self.currentRuntimeDirectory = result.indexURL.deletingLastPathComponent()
                    self.webView.loadFileURL(result.indexURL, allowingReadAccessTo: result.readAccessURL)
                    self.scheduleRenderTimeout(for: requestID)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.activePreviewRequestID == requestID else { return }
                    self.appendLog("native renderer switch error: \(Self.describe(error))")
                    self.renderNativeError(error, fileURL: url)
                    self.finishPreviewIfNeeded(nil, requestID: requestID)
                }
            }
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

private enum PreviewStructureTextConverter {
    private struct Atom {
        let symbol: String
        let x: Double
        let y: Double
        let z: Double
    }

    private typealias Vec3 = (Double, Double, Double)

    static func xyzData(from data: Data, fileExtension: String, label: String) -> Data? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let atoms: [Atom]?
        switch fileExtension.lowercased() {
        case "cub", "cube":
            atoms = parseCube(lines)
        case "vasp":
            atoms = parseVasp(lines)
        case "in":
            atoms = parseQuantumEspressoInput(lines)
        case "out":
            atoms = parseOrcaOutput(lines)
        case "log":
            atoms = parseGaussianOutput(lines) ?? parseOrcaOutput(lines)
        default:
            atoms = nil
        }
        guard let atoms, !atoms.isEmpty else { return nil }
        var xyz = "\(atoms.count)\nConverted from \(label)\n"
        for atom in atoms {
            xyz += "\(atom.symbol) \(format(atom.x)) \(format(atom.y)) \(format(atom.z))\n"
        }
        return Data(xyz.utf8)
    }

    private static func parseCube(_ lines: [String]) -> [Atom]? {
        guard lines.count >= 6 else { return nil }
        let countFields = fields(lines[2])
        guard let atomCountToken = countFields.first, let atomCount = Int(atomCountToken), atomCount != 0 else { return nil }
        let count = abs(atomCount)
        guard lines.count >= 6 + count else { return nil }
        return (0..<count).compactMap { index in
            let parts = fields(lines[6 + index])
            guard parts.count >= 5, let number = Int(parts[0]),
                  let x = Double(parts[2]), let y = Double(parts[3]), let z = Double(parts[4]) else { return nil }
            return Atom(symbol: symbol(for: number), x: x, y: y, z: z)
        }
    }

    private static func parseVasp(_ lines: [String]) -> [Atom]? {
        guard lines.count >= 8, let scale = Double(lines[1].trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        guard let a = parseVector(lines[2], scale: scale),
              let b = parseVector(lines[3], scale: scale),
              let c = parseVector(lines[4], scale: scale) else { return nil }
        let symbols = fields(lines[5])
        let counts = fields(lines[6]).compactMap(Int.init)
        guard !symbols.isEmpty, symbols.count == counts.count else { return nil }
        var index = 7
        if index < lines.count && lines[index].trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("s") {
            index += 1
        }
        guard index < lines.count else { return nil }
        let mode = lines[index].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let direct = mode.hasPrefix("d")
        index += 1
        var atoms: [Atom] = []
        for (symbolIndex, symbol) in symbols.enumerated() {
            for _ in 0..<counts[symbolIndex] {
                guard index < lines.count else { return atoms.isEmpty ? nil : atoms }
                let parts = fields(lines[index])
                index += 1
                guard parts.count >= 3, let x = Double(parts[0]), let y = Double(parts[1]), let z = Double(parts[2]) else { continue }
                let position = direct ? combine(x, a, y, b, z, c) : (x * scale, y * scale, z * scale)
                atoms.append(Atom(symbol: symbol, x: position.0, y: position.1, z: position.2))
            }
        }
        return atoms
    }

    private static func parseQuantumEspressoInput(_ lines: [String]) -> [Atom]? {
        var cell: [Vec3] = []
        var cellScale = 1.0
        var atomStart: Int?
        var direct = false
        for index in lines.indices {
            let lower = lines[index].lowercased()
            if lower.trimmingCharacters(in: .whitespaces).hasPrefix("cell_parameters") {
                if lower.contains("bohr") { cellScale = 0.529177210903 }
                cell = (1...3).compactMap { offset in
                    guard index + offset < lines.count else { return nil }
                    return parseVector(lines[index + offset], scale: cellScale)
                }
            }
            if lower.trimmingCharacters(in: .whitespaces).hasPrefix("atomic_positions") {
                atomStart = index + 1
                direct = lower.contains("crystal")
            }
        }
        guard let atomStart else { return nil }
        var atoms: [Atom] = []
        for line in lines[atomStart...] {
            let parts = fields(line)
            guard parts.count >= 4 else { break }
            guard let x = Double(parts[1]), let y = Double(parts[2]), let z = Double(parts[3]) else { break }
            let position: Vec3
            if direct, cell.count == 3 {
                position = combine(x, cell[0], y, cell[1], z, cell[2])
            } else {
                position = (x, y, z)
            }
            atoms.append(Atom(symbol: parts[0], x: position.0, y: position.1, z: position.2))
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func parseOrcaOutput(_ lines: [String]) -> [Atom]? {
        var best: [Atom]?
        var index = 0
        while index < lines.count {
            if lines[index].contains("CARTESIAN COORDINATES (ANGSTROEM)") {
                var atoms: [Atom] = []
                index += 1
                while index < lines.count && !(fields(lines[index]).first.map { isElementSymbol($0) } ?? false) {
                    index += 1
                }
                while index < lines.count {
                    let parts = fields(lines[index])
                    guard parts.count >= 4, isElementSymbol(parts[0]),
                          let x = Double(parts[1]), let y = Double(parts[2]), let z = Double(parts[3]) else { break }
                    atoms.append(Atom(symbol: parts[0], x: x, y: y, z: z))
                    index += 1
                }
                if !atoms.isEmpty { best = atoms }
            } else {
                index += 1
            }
        }
        return best
    }

    private static func parseGaussianOutput(_ lines: [String]) -> [Atom]? {
        var best: [Atom]?
        var index = 0
        while index < lines.count {
            if lines[index].contains("Standard orientation:") || lines[index].contains("Input orientation:") {
                var atoms: [Atom] = []
                index += 1
                var separators = 0
                while index < lines.count && separators < 2 {
                    if lines[index].contains("-----") { separators += 1 }
                    index += 1
                }
                while index < lines.count {
                    if lines[index].contains("-----") { break }
                    let parts = fields(lines[index])
                    guard parts.count >= 6, let number = Int(parts[1]),
                          let x = Double(parts[3]), let y = Double(parts[4]), let z = Double(parts[5]) else {
                        index += 1
                        continue
                    }
                    atoms.append(Atom(symbol: symbol(for: number), x: x, y: y, z: z))
                    index += 1
                }
                if !atoms.isEmpty { best = atoms }
            } else {
                index += 1
            }
        }
        return best ?? parseGaussianSymbolicZMatrix(lines)
    }

    private static func parseGaussianSymbolicZMatrix(_ lines: [String]) -> [Atom]? {
        guard let start = lines.firstIndex(where: { $0.contains("Symbolic Z-matrix:") }) else { return nil }
        var atoms: [Atom] = []
        for line in lines[(start + 1)...] {
            let parts = fields(line)
            if parts.isEmpty { continue }
            if parts.first == "Charge" { continue }
            guard parts.count >= 4, isElementSymbol(parts[0]),
                  let x = Double(parts[1]), let y = Double(parts[2]), let z = Double(parts[3]) else {
                if !atoms.isEmpty { break }
                continue
            }
            atoms.append(Atom(symbol: parts[0], x: x, y: y, z: z))
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func fields(_ line: String) -> [String] {
        line.split { $0 == " " || $0 == "\t" }.map(String.init)
    }

    private static func parseVector(_ line: String, scale: Double) -> Vec3? {
        let parts = fields(line)
        guard parts.count >= 3, let x = Double(parts[0]), let y = Double(parts[1]), let z = Double(parts[2]) else { return nil }
        return (x * scale, y * scale, z * scale)
    }

    private static func combine(_ x: Double, _ a: Vec3, _ y: Double, _ b: Vec3, _ z: Double, _ c: Vec3) -> Vec3 {
        (x * a.0 + y * b.0 + z * c.0, x * a.1 + y * b.1 + z * c.1, x * a.2 + y * b.2 + z * c.2)
    }

    private static func isElementSymbol(_ value: String) -> Bool {
        symbolsByNumber.contains { $0 == value.capitalized }
    }

    private static func symbol(for atomicNumber: Int) -> String {
        guard atomicNumber > 0, atomicNumber <= symbolsByNumber.count else { return "X" }
        return symbolsByNumber[atomicNumber - 1]
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.6f", value)
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }

    private static let symbolsByNumber = [
        "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
        "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
        "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
        "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
        "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
        "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
        "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
        "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
        "Tl", "Pb", "Bi", "Po", "At", "Rn"
    ]
}

private struct StructureFormat {
    let molstarFormat: String
    let isBinary: Bool
    var prefersTransparentBackground: Bool { molstarFormat == "sdf" }
    var isExternalXyzrenderOnly: Bool { molstarFormat == "xyzrender" }

    static let xyzFastCompatible = StructureFormat(molstarFormat: "xyz", isBinary: false)

    private init(molstarFormat: String, isBinary: Bool) {
        self.molstarFormat = molstarFormat
        self.isBinary = isBinary
    }

    init(url: URL, data: Data) {
        let ext = url.lastPathComponent.lowercased().hasSuffix(".mae.gz") ? "maegz" : url.pathExtension.lowercased()
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
        case "xtc", "trr", "dcd", "nctraj":
            self.molstarFormat = ext
            self.isBinary = true
        case "lammpstrj", "top", "psf", "prmtop":
            self.molstarFormat = ext
            self.isBinary = false
        case "mae", "maegz", "cms":
            self.molstarFormat = "xyzrender"
            self.isBinary = false
        case "cub", "cube", "in", "log", "out", "vasp":
            self.molstarFormat = "xyzrender"
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

private extension BurreteRendererFormat {
    init(_ format: StructureFormat) {
        self.init(
            molstarFormat: format.molstarFormat,
            isBinary: format.isBinary,
            isExternalXyzrenderOnly: format.isExternalXyzrenderOnly
        )
    }
}

private struct PreviewExternalXyzrenderArtifact {
    let relativePath: String
    let outputType: String
    let preset: String
    let configArgument: String
    let usedOrientationRef: Bool
    let elapsedMs: Int
    let log: String
}

private enum PreviewExternalXyzrenderWorker {
    static func render(
        inputData: Data,
        sourceFilename: String,
        outputDirectory: URL,
        preset: String,
        customConfigPath: String,
        transparent: Bool,
        executablePath: String,
        extraArguments: String,
        orientationRefText: String?
    ) throws -> PreviewExternalXyzrenderArtifact {
        let fileManager = FileManager.default
        let inputURL = outputDirectory.appendingPathComponent(safeInputFilename(sourceFilename))
        let outputURL = outputDirectory.appendingPathComponent("xyzrender.svg")
        let logURL = outputDirectory.appendingPathComponent("xyzrender.log")
        try? fileManager.removeItem(at: outputURL)
        try? fileManager.removeItem(at: logURL)
        try inputData.write(to: inputURL, options: [.atomic])

        let process = Process()
        let configuredExecutable = executablePath.trimmingCharacters(in: .whitespacesAndNewlines)
        process.executableURL = URL(fileURLWithPath: try resolvedExecutable(configuredExecutable))
        var arguments = [inputURL.path, "-o", outputURL.path]

        let safePreset = BurreteXyzrenderPreset.normalize(preset)
        let configArgument = resolveConfigArgument(preset: safePreset, customConfigPath: customConfigPath)
        let effectivePreset = safePreset == "custom" && configArgument == "default" ? "default" : safePreset
        arguments += ["--config", configArgument]
        let orientationRefURL = try writeOrientationRef(orientationRefText, outputDirectory: outputDirectory)
        if let orientationRefURL {
            arguments += ["--ref", orientationRefURL.path]
        }
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
            throw PreviewExternalXyzrenderError.timedOut
        }

        logHandle.synchronizeFile()
        let logData = (try? Data(contentsOf: logURL)) ?? Data()
        let log = String(data: logData, encoding: .utf8) ?? String(decoding: logData, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw PreviewExternalXyzrenderError.failed(status: process.terminationStatus, log: log)
        }
        guard fileManager.fileExists(atPath: outputURL.path) else {
            throw PreviewExternalXyzrenderError.missingOutput
        }
        let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
        return PreviewExternalXyzrenderArtifact(
            relativePath: "xyzrender.svg",
            outputType: "svg",
            preset: effectivePreset,
            configArgument: configArgument,
            usedOrientationRef: orientationRefURL != nil,
            elapsedMs: elapsedMs,
            log: log
        )
    }

    private static func safeInputFilename(_ filename: String) -> String {
        let ext = URL(fileURLWithPath: filename).pathExtension
        return ext.isEmpty ? "input.xyz" : "input.\(ext)"
    }

    private static func writeOrientationRef(_ text: String?, outputDirectory: URL) throws -> URL? {
        guard let text, !text.isEmpty else { return nil }
        let url = outputDirectory.appendingPathComponent("xyzrender-orientation-ref.xyz")
        try Data(text.utf8).write(to: url, options: [.atomic])
        return url
    }

    private static func resolvedExecutable(_ configuredExecutable: String) throws -> String {
        if !configuredExecutable.isEmpty { return configuredExecutable }
        let fileManager = FileManager.default
        for directory in executableSearchPaths() {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("xyzrender").path
            if fileManager.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        throw PreviewExternalXyzrenderError.missingExecutable
    }

    private static func executableSearchPaths() -> [String] {
        let containerHome = FileManager.default.homeDirectoryForCurrentUser.path
        let userHome = "/Users/\(NSUserName())"
        var paths = [
            "\(userHome)/.local/bin",
            "\(userHome)/bin",
            "\(containerHome)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin"
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            paths += path.split(separator: ":").map(String.init)
        }
        var seen = Set<String>()
        return paths.filter { seen.insert($0).inserted }
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
        let defaultPath = executableSearchPaths().joined(separator: ":")
        if let path = environment["PATH"], !path.isEmpty {
            environment["PATH"] = defaultPath + ":" + path
        } else {
            environment["PATH"] = defaultPath
        }
        return environment
    }
}

private enum PreviewExternalXyzrenderError: LocalizedError {
    case missingExecutable
    case timedOut
    case missingOutput
    case failed(status: Int32, log: String)

    var errorDescription: String? {
        switch self {
        case .missingExecutable:
            return "External xyzrender executable was not found. Set an absolute xyzrender path in Burrete settings."
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

private struct PreviewPreferences {
    let showPanelControls: Bool
    let transparentBackground: Bool
    let viewerTheme: String
    let canvasBackground: String
    let overlayOpacity: Double
    let rendererMode: String
    let xyzFastStyle: String
    let xyzrenderPreset: String
    let xyzrenderCustomConfigPath: String
    let xyzrenderExecutablePath: String
    let xyzrenderExtraArguments: String
    let gridFileSupport: MoleculeGridFileSupport
    let defaultLayoutState: [String: String]

    static func load() -> PreviewPreferences {
        let appID = "com.local.BurreteV10" as CFString
        let showPanelControls = (CFPreferencesCopyAppValue("showPreviewPanelControls" as CFString, appID) as? Bool) ?? true
        let transparentBackground = (CFPreferencesCopyAppValue("useTransparentPreviewBackground" as CFString, appID) as? Bool) ?? false
        let viewerTheme = (CFPreferencesCopyAppValue("viewerTheme" as CFString, appID) as? String) ?? "auto"
        let canvasBackground = (CFPreferencesCopyAppValue("viewerCanvasBackground" as CFString, appID) as? String) ?? "auto"
        let overlayOpacity = (CFPreferencesCopyAppValue("viewerOverlayOpacity" as CFString, appID) as? Double) ?? 0.90
        let rendererMode = (CFPreferencesCopyAppValue("structureRendererMode" as CFString, appID) as? String) ?? "auto"
        let xyzFastStyle = (CFPreferencesCopyAppValue("xyzFastStyle" as CFString, appID) as? String) ?? "default"
        let xyzrenderPreset = (CFPreferencesCopyAppValue("xyzrenderPreset" as CFString, appID) as? String) ?? "default"
        let xyzrenderCustomConfigPath = (CFPreferencesCopyAppValue("xyzrenderCustomConfigPath" as CFString, appID) as? String) ?? ""
        let xyzrenderExecutablePath = (CFPreferencesCopyAppValue("xyzrenderExecutablePath" as CFString, appID) as? String) ?? ""
        let xyzrenderExtraArguments = (CFPreferencesCopyAppValue("xyzrenderExtraArguments" as CFString, appID) as? String) ?? ""
        let gridFileSupport = MoleculeGridFileSupport.loadFromAppPreferences(appID: appID)
        return PreviewPreferences(
            showPanelControls: showPanelControls,
            transparentBackground: transparentBackground,
            viewerTheme: viewerTheme,
            canvasBackground: canvasBackground,
            overlayOpacity: min(max(overlayOpacity, 0.72), 0.98),
            rendererMode: rendererMode,
            xyzFastStyle: xyzFastStyle,
            xyzrenderPreset: BurreteXyzrenderPreset.normalize(xyzrenderPreset),
            xyzrenderCustomConfigPath: xyzrenderCustomConfigPath,
            xyzrenderExecutablePath: xyzrenderExecutablePath,
            xyzrenderExtraArguments: xyzrenderExtraArguments,
            gridFileSupport: gridFileSupport,
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
    case unsupportedStructureFile(String)
    case gridFileTypeDisabled(String)
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
        case .unsupportedStructureFile(let name):
            return "Unsupported structure file type: \(name)"
        case .gridFileTypeDisabled(let ext):
            return ".\(ext) molecule grid previews are disabled in Burrete Settings."
        case .fileTooLarge(let name, let size, let limit):
            return "\(name) is too large for Quick Look preview (\(size) bytes; limit \(limit) bytes). Open it in the Burrete app viewer or use a smaller file."
        case .ubiquitousFileNotDownloaded(let name):
            return "\(name) is in iCloud and is not downloaded locally. Download it in Finder, then open Quick Look again."
        case .webRenderFailed(let message):
            return "Web rendering failed: \(message)"
        case .webRenderTimedOut:
            return "Mol* web rendering did not become ready within 30 seconds."
        case .couldNotCreatePreviewConfig:
            return "Could not create preview config."
        case .couldNotCreateRuntimePreview(let reason):
            return "Could not create runtime preview files: \(reason)"
        }
    }
}

private enum VestaLauncher {
    static func open(fileURL: URL, completion: @escaping (Result<Void, Error>) -> Void) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-a", "VESTA", fileURL.path]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        process.terminationHandler = { finished in
            let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            DispatchQueue.main.async {
                if finished.terminationStatus == 0 {
                    completion(.success(()))
                } else {
                    completion(.failure(VestaLaunchError.failed(message.trimmingCharacters(in: .whitespacesAndNewlines))))
                }
            }
        }
        do {
            try process.run()
        } catch {
            completion(.failure(error))
        }
    }
}

private enum VestaLaunchError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message):
            return message.isEmpty ? "VESTA could not be opened." : message
        }
    }
}
