import SwiftUI
import WebKit

final class MoleculeViewerWorkspace: ObservableObject {
    @Published private(set) var documents: [MoleculeViewerDocument] = []

    func updateDocuments(_ urls: [URL]) {
        documents = urls
            .map { MoleculeViewerDocument(url: $0.standardizedFileURL) }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}

struct MoleculeViewerDocument: Identifiable, Equatable {
    let url: URL

    var id: String { url.path }
    var title: String { url.lastPathComponent }
    var detail: String { url.deletingLastPathComponent().lastPathComponent }
    var fileExtension: String { url.pathExtension.uppercased() }
}

struct MoleculeViewerScene: View {
    let webView: WKWebView
    let currentFileURL: URL
    let transparentWindow: Bool
    let windowOpacity: Double
    @ObservedObject var workspace: MoleculeViewerWorkspace
    let showDocument: (URL) -> Void
    let openSettings: () -> Void

    @State private var isSidebarVisible = true

    private let sidebarWidth: CGFloat = 236
    private let surfaceCornerRadius: CGFloat = 8
    private let surfaceInset: CGFloat = 12

    var body: some View {
        HStack(spacing: 0) {
            if isSidebarVisible {
                MoleculeViewerSidebar(
                    currentFileURL: currentFileURL,
                    documents: workspace.documents,
                    showDocument: showDocument,
                    openSettings: openSettings
                )
                .frame(width: sidebarWidth)
                .transition(.move(edge: .leading).combined(with: .opacity))

                Divider()
            }

            VStack(spacing: 0) {
                MoleculeViewerHeader(
                    title: currentFileURL.lastPathComponent,
                    subtitle: currentFileURL.deletingLastPathComponent().path,
                    fileExtension: currentFileURL.pathExtension.uppercased(),
                    isSidebarVisible: isSidebarVisible,
                    toggleSidebar: toggleSidebar
                )

                WebViewRepresentable(webView: webView)
                    .clipShape(RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous)
                            .strokeBorder(Color.secondary.opacity(0.24), lineWidth: 1)
                    }
                    .shadow(color: Color.black.opacity(transparentWindow ? 0.18 : 0.09), radius: 9, x: 0, y: 2)
                    .padding(surfaceInset)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(sceneBackground)
        .animation(.easeInOut(duration: 0.16), value: isSidebarVisible)
    }

    @ViewBuilder
    private var sceneBackground: some View {
        if transparentWindow {
            Rectangle()
                .fill(.regularMaterial)
                .opacity(windowOpacity)
                .ignoresSafeArea()
        } else {
            Rectangle()
                .fill(.background)
                .ignoresSafeArea()
        }
    }

    private func toggleSidebar() {
        isSidebarVisible.toggle()
    }
}

private struct MoleculeViewerHeader: View {
    let title: String
    let subtitle: String
    let fileExtension: String
    let isSidebarVisible: Bool
    let toggleSidebar: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: toggleSidebar) {
                Image(systemName: isSidebarVisible ? "sidebar.left" : "sidebar.right")
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.borderless)
            .help(isSidebarVisible ? "Hide sidebar" : "Show sidebar")

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            if !fileExtension.isEmpty {
                Text(fileExtension)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
            }
        }
        .frame(height: 46)
        .padding(.horizontal, 14)
        .background(.bar)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

private struct MoleculeViewerSidebar: View {
    let currentFileURL: URL
    let documents: [MoleculeViewerDocument]
    let showDocument: (URL) -> Void
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            List {
                Section("Projects") {
                    if documents.isEmpty {
                        Text("No open structures")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(documents) { document in
                            Button {
                                showDocument(document.url)
                            } label: {
                                MoleculeViewerSidebarRow(
                                    document: document,
                                    isSelected: document.url == currentFileURL.standardizedFileURL
                                )
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(
                                document.url == currentFileURL.standardizedFileURL
                                    ? Color.accentColor.opacity(0.18)
                                    : Color.clear
                            )
                        }
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()

            Button(action: openSettings) {
                Label("Settings", systemImage: "gearshape")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
            }
            .buttonStyle(.plain)
            .help("Open Burrete settings")
        }
        .background(.bar)
    }
}

private struct MoleculeViewerSidebarRow: View {
    let document: MoleculeViewerDocument
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "atom")
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(document.title)
                    .lineLimit(1)
                Text(document.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
    }
}
