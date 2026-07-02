import SwiftUI
import WebKit

struct MobilePreviewWebView: UIViewRepresentable {
    let document: MobilePreviewDocument
    let theme: MobilePreviewTheme
    let style: MobileMolecularStyle
    let waterRepresentation: MobileWaterRepresentation
    let molstarQuality: MobileMolstarQuality
    let panelState: MobileMolstarPanelState
    let controlAction: MobileMolstarControlAction?
    let contextMenuCommand: MobileMolstarContextMenuCommand?
    @Binding var contextMenu: MobileContextMenu?
    @Binding var inspectorTarget: MobileInspectorTarget?
    @Binding var logEntries: [MobileLogEntry]
    @Binding var status: String
    @Binding var lastError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(
            contextMenu: $contextMenu,
            inspectorTarget: $inspectorTarget,
            logEntries: $logEntries,
            status: $status,
            lastError: $lastError
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "burrete")

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = userContentController
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        webView.isOpaque = false
        webView.backgroundColor = theme.uiBackgroundColor
        webView.scrollView.backgroundColor = theme.uiBackgroundColor
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        context.coordinator.loadPreview(in: webView, document: document, theme: theme, style: style, waterRepresentation: waterRepresentation, molstarQuality: molstarQuality)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        uiView.backgroundColor = theme.uiBackgroundColor
        uiView.scrollView.backgroundColor = theme.uiBackgroundColor
        if context.coordinator.loadedDocument != document ||
            context.coordinator.loadedTheme != theme ||
            context.coordinator.loadedStyle != style ||
            context.coordinator.loadedWaterRepresentation != waterRepresentation ||
            context.coordinator.loadedMolstarQuality != molstarQuality {
            context.coordinator.loadPreview(in: uiView, document: document, theme: theme, style: style, waterRepresentation: waterRepresentation, molstarQuality: molstarQuality)
        }
        context.coordinator.applyPanelState(panelState, in: uiView)
        context.coordinator.runControlAction(controlAction, in: uiView)
        context.coordinator.runContextMenuCommand(contextMenuCommand, in: uiView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private let status: Binding<String>
        private let lastError: Binding<String?>
        private let contextMenu: Binding<MobileContextMenu?>
        private let inspectorTarget: Binding<MobileInspectorTarget?>
        private let logEntries: Binding<[MobileLogEntry]>
        private(set) var loadedDocument: MobilePreviewDocument?
        private(set) var loadedTheme: MobilePreviewTheme?
        private(set) var loadedStyle: MobileMolecularStyle?
        private(set) var loadedWaterRepresentation: MobileWaterRepresentation?
        private(set) var loadedMolstarQuality: MobileMolstarQuality?
        private var desiredPanelState: MobileMolstarPanelState?
        private var appliedPanelState: MobileMolstarPanelState?
        private var appliedActionID: UUID?
        private var appliedContextCommandID: UUID?

        init(
            contextMenu: Binding<MobileContextMenu?>,
            inspectorTarget: Binding<MobileInspectorTarget?>,
            logEntries: Binding<[MobileLogEntry]>,
            status: Binding<String>,
            lastError: Binding<String?>
        ) {
            self.contextMenu = contextMenu
            self.inspectorTarget = inspectorTarget
            self.logEntries = logEntries
            self.status = status
            self.lastError = lastError
        }

        func loadPreview(
            in webView: WKWebView,
            document: MobilePreviewDocument,
            theme: MobilePreviewTheme,
            style: MobileMolecularStyle,
            waterRepresentation: MobileWaterRepresentation,
            molstarQuality: MobileMolstarQuality
        ) {
            loadedDocument = document
            loadedTheme = theme
            loadedStyle = style
            loadedWaterRepresentation = waterRepresentation
            loadedMolstarQuality = molstarQuality
            appliedPanelState = nil
            contextMenu.wrappedValue = nil
            inspectorTarget.wrappedValue = nil
            logEntries.wrappedValue = []
            do {
                let preview = try MobilePreviewRuntime.build(
                    document: document,
                    theme: theme,
                    style: style,
                    waterRepresentation: waterRepresentation,
                    molstarQuality: molstarQuality
                )
                webView.loadFileURL(preview.indexURL, allowingReadAccessTo: preview.readAccessURL)
                status.wrappedValue = "Loading \(document.displayName) (\(style.displayName))"
                lastError.wrappedValue = nil
                appendLog(kind: .status, message: "Loading \(document.displayName) (\(style.displayName))")
            } catch {
                let message = error.localizedDescription
                status.wrappedValue = ""
                lastError.wrappedValue = message
                appendLog(kind: .error, message: message)
                webView.loadHTMLString(Self.errorHTML(message: message), baseURL: nil)
            }
        }

        func applyPanelState(_ panelState: MobileMolstarPanelState, in webView: WKWebView) {
            desiredPanelState = panelState
            guard appliedPanelState != panelState else { return }
            webView.evaluateJavaScript("window.BurreteMobileControls && window.BurreteMobileControls.setLayout(\(panelState.jsonString));") { _, error in
                if error == nil {
                    self.appliedPanelState = panelState
                }
            }
        }

        func runControlAction(_ action: MobileMolstarControlAction?, in webView: WKWebView) {
            guard let action, appliedActionID != action.id else { return }
            appliedActionID = action.id
            webView.evaluateJavaScript("window.BurreteMobileControls && window.BurreteMobileControls.runAction(\(Self.javascriptString(action.name)));")
        }

        func runContextMenuCommand(_ command: MobileMolstarContextMenuCommand?, in webView: WKWebView) {
            guard let command, appliedContextCommandID != command.id else { return }
            appliedContextCommandID = command.id
            webView.evaluateJavaScript(
                "window.BurreteMobileControls && window.BurreteMobileControls.runContextMenuAction(\(Self.javascriptString(command.action)), \(Self.javascriptString(command.mode)));"
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let desiredPanelState {
                applyPanelState(desiredPanelState, in: webView)
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String ?? ""
            let text = body["message"] as? String ?? ""
            DispatchQueue.main.async {
                if type == "mobileContextMenu" {
                    self.contextMenu.wrappedValue = Self.mobileContextMenu(from: body)
                } else if type == "mobileInspectorTarget" {
                    let label = body["label"] as? String ?? text
                    let scope = body["scope"] as? String ?? "Selection"
                    self.inspectorTarget.wrappedValue = MobileInspectorTarget(
                        label: label.isEmpty ? "Selection" : label,
                        scope: scope.isEmpty ? "Selection" : scope
                    )
                    self.appendLog(kind: .action, message: "Selected \(label.isEmpty ? "structure target" : label)")
                } else if type == "error" || type == "console.error" {
                    self.lastError.wrappedValue = text.isEmpty ? "Preview failed" : text
                    self.status.wrappedValue = ""
                    self.appendLog(kind: .error, message: text.isEmpty ? "Preview failed" : text)
                } else if type == "status" {
                    self.status.wrappedValue = text
                    self.lastError.wrappedValue = nil
                    self.appendLog(kind: .status, message: text)
                } else if type == "ready" {
                    self.status.wrappedValue = ""
                    self.lastError.wrappedValue = nil
                    self.appendLog(kind: .ready, message: text.isEmpty ? "Preview ready" : text)
                } else if type == "action" {
                    self.appendLog(kind: .action, message: text)
                }
            }
        }

        private func appendLog(kind: MobileLogEntry.Kind, message: String) {
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            var entries = logEntries.wrappedValue
            entries.append(MobileLogEntry(kind: kind, message: trimmed))
            if entries.count > 80 {
                entries.removeFirst(entries.count - 80)
            }
            logEntries.wrappedValue = entries
        }

        private static func mobileContextMenu(from body: [String: Any]) -> MobileContextMenu? {
            let label = body["label"] as? String ?? body["message"] as? String ?? "Selection"
            let scope = body["scope"] as? String ?? "selection"
            let modeValue = body["mode"] as? String ?? MobileContextMenuMode.molecule.rawValue
            let initialMode = MobileContextMenuMode(rawValue: modeValue) ?? .molecule
            let moleculeActions = mobileContextActions(from: body["moleculeActions"])
            let atomActions = mobileContextActions(from: body["atomActions"])
            guard !moleculeActions.isEmpty || !atomActions.isEmpty else { return nil }
            return MobileContextMenu(
                label: label.isEmpty ? "Selection" : label,
                scope: scope.isEmpty ? "selection" : scope,
                initialMode: initialMode,
                moleculeActions: moleculeActions,
                atomActions: atomActions
            )
        }

        private static func mobileContextActions(from value: Any?) -> [MobileContextAction] {
            guard let rawActions = value as? [[String: Any]] else { return [] }
            return rawActions.compactMap { rawAction in
                let name = rawAction["name"] as? String ?? ""
                let title = rawAction["title"] as? String ?? ""
                guard !name.isEmpty, !title.isEmpty else { return nil }
                return MobileContextAction(name: name, title: title)
            }
        }

        private static func javascriptString(_ value: String) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
                  let json = String(data: data, encoding: .utf8),
                  json.count >= 2 else {
                return "\"\""
            }
            return String(json.dropFirst().dropLast())
        }

        private static func errorHTML(message: String) -> String {
            """
            <!doctype html>
            <html>
            <body style="margin:0;background:#111;color:#fff;font:16px -apple-system;padding:24px">
              <h1>Burrete preview failed</h1>
              <pre style="white-space:pre-wrap">\(MobilePreviewRuntime.escapeHTML(message))</pre>
            </body>
            </html>
            """
        }
    }
}

struct MobileMolstarPanelState: Equatable {
    var left = false
    var right = false
    var sequence = false
    var log = false
    var molstarControls = false

    var jsonString: String {
        let payload: [String: Bool] = [
            "left": left,
            "right": right,
            "sequence": sequence,
            "log": log,
            "molstarControls": molstarControls
        ]
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

struct MobileMolstarControlAction: Equatable {
    let id = UUID()
    let name: String
}

struct MobileMolstarContextMenuCommand: Equatable {
    let id = UUID()
    let action: String
    let mode: String
}

private extension MobilePreviewTheme {
    var uiBackgroundColor: UIColor {
        switch self {
        case .dark: .black
        case .light: UIColor(red: 0.965, green: 0.965, blue: 0.949, alpha: 1)
        }
    }
}
