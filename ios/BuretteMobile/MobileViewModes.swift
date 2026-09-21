import SwiftUI

/// Preview view modes for a document (mockup 11). `structure3D` is the live Mol*
/// runtime; `text` shows the raw file contents.
enum MobileViewMode: String, CaseIterable, Identifiable {
    case structure3D
    case text

    var id: String { rawValue }

    var title: String {
        switch self {
        case .structure3D: "3D"
        case .text: "Text"
        }
    }

    var systemImage: String {
        switch self {
        case .structure3D: "cube"
        case .text: "text.alignleft"
        }
    }
}

enum MobileViewModeCatalog {
    /// Formats Mol* can render as an interactive 3D structure.
    static let structureFormats: Set<String> = [
        "pdb", "ent", "pdbqt", "pqr", "cif", "mmcif", "mcif", "bcif",
        "sdf", "sd", "mol", "mol2", "xyz", "xyzr", "gro", "cube", "cub"
    ]

    /// UTF-8 text-inspectable formats.
    static let textFormats: Set<String> = structureFormats.union([
        "txt", "csv", "tsv", "smi", "smiles", "dat", "json", "xml",
        "mdp", "top", "itp", "key", "par", "prm", "rtf", "str", "log", "out",
        "com", "inp", "in", "nw", "psi4", "qcin", "vasp"
    ])

    static func modes(for document: MobilePreviewDocument) -> [MobileViewMode] {
        let ext = document.fileExtension
        var modes: [MobileViewMode] = []
        if ext.isEmpty || structureFormats.contains(ext) { modes.append(.structure3D) }
        if ext.isEmpty || textFormats.contains(ext) { modes.append(.text) }
        if modes.isEmpty { modes = [.structure3D] }
        return modes
    }
}

/// Compact segmented switcher shown when a document supports more than one view.
struct MobileViewModePicker: View {
    let modes: [MobileViewMode]
    @Binding var selection: MobileViewMode

    var body: some View {
        Picker("View mode", selection: $selection) {
            ForEach(modes) { mode in
                Label(mode.title, systemImage: mode.systemImage).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 240)
        .padding(6)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.14)))
    }
}

/// Native text/artifact viewer (mockup 11): raw file contents with line numbers.
struct MobileTextArtifactView: View {
    let document: MobilePreviewDocument
    var maxLines = 4000
    @State private var lines: [String] = []

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(index + 1)")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .trailing)
                        Text(line.isEmpty ? " " : line)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .textSelection(.enabled)
                    }
                    .padding(.vertical, 1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 150)
            .padding(.bottom, 120)
        }
        .background(Color(.systemBackground))
        .task(id: document) {
            lines = []
            let selectedDocument = document
            let limit = maxLines
            let result: [String] = await withCheckedContinuation { continuation in
                MobilePreviewRuntime.preparationQueue.async {
                    continuation.resume(returning: Self.fileLines(document: selectedDocument, maxLines: limit))
                }
            }
            guard !Task.isCancelled else { return }
            lines = result
        }
    }

    private static func fileLines(document: MobilePreviewDocument, maxLines: Int) -> [String] {
        guard let url = document.bundleURL(),
              let handle = try? FileHandle(forReadingFrom: url) else {
            return ["Unable to read \(document.displayName) as text."]
        }
        defer { try? handle.close() }
        let byteLimit = 1024 * 1024
        guard let data = try? handle.read(upToCount: byteLimit + 1) else {
            return ["Unable to read \(document.displayName) as text."]
        }
        let text = String(decoding: data.prefix(byteLimit), as: UTF8.self)
        let all = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        if all.count > maxLines || data.count > byteLimit {
            return Array(all.prefix(maxLines)) + ["… additional content truncated (1 MiB / \(maxLines) line limit)"]
        }
        return all
    }
}

