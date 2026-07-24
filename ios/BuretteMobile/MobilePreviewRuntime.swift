import Foundation

enum MobileThemeSelection: String, CaseIterable, Identifiable {
    case system
    case dark
    case light

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }

    var systemImage: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .dark: "moon"
        case .light: "sun.max"
        }
    }
}

enum MobilePreviewTheme: String, CaseIterable, Identifiable {
    case dark
    case light

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .dark: "Dark"
        case .light: "Light"
        }
    }

    var systemImage: String {
        switch self {
        case .dark: "moon"
        case .light: "sun.max"
        }
    }

    var canvasBackground: String {
        switch self {
        case .dark: "#050505"
        case .light: "#f6f6f2"
        }
    }
}

enum MobileMolecularStyle: String, CaseIterable, Identifiable {
    case illustrative
    case polymerLigand = "polymer-ligand"
    case cartoon
    case ballAndStick = "ball-and-stick"
    case spacefill
    case line
    case molecularSurface = "molecular-surface"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .illustrative: "Illustrative"
        case .polymerLigand: "Polymer+Ligand"
        case .cartoon: "Cartoon"
        case .ballAndStick: "Ball+Stick"
        case .spacefill: "Spacefill"
        case .line: "Line"
        case .molecularSurface: "Surface"
        }
    }

    var systemImage: String {
        switch self {
        case .illustrative: "sparkles"
        case .polymerLigand: "point.3.connected.trianglepath.dotted"
        case .cartoon: "waveform.path"
        case .ballAndStick: "circle.grid.cross"
        case .spacefill: "circle.hexagongrid.fill"
        case .line: "line.diagonal"
        case .molecularSurface: "capsule"
        }
    }
}

enum MobileWaterRepresentation: String, CaseIterable, Identifiable {
    case line
    case standard

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .line: "Lines"
        case .standard: "Standard"
        }
    }

    var configValue: String {
        switch self {
        case .line: "line"
        case .standard: "standard"
        }
    }
}

struct MobilePreviewDocument: Identifiable, Hashable {
    let filename: String
    let bundleSubdirectory: String?
    let importedFileURL: URL?

    init(filename: String, bundleSubdirectory: String? = nil, importedFileURL: URL? = nil) {
        self.filename = filename
        self.bundleSubdirectory = bundleSubdirectory
        self.importedFileURL = importedFileURL
    }

    var id: String {
        if let importedFileURL {
            return "imported:\(importedFileURL.standardizedFileURL.path)"
        }
        if let bundleSubdirectory {
            return "\(bundleSubdirectory)/\(filename)"
        }
        return filename
    }

    var displayName: String { filename }

    var fileExtension: String {
        URL(fileURLWithPath: filename).pathExtension.lowercased()
    }

    var resourceName: String {
        URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
    }

    var format: String {
        switch fileExtension {
        case "":
            "pdb"
        case "xyzr":
            "xyz"
        default:
            fileExtension
        }
    }

    var bundlePath: String {
        if importedFileURL != nil {
            return "Imported/\(filename)"
        }
        if let bundleSubdirectory {
            return "\(bundleSubdirectory)/\(filename)"
        }
        return filename
    }

    func bundleURL(bundle: Bundle = .main) -> URL? {
        if let importedFileURL {
            return importedFileURL
        }
        return bundle.url(
            forResource: resourceName,
            withExtension: fileExtension,
            subdirectory: bundleSubdirectory
        ) ?? bundle.url(forResource: resourceName, withExtension: fileExtension)
    }

    func xyzFrameCount(bundle: Bundle = .main, frameLimit: Int = .max) -> Int {
        guard fileExtension == "xyz" || fileExtension == "xyzr",
              let url = bundleURL(bundle: bundle),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return 0
        }
        return Self.countXYZFrames(in: text, frameLimit: frameLimit)
    }

    private static func countXYZFrames(in text: String, frameLimit: Int) -> Int {
        let cappedFrameLimit = max(0, frameLimit)
        guard cappedFrameLimit > 0 else { return 0 }

        let lines = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        var index = 0
        var frameCount = 0

        while index < lines.count && frameCount < cappedFrameLimit {
            while index < lines.count && lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                index += 1
            }
            guard index < lines.count,
                  let atomToken = lines[index].split(whereSeparator: \.isWhitespace).first,
                  let atomCount = Int(atomToken),
                  atomCount > 0 else {
                break
            }

            let firstAtomIndex = index + 2
            let endIndex = firstAtomIndex + atomCount
            guard endIndex <= lines.count else { break }
            let atomLines = lines[firstAtomIndex..<endIndex]
            guard atomLines.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                break
            }

            frameCount += 1
            index = endIndex
        }

        return frameCount
    }
}

enum MobileImportedDocumentStore {
    static func loadImportedDocuments(fileManager: FileManager = .default) -> [MobilePreviewDocument] {
        guard let directory = importsDirectory(fileManager: fileManager),
              let files = try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
                options: [.skipsHiddenFiles]
              ) else {
            return []
        }

        return files
            .filter { url in
                (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            }
            .sorted { lhs, rhs in
                let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return lhsDate > rhsDate
            }
            .map { url in
                MobilePreviewDocument(filename: url.lastPathComponent, importedFileURL: url)
            }
    }

    static func importDocument(from sourceURL: URL, fileManager: FileManager = .default) throws -> MobilePreviewDocument {
        guard let directory = importsDirectory(fileManager: fileManager) else {
            throw ImportError.documentsDirectoryUnavailable
        }

        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

        let didAccessSecurityScope = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if didAccessSecurityScope {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let fileName = sourceURL.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fileName.isEmpty else { throw ImportError.missingFilename }

        let destinationURL = uniqueDestinationURL(
            in: directory,
            preferredFilename: fileName,
            fileManager: fileManager
        )
        try fileManager.copyItem(at: sourceURL, to: destinationURL)
        return MobilePreviewDocument(filename: destinationURL.lastPathComponent, importedFileURL: destinationURL)
    }

    static func deleteDocument(_ document: MobilePreviewDocument, fileManager: FileManager = .default) throws {
        guard let importedFileURL = document.importedFileURL else { return }
        guard fileManager.fileExists(atPath: importedFileURL.path) else { return }
        try fileManager.removeItem(at: importedFileURL)
    }

    private static func importsDirectory(fileManager: FileManager) -> URL? {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Imported Structures", isDirectory: true)
    }

    private static func uniqueDestinationURL(
        in directory: URL,
        preferredFilename: String,
        fileManager: FileManager
    ) -> URL {
        let baseURL = URL(fileURLWithPath: preferredFilename)
        let baseName = baseURL.deletingPathExtension().lastPathComponent
        let pathExtension = baseURL.pathExtension
        var candidate = directory.appendingPathComponent(preferredFilename, isDirectory: false)
        var suffix = 2

        while fileManager.fileExists(atPath: candidate.path) {
            let nextName = pathExtension.isEmpty
                ? "\(baseName)-\(suffix)"
                : "\(baseName)-\(suffix).\(pathExtension)"
            candidate = directory.appendingPathComponent(nextName, isDirectory: false)
            suffix += 1
        }

        return candidate
    }

    enum ImportError: LocalizedError {
        case documentsDirectoryUnavailable
        case missingFilename

        var errorDescription: String? {
            switch self {
            case .documentsDirectoryUnavailable:
                return "Documents directory is unavailable."
            case .missingFilename:
                return "The imported file does not have a filename."
            }
        }
    }
}

struct MobileLogEntry: Identifiable {
    enum Kind: String {
        case status
        case error
        case ready
        case action
    }

    let id: UUID
    let date: Date
    let kind: Kind
    let message: String

    init(id: UUID = UUID(), date: Date = Date(), kind: Kind, message: String) {
        self.id = id
        self.date = date
        self.kind = kind
        self.message = message
    }
}

struct MobileInspectorTarget: Equatable {
    let label: String
    let scope: String
}

enum MobileContextMenuMode: String, CaseIterable, Identifiable {
    case molecule
    case atom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .molecule: "Molecule"
        case .atom: "Atom"
        }
    }
}

struct MobileContextAction: Identifiable, Hashable {
    let name: String
    let title: String

    var id: String { name }
}

struct MobileContextMenu: Identifiable, Equatable {
    let id = UUID()
    let label: String
    let scope: String
    let initialMode: MobileContextMenuMode
    let moleculeActions: [MobileContextAction]
    let atomActions: [MobileContextAction]

    var supportsAtomMode: Bool {
        !atomActions.isEmpty
    }

    func actions(for mode: MobileContextMenuMode) -> [MobileContextAction] {
        switch mode {
        case .molecule:
            moleculeActions
        case .atom:
            atomActions.isEmpty ? moleculeActions : atomActions
        }
    }
}

struct MobileChainSummary: Identifiable, Hashable {
    let chainID: String
    let residueCount: Int
    let sequence: String

    var id: String { chainID }
}

struct MobileSDFRecordProperty: Identifiable, Hashable {
    let name: String
    let value: String

    var id: String { "\(name):\(value)" }
}

struct MobileSDFRecordSummary: Identifiable, Hashable {
    let index: Int
    let name: String
    let atomCount: Int
    let bondCount: Int
    let properties: [MobileSDFRecordProperty]
    let molblock: String

    var id: Int { index }

    var displayName: String {
        name.isEmpty ? "Molecule \(index + 1)" : name
    }
}

struct MobileStructureSummary: Equatable {
    let document: MobilePreviewDocument
    let byteCount: Int
    let atomCount: Int
    let residueCount: Int
    let chainSummaries: [MobileChainSummary]
    let sdfRecords: [MobileSDFRecordSummary]
    let recordCount: Int
    let summaryKind: String

    static func load(document: MobilePreviewDocument, bundle: Bundle = .main) -> MobileStructureSummary {
        guard let url = document.bundleURL(bundle: bundle), let data = try? Data(contentsOf: url) else {
            return MobileStructureSummary(
                document: document,
                byteCount: 0,
                atomCount: 0,
                residueCount: 0,
                chainSummaries: [],
                sdfRecords: [],
                recordCount: 0,
                summaryKind: "Missing"
            )
        }

        let text = String(data: data, encoding: .utf8) ?? ""
        switch document.fileExtension {
        case "pdb", "ent", "cif", "mmcif":
            return parseStructureText(document: document, byteCount: data.count, text: text)
        case "sdf", "mol":
            return parseSDF(document: document, byteCount: data.count, text: text)
        case "xyz", "xyzr":
            return parseXYZ(document: document, byteCount: data.count, text: text)
        default:
            return MobileStructureSummary(
                document: document,
                byteCount: data.count,
                atomCount: 0,
                residueCount: 0,
                chainSummaries: [],
                sdfRecords: [],
                recordCount: text.split(whereSeparator: \.isNewline).count,
                summaryKind: "File"
            )
        }
    }

    private static func parseStructureText(
        document: MobilePreviewDocument,
        byteCount: Int,
        text: String
    ) -> MobileStructureSummary {
        struct Residue: Hashable {
            let chainID: String
            let sequenceID: String
            let name: String
        }

        var atomCount = 0
        var residues: Set<Residue> = []
        var residuesByChain: [String: [Residue]] = [:]

        text.enumerateLines { line, _ in
            guard let atom = atomRecord(from: line) else { return }
            atomCount += 1
            guard atom.isPolymer else { return }
            let residue = Residue(chainID: atom.chainID, sequenceID: atom.sequenceID, name: atom.residueName)
            if residues.insert(residue).inserted {
                residuesByChain[atom.chainID, default: []].append(residue)
            }
        }

        let chains = residuesByChain
            .map { chainID, residues -> MobileChainSummary in
                let ordered = residues.sorted { lhs, rhs in
                    lhs.sequenceID.localizedStandardCompare(rhs.sequenceID) == .orderedAscending
                }
                return MobileChainSummary(
                    chainID: chainID,
                    residueCount: ordered.count,
                    sequence: ordered.map { oneLetterCode(for: $0.name) }.joined()
                )
            }
            .sorted { lhs, rhs in
                lhs.chainID.localizedStandardCompare(rhs.chainID) == .orderedAscending
            }

        return MobileStructureSummary(
            document: document,
            byteCount: byteCount,
            atomCount: atomCount,
            residueCount: residues.count,
            chainSummaries: chains,
            sdfRecords: [],
            recordCount: text.split(whereSeparator: \.isNewline).count,
            summaryKind: chains.isEmpty ? "Atoms" : "Structure"
        )
    }

    private static func parseSDF(document: MobilePreviewDocument, byteCount: Int, text: String) -> MobileStructureSummary {
        let records = text.components(separatedBy: "$$$$")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .enumerated()
            .map { index, recordText in sdfRecordSummary(index: index, text: recordText) }
        let recordCount = max(1, records.count)
        let atomCount = records.first?.atomCount ?? 0
        return MobileStructureSummary(
            document: document,
            byteCount: byteCount,
            atomCount: atomCount,
            residueCount: 0,
            chainSummaries: [],
            sdfRecords: records,
            recordCount: recordCount,
            summaryKind: recordCount == 1 ? "Molecule" : "Molecules"
        )
    }

    private static func parseXYZ(document: MobilePreviewDocument, byteCount: Int, text: String) -> MobileStructureSummary {
        let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let atomCount = Int(firstLine.trimmingCharacters(in: .whitespaces)) ?? 0
        return MobileStructureSummary(
            document: document,
            byteCount: byteCount,
            atomCount: atomCount,
            residueCount: 0,
            chainSummaries: [],
            sdfRecords: [],
            recordCount: atomCount,
            summaryKind: "Atoms"
        )
    }

    private static func sdfRecordSummary(index: Int, text: String) -> MobileSDFRecordSummary {
        let lines = text.components(separatedBy: .newlines)
        let title = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let countsLine = lines.dropFirst(3).first ?? ""
        let atomCount = Int(countsLine.prefix(3).trimmingCharacters(in: .whitespaces)) ?? 0
        let bondCount = Int(countsLine.dropFirst(3).prefix(3).trimmingCharacters(in: .whitespaces)) ?? 0
        let properties = sdfRecordProperties(lines: lines)
        let propertyName = properties.first { ["name", "title", "id"].contains($0.name.lowercased()) }?.value ?? ""
        return MobileSDFRecordSummary(
            index: index,
            name: propertyName.isEmpty ? title : propertyName,
            atomCount: atomCount,
            bondCount: bondCount,
            properties: properties,
            molblock: text
        )
    }

    private static func sdfRecordProperties(lines: [String]) -> [MobileSDFRecordProperty] {
        var properties: [MobileSDFRecordProperty] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            guard line.hasPrefix(">") else {
                index += 1
                continue
            }
            let name = sdfPropertyName(from: line)
            index += 1
            var valueLines: [String] = []
            while index < lines.count {
                let valueLine = lines[index]
                if valueLine.hasPrefix(">") { break }
                if valueLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { break }
                valueLines.append(valueLine)
                index += 1
            }
            let value = valueLines.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty && !value.isEmpty {
                properties.append(MobileSDFRecordProperty(name: name, value: value))
            }
            while index < lines.count && lines[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                index += 1
            }
        }
        return properties
    }

    private static func sdfPropertyName(from line: String) -> String {
        guard let start = line.firstIndex(of: "<"),
              let end = line[start...].firstIndex(of: ">"),
              start < end else {
            return ""
        }
        let afterStart = line.index(after: start)
        return String(line[afterStart..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private struct AtomRecord {
        let chainID: String
        let sequenceID: String
        let residueName: String
        let isPolymer: Bool
    }

    private static func atomRecord(from line: String) -> AtomRecord? {
        let recordName = line.prefix(6).trimmingCharacters(in: .whitespaces)
        guard recordName == "ATOM" || recordName == "HETATM" else { return nil }

        let tokenRecord = tokenAtomRecord(from: line, recordName: recordName)
        if line.count >= 27 {
            let residueName = line.slice(17..<20).trimmingCharacters(in: .whitespacesAndNewlines)
            let chainID = line.slice(21..<22).trimmingCharacters(in: .whitespacesAndNewlines)
            let sequenceID = line.slice(22..<27).trimmingCharacters(in: .whitespacesAndNewlines)
            let fixedRecord = AtomRecord(
                chainID: chainID.isEmpty ? "_" : chainID,
                sequenceID: sequenceID.isEmpty ? "0" : sequenceID,
                residueName: residueName,
                isPolymer: recordName == "ATOM"
            )
            if let tokenRecord, isKnownResidue(tokenRecord.residueName), !isKnownResidue(fixedRecord.residueName) {
                return tokenRecord
            }
            return fixedRecord
        }

        return tokenRecord
    }

    private static func tokenAtomRecord(from line: String, recordName: String) -> AtomRecord? {
        let tokens = line.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.count >= 9 else { return nil }
        return AtomRecord(
            chainID: tokens[6].isEmpty ? "_" : tokens[6],
            sequenceID: tokens[8],
            residueName: tokens[5],
            isPolymer: recordName == "ATOM"
        )
    }

    private static func isKnownResidue(_ residueName: String) -> Bool {
        oneLetterCode(for: residueName) != "X"
    }

    private static func oneLetterCode(for residueName: String) -> String {
        [
            "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
            "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
            "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
            "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
            "DA": "A", "DC": "C", "DG": "G", "DT": "T", "DU": "U",
            "A": "A", "C": "C", "G": "G", "T": "T", "U": "U"
        ][residueName.uppercased()] ?? "X"
    }
}

private extension String {
    func slice(_ bounds: Range<Int>) -> String {
        let lower = index(startIndex, offsetBy: max(0, bounds.lowerBound), limitedBy: endIndex) ?? endIndex
        let upper = index(startIndex, offsetBy: max(0, bounds.upperBound), limitedBy: endIndex) ?? endIndex
        guard lower <= upper else { return "" }
        return String(self[lower..<upper])
    }
}

struct MobilePreviewRuntime {
    struct Preview {
        let indexURL: URL
        let readAccessURL: URL
    }

    static func build(
        document: MobilePreviewDocument = .init(filename: "mini.pdb", bundleSubdirectory: nil),
        theme: MobilePreviewTheme = .dark,
        style: MobileMolecularStyle = .illustrative,
        waterRepresentation: MobileWaterRepresentation = .line,
        molstarQuality: MobileMolstarQuality = .high,
        fileManager: FileManager = .default
    ) throws -> Preview {
        guard let webDirectory = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            throw RuntimeError.missingResource("Web")
        }
        guard let sampleURL = document.bundleURL() else {
            throw RuntimeError.missingResource(document.bundlePath)
        }
        let data = try Data(contentsOf: sampleURL)
        guard !data.isEmpty else { throw RuntimeError.emptySample }

        let previewsDirectory = try resetPreviewsDirectory(fileManager: fileManager)
        let assetsDirectory = previewsDirectory.appendingPathComponent("assets", isDirectory: true)
        try fileManager.copyItem(at: webDirectory, to: assetsDirectory)

        let runtimeDirectory = previewsDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
        try Data(inlineHTML(title: document.displayName, theme: theme).utf8)
            .write(to: runtimeDirectory.appendingPathComponent("index.html"), options: [.atomic])
        try Data("window.BuretteConfig = \(previewConfigJSON(document: document, byteCount: data.count, theme: theme, style: style, waterRepresentation: waterRepresentation, molstarQuality: molstarQuality));\n".utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-config.js"), options: [.atomic])
        let dataScript = "window.BuretteDataBase64 = '\(data.base64EncodedString())';\n"
        try Data(dataScript.utf8)
            .write(to: runtimeDirectory.appendingPathComponent("preview-data.js"), options: [.atomic])

        return Preview(indexURL: runtimeDirectory.appendingPathComponent("index.html"), readAccessURL: previewsDirectory)
    }

    static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func resetPreviewsDirectory(fileManager: FileManager) throws -> URL {
        guard let cachesDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw RuntimeError.cachesUnavailable
        }
        let previewsDirectory = cachesDirectory
            .appendingPathComponent("BuretteMobile", isDirectory: true)
            .appendingPathComponent("previews", isDirectory: true)
        if fileManager.fileExists(atPath: previewsDirectory.path) {
            try fileManager.removeItem(at: previewsDirectory)
        }
        try fileManager.createDirectory(at: previewsDirectory, withIntermediateDirectories: true)
        return previewsDirectory
    }

    private static func previewConfigJSON(
        document: MobilePreviewDocument,
        byteCount: Int,
        theme: MobilePreviewTheme,
        style: MobileMolecularStyle,
        waterRepresentation: MobileWaterRepresentation,
        molstarQuality: MobileMolstarQuality
    ) -> String {
        let xyzFrameCount = document.xyzFrameCount()
        let trajectoryFrameCount = xyzFrameCount > 1 ? xyzFrameCount : 0
        let payload: [String: Any] = [
            "format": document.format,
            "molstarFormat": document.format,
            "binary": false,
            "renderer": "molstar",
            "requestedRenderer": "molstar",
            "allowMolstarFallback": true,
            "label": document.displayName,
            "previewRequestID": UUID().uuidString,
            "byteCount": byteCount,
            "previewByteCount": byteCount,
            "sourceExtension": document.fileExtension,
            "stagedEntries": [],
            "quickLookBuild": "ios-mobile",
            "quickLookViewer": true,
            "debug": false,
            "theme": theme.rawValue,
            "themeTokens": [:],
            "canvasBackground": theme.canvasBackground,
            "molstarStyle": style.rawValue,
            "molstarDisableAntialiasing": false,
            "molstarPickScale": 1,
            "molstarPixelScale": 1,
            "molstarPreferWebgl1": false,
            "molstarResolutionMode": molstarQuality.resolutionMode,
            "waterRepresentation": waterRepresentation.configValue,
            "uiScale": 0.9,
            "overlayOpacity": 0.86,
            "transparentBackground": false,
            "sdfGrid": false,
            "sdfPosePager": document.format == "sdf",
            "trajectoryControls": true,
            "trajectoryFrameCount": trajectoryFrameCount,
            "showPanelControls": false,
            "layoutShowControls": false,
            "layoutShowSequence": false,
            "layoutShowLog": false,
            "layoutShowLeftPanel": false,
            "viewportShowControls": true,
            "viewportShowReset": true,
            "viewportShowSettings": true,
            "viewportShowScreenshotControls": true,
            "viewportShowSelectionMode": true,
            "viewportShowAnimation": true,
            "defaultLayoutState": [
                "left": "hidden",
                "right": "hidden",
                "sequence": "hidden",
                "log": "hidden"
            ],
            "canOpenInVesta": false,
            "molstarAvailable": true
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func inlineHTML(title: String, theme: MobilePreviewTheme) -> String {
        let safeTitle = escapeHTML(title)
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
          <title>Burette - \(safeTitle)</title>
          <link rel="stylesheet" href="../assets/molstar.css" />
          <link rel="stylesheet" href="../assets/viewer-runtime.css" />
          <script>
            (function () {
              function post(type, message, payload) {
                var body = Object.assign({ type: type, message: String(message || '') }, payload || {});
                try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.burette.postMessage(body); } catch (_) {}
              }
              window.__mqlPost = post;
              window.__mqlStatus = function (message, kind) {
                var text = String(message || '');
                var el = document.getElementById('status');
                if (el) el.textContent = text;
                post(kind === 'error' ? 'error' : 'status', text);
              };
              window.BuretteMobileControls = window.BuretteMobileControls || {
                pendingLayoutState: null,
                setLayout: function (state) {
                  this.pendingLayoutState = state || {};
                  if (typeof window.BuretteApplyMobileLayoutState === 'function') {
                    window.BuretteApplyMobileLayoutState(this.pendingLayoutState);
                  }
                },
                runAction: function (name) {
                  if (typeof window.BuretteRunMobileControlAction === 'function') {
                    window.BuretteRunMobileControlAction(String(name || ''));
                  }
                },
                runContextMenuAction: function (action, mode) {
                  if (typeof window.BuretteRunMobileContextMenuAction === 'function') {
                    window.BuretteRunMobileContextMenuAction(String(action || ''), String(mode || 'molecule'));
                  }
                }
              };
              window.__mqlAction = function (name) { post('action', name); };
              window.__mqlDebug = function () {};
              window.addEventListener('error', function (event) {
                var message = (event.error && event.error.stack) || event.message || String(event);
                window.__mqlStatus('[web] JavaScript error\\n\\n' + message, 'error');
              });
              window.addEventListener('unhandledrejection', function (event) {
                var reason = event.reason || {};
                var message = reason.stack || reason.message || String(reason);
                window.__mqlStatus('[web] Unhandled promise rejection\\n\\n' + message, 'error');
              });
            })();
          </script>
        </head>
        <body class="burette-opaque-background burette-quicklook-host burette-mobile-host">
          <div id="app"></div>
          <style>
            html,
            body,
            #app {
              width: 100%;
              height: 100%;
              min-height: 100%;
              margin: 0;
              padding: 0;
              overflow: hidden;
              background: \(theme.canvasBackground);
            }
            body.burette-mobile-host #app {
              position: fixed;
              inset: 0;
            }
            body.burette-mobile-host,
            body.burette-mobile-host .msp-plugin,
            body.burette-mobile-host .msp-plugin canvas {
              -webkit-touch-callout: none;
              -webkit-user-select: none;
              touch-action: none;
              user-select: none;
            }
            body.burette-mobile-host #buret-toolbar {
              display: none !important;
            }
            body.burette-mobile-host .buret-docking-poses {
              display: none !important;
            }
            body.burette-mobile-host .buret-generate-3d-control,
            body.burette-mobile-host .buret-generate-3d-menu {
              display: none !important;
            }
          </style>
          <script src="../assets/viewer-shell.js"></script>
          <div id="status">[web] HTML body created. Waiting for embedded data and Mol* script...</div>
          <script>
            window.BuretteInlineMode = true;
            window.BuretteDebug = false;
            window.BurettePanelControlsVisible = false;
            window.BuretteCacheBuster = String(Date.now());
          </script>
          <script src="../assets/molstar.js"></script>
          <script src="preview-config.js"></script>
          <script src="../assets/burette-agent.js"></script>
          <script src="../assets/viewer.js"></script>
        </body>
        </html>
        """
    }

    enum RuntimeError: LocalizedError {
        case cachesUnavailable
        case emptySample
        case missingResource(String)

        var errorDescription: String? {
            switch self {
            case .cachesUnavailable:
                return "Caches directory is unavailable."
            case .emptySample:
                return "Bundled structure file is empty."
            case .missingResource(let name):
                return "Bundled resource is missing: \(name)."
            }
        }
    }
}
