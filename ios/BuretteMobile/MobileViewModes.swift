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

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            let lines = fileLines
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
    }

    private var fileLines: [String] {
        guard let url = document.bundleURL(),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return ["Unable to read \(document.displayName) as text."]
        }
        let all = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        if all.count > maxLines {
            return Array(all.prefix(maxLines)) + ["… \(all.count - maxLines) more lines (truncated)"]
        }
        return all
    }
}

