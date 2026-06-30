import AppKit
import CryptoKit
import QuickLookUI
import SwiftUI
import WebKit
import zlib

fileprivate struct RuntimeAuxiliaryFile {
    let path: String
    let data: Data
}

final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var previewStatus = ""
    private var pendingCompletion: ((Error?) -> Void)?
    private var activePreviewRequestID = UUID()
    private var renderTimeoutWorkItem: DispatchWorkItem?
    private var previewSourceMonitor: DispatchSourceTimer?
    private var previewSourceFingerprint: PreviewSourceFingerprint?
    private var pendingPreviewSourceFingerprint: PreviewSourceFingerprint?
    private var pendingPreviewSourceReloadWorkItem: DispatchWorkItem?
    private var logLines: [String] = []
    private let previewID = String(UUID().uuidString.prefix(8))
    private var hasRenderedTerminationError = false
    private var currentViewerPageZoom: CGFloat = 0.9
    private var currentPreviewURL: URL?
    private var currentRuntimeDirectory: URL?
    private var rendererOverride: String?
    private var xyzrenderPresetOverride: String?
    private var xyzrenderOrientationRefText: String?
    private var xyzrenderControlsOverride: [String: Any]?
    private static let showDebugOverlay = false
    private static let verboseLogging = false
    private static let defaultViewerPageZoom: CGFloat = 0.9
    private static let minViewerPageZoom: CGFloat = 0.9
    private static let maxViewerPageZoom: CGFloat = 0.9
    private static let previewSourceMonitorQueue = DispatchQueue(label: "com.local.BurreteV10.preview-source-monitor")
    private static let gridRuntimeCSP = "default-src 'self' file: data: blob:; connect-src 'self' file:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob:; worker-src 'self' blob:;"
    private static let molstarRuntimeCSP = "default-src 'self' file: data: blob:; connect-src 'self' file:; script-src 'self' 'unsafe-inline' 'unsafe-eval' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob:; worker-src 'self' blob:;"
    private static let externalArtifactRuntimeCSP = "default-src 'self' file: data: blob:; connect-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob:; worker-src 'none';"
    private static let minimalRuntimeCSP = "default-src 'self' file: data: blob:; connect-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob:; worker-src 'none';"
    private static let maestroPreviewReadLimit = 64 * 1024 * 1024

    deinit {
        renderTimeoutWorkItem?.cancel()
        pendingPreviewSourceReloadWorkItem?.cancel()
        previewSourceMonitor?.cancel()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "burrete")
        appendLog("deinit")
    }

    override func loadView() {
        let transparentBackground = PreviewPreferences.load().resolvedTransparentBackground
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
        webView.wantsLayer = true
        webView.setValue(false, forKey: "drawsBackground")
        let backgroundColor = transparentBackground ? NSColor.clear : NSColor(calibratedWhite: 0.055, alpha: 1.0)
        webView.layer?.backgroundColor = backgroundColor.cgColor
        if #available(macOS 11.0, *) {
            webView.underPageBackgroundColor = backgroundColor
        }

        self.webView = webView
        self.view = NSHostingView(rootView: QuickLookPreviewSurface(webView: webView, transparentBackground: transparentBackground))
        appendLog("loadView finished; SwiftUI WKWebView surface created")
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let requestID = UUID()
        activePreviewRequestID = requestID
        pendingCompletion = handler
        stopPreviewSourceMonitoring()
        currentPreviewURL = url
        currentRuntimeDirectory = nil
        rendererOverride = nil
        xyzrenderPresetOverride = nil
        xyzrenderOrientationRefText = nil
        xyzrenderControlsOverride = nil
        resetLog()
        hasRenderedTerminationError = false
        appendLog("preparePreviewOfFile called")
        appendLog("previewID=\(previewID)")
        appendLog("file.path=\(url.path)")
        appendLog("file.absoluteString=\(url.absoluteString)")
        appendPreviewTrace(
            state: "created",
            requestID: requestID.uuidString,
            fileURL: url,
            message: "preparePreviewOfFile"
        )
        appendFileDiagnostics(url)
        webView.stopLoading()
        startPreviewSourceMonitoring(for: url)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let result: BuildResult
                do {
                    result = try Self.buildInlinePreviewHTML(for: url, requestID: requestID.uuidString)
                } catch {
                    result = try Self.buildTextFallbackPreviewResult(for: url, requestID: requestID.uuidString, originalError: error)
                }
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
                    self.previewStatus = "[native] Loading file preview into WKWebView...\n\(url.lastPathComponent)"
                    self.appendLog("calling WKWebView.loadFileURL; html.bytes=\(result.html.utf8.count); indexURL=\(result.indexURL.path); readAccessURL=\(result.readAccessURL.path)")
                    self.appendLog("elapsed.wkLoadStartMs=0")
                    self.currentRuntimeDirectory = result.indexURL.deletingLastPathComponent()
                    self.previewSourceFingerprint = Self.previewSourceFingerprint(for: url)
                    self.pendingPreviewSourceFingerprint = nil
                    self.webView.loadFileURL(result.indexURL, allowingReadAccessTo: result.readAccessURL)
                    self.scheduleRenderTimeout(for: requestID, timeoutSeconds: result.renderTimeoutSeconds)
                    self.finishPreviewIfNeeded(nil, requestID: requestID, cancelRenderTimeout: false)
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
                    self.appendPreviewTrace(
                        state: "failed",
                        requestID: requestID.uuidString,
                        fileURL: url,
                        error: error,
                        message: "native build error"
                    )
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

    private func startPreviewSourceMonitoring(for url: URL) {
        stopPreviewSourceMonitoring()
        previewSourceFingerprint = Self.previewSourceFingerprint(for: url)
        let timer = DispatchSource.makeTimerSource(queue: Self.previewSourceMonitorQueue)
        timer.schedule(deadline: .now() + 0.75, repeating: 0.75)
        timer.setEventHandler { [weak self] in
            DispatchQueue.main.async {
                self?.pollPreviewSourceIfNeeded()
            }
        }
        previewSourceMonitor = timer
        timer.resume()
        appendLog("previewSourceMonitor.started path=\(url.path)")
    }

    private func stopPreviewSourceMonitoring() {
        pendingPreviewSourceReloadWorkItem?.cancel()
        pendingPreviewSourceReloadWorkItem = nil
        pendingPreviewSourceFingerprint = nil
        previewSourceMonitor?.cancel()
        previewSourceMonitor = nil
        previewSourceFingerprint = nil
    }

    private func pollPreviewSourceIfNeeded() {
        guard renderTimeoutWorkItem == nil else { return }
        guard let url = currentPreviewURL else { return }
        guard let fingerprint = Self.previewSourceFingerprint(for: url) else { return }
        guard let currentFingerprint = previewSourceFingerprint else {
            previewSourceFingerprint = fingerprint
            return
        }
        guard fingerprint != currentFingerprint else { return }
        guard pendingPreviewSourceFingerprint != fingerprint else { return }
        schedulePreviewSourceReload(for: url, fingerprint: fingerprint)
    }

    private func schedulePreviewSourceReload(for url: URL, fingerprint: PreviewSourceFingerprint) {
        pendingPreviewSourceReloadWorkItem?.cancel()
        pendingPreviewSourceFingerprint = fingerprint
        appendLog("previewSource.changed size=\(fingerprint.size) fileID=\(fingerprint.fileID.map(String.init) ?? "nil")")
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.renderTimeoutWorkItem == nil else { return }
            guard self.currentPreviewURL?.standardizedFileURL == url.standardizedFileURL else { return }
            guard let latestFingerprint = Self.previewSourceFingerprint(for: url) else { return }
            guard latestFingerprint == fingerprint else {
                self.schedulePreviewSourceReload(for: url, fingerprint: latestFingerprint)
                return
            }
            guard self.previewSourceFingerprint != latestFingerprint else { return }
            self.appendLog("preview source changed on disk; reloading current preview")
            self.reloadCurrentPreview(sourceFingerprint: latestFingerprint, reason: "source-changed")
        }
        pendingPreviewSourceReloadWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: workItem)
    }

    private struct BuildResult {
        let html: String
        let indexURL: URL
        let readAccessURL: URL
        let diagnostics: [String]
        let renderTimeoutSeconds: TimeInterval
    }

    private struct StructurePreviewPayload {
        let format: StructureFormat
        let rendererPolicy: BurreteRendererPolicy
        let requestedRendererMode: String
        let renderer: String
        let structureData: Data
        let auxiliaryFiles: [RuntimeAuxiliaryFile]
        let stagedEntries: [[String: Any]]
        let externalArtifact: PreviewExternalXyzrenderArtifact?
        let externalArtifactSourceURL: URL?
        let externalStatus: [String: Any]?
        let temporaryExternalDirectory: URL?
        let xyzrenderPreset: String
        let xyzrenderControls: [String: Any]?
        let trajectoryFrameCount: Int?
        let molstarAvailable: Bool
    }

    private struct StructurePreviewBuildState {
        var format: StructureFormat
        var renderer: String
        var structureData: Data
        var auxiliaryFiles: [RuntimeAuxiliaryFile]
        var stagedEntries: [[String: Any]]
        var externalArtifact: PreviewExternalXyzrenderArtifact?
        var externalArtifactSourceURL: URL?
        var externalStatus: [String: Any]?
        var temporaryExternalDirectory: URL?
        var xyzrenderControls: [String: Any]?

        mutating func applyConvertedStructure(_ convertedStructure: PreviewStructureTextConverter.ConvertedStructure) {
            format = convertedStructure.format
            structureData = convertedStructure.data
            auxiliaryFiles = convertedStructure.auxiliaryFiles
            stagedEntries = convertedStructure.stagedEntries
        }
    }

    private struct FepGraphMLPreview {
        let nodes: [FepGraphMLNode]
        let edges: [FepGraphMLEdge]
    }

    private struct FepGraphMLNode {
        let id: String
        let label: String
        let atoms: Int
        let heavyAtoms: Int
        let bonds: Int
        let dockingScore: Double?
        let molblock: String
        let x: Double
        let y: Double
    }

    private struct FepGraphMLEdge {
        let source: String
        let target: String
        let score: Double?
    }

    private static let defaultRenderTimeoutSeconds: TimeInterval = 30
    private static let largeStructureRenderTimeoutSeconds: TimeInterval = 120
    private static let largeStructureRenderTimeoutThresholdBytes = 16 * 1024 * 1024
    private static let textFallbackPreviewReadLimit = 1024 * 1024

    private struct PreviewSourceFingerprint: Equatable {
        let fileID: Int64?
        let size: Int64
        let modifiedAt: TimeInterval
    }

    private struct DefaultCubeXyzrenderInput {
        let data: Data
        let sourceFilename: String
        let controls: [String: Any]
        let surfaceMode: String?
    }

    private enum StructurePreviewStrategy: String {
        case direct
        case external
        case trajectory
        case convert
        case legacy

        init(previewPlan: BurretePreviewPlan?) {
            switch previewPlan?.strategy {
            case "direct":
                self = .direct
            case "external":
                self = .external
            case "trajectory":
                self = .trajectory
            case "convert":
                self = .convert
            default:
                self = .legacy
            }
        }

        func requiresPreparedConversion(previewPlan: BurretePreviewPlan?) -> Bool {
            self == .convert && previewPlan?.converter?.required == true
        }

        func supportsFallbackRenderer(_ renderer: String, previewPlan: BurretePreviewPlan?) -> Bool {
            previewPlan?.fallbacks.contains { fallback in
                BurreteRendererMode.normalize(fallback.renderer) == renderer
            } ?? false
        }

        func requiresExtractedStandaloneCoordinates(fileExtension: String) -> Bool {
            guard self == .external || self == .legacy else { return false }
            return fileExtension.lowercased() == "out"
        }
    }

    private static func prepareConvertStructurePreviewIfNeeded(
        state: inout StructurePreviewBuildState,
        strategy: StructurePreviewStrategy,
        previewPlan: BurretePreviewPlan?,
        preparedConversion: PreviewStructureTextConverter.ConvertedStructure?,
        pathExtension: String,
        diagnostics: inout [String]
    ) {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }
        guard strategy == .convert else { return }
        if state.renderer == BurreteRendererMode.molstar,
           let convertedStructure = preparedConversion {
            state.applyConvertedStructure(convertedStructure)
            diag("previewPlan.convert.primary=\(pathExtension)-pdb staged=\(convertedStructure.stagedEntries.count)")
        }
        if state.renderer == BurreteRendererMode.molstar,
           strategy.requiresPreparedConversion(previewPlan: previewPlan),
           preparedConversion == nil,
           strategy.supportsFallbackRenderer(BurreteRendererMode.xyzrenderExternal, previewPlan: previewPlan) {
            state.renderer = BurreteRendererMode.xyzrenderExternal
            diag("previewPlan.convert.fallback=xyzrender-external missing-conversion")
        }
    }

    private static func preferBuiltInParserForDefaultExternalPreviewIfAvailable(
        state: inout StructurePreviewBuildState,
        rendererOverride: String?,
        preparedConversion: PreviewStructureTextConverter.ConvertedStructure?,
        diagnostics: inout [String]
    ) {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }
        guard state.renderer == BurreteRendererMode.xyzrenderExternal,
              rendererOverride == nil,
              state.format.isExternalXyzrenderOnly,
              let convertedStructure = preparedConversion else {
            return
        }
        state.renderer = BurreteRendererMode.molstar
        state.applyConvertedStructure(convertedStructure)
        diag("xyzrender.default=built-in-text-parser")
    }

    private static func buildInlinePreviewHTML(
        for url: URL,
        requestID: String,
        rendererOverride: String? = nil,
        xyzrenderPresetOverride: String? = nil,
        xyzrenderOrientationRefText: String? = nil,
        xyzrenderControlsOverride: [String: Any]? = nil
    ) throws -> BuildResult {
        var diagnostics: [String] = []
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let pathExtension = structurePathExtension(for: url)
        let isSupportedStructure = BurreteCoreBridge.supportedExtension(pathExtension)
            ?? BundledFormatRegistry.supportedExtension(pathExtension)
            ?? false
        guard isSupportedStructure else {
            throw PreviewError.unsupportedStructureFile(url.lastPathComponent)
        }

        let accessGranted = url.startAccessingSecurityScopedResource()
        diag("securityScopedAccess=\(accessGranted)")
        defer { if accessGranted { url.stopAccessingSecurityScopedResource() } }

        let fileManager = FileManager.default
        try ensureUbiquitousFileIsAvailable(url, fileManager: fileManager)

        let webDirectory = try locateBundledWebDirectory(fileManager: fileManager, diagnostics: &diagnostics)
        diag("webDirectory=\(webDirectory.path)")
        let assetValidationStarted = Date()
        try validateVendoredWebAssets(in: webDirectory, fileManager: fileManager, diagnostics: &diagnostics)
        diag("elapsed.assetValidationMs=\(elapsedMs(since: assetValidationStarted))")

        let structureSize = try fileSize(for: url, fileManager: fileManager)
        let sizeLimit = quickLookSizeLimit(for: url)
        let usesBoundedMaestroPreview = structureSize > sizeLimit && isMaestroPreviewExtension(pathExtension)
        guard structureSize <= sizeLimit || usesBoundedMaestroPreview else {
            throw PreviewError.fileTooLarge(url.lastPathComponent, structureSize, sizeLimit)
        }
        let fileReadStarted = Date()
        let structureData = usesBoundedMaestroPreview
            ? try readFilePrefix(url, maxBytes: maestroPreviewReadLimit)
            : try Data(contentsOf: url)
        diag("elapsed.fileReadMs=\(elapsedMs(since: fileReadStarted))")
        guard !structureData.isEmpty else { throw PreviewError.emptyStructureFile(url.lastPathComponent) }
        diag("structureData.bytes=\(structureData.count)")
        if usesBoundedMaestroPreview {
            diag("structureData.boundedMaestroPreview=true originalBytes=\(structureSize) prefixBytes=\(structureData.count)")
        }

        let preferences = PreviewPreferences.load()
        let previewPlan = BurreteCoreBridge.previewPlan(
            fileExtension: pathExtension,
            requestedMode: BurreteRendererMode.normalize(rendererOverride ?? preferences.rendererMode)
        )
        if let previewPlan {
            diag("previewPlan.strategy=\(previewPlan.strategy) renderer=\(previewPlan.renderer) converter=\(previewPlan.converter?.id ?? "none") staged=\(previewPlan.staged.count) fallbacks=\(previewPlan.fallbacks.count)")
        } else {
            diag("previewPlan.unavailable=true")
        }

        if shouldUseSpectrumPreview(fileExtension: pathExtension, previewPlan: previewPlan, data: structureData, url: url) {
            return try buildSpectrumPreviewResult(
                for: url,
                requestID: requestID,
                fileExtension: pathExtension,
                spectrumData: structureData,
                webDirectory: webDirectory,
                fileManager: fileManager,
                diagnostics: &diagnostics
            )
        }

        if shouldUseTextArtifactPreview(url: url, fileExtension: pathExtension, previewPlan: previewPlan) {
            return try buildTextArtifactPreviewResult(
                for: url,
                requestID: requestID,
                fileExtension: pathExtension,
                artifactData: structureData,
                webDirectory: webDirectory,
                fileManager: fileManager,
                diagnostics: &diagnostics
            )
        }

        if shouldUseFepGraphMLPreview(fileExtension: pathExtension, previewPlan: previewPlan) {
            return try buildFepGraphMLPreviewResult(
                for: url,
                requestID: requestID,
                structureData: structureData,
                webDirectory: webDirectory,
                fileManager: fileManager,
                diagnostics: &diagnostics
            )
        }

        let gridFileSupport = preferences.gridFileSupport
        let shouldBuildGridPreview = rendererOverride == nil || rendererOverride == BurreteRendererMode.auto
        if shouldBuildGridPreview, let gridPreviewResult = try buildMoleculeGridPreviewResult(
            for: url,
            requestID: requestID,
            structureData: structureData,
            webDirectory: webDirectory,
            preferences: preferences,
            gridFileSupport: gridFileSupport,
            fileManager: fileManager,
            diagnostics: &diagnostics
        ) {
            return gridPreviewResult
        }
        if requiresGridPreview(fileExtension: pathExtension, previewPlan: previewPlan) {
            if !gridFileSupport.supports(fileExtension: pathExtension) {
                throw PreviewError.gridFileTypeDisabled(pathExtension)
            }
            throw PreviewError.unsupportedStructureFile(url.lastPathComponent)
        }

        let structurePreview = try buildStructurePreviewPayload(
            for: url,
            pathExtension: pathExtension,
            structureData: structureData,
            rendererOverride: rendererOverride,
            xyzrenderPresetOverride: xyzrenderPresetOverride,
            xyzrenderOrientationRefText: xyzrenderOrientationRefText,
            xyzrenderControlsOverride: xyzrenderControlsOverride,
            preferences: preferences,
            previewPlan: previewPlan,
            usesBoundedMaestroPreview: usesBoundedMaestroPreview,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        defer {
            if let temporaryExternalDirectory = structurePreview.temporaryExternalDirectory {
                try? fileManager.removeItem(at: temporaryExternalDirectory)
            }
        }
        diag("detected.format=\(structurePreview.format.molstarFormat) binary=\(structurePreview.format.isBinary) renderer=\(structurePreview.renderer)")
        if let trajectoryFrameCount = structurePreview.trajectoryFrameCount {
            diag("trajectory.frames=\(trajectoryFrameCount) controls=\(structurePreview.renderer == BurreteRendererMode.molstar && trajectoryFrameCount > 1)")
        }

        let configJSON = try previewConfigJSON(
            format: structurePreview.format,
            label: url.lastPathComponent,
            requestID: requestID,
            requestedRendererMode: structurePreview.requestedRendererMode,
            byteCount: Int(min(structureSize, Int64(Int.max))),
            previewByteCount: structurePreview.structureData.count,
            renderer: structurePreview.renderer,
            externalArtifact: structurePreview.externalArtifact,
            externalStatus: structurePreview.externalStatus,
            xyzrenderPreset: structurePreview.xyzrenderPreset,
            xyzrenderControls: structurePreview.xyzrenderControls,
            stagedEntries: structurePreview.stagedEntries,
            trajectoryFrameCount: structurePreview.trajectoryFrameCount,
            originalFileExtension: pathExtension,
            rendererPolicy: structurePreview.rendererPolicy,
            previewPlan: previewPlan,
            molstarAvailable: structurePreview.molstarAvailable,
            preferences: preferences
        )
        diag("structure.payload.bytes=\(structurePreview.structureData.count)")
        let renderTimeoutInputBytes = max(
            structurePreview.structureData.count,
            Int(min(structureSize, Int64(Int.max))),
            structurePreview.auxiliaryFiles.reduce(0) { $0 + $1.data.count }
        )
        let renderTimeoutSeconds = self.renderTimeoutSeconds(
            byteCount: renderTimeoutInputBytes,
            renderer: structurePreview.renderer
        )
        diag("render.timeout.input.bytes=\(renderTimeoutInputBytes)")
        diag("render.timeout.seconds=\(Int(renderTimeoutSeconds))")

        let html = inlineHTML(title: url.lastPathComponent, preferences: preferences, renderer: structurePreview.renderer)
        diag("inlineHTML.bytes=\(html.utf8.count)")
        let runtimeWriteStarted = Date()
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: configJSON,
            structureData: structurePreview.structureData,
            auxiliaryFiles: structurePreview.auxiliaryFiles,
            gridRecordsScript: nil,
            requiredAssets: runtimeAssets(for: structurePreview.renderer),
            requiresRDKit: structurePreview.renderer == BurreteRendererMode.molstar,
            externalArtifactSourceURL: structurePreview.externalArtifactSourceURL,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diag("elapsed.runtimeWriteMs=\(elapsedMs(since: runtimeWriteStarted))")
        let indexURL = runtimePreview.indexURL
        diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diag("runtime.index.exists=\(fileManager.fileExists(atPath: indexURL.path))")
        return BuildResult(
            html: html,
            indexURL: indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: renderTimeoutSeconds
        )
    }

    private static func buildFepGraphMLPreviewResult(
        for url: URL,
        requestID: String,
        structureData: Data,
        webDirectory: URL,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> BuildResult {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let graph = try fepGraphMLPreview(from: structureData)
        let moleculesWithAtoms = graph.nodes.filter { $0.atoms > 0 }.count
        let totalAtoms = graph.nodes.reduce(0) { $0 + $1.atoms }
        diag("detected.previewMode=fep-graphml nodes=\(graph.nodes.count) edges=\(graph.edges.count) moleculesWithAtoms=\(moleculesWithAtoms) atoms=\(totalAtoms)")
        let html = fepGraphMLInlineHTML(title: url.lastPathComponent, graph: graph, requestID: requestID)
        let runtimeWriteStarted = Date()
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: try configJSONWithRequestID("{}", requestID: requestID),
            structureData: nil,
            auxiliaryFiles: [],
            gridRecordsScript: nil,
            requiredAssets: [],
            requiresRDKit: true,
            externalArtifactSourceURL: nil,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diag("elapsed.runtimeWriteMs=\(elapsedMs(since: runtimeWriteStarted))")
        diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diag("runtime.index.exists=\(fileManager.fileExists(atPath: runtimePreview.indexURL.path))")
        return BuildResult(
            html: html,
            indexURL: runtimePreview.indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: defaultRenderTimeoutSeconds
        )
    }

    private static func buildTextArtifactPreviewResult(
        for url: URL,
        requestID: String,
        fileExtension: String,
        artifactData: Data,
        webDirectory: URL,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> BuildResult {
        diagnostics.append("[build] detected.previewMode=text-artifact")
        let text = textArtifactPreviewContent(
            title: url.lastPathComponent,
            fileExtension: fileExtension,
            byteCount: artifactData.count,
            data: artifactData
        )
        let html = inlineTextArtifactHTML(
            title: url.lastPathComponent,
            fileExtension: fileExtension,
            byteCount: artifactData.count,
            content: text,
            requestID: requestID,
            renderer: "text"
        )
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: try textArtifactConfigJSON(
                title: url.lastPathComponent,
                fileExtension: fileExtension,
                byteCount: artifactData.count,
                requestID: requestID
            ),
            structureData: nil,
            auxiliaryFiles: [],
            gridRecordsScript: nil,
            requiredAssets: [],
            requiresRDKit: false,
            externalArtifactSourceURL: nil,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diagnostics.append("[build] textArtifact.html.bytes=\(html.utf8.count)")
        diagnostics.append("[build] runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        return BuildResult(
            html: html,
            indexURL: runtimePreview.indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: defaultRenderTimeoutSeconds
        )
    }

    private static func buildTextFallbackPreviewResult(
        for url: URL,
        requestID: String,
        originalError: Error
    ) throws -> BuildResult {
        var diagnostics: [String] = []
        diagnostics.append("[build] detected.previewMode=text-fallback")
        diagnostics.append("[build] textFallback.originalError=\(originalError.localizedDescription)")

        let accessGranted = url.startAccessingSecurityScopedResource()
        diagnostics.append("[build] textFallback.securityScopedAccess=\(accessGranted)")
        defer { if accessGranted { url.stopAccessingSecurityScopedResource() } }

        let fileManager = FileManager.default
        try ensureUbiquitousFileIsAvailable(url, fileManager: fileManager)
        let webDirectory = try locateBundledWebDirectory(fileManager: fileManager, diagnostics: &diagnostics)
        let fileExtension = structurePathExtension(for: url)
        let byteCount = try fileSize(for: url, fileManager: fileManager)
        let safeByteCount = Int(min(byteCount, Int64(Int.max)))
        let previewByteCount = Int(min(byteCount, Int64(textFallbackPreviewReadLimit)))
        let fallbackData = try readFilePrefix(url, maxBytes: previewByteCount)
        var content = textArtifactPreviewContent(
            title: url.lastPathComponent,
            fileExtension: fileExtension,
            byteCount: safeByteCount,
            data: fallbackData
        )
        if byteCount > Int64(previewByteCount) {
            content += "\n\n---\nPreview truncated to the first \(previewByteCount) bytes of \(byteCount) bytes."
        }
        let html = inlineTextArtifactHTML(
            title: url.lastPathComponent,
            fileExtension: fileExtension,
            byteCount: safeByteCount,
            content: content,
            requestID: requestID,
            renderer: "text-fallback"
        )
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: try textArtifactConfigJSON(
                title: url.lastPathComponent,
                fileExtension: fileExtension,
                byteCount: safeByteCount,
                requestID: requestID,
                renderer: "text-fallback"
            ),
            structureData: nil,
            auxiliaryFiles: [],
            gridRecordsScript: nil,
            requiredAssets: [],
            requiresRDKit: false,
            externalArtifactSourceURL: nil,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diagnostics.append("[build] textFallback.html.bytes=\(html.utf8.count)")
        diagnostics.append("[build] runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diagnostics.append("[build] runtime.index.exists=\(fileManager.fileExists(atPath: runtimePreview.indexURL.path))")
        return BuildResult(
            html: html,
            indexURL: runtimePreview.indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: defaultRenderTimeoutSeconds
        )
    }

    private static func buildSpectrumPreviewResult(
        for url: URL,
        requestID: String,
        fileExtension: String,
        spectrumData: Data,
        webDirectory: URL,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> BuildResult {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let content = decodeText(spectrumData)
        guard let spectrum = try parseQuickLookSpectrum(
            title: url.lastPathComponent,
            fileExtension: fileExtension,
            content: content
        ), !spectrum.primary.peaks.isEmpty else {
            throw PreviewError.unsupportedStructureFile("Spectrum preview found no drawable peaks in \(url.lastPathComponent)")
        }
        diag("detected.previewMode=spectrum format=\(spectrum.format) peaks=\(spectrum.primary.peaks.count)")
        let html = spectrumInlineHTML(title: url.lastPathComponent, spectrum: spectrum, requestID: requestID)
        let runtimeWriteStarted = Date()
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: try spectrumConfigJSON(
                title: url.lastPathComponent,
                fileExtension: fileExtension,
                byteCount: spectrumData.count,
                requestID: requestID,
                format: spectrum.format
            ),
            structureData: nil,
            auxiliaryFiles: [],
            gridRecordsScript: nil,
            requiredAssets: [],
            requiresRDKit: false,
            externalArtifactSourceURL: nil,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diag("elapsed.runtimeWriteMs=\(elapsedMs(since: runtimeWriteStarted))")
        diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diag("runtime.index.exists=\(fileManager.fileExists(atPath: runtimePreview.indexURL.path))")
        return BuildResult(
            html: html,
            indexURL: runtimePreview.indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: defaultRenderTimeoutSeconds
        )
    }

    private static func buildMoleculeGridPreviewResult(
        for url: URL,
        requestID: String,
        structureData: Data,
        webDirectory: URL,
        preferences: PreviewPreferences,
        gridFileSupport: MoleculeGridFileSupport,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> BuildResult? {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        guard let gridPreview = try MoleculeGridPreviewBuilder.makePreview(
            fileURL: url,
            data: structureData,
            host: .quickLook,
            theme: preferences.runtimeViewerTheme,
            canvasBackground: preferences.runtimeCanvasBackground,
            transparentBackground: preferences.resolvedTransparentBackground,
            themeTokens: preferences.themeTokens,
            overlayOpacity: preferences.overlayOpacity,
            debug: showDebugOverlay,
            allowSelection: false,
            allowExport: false,
            maxRecords: 750,
            fileSupport: gridFileSupport
        ) else {
            return nil
        }
        diag("detected.previewMode=grid2d format=\(gridPreview.format) records=\(gridPreview.recordsIncluded)/\(gridPreview.recordsTotal)")
        let gridAssetValidationStarted = Date()
        try validateVendoredMoleculeGridAssets(in: webDirectory, fileManager: fileManager, diagnostics: &diagnostics)
        diag("elapsed.gridAssetValidationMs=\(elapsedMs(since: gridAssetValidationStarted))")
        let html = gridInlineHTML(title: url.lastPathComponent, preferences: preferences)
        diag("gridInlineHTML.bytes=\(html.utf8.count)")
        let runtimeWriteStarted = Date()
        let runtimePreview = try createRuntimePreview(
            bundledWebDirectory: webDirectory,
            html: html,
            configJSON: configJSONWithRequestID(gridPreview.configJSON, requestID: requestID),
            structureData: nil,
            auxiliaryFiles: [],
            gridRecordsScript: gridPreview.recordsScript,
            requiredAssets: ["grid-ui.js", "grid-viewer.js", "grid.css"],
            requiresRDKit: true,
            externalArtifactSourceURL: nil,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        diag("elapsed.runtimeWriteMs=\(elapsedMs(since: runtimeWriteStarted))")
        let indexURL = runtimePreview.indexURL
        diag("runtimeDirectory=\(runtimePreview.runtimeDirectory.path)")
        diag("runtime.index.exists=\(fileManager.fileExists(atPath: indexURL.path))")
        return BuildResult(
            html: html,
            indexURL: indexURL,
            readAccessURL: runtimePreview.readAccessURL,
            diagnostics: diagnostics,
            renderTimeoutSeconds: defaultRenderTimeoutSeconds
        )
    }

    private static func buildStructurePreviewPayload(
        for url: URL,
        pathExtension: String,
        structureData: Data,
        rendererOverride: String?,
        xyzrenderPresetOverride: String?,
        xyzrenderOrientationRefText: String?,
        xyzrenderControlsOverride: [String: Any]?,
        preferences: PreviewPreferences,
        previewPlan: BurretePreviewPlan?,
        usesBoundedMaestroPreview: Bool,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws -> StructurePreviewPayload {
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let structureStrategy = StructurePreviewStrategy(previewPlan: previewPlan)
        diag("structure.strategy=\(structureStrategy.rawValue)")
        let initialFormat = StructureFormat(url: url, data: structureData)
        let rendererPolicy = BurreteRendererPolicy.resolve(
            format: BurreteRendererFormat(initialFormat),
            requestedMode: rendererOverride ?? preferences.rendererMode,
            fileExtension: pathExtension,
            previewPlan: previewPlan
        )
        let requestedRendererMode = rendererPolicy.requestedMode
        var state = StructurePreviewBuildState(
            format: initialFormat,
            renderer: rendererPolicy.renderer,
            structureData: structureData,
            auxiliaryFiles: [],
            stagedEntries: [],
            externalArtifact: nil,
            externalArtifactSourceURL: nil,
            externalStatus: nil,
            temporaryExternalDirectory: nil,
            xyzrenderControls: xyzrenderControlsOverride
        )
        let preparedConversion = PreviewStructureTextConverter.convertedData(
            from: structureData,
            fileExtension: pathExtension,
            label: url.lastPathComponent
        )
        prepareConvertStructurePreviewIfNeeded(
            state: &state,
            strategy: structureStrategy,
            previewPlan: previewPlan,
            preparedConversion: preparedConversion,
            pathExtension: pathExtension,
            diagnostics: &diagnostics
        )
        if structureStrategy != .convert,
           (state.renderer == BurreteRendererMode.molstar || PreviewStructureTextConverter.shouldPreferConvertedMolstarData(fileExtension: pathExtension)),
           let convertedStructure = preparedConversion {
            state.applyConvertedStructure(convertedStructure)
            diag("molstar.converted=\(pathExtension)-pdb")
        }
        let xyzrenderPreset = BurreteXyzrenderPreset.normalize(xyzrenderPresetOverride ?? preferences.xyzrenderPreset)
        let xyzPayload = state.format.molstarFormat == "xyz" && !state.format.isBinary ? makeXYZPayload(from: state.structureData) : nil
        let estimatedTrajectoryFrameCount = estimateTrajectoryFrameCount(
            fileExtension: pathExtension,
            sourceData: structureData,
            previewData: state.structureData,
            format: state.format
        )
        if let estimatedTrajectoryFrameCount, estimatedTrajectoryFrameCount > 1 {
            diag("trajectory.detected.frames=\(estimatedTrajectoryFrameCount)")
        }
        let resolvedTrajectoryFrameCount = max(xyzPayload?.frameCount ?? 0, estimatedTrajectoryFrameCount ?? 0)
        let isXYZTrajectory = (xyzPayload?.frameCount ?? 0) > 1
        if isXYZTrajectory,
           rendererOverride == nil,
           requestedRendererMode == BurreteRendererMode.auto,
           state.renderer != BurreteRendererMode.molstar {
            state.renderer = BurreteRendererMode.molstar
            diag("xyz.trajectory.default=molstar frames=\(xyzPayload?.frameCount ?? -1)")
        }
        preferBuiltInParserForDefaultExternalPreviewIfAvailable(
            state: &state,
            rendererOverride: rendererOverride,
            preparedConversion: preparedConversion,
            diagnostics: &diagnostics
        )
        if usesBoundedMaestroPreview, state.format.isExternalXyzrenderOnly {
            throw PreviewError.couldNotExtractBoundedMaestroPreview(url.lastPathComponent, Self.maestroPreviewReadLimit)
        }
        if structureStrategy.requiresExtractedStandaloneCoordinates(fileExtension: pathExtension),
           state.format.isExternalXyzrenderOnly,
           preparedConversion == nil {
            throw PreviewError.notRenderableStandaloneStructure(url.lastPathComponent)
        }
        try renderExternalXyzrenderIfNeeded(
            state: &state,
            url: url,
            pathExtension: pathExtension,
            structureData: structureData,
            rendererOverride: rendererOverride,
            xyzrenderPreset: xyzrenderPreset,
            xyzrenderOrientationRefText: xyzrenderOrientationRefText,
            xyzrenderControlsOverride: xyzrenderControlsOverride,
            preferences: preferences,
            preparedConversion: preparedConversion,
            fileManager: fileManager,
            diagnostics: &diagnostics
        )
        let molstarAvailable = rendererPolicy.molstarAvailable || preparedConversion != nil
        return StructurePreviewPayload(
            format: state.format,
            rendererPolicy: rendererPolicy,
            requestedRendererMode: requestedRendererMode,
            renderer: state.renderer,
            structureData: state.structureData,
            auxiliaryFiles: state.auxiliaryFiles,
            stagedEntries: state.stagedEntries,
            externalArtifact: state.externalArtifact,
            externalArtifactSourceURL: state.externalArtifactSourceURL,
            externalStatus: state.externalStatus,
            temporaryExternalDirectory: state.temporaryExternalDirectory,
            xyzrenderPreset: xyzrenderPreset,
            xyzrenderControls: state.xyzrenderControls,
            trajectoryFrameCount: state.renderer == BurreteRendererMode.molstar && resolvedTrajectoryFrameCount > 0 ? resolvedTrajectoryFrameCount : nil,
            molstarAvailable: molstarAvailable
        )
    }

    private static func renderExternalXyzrenderIfNeeded(
        state: inout StructurePreviewBuildState,
        url: URL,
        pathExtension: String,
        structureData: Data,
        rendererOverride: String?,
        xyzrenderPreset: String,
        xyzrenderOrientationRefText: String?,
        xyzrenderControlsOverride: [String: Any]?,
        preferences: PreviewPreferences,
        preparedConversion: PreviewStructureTextConverter.ConvertedStructure?,
        fileManager: FileManager,
        diagnostics: inout [String]
    ) throws {
        guard state.renderer == BurreteRendererMode.xyzrenderExternal else { return }
        func diag(_ message: String) { diagnostics.append("[build] " + message) }

        let renderDirectory = fileManager.temporaryDirectory
            .appendingPathComponent("BurreteXYZRender-\(UUID().uuidString)", isDirectory: true)
        state.temporaryExternalDirectory = renderDirectory
        let defaultXyzrenderInput = xyzrenderControlsOverride == nil
            ? defaultCubeXyzrenderInput(fileURL: url, data: structureData, fileExtension: pathExtension)
            : nil
        state.xyzrenderControls = xyzrenderControlsOverride ?? defaultXyzrenderInput?.controls
        do {
            try fileManager.createDirectory(at: renderDirectory, withIntermediateDirectories: true)
            state.externalArtifact = try PreviewExternalXyzrenderWorker.render(
                inputData: defaultXyzrenderInput?.data ?? structureData,
                sourceFilename: defaultXyzrenderInput?.sourceFilename ?? url.lastPathComponent,
                outputDirectory: renderDirectory,
                preset: xyzrenderPreset,
                customConfigPath: preferences.xyzrenderCustomConfigPath,
                transparent: preferences.canvasBackground == "transparent",
                executablePath: preferences.xyzrenderExecutablePath,
                extraArguments: preferences.xyzrenderExtraArguments,
                orientationRefText: xyzrenderOrientationRefText,
                controls: state.xyzrenderControls,
                surfaceMode: defaultXyzrenderInput?.surfaceMode
            )
            state.externalArtifactSourceURL = renderDirectory.appendingPathComponent("xyzrender.svg")
        } catch {
            if rendererOverride == BurreteRendererMode.xyzrenderExternal {
                throw error
            }
            if state.format.isExternalXyzrenderOnly {
                throw error
            } else {
                state.renderer = BurreteRendererPolicy.fallbackRenderer(for: BurreteRendererFormat(state.format))
                state.externalStatus = [
                    "status": "error",
                    "requested": BurreteRendererMode.xyzrenderExternal,
                    "message": error.localizedDescription
                ]
                diag("xyzrender.error=\(error.localizedDescription)")
                throw error
            }
        }
    }

    private static func renderTimeoutSeconds(byteCount: Int, renderer: String) -> TimeInterval {
        guard renderer == BurreteRendererMode.molstar else {
            return defaultRenderTimeoutSeconds
        }
        return byteCount >= largeStructureRenderTimeoutThresholdBytes
            ? largeStructureRenderTimeoutSeconds
            : defaultRenderTimeoutSeconds
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
        structureData: Data?,
        auxiliaryFiles: [RuntimeAuxiliaryFile],
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
        if let structureData {
            try structureData.write(to: runtimeDirectory.appendingPathComponent("preview-data.bin"), options: [.atomic])
        }
        for auxiliaryFile in auxiliaryFiles {
            try auxiliaryFile.data.write(to: runtimeDirectory.appendingPathComponent(auxiliaryFile.path), options: [.atomic])
        }
        if let gridRecordsScript {
            try Data(gridRecordsScript.utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-grid-records.js"), options: [.atomic])
        }
        if requiresRDKit {
            let rdkitWasm = previewsDirectory
                .appendingPathComponent("assets", isDirectory: true)
                .appendingPathComponent("rdkit", isDirectory: true)
                .appendingPathComponent("RDKit_minimal.wasm")
            let wasmData = try Data(contentsOf: rdkitWasm)
            try Data("window.BurreteRDKitWasmBase64 = \"\(wasmData.base64EncodedString())\";\n".utf8)
                .write(to: runtimeDirectory.appendingPathComponent("preview-rdkit-wasm.js"), options: [.atomic])
            diagnostics.append("[build] runtime.asset.rdkit.wasm.inlineBytes=\(wasmData.count)")
        }
        if let externalArtifactSourceURL {
            let destination = runtimeDirectory.appendingPathComponent(externalArtifactSourceURL.lastPathComponent)
            _ = try copyAssetIfNeeded(from: externalArtifactSourceURL, to: destination, fileManager: fileManager)
            diagnostics.append("[build] runtime.externalArtifact=\(destination.lastPathComponent)")
        }
        let manifestJSON = try runtimeManifestJSON(
            configJSON: configJSON,
            structureDataBytes: structureData?.count ?? 0,
            requiredAssets: requiredAssets,
            requiresRDKit: requiresRDKit
        )
        try Data(manifestJSON.utf8)
            .write(to: runtimeDirectory.appendingPathComponent("manifest.json"), options: [.atomic])
        return RuntimePreview(runtimeDirectory: runtimeDirectory, indexURL: indexURL, readAccessURL: previewsDirectory)
    }

    private static func runtimeManifestJSON(
        configJSON: String,
        structureDataBytes: Int,
        requiredAssets: [String],
        requiresRDKit: Bool
    ) throws -> String {
        let config = (try? JSONSerialization.jsonObject(with: Data(configJSON.utf8))) as? [String: Any] ?? [:]
        var manifest: [String: Any] = [
            "schemaVersion": 1,
            "createdAtMs": Int(Date().timeIntervalSince1970 * 1000),
            "complete": true,
            "host": "quicklook",
            "renderer": config["renderer"] as? String ?? config["mode"] as? String ?? "unknown",
            "sourceExtension": config["sourceExtension"] as? String ?? config["format"] as? String ?? "unknown",
            "documentId": config["documentId"] as? String ?? config["previewRequestID"] as? String ?? config["requestID"] as? String ?? "unknown",
            "byteCount": config["byteCount"] as? Int ?? structureDataBytes,
            "previewByteCount": config["previewByteCount"] as? Int ?? structureDataBytes,
            "requiredAssets": requiredAssets,
            "requiresRDKit": requiresRDKit
        ]
        if let externalArtifact = config["externalArtifact"] as? [String: Any] {
            manifest["externalArtifactType"] = externalArtifact["type"] as? String ?? "unknown"
        }
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        guard let json = String(data: data, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json + "\n"
    }

    private static func configJSONWithRequestID(_ configJSON: String, requestID: String) throws -> String {
        let data = Data(configJSON.utf8)
        var payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        payload["previewRequestID"] = requestID
        payload["rdkitWasmPath"] = "../assets/rdkit/RDKit_minimal.wasm"
        let nextData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: nextData, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
    }

    private static func elapsedMs(since started: Date) -> Int {
        max(0, Int(Date().timeIntervalSince(started) * 1000))
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
        if renderer == BurreteRendererMode.xyzrenderExternal {
            return ["viewer-runtime.css", "viewer-shell.js", "molstar.css", "burette-agent.js", "viewer.js"]
        }
        return ["viewer-runtime.css", "viewer-shell.js", "molstar.js", "molstar.css", "burette-agent.js", "viewer.js"]
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

    private static func previewSourceFingerprint(for url: URL) -> PreviewSourceFingerprint? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else { return nil }
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        let modifiedAt = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let fileID = (attributes[.systemFileNumber] as? NSNumber)?.int64Value
        return PreviewSourceFingerprint(fileID: fileID, size: size, modifiedAt: modifiedAt)
    }

    private static func previewConfigJSON(
        format: StructureFormat,
        label: String,
        requestID: String,
        requestedRendererMode: String,
        byteCount: Int,
        previewByteCount: Int,
        renderer: String,
        externalArtifact: PreviewExternalXyzrenderArtifact?,
        externalStatus: [String: Any]?,
        xyzrenderPreset: String,
        xyzrenderControls: [String: Any]?,
        stagedEntries: [[String: Any]],
        trajectoryFrameCount: Int?,
        originalFileExtension: String,
        rendererPolicy: BurreteRendererPolicy,
        previewPlan: BurretePreviewPlan?,
        molstarAvailable: Bool,
        preferences: PreviewPreferences
    ) throws -> String {
        let resolvedTrajectoryFrameCount = trajectoryFrameCount ?? 0
        let normalizedOriginalExtension = originalFileExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let usesStagedMaestroSolvent = !stagedEntries.isEmpty && ["cms", "mae", "maegz"].contains(normalizedOriginalExtension)
        let resolvedMolstarStyle = usesStagedMaestroSolvent ? "default" : preferences.resolvedMolstarStyle
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
            "dataPath": "./preview-data.bin",
            "sourceExtension": normalizedOriginalExtension,
            "stagedEntries": stagedEntries,
            "quickLookBuild": "v10-product",
            "quickLookViewer": true,
            "debug": showDebugOverlay,
            "theme": preferences.runtimeViewerTheme,
            "themeTokens": preferences.themeTokens,
            "canvasBackground": preferences.runtimeCanvasBackground,
            "molstarStyle": resolvedMolstarStyle,
            "waterRepresentation": "line",
            "uiScale": 0.9,
            "overlayOpacity": preferences.overlayOpacity,
            "transparentBackground": preferences.resolvedTransparentBackground,
            "sdfGrid": true,
            "sdfPosePager": renderer == BurreteRendererMode.molstar && format.molstarFormat == "sdf" && !format.isBinary,
            "trajectoryControls": renderer == BurreteRendererMode.molstar && resolvedTrajectoryFrameCount > 1,
            "trajectoryFrameCount": resolvedTrajectoryFrameCount,
            "showPanelControls": preferences.showPanelControls,
            "defaultLayoutState": preferences.defaultLayoutState,
            "canOpenInVesta": canOpenInVesta(fileExtension: originalFileExtension, previewPlan: previewPlan)
        ]
        if renderer == BurreteRendererMode.xyzrenderExternal {
            payload["xyzrenderViewer"] = true
            payload["molstarAvailable"] = molstarAvailable
            payload["xyzrenderPreset"] = xyzrenderPreset
            payload["xyzrenderPresetOptions"] = BurreteXyzrenderPreset.pickerOptions.map { ["value": $0.0, "label": $0.1] }
            if let xyzrenderControls { payload["xyzrenderControls"] = xyzrenderControls }
        }
        if format.molstarFormat == "xyz" && !format.isBinary {
            payload["xyzrenderPreset"] = xyzrenderPreset
            payload["xyzrenderPresetOptions"] = BurreteXyzrenderPreset.pickerOptions.map { ["value": $0.0, "label": $0.1] }
            if let xyzrenderControls { payload["xyzrenderControls"] = xyzrenderControls }
        }
        if let externalArtifact {
            var artifactPayload: [String: Any] = [
                "path": externalArtifact.relativePath,
                "inlineSvg": externalArtifact.inlineSvg,
                "type": externalArtifact.outputType,
                "renderer": "xyzrender",
                "preset": externalArtifact.preset,
                "configArgument": externalArtifact.configArgument,
                "orientationRef": externalArtifact.usedOrientationRef,
                "cacheKey": externalArtifact.cacheKey,
                "cacheHit": externalArtifact.cacheHit,
                "cacheMiss": !externalArtifact.cacheHit,
                "elapsedMs": externalArtifact.elapsedMs,
                "log": externalArtifact.log
            ]
            if let surfaceMode = externalArtifact.surfaceMode { artifactPayload["surfaceMode"] = surfaceMode }
            payload["externalArtifact"] = artifactPayload
            payload["xyzrenderPreset"] = externalArtifact.preset
        }
        if let externalStatus { payload["externalRendererStatus"] = externalStatus }
        let jsonData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: jsonData, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
    }

    private static func gridInlineHTML(title: String, preferences: PreviewPreferences) -> String {
        let safeTitle = escapeHTML(title)
        let backgroundClass = preferences.resolvedTransparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="Content-Security-Policy" content="\(gridRuntimeCSP)" />
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
        <body class="\(backgroundClass) burette-quicklook-host">
          <div id="app"></div>
          <div id="status">Loading molecule grid...</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteGridMode = true;
            window.BurreteDebug = \(showDebugOverlay ? "true" : "false");
          </script>
          <script src="preview-config.js"></script>
          <script src="preview-grid-records.js"></script>
          <script src="preview-rdkit-wasm.js"></script>
          <script src="../assets/rdkit/RDKit_minimal.js"></script>
          <script src="../assets/grid-ui.js"></script>
          <script src="../assets/grid-viewer.js"></script>
        </body>
        </html>
        """
    }

    private static func defaultCubeXyzrenderInput(fileURL: URL, data: Data, fileExtension: String) -> DefaultCubeXyzrenderInput? {
        guard ["cub", "cube"].contains(fileExtension.lowercased()) else { return nil }
        let text = decodeText(data)
        let descriptor = cubeDescriptor(text: text, fileURL: fileURL)
        var inputData = data
        var sourceFilename = fileURL.lastPathComponent
        let controls: [String: Any]
        let surfaceMode: String?
        if descriptor.contains("electrostatic potential") || descriptor.contains("_esp") {
            if let densityURL = pairedDensityCubeURL(fileURL), let densityData = try? Data(contentsOf: densityURL), !densityData.isEmpty {
                inputData = densityData
                sourceFilename = densityURL.lastPathComponent
                controls = [
                    "extraArguments": [
                        "--esp",
                        quoteCommandToken(fileURL.path),
                        "--cbar",
                        "--opacity",
                        "0.5",
                        "--surface-style",
                        "solid"
                    ].joined(separator: " ")
                ]
            } else {
                controls = ["fieldMode": "esp", "fieldOpacity": 0.5, "fieldSurfaceStyle": "solid"]
            }
            surfaceMode = "esp"
        } else if descriptor.contains("molecular orbital") || descriptor.contains("_homo") || descriptor.contains("_lumo") {
            controls = ["fieldMode": "mo", "fieldOpacity": 0.62, "fieldSurfaceStyle": "solid"]
            surfaceMode = "mo"
        } else if isNCISurfaceCubeDescriptor(descriptor) {
            if let fieldURL = pairedNCIFieldCubeURL(fileURL), let fieldData = try? Data(contentsOf: fieldURL), !fieldData.isEmpty {
                inputData = fieldData
                sourceFilename = fieldURL.lastPathComponent
                controls = [
                    "extraArguments": cubeSurfaceArguments([
                        "--nci-surf",
                        quoteCommandToken(fileURL.path)
                    ] + nciIsoArguments(for: fileURL) + [
                        "--opacity",
                        "0.45",
                        "--surface-style",
                        "solid"
                    ])
                ]
                surfaceMode = "nci"
            } else {
                controls = ["fieldMode": "density", "fieldIso": 0.3, "fieldOpacity": 0.45, "fieldSurfaceStyle": "solid"]
                surfaceMode = "density"
            }
        } else if descriptor.contains("sl2r"), let surfaceURL = pairedNCISurfaceCubeURL(fileURL) {
            controls = [
                "extraArguments": cubeSurfaceArguments([
                    "--nci-surf",
                    quoteCommandToken(surfaceURL.path)
                ] + nciIsoArguments(for: surfaceURL) + [
                    "--opacity",
                    "0.45",
                    "--surface-style",
                    "solid"
                ])
            ]
            surfaceMode = "nci"
        } else if let surfaceURL = pairedNCISurfaceCubeURL(fileURL) {
            controls = [
                "extraArguments": cubeSurfaceArguments([
                    "--nci-surf",
                    quoteCommandToken(surfaceURL.path)
                ] + nciIsoArguments(for: surfaceURL) + [
                    "--opacity",
                    "0.45",
                    "--surface-style",
                    "solid"
                ])
            ]
            surfaceMode = "nci"
        } else {
            controls = ["fieldMode": "density", "fieldOpacity": 0.45, "fieldSurfaceStyle": "solid"]
            surfaceMode = "density"
        }
        return DefaultCubeXyzrenderInput(data: inputData, sourceFilename: sourceFilename, controls: controls, surfaceMode: surfaceMode)
    }

    private static func cubeSurfaceArguments(_ values: [String]) -> String {
        values.joined(separator: " ")
    }

    private static func cubeDescriptor(text: String, fileURL: URL) -> String {
        var descriptor = fileURL.lastPathComponent.lowercased()
        for line in text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).prefix(2) {
            descriptor += "\n\(line.lowercased())"
        }
        return descriptor
    }

    private static func isNCISurfaceCubeDescriptor(_ descriptor: String) -> Bool {
        descriptor.contains("reduced density gradient") ||
            descriptor.contains("rdg") ||
            descriptor.contains("_grad") ||
            descriptor.contains("-grad") ||
            descriptor.contains("_dg_") ||
            descriptor.contains("-dg_") ||
            descriptor.contains("_dg-") ||
            descriptor.contains("-dg-")
    }

    private static func pairedDensityCubeURL(_ fileURL: URL) -> URL? {
        pairedCubeURL(fileURL, replacements: [
            ("_esp.cube", "_dens.cube"),
            ("_esp.cube", "_density.cube"),
            ("-esp.cube", "-dens.cube"),
            ("-esp.cube", "-density.cube"),
            ("_esp.cub", "_dens.cub"),
            ("_esp.cub", "_density.cub"),
            ("-esp.cub", "-dens.cub"),
            ("-esp.cub", "-density.cub")
        ])
    }

    private static func pairedNCIFieldCubeURL(_ fileURL: URL) -> URL? {
        pairedCubeURL(fileURL, replacements: [
            ("_grad.cube", "_dens.cube"),
            ("_grad.cube", "_density.cube"),
            ("-grad.cube", "-dens.cube"),
            ("-grad.cube", "-density.cube"),
            ("_grad.cub", "_dens.cub"),
            ("_grad.cub", "_density.cub"),
            ("-grad.cub", "-dens.cub"),
            ("-grad.cub", "-density.cub"),
            ("_dg_inter.cub", "_sl2r.cub"),
            ("_dg_intra.cub", "_sl2r.cub"),
            ("-dg_inter.cub", "-sl2r.cub"),
            ("-dg_intra.cub", "-sl2r.cub"),
            ("_dg_inter.cube", "_sl2r.cube"),
            ("_dg_intra.cube", "_sl2r.cube"),
            ("-dg_inter.cube", "-sl2r.cube"),
            ("-dg_intra.cube", "-sl2r.cube")
        ])
    }

    private static func pairedNCISurfaceCubeURL(_ fileURL: URL) -> URL? {
        pairedCubeURL(fileURL, replacements: [
            ("_dens.cube", "_grad.cube"),
            ("_density.cube", "_grad.cube"),
            ("-dens.cube", "-grad.cube"),
            ("-density.cube", "-grad.cube"),
            ("_dens.cub", "_grad.cub"),
            ("_density.cub", "_grad.cub"),
            ("-dens.cub", "-grad.cub"),
            ("-density.cub", "-grad.cub"),
            ("_sl2r.cub", "_dg_inter.cub"),
            ("_sl2r.cub", "_dg_intra.cub"),
            ("-sl2r.cub", "-dg_inter.cub"),
            ("-sl2r.cub", "-dg_intra.cub"),
            ("_sl2r.cube", "_dg_inter.cube"),
            ("_sl2r.cube", "_dg_intra.cube"),
            ("-sl2r.cube", "-dg_inter.cube"),
            ("-sl2r.cube", "-dg_intra.cube")
        ])
    }

    private static func pairedCubeURL(_ fileURL: URL, replacements: [(String, String)]) -> URL? {
        let name = fileURL.lastPathComponent
        let lower = name.lowercased()
        for (from, to) in replacements where lower.hasSuffix(from) {
            let prefix = String(name.prefix(name.count - from.count))
            let candidate = fileURL.deletingLastPathComponent().appendingPathComponent(prefix + to)
            if candidate != fileURL && FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    private static func nciIsoArguments(for url: URL) -> [String] {
        let name = url.deletingPathExtension().lastPathComponent.lowercased()
        if name.contains("dg_intra") || name.contains("dg-intra") { return ["--iso", "0.2"] }
        if name.contains("dg_inter") || name.contains("dg-inter") { return ["--iso", "0.005"] }
        return ["--iso", "0.3"]
    }

    private static func quoteCommandToken(_ value: String) -> String {
        if value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "/._-+=:".contains($0)) }) {
            return value
        }
        return "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
    }

    private static func fepGraphMLPreview(from data: Data) throws -> FepGraphMLPreview {
        let document = try XMLDocument(data: data, options: [])
        let keys = try graphMLKeys(in: document)
        guard let moldictKey = graphMLKeyID(keys, target: "node", name: "moldict") else {
            throw PreviewError.unsupportedStructureFile("GraphML is missing node moldict data")
        }
        let annotationsKey = graphMLKeyID(keys, target: "edge", name: "annotations")
        let nodeElements = try document.nodes(forXPath: "//*[local-name()='node']").compactMap { $0 as? XMLElement }
        let edgeElements = try document.nodes(forXPath: "//*[local-name()='edge']").compactMap { $0 as? XMLElement }
        guard !nodeElements.isEmpty else {
            throw PreviewError.emptyStructureFile("GraphML network has no ligand nodes")
        }

        let nodeCount = max(nodeElements.count, 1)
        let nodes = try nodeElements.enumerated().map { index, element in
            let id = element.attribute(forName: "id")?.stringValue ?? "mol\(index)"
            guard let text = graphMLDataText(in: element, key: moldictKey) else {
                throw PreviewError.unsupportedStructureFile("GraphML node \(id) is missing moldict data")
            }
            let moldict = try graphMLJSONObject(text)
            let props = moldict["molprops"] as? [String: Any] ?? [:]
            let atoms = moldict["atoms"] as? [Any] ?? []
            let bonds = moldict["bonds"] as? [Any] ?? []
            let label = graphMLString(props["ofe-name"]) ?? id
            let angle = nodeCount == 1 ? 0 : (Double(index) / Double(nodeCount)) * Double.pi * 2 - Double.pi / 2
            let radius = nodeCount == 1 ? 0 : 34.0
            let heavyAtoms = atoms.filter { graphMLAtomicNumber($0) != 1 }.count
            return FepGraphMLNode(
                id: id,
                label: label,
                atoms: atoms.count,
                heavyAtoms: heavyAtoms,
                bonds: bonds.count,
                dockingScore: graphMLDouble(props["docking score"]),
                molblock: graphMLMolblock(label: label, atoms: atoms, bonds: bonds),
                x: 50 + cos(angle) * radius,
                y: 50 + sin(angle) * radius
            )
        }

        let edges = try edgeElements.compactMap { element -> FepGraphMLEdge? in
            guard let source = element.attribute(forName: "source")?.stringValue,
                  let target = element.attribute(forName: "target")?.stringValue,
                  !source.isEmpty,
                  !target.isEmpty else {
                return nil
            }
            let annotations = try annotationsKey.flatMap { key -> [String: Any]? in
                guard let text = graphMLDataText(in: element, key: key) else { return nil }
                return try graphMLJSONObject(text)
            } ?? [:]
            return FepGraphMLEdge(source: source, target: target, score: graphMLDouble(annotations["score"]))
        }

        return layoutFepGraphMLPreview(FepGraphMLPreview(nodes: nodes, edges: edges))
    }

    private static func layoutFepGraphMLPreview(_ graph: FepGraphMLPreview) -> FepGraphMLPreview {
        guard graph.nodes.count > 1 else { return graph }
        var degree = Dictionary(uniqueKeysWithValues: graph.nodes.map { ($0.id, 0) })
        for edge in graph.edges {
            degree[edge.source] = (degree[edge.source] ?? 0) + 1
            degree[edge.target] = (degree[edge.target] ?? 0) + 1
        }
        guard let center = graph.nodes.max(by: { (degree[$0.id] ?? 0) < (degree[$1.id] ?? 0) }),
              (degree[center.id] ?? 0) >= max(2, graph.nodes.count - 1) else {
            return graph
        }
        let leaves = graph.nodes
            .filter { $0.id != center.id }
            .sorted { $0.id.localizedStandardCompare($1.id) == .orderedAscending }
        let compactSlots: [(x: Double, y: Double)] = [
            (25, 20),
            (75, 20),
            (75, 80),
            (25, 80)
        ]
        let positionedNodes = graph.nodes.map { node -> FepGraphMLNode in
            if node.id == center.id {
                return graphMLNode(node, x: 50, y: 50)
            }
            let index = leaves.firstIndex { $0.id == node.id } ?? 0
            if leaves.count <= compactSlots.count {
                let slot = compactSlots[index]
                return graphMLNode(node, x: slot.x, y: slot.y)
            }
            let angle = (Double(index) / Double(max(leaves.count, 1))) * Double.pi * 2 - Double.pi / 2
            return graphMLNode(node, x: 50 + cos(angle) * 34, y: 50 + sin(angle) * 32)
        }
        return FepGraphMLPreview(nodes: positionedNodes, edges: graph.edges)
    }

    private static func graphMLNode(_ node: FepGraphMLNode, x: Double, y: Double) -> FepGraphMLNode {
        FepGraphMLNode(
            id: node.id,
            label: node.label,
            atoms: node.atoms,
            heavyAtoms: node.heavyAtoms,
            bonds: node.bonds,
            dockingScore: node.dockingScore,
            molblock: node.molblock,
            x: x,
            y: y
        )
    }

    private static func graphMLKeys(in document: XMLDocument) throws -> [String: (target: String, name: String)] {
        let elements = try document.nodes(forXPath: "//*[local-name()='key']").compactMap { $0 as? XMLElement }
        var keys: [String: (target: String, name: String)] = [:]
        for element in elements {
            guard let id = element.attribute(forName: "id")?.stringValue,
                  let name = element.attribute(forName: "attr.name")?.stringValue else {
                continue
            }
            keys[id] = (element.attribute(forName: "for")?.stringValue ?? "all", name)
        }
        return keys
    }

    private static func graphMLKeyID(_ keys: [String: (target: String, name: String)], target: String, name: String) -> String? {
        keys.first { _, value in
            (value.target == target || value.target == "all") && value.name == name
        }?.key
    }

    private static func graphMLDataText(in element: XMLElement, key: String) -> String? {
        for child in element.children ?? [] {
            guard let childElement = child as? XMLElement,
                  childElement.localName == "data",
                  childElement.attribute(forName: "key")?.stringValue == key else {
                continue
            }
            let text = childElement.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            return text?.isEmpty == false ? text : nil
        }
        return nil
    }

    private static func graphMLJSONObject(_ text: String) throws -> [String: Any] {
        let data = Data(text.utf8)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PreviewError.unsupportedStructureFile("GraphML data payload is not a JSON object")
        }
        return object
    }

    private static func graphMLAtomicNumber(_ atom: Any) -> Int {
        guard let values = atom as? [Any], let first = values.first else { return 0 }
        return graphMLInt(first) ?? 0
    }

    private static func graphMLInt(_ value: Any) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? NSNumber { return value.intValue }
        return nil
    }

    private static func graphMLDouble(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }

    private static func graphMLMolblock(label: String, atoms: [Any], bonds: [Any]) -> String {
        var heavyIndexByAtom: [Int: Int] = [:]
        var atomLines: [String] = []
        for (atomIndex, atom) in atoms.enumerated() {
            let atomicNumber = graphMLAtomicNumber(atom)
            if atomicNumber == 1 { continue }
            heavyIndexByAtom[atomIndex] = atomLines.count + 1
            atomLines.append("\(molCoord(0))\(molCoord(0))\(molCoord(0)) \(graphMLAtomSymbol(atomicNumber).padding(toLength: 3, withPad: " ", startingAt: 0)) 0  0  0  0  0  0  0  0  0  0  0  0")
        }

        let aromaticBondTypes = graphMLKekuleAromaticBondTypes(atoms: atoms, bonds: bonds)
        var bondLines: [String] = []
        for (bondIndex, bond) in bonds.enumerated() {
            let indexes = graphMLBondAtomIndexes(bond)
            guard let left = indexes.left,
                  let right = indexes.right,
                  let from = heavyIndexByAtom[left],
                  let to = heavyIndexByAtom[right] else {
                continue
            }
            let bondType = aromaticBondTypes[bondIndex] ?? graphMLMolBondType(bond)
            bondLines.append("\(String(format: "%3d", from))\(String(format: "%3d", to))\(String(format: "%3d", bondType))  0  0  0  0")
        }

        return ([
            String(label.prefix(80)),
            "Burrete FEP GraphML",
            "",
            "\(String(format: "%3d", atomLines.count))\(String(format: "%3d", bondLines.count))  0  0  0  0            999 V2000"
        ] + atomLines + bondLines + ["M  END", ""]).joined(separator: "\n")
    }

    private static func graphMLMolblocksJSON(_ nodes: [FepGraphMLNode]) -> String {
        let payload = nodes.map { ["id": $0.id, "molblock": $0.molblock] }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return json
    }

    private static func graphMLBondAtomIndexes(_ bond: Any) -> (left: Int?, right: Int?) {
        guard let values = bond as? [Any], values.count >= 2 else { return (nil, nil) }
        return (graphMLInt(values[0]), graphMLInt(values[1]))
    }

    private static func graphMLMolBondType(_ bond: Any) -> Int {
        guard let values = bond as? [Any], values.count >= 3 else { return 1 }
        let value = graphMLInt(values[2]) ?? 1
        if value == 12 { return 4 }
        return [1, 2, 3, 4].contains(value) ? value : 1
    }

    private static func graphMLKekuleAromaticBondTypes(atoms: [Any], bonds: [Any]) -> [Int: Int] {
        let aromaticEdges = bonds.enumerated().compactMap { bondIndex, bond -> (bondIndex: Int, left: Int, right: Int)? in
            guard graphMLBondIsAromatic(bond) else { return nil }
            let indexes = graphMLBondAtomIndexes(bond)
            guard let left = indexes.left,
                  let right = indexes.right,
                  graphMLAtomIsAromatic(graphMLAtom(atoms, at: left)),
                  graphMLAtomIsAromatic(graphMLAtom(atoms, at: right)) else {
                return nil
            }
            return (bondIndex, left, right)
        }
        var result: [Int: Int] = [:]
        var usedAtoms = Set<Int>()
        for edge in aromaticEdges {
            if usedAtoms.contains(edge.left) || usedAtoms.contains(edge.right) {
                result[edge.bondIndex] = 1
                continue
            }
            result[edge.bondIndex] = 2
            usedAtoms.insert(edge.left)
            usedAtoms.insert(edge.right)
        }
        for edge in aromaticEdges where result[edge.bondIndex] == nil {
            result[edge.bondIndex] = 1
        }
        return result
    }

    private static func graphMLBondIsAromatic(_ bond: Any) -> Bool {
        guard let values = bond as? [Any], values.count >= 3 else { return false }
        return graphMLInt(values[2]) == 12
    }

    private static func graphMLAtomIsAromatic(_ atom: Any?) -> Bool {
        guard let values = atom as? [Any], values.count >= 4 else { return false }
        return (values[3] as? Bool) == true
    }

    private static func graphMLAtom(_ atoms: [Any], at index: Int) -> Any? {
        guard index >= 0, index < atoms.count else { return nil }
        return atoms[index]
    }

    private static func graphMLAtomSymbol(_ atomicNumber: Int) -> String {
        switch atomicNumber {
        case 1: return "H"
        case 5: return "B"
        case 6: return "C"
        case 7: return "N"
        case 8: return "O"
        case 9: return "F"
        case 15: return "P"
        case 16: return "S"
        case 17: return "Cl"
        case 35: return "Br"
        case 53: return "I"
        default: return "C"
        }
    }

    private static func molCoord(_ value: Double) -> String {
        String(format: "%10.4f", value)
    }

    private static func graphMLString(_ value: Any?) -> String? {
        if let value = value as? String, !value.isEmpty { return value }
        return nil
    }

    private static func fepGraphMLInlineHTML(title: String, graph: FepGraphMLPreview, requestID: String) -> String {
        let nodeByID = Dictionary(uniqueKeysWithValues: graph.nodes.map { ($0.id, $0) })
        let molblocksJSON = escapeScriptEnd(graphMLMolblocksJSON(graph.nodes))
        let denseMode = graph.nodes.count > 12
        let edges = graph.edges.compactMap { edge -> String? in
            guard let source = nodeByID[edge.source], let target = nodeByID[edge.target] else { return nil }
            let score = edge.score.map { "score: " + String(format: "%.3f", $0) } ?? ""
            let labelX = (source.x + target.x) / 2
            let labelY = (source.y + target.y) / 2
            if denseMode || score.isEmpty {
                return """
                <line x1="\(source.x)" y1="\(source.y)" x2="\(target.x)" y2="\(target.y)" />
                """
            }
            return """
            <line x1="\(source.x)" y1="\(source.y)" x2="\(target.x)" y2="\(target.y)" />
            <text class="edge-score" x="\(labelX)" y="\(labelY)">\(escapeHTML(score))</text>
            """
        }.joined(separator: "\n")
        let nodes = graph.nodes.enumerated().map { index, node -> String in
            if denseMode {
                let label = graph.nodes.count <= 24 || index < 8 ? escapeHTML(shortGraphMLLabel(node.label)) : ""
                let score = node.dockingScore.map { String(format: "%.2f", $0) } ?? "n/a"
                return """
                <article class="node-dot" style="left:\(node.x)%;top:\(node.y)%" title="\(escapeHTML(node.label))">
                  <i></i>
                  <span>\(label)</span>
                  <em>\(escapeHTML(score))</em>
                </article>
                """
            }
            let score = node.dockingScore.map { String(format: "%.2f", $0) } ?? "n/a"
            return """
            <article class="node-card" style="left:\(node.x)%;top:\(node.y)%">
              <strong>\(escapeHTML(shortGraphMLLabel(node.label)))</strong>
              <div class="node-molecule" data-node-id="\(escapeHTML(node.id))"><span>Rendering molecule</span></div>
              <footer>
                <span>\(node.heavyAtoms)/\(node.atoms) atoms</span>
                <span>\(node.bonds) bonds - score \(escapeHTML(score))</span>
              </footer>
            </article>
            """
        }.joined(separator: "\n")
        let scoreValues = graph.edges.compactMap { $0.score }
        let scoreSummary = scoreValues.isEmpty
            ? "scores unavailable"
            : "\(scoreValues.count) scored edges, min \(String(format: "%.2f", scoreValues.min() ?? 0)), max \(String(format: "%.2f", scoreValues.max() ?? 0))"
        let bodyClass = denseMode ? "dense-network" : "card-network"
        let safeTitle = escapeHTML(title)
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="Content-Security-Policy" content="\(gridRuntimeCSP)" />
          <title>Burrete FEP Network - \(safeTitle)</title>
          <style>
            html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f8fafc;color:#172033}
            body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
            .wrap{position:relative;width:100%;height:100%;box-sizing:border-box;background:#f8fafc}
            header{position:absolute;z-index:3;left:0;right:0;top:0;min-height:58px;box-sizing:border-box;padding:10px 14px;display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid rgba(23,32,51,.12);background:rgba(248,250,252,.94)}
            h1{font-size:13px;line-height:1.2;margin:0;font-weight:600;max-width:62%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            h1 span{display:block;color:#64748b;font-size:11px;font-weight:500;text-transform:uppercase}
            .meta{color:#475569;text-align:right;line-height:1.35}
            .meta small{display:block;color:#64748b}
            .stage{position:absolute;inset:58px 0 0;background:linear-gradient(rgba(100,116,139,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(100,116,139,.10) 1px,transparent 1px),#f8fafc;background-size:32px 32px}
            svg{position:absolute;inset:0;width:100%;height:100%}
            line{stroke:#af52de;stroke-width:.42;stroke-linecap:round;stroke-opacity:.62}
            .edge-score{font-size:3px;fill:#334155;paint-order:stroke;stroke:#f8fafc;stroke-width:1.1px}
            .node-card{position:absolute;z-index:2;width:clamp(142px,24vw,188px);min-height:126px;transform:translate(-50%,-50%);box-sizing:border-box;padding:9px 10px;border:1px solid rgba(175,82,222,.22);border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 8px 22px rgba(15,23,42,.12)}
            .node-card strong{display:block;font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .node-card footer{display:grid;gap:3px;margin-top:4px}
            .node-card span{display:block;color:#475569;font-size:10px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .node-molecule{height:76px;margin-top:5px;border-radius:6px;background:rgba(248,250,252,.86);display:grid;place-items:center;overflow:hidden}
            .node-molecule svg{position:static;width:100%;height:100%;display:block}
            .node-molecule span{margin:0;color:#94a3b8;font-size:10px}
            .node-dot{position:absolute;z-index:2;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:3px;color:#172033}
            .node-dot i{display:block;width:12px;height:12px;border-radius:50%;box-sizing:border-box;border:2px solid #f8fafc;background:#af52de;box-shadow:0 0 0 1px rgba(175,82,222,.26),0 5px 12px rgba(15,23,42,.18)}
            .node-dot span{display:block;max-width:84px;padding:2px 5px;border-radius:6px;background:rgba(255,255,255,.86);font-size:10px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .node-dot em{display:none}
            .dense-network line{stroke-width:.34;stroke-opacity:.5}
            .dense-network .stage{background-size:28px 28px}
          </style>
        </head>
        <body>
          <main class="wrap \(bodyClass)">
            <header>
              <h1><span>FEP Network</span>\(safeTitle)</h1>
              <div class="meta">\(graph.nodes.count) ligands - \(graph.edges.count) transformations<small>\(escapeHTML(scoreSummary))</small></div>
            </header>
            <section class="stage" aria-label="FEP ligand network">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">\(edges)</svg>
              \(nodes)
            </section>
          </main>
          <script src="preview-rdkit-wasm.js"></script>
          <script src="../assets/rdkit/RDKit_minimal.js"></script>
          <script>
            const fepNodeMolblocks = \(molblocksJSON);
            function base64ToBytes(value) {
              const binary = atob(String(value || ''));
              const bytes = new Uint8Array(binary.length);
              for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
              return bytes;
            }
            function sanitizeSVG(svg) {
              const template = document.createElement('template');
              template.innerHTML = String(svg || '');
              template.content.querySelectorAll('script,foreignObject').forEach(node => node.remove());
              template.content.querySelectorAll('*').forEach(node => {
                for (const attribute of Array.from(node.attributes || [])) {
                  if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
                }
              });
              return template.content.querySelector('svg');
            }
            async function renderFepMolecules() {
              if (typeof window.initRDKitModule !== 'function') throw new Error('RDKit_minimal.js is missing');
              const options = { locateFile: () => '../assets/rdkit/RDKit_minimal.wasm' };
              if (window.BurreteRDKitWasmBase64) {
                options.wasmBinary = base64ToBytes(window.BurreteRDKitWasmBase64);
                window.BurreteRDKitWasmBase64 = '';
              }
              const rdkit = await window.initRDKitModule(options);
              let rendered = 0;
              for (const entry of fepNodeMolblocks) {
                const target = Array.from(document.querySelectorAll('.node-molecule')).find(node => node.getAttribute('data-node-id') === String(entry.id));
                if (!target) continue;
                let mol = null;
                try {
                  mol = rdkit.get_mol(String(entry.molblock || ''));
                  if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) throw new Error('invalid molecule');
                  try { mol.set_new_coords?.(); } catch (_) {}
                  const svg = sanitizeSVG(mol.get_svg(190, 110));
                  if (!svg) throw new Error('empty drawing');
                  target.replaceChildren(svg);
                  rendered += 1;
                } catch (error) {
                  const span = document.createElement('span');
                  span.textContent = error?.message || 'Molecule unavailable';
                  target.replaceChildren(span);
                } finally {
                  try { mol?.delete?.(); } catch (_) {}
                }
              }
              return rendered;
            }
            window.addEventListener('load', async function () {
              let rdkitImages = 0;
              try { rdkitImages = await renderFepMolecules(); } catch (_) {}
              try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage({
                type: 'ready',
                message: 'ready',
                requestID: '\(requestID)',
                mode: 'fep-graphml',
                renderer: 'fep-graphml',
                rowCount: \(graph.nodes.count),
                renderedCount: \(graph.edges.count),
                edgeCount: \(graph.edges.count),
                rdkitImages: rdkitImages,
                moleculesWithAtoms: \(graph.nodes.filter { $0.atoms > 0 }.count),
                atomCount: \(graph.nodes.reduce(0) { $0 + $1.atoms })
              }); } catch (_) {}
            });
          </script>
        </body>
        </html>
        """
    }

    private static func shortGraphMLLabel(_ label: String) -> String {
        let parts = label.split(separator: "_").filter { !$0.isEmpty }
        guard let last = parts.last else { return label }
        return String(last).isEmpty ? label : String(last)
    }

    private static func inlineHTML(title: String, preferences: PreviewPreferences, renderer: String) -> String {
        let safeTitle = escapeHTML(title)
        let backgroundClass = preferences.resolvedTransparentBackground ? "burette-transparent-background" : "burette-opaque-background"
        let csp = runtimeCSP(for: renderer)
        let initialStatus: String
        let rendererAssets: String
        let rdkitWasmAsset: String
        if renderer == "xyzrender-external" {
            initialStatus = "[web] HTML body created. Waiting for xyzrender artifact…"
            rendererAssets = ""
            rdkitWasmAsset = ""
        } else {
            initialStatus = "[web] HTML body created. Waiting for embedded data and Mol* script…"
            rdkitWasmAsset = """
              <script src="preview-rdkit-wasm.js"></script>
            """
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
          <meta http-equiv="Content-Security-Policy" content="\(csp)" />
          <title>Burrete - \(safeTitle)</title>
          <link rel="stylesheet" href="../assets/molstar.css" />
          <link rel="stylesheet" href="../assets/viewer-runtime.css" />
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
        <body class="\(backgroundClass) burette-quicklook-host">
          <div id="app"></div>
          <script src="../assets/viewer-shell.js"></script>
          <div id="status" class="hidden">\(initialStatus)</div>
          <script>
            window.BurreteInlineMode = true;
            window.BurreteDebug = \(showDebugOverlay ? "true" : "false");
            window.BurretePanelControlsVisible = \(preferences.showPanelControls ? "true" : "false");
            window.BurreteCacheBuster = String(Date.now());
          </script>
          \(rendererAssets)
          <script src="preview-config.js"></script>
          \(rdkitWasmAsset)
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

    private static func runtimeCSP(for renderer: String) -> String {
        if renderer == "xyzrender-external" { return externalArtifactRuntimeCSP }
        return molstarRuntimeCSP
    }

    private static func inlineTextArtifactHTML(
        title: String,
        fileExtension: String,
        byteCount: Int,
        content: String,
        requestID: String,
        renderer: String
    ) -> String {
        let safeTitle = escapeHTML(title)
        let safeExtension = escapeHTML(fileExtension)
        let safeContent = escapeHTML(content)
        let rendererJSON = jsonStringLiteral(renderer)
        let extensionJSON = jsonStringLiteral(fileExtension)
        let requestIDJSON = jsonStringLiteral(requestID)
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
          <title>Burrete - \(safeTitle)</title>
          <style>
            :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
            body { margin: 0; background: Canvas; color: CanvasText; }
            main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
            header { padding: 14px 18px 10px; border-bottom: 1px solid rgba(127, 127, 127, 0.24); }
            h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; letter-spacing: 0; }
            .meta { display: flex; gap: 10px; color: #6b7280; font-size: 12px; }
            @media (prefers-color-scheme: dark) { .meta { color: #9ca3af; } }
            pre { margin: 0; padding: 16px 18px 28px; overflow: auto; white-space: pre; font: 12px/1.45 "SF Mono", Menlo, Consolas, monospace; tab-size: 2; }
          </style>
        </head>
        <body>
          <main>
            <header>
              <h1>\(safeTitle)</h1>
              <div class="meta"><span>.\(safeExtension)</span><span>\(byteCount) bytes</span></div>
            </header>
            <pre>\(safeContent)</pre>
          </main>
          <script>
            window.addEventListener('load', function () {
              try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burrete.postMessage({ type: 'ready', message: 'ready', requestID: \(requestIDJSON), mode: 'text', renderer: \(rendererJSON), sourceExtension: \(extensionJSON) }); } catch (_) {}
            });
          </script>
        </body>
        </html>
        """
    }

    private static func textArtifactConfigJSON(
        title: String,
        fileExtension: String,
        byteCount: Int,
        requestID: String,
        renderer: String = "text"
    ) throws -> String {
        let payload: [String: Any] = [
            "label": title,
            "format": "text",
            "sourceExtension": fileExtension,
            "renderer": renderer,
            "byteCount": byteCount,
            "previewByteCount": byteCount,
            "quickLookBuild": "burrete-text-quicklook",
            "quickLookViewer": true,
            "previewRequestID": requestID,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: data, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
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
        let required = ["viewer.js", "burette-agent.js", "viewer-shell.js", "molstar.js", "molstar.css", "viewer-runtime.css"]
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
            "grid-ui.js",
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
                throw PreviewError.couldNotCreateRuntimePreview("Missing vendored molecule grid asset: \(name). Run bun install --ignore-scripts && bun run vendor:rdkit")
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

    private struct XYZPayload {
        let atomCount: Int?
        let frameCount: Int?
        let comment: String?
    }

    private static func makeXYZPayload(from data: Data) -> XYZPayload? {
        let text = decodeText(data).replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var start = 0
        while start < lines.count && lines[start].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { start += 1 }
        guard start < lines.count else { return nil }
        let firstToken = lines[start].trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").first
        guard let token = firstToken, let atomCount = Int(token), atomCount > 0 else { return nil }
        let frameCount = countXYZFrames(lines: lines, start: start)
        let comment = start + 1 < lines.count ? lines[start + 1] : nil
        return XYZPayload(atomCount: atomCount, frameCount: frameCount, comment: comment)
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

    private static func estimateTrajectoryFrameCount(
        fileExtension: String,
        sourceData: Data,
        previewData: Data,
        format: StructureFormat
    ) -> Int? {
        if format.molstarFormat == "xyz", !format.isBinary,
           let frameCount = makeXYZPayload(from: previewData)?.frameCount {
            return frameCount
        }

        let lowercasedExtension = fileExtension.lowercased()
        if ["lammpstrj", "dump", "pos"].contains(lowercasedExtension) {
            let lines = normalizedTextLines(from: sourceData)
            let frameCount = PreviewStructureTextConverter.lammpsDumpFrameCount(lines)
            return frameCount > 0 ? frameCount : nil
        }

        if ["pdb", "ent", "pdbqt", "pqr", "xpdb"].contains(lowercasedExtension) || format.molstarFormat == "pdb" {
            let frameCount = pdbModelFrameCount(normalizedTextLines(from: previewData))
            return frameCount > 0 ? frameCount : nil
        }

        return nil
    }

    private static func normalizedTextLines(from data: Data) -> [String] {
        decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
    }

    private static func pdbModelFrameCount(_ lines: [String]) -> Int {
        let models = lines.reduce(0) { count, line in
            count + (line.trimmingCharacters(in: .whitespaces).hasPrefix("MODEL") ? 1 : 0)
        }
        return models > 0 ? models : 1
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }

    private static func textArtifactPreviewContent(
        title: String,
        fileExtension: String,
        byteCount: Int,
        data: Data
    ) -> String {
        if ["chk", "checkpoint"].contains(fileExtension.lowercased()), looksBinary(data) {
            return """
            \(title) is a binary OpenMM checkpoint artifact.

            Bytes: \(byteCount)

            Burrete shows metadata for binary checkpoints instead of rendering opaque bytes as text.
            """
        }
        return decodeText(data)
    }

    private static func shouldTrySpectrumPreview(fileExtension: String, data: Data, url: URL) -> Bool {
        let lowercasedExtension = fileExtension.lowercased()
        if ["ms", "magma", "mgf", "msp", "mzml", "mzxml"].contains(lowercasedExtension) { return true }
        if lowercasedExtension == "json" {
            return looksLikeSubformulaSpectrumJSON(data: data)
        }
        if ["csv", "tsv"].contains(lowercasedExtension) {
            return looksLikeTabularSpectrum(data: data, delimiter: lowercasedExtension == "tsv" ? "\t" : ",")
        }
        return false
    }

    private static func shouldUseSpectrumPreview(
        fileExtension: String,
        previewPlan: BurretePreviewPlan?,
        data: Data,
        url: URL
    ) -> Bool {
        if let previewPlan {
            return previewPlan.strategy == "custom" && previewPlan.renderer == "spectrum"
        }
        return shouldTrySpectrumPreview(fileExtension: fileExtension, data: data, url: url)
    }

    private static func looksLikeSubformulaSpectrumJSON(data: Data) -> Bool {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let table = root["output_tbl"] as? [String: Any]
        else { return false }
        let mzValues = numericArray(from: table["mz"] ?? table["mz_observed"])
        let intensityValues = numericArray(from: table["ms2_inten"] ?? table["inten"] ?? table["intensity"])
        return !mzValues.isEmpty && mzValues.count == intensityValues.count
    }

    private static func looksLikeTabularSpectrum(data: Data, delimiter: Character) -> Bool {
        let text = decodeText(Data(data.prefix(8192)))
        let rows = Array(text.split(whereSeparator: \.isNewline).prefix(12))
        guard let headerLine = rows.first else { return false }
        let headers = parseDelimitedLine(String(headerLine), delimiter: delimiter).map(normalizedColumnName)
        let mzHeaders = Set(["mz", "m_z", "m_over_z", "mass_to_charge", "masscharge"])
        let intensityHeaders = Set(["intensity", "inten", "relative_intensity", "rel_intensity", "ms2_inten", "abundance"])
        guard
            let mzIndex = headers.firstIndex(where: { mzHeaders.contains($0) }),
            let intensityIndex = headers.firstIndex(where: { intensityHeaders.contains($0) })
        else { return false }
        return rows.dropFirst().contains { row in
            let values = parseDelimitedLine(String(row), delimiter: delimiter)
            guard values.indices.contains(mzIndex), values.indices.contains(intensityIndex) else { return false }
            return Double(values[mzIndex].trimmingCharacters(in: .whitespaces)) != nil
                && Double(values[intensityIndex].trimmingCharacters(in: .whitespaces)) != nil
        }
    }

    private struct QuickLookSpectrum: Encodable {
        let format: String
        let title: String
        let primary: QuickLookSpectrumDocument
        let metadata: [String: String]
    }

    private struct QuickLookSpectrumDocument: Encodable {
        let id: String
        let title: String
        let xLabel: String
        let yLabel: String
        let peaks: [QuickLookSpectrumPeak]
        let summary: [QuickLookSpectrumMetric]
        let topPeaks: [QuickLookSpectrumPeak]
        let fragmentFormulas: [String]
    }

    private struct QuickLookSpectrumPeak: Encodable {
        let x: Double
        let y: Double
        let label: String?
        let annotations: [String: String]
    }

    private struct QuickLookSpectrumMetric: Encodable {
        let label: String
        let value: String
    }

    private static func parseQuickLookSpectrum(
        title: String,
        fileExtension: String,
        content: String
    ) throws -> QuickLookSpectrum? {
        switch fileExtension.lowercased() {
        case "magma":
            return parseMagmaSpectrum(title: title, content: content)
        case "ms":
            return parseMsSpectrum(title: title, content: content)
        case "mgf":
            return parseMgfSpectrum(title: title, content: content)
        case "msp":
            return parseMspSpectrum(title: title, content: content)
        case "mzml":
            return parseMzmlSpectrum(title: title, content: content)
        case "mzxml":
            return parseMzxmlSpectrum(title: title, content: content)
        case "json":
            return try parseSubformulaSpectrum(title: title, content: content)
        case "csv":
            return parseDelimitedSpectrum(title: title, format: "CSV", content: content, delimiter: ",")
        case "tsv":
            return parseDelimitedSpectrum(title: title, format: "TSV", content: content, delimiter: "\t")
        default:
            return nil
        }
    }

    private static func parseMagmaSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        let lines = content.split(whereSeparator: \.isNewline).map(String.init)
        guard let headerLine = lines.first else { return nil }
        let headers = parseDelimitedLine(headerLine, delimiter: "\t").map(normalizedColumnName)
        guard
            let mzIndex = headers.firstIndex(of: "mz_observed"),
            let intensityIndex = headers.firstIndex(of: "inten")
        else { return nil }
        let correctedIndex = headers.firstIndex(of: "mz_corrected")
        let ppmIndex = headers.firstIndex(of: "ppm_diff")
        let formulaIndex = headers.firstIndex(of: "frag_base_form")
        let fragMassIndex = headers.firstIndex(of: "frag_mass")
        let hShiftIndex = headers.firstIndex(of: "frag_h_shift")

        let peaks = lines.dropFirst().compactMap { line -> QuickLookSpectrumPeak? in
            let values = parseDelimitedLine(line, delimiter: "\t")
            guard values.indices.contains(mzIndex), values.indices.contains(intensityIndex),
                  let mz = Double(values[mzIndex].trimmingCharacters(in: .whitespaces)),
                  let intensity = Double(values[intensityIndex].trimmingCharacters(in: .whitespaces)) else {
                return nil
            }
            var annotations: [String: String] = [:]
            if let correctedIndex, values.indices.contains(correctedIndex) { annotations["corrected m/z"] = values[correctedIndex] }
            if let ppmIndex, values.indices.contains(ppmIndex) { annotations["ppm diff"] = values[ppmIndex] }
            if let fragMassIndex, values.indices.contains(fragMassIndex) { annotations["frag mass"] = values[fragMassIndex] }
            if let hShiftIndex, values.indices.contains(hShiftIndex) { annotations["h shift"] = values[hShiftIndex] }
            let formula = formulaIndex.flatMap { values.indices.contains($0) ? values[$0] : nil }?.trimmingCharacters(in: .whitespacesAndNewlines)
            return QuickLookSpectrumPeak(x: mz, y: intensity, label: formula?.isEmpty == false ? formula : nil, annotations: annotations)
        }
        guard !peaks.isEmpty else { return nil }
        return makeSpectrum(title: title, format: "MAGMA", peaks: peaks, metadata: ["annotation": "MAGMa fragments"])
    }

    private static func parseMsSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        var metadata: [String: String] = [:]
        var inPeaks = false
        var peaks: [QuickLookSpectrumPeak] = []
        for rawLine in content.split(whereSeparator: \.isNewline).map(String.init) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            if line.hasPrefix(">") {
                let value = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
                let parts = value.split(maxSplits: 1, whereSeparator: \.isWhitespace).map(String.init)
                if parts.count == 2 { metadata[parts[0]] = parts[1] }
                inPeaks = value.lowercased().contains("ms2peaks")
                continue
            }
            guard inPeaks, let pair = numericPair(from: line) else { continue }
            peaks.append(QuickLookSpectrumPeak(x: pair.0, y: pair.1, label: nil, annotations: [:]))
        }
        guard !peaks.isEmpty else { return nil }
        return makeSpectrum(title: title, format: "MS", peaks: peaks, metadata: metadata)
    }

    private static func parseMgfSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        var metadata: [String: String] = [:]
        var peaks: [QuickLookSpectrumPeak] = []
        for rawLine in content.split(whereSeparator: \.isNewline).map(String.init) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.uppercased() == "BEGIN IONS" || line.uppercased() == "END IONS" { continue }
            if let equals = line.firstIndex(of: "=") {
                metadata[String(line[..<equals])] = String(line[line.index(after: equals)...])
            } else if let pair = numericPair(from: line) {
                peaks.append(QuickLookSpectrumPeak(x: pair.0, y: pair.1, label: nil, annotations: [:]))
            }
        }
        guard !peaks.isEmpty else { return nil }
        return makeSpectrum(title: title, format: "MGF", peaks: peaks, metadata: metadata)
    }

    private static func parseMspSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        var metadata: [String: String] = [:]
        var peaks: [QuickLookSpectrumPeak] = []
        for rawLine in content.split(whereSeparator: \.isNewline).map(String.init) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            if let colon = line.firstIndex(of: ":") {
                metadata[String(line[..<colon]).trimmingCharacters(in: .whitespaces)] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            } else if let pair = numericPair(from: line) {
                peaks.append(QuickLookSpectrumPeak(x: pair.0, y: pair.1, label: nil, annotations: [:]))
            }
        }
        guard !peaks.isEmpty else { return nil }
        return makeSpectrum(title: title, format: "MSP", peaks: peaks, metadata: metadata)
    }

    private static func parseMzmlSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        guard let document = try? XMLDocument(xmlString: content, options: []) else { return nil }
        let spectrumElements = (try? document.nodes(forXPath: "//*[local-name()='spectrum']").compactMap { $0 as? XMLElement }) ?? []
        for (index, element) in spectrumElements.prefix(250).enumerated() {
            let arrays = (try? element.nodes(forXPath: ".//*[local-name()='binaryDataArray']").compactMap { $0 as? XMLElement }) ?? []
            let mzValues = decodeMzmlArray(arrays.first { xmlElementHasCV($0, accession: "MS:1000514") })
            let intensityValues = decodeMzmlArray(arrays.first { xmlElementHasCV($0, accession: "MS:1000515") })
            let peaks = zipSpectrumPeaks(mzValues, intensityValues)
            if !peaks.isEmpty {
                return makeSpectrum(
                    title: title,
                    format: "MZML",
                    peaks: peaks,
                    metadata: ["id": element.attribute(forName: "id")?.stringValue ?? "spectrum-\(index + 1)"]
                )
            }
            let fallbackPeaks = xmlPeakList(in: element)
            if !fallbackPeaks.isEmpty {
                return makeSpectrum(title: title, format: "MZML", peaks: fallbackPeaks, metadata: ["parser": "xml peak list"])
            }
        }
        return nil
    }

    private static func parseMzxmlSpectrum(title: String, content: String) -> QuickLookSpectrum? {
        guard let document = try? XMLDocument(xmlString: content, options: []) else { return nil }
        let scanElements = (try? document.nodes(forXPath: "//*[local-name()='scan']").compactMap { $0 as? XMLElement }) ?? []
        for (index, element) in scanElements.prefix(250).enumerated() {
            if let peaksElement = (try? element.nodes(forXPath: ".//*[local-name()='peaks']").first as? XMLElement),
               let text = peaksElement.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty,
               (peaksElement.attribute(forName: "compressionType")?.stringValue ?? "none").lowercased() == "none" {
                let precision = Int(peaksElement.attribute(forName: "precision")?.stringValue ?? "32") ?? 32
                let values = decodeBase64FloatArray(text, precision: precision, endian: "big")
                let mzValues = stride(from: 0, to: values.count, by: 2).map { values[$0] }
                let intensityValues = stride(from: 1, to: values.count, by: 2).map { values[$0] }
                let peaks = zipSpectrumPeaks(mzValues, intensityValues)
                if !peaks.isEmpty {
                    return makeSpectrum(
                        title: title,
                        format: "MZXML",
                        peaks: peaks,
                        metadata: ["scan": element.attribute(forName: "num")?.stringValue ?? "\(index + 1)"]
                    )
                }
            }
            let fallbackPeaks = xmlPeakList(in: element)
            if !fallbackPeaks.isEmpty {
                return makeSpectrum(title: title, format: "MZXML", peaks: fallbackPeaks, metadata: ["parser": "xml peak list"])
            }
        }
        return nil
    }

    private static func parseSubformulaSpectrum(title: String, content: String) throws -> QuickLookSpectrum? {
        guard
            let data = content.data(using: .utf8),
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let table = root["output_tbl"] as? [String: Any]
        else { return nil }
        let mzValues = numericArray(from: table["mz"] ?? table["mz_observed"])
        let intensityValues = numericArray(from: table["ms2_inten"] ?? table["inten"] ?? table["intensity"])
        guard !mzValues.isEmpty, mzValues.count == intensityValues.count else { return nil }
        let formulas = stringArray(from: table["formula"] ?? table["formulas"])
        let ions = stringArray(from: table["ions"] ?? table["ion"])
        let peaks = mzValues.enumerated().map { index, mz in
            var annotations: [String: String] = [:]
            if ions.indices.contains(index) { annotations["ion"] = ions[index] }
            let label = formulas.indices.contains(index) ? formulas[index] : nil
            return QuickLookSpectrumPeak(x: mz, y: intensityValues[index], label: label, annotations: annotations)
        }
        var metadata: [String: String] = [:]
        for key in ["cand_form", "cand_ion", "parentmass", "charge", "collision_energy", "smiles"] {
            if let value = root[key] {
                metadata[key] = String(describing: value)
            }
        }
        return makeSpectrum(title: title, format: "JSON", peaks: peaks, metadata: metadata)
    }

    private static func parseDelimitedSpectrum(
        title: String,
        format: String,
        content: String,
        delimiter: Character
    ) -> QuickLookSpectrum? {
        let rows = content.split(whereSeparator: \.isNewline).map(String.init)
        guard let headerLine = rows.first else { return nil }
        let headers = parseDelimitedLine(headerLine, delimiter: delimiter).map(normalizedColumnName)
        let mzNames = Set(["mz", "m_z", "m_over_z", "mass_to_charge", "masscharge"])
        let intensityNames = Set(["intensity", "inten", "relative_intensity", "rel_intensity", "ms2_inten", "abundance"])
        guard
            let mzIndex = headers.firstIndex(where: { mzNames.contains($0) }),
            let intensityIndex = headers.firstIndex(where: { intensityNames.contains($0) })
        else { return nil }
        let labelIndex = headers.firstIndex(where: { ["formula", "annotation", "label", "ion"].contains($0) })
        let peaks = rows.dropFirst().compactMap { row -> QuickLookSpectrumPeak? in
            let values = parseDelimitedLine(row, delimiter: delimiter)
            guard values.indices.contains(mzIndex), values.indices.contains(intensityIndex),
                  let mz = Double(values[mzIndex].trimmingCharacters(in: .whitespaces)),
                  let intensity = Double(values[intensityIndex].trimmingCharacters(in: .whitespaces)) else {
                return nil
            }
            let label = labelIndex.flatMap { values.indices.contains($0) ? values[$0] : nil }?.trimmingCharacters(in: .whitespacesAndNewlines)
            return QuickLookSpectrumPeak(x: mz, y: intensity, label: label?.isEmpty == false ? label : nil, annotations: [:])
        }
        guard !peaks.isEmpty else { return nil }
        return makeSpectrum(title: title, format: format, peaks: peaks, metadata: [:])
    }

    private static func makeSpectrum(
        title: String,
        format: String,
        peaks: [QuickLookSpectrumPeak],
        metadata: [String: String]
    ) -> QuickLookSpectrum {
        let normalizedPeaks = normalizeSpectrumPeaks(peaks)
        let annotatedCount = normalizedPeaks.filter { ($0.label?.isEmpty == false) || !$0.annotations.isEmpty }.count
        let sortedTopPeaks = normalizedPeaks.sorted { $0.y > $1.y }.prefix(8)
        let topFormulas = Array(NSOrderedSet(array: sortedTopPeaks.compactMap { $0.label }).compactMap { $0 as? String }).prefix(10)
        let mzValues = normalizedPeaks.map(\.x)
        let tic = peaks.reduce(0) { $0 + max(0, $1.y) }
        let basePeak = normalizedPeaks.max { $0.y < $1.y }
        let primary = QuickLookSpectrumDocument(
            id: "spectrum-1",
            title: title,
            xLabel: "m/z",
            yLabel: "Relative intensity",
            peaks: normalizedPeaks,
            summary: [
                QuickLookSpectrumMetric(label: "Base peak", value: basePeak.map { "\(formatNumber($0.x, decimals: 4)) · \(formatNumber($0.y, decimals: 4))" } ?? "n/a"),
                QuickLookSpectrumMetric(label: "m/z range", value: mzValues.min().flatMap { minMz in mzValues.max().map { "\(formatNumber(minMz, decimals: 1))-\(formatNumber($0, decimals: 1))" } } ?? "n/a"),
                QuickLookSpectrumMetric(label: "TIC", value: formatNumber(tic, decimals: 4)),
                QuickLookSpectrumMetric(label: "Annotated", value: "\(annotatedCount)/\(normalizedPeaks.count)")
            ],
            topPeaks: Array(sortedTopPeaks),
            fragmentFormulas: Array(topFormulas)
        )
        return QuickLookSpectrum(format: format, title: title, primary: primary, metadata: metadata)
    }

    private static func normalizeSpectrumPeaks(_ peaks: [QuickLookSpectrumPeak]) -> [QuickLookSpectrumPeak] {
        let maxIntensity = peaks.map(\.y).max() ?? 0
        guard maxIntensity > 0 else { return peaks }
        return peaks.map { peak in
            QuickLookSpectrumPeak(x: peak.x, y: peak.y / maxIntensity * 100, label: peak.label, annotations: peak.annotations)
        }
    }

    private static func numericPair(from line: String) -> (Double, Double)? {
        let parts = line.replacingOccurrences(of: ",", with: " ")
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        guard parts.count >= 2, let x = Double(parts[0]), let y = Double(parts[1]) else { return nil }
        return (x, y)
    }

    private static func zipSpectrumPeaks(_ xValues: [Double], _ yValues: [Double]) -> [QuickLookSpectrumPeak] {
        let count = min(xValues.count, yValues.count)
        guard count > 0 else { return [] }
        return (0..<count).compactMap { index in
            let x = xValues[index]
            let y = yValues[index]
            guard x.isFinite, y.isFinite else { return nil }
            return QuickLookSpectrumPeak(x: x, y: y, label: nil, annotations: [:])
        }
    }

    private static func decodeMzmlArray(_ element: XMLElement?) -> [Double] {
        guard let element,
              (try? element.nodes(forXPath: ".//*[local-name()='cvParam'][@accession='MS:1000574']"))?.isEmpty != false,
              let binary = (try? element.nodes(forXPath: ".//*[local-name()='binary']").first)?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !binary.isEmpty else {
            return []
        }
        let precision = xmlElementHasCV(element, accession: "MS:1000523") ? 64 : 32
        return decodeBase64FloatArray(binary, precision: precision, endian: "little")
    }

    private static func xmlPeakList(in element: XMLElement) -> [QuickLookSpectrumPeak] {
        let peakElements = (try? element.nodes(forXPath: ".//*[local-name()='peak']").compactMap { $0 as? XMLElement }) ?? []
        return peakElements.compactMap { peak in
            let x = xmlDoubleAttribute(peak, names: ["mz", "m_z", "mOverZ", "x"])
            let y = xmlDoubleAttribute(peak, names: ["intensity", "inten", "abundance", "y"])
            guard let x, let y else { return nil }
            return QuickLookSpectrumPeak(x: x, y: y, label: peak.attribute(forName: "label")?.stringValue, annotations: [:])
        }
    }

    private static func xmlDoubleAttribute(_ element: XMLElement, names: [String]) -> Double? {
        for name in names {
            if let value = element.attribute(forName: name)?.stringValue,
               let number = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return number
            }
        }
        return nil
    }

    private static func xmlElementHasCV(_ element: XMLElement, accession: String) -> Bool {
        ((try? element.nodes(forXPath: ".//*[local-name()='cvParam'][@accession='\(accession)']"))?.isEmpty == false)
    }

    private static func decodeBase64FloatArray(_ text: String, precision: Int, endian: String) -> [Double] {
        guard let data = Data(base64Encoded: text) else { return [] }
        let step = precision == 64 ? 8 : 4
        guard data.count >= step else { return [] }
        return stride(from: 0, through: data.count - step, by: step).compactMap { offset in
            let chunk = data[offset..<(offset + step)]
            if step == 8 {
                let bits = chunk.reduce(UInt64(0)) { value, byte in
                    endian == "big" ? (value << 8) | UInt64(byte) : (value >> 8) | (UInt64(byte) << 56)
                }
                return Double(bitPattern: bits)
            }
            let bits = chunk.reduce(UInt32(0)) { value, byte in
                endian == "big" ? (value << 8) | UInt32(byte) : (value >> 8) | (UInt32(byte) << 24)
            }
            return Double(Float(bitPattern: bits))
        }
    }

    private static func numericArray(from value: Any?) -> [Double] {
        guard let values = value as? [Any] else { return [] }
        return values.compactMap { item in
            if let number = item as? NSNumber { return number.doubleValue }
            if let string = item as? String { return Double(string) }
            return nil
        }
    }

    private static func stringArray(from value: Any?) -> [String] {
        guard let values = value as? [Any] else { return [] }
        return values.map { String(describing: $0) }
    }

    private static func parseDelimitedLine(_ line: String, delimiter: Character) -> [String] {
        var values: [String] = []
        var current = ""
        var quoted = false
        for character in line {
            if character == "\"" {
                quoted.toggle()
            } else if character == delimiter && !quoted {
                values.append(current)
                current.removeAll(keepingCapacity: true)
            } else {
                current.append(character)
            }
        }
        values.append(current)
        return values
    }

    private static func normalizedColumnName(_ value: String) -> String {
        var normalized = ""
        for character in value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            if character.isLetter || character.isNumber {
                normalized.append(character)
            } else {
                normalized.append("_")
            }
        }
        while normalized.contains("__") {
            normalized = normalized.replacingOccurrences(of: "__", with: "_")
        }
        return normalized.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    }

    private static func formatNumber(_ value: Double, decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private static func spectrumConfigJSON(
        title: String,
        fileExtension: String,
        byteCount: Int,
        requestID: String,
        format: String
    ) throws -> String {
        let payload: [String: Any] = [
            "mode": "spectrum",
            "renderer": "spectrum",
            "format": format,
            "sourceExtension": fileExtension,
            "label": title,
            "documentId": title,
            "byteCount": byteCount,
            "previewByteCount": byteCount,
            "previewRequestID": requestID
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let json = String(data: data, encoding: .utf8) else { throw PreviewError.couldNotCreatePreviewConfig }
        return json
    }

    private static func spectrumInlineHTML(title: String, spectrum: QuickLookSpectrum, requestID: String) -> String {
        let payload = (try? JSONEncoder().encode(spectrum)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>\(htmlEscape(title))</title>
          <style>
            :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
            body { margin: 0; background: Canvas; color: CanvasText; overflow: hidden; }
            .app { height: 100vh; display: grid; grid-template-columns: minmax(360px, 1fr) 360px; }
            .plot-pane { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
            header { height: 54px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
            h1 { margin: 0; font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .badge { border-radius: 999px; padding: 3px 9px; background: color-mix(in srgb, CanvasText 10%, transparent); color: color-mix(in srgb, CanvasText 65%, transparent); font-size: 12px; font-weight: 700; }
            .plot-wrap { flex: 1; min-height: 0; padding: 18px; }
            svg { width: 100%; height: 100%; display: block; }
            .axis, .grid { stroke: color-mix(in srgb, CanvasText 16%, transparent); }
            .axis { stroke-width: 1.2; }
            .grid { stroke-width: 1; }
            .tick-label, .axis-label { fill: color-mix(in srgb, CanvasText 58%, transparent); font-size: 11px; }
            .axis-label { font-weight: 650; }
            .peak { fill: #4f8cff; cursor: pointer; }
            .peak.unannotated { fill: #7c8798; }
            .peak.selected { fill: #b456e8; }
            .selected-ring { fill: rgba(180,86,232,0.22); stroke: #b456e8; stroke-width: 2.5; pointer-events: none; }
            .peak-label { fill: color-mix(in srgb, CanvasText 68%, transparent); font-size: 11px; text-anchor: middle; pointer-events: none; }
            .table { height: 210px; overflow: auto; border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent); white-space: nowrap; }
            th { color: color-mix(in srgb, CanvasText 55%, transparent); font-weight: 700; position: sticky; top: 0; background: Canvas; }
            tr.selected { background: color-mix(in srgb, #b14bea 18%, transparent); }
            .controls { margin-left: auto; display: flex; align-items: center; gap: 8px; }
            .toggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 8px; padding: 6px 9px; background: color-mix(in srgb, CanvasText 5%, transparent); color: color-mix(in srgb, CanvasText 76%, transparent); font-size: 12px; font-weight: 650; }
            .toggle input { accent-color: #b456e8; }
            aside { overflow: auto; padding: 16px; }
            .subtitle { margin: 4px 0 16px; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 13px; }
            section { margin: 0 0 18px; }
            h2 { margin: 0 0 8px; font-size: 14px; }
            .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .card { border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 8px; padding: 10px; }
            .label { color: color-mix(in srgb, CanvasText 56%, transparent); font-size: 12px; }
            .value { margin-top: 3px; font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
            .chips { display: flex; flex-wrap: wrap; gap: 6px; }
            button.chip { border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 999px; background: color-mix(in srgb, CanvasText 6%, transparent); color: CanvasText; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; }
            .meta { display: grid; gap: 7px; }
            .meta-row { display: grid; grid-template-columns: minmax(80px, .7fr) 1fr; gap: 8px; border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); border-radius: 7px; padding: 8px; }
          </style>
        </head>
        <body>
          <script id="spectrum-data" type="application/json">\(payload.replacingOccurrences(of: "</", with: "<\\/"))</script>
          <div class="app">
            <main class="plot-pane">
              <header>
                <h1>\(htmlEscape(title))</h1>
                <span class="badge">\(htmlEscape(spectrum.format))</span>
                <div class="controls">
                  <label class="toggle"><input id="normalize" type="checkbox" checked><span>Normalize</span></label>
                  <label class="toggle"><input id="top-labels" type="checkbox" checked><span>Top labels</span></label>
                </div>
              </header>
              <div class="plot-wrap"><svg id="plot" role="img" aria-label="Spectrum plot"></svg></div>
              <div class="table"><table><thead><tr><th>m/z</th><th>Relative intensity</th><th>Annotation</th></tr></thead><tbody id="peak-rows"></tbody></table></div>
            </main>
            <aside>
              <h1>\(htmlEscape(title))</h1>
              <div class="subtitle">\(htmlEscape(spectrum.format)) · \(spectrum.primary.peaks.count) peaks</div>
              <section><h2>Spectrum summary</h2><div class="metrics" id="metrics"></div></section>
              <section><h2>Fragment formulas</h2><div class="chips" id="formulas"></div></section>
              <section><h2>Source metadata</h2><div class="meta" id="metadata"></div></section>
            </aside>
          </div>
          <script>
            const data = JSON.parse(document.getElementById('spectrum-data').textContent);
            const doc = data.primary || { peaks: [], summary: [], fragmentFormulas: [] };
            let selected = -1;
            const svg = document.getElementById('plot');
            const tbody = document.getElementById('peak-rows');
            const metrics = document.getElementById('metrics');
            const formulas = document.getElementById('formulas');
            const metadata = document.getElementById('metadata');
            const normalizeInput = document.getElementById('normalize');
            const topLabelsInput = document.getElementById('top-labels');
            function fmt(value, digits = 4) {
              return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
            }
            function appendText(parent, tagName, className, value) {
              const element = document.createElement(tagName);
              if (className) element.className = className;
              element.textContent = value == null ? '' : String(value);
              parent.appendChild(element);
              return element;
            }
            function appendCell(row, value) {
              return appendText(row, 'td', '', value);
            }
            function scaledPeaks() {
              const peaks = doc.peaks || [];
              if (!normalizeInput.checked) return peaks;
              const maxY = Math.max(1e-9, ...peaks.map((peak) => Number(peak.y) || 0));
              return peaks.map((peak) => ({ ...peak, y: ((Number(peak.y) || 0) / maxY) * 100 }));
            }
            function topLabelSet(peaks) {
              if (!topLabelsInput.checked) return new Set();
              return new Set(peaks
                .map((peak, index) => ({ index, y: Number(peak.y) || 0 }))
                .sort((a, b) => b.y - a.y)
                .slice(0, 8)
                .map((item) => item.index));
            }
            function renderMetrics() {
              metrics.innerHTML = '';
              for (const item of doc.summary || []) {
                const card = document.createElement('div');
                card.className = 'card';
                appendText(card, 'div', 'label', item.label);
                appendText(card, 'div', 'value', item.value);
                metrics.appendChild(card);
              }
            }
            function renderMetadata() {
              metadata.innerHTML = '';
              const entries = Object.entries(data.metadata || {});
              if (!entries.length) {
                metadata.innerHTML = '<div class="label">No metadata</div>';
                return;
              }
              for (const [key, value] of entries) {
                const row = document.createElement('div');
                row.className = 'meta-row';
                appendText(row, 'div', 'label', key);
                appendText(row, 'div', 'value', value);
                metadata.appendChild(row);
              }
            }
            function selectPeak(index) {
              selected = selected === index ? -1 : index;
              renderPlot();
              renderRows();
              const row = document.querySelector(`tr[data-index="${selected}"]`);
              if (row) row.scrollIntoView({ block: 'nearest' });
            }
            function renderFormulas() {
              formulas.innerHTML = '';
              for (const formula of doc.fragmentFormulas || []) {
                const button = document.createElement('button');
                button.className = 'chip';
                button.textContent = formula;
                button.addEventListener('click', () => {
                  const index = (doc.peaks || []).findIndex((peak) => peak.label === formula);
                  if (index >= 0) selectPeak(index);
                });
                formulas.appendChild(button);
              }
            }
            function renderRows() {
              tbody.innerHTML = '';
              (doc.peaks || []).forEach((peak, index) => {
                const row = document.createElement('tr');
                row.dataset.index = index;
                row.className = index === selected ? 'selected' : '';
                appendCell(row, fmt(peak.x, 4));
                appendCell(row, fmt(peak.y, 4));
                appendCell(row, peak.label || '');
                row.addEventListener('click', () => selectPeak(index));
                tbody.appendChild(row);
              });
            }
            function renderPlot() {
              const peaks = scaledPeaks();
              const rect = svg.getBoundingClientRect();
              const width = Math.max(320, rect.width || 640);
              const height = Math.max(240, rect.height || 420);
              const pad = { left: 58, right: 20, top: 18, bottom: 48 };
              if (!peaks.length) {
                svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
                svg.innerHTML = '';
                svg.onclick = null;
                return;
              }
              const minX = Math.min(...peaks.map((peak) => peak.x));
              const maxX = Math.max(...peaks.map((peak) => peak.x));
              const maxY = Math.max(normalizeInput.checked ? 100 : 1, ...peaks.map((peak) => peak.y));
              const sx = (x) => pad.left + ((x - minX) / Math.max(1e-9, maxX - minX)) * (width - pad.left - pad.right);
              const sy = (y) => height - pad.bottom - (y / maxY) * (height - pad.top - pad.bottom);
              svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
              svg.innerHTML = '';
              const ns = 'http://www.w3.org/2000/svg';
              function line(x1, y1, x2, y2, cls) {
                const item = document.createElementNS(ns, 'line');
                item.setAttribute('x1', x1); item.setAttribute('y1', y1);
                item.setAttribute('x2', x2); item.setAttribute('y2', y2);
                item.setAttribute('class', cls);
                svg.appendChild(item);
                return item;
              }
              function text(x, y, value, cls, anchor = 'middle') {
                const item = document.createElementNS(ns, 'text');
                item.setAttribute('x', x); item.setAttribute('y', y);
                item.setAttribute('class', cls);
                item.setAttribute('text-anchor', anchor);
                item.textContent = value;
                svg.appendChild(item);
                return item;
              }
              function rectBar(x, y, w, h, cls) {
                const item = document.createElementNS(ns, 'rect');
                item.setAttribute('x', x); item.setAttribute('y', y);
                item.setAttribute('width', w); item.setAttribute('height', h);
                item.setAttribute('rx', Math.min(1.5, w / 2));
                item.setAttribute('class', cls);
                svg.appendChild(item);
                return item;
              }
              for (let i = 0; i <= 4; i++) {
                const y = pad.top + i * (height - pad.top - pad.bottom) / 4;
                line(pad.left, y, width - pad.right, y, 'grid');
                text(pad.left - 10, y + 4, fmt(maxY - (i * maxY / 4), 0), 'tick-label', 'end');
              }
              for (let i = 0; i <= 5; i++) {
                const x = pad.left + i * (width - pad.left - pad.right) / 5;
                const value = minX + i * (maxX - minX) / 5;
                text(x, height - pad.bottom + 22, fmt(value, 0), 'tick-label');
              }
              line(pad.left, height - pad.bottom, width - pad.right, height - pad.bottom, 'axis');
              line(pad.left, pad.top, pad.left, height - pad.bottom, 'axis');
              text((pad.left + width - pad.right) / 2, height - 10, 'm/z', 'axis-label');
              text(16, (pad.top + height - pad.bottom) / 2, normalizeInput.checked ? 'Relative intensity' : (doc.yLabel || 'Intensity'), 'axis-label', 'middle')
                .setAttribute('transform', `rotate(-90 16 ${(pad.top + height - pad.bottom) / 2})`);
              const labelSet = topLabelSet(peaks);
              const sortedXs = peaks.map((peak) => peak.x).sort((a, b) => a - b);
              const minDelta = sortedXs.slice(1).reduce((best, value, index) => Math.min(best, value - sortedXs[index]), Infinity);
              const barWidth = Math.max(1.2, Math.min(5, ((width - pad.left - pad.right) / Math.max(1, maxX - minX)) * (Number.isFinite(minDelta) ? minDelta : 1) * 0.55));
              peaks.forEach((peak, index) => {
                const x = sx(peak.x);
                const y = sy(peak.y);
                const cls = `${peak.label ? 'peak' : 'peak unannotated'}${index === selected ? ' selected' : ''}`;
                const item = rectBar(x - barWidth / 2, y, barWidth, height - pad.bottom - y, cls);
                item.addEventListener('click', (event) => { event.stopPropagation(); selectPeak(index); });
                if (index === selected) {
                  const ring = document.createElementNS(ns, 'circle');
                  ring.setAttribute('cx', x);
                  ring.setAttribute('cy', y);
                  ring.setAttribute('r', 10);
                  ring.setAttribute('class', 'selected-ring');
                  svg.appendChild(ring);
                }
                if (labelSet.has(index)) {
                  text(x, Math.max(12, y - 7), fmt(peak.x, 1), 'peak-label');
                }
              });
              svg.onclick = () => { selected = -1; renderPlot(); renderRows(); };
            }
            normalizeInput.addEventListener('change', renderPlot);
            topLabelsInput.addEventListener('change', renderPlot);
            renderMetrics(); renderMetadata(); renderFormulas(); renderRows(); renderPlot();
            window.addEventListener('resize', renderPlot);
            window.BurretePreviewReady = true;
            window.webkit?.messageHandlers?.burrete?.postMessage({
              type: 'ready',
              requestID: '\(requestID)',
              message: 'ready',
              mode: 'spectrum',
              renderer: 'spectrum',
              format: '\(htmlEscape(spectrum.format))',
              peakCount: \(spectrum.primary.peaks.count)
            });
          </script>
        </body>
        </html>
        """
    }

    private static func htmlEscape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func looksBinary(_ data: Data) -> Bool {
        for byte in data.prefix(8192) {
            if byte == 0 { return true }
            if byte < 7 || (byte > 13 && byte < 32) { return true }
        }
        return false
    }

    private static func quickLookSizeLimit(for url: URL) -> Int64 {
        let fileExtension = structurePathExtension(for: url)
        if let bridgeLimit = BurreteCoreBridge.quickLookSizeLimit(fileExtension: fileExtension) {
            return bridgeLimit
        }
        let mib: Int64 = 1024 * 1024
        switch fileExtension {
        case "pdb", "ent", "pdbqt", "pqr":
            return 35 * mib
        case "cif", "mmcif", "mcif":
            return 40 * mib
        case "bcif":
            return 50 * mib
        case "abi", "com", "csv", "fdf", "fhiaims", "gms", "sdf", "sd", "mol", "mol2", "xyz", "gro", "smi", "smiles", "tsv", "cub", "cube", "in", "inp", "log", "nw", "out", "psi4", "qcin", "vasp", "lammpstrj", "dump", "top", "psf", "prmtop", "graphml":
            return 25 * mib
        case "mae", "maegz", "cms":
            return 64 * mib
        case "xtc", "trr", "dcd", "nctraj":
            return 75 * mib
        default:
            return 20 * mib
        }
    }

    private static func isMaestroPreviewExtension(_ fileExtension: String) -> Bool {
        ["cms", "mae", "maegz"].contains(fileExtension.lowercased())
    }

    private static func readFilePrefix(_ url: URL, maxBytes: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        return try handle.read(upToCount: maxBytes) ?? Data()
    }

    private static func structurePathExtension(for url: URL) -> String {
        if url.lastPathComponent.lowercased().hasSuffix(".mae.gz") {
            return "maegz"
        }
        return url.pathExtension.lowercased()
    }

    private static func shouldUseFepGraphMLPreview(fileExtension: String, previewPlan: BurretePreviewPlan?) -> Bool {
        if let previewPlan {
            return previewPlan.strategy == "custom" && previewPlan.renderer == "fep-graphml"
        }
        return fileExtension.lowercased() == "graphml"
    }

    private static func shouldUseTextArtifactPreview(url: URL, fileExtension: String, previewPlan: BurretePreviewPlan?) -> Bool {
        if isPreferredTextArtifact(url: url) {
            return true
        }
        if let previewPlan {
            return previewPlan.strategy == "text"
        }
        return ["par", "prm", "rtf", "str", "key", "chk", "checkpoint", "fdef"].contains(fileExtension.lowercased())
    }

    private static func isPreferredTextArtifact(url: URL) -> Bool {
        url.lastPathComponent.lowercased() == "log.lammps"
    }

    private static func requiresGridPreview(fileExtension: String, previewPlan: BurretePreviewPlan?) -> Bool {
        if let previewPlan {
            return previewPlan.strategy == "grid"
        }
        return MoleculeGridFileSupport.requiresGridPreview(fileExtension: fileExtension)
    }

    private static func canOpenInVesta(fileExtension: String, previewPlan: BurretePreviewPlan?) -> Bool {
        if let previewPlan {
            return previewPlan.capabilities.canOpenInVesta
        }
        return ["xyz", "cub", "cube"].contains(fileExtension.lowercased())
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

	    private func scheduleRenderTimeout(for requestID: UUID, timeoutSeconds: TimeInterval) {
	        renderTimeoutWorkItem?.cancel()
	        let workItem = DispatchWorkItem { [weak self] in
	            guard let self else { return }
	            let error = PreviewError.webRenderTimedOut
	            self.appendLog("render timeout waiting for JS ready after \(Int(timeoutSeconds)) seconds")
	            self.appendFailedPreviewTrace(requestID: requestID, error: error, message: "render timeout waiting for JS ready")
	            self.renderNativeError(error, fileURL: nil)
	            self.finishPreviewIfNeeded(nil, requestID: requestID)
	        }
	        renderTimeoutWorkItem = workItem
	        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: workItem)
	    }

    private func finishPreviewIfNeeded(_ error: Error?, requestID: UUID? = nil, cancelRenderTimeout: Bool = true) {
        if let requestID, requestID != activePreviewRequestID {
            appendLog("skipping Quick Look completion for stale preview request")
            return
        }
        if cancelRenderTimeout {
            renderTimeoutWorkItem?.cancel()
            renderTimeoutWorkItem = nil
        }
        guard let completion = pendingCompletion else { return }
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
	        appendFailedPreviewTrace(requestID: activePreviewRequestID, error: error, message: "WK didFail")
	        renderNativeError(error, fileURL: nil)
	        finishPreviewIfNeeded(nil)
	    }

	    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
	        appendLog("WK didFailProvisionalNavigation error=\(Self.describe(error))")
	        appendFailedPreviewTrace(requestID: activePreviewRequestID, error: error, message: "WK didFailProvisionalNavigation")
	        renderNativeError(error, fileURL: nil)
	        finishPreviewIfNeeded(nil)
	    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        appendLog("WK webContentProcessDidTerminate")
        guard !hasRenderedTerminationError else { return }
        hasRenderedTerminationError = true
	        renderTimeoutWorkItem?.cancel()
	        renderTimeoutWorkItem = nil
	        let error = PreviewError.webRenderFailed("The embedded WebKit process terminated while loading the Quick Look preview.")
	        appendFailedPreviewTrace(requestID: activePreviewRequestID, error: error, message: "WK webContentProcessDidTerminate")
	        renderNativeError(error, fileURL: currentPreviewURL)
	        finishPreviewIfNeeded(nil, requestID: activePreviewRequestID)
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
                appendLog("JS message type=setRenderer value=\(value)")
                setRendererOverride(value, orientationRefText: body["orientationRef"] as? String)
                return
            }
            if type == "openSdfGridDocument" {
                openGridPreview()
                return
            }
            if type == "setXyzrenderPreset", let value = body["value"] as? String {
                setXyzrenderPresetOverride(value)
                return
            }
            if type == "setXyzrenderControls" {
                setXyzrenderControlsOverride(body["controls"] as? [String: Any] ?? [:])
                return
            }
            if type == "setXyzrenderOrientation" {
                setXyzrenderOrientation(body["text"] as? String ?? body["value"] as? String)
                return
            }
            if type == "requestData" {
                handleJavaScriptStructureDataRequest(body)
                return
            }
            if type == "requestRuntimeFile" {
                handleJavaScriptRuntimeFileRequest(body)
                return
            }
            if type == "exportText" {
                handleJavaScriptTextExport(body)
                return
            }
            if type == "exportData" {
                handleJavaScriptDataExport(body)
                return
            }
            appendLog("JS message type=\(type): \(text.prefix(1600))")
            if let evidence = Self.previewEvidenceLogLine(type: type, body: body) {
                appendLog(evidence)
            }
            if type == "ready" {
                appendLog("elapsed.jsReadyMs=0")
                guard let messageRequestID else {
                    appendLog("ignoring ready without requestID")
                    return
                }
                appendPreviewTrace(
                    state: "completed",
                    requestID: messageRequestID.uuidString,
                    fileURL: currentPreviewURL,
                    runtimeDirectory: currentRuntimeDirectory,
                    message: "ready"
                )
                finishPreviewIfNeeded(nil, requestID: messageRequestID)
            } else if type == "status" && text.hasPrefix("[web] Rendered") {
                appendLog("elapsed.renderCompleteMs=0")
            } else if type == "error" {
                guard let messageRequestID else {
                    appendLog("ignoring error without requestID")
                    return
                }
                appendPreviewTrace(
                    state: "failed",
                    requestID: messageRequestID.uuidString,
                    fileURL: currentPreviewURL,
                    runtimeDirectory: currentRuntimeDirectory,
                    errorCode: "BRT-QL-WEB-ERROR",
                    message: String(text.prefix(400))
                )
                finishPreviewIfNeeded(nil, requestID: messageRequestID)
            }
            if Self.showDebugOverlay || type == "error" {
                previewStatus = "[web:\(type)] \(text.prefix(900))"
            }
        } else {
            appendLog("JS message raw: \(String(describing: message.body))")
        }
    }

    private func handleJavaScriptTextExport(_ body: [String: Any]) {
        guard let text = body["text"] as? String else {
            appendLog("exportText.missingText")
            return
        }
        let name = Self.safeExportFileName(body["name"] as? String ?? "molstar-export.txt")
        presentJavaScriptExportSavePanel(data: Data(text.utf8), name: name)
    }

    private func handleJavaScriptDataExport(_ body: [String: Any]) {
        guard let base64 = body["base64"] as? String, let data = Data(base64Encoded: base64) else {
            appendLog("exportData.invalidBase64")
            return
        }
        let name = Self.safeExportFileName(body["name"] as? String ?? "molstar-export.bin")
        presentJavaScriptExportSavePanel(data: data, name: name)
    }

    private func presentJavaScriptExportSavePanel(data: Data, name: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        if let currentPreviewURL {
            panel.directoryURL = currentPreviewURL.deletingLastPathComponent()
        }
        let completion: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else {
                self.appendLog("export.cancelled name=\(name)")
                return
            }
            do {
                try data.write(to: url, options: [.atomic])
                self.appendLog("export.saved path=\(url.path) bytes=\(data.count)")
                self.previewStatus = "[native] Exported \(url.lastPathComponent)"
            } catch {
                self.appendLog("export.failed path=\(url.path) error=\(Self.describe(error))")
                self.previewStatus = "[native] Export failed\n\(Self.describe(error))"
            }
        }
        if let window = view.window {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }

    private static func safeExportFileName(_ name: String) -> String {
        let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
        var cleaned = name
            .components(separatedBy: invalid)
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while cleaned.first == "." {
            cleaned.removeFirst()
        }
        if cleaned.count > 120 {
            cleaned = String(cleaned.prefix(120))
        }
        return cleaned.isEmpty ? "molstar-export.bin" : cleaned
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

    private func handleJavaScriptStructureDataRequest(_ body: [String: Any]) {
        guard let requestToken = body["requestToken"] as? String, !requestToken.isEmpty else {
            appendLog("requestData.missingToken")
            return
        }
        guard let currentRuntimeDirectory else {
            appendLog("requestData.missingRuntimeDirectory")
            sendJavaScriptStructureDataResponse(requestToken: requestToken, base64: nil, error: "Quick Look runtime directory is unavailable.")
            return
        }
        let dataURL = currentRuntimeDirectory.appendingPathComponent("preview-data.bin")
        guard let data = try? Data(contentsOf: dataURL), !data.isEmpty else {
            appendLog("requestData.missingPayload path=\(dataURL.path)")
            sendJavaScriptStructureDataResponse(requestToken: requestToken, base64: nil, error: "Quick Look payload file is unavailable.")
            return
        }
        appendLog("requestData.bytes=\(data.count)")
        sendJavaScriptStructureDataResponse(requestToken: requestToken, base64: data.base64EncodedString(), error: nil)
    }

    private func handleJavaScriptRuntimeFileRequest(_ body: [String: Any]) {
        guard let requestToken = body["requestToken"] as? String, !requestToken.isEmpty else {
            appendLog("requestRuntimeFile.missingToken")
            return
        }
        guard let requestedPath = body["path"] as? String else {
            appendLog("requestRuntimeFile.missingPath")
            sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: nil, error: "Runtime file path is missing.")
            return
        }
        guard let currentRuntimeDirectory else {
            appendLog("requestRuntimeFile.missingRuntimeDirectory")
            sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: nil, error: "Quick Look runtime directory is unavailable.")
            return
        }
        var normalizedPath = requestedPath
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\", with: "/")
        while normalizedPath.hasPrefix("./") {
            normalizedPath.removeFirst(2)
        }
        guard !normalizedPath.isEmpty, !normalizedPath.hasPrefix("/") else {
            appendLog("requestRuntimeFile.invalidPath=\(requestedPath)")
            sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: nil, error: "Runtime file path is invalid.")
            return
        }
        let rootPath = currentRuntimeDirectory.standardizedFileURL.path
        let fileURL = currentRuntimeDirectory
            .appendingPathComponent(normalizedPath, isDirectory: false)
            .standardizedFileURL
        guard fileURL.path.hasPrefix(rootPath + "/") else {
            appendLog("requestRuntimeFile.rejectedPath=\(requestedPath)")
            sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: nil, error: "Runtime file path is outside the preview directory.")
            return
        }
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else {
            appendLog("requestRuntimeFile.missingPayload path=\(fileURL.path)")
            sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: nil, error: "Runtime file is unavailable.")
            return
        }
        appendLog("requestRuntimeFile.bytes=\(data.count) path=\(normalizedPath)")
        sendJavaScriptRuntimeFileResponse(requestToken: requestToken, base64: data.base64EncodedString(), error: nil)
    }

    private func sendJavaScriptStructureDataResponse(requestToken: String, base64: String?, error: String?) {
        var payload: [String: Any] = ["requestToken": requestToken]
        if let base64 {
            payload["base64"] = base64
        }
        if let error {
            payload["error"] = error
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else {
            appendLog("requestData.responseEncodingFailed")
            return
        }
        webView.evaluateJavaScript("window.BurreteReceiveNativeData && window.BurreteReceiveNativeData(\(json));") { [weak self] _, evaluationError in
            guard let self, let evaluationError else { return }
            self.appendLog("requestData.injectFailed=\(Self.describe(evaluationError))")
        }
    }

    private func sendJavaScriptRuntimeFileResponse(requestToken: String, base64: String?, error: String?) {
        var payload: [String: Any] = ["requestToken": requestToken]
        if let base64 {
            payload["base64"] = base64
        }
        if let error {
            payload["error"] = error
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else {
            appendLog("requestRuntimeFile.responseEncodingFailed")
            return
        }
        webView.evaluateJavaScript("window.BurreteReceiveNativeRuntimeFile && window.BurreteReceiveNativeRuntimeFile(\(json));") { [weak self] _, evaluationError in
            guard let self, let evaluationError else { return }
            self.appendLog("requestRuntimeFile.injectFailed=\(Self.describe(evaluationError))")
        }
    }

    private func openCurrentPreviewInVesta() {
        guard let url = currentPreviewURL else {
            appendLog("openInVesta.missingCurrentURL")
            return
        }
        guard Self.canOpenInVesta(fileExtension: Self.structurePathExtension(for: url), previewPlan: nil) else {
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

    private func openGridPreview() {
        guard rendererOverride != nil || xyzrenderPresetOverride != nil || xyzrenderControlsOverride != nil || xyzrenderOrientationRefText != nil else {
            reloadCurrentPreview()
            return
        }
        rendererOverride = nil
        xyzrenderPresetOverride = nil
        xyzrenderControlsOverride = nil
        xyzrenderOrientationRefText = nil
        reloadCurrentPreview()
    }

    private func setXyzrenderPresetOverride(_ value: String) {
        let preset = BurreteXyzrenderPreset.normalize(value)
        guard xyzrenderPresetOverride != preset || rendererOverride != BurreteRendererMode.xyzrenderExternal else { return }
        xyzrenderPresetOverride = preset
        rendererOverride = BurreteRendererMode.xyzrenderExternal
        reloadCurrentPreview()
    }

    private func setXyzrenderControlsOverride(_ value: [String: Any]) {
        let normalized = PreviewExternalXyzrenderWorker.normalizedControls(value)
        guard NSDictionary(dictionary: xyzrenderControlsOverride ?? [:]).isEqual(to: normalized) == false
            || rendererOverride != BurreteRendererMode.xyzrenderExternal else { return }
        xyzrenderControlsOverride = normalized
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

    private func reloadCurrentPreview(sourceFingerprint: PreviewSourceFingerprint? = nil, reason: String = "manual") {
        guard let url = currentPreviewURL else { return }
        let requestID = UUID()
        activePreviewRequestID = requestID
        renderTimeoutWorkItem?.cancel()
        hasRenderedTerminationError = false
        let rendererOverride = rendererOverride
        let xyzrenderPresetOverride = xyzrenderPresetOverride
        let xyzrenderOrientationRefText = xyzrenderOrientationRefText
        let xyzrenderControlsOverride = xyzrenderControlsOverride
        appendLog("reloading preview reason=\(reason) rendererOverride=\(rendererOverride ?? "nil") xyzrenderPresetOverride=\(xyzrenderPresetOverride ?? "nil") orientationRef=\(xyzrenderOrientationRefText == nil ? "nil" : "set") controls=\(xyzrenderControlsOverride == nil ? "nil" : "set")")
        previewStatus = reason == "source-changed"
            ? "[native] Reloading updated preview...\n\(url.lastPathComponent)"
            : "[native] Switching renderer...\n\(url.lastPathComponent)"
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let result = try Self.buildInlinePreviewHTML(
                    for: url,
                    requestID: requestID.uuidString,
                    rendererOverride: rendererOverride,
                    xyzrenderPresetOverride: xyzrenderPresetOverride,
                    xyzrenderOrientationRefText: xyzrenderOrientationRefText,
                    xyzrenderControlsOverride: xyzrenderControlsOverride
                )
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.activePreviewRequestID == requestID else { return }
                    for line in result.diagnostics { self.appendLog(line) }
                    self.currentRuntimeDirectory = result.indexURL.deletingLastPathComponent()
                    self.previewSourceFingerprint = sourceFingerprint ?? Self.previewSourceFingerprint(for: url)
                    self.pendingPreviewSourceFingerprint = nil
                    self.appendLog("elapsed.wkLoadStartMs=0")
                    self.webView.loadFileURL(result.indexURL, allowingReadAccessTo: result.readAccessURL)
                    self.scheduleRenderTimeout(for: requestID, timeoutSeconds: result.renderTimeoutSeconds)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.activePreviewRequestID == requestID else { return }
	                    self.pendingPreviewSourceFingerprint = nil
	                    self.appendLog("native renderer switch error: \(Self.describe(error))")
	                    self.appendFailedPreviewTrace(requestID: requestID, error: error, message: "native renderer switch error")
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
            dataBytes: window.BurreteDataBytes ? window.BurreteDataBytes.length : -1,
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
            if self.previewStatus.isEmpty { self.previewStatus = line }
        }
    }

    private static func shouldRecordLog(_ message: String) -> Bool {
        if verboseLogging { return true }
        if message == "preparePreviewOfFile called" { return true }
        if message.hasPrefix("file.path=") { return true }
        if message.hasPrefix("resource.typeIdentifier=") { return true }
        if message.hasPrefix("elapsed.") { return true }
        if message.hasPrefix("[build] detected.format=") { return true }
        if message.hasPrefix("[build] detected.previewMode=") { return true }
        if message.hasPrefix("[build] trajectory.frames=") { return true }
        if message.hasPrefix("[build] elapsed.") { return true }
        if message.hasPrefix("[build] runtimeDirectory=") { return true }
        if message.hasPrefix("[build] runtime.index.exists=") { return true }
        if message.hasPrefix("trace.requestID=") { return true }
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
        if message.hasPrefix("preview.evidence ") { return true }
        if message.hasPrefix("previewSourceMonitor.started") { return true }
        if message.hasPrefix("previewSource.changed") { return true }
        if message.hasPrefix("preview source changed on disk") { return true }
        if message.hasPrefix("reloading preview reason=source-changed") { return true }
        return false
    }

    private static func previewEvidenceLogLine(type: String, body: [String: Any]) -> String? {
        let keys = [
            "mode",
            "renderer",
            "format",
            "sourceExtension",
            "peakCount",
            "rowCount",
            "moleculeRowCount",
            "renderedCount",
            "edgeCount",
            "moleculesWithAtoms",
            "atomCount",
            "rdkitLoaded",
            "rdkitImages",
            "rdkitPending",
            "xyzrenderImages",
            "externalArtifact",
            "xyzrenderSvgBytes",
            "molstarStructureCount",
            "poseCount",
            "trajectoryFrameCount"
        ]
        let parts = keys.compactMap { key -> String? in
            guard let value = body[key], !(value is NSNull) else { return nil }
            return "\(key)=\(previewEvidenceValue(value))"
        }
        guard !parts.isEmpty else { return nil }
        return "preview.evidence type=\(type) " + parts.joined(separator: " ")
    }

    private static func previewEvidenceValue(_ value: Any) -> String {
        if let value = value as? String {
            let sanitized = value.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\t", with: " ")
            return sanitized.isEmpty ? "\"\"" : sanitized
        }
        if let value = value as? Bool { return value ? "true" : "false" }
        return String(describing: value)
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

    private static var previewTraceURL: URL? {
        let fileManager = FileManager.default
        guard let base = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            return nil
        }
        return base
            .appendingPathComponent("Burrete", isDirectory: true)
            .appendingPathComponent("preview-trace.jsonl")
    }

	    private func appendPreviewTrace(
	        state: String,
	        requestID: String,
        fileURL: URL?,
        runtimeDirectory: URL? = nil,
        error: Error? = nil,
        errorCode: String? = nil,
        message: String? = nil
    ) {
        var payload: [String: Any] = [
            "schemaVersion": 1,
            "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
            "documentId": requestID,
            "state": state,
            "subsystem": "quicklook",
            "requestID": requestID
        ]
        if let fileURL {
            payload["sourceExtension"] = Self.structurePathExtension(for: fileURL)
        }
        if let runtimeDirectory {
            payload["runtimePath"] = runtimeDirectory.path
        }
        if let error {
            payload["errorCode"] = errorCode ?? Self.previewErrorCode(error)
        } else if let errorCode {
            payload["errorCode"] = errorCode
        }
        if let message {
            payload["message"] = message.replacingOccurrences(of: "\n", with: " ")
        }
        appendLog("trace.requestID=\(requestID) state=\(state)")
	        Self.writePreviewTracePayload(payload)
	    }

	    private func appendFailedPreviewTrace(requestID: UUID, error: Error, message: String) {
	        appendPreviewTrace(
	            state: "failed",
	            requestID: requestID.uuidString,
	            fileURL: currentPreviewURL,
	            runtimeDirectory: currentRuntimeDirectory,
	            error: error,
	            message: message
	        )
	    }

	    private static func writePreviewTracePayload(_ payload: [String: Any]) {
        guard let url = previewTraceURL else { return }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            var line = data
            line.append(Data("\n".utf8))
            if FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                handle.seekToEndOfFile()
                handle.write(line)
                handle.closeFile()
            } else {
                try line.write(to: url, options: [.atomic])
            }
        } catch {
            NSLog("[BurreteV10] could not write preview trace to \(url.path): \(String(describing: error))")
        }
    }

    private static func previewErrorCode(_ error: Error) -> String {
        guard let previewError = error as? PreviewError else { return "BRT-QL-RUNTIME-ERROR" }
        switch previewError {
        case .missingWebDirectory, .missingWebAsset, .molstarAssetsNotVendored:
            return "BRT-QL-MISSING-ASSETS"
        case .emptyStructureFile:
            return "BRT-QL-EMPTY-FILE"
        case .unsupportedStructureFile, .gridFileTypeDisabled:
            return "BRT-QL-UNSUPPORTED"
        case .fileTooLarge, .couldNotExtractBoundedMaestroPreview:
            return "BRT-QL-FILE-TOO-LARGE"
        case .notRenderableStandaloneStructure:
            return "BRT-QL-NOT-RENDERABLE"
        case .ubiquitousFileNotDownloaded:
            return "BRT-QL-ICLOUD-NOT-DOWNLOADED"
        case .webRenderFailed:
            return "BRT-QL-WEB-ERROR"
        case .webRenderTimedOut:
            return "BRT-QL-WEB-TIMEOUT"
        case .couldNotCreatePreviewConfig, .couldNotCreateRuntimePreview:
            return "BRT-QL-RUNTIME-WRITE"
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

    private static func jsonStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8),
              json.hasPrefix("["),
              json.hasSuffix("]") else {
            return "\"\""
        }
        return String(json.dropFirst().dropLast())
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

    fileprivate struct ConvertedStructure {
        let data: Data
        let format: StructureFormat
        let auxiliaryFiles: [RuntimeAuxiliaryFile]
        let stagedEntries: [[String: Any]]
    }

    private struct MaestroAtom {
        let symbol: String
        let atomName: String
        let residueName: String
        let residueNumber: Int
        let chainName: String
        let x: Double
        let y: Double
        let z: Double
    }

    private struct MaestroPDBCandidate {
        let atoms: [MaestroAtom]
        let solventAtoms: [MaestroAtom]
        let proteinAtomCount: Int
        let omittedSolventAtomCount: Int
        let nonWaterAtomCount: Int
    }

    private struct MaestroPDBBundle {
        let primaryAtoms: [MaestroAtom]
        let solventAtoms: [MaestroAtom]
    }

    private typealias Vec3 = (Double, Double, Double)

    private struct PharmacophoreFeature {
        let name: String
        let x: Double
        let y: Double
        let z: Double
        let radius: Double
        let vector: Vec3?
    }

    private struct PharmacophoreSphere {
        let x: Double
        let y: Double
        let z: Double
        let radius: Double
    }

    private struct PharmacophorePreview {
        let features: [PharmacophoreFeature]
        let connectors: [(Int, Int)]
        let volumeSpheres: [PharmacophoreSphere]
        let structurePDB: String?
    }

    fileprivate static func convertedData(from data: Data, fileExtension: String, label: String) -> ConvertedStructure? {
        if ["ph4", "json"].contains(fileExtension.lowercased()),
           let pdb = pharmacophorePDBData(from: data, fileExtension: fileExtension, label: label) {
            return ConvertedStructure(data: pdb, format: .convertedPDB, auxiliaryFiles: [], stagedEntries: [])
        }
        if isMaestroExtension(fileExtension), let bundle = maestroPDBBundle(from: data), !bundle.primaryAtoms.isEmpty {
            let solventPath = "preview-solvent.pdb"
            let solventData = bundle.solventAtoms.isEmpty
                ? nil
                : maestroPDBData(from: bundle.solventAtoms, remark: "Burrete staged CMS solvent preview")
            let auxiliaryFiles = solventData.map { [RuntimeAuxiliaryFile(path: solventPath, data: $0)] } ?? []
            let stagedEntries: [[String: Any]] = solventData == nil ? [] : [[
                "path": "./\(solventPath)",
                "format": "pdb",
                "binary": false,
                "label": "\(label) solvent",
                "representation": "solvent-lines",
                "requiredForReady": true
            ]]
            return ConvertedStructure(
                data: maestroPDBData(from: bundle.primaryAtoms, remark: "Burrete staged CMS protein and ligand preview"),
                format: .convertedPDB,
                auxiliaryFiles: auxiliaryFiles,
                stagedEntries: stagedEntries
            )
        }
        if isGROExtension(fileExtension),
           let pdb = groPDBData(from: data, label: label) {
            return ConvertedStructure(data: pdb, format: .convertedPDB, auxiliaryFiles: [], stagedEntries: [])
        }
        if isMOL2Extension(fileExtension),
           let pdb = mol2PDBData(from: data, label: label) {
            return ConvertedStructure(data: pdb, format: .convertedPDB, auxiliaryFiles: [], stagedEntries: [])
        }
        if usesPDBTextFallback(fileExtension),
           let pdb = pdbData(from: data, fileExtension: fileExtension, label: label) {
            return ConvertedStructure(data: pdb, format: .convertedPDB, auxiliaryFiles: [], stagedEntries: [])
        }
        if ["lammpstrj", "dump", "pos"].contains(fileExtension.lowercased()),
           let xyz = lammpsDumpXYZData(from: data, label: label) {
            return ConvertedStructure(data: xyz, format: .convertedXYZ, auxiliaryFiles: [], stagedEntries: [])
        }
        guard let xyz = xyzData(from: data, fileExtension: fileExtension, label: label) else { return nil }
        return ConvertedStructure(data: xyz, format: .convertedXYZ, auxiliaryFiles: [], stagedEntries: [])
    }

    static func xyzData(from data: Data, fileExtension: String, label: String) -> Data? {
        guard let atoms = atoms(from: data, fileExtension: fileExtension), !atoms.isEmpty else { return nil }
        var xyz = "\(atoms.count)\nConverted from \(label)\n"
        for atom in atoms {
            xyz += "\(atom.symbol) \(format(atom.x)) \(format(atom.y)) \(format(atom.z))\n"
        }
        return Data(xyz.utf8)
    }

    private static func atoms(from data: Data, fileExtension: String) -> [Atom]? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        switch fileExtension.lowercased() {
        case "abi":
            return parseABINIT(lines)
        case "cub", "cube":
            return parseCube(lines)
        case "fdf":
            return parseFDF(lines)
        case "vasp":
            return parseVasp(lines)
        case "in", "inp":
            return parseQuantumEspressoInput(lines) ?? parseQSiteGeometry(lines) ?? parseBestCoordinateBlock(lines)
        case "nw", "psi4", "qcin":
            return parseBestCoordinateBlock(lines)
        case "log", "out":
            return parseOrcaOutput(lines) ?? parseGaussianOutput(lines) ?? parseBestCoordinateBlock(lines)
        case "inpcrd", "rst7", "restrt":
            return parseAmberRestart(lines)
        case "lammpstrj", "dump", "pos":
            return parseLammpsDump(lines)
        case "cfg":
            return parseAtomeyeCFG(lines)
        case "data", "lammps", "lmp":
            return parseLammpsData(lines)
        case "crd":
            return parseCharmmCoordinates(lines)
        case "rst":
            return parseCharmmCoordinates(lines) ?? parseAmberRestart(lines)
        case "state", "xml":
            return parseXMLPositions(text) ?? parseHOOMDXMLAtoms(text)
        case "cms", "mae", "maegz":
            return parseMaestroAtoms(lines, atomLimit: 20_000)
        default:
            return nil
        }
    }

    fileprivate static func shouldPreferConvertedMolstarData(fileExtension: String) -> Bool {
        ["ph4", "json"].contains(fileExtension.lowercased()) || isGROExtension(fileExtension) || isMOL2Extension(fileExtension)
    }

    fileprivate static func lammpsDumpFrameCount(_ lines: [String]) -> Int {
        parseLammpsDumpFrames(lines).count
    }

    private static func lammpsDumpXYZData(from data: Data, label: String) -> Data? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let frames = parseLammpsDumpFrames(lines)
        guard !frames.isEmpty else { return nil }

        var xyz = ""
        for (frameIndex, atoms) in frames.enumerated() {
            xyz += "\(atoms.count)\nConverted from \(label) frame \(frameIndex + 1)\n"
            for atom in atoms {
                xyz += "\(atom.symbol) \(format(atom.x)) \(format(atom.y)) \(format(atom.z))\n"
            }
        }
        return Data(xyz.utf8)
    }

    private static func pharmacophorePDBData(from data: Data, fileExtension: String, label: String) -> Data? {
        let preview: PharmacophorePreview?
        switch fileExtension.lowercased() {
        case "ph4":
            preview = parseMOEPh4Preview(decodeText(data))
        case "json":
            preview = parsePharmitJSONPreview(data)
        default:
            preview = nil
        }
        guard let preview, !preview.features.isEmpty else { return nil }
        return pharmacophorePDBData(from: preview, label: label)
    }

    private static func parsePharmitJSONPreview(_ data: Data) -> PharmacophorePreview? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let points = object["points"] as? [[String: Any]] else { return nil }
        let features = points.compactMap { point -> PharmacophoreFeature? in
            if let enabled = point["enabled"] as? Bool, !enabled { return nil }
            guard let name = point["name"] as? String,
                  let x = point["x"] as? Double,
                  let y = point["y"] as? Double,
                  let z = point["z"] as? Double else { return nil }
            return PharmacophoreFeature(
                name: name,
                x: x,
                y: y,
                z: z,
                radius: point["radius"] as? Double ?? 1.0,
                vector: (point["hasvec"] as? Bool) == true ? normalizedPharmacophoreVector(point["svector"]) : nil
            )
        }
        return features.isEmpty ? nil : PharmacophorePreview(
            features: features,
            connectors: [],
            volumeSpheres: [],
            structurePDB: joinedPDBBlocks(object["receptor"], object["ligand"])
        )
    }

    private static func parseMOEPh4Preview(_ text: String) -> PharmacophorePreview? {
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#moe:ph4que") else { return nil }
        let tokens = text.split { $0.isWhitespace }.map(String.init)
        guard let featureIndex = tokens.firstIndex(of: "#feature"),
              featureIndex + 1 < tokens.count,
              let featureCount = Int(tokens[featureIndex + 1]) else { return nil }
        var index = featureIndex + 2
        while index + 1 < tokens.count {
            if tokens[index] == "m", tokens[index + 1] == "ix" {
                index += 2
                break
            }
            index += 1
        }
        var features: [PharmacophoreFeature] = []
        for _ in 0..<featureCount {
            guard index + 8 < tokens.count, !tokens[index].hasPrefix("#") else { break }
            guard let x = Double(tokens[index + 2]),
                  let y = Double(tokens[index + 3]),
                  let z = Double(tokens[index + 4]) else { return nil }
            features.append(PharmacophoreFeature(
                name: tokens[index],
                x: x,
                y: y,
                z: z,
                radius: Double(tokens[index + 5]) ?? 1.0,
                vector: nil
            ))
            index += 9
        }
        return features.isEmpty ? nil : PharmacophorePreview(
            features: features,
            connectors: parseMOEPh4Constraints(tokens, featureCount: features.count),
            volumeSpheres: parseMOEPh4VolumeSpheres(tokens),
            structurePDB: nil
        )
    }

    private static func pharmacophorePDBData(from preview: PharmacophorePreview, label: String) -> Data {
        var pdb = "REMARK Pharmacophore preview converted from \(label)\n"
        pdb += "REMARK Feature centers are pseudo-atoms; Pharmit vectors and MOE constraints are rendered as CONECT sticks.\n"
        if !preview.volumeSpheres.isEmpty {
            pdb += "REMARK MOE volume spheres are rendered as low-occupancy pseudo-atoms.\n"
        }
        if let structurePDB = preview.structurePDB {
            pdb += structurePDB
            if !structurePDB.hasSuffix("\n") { pdb += "\n" }
        }
        var serial = maxPDBSerial(preview.structurePDB) + 1
        var featureSerials: [Int] = []
        var conectLines: [(Int, Int)] = []
        for (index, feature) in preview.features.enumerated() {
            guard serial <= 99_999 else { break }
            let featureSerial = serial
            featureSerials.append(featureSerial)
            pdb += pharmacophorePDBAtomLine(serial: featureSerial, feature: feature, residueNumber: min(index + 1, 9999))
            serial += 1
            if let vector = feature.vector, serial <= 99_999 {
                let length = max(feature.radius * 2.0, 1.25)
                pdb += pharmacophorePDBAtomLine(
                    serial: serial,
                    name: "vector",
                    x: feature.x + vector.0 * length,
                    y: feature.y + vector.1 * length,
                    z: feature.z + vector.2 * length,
                    radius: 0.2,
                    atomName: "VEC",
                    residueName: "VEC",
                    chain: "V",
                    residueNumber: min(index + 1, 9999),
                    element: "C"
                )
                conectLines.append((featureSerial, serial))
                serial += 1
            }
        }
        for (left, right) in preview.connectors {
            guard left >= 0, right >= 0, left < featureSerials.count, right < featureSerials.count else { continue }
            conectLines.append((featureSerials[left], featureSerials[right]))
        }
        for (index, sphere) in preview.volumeSpheres.enumerated() {
            guard serial <= 99_999 else { break }
            pdb += pharmacophorePDBAtomLine(
                serial: serial,
                name: "volume",
                x: sphere.x,
                y: sphere.y,
                z: sphere.z,
                radius: sphere.radius,
                atomName: "VOL",
                residueName: "VOL",
                chain: "Q",
                residueNumber: min(index + 1, 9999),
                occupancy: 0.2,
                element: "C"
            )
            serial += 1
        }
        for (left, right) in conectLines {
            pdb += String(format: "CONECT%5d%5d\n", left, right)
        }
        pdb += "END\n"
        return Data(pdb.utf8)
    }

    private static func pharmacophorePDBAtomLine(
        serial: Int,
        feature: PharmacophoreFeature,
        residueNumber: Int
    ) -> String {
        pharmacophorePDBAtomLine(
            serial: serial,
            name: feature.name,
            x: feature.x,
            y: feature.y,
            z: feature.z,
            radius: feature.radius,
            atomName: pharmacophoreAtomName(feature.name),
            residueName: pharmacophoreResidueName(feature.name),
            chain: "P",
            residueNumber: residueNumber,
            element: pharmacophoreFeatureSymbol(feature.name)
        )
    }

    private static func pharmacophorePDBAtomLine(
        serial: Int,
        name: String,
        x: Double,
        y: Double,
        z: Double,
        radius: Double,
        atomName: String,
        residueName: String,
        chain: String,
        residueNumber: Int,
        occupancy: Double = 1.0,
        element: String
    ) -> String {
        let formattedAtomName = formatPDBAtomName(atomName, symbol: element)
        let atomNameField = formattedAtomName.padding(toLength: 4, withPad: " ", startingAt: 0)
        let elementField = String(repeating: " ", count: max(0, 2 - element.count)) + truncateASCII(element, maxLength: 2)
        let cleanResidueName = truncateASCII(residueName, maxLength: 3)
        let cleanChain = String((truncateASCII(chain, maxLength: 1).isEmpty ? "P" : truncateASCII(chain, maxLength: 1)).prefix(1))
        _ = name
        return String(
            format: "HETATM%5d %@ %3@ %@%4d    %8.3f%8.3f%8.3f%6.2f%6.2f          %@\n",
            min(serial, 99_999),
            atomNameField,
            cleanResidueName,
            cleanChain,
            min(residueNumber, 9999),
            x,
            y,
            z,
            occupancy,
            radius,
            elementField
        )
    }

    private static func pharmacophoreFeatureSymbol(_ name: String) -> String {
        let lower = name.lowercased()
        if lower.contains("acceptor") || lower.hasPrefix("acc") { return "O" }
        if lower.contains("donor") || lower.hasPrefix("don") { return "N" }
        if lower.contains("positive") || lower.contains("pos") { return "P" }
        if lower.contains("negative") || lower.contains("neg") { return "S" }
        return "C"
    }

    private static func pharmacophoreAtomName(_ name: String) -> String {
        String(name.filter { ($0.isASCII && $0.isLetter) || $0.isNumber }.prefix(4))
    }

    private static func pharmacophoreResidueName(_ name: String) -> String {
        let lower = name.lowercased()
        if lower.contains("acceptor") || lower.hasPrefix("acc") { return "ACC" }
        if lower.contains("donor") || lower.hasPrefix("don") { return "DON" }
        if lower.contains("aromatic") || lower.hasPrefix("aro") { return "ARO" }
        if lower.contains("hydrophobic") || lower.hasPrefix("hyd") { return "HYD" }
        if lower.contains("positive") || lower.contains("pos") { return "POS" }
        if lower.contains("negative") || lower.contains("neg") { return "NEG" }
        return "PH4"
    }

    private static func normalizedPharmacophoreVector(_ value: Any?) -> Vec3? {
        guard let vector = value as? [String: Any],
              let x = vector["x"] as? Double,
              let y = vector["y"] as? Double,
              let z = vector["z"] as? Double else { return nil }
        let length = sqrt(x * x + y * y + z * z)
        guard length > 0.000_001 else { return nil }
        return (x / length, y / length, z / length)
    }

    private static func joinedPDBBlocks(_ blocks: Any?...) -> String? {
        var lines: [String] = []
        for block in blocks {
            guard let text = block as? String else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                let trimmed = String(line).trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
                guard !trimmed.isEmpty, trimmed != "END", trimmed != "ENDMDL" else { continue }
                if trimmed.hasPrefix("ATOM") ||
                    trimmed.hasPrefix("HETATM") ||
                    trimmed.hasPrefix("TER") ||
                    trimmed.hasPrefix("CONECT") {
                    lines.append(trimmed)
                }
            }
        }
        guard !lines.isEmpty else { return nil }
        lines.append("TER")
        return lines.joined(separator: "\n") + "\n"
    }

    private static func maxPDBSerial(_ pdb: String?) -> Int {
        guard let pdb else { return 0 }
        var maxSerial = 0
        for line in pdb.split(separator: "\n", omittingEmptySubsequences: false) {
            guard line.hasPrefix("ATOM") || line.hasPrefix("HETATM"), line.count >= 11 else { continue }
            let start = line.index(line.startIndex, offsetBy: 6)
            let end = line.index(line.startIndex, offsetBy: 11)
            let serial = Int(line[start..<end].trimmingCharacters(in: .whitespaces)) ?? 0
            maxSerial = max(maxSerial, serial)
        }
        return maxSerial
    }

    private static func parseMOEPh4Constraints(_ tokens: [String], featureCount: Int) -> [(Int, Int)] {
        guard var index = tokens.firstIndex(of: "#constraint"),
              index + 1 < tokens.count,
              let count = Int(tokens[index + 1]),
              count > 0 else { return [] }
        index += 2
        while index < tokens.count, tokens[index] != "ids" {
            index += 1
        }
        guard index < tokens.count else { return [] }
        index += 2
        var connectors: [(Int, Int)] = []
        for _ in 0..<count {
            guard index + 4 < tokens.count, !tokens[index].hasPrefix("#") else { break }
            guard let idCount = Int(tokens[index + 2]), idCount >= 2 else { break }
            let left = Int(tokens[index + 3]) ?? 0
            let right = Int(tokens[index + 4]) ?? 0
            if (1...featureCount).contains(left), (1...featureCount).contains(right) {
                connectors.append((left - 1, right - 1))
            }
            index += 3 + idCount
        }
        return connectors
    }

    private static func parseMOEPh4VolumeSpheres(_ tokens: [String]) -> [PharmacophoreSphere] {
        guard var index = tokens.firstIndex(of: "#volumesphere"),
              index + 1 < tokens.count,
              let count = Int(tokens[index + 1]),
              count > 0 else { return [] }
        index += 2
        while index + 7 < tokens.count {
            if tokens[index] == "x",
               tokens[index + 1] == "r",
               tokens[index + 2] == "y",
               tokens[index + 3] == "r",
               tokens[index + 4] == "z",
               tokens[index + 5] == "r",
               tokens[index + 6] == "r",
               tokens[index + 7] == "r" {
                index += 8
                break
            }
            index += 1
        }
        var spheres: [PharmacophoreSphere] = []
        for _ in 0..<count {
            guard index + 3 < tokens.count, !tokens[index].hasPrefix("#"),
                  let x = Double(tokens[index]),
                  let y = Double(tokens[index + 1]),
                  let z = Double(tokens[index + 2]),
                  let radius = Double(tokens[index + 3]) else { break }
            spheres.append(PharmacophoreSphere(x: x, y: y, z: z, radius: radius))
            index += 4
        }
        return spheres
    }

    private static func pdbData(from data: Data, fileExtension: String, label: String) -> Data? {
        guard let atoms = atoms(from: data, fileExtension: fileExtension), !atoms.isEmpty else { return nil }
        return pdbData(from: atoms, label: label)
    }

    private static func pdbData(from atoms: [Atom], label: String) -> Data {
        var pdb = "REMARK Converted from \(label)\n"
        for (index, atom) in atoms.prefix(99_999).enumerated() {
            pdb += genericPDBAtomLine(serial: index + 1, atom: atom)
            pdb += "\n"
        }
        pushPDBConectLines(&pdb, atoms)
        pdb += "END\n"
        return Data(pdb.utf8)
    }

    private static func genericPDBAtomLine(serial: Int, atom: Atom) -> String {
        let symbol = normalizeElementSymbol(atom.symbol)
        let atomName = formatPDBAtomName(symbol, symbol: symbol)
        let atomNameField = atomName.padding(toLength: 4, withPad: " ", startingAt: 0)
        let elementField = String(repeating: " ", count: max(0, 2 - symbol.count)) + truncateASCII(symbol, maxLength: 2)
        return String(
            format: "HETATM%5d %@ MOL A%4d    %8.3f%8.3f%8.3f  1.00 10.00          %@",
            min(serial, 99_999),
            atomNameField,
            1,
            atom.x,
            atom.y,
            atom.z,
            elementField
        )
    }

    private static func pushPDBConectLines(_ pdb: inout String, _ atoms: [Atom]) {
        let bonds = inferPDBBonds(atoms)
        guard !bonds.isEmpty else { return }
        var adjacency = Array(repeating: [Int](), count: min(atoms.count, 99_999))
        for (left, right) in bonds {
            adjacency[left].append(right + 1)
            adjacency[right].append(left + 1)
        }
        for (index, neighbors) in adjacency.enumerated() {
            var start = 0
            while start < neighbors.count {
                let chunk = neighbors[start..<min(start + 4, neighbors.count)]
                pdb += String(format: "CONECT%5d", index + 1)
                for serial in chunk {
                    pdb += String(format: "%5d", serial)
                }
                pdb += "\n"
                start += 4
            }
        }
    }

    private static func inferPDBBonds(_ atoms: [Atom]) -> [(Int, Int)] {
        let limitedAtoms = Array(atoms.prefix(99_999))
        guard limitedAtoms.count <= 2_000 else { return [] }
        var bonds: [(Int, Int)] = []
        for left in limitedAtoms.indices {
            let leftRadius = covalentRadius(limitedAtoms[left].symbol)
            guard leftRadius > 0 else { continue }
            for right in limitedAtoms.index(after: left)..<limitedAtoms.count {
                let rightRadius = covalentRadius(limitedAtoms[right].symbol)
                guard rightRadius > 0 else { continue }
                let dx = limitedAtoms[left].x - limitedAtoms[right].x
                let dy = limitedAtoms[left].y - limitedAtoms[right].y
                let dz = limitedAtoms[left].z - limitedAtoms[right].z
                let distance = sqrt(dx * dx + dy * dy + dz * dz)
                let maxDistance = min(leftRadius + rightRadius + 0.45, 2.25)
                if distance >= 0.35, distance <= maxDistance {
                    bonds.append((left, right))
                }
            }
        }
        return bonds
    }

    private static func covalentRadius(_ symbol: String) -> Double {
        switch normalizeElementSymbol(symbol) {
        case "H": return 0.31
        case "He": return 0.28
        case "Li": return 1.28
        case "Be": return 0.96
        case "B": return 0.84
        case "C": return 0.76
        case "N": return 0.71
        case "O": return 0.66
        case "F": return 0.57
        case "Ne": return 0.58
        case "Na": return 1.66
        case "Mg": return 1.41
        case "Al": return 1.21
        case "Si": return 1.11
        case "P": return 1.07
        case "S": return 1.05
        case "Cl": return 1.02
        case "Ar": return 1.06
        case "K": return 2.03
        case "Ca": return 1.76
        case "Fe": return 1.24
        case "Co": return 1.18
        case "Ni": return 1.17
        case "Cu": return 1.22
        case "Zn": return 1.22
        case "Br": return 1.20
        case "I": return 1.39
        default: return 0.0
        }
    }

    private static func usesPDBTextFallback(_ fileExtension: String) -> Bool {
        ["abi", "cub", "cube", "fdf", "in", "inp", "log", "nw", "out", "psi4", "qcin"].contains(fileExtension.lowercased())
    }

    private static func isGROExtension(_ fileExtension: String) -> Bool {
        fileExtension.lowercased() == "gro"
    }

    private static func isMOL2Extension(_ fileExtension: String) -> Bool {
        fileExtension.lowercased() == "mol2"
    }

    private static func mol2PDBData(from data: Data, label: String) -> Data? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var section = ""
        var atoms: [(id: Int, atom: MaestroAtom)] = []
        var bonds: [(Int, Int)] = []
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("@<TRIPOS>") {
                section = String(trimmed.dropFirst("@<TRIPOS>".count)).uppercased()
                continue
            }
            guard !trimmed.isEmpty else { continue }
            switch section {
            case "ATOM":
                let parts = fields(trimmed)
                guard parts.count >= 6,
                      let id = Int(parts[0]),
                      let x = Double(parts[2]),
                      let y = Double(parts[3]),
                      let z = Double(parts[4]) else {
                    continue
                }
                let atomName = normalizePDBAtomName(parts[1])
                let residueNumber = parts.count >= 7 ? (Int(parts[6]) ?? 1) : 1
                let residueName = parts.count >= 8 ? normalizePDBResidueName(parts[7]) : "MOL"
                let symbol = mol2ElementSymbol(atomName: atomName, atomType: parts[5])
                atoms.append((
                    id: id,
                    atom: MaestroAtom(
                        symbol: symbol,
                        atomName: atomName.isEmpty ? symbol : atomName,
                        residueName: residueName.isEmpty ? "MOL" : residueName,
                        residueNumber: residueNumber,
                        chainName: "A",
                        x: x,
                        y: y,
                        z: z
                    )
                ))
            case "BOND":
                let parts = fields(trimmed)
                guard parts.count >= 4,
                      let left = Int(parts[1]),
                      let right = Int(parts[2]) else {
                    continue
                }
                bonds.append((left, right))
            default:
                continue
            }
        }
        guard !atoms.isEmpty else { return nil }
        var pdb = "REMARK Converted from \(label)\n"
        var serialByID: [Int: Int] = [:]
        for (index, entry) in atoms.prefix(99_999).enumerated() {
            let serial = index + 1
            serialByID[entry.id] = serial
            pdb += maestroPDBAtomLine(serial: serial, atom: entry.atom)
            pdb += "\n"
        }
        pushPDBConectLines(&pdb, bonds: bonds, serialByID: serialByID)
        pdb += "END\n"
        return Data(pdb.utf8)
    }

    private static func pushPDBConectLines(_ pdb: inout String, bonds: [(Int, Int)], serialByID: [Int: Int]) {
        var adjacency: [Int: Set<Int>] = [:]
        for (leftID, rightID) in bonds {
            guard let left = serialByID[leftID], let right = serialByID[rightID], left != right else { continue }
            adjacency[left, default: []].insert(right)
            adjacency[right, default: []].insert(left)
        }
        for serial in adjacency.keys.sorted() {
            let neighbors = Array(adjacency[serial] ?? []).sorted()
            var start = 0
            while start < neighbors.count {
                let chunk = neighbors[start..<min(start + 4, neighbors.count)]
                pdb += String(format: "CONECT%5d", serial)
                for neighbor in chunk {
                    pdb += String(format: "%5d", neighbor)
                }
                pdb += "\n"
                start += 4
            }
        }
    }

    private static func mol2ElementSymbol(atomName: String, atomType: String) -> String {
        let typeSymbol = atomType.split(separator: ".").first.map(String.init) ?? ""
        let normalizedType = normalizeElementSymbol(typeSymbol)
        if isElementSymbol(normalizedType) { return normalizedType }
        let letters = atomName.filter { $0.isASCII && $0.isLetter }
        if letters.count >= 2 {
            let two = normalizeElementSymbol(String(letters.prefix(2)))
            if isElementSymbol(two) { return two }
        }
        if let first = letters.first {
            let one = normalizeElementSymbol(String(first))
            if isElementSymbol(one) { return one }
        }
        return "X"
    }

    private static func groPDBData(from data: Data, label: String) -> Data? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let atoms = parseGROAtoms(lines, atomLimit: 99_999), !atoms.isEmpty else { return nil }
        var pdb = "REMARK Converted from \(label)\n"
        for (index, atom) in atoms.enumerated() {
            pdb += maestroPDBAtomLine(serial: index + 1, atom: atom)
            pdb += "\n"
        }
        pdb += "END\n"
        return Data(pdb.utf8)
    }

    private static func parseGROAtoms(_ lines: [String], atomLimit: Int) -> [MaestroAtom]? {
        guard lines.count >= 3,
              let declaredAtomCount = Int(lines[1].trimmingCharacters(in: .whitespacesAndNewlines)),
              declaredAtomCount > 0 else { return nil }
        let rows = min(declaredAtomCount, max(0, lines.count - 2), atomLimit)
        var atoms: [MaestroAtom] = []
        atoms.reserveCapacity(min(rows, atomLimit))
        for index in 0..<rows {
            guard let atom = parseGROAtomLine(lines[2 + index]) else { continue }
            atoms.append(atom)
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func parseGROAtomLine(_ line: String) -> MaestroAtom? {
        guard line.count >= 44 else { return nil }
        let residueNumber = Int(fixedGROField(line, start: 0, length: 5).trimmingCharacters(in: .whitespacesAndNewlines)) ?? 1
        let residueName = normalizeGROResidueName(fixedGROField(line, start: 5, length: 5))
        let atomName = normalizePDBAtomName(fixedGROField(line, start: 10, length: 5))
        guard let x = Double(fixedGROField(line, start: 20, length: 8).trimmingCharacters(in: .whitespacesAndNewlines)),
              let y = Double(fixedGROField(line, start: 28, length: 8).trimmingCharacters(in: .whitespacesAndNewlines)),
              let z = Double(fixedGROField(line, start: 36, length: 8).trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        let symbol = groElementSymbol(atomName: atomName, residueName: residueName)
        return MaestroAtom(
            symbol: symbol,
            atomName: atomName.isEmpty ? symbol : atomName,
            residueName: residueName.isEmpty ? "MOL" : residueName,
            residueNumber: residueNumber,
            chainName: "A",
            x: x * 10.0,
            y: y * 10.0,
            z: z * 10.0
        )
    }

    private static func fixedGROField(_ line: String, start: Int, length: Int) -> String {
        let startIndex = line.index(line.startIndex, offsetBy: min(start, line.count))
        let endIndex = line.index(startIndex, offsetBy: min(length, line.distance(from: startIndex, to: line.endIndex)))
        return String(line[startIndex..<endIndex])
    }

    private static func normalizeGROResidueName(_ value: String) -> String {
        let cleaned = truncateASCII(value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), maxLength: 4)
        if cleaned.count > 3 {
            let suffix = String(cleaned.suffix(3))
            if isStandardPolymerResidue(suffix) { return suffix }
        }
        return String(cleaned.prefix(3))
    }

    private static func groElementSymbol(atomName: String, residueName: String) -> String {
        let letters = atomName.filter { $0.isASCII && $0.isLetter }.uppercased()
        guard let first = letters.first else { return "X" }
        if letters.count >= 2 {
            let two = String(letters.prefix(2))
            if ["CL", "BR", "NA", "MG", "ZN", "FE", "CU", "MN", "CO"].contains(two) {
                return normalizeElementSymbol(two)
            }
            if two == "CA", !isStandardPolymerResidue(residueName) {
                return "Ca"
            }
        }
        return normalizeElementSymbol(String(first))
    }

    private static func maestroPDBData(from atoms: [MaestroAtom], remark: String) -> Data {
        var pdb = "REMARK \(remark)\n"
        for (index, atom) in atoms.prefix(99_999).enumerated() {
            pdb += maestroPDBAtomLine(serial: index + 1, atom: atom)
            pdb += "\n"
        }
        pdb += "END\n"
        return Data(pdb.utf8)
    }

    private static func maestroPDBBundle(from data: Data) -> MaestroPDBBundle? {
        let text = decodeText(data)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        return parseMaestroPDBBundle(lines, atomLimit: 99_999)
    }

    private static func parseMaestroPDBBundle(_ lines: [String], atomLimit: Int) -> MaestroPDBBundle? {
        var index = 0
        var bestCandidate: MaestroPDBCandidate?
        var bestSolventCandidate: MaestroPDBCandidate?
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("m_atom["), trimmed.hasSuffix("{") else {
                index += 1
                continue
            }
            index += 1

            var headers: [String] = []
            var hasImplicitAtomIndex = false
            while index < lines.count {
                let headerLine = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
                index += 1
                if headerLine == ":::" { break }
                if headerLine.hasPrefix("#") {
                    hasImplicitAtomIndex = hasImplicitAtomIndex || headerLine.lowercased().contains("first column is atom index")
                    continue
                }
                if headerLine == "}" {
                    headers.removeAll()
                    break
                }
                headers += fields(headerLine)
            }
            guard !headers.isEmpty,
                  let xIndex = maestroHeaderIndex(headers, "r_m_x_coord"),
                  let yIndex = maestroHeaderIndex(headers, "r_m_y_coord"),
                  let zIndex = maestroHeaderIndex(headers, "r_m_z_coord") else {
                continue
            }
            let atomicNumberIndex = maestroHeaderIndex(headers, "i_m_atomic_number")
            let elementIndex = maestroHeaderIndex(headers, "s_m_element") ?? maestroHeaderIndex(headers, "s_m_pdb_element")
            let atomNameIndex = maestroHeaderIndex(headers, "s_m_atom_name") ?? maestroHeaderIndex(headers, "s_m_pdb_atom_name")
            let pdbAtomNameIndex = maestroHeaderIndex(headers, "s_m_pdb_atom_name") ?? atomNameIndex
            let residueNameIndex = maestroHeaderIndex(headers, "s_m_pdb_residue_name") ?? maestroHeaderIndex(headers, "s_m_mmod_res")
            let residueNumberIndex = maestroHeaderIndex(headers, "i_m_residue_number")
            let chainNameIndex = maestroHeaderIndex(headers, "s_m_chain_name")
            let rowOffset = hasImplicitAtomIndex ? 1 : 0
            var atoms: [MaestroAtom] = []

            while index < lines.count {
                let rowLine = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
                index += 1
                if rowLine == ":::" || rowLine == "}" { break }
                if rowLine.isEmpty { continue }
                let row = maestroTokens(rowLine)
                guard let x = rowValue(row, xIndex + rowOffset).flatMap(Double.init),
                      let y = rowValue(row, yIndex + rowOffset).flatMap(Double.init),
                      let z = rowValue(row, zIndex + rowOffset).flatMap(Double.init),
                      let symbol = maestroAtomSymbol(
                        row,
                        rowOffset: rowOffset,
                        atomicNumberIndex: atomicNumberIndex,
                        elementIndex: elementIndex,
                        atomNameIndex: atomNameIndex
                      ) else {
                    continue
                }
                var atomName = symbol
                if let pdbAtomNameIndex,
                   let value = rowValue(row, pdbAtomNameIndex + rowOffset) {
                    let normalized = normalizePDBAtomName(value)
                    if !normalized.isEmpty { atomName = normalized }
                }
                var residueName = "MOL"
                if let residueNameIndex,
                   let value = rowValue(row, residueNameIndex + rowOffset) {
                    let normalized = normalizePDBResidueName(value)
                    if !normalized.isEmpty { residueName = normalized }
                }
                let residueNumber = residueNumberIndex
                    .flatMap { rowValue(row, $0 + rowOffset) }
                    .flatMap(Int.init) ?? 1
                let chainName = chainNameIndex
                    .flatMap { rowValue(row, $0 + rowOffset) }
                    .flatMap { $0.first(where: { $0.isASCII && $0.isLetter || $0.isNumber }) }
                    .map(String.init) ?? "A"
                atoms.append(MaestroAtom(
                    symbol: symbol,
                    atomName: atomName,
                    residueName: residueName,
                    residueNumber: residueNumber,
                    chainName: chainName,
                    x: x,
                    y: y,
                    z: z
                ))
                if atoms.count >= atomLimit { break }
            }
            if let candidate = maestroPDBCandidate(from: atoms),
               isBetterMaestroPDBCandidate(candidate, than: bestCandidate) {
                bestCandidate = candidate
            }
            if let candidate = maestroPDBCandidate(from: atoms),
               isBetterMaestroSolventCandidate(candidate, than: bestSolventCandidate) {
                bestSolventCandidate = candidate
            }
        }
        guard let bestCandidate else { return nil }
        return MaestroPDBBundle(
            primaryAtoms: bestCandidate.atoms,
            solventAtoms: bestSolventCandidate?.solventAtoms ?? bestCandidate.solventAtoms
        )
    }

    private static func maestroPDBCandidate(from atoms: [MaestroAtom]) -> MaestroPDBCandidate? {
        let solventAtoms = atoms.filter { isSolventAtom($0) }
        let previewAtoms = atoms.filter { !isSolventAtom($0) }
        guard !previewAtoms.isEmpty else { return nil }
        let proteinAtomCount = previewAtoms.filter { isStandardPolymerResidue($0.residueName) }.count
        return MaestroPDBCandidate(
            atoms: previewAtoms,
            solventAtoms: solventAtoms,
            proteinAtomCount: proteinAtomCount,
            omittedSolventAtomCount: solventAtoms.count,
            nonWaterAtomCount: previewAtoms.count
        )
    }

    private static func isBetterMaestroPDBCandidate(
        _ candidate: MaestroPDBCandidate,
        than current: MaestroPDBCandidate?
    ) -> Bool {
        guard let current else { return true }
        if candidate.proteinAtomCount != current.proteinAtomCount {
            return candidate.proteinAtomCount > current.proteinAtomCount
        }
        if candidate.omittedSolventAtomCount != current.omittedSolventAtomCount {
            return candidate.omittedSolventAtomCount < current.omittedSolventAtomCount
        }
        if candidate.nonWaterAtomCount != current.nonWaterAtomCount {
            return candidate.nonWaterAtomCount > current.nonWaterAtomCount
        }
        return candidate.atoms.count > current.atoms.count
    }

    private static func isBetterMaestroSolventCandidate(
        _ candidate: MaestroPDBCandidate,
        than current: MaestroPDBCandidate?
    ) -> Bool {
        guard let current else { return !candidate.solventAtoms.isEmpty }
        if candidate.solventAtoms.count != current.solventAtoms.count {
            return candidate.solventAtoms.count > current.solventAtoms.count
        }
        if candidate.proteinAtomCount != current.proteinAtomCount {
            return candidate.proteinAtomCount > current.proteinAtomCount
        }
        return candidate.atoms.count > current.atoms.count
    }

    private static func parseMaestroAtoms(_ lines: [String], atomLimit: Int) -> [Atom]? {
        var index = 0
        var bestAtoms: [Atom]?
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("m_atom["), trimmed.hasSuffix("{") else {
                index += 1
                continue
            }
            index += 1

            var headers: [String] = []
            var hasImplicitAtomIndex = false
            while index < lines.count {
                let headerLine = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
                index += 1
                if headerLine == ":::" { break }
                if headerLine.hasPrefix("#") {
                    hasImplicitAtomIndex = hasImplicitAtomIndex || headerLine.lowercased().contains("first column is atom index")
                    continue
                }
                if headerLine == "}" {
                    headers.removeAll()
                    break
                }
                headers += fields(headerLine)
            }
            guard !headers.isEmpty,
                  let xIndex = maestroHeaderIndex(headers, "r_m_x_coord"),
                  let yIndex = maestroHeaderIndex(headers, "r_m_y_coord"),
                  let zIndex = maestroHeaderIndex(headers, "r_m_z_coord") else {
                continue
            }
            let atomicNumberIndex = maestroHeaderIndex(headers, "i_m_atomic_number")
            let elementIndex = maestroHeaderIndex(headers, "s_m_element") ?? maestroHeaderIndex(headers, "s_m_pdb_element")
            let atomNameIndex = maestroHeaderIndex(headers, "s_m_atom_name") ?? maestroHeaderIndex(headers, "s_m_pdb_atom_name")
            let rowOffset = hasImplicitAtomIndex ? 1 : 0
            var atoms: [Atom] = []

            while index < lines.count {
                let rowLine = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
                index += 1
                if rowLine == ":::" || rowLine == "}" { break }
                if rowLine.isEmpty { continue }
                let row = maestroTokens(rowLine)
                guard let x = rowValue(row, xIndex + rowOffset).flatMap(Double.init),
                      let y = rowValue(row, yIndex + rowOffset).flatMap(Double.init),
                      let z = rowValue(row, zIndex + rowOffset).flatMap(Double.init),
                      let symbol = maestroAtomSymbol(
                        row,
                        rowOffset: rowOffset,
                        atomicNumberIndex: atomicNumberIndex,
                        elementIndex: elementIndex,
                        atomNameIndex: atomNameIndex
                      ) else {
                    continue
                }
                atoms.append(Atom(symbol: symbol, x: x, y: y, z: z))
                if atoms.count >= atomLimit { break }
            }
            if !atoms.isEmpty, atoms.count > (bestAtoms?.count ?? 0) {
                bestAtoms = atoms
            }
        }
        return bestAtoms
    }

    private static func maestroHeaderIndex(_ headers: [String], _ name: String) -> Int? {
        headers.firstIndex { $0.caseInsensitiveCompare(name) == .orderedSame }
    }

    private static func maestroTokens(_ line: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var quote: Character?
        var escaped = false
        for character in line {
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
            if character == " " || character == "\t" {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
                continue
            }
            current.append(character)
        }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    private static func rowValue(_ row: [String], _ index: Int) -> String? {
        guard index >= 0, index < row.count else { return nil }
        let value = row[index].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value == "<>" ? nil : value
    }

    private static func maestroAtomSymbol(
        _ row: [String],
        rowOffset: Int,
        atomicNumberIndex: Int?,
        elementIndex: Int?,
        atomNameIndex: Int?
    ) -> String? {
        if let atomicNumberIndex,
           let value = rowValue(row, atomicNumberIndex + rowOffset),
           let atomicNumber = Int(value) {
            return symbol(for: atomicNumber)
        }
        if let elementIndex,
           let value = rowValue(row, elementIndex + rowOffset) {
            let normalized = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'")).capitalized
            if isElementSymbol(normalized) { return normalized }
        }
        if let atomNameIndex,
           let value = rowValue(row, atomNameIndex + rowOffset) {
            let letters = value.filter { $0.isLetter }
            if let first = letters.first {
                let one = String(first).capitalized
                if isElementSymbol(one) { return one }
                if letters.count >= 2 {
                    let two = String(letters.prefix(2)).capitalized
                    if isElementSymbol(two) { return two }
                }
            }
        }
        return nil
    }

    private static func maestroPDBAtomLine(serial: Int, atom: MaestroAtom) -> String {
        let residueName = isWaterResidue(atom.residueName) ? "HOH" : truncateASCII(atom.residueName, maxLength: 3)
        let atomName = formatPDBAtomName(atom.atomName, symbol: atom.symbol)
        let chain = truncateASCII(atom.chainName, maxLength: 1)
        let record = isStandardPolymerResidue(residueName) ? "ATOM" : "HETATM"
        let recordField = record.padding(toLength: 6, withPad: " ", startingAt: 0)
        let atomNameField = atomName.padding(toLength: 4, withPad: " ", startingAt: 0)
        let residueNameField = String(repeating: " ", count: max(0, 3 - residueName.count)) + residueName
        let chainField = chain.isEmpty ? "A" : chain
        let elementField = String(repeating: " ", count: max(0, 2 - atom.symbol.count)) + truncateASCII(atom.symbol, maxLength: 2)
        return String(
            format: "%@%5d %@ %@ %@%4d    %8.3f%8.3f%8.3f  1.00 10.00          %@",
            recordField,
            min(serial, 99_999),
            atomNameField,
            residueNameField,
            chainField,
            min(max(atom.residueNumber, -999), 9999),
            atom.x,
            atom.y,
            atom.z,
            elementField
        )
    }

    private static func formatPDBAtomName(_ atomName: String, symbol: String) -> String {
        let cleaned = String(atomName.filter { ($0.isASCII && $0.isLetter) || $0.isNumber }.prefix(4))
        return cleaned.isEmpty ? symbol : cleaned
    }

    private static func truncateASCII(_ value: String, maxLength: Int) -> String {
        String(value.filter { ($0.isASCII && $0.isLetter) || $0.isNumber }.prefix(maxLength))
    }

    private static func normalizePDBAtomName(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'")))
    }

    private static func normalizePDBResidueName(_ value: String) -> String {
        String(normalizePDBAtomName(value)
            .filter { ($0.isASCII && $0.isLetter) || $0.isNumber }
            .prefix(3))
            .uppercased()
    }

    private static func isStandardPolymerResidue(_ residueName: String) -> Bool {
        [
            "ALA", "ARG", "ASN", "ASP", "CYS", "CYX", "GLN", "GLU", "GLY", "HIS",
            "HID", "HIE", "HIP", "ILE", "LEU", "LYS", "MET", "PHE", "PRO", "SER",
            "THR", "TRP", "TYR", "VAL"
        ].contains(residueName)
    }

    private static func isWaterResidue(_ residueName: String) -> Bool {
        let normalized = normalizePDBResidueName(residueName)
        return ["HOH", "WAT", "H2O", "SOL", "T3P", "TP3", "SPC", "TIP"].contains(normalized)
            || normalized.hasPrefix("TIP")
    }

    private static func isSolventAtom(_ atom: MaestroAtom) -> Bool {
        isWaterResidue(atom.residueName) || isIonResidue(atom.residueName, symbol: atom.symbol)
    }

    private static func isIonResidue(_ residueName: String, symbol: String) -> Bool {
        let normalizedResidue = normalizePDBResidueName(residueName)
        let normalizedSymbol = symbol.trimmingCharacters(in: .whitespacesAndNewlines).capitalized
        return [
            "LI", "NA", "K", "RB", "CS", "MG", "CA", "SR", "BA",
            "ZN", "MN", "FE", "CO", "NI", "CU", "CL", "BR", "IOD"
        ].contains(normalizedResidue) || [
            "Li", "Na", "K", "Rb", "Cs", "Mg", "Ca", "Sr", "Ba",
            "Zn", "Mn", "Fe", "Co", "Ni", "Cu", "Cl", "Br", "I"
        ].contains(normalizedSymbol)
    }

    private static func isMaestroExtension(_ fileExtension: String) -> Bool {
        ["cms", "mae", "maegz"].contains(fileExtension.lowercased())
    }

    private static func parseCube(_ lines: [String]) -> [Atom]? {
        guard lines.count >= 6 else { return nil }
        let countFields = fields(lines[2])
        guard let atomCountToken = countFields.first, let atomCount = Int(atomCountToken), atomCount != 0 else { return nil }
        let count = abs(atomCount)
        guard lines.count >= 6 + count else { return nil }
        let axisCounts = (3...5).compactMap { index in
            fields(lines[index]).first.flatMap(Int.init)
        }
        guard axisCounts.count == 3 else { return nil }
        let coordinateScale = axisCounts.allSatisfy { $0 > 0 } ? 0.529177210903 : 1.0
        return (0..<count).compactMap { index in
            let parts = fields(lines[6 + index])
            guard parts.count >= 5, let number = Int(parts[0]),
                  let x = Double(parts[2]), let y = Double(parts[3]), let z = Double(parts[4]) else { return nil }
            return Atom(symbol: symbol(for: number), x: x * coordinateScale, y: y * coordinateScale, z: z * coordinateScale)
        }
    }

    private static func parseABINIT(_ lines: [String]) -> [Atom]? {
        var atomCount: Int?
        var atomicNumbers: [Int] = []
        var typeIndices: [Int] = []
        var coordinateStart: Int?

        for (index, line) in lines.enumerated() {
            let parts = fields(stripInlineComment(line))
            guard let key = parts.first?.lowercased() else { continue }
            switch key {
            case "natom":
                if parts.count >= 2 { atomCount = Int(parts[1]) }
            case "znucl":
                atomicNumbers += parts.dropFirst().compactMap(Int.init)
            case "typat":
                typeIndices += parts.dropFirst().compactMap(Int.init)
            case "xangst":
                coordinateStart = index + 1
            default:
                continue
            }
        }

        guard let atomCount, atomCount > 0,
              !atomicNumbers.isEmpty,
              typeIndices.count >= atomCount,
              let coordinateStart,
              coordinateStart + atomCount <= lines.count else {
            return nil
        }

        var atoms: [Atom] = []
        for index in 0..<atomCount {
            let parts = fields(stripInlineComment(lines[coordinateStart + index]))
            guard parts.count >= 3,
                  let x = Double(parts[0]),
                  let y = Double(parts[1]),
                  let z = Double(parts[2]) else {
                continue
            }
            let typeIndex = typeIndices[index] - 1
            guard typeIndex >= 0, typeIndex < atomicNumbers.count else { continue }
            atoms.append(Atom(symbol: symbol(for: atomicNumbers[typeIndex]), x: x, y: y, z: z))
        }
        return atoms.count == atomCount ? atoms : nil
    }

    private static func parseFDF(_ lines: [String]) -> [Atom]? {
        let speciesRows = blockRows(named: "ChemicalSpeciesLabel", in: lines)
        var speciesByID: [Int: String] = [:]
        for row in speciesRows {
            let parts = fields(row)
            guard parts.count >= 2, let speciesID = Int(parts[0]), let atomicNumber = Int(parts[1]) else { continue }
            let explicitSymbol = parts.count >= 3 ? normalizeElementSymbol(parts[2]) : ""
            speciesByID[speciesID] = isElementSymbol(explicitSymbol) ? explicitSymbol : symbol(for: atomicNumber)
        }
        guard !speciesByID.isEmpty else { return nil }

        let coordinateScale = fdfCoordinateScale(lines)
        let coordinateRows = blockRows(named: "AtomicCoordinatesAndAtomicSpecies", in: lines)
        let atoms = coordinateRows.compactMap { row -> Atom? in
            let parts = fields(row)
            guard parts.count >= 4,
                  let x = Double(parts[0]),
                  let y = Double(parts[1]),
                  let z = Double(parts[2]),
                  let speciesID = Int(parts[3]),
                  let symbol = speciesByID[speciesID] else { return nil }
            return Atom(symbol: symbol, x: x * coordinateScale, y: y * coordinateScale, z: z * coordinateScale)
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func blockRows(named blockName: String, in lines: [String]) -> [String] {
        var rows: [String] = []
        var inside = false
        let normalizedBlockName = blockName.lowercased()
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            let parts = fields(trimmed)
            let marker = parts.first?.lowercased()
            let name = parts.count >= 2 ? parts[1].lowercased() : ""
            if marker == "%block", name == normalizedBlockName {
                inside = true
                continue
            }
            if marker == "%endblock", name == normalizedBlockName {
                break
            }
            if inside, !trimmed.isEmpty, !trimmed.hasPrefix("#") {
                rows.append(trimmed)
            }
        }
        return rows
    }

    private static func fdfCoordinateScale(_ lines: [String]) -> Double {
        for line in lines {
            let parts = fields(line)
            guard parts.count >= 2, parts[0].caseInsensitiveCompare("AtomicCoordinatesFormat") == .orderedSame else {
                continue
            }
            return parts[1].lowercased().contains("bohr") ? 0.529177210903 : 1.0
        }
        return 1.0
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

    private static func parseQSiteGeometry(_ lines: [String]) -> [Atom]? {
        guard let geometryStart = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare("geometry") == .orderedSame }) else {
            return nil
        }
        var atoms: [Atom] = []
        for line in lines[(geometryStart + 1)...] {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.caseInsensitiveCompare("end") == .orderedSame { break }
            let parts = fields(trimmed)
            guard parts.count >= 4,
                  let atomicNumber = Int(parts[0]),
                  let x = Double(parts[1]),
                  let y = Double(parts[2]),
                  let z = Double(parts[3]) else {
                continue
            }
            atoms.append(Atom(symbol: symbol(for: atomicNumber), x: x, y: y, z: z))
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

    private static func parseBestCoordinateBlock(_ lines: [String]) -> [Atom]? {
        var best: [Atom] = []
        var current: [Atom] = []
        func finishCurrentBlock() {
            if current.count > best.count { best = current }
            current.removeAll(keepingCapacity: true)
        }
        for line in lines {
            if let atom = parseElementCoordinateLine(line) {
                current.append(atom)
            } else {
                finishCurrentBlock()
            }
        }
        finishCurrentBlock()
        return best.count >= 2 ? best : nil
    }

    private static func parseAmberRestart(_ lines: [String]) -> [Atom]? {
        guard lines.count >= 2,
              let atomCountText = fields(lines[1]).first,
              let atomCount = Int(atomCountText),
              atomCount > 0 else {
            return nil
        }
        var values: [Double] = []
        values.reserveCapacity(atomCount * 3)
        for line in lines.dropFirst(2) {
            for token in fields(line) {
                guard let value = Double(token) else { continue }
                values.append(value)
                if values.count >= atomCount * 3 { break }
            }
            if values.count >= atomCount * 3 { break }
        }
        guard values.count >= atomCount * 3 else { return nil }
        return (0..<atomCount).map { index in
            Atom(symbol: "C", x: values[index * 3], y: values[index * 3 + 1], z: values[index * 3 + 2])
        }
    }

    private static func parseCharmmCoordinates(_ lines: [String]) -> [Atom]? {
        var atoms: [Atom] = []
        for line in lines {
            let parts = fields(line)
            guard parts.count >= 7,
                  let x = Double(parts[4]),
                  let y = Double(parts[5]),
                  let z = Double(parts[6]) else {
                continue
            }
            let symbol = elementSymbol(fromAtomName: parts[3])
                ?? elementSymbol(fromAtomName: parts[2])
                ?? "C"
            atoms.append(Atom(symbol: symbol, x: x, y: y, z: z))
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func parseLammpsDump(_ lines: [String]) -> [Atom]? {
        parseLammpsDumpFrames(lines).first
    }

    private static func parseAtomeyeCFG(_ lines: [String]) -> [Atom]? {
        guard let atomCount = atomeyeCFGAtomCount(lines),
              let h0 = atomeyeCFGH0(lines),
              let entryCount = atomeyeCFGEntryCount(lines),
              entryCount > 0,
              let entryStart = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("entry_count") }).map({ $0 + 1 }) else {
            return nil
        }
        let scale = atomeyeCFGScale(lines) ?? 1
        var atoms: [Atom] = []
        var index = entryStart
        while atoms.count < atomCount, index + entryCount <= lines.count {
            let entry = Array(lines[index..<(index + entryCount)])
            index += entryCount
            let symbol = entry.compactMap(elementSymbol(fromAtomName:)).first ?? "C"
            guard let fractional = entry.reversed().compactMap({ values -> Vec3? in
                let numbers = numericTokens(values)
                guard numbers.count >= 3 else { return nil }
                return (numbers[0], numbers[1], numbers[2])
            }).first else {
                return nil
            }
            atoms.append(Atom(
                symbol: symbol,
                x: scale * (h0[0][0] * fractional.0 + h0[0][1] * fractional.1 + h0[0][2] * fractional.2),
                y: scale * (h0[1][0] * fractional.0 + h0[1][1] * fractional.1 + h0[1][2] * fractional.2),
                z: scale * (h0[2][0] * fractional.0 + h0[2][1] * fractional.1 + h0[2][2] * fractional.2)
            ))
        }
        return atoms.count == atomCount ? atoms : nil
    }

    private static func atomeyeCFGAtomCount(_ lines: [String]) -> Int? {
        for line in lines {
            let parts = line.components(separatedBy: "=")
            guard parts.count == 2,
                  parts[0].trimmingCharacters(in: .whitespaces) == "Number of particles" else { continue }
            return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    private static func atomeyeCFGScale(_ lines: [String]) -> Double? {
        for line in lines {
            let parts = line.components(separatedBy: "=")
            guard parts.count == 2,
                  parts[0].trimmingCharacters(in: .whitespaces) == "A" else { continue }
            guard let first = fields(parts[1]).first else { continue }
            return Double(first)
        }
        return nil
    }

    private static func atomeyeCFGEntryCount(_ lines: [String]) -> Int? {
        for line in lines {
            let parts = line.components(separatedBy: "=")
            guard parts.count == 2,
                  parts[0].trimmingCharacters(in: .whitespaces) == "entry_count" else { continue }
            return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    private static func atomeyeCFGH0(_ lines: [String]) -> [[Double]]? {
        var h0 = Array(repeating: Array(repeating: 0.0, count: 3), count: 3)
        var seen = 0
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("H0("),
                  let close = trimmed.firstIndex(of: ")"),
                  let equals = trimmed.firstIndex(of: "=") else { continue }
            let indices = trimmed[trimmed.index(trimmed.startIndex, offsetBy: 3)..<close]
                .split(separator: ",")
                .compactMap { Int(String($0).trimmingCharacters(in: .whitespaces)) }
            guard indices.count == 2,
                  indices[0] >= 1, indices[0] <= 3,
                  indices[1] >= 1, indices[1] <= 3,
                  let value = fields(String(trimmed[trimmed.index(after: equals)...])).first.flatMap(Double.init) else { continue }
            h0[indices[0] - 1][indices[1] - 1] = value
            seen += 1
        }
        return seen == 9 ? h0 : nil
    }

    private static func parseLammpsData(_ lines: [String]) -> [Atom]? {
        let masses = parseLammpsMasses(lines)
        var inAtoms = false
        var atoms: [Atom] = []
        for line in lines {
            let parts = fields(stripInlineComment(line))
            guard let first = parts.first else { continue }
            if first.lowercased() == "atoms" {
                inAtoms = true
                continue
            }
            if inAtoms, first.first?.isLetter == true { break }
            guard inAtoms, parts.count >= 5 else { continue }
            guard let coordinates = lammpsDataCoordinates(parts, masses: masses) else { continue }
            atoms.append(Atom(
                symbol: lammpsDataAtomSymbol(parts, masses: masses),
                x: coordinates.0,
                y: coordinates.1,
                z: coordinates.2
            ))
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func parseLammpsMasses(_ lines: [String]) -> [String: String] {
        var masses: [String: String] = [:]
        var inMasses = false
        for line in lines {
            let parts = fields(stripInlineComment(line))
            guard let first = parts.first else { continue }
            if first.lowercased() == "masses" {
                inMasses = true
                continue
            }
            if inMasses, first.first?.isLetter == true { break }
            guard inMasses, parts.count >= 2 else { continue }
            let symbol = (parts.count > 2 ? elementSymbol(fromAtomName: parts[2]) : nil)
                ?? lammpsSymbol(fromMass: parts[1])
            if let symbol {
                masses[parts[0]] = symbol
            }
        }
        return masses
    }

    private static func lammpsDataAtomSymbol(_ parts: [String], masses: [String: String]) -> String {
        (parts.count > 1 ? masses[parts[1]] : nil)
            ?? (parts.count > 2 ? masses[parts[2]] : nil)
            ?? (parts.count > 1 ? elementSymbol(fromAtomName: parts[1]) : nil)
            ?? (parts.count > 2 ? elementSymbol(fromAtomName: parts[2]) : nil)
            ?? "C"
    }

    private static func lammpsDataCoordinates(_ parts: [String], masses: [String: String]) -> Vec3? {
        var starts: [Int] = []
        if parts.count > 2, masses[parts[2]] != nil { starts.append(4) }
        if parts.count > 1, masses[parts[1]] != nil { starts += [3, 2] }
        starts += [3, 4, 2]
        for start in starts where start + 2 < parts.count {
            guard let x = Double(parts[start]),
                  let y = Double(parts[start + 1]),
                  let z = Double(parts[start + 2]) else {
                continue
            }
            return (x, y, z)
        }
        return nil
    }

    private static func lammpsSymbol(fromMass value: String) -> String? {
        guard let mass = Double(value) else { return nil }
        let masses: [(Double, String)] = [
            (1.008, "H"),
            (12.011, "C"),
            (14.007, "N"),
            (15.999, "O"),
            (18.998, "F"),
            (22.990, "Na"),
            (24.305, "Mg"),
            (30.974, "P"),
            (32.06, "S"),
            (35.45, "Cl"),
            (39.098, "K"),
            (40.078, "Ca"),
            (55.845, "Fe"),
            (63.546, "Cu"),
            (65.38, "Zn"),
            (79.904, "Br"),
            (126.904, "I")
        ]
        return masses.first { abs(mass - $0.0) <= 0.35 }?.1
    }

    private static func parseLammpsDumpFrames(_ lines: [String]) -> [[Atom]] {
        var frames: [[Atom]] = []
        var index = 0
        while index < lines.count && frames.count < 100_000 {
            let line = lines[index]
            guard line.hasPrefix("ITEM: ATOMS") else {
                index += 1
                continue
            }

            let columns = fields(String(line.dropFirst("ITEM: ATOMS".count)))
            guard let xIndex = coordinateColumnIndex(columns, ["x", "xu", "xs", "xsu"]),
                  let yIndex = coordinateColumnIndex(columns, ["y", "yu", "ys", "ysu"]),
                  let zIndex = coordinateColumnIndex(columns, ["z", "zu", "zs", "zsu"]) else {
                index += 1
                continue
            }
            let symbolIndex = coordinateColumnIndex(columns, ["element", "symbol", "name"])
            let typeIndex = coordinateColumnIndex(columns, ["type"])
            var atoms: [Atom] = []
            index += 1

            while index < lines.count && !lines[index].hasPrefix("ITEM: ") {
                let line = lines[index]
                index += 1
                let parts = fields(line)
                guard xIndex < parts.count, yIndex < parts.count, zIndex < parts.count,
                      let x = Double(parts[xIndex]),
                      let y = Double(parts[yIndex]),
                      let z = Double(parts[zIndex]) else {
                    continue
                }
                let symbol = symbolIndex.flatMap { $0 < parts.count ? elementSymbol(fromAtomName: parts[$0]) : nil }
                    ?? typeIndex.flatMap { $0 < parts.count ? elementSymbol(fromAtomName: parts[$0]) : nil }
                    ?? "C"
                atoms.append(Atom(symbol: symbol, x: x, y: y, z: z))
            }

            if !atoms.isEmpty { frames.append(atoms) }
        }
        return frames
    }

    private static func coordinateColumnIndex(_ columns: [String], _ names: [String]) -> Int? {
        columns.firstIndex { column in
            names.contains(column.lowercased())
        }
    }

    private static func parseXMLPositions(_ text: String) -> [Atom]? {
        var atoms: [Atom] = []
        let pattern = #"<Position\b([^>]*)/?>"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in expression.matches(in: text, options: [], range: range) {
            guard match.numberOfRanges > 1,
                  let attributesRange = Range(match.range(at: 1), in: text) else {
                continue
            }
            let attributes = String(text[attributesRange])
            guard let x = xmlNumberAttribute(attributes, "x"),
                  let y = xmlNumberAttribute(attributes, "y"),
                  let z = xmlNumberAttribute(attributes, "z") else {
                continue
            }
            atoms.append(Atom(symbol: "C", x: x, y: y, z: z))
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func parseHOOMDXMLAtoms(_ text: String) -> [Atom]? {
        let lower = text.lowercased()
        guard lower.contains("<hoomd_xml") || lower.contains("<configuration") else { return nil }
        guard let positionText = xmlTextBlock(text, "position") else { return nil }
        let values = numericTokens(positionText)
        guard values.count >= 3 else { return nil }
        let typeSymbols = xmlTextBlock(text, "type")
            .map { fields($0).map { elementSymbol(fromAtomName: $0) ?? "C" } }
            ?? []
        var atoms: [Atom] = []
        var index = 0
        while index + 2 < values.count {
            let symbolIndex = atoms.count
            atoms.append(Atom(
                symbol: symbolIndex < typeSymbols.count ? typeSymbols[symbolIndex] : "C",
                x: values[index],
                y: values[index + 1],
                z: values[index + 2]
            ))
            index += 3
        }
        return atoms.isEmpty ? nil : atoms
    }

    private static func xmlTextBlock(_ text: String, _ tagName: String) -> String? {
        let escapedTag = NSRegularExpression.escapedPattern(for: tagName)
        let pattern = "<\(escapedTag)\\b[^>]*>([\\s\\S]*?)</\(escapedTag)>"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges > 1,
              let bodyRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[bodyRange])
    }

    private static func numericTokens(_ text: String) -> [Double] {
        fields(text).compactMap(Double.init)
    }

    private static func xmlNumberAttribute(_ attributes: String, _ name: String) -> Double? {
        let pattern = "\\b\(NSRegularExpression.escapedPattern(for: name))=[\"']([^\"']+)[\"']"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(attributes.startIndex..<attributes.endIndex, in: attributes)
        guard let match = expression.firstMatch(in: attributes, options: [], range: range),
              match.numberOfRanges > 1,
              let valueRange = Range(match.range(at: 1), in: attributes) else {
            return nil
        }
        return Double(attributes[valueRange])
    }

    private static func elementSymbol(fromAtomName value: String) -> String? {
        let clean = value
            .drop { $0.isNumber }
            .filter { $0.isLetter }
        guard !clean.isEmpty else { return nil }
        let two = normalizeElementSymbol(String(clean.prefix(2)))
        if isElementSymbol(two) { return two }
        let one = normalizeElementSymbol(String(clean.prefix(1)))
        return isElementSymbol(one) ? one : nil
    }

    private static func parseElementCoordinateLine(_ line: String) -> Atom? {
        let parts = fields(line.trimmingCharacters(in: .whitespacesAndNewlines))
        guard parts.count >= 4,
              isElementSymbol(parts[0]),
              let x = Double(parts[1]),
              let y = Double(parts[2]),
              let z = Double(parts[3]) else {
            return nil
        }
        return Atom(symbol: normalizeElementSymbol(parts[0]), x: x, y: y, z: z)
    }

    private static func fields(_ line: String) -> [String] {
        line.split { $0 == " " || $0 == "\t" }.map(String.init)
    }

    private static func stripInlineComment(_ line: String) -> String {
        String(line.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
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

    private static func normalizeElementSymbol(_ value: String) -> String {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = cleaned.first else { return "" }
        return String(first).uppercased() + cleaned.dropFirst().lowercased()
    }

    private static func symbol(for atomicNumber: Int) -> String {
        guard atomicNumber > 0, atomicNumber <= symbolsByNumber.count else { return "X" }
        return symbolsByNumber[atomicNumber - 1]
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.6f", value)
    }

    private static func decodeText(_ data: Data) -> String {
        let textData = gzipInflatedDataIfNeeded(data) ?? data
        if let value = String(data: textData, encoding: .utf8) { return value }
        if let value = String(data: textData, encoding: .isoLatin1) { return value }
        return String(decoding: textData, as: UTF8.self)
    }

    private static func gzipInflatedDataIfNeeded(_ data: Data) -> Data? {
        guard data.count >= 2, data[0] == 0x1f, data[1] == 0x8b else { return nil }
        var stream = z_stream()
        var status = inflateInit2_(&stream, 15 + 32, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { return nil }
        defer { inflateEnd(&stream) }
        var output = Data()
        let chunkSize = 64 * 1024
        let maxInflatedBytes = 128 * 1024 * 1024
        return data.withUnsafeBytes { sourceBuffer -> Data? in
            guard let source = sourceBuffer.bindMemory(to: Bytef.self).baseAddress else { return nil }
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: source)
            stream.avail_in = uInt(data.count)
            repeat {
                var chunk = [UInt8](repeating: 0, count: chunkSize)
                let produced = chunk.withUnsafeMutableBytes { chunkBuffer -> Int in
                    stream.next_out = chunkBuffer.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(chunkSize)
                    status = inflate(&stream, Z_NO_FLUSH)
                    return chunkSize - Int(stream.avail_out)
                }
                if produced > 0 {
                    output.append(contentsOf: chunk.prefix(produced))
                }
                if output.count > maxInflatedBytes { return nil }
            } while status == Z_OK
            return status == Z_STREAM_END ? output : nil
        }
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
    let isExternalXyzrenderOnly: Bool

    static let convertedXYZ = StructureFormat(
        molstarFormat: "xyz",
        isBinary: false,
        isExternalXyzrenderOnly: false
    )

    static let convertedPDB = StructureFormat(
        molstarFormat: "pdb",
        isBinary: false,
        isExternalXyzrenderOnly: false
    )

    private init(molstarFormat: String, isBinary: Bool, isExternalXyzrenderOnly: Bool = false) {
        self.molstarFormat = molstarFormat
        self.isBinary = isBinary
        self.isExternalXyzrenderOnly = isExternalXyzrenderOnly
    }

    init(url: URL, data: Data) {
        let ext = url.lastPathComponent.lowercased().hasSuffix(".mae.gz") ? "maegz" : url.pathExtension.lowercased()
        if let bridgeFormat = BurreteCoreBridge.format(fileExtension: ext) {
            self.molstarFormat = ext == "cif" ? Self.detectCIFFormat(data: data) : bridgeFormat.molstarFormat
            self.isBinary = bridgeFormat.isBinary
            self.isExternalXyzrenderOnly = bridgeFormat.isExternalXyzrenderOnly
            return
        }
        switch ext {
        case "pdb", "ent", "pqr":
            self = Self(molstarFormat: "pdb", isBinary: false)
        case "pdbqt":
            self = Self(molstarFormat: "pdbqt", isBinary: false)
        case "cif":
            self = Self(molstarFormat: Self.detectCIFFormat(data: data), isBinary: false)
        case "mmcif", "mcif":
            self = Self(molstarFormat: "mmcif", isBinary: false)
        case "bcif":
            self = Self(molstarFormat: "mmcif", isBinary: true)
        case "sdf", "sd":
            self = Self(molstarFormat: "sdf", isBinary: false)
        case "mol":
            self = Self(molstarFormat: "mol", isBinary: false)
        case "mol2":
            self = Self(molstarFormat: "mol2", isBinary: false)
        case "xyz":
            self = Self(molstarFormat: "xyz", isBinary: false)
        case "gro":
            self = Self(molstarFormat: "gro", isBinary: false)
        case "xtc", "trr", "dcd", "nctraj":
            self = Self(molstarFormat: ext, isBinary: true)
        case "lammpstrj", "dump", "top", "psf", "prmtop":
            self = Self(molstarFormat: ext, isBinary: false)
        case "mae", "maegz", "cms":
            self = Self(molstarFormat: "xyzrender", isBinary: false, isExternalXyzrenderOnly: true)
        case "abi", "com", "cub", "cube", "fdf", "in", "inp", "log", "nw", "out", "psi4", "qcin", "vasp":
            self = Self(molstarFormat: "xyzrender", isBinary: false, isExternalXyzrenderOnly: true)
        default:
            self = Self(molstarFormat: "mmcif", isBinary: false)
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
    let inlineSvg: String
    let outputType: String
    let preset: String
    let configArgument: String
    let surfaceMode: String?
    let usedOrientationRef: Bool
    let elapsedMs: Int
    let log: String
    let cacheKey: String
    let cacheHit: Bool
}

private enum PreviewExternalXyzrenderWorker {
    private static let cacheMaxAge: TimeInterval = 14 * 24 * 60 * 60
    private static let cacheMaxEntries = 96
    private static let cacheMaxBytes: UInt64 = 256 * 1024 * 1024

    static func render(
        inputData: Data,
        sourceFilename: String,
        outputDirectory: URL,
        preset: String,
        customConfigPath: String,
        transparent: Bool,
        executablePath: String,
        extraArguments: String,
        orientationRefText: String?,
        controls: [String: Any]?,
        surfaceMode: String?
    ) throws -> PreviewExternalXyzrenderArtifact {
        let fileManager = FileManager.default
        let inputURL = outputDirectory.appendingPathComponent(safeInputFilename(sourceFilename))
        let outputURL = outputDirectory.appendingPathComponent("xyzrender.svg")
        let logURL = outputDirectory.appendingPathComponent("xyzrender.log")
        try? fileManager.removeItem(at: outputURL)
        try? fileManager.removeItem(at: logURL)
        try inputData.write(to: inputURL, options: [.atomic])

        let configuredExecutable = executablePath.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedExecutablePath = try resolvedExecutable(configuredExecutable)
        let launch = launchConfiguration(for: resolvedExecutablePath)

        let safePreset = BurreteXyzrenderPreset.normalize(preset)
        let normalizedControls = normalizedControls(controls ?? [:])
        let configArgument = resolveConfigArgument(
            preset: safePreset,
            customConfigPath: normalizedControls["customConfigPath"] as? String ?? customConfigPath
        )
        let effectivePreset = safePreset == "custom" && configArgument == "default" ? "default" : safePreset
        let cacheKey = xyzrenderCacheKey(
            inputData: inputData,
            sourceFilename: sourceFilename,
            preset: safePreset,
            configArgument: configArgument,
            controls: normalizedControls,
            orientationRefText: orientationRefText,
            executablePath: launch.cacheKeyPath
        )
        if let cacheEntry = cacheEntryURL(for: cacheKey) {
            pruneCache(cacheEntry.deletingLastPathComponent())
            if let cached = try cachedArtifact(
                entry: cacheEntry,
                outputURL: outputURL,
                logURL: logURL,
                preset: effectivePreset,
                configArgument: configArgument,
                surfaceMode: surfaceMode,
                usedOrientationRef: normalizedOrientationRef(orientationRefText) != nil,
                cacheKey: cacheKey
            ) {
                return cached
            }
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: launch.executablePath)
        var arguments = launch.argumentPrefix + ["-o", outputURL.path, "--config", configArgument]
        let orientationRefURL = try writeOrientationRef(orientationRefText, outputDirectory: outputDirectory)
        if let orientationRefURL {
            arguments += ["--ref", orientationRefURL.path]
        }
        if (normalizedControls["transparentBackground"] as? Bool) == true || transparent {
            arguments.append("--transparent")
        }
        arguments.append(inputURL.path)
        arguments += cliArguments(from: normalizedControls, inputPath: inputURL.path, preset: safePreset)
        arguments += sanitizedExtraArguments(
            (normalizedControls["extraArguments"] as? String) ?? extraArguments,
            stripFieldArguments: normalizedControls["fieldMode"] != nil
        )
        process.arguments = arguments
        process.environment = mergedEnvironment(overrides: launch.environment)

        _ = fileManager.createFile(atPath: logURL.path, contents: nil)
        let logHandle = try FileHandle(forWritingTo: logURL)
        defer { logHandle.closeFile() }
        process.standardOutput = logHandle
        process.standardError = logHandle
        let semaphore = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in semaphore.signal() }
        let started = Date()
        do {
            try process.run()
        } catch {
            throw PreviewExternalXyzrenderError.launchFailed(
                diagnostics: launchFailureDiagnostics(error: error, launch: launch, arguments: arguments)
            )
        }

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
        let inlineSvg = try String(contentsOf: outputURL, encoding: .utf8)
        let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
        let artifact = PreviewExternalXyzrenderArtifact(
            relativePath: "xyzrender.svg",
            inlineSvg: inlineSvg,
            outputType: "svg",
            preset: effectivePreset,
            configArgument: configArgument,
            surfaceMode: surfaceMode,
            usedOrientationRef: orientationRefURL != nil,
            elapsedMs: elapsedMs,
            log: log,
            cacheKey: cacheKey,
            cacheHit: false
        )
        if let cacheEntry = cacheEntryURL(for: cacheKey) {
            try? writeCacheEntry(cacheEntry, outputURL: outputURL, logURL: logURL, elapsedMs: elapsedMs)
        }
        return artifact
    }

    private static func safeInputFilename(_ filename: String) -> String {
        let ext = URL(fileURLWithPath: filename).pathExtension
        return ext.isEmpty ? "input.xyz" : "input.\(ext)"
    }

    private static func writeOrientationRef(_ text: String?, outputDirectory: URL) throws -> URL? {
        guard let text = normalizedOrientationRef(text) else { return nil }
        let url = outputDirectory.appendingPathComponent("xyzrender-orientation-ref.xyz")
        try Data(text.utf8).write(to: url, options: [.atomic])
        return url
    }

    private static func normalizedOrientationRef(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
    }

    private static func cacheEntryURL(for key: String) -> URL? {
        guard let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            return nil
        }
        return cacheRoot
            .appendingPathComponent("Burrete", isDirectory: true)
            .appendingPathComponent("xyzrender-cache", isDirectory: true)
            .appendingPathComponent(key, isDirectory: true)
    }

    private static func cachedArtifact(
        entry: URL,
        outputURL: URL,
        logURL: URL,
        preset: String,
        configArgument: String,
        surfaceMode: String?,
        usedOrientationRef: Bool,
        cacheKey: String
    ) throws -> PreviewExternalXyzrenderArtifact? {
        let fileManager = FileManager.default
        let cachedSvg = entry.appendingPathComponent("xyzrender.svg")
        let cachedLog = entry.appendingPathComponent("log.txt")
        guard fileManager.fileExists(atPath: cachedSvg.path) else { return nil }
        let attributes = try fileManager.attributesOfItem(atPath: cachedSvg.path)
        if let modified = attributes[.modificationDate] as? Date,
           Date().timeIntervalSince(modified) > cacheMaxAge {
            try? fileManager.removeItem(at: entry)
            return nil
        }
        try copyItemReplacingExisting(from: cachedSvg, to: outputURL)
        if fileManager.fileExists(atPath: cachedLog.path) {
            try? copyItemReplacingExisting(from: cachedLog, to: logURL)
        }
        let inlineSvg = try String(contentsOf: outputURL, encoding: .utf8)
        let log = (try? String(contentsOf: cachedLog, encoding: .utf8)) ?? ""
        return PreviewExternalXyzrenderArtifact(
            relativePath: "xyzrender.svg",
            inlineSvg: inlineSvg,
            outputType: "svg",
            preset: preset,
            configArgument: configArgument,
            surfaceMode: surfaceMode,
            usedOrientationRef: usedOrientationRef,
            elapsedMs: 0,
            log: log,
            cacheKey: cacheKey,
            cacheHit: true
        )
    }

    private static func writeCacheEntry(_ entry: URL, outputURL: URL, logURL: URL, elapsedMs: Int) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: entry, withIntermediateDirectories: true)
        try copyItemReplacingExisting(from: outputURL, to: entry.appendingPathComponent("xyzrender.svg"))
        if fileManager.fileExists(atPath: logURL.path) {
            try? copyItemReplacingExisting(from: logURL, to: entry.appendingPathComponent("log.txt"))
        }
        let metadata: [String: Any] = [
            "elapsedMs": elapsedMs,
            "cachedAtMs": Int(Date().timeIntervalSince1970 * 1000)
        ]
        if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: entry.appendingPathComponent("meta.json"), options: [.atomic])
        }
    }

    private static func pruneCache(_ cacheDirectory: URL) {
        let fileManager = FileManager.default
        guard let entries = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey, .totalFileAllocatedSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        var rows: [(url: URL, modified: Date, bytes: UInt64)] = []
        for entry in entries {
            let svg = entry.appendingPathComponent("xyzrender.svg")
            guard fileManager.fileExists(atPath: svg.path) else {
                try? fileManager.removeItem(at: entry)
                continue
            }
            let modified = (try? svg.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if Date().timeIntervalSince(modified) > cacheMaxAge {
                try? fileManager.removeItem(at: entry)
                continue
            }
            rows.append((entry, modified, directorySize(entry)))
        }
        rows.sort { $0.modified < $1.modified }
        var totalBytes = rows.reduce(UInt64(0)) { $0 + $1.bytes }
        let overflow = max(0, rows.count - cacheMaxEntries)
        for row in rows.prefix(overflow) {
            try? fileManager.removeItem(at: row.url)
            totalBytes = totalBytes > row.bytes ? totalBytes - row.bytes : 0
        }
        for row in rows.dropFirst(overflow) where totalBytes > cacheMaxBytes {
            try? fileManager.removeItem(at: row.url)
            totalBytes = totalBytes > row.bytes ? totalBytes - row.bytes : 0
        }
    }

    private static func copyItemReplacingExisting(from source: URL, to destination: URL) throws {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: destination)
        try fileManager.copyItem(at: source, to: destination)
    }

    private static func directorySize(_ url: URL) -> UInt64 {
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(at: url, includingPropertiesForKeys: [.totalFileAllocatedSizeKey]) else {
            return 0
        }
        var total: UInt64 = 0
        for case let item as URL in enumerator {
            total += UInt64((try? item.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize) ?? 0)
        }
        return total
    }

    private static func xyzrenderCacheKey(
        inputData: Data,
        sourceFilename: String,
        preset: String,
        configArgument: String,
        controls: [String: Any],
        orientationRefText: String?,
        executablePath: String
    ) -> String {
        let executableURL = URL(fileURLWithPath: executablePath)
        let executableAttributes = (try? FileManager.default.attributesOfItem(atPath: executablePath)) ?? [:]
        let executableModified = (executableAttributes[.modificationDate] as? Date)?.timeIntervalSince1970
        let executableSize = executableAttributes[.size] as? NSNumber
        let payload: [String: Any] = [
            "version": 1,
            "sourceFilename": sourceFilename,
            "inputSha256": sha256Hex(inputData),
            "orientationRefSha256": normalizedOrientationRef(orientationRefText).map { sha256Hex(Data($0.utf8)) } as Any,
            "preset": preset,
            "configArgument": configArgument,
            "controls": controls,
            "executablePath": executableURL.standardizedFileURL.path,
            "executableSize": executableSize?.uint64Value as Any,
            "executableModifiedMs": executableModified.map { Int($0 * 1000) } as Any,
            "xyzrenderVersion": NSNull()
        ]
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data()
        return sha256Hex(data)
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func resolvedExecutable(_ configuredExecutable: String) throws -> String {
        var diagnostics: [String] = []
        if let bundledExecutable = bundledExecutablePath(diagnostics: &diagnostics) {
            return bundledExecutable
        }
        let fileManager = FileManager.default
        if !configuredExecutable.isEmpty {
            diagnostics.append("configured=\(configuredExecutable)")
            if configuredExecutable.hasPrefix("/") {
                guard fileManager.isExecutableFile(atPath: configuredExecutable) else {
                    diagnostics.append(candidateDiagnostic(path: configuredExecutable, label: "configured"))
                    throw PreviewExternalXyzrenderError.missingExecutable(diagnostics: diagnostics.joined(separator: "; "))
                }
                return configuredExecutable
            }
            for directory in executableSearchPaths() {
                let candidate = URL(fileURLWithPath: directory).appendingPathComponent(configuredExecutable).path
                if fileManager.isExecutableFile(atPath: candidate) {
                    return candidate
                }
            }
            throw PreviewExternalXyzrenderError.missingExecutable(diagnostics: diagnostics.joined(separator: "; "))
        }
        for directory in executableSearchPaths() {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("xyzrender").path
            if fileManager.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        throw PreviewExternalXyzrenderError.missingExecutable(diagnostics: diagnostics.joined(separator: "; "))
    }

    private static func bundledExecutablePath(diagnostics: inout [String]) -> String? {
        for url in bundledExecutableStartURLs() {
            if let candidate = bundledExecutablePath(startingAt: url, diagnostics: &diagnostics) {
                return candidate
            }
        }
        return nil
    }

    private static func bundledExecutableStartURLs() -> [URL] {
        var urls: [URL] = []
        for bundle in [Bundle(for: PreviewViewController.self), Bundle.main] {
            urls.append(bundle.bundleURL)
            if let resourceURL = bundle.resourceURL { urls.append(resourceURL) }
            if let executableURL = bundle.executableURL { urls.append(executableURL) }
        }
        if let argument0 = ProcessInfo.processInfo.arguments.first, !argument0.isEmpty {
            urls.append(URL(fileURLWithPath: argument0))
        }
        var seen = Set<String>()
        return urls.compactMap { url in
            let path = url.standardizedFileURL.path
            guard !seen.contains(path) else { return nil }
            seen.insert(path)
            return url
        }
    }

    private static func bundledExecutablePath(startingAt bundleURL: URL, diagnostics: inout [String]) -> String? {
        let fileManager = FileManager.default
        var current = bundleURL.standardizedFileURL
        for _ in 0..<8 {
            let candidate = current
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("Resources", isDirectory: true)
                .appendingPathComponent("xyzrender-runtime", isDirectory: true)
                .appendingPathComponent("bin", isDirectory: true)
                .appendingPathComponent("xyzrender", isDirectory: false)
                .path
            let wrapperExists = fileManager.fileExists(atPath: candidate)
            let isExecutable = fileManager.isExecutableFile(atPath: candidate)
            if diagnostics.count < 12 {
                diagnostics.append(candidateDiagnostic(path: candidate, label: "bundled"))
            }
            if wrapperExists {
                if bundledPythonLaunch(for: candidate) != nil {
                    return candidate
                }
                if diagnostics.count < 12 {
                    diagnostics.append(bundledPythonDiagnostic(for: candidate))
                }
            }
            if isExecutable {
                return candidate
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
            current = parent
        }
        return nil
    }

    private static func candidateDiagnostic(path: String, label: String) -> String {
        let fileManager = FileManager.default
        return "\(label)=\(path) exists=\(fileManager.fileExists(atPath: path)) executable=\(fileManager.isExecutableFile(atPath: path))"
    }

    private struct PreviewXyzrenderLaunch {
        let executablePath: String
        let argumentPrefix: [String]
        let environment: [String: String]
        let cacheKeyPath: String
    }

    private struct BundledXyzrenderPythonPaths {
        let python: URL
        let pythonHome: URL
        let sitePackages: URL
    }

    private static func launchConfiguration(for executablePath: String) -> PreviewXyzrenderLaunch {
        if let bundledLaunch = bundledPythonLaunch(for: executablePath) {
            return bundledLaunch
        }
        return PreviewXyzrenderLaunch(
            executablePath: executablePath,
            argumentPrefix: [],
            environment: [:],
            cacheKeyPath: executablePath
        )
    }

    private static func bundledPythonLaunch(for executablePath: String) -> PreviewXyzrenderLaunch? {
        guard let paths = bundledPythonPaths(for: executablePath) else { return nil }
        return PreviewXyzrenderLaunch(
            executablePath: paths.python.path,
            argumentPrefix: ["-m", "xyzrender.cli"],
            environment: [
                "PYTHONHOME": paths.pythonHome.path,
                "PYTHONNOUSERSITE": "1",
                "PYTHONPATH": paths.sitePackages.path
            ],
            cacheKeyPath: executablePath
        )
    }

    private static func bundledPythonPaths(for executablePath: String) -> BundledXyzrenderPythonPaths? {
        let fileManager = FileManager.default
        let executableURL = URL(fileURLWithPath: executablePath)
        guard executableURL.lastPathComponent == "xyzrender" else { return nil }
        let runtimeRoot = executableURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        guard runtimeRoot.lastPathComponent == "xyzrender-runtime" else { return nil }
        let resources = runtimeRoot.deletingLastPathComponent()
        guard fileManager.fileExists(atPath: executablePath) else { return nil }
        guard let sitePackages = bundledSitePackages(in: runtimeRoot) else { return nil }
        guard let python = bundledPythonCandidates(appResources: resources).first(where: {
            fileManager.fileExists(atPath: $0.path)
        }) else { return nil }
        return BundledXyzrenderPythonPaths(
            python: python,
            pythonHome: bundledPythonHome(for: python),
            sitePackages: sitePackages
        )
    }

    private static func bundledPythonDiagnostic(for executablePath: String) -> String {
        let executableURL = URL(fileURLWithPath: executablePath)
        let runtimeRoot = executableURL
            .deletingLastPathComponent()
                .deletingLastPathComponent()
        let resources = runtimeRoot.deletingLastPathComponent()
        let sitePackages = bundledSitePackages(in: runtimeRoot)
            ?? runtimeRoot
                .appendingPathComponent("lib", isDirectory: true)
                .appendingPathComponent("python3.13", isDirectory: true)
                .appendingPathComponent("site-packages", isDirectory: true)
        let pythonDiagnostics = bundledPythonCandidates(appResources: resources)
            .enumerated()
            .map { index, python in candidateDiagnostic(path: python.path, label: "bundledPython\(index + 1)") }
        return (pythonDiagnostics + [
            candidateDiagnostic(path: sitePackages.path, label: "bundledSitePackages")
        ]).joined(separator: "; ")
    }

    private static func bundledPythonCandidates(appResources: URL) -> [URL] {
        var candidates: [URL] = []
        for bundle in [Bundle(for: PreviewViewController.self), Bundle.main] {
            if let resourceURL = bundle.resourceURL {
                candidates.append(resourceURL.appendingPathComponent("xyzrender-python3", isDirectory: false))
                candidates.append(bundledPythonURL(resources: resourceURL))
            }
            if let executableURL = bundle.executableURL {
                candidates.append(bundledPythonURL(resources: executableURL.deletingLastPathComponent()))
            }
        }
        candidates.append(bundledPythonURL(resources: appResources))
        var seen = Set<String>()
        return candidates.filter { seen.insert($0.standardizedFileURL.path).inserted }
    }

    private static func bundledPythonURL(resources: URL) -> URL {
        resources
            .appendingPathComponent("xyzrender-python", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("python3", isDirectory: false)
    }

    private static func bundledPythonHome(for python: URL) -> URL {
        if python.lastPathComponent == "xyzrender-python3" {
            var current = python.deletingLastPathComponent()
            for _ in 0..<8 {
                let candidates = [
                    current.appendingPathComponent("xyzrender-python", isDirectory: true),
                    current
                        .appendingPathComponent("Resources", isDirectory: true)
                        .appendingPathComponent("xyzrender-python", isDirectory: true),
                    current
                        .appendingPathComponent("Contents", isDirectory: true)
                        .appendingPathComponent("Resources", isDirectory: true)
                        .appendingPathComponent("xyzrender-python", isDirectory: true)
                ]
                if let resourcesRoot = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) {
                    return resourcesRoot
                }
                let parent = current.deletingLastPathComponent()
                if parent.path == current.path { break }
                current = parent
            }
        }
        let pythonRoot = python
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        if pythonRoot.deletingLastPathComponent().lastPathComponent == "MacOS" {
            let resourcesRoot = pythonRoot
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources", isDirectory: true)
                .appendingPathComponent("xyzrender-python", isDirectory: true)
            if FileManager.default.fileExists(atPath: resourcesRoot.path) {
                return resourcesRoot
            }
        }
        return pythonRoot
    }

    private static func bundledSitePackages(in runtimeRoot: URL) -> URL? {
        let fileManager = FileManager.default
        let libDirectory = runtimeRoot.appendingPathComponent("lib", isDirectory: true)
        if let entries = try? fileManager.contentsOfDirectory(
            at: libDirectory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) {
            for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where entry.lastPathComponent.hasPrefix("python") {
                let sitePackages = entry.appendingPathComponent("site-packages", isDirectory: true)
                if fileManager.fileExists(atPath: sitePackages.path) {
                    return sitePackages
                }
            }
        }
        for version in ["python3.13", "python3.12", "python3.11"] {
            let sitePackages = libDirectory
                .appendingPathComponent(version, isDirectory: true)
                .appendingPathComponent("site-packages", isDirectory: true)
            if fileManager.fileExists(atPath: sitePackages.path) {
                return sitePackages
            }
        }
        return findSitePackages(in: libDirectory, depth: 0)
    }

    private static func launchFailureDiagnostics(error: Error, launch: PreviewXyzrenderLaunch, arguments: [String]) -> String {
        let nsError = error as NSError
        var diagnostics = [
            "domain=\(nsError.domain)",
            "code=\(nsError.code)",
            "message=\(nsError.localizedDescription)",
            candidateDiagnostic(path: launch.executablePath, label: "launch"),
            candidateDiagnostic(path: launch.cacheKeyPath, label: "cacheKey"),
            "args=\(arguments.prefix(4).joined(separator: " "))"
        ]
        if let firstArgument = launch.argumentPrefix.first {
            diagnostics.append(candidateDiagnostic(path: firstArgument, label: "launch.arg0"))
        }
        return diagnostics.joined(separator: "; ")
    }

    private static func findSitePackages(in directory: URL, depth: Int) -> URL? {
        guard depth <= 2 else { return nil }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }
        for entry in entries {
            let isDirectory = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            guard isDirectory else { continue }
            if entry.lastPathComponent == "site-packages" { return entry }
        }
        guard depth < 2 else { return nil }
        for entry in entries {
            let isDirectory = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            guard isDirectory else { continue }
            if let found = findSitePackages(in: entry, depth: depth + 1) {
                return found
            }
        }
        return nil
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

    static func normalizedControls(_ value: [String: Any]) -> [String: Any] {
        var result: [String: Any] = [:]
        copyBoolean(value, key: "transparentBackground", into: &result)
        copyNumber(value, key: "canvasSize", into: &result)
        copyNumber(value, key: "atomScale", into: &result)
        copyNumber(value, key: "bondWidth", into: &result)
        copyNumber(value, key: "atomStrokeWidth", into: &result)
        copyText(value, key: "molColor", into: &result)
        copyBoolean(value, key: "gradients", into: &result)
        copyBoolean(value, key: "fog", into: &result)
        copyNumber(value, key: "fogStrength", into: &result)
        copyBoolean(value, key: "showVdw", into: &result)
        copyText(value, key: "vdwAtoms", into: &result)
        copyNumber(value, key: "vdwOpacity", into: &result)
        copyNumber(value, key: "vdwScale", into: &result)
        copyHullMode(value, into: &result)
        copyText(value, key: "hullAtoms", into: &result)
        copyNonNegativeNumber(value, key: "hullOpacity", into: &result)
        copyNonNegativeNumber(value, key: "poreOpacity", into: &result)
        copyBoolean(value, key: "hideBonds", into: &result)
        copyBoolean(value, key: "showCell", into: &result)
        copyBoolean(value, key: "showGhosts", into: &result)
        copyBoolean(value, key: "showAxes", into: &result)
        copyNumber(value, key: "cellWidth", into: &result)
        copyFieldMode(value, into: &result)
        copyNumber(value, key: "fieldIso", into: &result)
        copyNonNegativeNumber(value, key: "fieldOpacity", into: &result)
        copySurfaceStyle(value, into: &result)
        copyText(value, key: "fieldMoPositiveColor", into: &result)
        copyText(value, key: "fieldMoNegativeColor", into: &result)
        copyText(value, key: "fieldDensityColor", into: &result)
        copyText(value, key: "fieldCmapPalette", into: &result)
        copyFiniteNumber(value, key: "fieldCmapMin", into: &result)
        copyFiniteNumber(value, key: "fieldCmapMax", into: &result)
        copyText(value, key: "customConfigPath", into: &result)
        copyText(value, key: "extraArguments", into: &result)
        if let supercell = normalizeSupercell(value["supercell"]) {
            result["supercell"] = supercell
        }
        return result
    }

    private static func cliArguments(from controls: [String: Any], inputPath: String, preset: String) -> [String] {
        var arguments: [String] = []
        if let value = finitePositive(controls["canvasSize"]) {
            arguments += ["-S", formatCLI(value)]
        }
        if let value = finitePositive(controls["atomScale"]) {
            arguments += ["-a", formatCLI(value)]
        }
        if let value = finitePositive(controls["bondWidth"]) {
            arguments += ["-b", formatCLI(value)]
        }
        if let value = finitePositive(controls["atomStrokeWidth"]) {
            arguments += ["-s", formatCLI(value)]
        }
        if let value = controls["molColor"] as? String {
            arguments += ["--mol-color", value]
        }
        if let value = controls["gradients"] as? Bool {
            arguments.append(value ? "--grad" : "--no-grad")
        }
        if let value = controls["fog"] as? Bool {
            arguments.append(value ? "--fog" : "--no-fog")
        }
        if let value = finitePositive(controls["fogStrength"]) {
            arguments += ["-F", formatCLI(value)]
        }
        if preset != "vdw", (controls["showVdw"] as? Bool) == true {
            arguments.append("--vdw")
            if let atoms = controls["vdwAtoms"] as? String, atoms.isEmpty == false {
                arguments.append(atoms)
            }
        }
        if let value = finitePositive(controls["vdwOpacity"]) {
            arguments += ["--vdw-opacity", formatCLI(value)]
        }
        if let value = finitePositive(controls["vdwScale"]) {
            arguments += ["--vdw-scale", formatCLI(value)]
        }
        if let hullArgument = nonEmptyText(controls["hullAtoms"] as? String) ?? xyzrenderHullArgument(controls["hullMode"] as? String) {
            arguments += ["--hull", hullArgument]
        }
        if xyzrenderPoreEnabled(controls["hullMode"] as? String) {
            arguments.append("--pore")
        }
        if let value = finiteNonNegative(controls["hullOpacity"]) {
            arguments += ["--hull-opacity", formatCLI(value)]
        }
        if let value = finiteNonNegative(controls["poreOpacity"]) {
            arguments += ["--pore-opacity", formatCLI(value)]
        }
        if (controls["hideBonds"] as? Bool) == true {
            arguments.append("--no-bonds")
        }
        if let value = controls["showCell"] as? Bool {
            arguments.append(value ? "--cell" : "--no-cell")
        }
        if let value = controls["showGhosts"] as? Bool {
            arguments.append(value ? "--ghosts" : "--no-ghosts")
        }
        if let value = controls["showAxes"] as? Bool {
            arguments.append(value ? "--axes" : "--no-axes")
        }
        if let value = finitePositive(controls["cellWidth"]) {
            arguments += ["--cell-width", formatCLI(value)]
        }
        if let supercell = controls["supercell"] as? [Int], supercell.count == 3, supercell.allSatisfy({ $0 > 0 }) {
            arguments.append("--supercell")
            arguments += supercell.map(String.init)
        }
        if let mode = controls["fieldMode"] as? String {
            switch mode {
            case "density":
                arguments.append("--dens")
            case "mo":
                arguments.append("--mo")
            case "esp":
                arguments += ["--esp", inputPath]
            case "nci":
                arguments += ["--nci-surf", inputPath]
            default:
                break
            }
        }
        if let value = finitePositive(controls["fieldIso"]) {
            arguments += ["--iso", formatCLI(value)]
        }
        if let value = finiteNonNegative(controls["fieldOpacity"]) {
            arguments += ["--opacity", formatCLI(value)]
        }
        if let value = controls["fieldSurfaceStyle"] as? String {
            arguments += ["--surface-style", value]
        }
        if let positive = controls["fieldMoPositiveColor"] as? String,
           let negative = controls["fieldMoNegativeColor"] as? String {
            arguments += ["--mo-colors", positive, negative]
        }
        if let value = controls["fieldDensityColor"] as? String {
            arguments += ["--dens-color", value]
        }
        if let value = controls["fieldCmapPalette"] as? String {
            arguments += ["--cmap-palette", value]
        }
        if let min = finiteNumber(controls["fieldCmapMin"]),
           let max = finiteNumber(controls["fieldCmapMax"]) {
            arguments += ["--cmap-range", formatCLI(min), formatCLI(max)]
        }
        return arguments
    }

    private static func copyBoolean(_ source: [String: Any], key: String, into result: inout [String: Any]) {
        if let value = source[key] as? Bool {
            result[key] = value
        }
    }

    private static func copyNumber(_ source: [String: Any], key: String, into result: inout [String: Any]) {
        if let value = finitePositive(source[key]) {
            result[key] = value
        }
    }

    private static func copyText(_ source: [String: Any], key: String, into result: inout [String: Any]) {
        if let value = nonEmptyText(source[key] as? String) {
            result[key] = value
        }
    }

    private static func copyFieldMode(_ source: [String: Any], into result: inout [String: Any]) {
        let value = (source["fieldMode"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if ["auto", "off", "density", "mo", "esp", "nci"].contains(value) {
            result["fieldMode"] = value
        }
    }

    private static func copySurfaceStyle(_ source: [String: Any], into result: inout [String: Any]) {
        let value = (source["fieldSurfaceStyle"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if ["solid", "mesh", "contour", "dot"].contains(value) {
            result["fieldSurfaceStyle"] = value
        }
    }

    private static func copyHullMode(_ source: [String: Any], into result: inout [String: Any]) {
        if let value = normalizedHullMode(source["hullMode"] as? String) {
            result["hullMode"] = value
        }
    }

    private static func copyNonNegativeNumber(_ source: [String: Any], key: String, into result: inout [String: Any]) {
        if let value = finiteNonNegative(source[key]) {
            result[key] = value
        }
    }

    private static func copyFiniteNumber(_ source: [String: Any], key: String, into result: inout [String: Any]) {
        if let value = finiteNumber(source[key]) {
            result[key] = value
        }
    }

    private static func finitePositive(_ value: Any?) -> Double? {
        if let number = value as? NSNumber {
            let resolved = number.doubleValue
            return resolved.isFinite && resolved > 0 ? resolved : nil
        }
        if let text = value as? String, let resolved = Double(text), resolved.isFinite, resolved > 0 {
            return resolved
        }
        return nil
    }

    private static func finiteNonNegative(_ value: Any?) -> Double? {
        if let number = value as? NSNumber {
            let resolved = number.doubleValue
            return resolved.isFinite && resolved >= 0 ? resolved : nil
        }
        if let text = value as? String, let resolved = Double(text), resolved.isFinite, resolved >= 0 {
            return resolved
        }
        return nil
    }

    private static func finiteNumber(_ value: Any?) -> Double? {
        if let number = value as? NSNumber {
            let resolved = number.doubleValue
            return resolved.isFinite ? resolved : nil
        }
        if let text = value as? String, let resolved = Double(text), resolved.isFinite {
            return resolved
        }
        return nil
    }

    private static func nonEmptyText(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func normalizedHullMode(_ value: String?) -> String? {
        let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        return ["benzene-ring", "anthracene-rings", "auto-rings", "faces", "pore", "mof5-faces", "mof5-pore", "faces-pore"].contains(normalized) ? normalized : nil
    }

    private static func xyzrenderHullArgument(_ value: String?) -> String? {
        switch normalizedHullMode(value) {
        case "benzene-ring", "anthracene-rings", "auto-rings":
            return "rings"
        case "faces", "mof5-faces", "faces-pore":
            return "faces"
        default:
            return nil
        }
    }

    private static func xyzrenderPoreEnabled(_ value: String?) -> Bool {
        switch normalizedHullMode(value) {
        case "pore", "mof5-pore", "faces-pore":
            return true
        default:
            return false
        }
    }

    private static func normalizeSupercell(_ value: Any?) -> [Int]? {
        guard let values = value as? [Any], values.count == 3 else { return nil }
        let parsed = values.compactMap { (($0 as? NSNumber)?.intValue) ?? Int(($0 as? String) ?? "") }
        guard parsed.count == 3, parsed.allSatisfy({ $0 > 0 }) else { return nil }
        return parsed
    }

    private static func formatCLI(_ value: Double) -> String {
        let text = String(format: "%.6f", value)
        return text.replacingOccurrences(of: #"(\.\d*?[1-9])0+$"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\.0+$"#, with: "", options: .regularExpression)
    }

    private static func sanitizedExtraArguments(_ value: String, stripFieldArguments: Bool = false) -> [String] {
        var blockedValueFlags = Set(["-o", "--output", "-go", "--gif-output", "--config", "--ref"])
        var blocked = blockedValueFlags
        var blockedValueCounts: [String: Int] = [:]
        blocked.insert("--hull")
        [
            "--hull-color",
            "--hull-opacity",
            "--hull-color-type",
            "--hull-edge-width-ratio",
            "--ring-max-size",
            "--ring-min-size",
            "--face-planarity",
            "--pore-color",
            "--pore-opacity"
        ].forEach {
            blocked.insert($0)
            blockedValueFlags.insert($0)
        }
        ["--pore", "--hull-edge", "--no-hull-edge"].forEach { blocked.insert($0) }
        if stripFieldArguments {
            ["--esp", "--nci-surf", "--iso", "--opacity", "--surface-style", "--dens-color", "--cmap-palette"].forEach {
                blocked.insert($0)
                blockedValueFlags.insert($0)
            }
            blockedValueCounts["--mo-colors"] = 2
            blockedValueCounts["--cmap-range"] = 2
            ["--mo", "--dens", "--mo-colors", "--cmap-range"].forEach { blocked.insert($0) }
        }
        var result: [String] = []
        var skipNext = 0
        for token in splitCommandLine(value) {
            if skipNext > 0 {
                skipNext -= 1
                continue
            }
            if blocked.contains(token) {
                skipNext = blockedValueCounts[token] ?? (blockedValueFlags.contains(token) ? 1 : 0)
                continue
            }
            if blocked.contains(where: { token.hasPrefix($0 + "=") }) { continue }
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

    private static func mergedEnvironment(overrides: [String: String] = [:]) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let defaultPath = executableSearchPaths().joined(separator: ":")
        if let path = environment["PATH"], !path.isEmpty {
            environment["PATH"] = defaultPath + ":" + path
        } else {
            environment["PATH"] = defaultPath
        }
        for (key, value) in overrides {
            environment[key] = value
        }
        return environment
    }
}

private enum PreviewExternalXyzrenderError: LocalizedError {
    case missingExecutable(diagnostics: String)
    case launchFailed(diagnostics: String)
    case timedOut
    case missingOutput
    case failed(status: Int32, log: String)

    var errorDescription: String? {
        switch self {
        case .missingExecutable(let diagnostics):
            let details = diagnostics.isEmpty ? "" : " Checked: \(diagnostics.prefix(900))"
            return "External xyzrender executable was not found. Set an absolute xyzrender path in Burrete settings.\(details)"
        case .launchFailed(let diagnostics):
            let details = diagnostics.isEmpty ? "" : " Checked: \(diagnostics.prefix(900))"
            return "External xyzrender process could not be launched.\(details)"
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
    let molstarStyle: String
    let xyzrenderPreset: String
    let xyzrenderCustomConfigPath: String
    let xyzrenderExecutablePath: String
    let xyzrenderExtraArguments: String
    let themeLightAccent: String
    let themeLightBackground: String
    let themeLightForeground: String
    let themeLightUiFont: String
    let themeLightEditorFont: String
    let themeLightTranslucent: Double
    let themeLightContrast: Double
    let themeDarkAccent: String
    let themeDarkBackground: String
    let themeDarkForeground: String
    let themeDarkUiFont: String
    let themeDarkEditorFont: String
    let themeDarkTranslucent: Double
    let themeDarkContrast: Double
    let gridFileSupport: MoleculeGridFileSupport
    let defaultLayoutState: [String: String]

    var runtimeViewerTheme: String {
        ["dark", "light", "auto"].contains(viewerTheme) ? viewerTheme : "auto"
    }

    var runtimeCanvasBackground: String {
        ["auto", "black", "graphite", "white", "transparent"].contains(canvasBackground) ? canvasBackground : "auto"
    }

    var resolvedTransparentBackground: Bool {
        transparentBackground || runtimeCanvasBackground == "transparent"
    }

    var resolvedMolstarStyle: String {
        molstarStyle == "default" ? "default" : "illustrative"
    }

    var themeTokens: [String: Any] {
        [
            "light": [
                "accent": themeLightAccent,
                "background": themeLightBackground,
                "foreground": themeLightForeground,
                "uiFont": themeLightUiFont,
                "editorFont": themeLightEditorFont,
                "translucent": themeLightTranslucent,
                "contrast": themeLightContrast
            ],
            "dark": [
                "accent": themeDarkAccent,
                "background": themeDarkBackground,
                "foreground": themeDarkForeground,
                "uiFont": themeDarkUiFont,
                "editorFont": themeDarkEditorFont,
                "translucent": themeDarkTranslucent,
                "contrast": themeDarkContrast
            ]
        ]
    }

    static func load() -> PreviewPreferences {
        let appID = preferenceAppID()
        let showPanelControls = (CFPreferencesCopyAppValue("showPreviewPanelControls" as CFString, appID) as? Bool) ?? true
        let transparentBackground = (CFPreferencesCopyAppValue("useTransparentPreviewBackground" as CFString, appID) as? Bool) ?? false
        let viewerTheme = (CFPreferencesCopyAppValue("viewerTheme" as CFString, appID) as? String) ?? "auto"
        let canvasBackground = (CFPreferencesCopyAppValue("viewerCanvasBackground" as CFString, appID) as? String) ?? "auto"
        let overlayOpacity = (CFPreferencesCopyAppValue("viewerOverlayOpacity" as CFString, appID) as? Double) ?? 0.90
        let rendererMode = (CFPreferencesCopyAppValue("structureRendererMode" as CFString, appID) as? String) ?? "auto"
        let molstarStyle = (CFPreferencesCopyAppValue("molstarStyle" as CFString, appID) as? String) ?? "illustrative"
        let xyzrenderPreset = (CFPreferencesCopyAppValue("xyzrenderPreset" as CFString, appID) as? String) ?? "default"
        let xyzrenderCustomConfigPath = (CFPreferencesCopyAppValue("xyzrenderCustomConfigPath" as CFString, appID) as? String) ?? ""
        let xyzrenderExecutablePath = (CFPreferencesCopyAppValue("xyzrenderExecutablePath" as CFString, appID) as? String) ?? ""
        let xyzrenderExtraArguments = (CFPreferencesCopyAppValue("xyzrenderExtraArguments" as CFString, appID) as? String) ?? ""
        let themeLightAccent = (CFPreferencesCopyAppValue("themeLightAccent" as CFString, appID) as? String) ?? "#AF52DE"
        let themeLightBackground = (CFPreferencesCopyAppValue("themeLightBackground" as CFString, appID) as? String) ?? "#FFFFFF"
        let themeLightForeground = (CFPreferencesCopyAppValue("themeLightForeground" as CFString, appID) as? String) ?? "#0D0D0D"
        let defaultSystemFont = "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\""
        let themeLightUiFont = (CFPreferencesCopyAppValue("themeLightUiFont" as CFString, appID) as? String) ?? defaultSystemFont
        let themeLightEditorFont = (CFPreferencesCopyAppValue("themeLightEditorFont" as CFString, appID) as? String) ?? defaultSystemFont
        let themeLightTranslucent = (CFPreferencesCopyAppValue("themeLightTranslucent" as CFString, appID) as? Double) ?? 10
        let themeLightContrast = (CFPreferencesCopyAppValue("themeLightContrast" as CFString, appID) as? Double) ?? 20
        let themeDarkAccent = (CFPreferencesCopyAppValue("themeDarkAccent" as CFString, appID) as? String) ?? "#AF52DE"
        let themeDarkBackground = (CFPreferencesCopyAppValue("themeDarkBackground" as CFString, appID) as? String) ?? "#111111"
        let themeDarkForeground = (CFPreferencesCopyAppValue("themeDarkForeground" as CFString, appID) as? String) ?? "#FCFCFC"
        let themeDarkUiFont = (CFPreferencesCopyAppValue("themeDarkUiFont" as CFString, appID) as? String) ?? defaultSystemFont
        let themeDarkEditorFont = (CFPreferencesCopyAppValue("themeDarkEditorFont" as CFString, appID) as? String) ?? defaultSystemFont
        let themeDarkTranslucent = (CFPreferencesCopyAppValue("themeDarkTranslucent" as CFString, appID) as? Double) ?? 20
        let themeDarkContrast = (CFPreferencesCopyAppValue("themeDarkContrast" as CFString, appID) as? Double) ?? 16
        let gridFileSupport = MoleculeGridFileSupport.loadFromAppPreferences(appID: appID)
        return PreviewPreferences(
            showPanelControls: showPanelControls,
            transparentBackground: transparentBackground,
            viewerTheme: viewerTheme,
            canvasBackground: canvasBackground,
            overlayOpacity: min(max(overlayOpacity, 0.72), 0.98),
            rendererMode: rendererMode,
            molstarStyle: molstarStyle,
            xyzrenderPreset: BurreteXyzrenderPreset.normalize(xyzrenderPreset),
            xyzrenderCustomConfigPath: xyzrenderCustomConfigPath,
            xyzrenderExecutablePath: xyzrenderExecutablePath,
            xyzrenderExtraArguments: xyzrenderExtraArguments,
            themeLightAccent: themeLightAccent,
            themeLightBackground: themeLightBackground,
            themeLightForeground: themeLightForeground,
            themeLightUiFont: themeLightUiFont,
            themeLightEditorFont: themeLightEditorFont,
            themeLightTranslucent: min(max(themeLightTranslucent, 0.0), 100.0),
            themeLightContrast: min(max(themeLightContrast, 0.0), 100.0),
            themeDarkAccent: themeDarkAccent,
            themeDarkBackground: themeDarkBackground,
            themeDarkForeground: themeDarkForeground,
            themeDarkUiFont: themeDarkUiFont,
            themeDarkEditorFont: themeDarkEditorFont,
            themeDarkTranslucent: min(max(themeDarkTranslucent, 0.0), 100.0),
            themeDarkContrast: min(max(themeDarkContrast, 0.0), 100.0),
            gridFileSupport: gridFileSupport,
            defaultLayoutState: [
                "left": "hidden",
                "right": "hidden",
                "top": "hidden",
                "bottom": "hidden"
            ]
        )
    }

    private static func preferenceAppID() -> CFString {
        for bundle in [Bundle(for: PreviewViewController.self), Bundle.main] {
            if let identifier = containingAppBundleIdentifier(startingAt: bundle.bundleURL) {
                return identifier as CFString
            }
        }
        return "com.local.BurreteV10" as CFString
    }

    private static func containingAppBundleIdentifier(startingAt bundleURL: URL) -> String? {
        var current = bundleURL.standardizedFileURL
        for _ in 0..<8 {
            if current.pathExtension == "app",
               let identifier = Bundle(url: current)?.bundleIdentifier,
               !identifier.isEmpty {
                return identifier
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
            current = parent
        }
        return nil
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
    case couldNotExtractBoundedMaestroPreview(String, Int)
    case notRenderableStandaloneStructure(String)
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
            return "Mol* assets were not vendored into the extension. molstar.js is only \(size) bytes. Run ./scripts/build.sh so Bun vendors build/viewer/molstar.js and molstar.css before Xcode signs the app."
        case .emptyStructureFile(let name):
            return "The structure file is empty or not downloaded locally: \(name)"
        case .unsupportedStructureFile(let name):
            return "Unsupported structure file type: \(name)"
        case .gridFileTypeDisabled(let ext):
            return ".\(ext) molecule grid previews are disabled in Burrete Settings."
        case .fileTooLarge(let name, let size, let limit):
            return "\(name) is too large for Quick Look preview (\(size) bytes; limit \(limit) bytes). Open it in the Burrete app viewer or use a smaller file."
        case .couldNotExtractBoundedMaestroPreview(let name, let limit):
            return "\(name) is too large for full Quick Look loading, and Burrete could not extract a Maestro atom table from the first \(limit) bytes."
        case .notRenderableStandaloneStructure(let name):
            return "\(name) does not contain standalone molecular coordinates Burrete can preview. Open the referenced structure file directly if this output report points to one."
        case .ubiquitousFileNotDownloaded(let name):
            return "\(name) is in iCloud and is not downloaded locally. Download it in Finder, then open Quick Look again."
        case .webRenderFailed(let message):
            return "Web rendering failed: \(message)"
        case .webRenderTimedOut:
            return "Mol* web rendering did not become ready within the preview timeout."
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
