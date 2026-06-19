import Foundation
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct MobilePreviewScreen: View {
    @Environment(\.colorScheme) private var deviceColorScheme
    @State private var status = "Preparing mini.pdb"
    @State private var lastError: String?
    @State private var isProjectDrawerOpen = false
    @State private var activeSheet: MobileSheet?
    @State private var selectedTheme: MobileThemeSelection = .system
    @State private var selectedStyle: MobileMolecularStyle = .illustrative
    @State private var selectedWaterRepresentation: MobileWaterRepresentation = .line
    @State private var selectedProject: MobileProject = .imports
    @State private var currentDocument = MobilePreviewDocument(filename: "mini.pdb")
    @State private var importedDocuments = MobileImportedDocumentStore.loadImportedDocuments()
    @State private var panelState = MobileMolstarPanelState()
    @State private var controlAction: MobileMolstarControlAction?
    @State private var contextMenuCommand: MobileMolstarContextMenuCommand?
    @State private var activeContextMenu: MobileContextMenu?
    @State private var inspectorTarget: MobileInspectorTarget?
    @State private var logEntries: [MobileLogEntry] = []
    @State private var isFileImporterPresented = false

    var body: some View {
        GeometryReader { _ in
            ZStack(alignment: .leading) {
                MobilePreviewWebView(
                    document: currentDocument,
                    theme: resolvedTheme,
                    style: selectedStyle,
                    waterRepresentation: selectedWaterRepresentation,
                    panelState: panelState,
                    controlAction: controlAction,
                    contextMenuCommand: contextMenuCommand,
                    contextMenu: $activeContextMenu,
                    inspectorTarget: $inspectorTarget,
                    logEntries: $logEntries,
                    status: $status,
                    lastError: $lastError
                )
                    .ignoresSafeArea()

                MobileViewerChrome(
                    currentDocument: currentDocument,
                    currentProject: selectedProject,
                    openDrawer: { isProjectDrawerOpen = true },
                    openTools: { activeSheet = .tools }
                )
                .zIndex(20)

                MobileEdgeSwipeZone(isProjectDrawerOpen: $isProjectDrawerOpen)
                    .frame(width: 28)
                    .ignoresSafeArea()
                    .zIndex(10)

                statusOverlay
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .zIndex(15)

                if let playbackKind = currentDocument.playbackKind,
                   activeSheet == nil,
                   !isProjectDrawerOpen {
                    MobilePlaybackBar(kind: playbackKind) { actionName in
                        controlAction = MobileMolstarControlAction(name: actionName)
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(18)
                }

                if isProjectDrawerOpen {
                    MobileProjectDrawer(
                        importedDocuments: importedDocuments,
                        selectedProject: $selectedProject,
                        currentDocument: $currentDocument,
                        importFile: { isFileImporterPresented = true },
                        deleteDocument: deleteImportedDocument,
                        close: { isProjectDrawerOpen = false }
                    )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                        .zIndex(40)
                }

            }
            .animation(.snappy(duration: 0.24), value: isProjectDrawerOpen)
            .animation(.snappy(duration: 0.24), value: activeSheet)
        }
        .background(resolvedTheme.screenBackground)
        .ignoresSafeArea()
        .preferredColorScheme(selectedTheme.preferredColorScheme)
        .sheet(item: $activeSheet) { sheet in
            sheetContent(for: sheet)
                .presentationDetents(sheet.detents)
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
                .presentationCornerRadius(32)
                .presentationContentInteraction(.scrolls)
        }
        .onChange(of: activeContextMenu) { _, menu in
            if let menu {
                activeSheet = .context(menu)
            }
        }
        .onChange(of: activeSheet) { _, sheet in
            if sheet == nil {
                activeContextMenu = nil
            }
        }
        .onOpenURL { url in
            openImportedDocument(from: url)
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                openImportedDocument(from: url)
            case .failure(let error):
                status = ""
                lastError = error.localizedDescription
            }
        }
    }

    private var resolvedTheme: MobilePreviewTheme {
        selectedTheme.resolve(deviceColorScheme: deviceColorScheme)
    }

    @ViewBuilder
    private func sheetContent(for sheet: MobileSheet) -> some View {
        switch sheet {
        case .tools:
            MobileControlsBottomMenu(
                selectedTheme: $selectedTheme,
                resolvedTheme: resolvedTheme,
                selectedStyle: $selectedStyle,
                selectedWaterRepresentation: $selectedWaterRepresentation,
                structureSummary: MobileStructureSummary.load(document: currentDocument),
                inspectorTarget: inspectorTarget,
                logEntries: logEntries,
                runAction: { name in controlAction = MobileMolstarControlAction(name: name) },
                close: { activeSheet = nil }
            )
        case .context(let menu):
            MobileContextMenuSheet(menu: menu) { action, mode in
                contextMenuCommand = MobileMolstarContextMenuCommand(action: action.name, mode: mode.rawValue)
                activeContextMenu = nil
                activeSheet = nil
            }
        }
    }

    @ViewBuilder
    private var statusOverlay: some View {
        if let lastError {
            MobileStatusBanner(text: lastError, isError: true)
                .padding(.horizontal, 14)
                .padding(.bottom, statusBottomPadding)
        } else if !status.isEmpty {
            MobileStatusBanner(text: status, isError: false)
                .padding(.horizontal, 14)
                .padding(.bottom, statusBottomPadding)
        }
    }

    private var statusBottomPadding: CGFloat {
        currentDocument.playbackKind == nil || activeSheet != nil || isProjectDrawerOpen ? 18 : 102
    }

    private func openImportedDocument(from url: URL) {
        do {
            let document = try MobileImportedDocumentStore.importDocument(from: url)
            importedDocuments.removeAll { $0 == document }
            importedDocuments.insert(document, at: 0)
            selectedProject = .imports
            currentDocument = document
            isProjectDrawerOpen = false
            activeSheet = nil
            status = "Opening \(document.displayName)"
            lastError = nil
        } catch {
            status = ""
            lastError = error.localizedDescription
        }
    }

    private func deleteImportedDocument(_ document: MobilePreviewDocument) {
        do {
            try MobileImportedDocumentStore.deleteDocument(document)
            importedDocuments.removeAll { $0 == document }
            if currentDocument == document {
                currentDocument = importedDocuments.first ?? MobilePreviewDocument(filename: "mini.pdb")
                selectedProject = .imports
            }
            status = "Removed \(document.displayName)"
            lastError = nil
        } catch {
            status = ""
            lastError = error.localizedDescription
        }
    }
}

private enum MobileSheet: Identifiable, Equatable {
    case tools
    case context(MobileContextMenu)

    var id: String {
        switch self {
        case .tools:
            "tools"
        case .context(let menu):
            "context-\(menu.id.uuidString)"
        }
    }

    var detents: Set<PresentationDetent> {
        switch self {
        case .tools:
            [.height(420), .medium, .large]
        case .context:
            [.height(460), .medium, .large]
        }
    }
}

private enum MobileToolsTab: String, CaseIterable, Identifiable {
    case style
    case structure
    case table
    case log

    var id: String { rawValue }

    var title: String {
        switch self {
        case .style: "Style"
        case .structure: "Structure"
        case .table: "SDF"
        case .log: "Log"
        }
    }

    var systemImage: String {
        switch self {
        case .style: "paintpalette"
        case .structure: "square.stack.3d.up"
        case .table: "tablecells"
        case .log: "terminal"
        }
    }
}

private enum MobileSDFTableMode: String, CaseIterable, Identifiable {
    case grid
    case table

    var id: String { rawValue }

    var title: String {
        switch self {
        case .grid: "Grid"
        case .table: "Table"
        }
    }
}

private enum MobilePlaybackKind: Equatable {
    case poses
    case trajectory

    var title: String {
        switch self {
        case .poses: "Poses"
        case .trajectory: "Trajectory"
        }
    }

    var systemImage: String {
        switch self {
        case .poses: "square.stack.3d.up"
        case .trajectory: "waveform.path.ecg"
        }
    }

    var actions: [(title: String, systemImage: String, name: String)] {
        switch self {
        case .poses:
            [
                ("Previous", "chevron.left", "pose-prev"),
                ("Show All", "square.grid.2x2", "pose-all"),
                ("Next", "chevron.right", "pose-next")
            ]
        case .trajectory:
            [
                ("Previous", "backward.end", "trajectory-prev"),
                ("Loop", "repeat", "trajectory-loop"),
                ("Next", "forward.end", "trajectory-next")
            ]
        }
    }
}

private struct MobilePlaybackSpeed: Identifiable, Hashable {
    let fps: Double

    var id: Double { fps }

    var title: String {
        if fps.rounded() == fps {
            return "\(Int(fps)) fps"
        }
        return "\(fps) fps"
    }

    var actionName: String {
        "trajectory-speed:\(fps)"
    }

    static let trajectoryOptions: [MobilePlaybackSpeed] = [
        .init(fps: 2),
        .init(fps: 5),
        .init(fps: 10),
        .init(fps: 20),
        .init(fps: 30)
    ]
}

private enum MobileProject: String, Identifiable, Hashable {
    case imports

    var id: String { rawValue }

    var title: String {
        switch self {
        case .imports: "Imported Files"
        }
    }

    var subtitle: String {
        switch self {
        case .imports: "On My iPhone"
        }
    }

    var systemImage: String {
        switch self {
        case .imports: "square.and.arrow.down"
        }
    }
}

private struct MobileViewerChrome: View {
    let currentDocument: MobilePreviewDocument
    let currentProject: MobileProject
    let openDrawer: () -> Void
    let openTools: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            chromeContent
                .padding(.horizontal, 12)
                .padding(.top, 8)

            Spacer()
        }
        .padding(.top, 46)
        .padding(.horizontal, 4)
        .ignoresSafeArea(.container, edges: .top)
    }

    @ViewBuilder
    private var chromeContent: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 10) {
                chromeRow
            }
        } else {
            chromeRow
        }
    }

    private var chromeRow: some View {
        HStack(spacing: 6) {
            ChromeButton(systemName: "sidebar.left", accessibilityLabel: "Open projects", action: openDrawer)

            MobileChromeTitle(currentDocument: currentDocument, currentProject: currentProject)

            ChromeButton(systemName: "slider.horizontal.3", accessibilityLabel: "Open tools", action: openTools)
        }
    }
}

private struct ChromeButton: View {
    let systemName: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Color.clear
                    .frame(width: 52, height: 52)

                Image(systemName: systemName)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .mobileGlass(cornerRadius: 16, interactive: true)
            }
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct MobileChromeTitle: View {
    let currentDocument: MobilePreviewDocument
    let currentProject: MobileProject

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(currentDocument.displayName)
                .font(.headline.weight(.semibold))
                .lineLimit(1)
            Text(currentProject.title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 44)
        .padding(.horizontal, 14)
        .mobileGlass(cornerRadius: 18)
    }
}

private struct MobileEdgeSwipeZone: View {
    @Binding var isProjectDrawerOpen: Bool

    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 18)
                    .onEnded { value in
                        if value.translation.width > 42 {
                            isProjectDrawerOpen = true
                        }
                    }
            )
    }
}

private struct MobileProjectDrawer: View {
    let importedDocuments: [MobilePreviewDocument]
    @Binding var selectedProject: MobileProject
    @Binding var currentDocument: MobilePreviewDocument
    @State private var activeProject: MobileProject?
    let importFile: () -> Void
    let deleteDocument: (MobilePreviewDocument) -> Void
    let close: () -> Void

    var body: some View {
        ZStack {
            MobileDrawerBackground()
                .ignoresSafeArea()

            if let activeProject {
                MobileProjectDetail(
                    project: activeProject,
                    importedDocuments: importedDocuments,
                    currentDocument: $currentDocument,
                    selectedProject: $selectedProject,
                    back: { self.activeProject = nil },
                    importFile: importFile,
                    deleteDocument: deleteDocument,
                    close: close
                )
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                MobileProjectBrowserHome(
                    importedDocuments: importedDocuments,
                    selectedProject: $selectedProject,
                    currentDocument: $currentDocument,
                    openProject: { project in activeProject = project },
                    importFile: importFile,
                    deleteDocument: deleteDocument,
                    close: close
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MobileDrawerBackground())
        .ignoresSafeArea()
        .gesture(
            DragGesture(minimumDistance: 18)
                .onEnded { value in
                    if value.translation.width < -60 {
                        close()
                    }
                },
            including: .gesture
        )
        .animation(.snappy(duration: 0.2), value: activeProject)
    }
}

private struct MobileProjectBrowserHome: View {
    let importedDocuments: [MobilePreviewDocument]
    @Binding var selectedProject: MobileProject
    @Binding var currentDocument: MobilePreviewDocument
    @State private var searchText = ""
    let openProject: (MobileProject) -> Void
    let importFile: () -> Void
    let deleteDocument: (MobilePreviewDocument) -> Void
    let close: () -> Void

    var body: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 20) {
                MobileBrowserHeader(title: "Browse", close: close)
                MobileBrowserSearchField(text: $searchText)
                if !importedDocuments.isEmpty {
                    MobileBrowserImportButton(action: importFile)
                }

                if isSearching {
                    searchResults
                } else {
                    browseSections
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 46)
            .padding(.bottom, 82)
        }
        .background(MobileDrawerBackground())
        .scrollContentBackground(.hidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var isSearching: Bool {
        !searchQuery.isEmpty
    }

    private var searchQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var browseSections: some View {
        VStack(alignment: .leading, spacing: 22) {
            MobileBrowserSection(title: "Locations") {
                MobileBrowserCard {
                    Button {
                        openProject(.imports)
                    } label: {
                        MobileBrowserLocationRow(
                            title: "On My iPhone",
                            subtitle: importedDocuments.isEmpty ? "No imported files" : "\(importedDocuments.count) imported files",
                            systemImage: "iphone",
                            isSelected: selectedProject == .imports
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            if !importedDocuments.isEmpty {
                MobileBrowserSection(title: "Recent") {
                    MobileBrowserCard {
                        ForEach(Array(importedDocuments.prefix(5)).indices, id: \.self) { index in
                            let document = importedDocuments[index]
                            MobileBrowserDocumentRow(
                                document: document,
                                isCurrent: currentDocument == document
                            ) {
                                selectedProject = .imports
                                currentDocument = document
                                close()
                            } delete: {
                                deleteDocument(document)
                            }

                            if index < min(importedDocuments.count, 5) - 1 {
                                MobileBrowserDivider()
                            }
                        }
                    }
                }
            } else {
                MobileBrowserEmptyState(
                    query: "",
                    emptyTitle: "No files on this iPhone",
                    message: "Import a molecular structure from Files to start.",
                    systemImage: "doc.badge.plus",
                    actionTitle: "Import from Files",
                    action: importFile
                )
            }
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        let imports = matchingDocuments(in: importedDocuments)

        if imports.isEmpty {
            MobileBrowserEmptyState(
                query: searchQuery,
                message: "No imported structure matches this search.",
                systemImage: "magnifyingglass"
            )
        } else {
            VStack(alignment: .leading, spacing: 22) {
                MobileBrowserSection(title: "Imported Files") {
                    MobileBrowserCard {
                        ForEach(imports.indices, id: \.self) { index in
                            MobileBrowserDocumentRow(
                                document: imports[index],
                                isCurrent: currentDocument == imports[index]
                            ) {
                                selectedProject = .imports
                                currentDocument = imports[index]
                                close()
                            } delete: {
                                deleteDocument(imports[index])
                            }

                            if index < imports.count - 1 {
                                MobileBrowserDivider()
                            }
                        }
                    }
                }
            }
        }
    }

    private func matchingDocuments(in documents: [MobilePreviewDocument]) -> [MobilePreviewDocument] {
        documents.filter { matches($0.displayName) || matches($0.fileExtension) }
    }

    private func matches(_ value: String) -> Bool {
        value.localizedCaseInsensitiveContains(searchQuery)
    }
}

private struct MobileProjectDetail: View {
    let project: MobileProject
    let importedDocuments: [MobilePreviewDocument]
    @Binding var currentDocument: MobilePreviewDocument
    @Binding var selectedProject: MobileProject
    @State private var searchText = ""
    let back: () -> Void
    let importFile: () -> Void
    let deleteDocument: (MobilePreviewDocument) -> Void
    let close: () -> Void

    var body: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 18) {
                MobileBrowserNavigationHeader(
                    title: project.title,
                    subtitle: project.subtitle,
                    back: back,
                    close: close
                )
                MobileBrowserSearchField(text: $searchText)
                MobileBrowserImportButton(action: importFile)

                importsContent
            }
            .padding(.horizontal, 16)
            .padding(.top, 46)
            .padding(.bottom, 82)
        }
        .background(MobileDrawerBackground())
        .scrollContentBackground(.hidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var importsContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            let documents = filteredImportedDocuments

            if documents.isEmpty {
                MobileBrowserEmptyState(
                    query: searchQuery,
                    emptyTitle: "No imported files",
                    message: searchQuery.isEmpty
                        ? "Import a molecular structure from Files to add it here."
                        : "No imported structure matches this search.",
                    systemImage: searchQuery.isEmpty ? "doc.badge.plus" : "magnifyingglass",
                    actionTitle: searchQuery.isEmpty ? "Import from Files" : nil,
                    action: searchQuery.isEmpty ? importFile : nil
                )
            } else {
                MobileBrowserSection(title: "Files") {
                    MobileBrowserCard {
                        ForEach(documents.indices, id: \.self) { index in
                            let document = documents[index]
                            MobileBrowserDocumentRow(
                                document: document,
                                isCurrent: currentDocument == document
                            ) {
                                selectedProject = .imports
                                currentDocument = document
                                close()
                            } delete: {
                                deleteDocument(document)
                            }

                            if index < documents.count - 1 {
                                MobileBrowserDivider()
                            }
                        }
                    }
                }
            }
        }
    }

    private var filteredImportedDocuments: [MobilePreviewDocument] {
        filterDocuments(importedDocuments)
    }

    private func filterDocuments(_ documents: [MobilePreviewDocument]) -> [MobilePreviewDocument] {
        guard !searchQuery.isEmpty else { return documents }
        return documents.filter {
            $0.displayName.localizedCaseInsensitiveContains(searchQuery) ||
                $0.fileExtension.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    private var searchQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

}

private struct MobileBrowserHeader: View {
    let title: String
    let close: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            Text(title)
                .font(.system(size: 38, weight: .bold, design: .default))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Spacer(minLength: 8)

            MobileBrowserCircleButton(systemName: "xmark", accessibilityLabel: "Close browser", action: close)
        }
    }
}

private struct MobileBrowserNavigationHeader: View {
    let title: String
    let subtitle: String
    let back: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                MobileBrowserCircleButton(systemName: "chevron.left", accessibilityLabel: "Back", action: back)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 28, weight: .bold, design: .default))
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                MobileBrowserCircleButton(systemName: "xmark", accessibilityLabel: "Close browser", action: close)
            }
        }
    }
}

private struct MobileBrowserCircleButton: View {
    let systemName: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Color.clear
                    .frame(width: 56, height: 56)

                Image(systemName: systemName)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 46, height: 46)
                    .background(.regularMaterial, in: Circle())
                    .overlay {
                        Circle()
                            .strokeBorder(Color.primary.opacity(0.10))
                    }
                    .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct MobileBrowserSearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.primary)

            TextField("Search", text: $text)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.primary)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)

            if text.isEmpty {
                Image(systemName: "mic")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(.primary)
            } else {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .frame(height: 56)
        .padding(.horizontal, 16)
        .background(Color(.secondarySystemGroupedBackground), in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.primary.opacity(0.10))
        }
    }
}

private struct MobileBrowserImportButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Import from Files", systemImage: "square.and.arrow.down")
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 52)
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.10))
        }
        .accessibilityLabel("Import from Files")
    }
}

private struct MobileBrowserSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.system(size: 24, weight: .bold))
                Spacer(minLength: 8)
                Image(systemName: "chevron.down")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)

            content
        }
    }
}

private struct MobileBrowserCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct MobileBrowserDivider: View {
    var body: some View {
        Divider()
            .padding(.leading, 64)
    }
}

private struct MobileBrowserLocationRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 23, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 34, height: 34)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 21, weight: .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(.tertiaryLabel))
        }
        .frame(minHeight: 66)
        .padding(.horizontal, 18)
        .contentShape(Rectangle())
    }
}

private struct MobileBrowserDocumentRow: View {
    let document: MobilePreviewDocument
    let isCurrent: Bool
    let open: () -> Void
    let delete: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 14) {
                Image(systemName: document.fileIcon)
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(document.displayName)
                        .font(.system(size: 20, weight: .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    Text(document.fileExtension.uppercased())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if isCurrent {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                }
            }
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(role: .destructive, action: delete) {
                Label("Delete", systemImage: "trash")
            }
        }
        .frame(minHeight: 64)
        .padding(.horizontal, 18)
        .accessibilityLabel(document.displayName)
        .accessibilityHint("Long press for file actions.")
    }
}

private struct MobileBrowserEmptyState: View {
    let query: String
    var emptyTitle = "No results"
    var message = "Try another project, folder, or molecular file name."
    var systemImage = "magnifyingglass"
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.secondary)

            Text(query.isEmpty ? emptyTitle : "No results for \"\(query)\"")
                .font(.headline.weight(.semibold))
                .multilineTextAlignment(.center)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(action: action) {
                    Label(actionTitle, systemImage: "square.and.arrow.down")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .padding(.horizontal, 16)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .background(.regularMaterial, in: Capsule())
                .overlay {
                    Capsule()
                        .strokeBorder(Color.primary.opacity(0.10))
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 166)
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct ThemeSelector: View {
    @Binding var selectedTheme: MobileThemeSelection

    var body: some View {
        Picker("Appearance", selection: $selectedTheme) {
            ForEach(MobileThemeSelection.allCases) { theme in
                Label(theme.displayName, systemImage: theme.systemImage)
                    .tag(theme)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Appearance")
    }
}

private struct MobileControlsBottomMenu: View {
    @Binding var selectedTheme: MobileThemeSelection
    let resolvedTheme: MobilePreviewTheme
    @Binding var selectedStyle: MobileMolecularStyle
    @Binding var selectedWaterRepresentation: MobileWaterRepresentation
    let structureSummary: MobileStructureSummary
    let inspectorTarget: MobileInspectorTarget?
    let logEntries: [MobileLogEntry]
    @State private var selectedTab: MobileToolsTab = .style
    let runAction: (String) -> Void
    let close: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 14) {
                sheetPanel
            }
        } else {
            sheetPanel
        }
    }

    private var sheetPanel: some View {
        VStack(spacing: 14) {
            header
            toolTabs

            ScrollView(.vertical, showsIndicators: true) {
                selectedToolContent
                .padding(.bottom, 2)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 18)
        .background(resolvedTheme.sheetBackground)
        .onChange(of: structureSummary.document.id) { _, _ in
            if !visibleTabs.contains(selectedTab) {
                selectedTab = .style
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Label("Tools", systemImage: "slider.horizontal.3")
                .font(.headline.weight(.semibold))
                .labelStyle(.titleAndIcon)

            Spacer(minLength: 8)

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 36, height: 36)
                    .mobileGlass(cornerRadius: 18, interactive: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close controls")
        }
    }

    private var toolTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(visibleTabs) { tab in
                    MobileToolTabButton(
                        tab: tab,
                        isSelected: selectedTab == tab
                    ) {
                        selectedTab = tab
                    }
                }
            }
            .padding(.horizontal, 1)
        }
        .accessibilityLabel("Tool section")
    }

    @ViewBuilder
    private var selectedToolContent: some View {
        switch selectedTab {
        case .style:
            VStack(alignment: .leading, spacing: 18) {
                MobileMenuSection(title: "Appearance") {
                    ThemeSelector(selectedTheme: $selectedTheme)
                }

                MobileMenuSection(title: "Representation") {
                    LazyVGrid(columns: actionColumns, spacing: 12) {
                        ForEach(MobileMolecularStyle.allCases) { style in
                            StyleOptionButton(
                                style: style,
                                isSelected: selectedStyle == style
                            ) {
                                selectedStyle = style
                            }
                        }
                    }
                }

                MobileMenuSection(title: "Scene") {
                    Picker("Water", selection: $selectedWaterRepresentation) {
                        ForEach(MobileWaterRepresentation.allCases) { representation in
                            Text(representation.displayName)
                                .tag(representation)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }

        case .structure:
            VStack(alignment: .leading, spacing: 18) {
                MobileMenuSection(title: "Structure Browser") {
                    MobileStructureBrowser(summary: structureSummary)
                }

                MobileMenuSection(title: "Inspector") {
                    MobileInspectorView(target: inspectorTarget)
                }

                MobileMenuSection(title: "Sequence") {
                    MobileSequenceView(chains: structureSummary.chainSummaries)
                }
            }

        case .table:
            VStack(alignment: .leading, spacing: 18) {
                MobileMenuSection(title: "SDF Browser") {
                    MobileSDFRecordsView(records: structureSummary.sdfRecords, runAction: runAction)
                }
            }

        case .log:
            VStack(alignment: .leading, spacing: 18) {
                MobileMenuSection(title: "Log") {
                    MobileLogView(entries: logEntries)
                }
            }
        }
    }

    private var actionColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: 12),
            GridItem(.flexible(), spacing: 12)
        ]
    }

    private var visibleTabs: [MobileToolsTab] {
        MobileToolsTab.allCases.filter { tab in
            tab != .table || !structureSummary.sdfRecords.isEmpty
        }
    }
}

private struct MobileMenuSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .padding(.horizontal, 2)

            content
        }
    }
}

private struct MobileToolTabButton: View {
    let tab: MobileToolsTab
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(height: 18)

                Text(tab.title)
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isSelected ? Color.accentColor : .primary)
            .frame(width: 80, height: 54)
            .mobileGlass(
                cornerRadius: 16,
                interactive: true,
                tint: isSelected ? Color.accentColor.opacity(0.16) : nil
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct MobilePlaybackBar: View {
    let kind: MobilePlaybackKind
    let runAction: (String) -> Void
    @State private var selectedTrajectorySpeed = MobilePlaybackSpeed.trajectoryOptions[3]

    var body: some View {
        HStack(spacing: 12) {
            Label(kind.title, systemImage: kind.systemImage)
                .font(.subheadline.weight(.semibold))
                .labelStyle(.iconOnly)
                .frame(width: 48, height: 48)
                .mobileGlass(cornerRadius: 16)
                .accessibilityLabel(kind.title)

            HStack(spacing: 8) {
                ForEach(kind.actions, id: \.name) { action in
                    Button {
                        runAction(action.name)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: action.systemImage)
                                .font(.system(size: 18, weight: .semibold))
                            Text(action.title)
                                .font(.caption2.weight(.semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.78)
                        }
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .mobileGlass(cornerRadius: 18, interactive: true)
                    .accessibilityLabel("\(kind.title) \(action.title)")
                }

                if kind == .trajectory {
                    speedMenu
                }
            }
        }
        .padding(10)
        .mobileGlass(cornerRadius: 26)
    }

    private var speedMenu: some View {
        Menu {
            ForEach(MobilePlaybackSpeed.trajectoryOptions) { speed in
                Button {
                    selectedTrajectorySpeed = speed
                    runAction(speed.actionName)
                } label: {
                    if speed == selectedTrajectorySpeed {
                        Label(speed.title, systemImage: "checkmark")
                    } else {
                        Text(speed.title)
                    }
                }
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: "speedometer")
                    .font(.system(size: 18, weight: .semibold))
                Text(selectedTrajectorySpeed.title)
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: 58)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .mobileGlass(cornerRadius: 18, interactive: true)
        .accessibilityLabel("Trajectory speed \(selectedTrajectorySpeed.title)")
    }
}

private struct MobileContextMenuSheet: View {
    @Environment(\.dismiss) private var dismiss

    let menu: MobileContextMenu
    let runAction: (MobileContextAction, MobileContextMenuMode) -> Void
    @State private var selectedMode: MobileContextMenuMode

    init(
        menu: MobileContextMenu,
        runAction: @escaping (MobileContextAction, MobileContextMenuMode) -> Void
    ) {
        self.menu = menu
        self.runAction = runAction
        _selectedMode = State(initialValue: menu.initialMode)
    }

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 14) {
                content
            }
        } else {
            content
        }
    }

    private var content: some View {
        VStack(spacing: 14) {
            header

            if menu.supportsAtomMode {
                Picker("Selection scope", selection: $selectedMode) {
                    ForEach(MobileContextMenuMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityLabel("Selection scope")
            }

            ScrollView(.vertical, showsIndicators: true) {
                VStack(spacing: 10) {
                    ForEach(displayActions) { action in
                        MobileContextActionRow(action: action) {
                            runAction(action, selectedMode)
                        }
                    }
                }
                .padding(.bottom, 4)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 18)
    }

    private var displayActions: [MobileContextAction] {
        menu.actions(for: selectedMode).sorted { lhs, rhs in
            if lhs.isDestructive == rhs.isDestructive { return false }
            return !lhs.isDestructive && rhs.isDestructive
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: menu.scope.contextSystemImage)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 42, height: 42)
                .mobileGlass(cornerRadius: 15)

            VStack(alignment: .leading, spacing: 2) {
                Text(menu.label)
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                    .fixedSize(horizontal: false, vertical: true)
                Text(menu.scope.contextTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 36, height: 36)
                    .mobileGlass(cornerRadius: 18, interactive: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close context menu")
        }
    }
}

private struct MobileContextActionRow: View {
    let action: MobileContextAction
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            HStack(spacing: 12) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(action.isDestructive ? .red : .primary)
                    .frame(width: 32, height: 32)

                Text(action.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(action.isDestructive ? .red : .primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 8)

                if !action.isDestructive {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .mobileGlass(
            cornerRadius: 18,
            interactive: true,
            tint: action.isDestructive ? Color.red.opacity(0.12) : nil
        )
        .accessibilityLabel(action.title)
    }
}

private struct MobileStructureBrowser: View {
    let summary: MobileStructureSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                MobileMetricTile(title: "Atoms", value: "\(summary.atomCount)", systemImage: "circle.hexagongrid")
                MobileMetricTile(title: "Residues", value: "\(summary.residueCount)", systemImage: "square.stack.3d.up")
            }

            HStack(spacing: 12) {
                MobileMetricTile(title: "Chains", value: "\(summary.chainSummaries.count)", systemImage: "link")
                MobileMetricTile(title: summary.summaryKind, value: summary.byteCount.formattedByteCount, systemImage: "doc")
            }

            HStack(spacing: 10) {
                Image(systemName: summary.document.fileIcon)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .mobileGlass(cornerRadius: 10)

                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.document.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(summary.document.bundlePath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(14)
            .mobileGlass(cornerRadius: 16)
        }
    }
}

private struct MobileMetricTile: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .padding(14)
        .mobileGlass(cornerRadius: 16)
    }
}

private struct MobileInspectorView: View {
    let target: MobileInspectorTarget?

    var body: some View {
        if let target {
            VStack(alignment: .leading, spacing: 8) {
                Label(target.scope.capitalized, systemImage: "scope")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(target.label)
                    .font(.body.weight(.semibold))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .mobileGlass(cornerRadius: 16, tint: Color.accentColor.opacity(0.12))
        } else {
            MobileEmptyStateRow(
                title: "No selection",
                subtitle: "Long press an atom, residue, or ligand in the viewport.",
                systemImage: "hand.tap"
            )
        }
    }
}

private struct MobileSequenceView: View {
    let chains: [MobileChainSummary]

    var body: some View {
        if chains.isEmpty {
            MobileEmptyStateRow(
                title: "No polymer sequence",
                subtitle: "This file does not expose chain sequence data.",
                systemImage: "text.alignleft"
            )
        } else {
            VStack(spacing: 10) {
                ForEach(chains) { chain in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Label("Chain \(chain.chainID)", systemImage: "link")
                                .font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Text("\(chain.residueCount) residues")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(chain.sequence)
                            .font(.system(.caption, design: .monospaced).weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(4)
                            .textSelection(.enabled)
                    }
                    .padding(14)
                    .mobileGlass(cornerRadius: 16)
                }
            }
        }
    }
}

private struct MobileSDFRecordsView: View {
    let records: [MobileSDFRecordSummary]
    let runAction: (String) -> Void
    @State private var mode: MobileSDFTableMode = .grid

    var body: some View {
        if records.isEmpty {
            MobileEmptyStateRow(
                title: "No SDF records",
                subtitle: "This file does not expose separate molecule records.",
                systemImage: "tablecells"
            )
        } else {
            VStack(alignment: .leading, spacing: 14) {
                Picker("SDF view", selection: $mode) {
                    ForEach(MobileSDFTableMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                switch mode {
                case .grid:
                    LazyVGrid(columns: gridColumns, spacing: 12) {
                        ForEach(records) { record in
                            MobileSDFRecordCard(record: record) {
                                runAction("pose-index:\(record.index)")
                            }
                        }
                    }
                case .table:
                    VStack(spacing: 8) {
                        MobileSDFTableHeader()
                        ForEach(records) { record in
                            MobileSDFTableRow(record: record) {
                                runAction("pose-index:\(record.index)")
                            }
                        }
                    }
                }
            }
        }
    }

    private var gridColumns: [GridItem] {
        [
            GridItem(.adaptive(minimum: 164), spacing: 12)
        ]
    }
}

private struct MobileSDFRecordCard: View {
    let record: MobileSDFRecordSummary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                MobileSDFMoleculeThumbnail(record: record)
                    .frame(height: 116)

                HStack(alignment: .top, spacing: 8) {
                    Text("#\(record.index + 1)")
                        .font(.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 4)

                    Image(systemName: "scope")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Text(record.displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                    .frame(maxWidth: .infinity, alignment: .leading)

                MobileSDFMetricStrip(record: record)
                MobileSDFPropertyChips(properties: record.properties, limit: 2)
            }
            .frame(maxWidth: .infinity, minHeight: 262, alignment: .topLeading)
            .padding(14)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .mobileGlass(cornerRadius: 18, interactive: true)
        .accessibilityLabel("Open \(record.displayName)")
    }
}

private struct MobileSDFTableHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("Preview")
                .frame(width: 72, alignment: .leading)
            Text("#")
                .frame(width: 28, alignment: .leading)
            Text("Molecule")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Atoms")
                .frame(width: 50, alignment: .trailing)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
    }
}

private struct MobileSDFTableRow: View {
    let record: MobileSDFRecordSummary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                MobileSDFMoleculeThumbnail(record: record)
                    .frame(width: 72, height: 56)

                Text("\(record.index + 1)")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(width: 28, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text(record.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let property = record.properties.first {
                        Text("\(property.name): \(property.value)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(record.atomCount)")
                        .font(.subheadline.monospacedDigit())
                    Text("atoms")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 50, alignment: .trailing)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .mobileGlass(cornerRadius: 16, interactive: true)
        .accessibilityLabel("Open \(record.displayName)")
    }
}

private struct MobileSDFMoleculeThumbnail: View {
    let record: MobileSDFRecordSummary
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(.tertiarySystemGroupedBackground))

                MobileRDKitMoleculeView(
                    molblock: record.molblock,
                    darkMode: colorScheme == .dark
                )
                .padding(8)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
        }
    }
}

private struct MobileRDKitMoleculeView: UIViewRepresentable {
    let molblock: String
    let darkMode: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isUserInteractionEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.molblock != molblock || context.coordinator.darkMode != darkMode else { return }
        context.coordinator.molblock = molblock
        context.coordinator.darkMode = darkMode

        guard let rdkitDirectory = Bundle.main.url(forResource: "Web", withExtension: nil)?
            .appendingPathComponent("rdkit", isDirectory: true) else {
            webView.loadHTMLString(Self.unavailableHTML(message: "RDKit assets unavailable"), baseURL: nil)
            return
        }
        let wasmURL = rdkitDirectory.appendingPathComponent("RDKit_minimal.wasm").absoluteString

        webView.loadHTMLString(
            Self.renderHTML(molblock: molblock, wasmURL: wasmURL, darkMode: darkMode),
            baseURL: rdkitDirectory
        )
    }

    private static func renderHTML(molblock: String, wasmURL: String, darkMode: Bool) -> String {
        let molblockJSON = jsonString(molblock)
        let wasmURLJSON = jsonString(wasmURL)
        let foreground = darkMode ? "#F5F5F7" : "#1D1D1F"
        return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
          <style>
            html, body, #root {
              width: 100%;
              height: 100%;
              margin: 0;
              overflow: hidden;
              background: transparent;
              color: \(foreground);
              -webkit-user-select: none;
              user-select: none;
            }
            #root {
              display: flex;
              align-items: center;
              justify-content: center;
            }
            svg {
              width: 100%;
              height: 100%;
              display: block;
            }
            .fallback {
              font: 600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
              color: rgba(\(darkMode ? "245, 245, 247" : "29, 29, 31"), 0.56);
              text-align: center;
            }
          </style>
          <script src="RDKit_minimal.js"></script>
        </head>
        <body>
          <div id="root"><div class="fallback">RDKit</div></div>
          <script>
            const molblock = \(molblockJSON);
            const wasmURL = \(wasmURLJSON);
            const darkMode = \(darkMode ? "true" : "false");

            function fallback(message) {
              document.getElementById('root').innerHTML = '<div class="fallback">' + message + '</div>';
            }

            function adaptSVG(svg) {
              if (!darkMode) return svg;
              return svg
                .replace(/stroke:#000000/gi, 'stroke:#F5F5F7')
                .replace(/stroke:#000/gi, 'stroke:#F5F5F7')
                .replace(/fill:#000000/gi, 'fill:#F5F5F7')
                .replace(/fill:#000/gi, 'fill:#F5F5F7');
            }

            async function render() {
              if (!window.initRDKitModule) {
                fallback('RDKit unavailable');
                return;
              }

              const RDKit = await window.initRDKitModule({
                locateFile: (path) => path.endsWith('.wasm') ? wasmURL : path
              });
              const mol = RDKit.get_mol(molblock || '');
              if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) {
                fallback('No molecule');
                return;
              }

              try {
                if (typeof mol.set_new_coords === 'function') mol.set_new_coords();
                document.getElementById('root').innerHTML = adaptSVG(mol.get_svg(260, 190));
              } finally {
                if (mol && typeof mol.delete === 'function') mol.delete();
              }
            }

            render().catch(() => fallback('RDKit failed'));
          </script>
        </body>
        </html>
        """
    }

    private static func unavailableHTML(message: String) -> String {
        """
        <!doctype html>
        <html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;color:#8E8E93;font:600 12px -apple-system">\(MobilePreviewRuntime.escapeHTML(message))</body></html>
        """
    }

    private static func jsonString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let string = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return string
    }

    final class Coordinator {
        var molblock: String?
        var darkMode: Bool?
    }
}

private struct MobileSDFMetricStrip: View {
    let record: MobileSDFRecordSummary

    var body: some View {
        HStack(spacing: 8) {
            MobileSDFCountPill(title: "Atoms", value: record.atomCount)
            MobileSDFCountPill(title: "Bonds", value: record.bondCount)
        }
    }
}

private struct MobileSDFPropertyChips: View {
    let properties: [MobileSDFRecordProperty]
    let limit: Int

    var body: some View {
        let visibleProperties = Array(properties.prefix(limit).enumerated())
        if !visibleProperties.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(visibleProperties, id: \.offset) { _, property in
                    Text("\(property.name): \(property.value)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .mobileGlass(cornerRadius: 9)
                }
            }
        }
    }
}

private struct MobileSDFCountPill: View {
    let title: String
    let value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.caption.weight(.semibold))
                .monospacedDigit()
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .mobileGlass(cornerRadius: 10)
    }
}

private struct MobileLogView: View {
    let entries: [MobileLogEntry]

    var body: some View {
        if entries.isEmpty {
            MobileEmptyStateRow(
                title: "No log entries",
                subtitle: "Preview messages and actions will appear here.",
                systemImage: "terminal"
            )
        } else {
            VStack(spacing: 10) {
                ForEach(entries.suffix(40)) { entry in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: entry.kind.systemImage)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(entry.kind.tint)
                            .frame(width: 24, height: 24)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.message)
                                .font(.footnote.weight(.medium))
                                .lineLimit(4)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(entry.date.formatted(date: .omitted, time: .standard))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .mobileGlass(cornerRadius: 14)
                }
            }
        }
    }
}

private struct MobileEmptyStateRow: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 36, height: 36)
                .mobileGlass(cornerRadius: 12)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .mobileGlass(cornerRadius: 16)
    }
}

private struct MobileControlActionButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .padding(.horizontal, 14)
            .mobileGlass(cornerRadius: 16, interactive: true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

private struct StyleOptionButton: View {
    let style: MobileMolecularStyle
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: style.systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)

                Text(style.displayName)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .foregroundStyle(isSelected ? Color.accentColor : .primary)
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .padding(.horizontal, 14)
            .mobileGlass(
                cornerRadius: 16,
                interactive: true,
                tint: isSelected ? Color.accentColor.opacity(0.18) : nil
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(style.displayName)
    }
}

private struct MobileDoneButton: View {
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            Button("Done", action: action)
                .buttonStyle(.glass)
        } else {
            Button("Done", action: action)
        }
    }
}

private extension MobileThemeSelection {
    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }

    func resolve(deviceColorScheme: ColorScheme) -> MobilePreviewTheme {
        switch self {
        case .system:
            deviceColorScheme == .dark ? .dark : .light
        case .dark:
            .dark
        case .light:
            .light
        }
    }
}

private extension MobilePreviewTheme {
    var screenBackground: Color {
        switch self {
        case .dark: .black
        case .light: Color(red: 0.965, green: 0.965, blue: 0.949)
        }
    }

    var sheetBackground: Color {
        switch self {
        case .dark: Color.black.opacity(0.10)
        case .light: Color.white.opacity(0.08)
        }
    }
}

private extension MobileContextAction {
    var isDestructive: Bool {
        name == "remove" || name == "remove-type" || name == "remove-chain" || name == "remove-atom"
    }

    var systemImage: String {
        if name == "select" || name == "select-atom" { return "scope" }
        if name == "focus" || name == "focus-atom" { return "viewfinder" }
        if name == "molstar" { return "cube.transparent" }
        if name == "save-modified" { return "square.and.arrow.down" }
        if name.hasPrefix("save-format:") { return "doc.badge.arrow.up" }
        if isDestructive { return "trash" }
        return "sparkles"
    }
}

private extension String {
    var contextTitle: String {
        switch lowercased() {
        case "ligand": "Ligand actions"
        case "ion": "Ion actions"
        case "water": "Water actions"
        case "residue": "Residue actions"
        case "selection": "Selection actions"
        default: "Molecule actions"
        }
    }

    var contextSystemImage: String {
        switch lowercased() {
        case "ligand": "hexagon"
        case "ion": "circle.hexagongrid"
        case "water": "drop"
        case "residue": "square.stack.3d.up"
        case "selection": "scope"
        default: "cube"
        }
    }
}

private extension MobilePreviewDocument {
    var fileIcon: String {
        switch fileExtension {
        case "pdb": "cube"
        case "cif": "tablecells"
        case "sdf": "doc.text"
        case "xyz", "xyzr": "point.3.connected.trianglepath.dotted"
        case "smi": "text.line.first.and.arrowtriangle.forward"
        case "csv", "tsv": "tablecells.badge.ellipsis"
        case "dcd", "xtc", "trr", "nctraj", "lammpstrj": "waveform.path.ecg"
        case "prmtop", "psf", "top": "link"
        default: "doc"
        }
    }

    var playbackKind: MobilePlaybackKind? {
        switch fileExtension {
        case "sdf", "pdbqt", "mol2":
            .poses
        case "xyz", "xyzr":
            xyzFrameCount(frameLimit: 2) > 1 ? .trajectory : nil
        case "arc", "dcd", "dump", "gsd", "lammpstrj", "nc", "ncdf", "nctraj", "netcdf", "tng", "trr", "trz", "xtc":
            .trajectory
        default:
            nil
        }
    }
}

private extension Int {
    var formattedByteCount: String {
        ByteCountFormatter.string(fromByteCount: Int64(self), countStyle: .file)
    }
}

private extension MobileLogEntry.Kind {
    var systemImage: String {
        switch self {
        case .status: "info.circle"
        case .error: "exclamationmark.triangle"
        case .ready: "checkmark.circle"
        case .action: "bolt"
        }
    }

    var tint: Color {
        switch self {
        case .status: .secondary
        case .error: .red
        case .ready: .green
        case .action: .accentColor
        }
    }
}

private extension Array where Element == MobilePreviewDocument {
    func sortedByDisplayName() -> [MobilePreviewDocument] {
        sorted { lhs, rhs in
            lhs.displayName.localizedStandardCompare(rhs.displayName) == .orderedAscending
        }
    }
}

private struct MobileStatusBanner: View {
    let text: String
    let isError: Bool

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(isError ? .white : .primary)
            .lineLimit(4)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .mobileGlass(
                cornerRadius: 12,
                tint: isError ? Color.red.opacity(0.35) : nil
            )
            .accessibilityLabel(isError ? "Preview error" : "Preview status")
    }
}

private struct MobileDrawerBackground: View {
    var body: some View {
        Rectangle()
            .fill(Color(.systemBackground).opacity(0.82))
            .background(.regularMaterial)
    }
}

private struct MobileGlassModifier: ViewModifier {
    let cornerRadius: CGFloat
    let interactive: Bool
    let tint: Color?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if interactive, let tint {
                content
                    .glassEffect(.regular.tint(tint).interactive(), in: .rect(cornerRadius: cornerRadius))
            } else if interactive {
                content
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius))
            } else if let tint {
                content
                    .glassEffect(.regular.tint(tint), in: .rect(cornerRadius: cornerRadius))
            } else {
                content
                    .glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            content
                .background {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay {
                            if let tint {
                                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                                    .fill(tint)
                            }
                        }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(.white.opacity(0.18))
                }
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }
}

private extension View {
    func mobileGlass(cornerRadius: CGFloat, interactive: Bool = false, tint: Color? = nil) -> some View {
        modifier(MobileGlassModifier(cornerRadius: cornerRadius, interactive: interactive, tint: tint))
    }
}
