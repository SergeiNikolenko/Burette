import Foundation

struct MoleculeGridPreview {
    let configJSON: String
    let recordsScript: String
    let format: String
    let recordsTotal: Int
    let recordsIncluded: Int
}

enum MoleculeGridPreviewHost: String {
    case quickLook
    case app
}

enum MoleculeGridPreviewBuilder {
    static func makePreview(
        fileURL: URL,
        data: Data,
        host: MoleculeGridPreviewHost,
        theme: String,
        canvasBackground: String,
        transparentBackground: Bool,
        debug: Bool,
        allowSelection: Bool,
        allowExport: Bool,
        maxRecords: Int
    ) throws -> MoleculeGridPreview? {
        let ext = fileURL.pathExtension.lowercased()
        let text = decodeText(data)
        let recordLimit = max(1, maxRecords)
        let collection: MoleculeGridCollection

        switch ext {
        case "smi", "smiles":
            collection = parseSmiles(text, maxRecords: recordLimit)
            guard collection.recordsTotal > 0 else { return nil }
        case "sdf", "sd":
            collection = parseSDF(text, maxRecords: recordLimit)
            guard collection.recordsTotal > 1 else { return nil }
        default:
            return nil
        }

        let includedRecords = collection.records
        let recordPayload: [[String: Any]] = includedRecords.map { record in
            var payload: [String: Any] = [
                "index": record.index,
                "name": record.name,
                "props": record.props
            ]
            if let smiles = record.smiles { payload["smiles"] = smiles }
            if let molblock = record.molblock { payload["molblock"] = molblock }
            return payload
        }

        let config: [String: Any] = [
            "mode": "grid2d",
            "format": collection.format,
            "label": fileURL.lastPathComponent,
            "byteCount": data.count,
            "host": host.rawValue,
            "quickLookBuild": host == .quickLook ? "burrete-grid2d-quicklook" : "burrete-grid2d-app",
            "debug": debug,
            "appViewer": host == .app,
            "theme": theme,
            "canvasBackground": canvasBackground,
            "transparentBackground": transparentBackground,
            "recordsTotal": collection.recordsTotal,
            "recordsIncluded": includedRecords.count,
            "recordsTruncated": collection.recordsTotal > includedRecords.count,
            "pageSize": host == .quickLook ? 60 : 96,
            "capabilities": [
                "selection": allowSelection,
                "export": allowExport,
                "substructureSearch": true,
                "rendererSwitch": host == .app && collection.format == "sdf"
            ]
        ]

        let configData = try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys, .withoutEscapingSlashes])
        let recordsData = try JSONSerialization.data(withJSONObject: recordPayload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let configJSON = String(data: configData, encoding: .utf8),
              let recordsJSON = String(data: recordsData, encoding: .utf8) else {
            throw MoleculeGridPreviewError.couldNotEncodeJSON
        }

        return MoleculeGridPreview(
            configJSON: configJSON,
            recordsScript: "window.BurreteGridRecords = \(recordsJSON);\n",
            format: collection.format,
            recordsTotal: collection.recordsTotal,
            recordsIncluded: includedRecords.count
        )
    }

    private static func parseSmiles(_ text: String, maxRecords: Int) -> MoleculeGridCollection {
        var records: [MoleculeGridRecord] = []
        var recordsTotal = 0
        for line in normalizedLines(text) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
            let parts = trimmed.split(maxSplits: 1, whereSeparator: { $0 == " " || $0 == "\t" })
            guard let first = parts.first else { continue }
            defer { recordsTotal += 1 }
            guard records.count < maxRecords else { continue }
            let smiles = String(first)
            let rawName = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let name = rawName.isEmpty ? "Molecule \(recordsTotal + 1)" : rawName
            records.append(MoleculeGridRecord(
                index: recordsTotal,
                name: clipped(name, limit: 160),
                smiles: clipped(smiles, limit: 2048),
                molblock: nil,
                props: [:]
            ))
        }
        return MoleculeGridCollection(format: "smiles", records: records, recordsTotal: recordsTotal)
    }

    private static func parseSDF(_ text: String, maxRecords: Int) -> MoleculeGridCollection {
        var records: [MoleculeGridRecord] = []
        var recordsTotal = 0
        var current: [String] = []
        var currentHasContent = false

        func finishRecord() {
            let lines = current
            current.removeAll(keepingCapacity: true)
            defer { currentHasContent = false }
            guard currentHasContent else { return }
            defer { recordsTotal += 1 }
            guard records.count < maxRecords else { return }
            let title = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines)
            let props = parseSDFProperties(lines)
            let fallbackName = "Molecule \(recordsTotal + 1)"
            records.append(MoleculeGridRecord(
                index: recordsTotal,
                name: clipped(firstNonEmpty([props["Name"], props["NAME"], props["ID"], title, fallbackName]) ?? fallbackName, limit: 160),
                smiles: firstNonEmpty([props["SMILES"], props["Smiles"], props["smiles"]]).map { clipped($0, limit: 2048) },
                molblock: clipped(extractMolblock(lines), limit: 250_000),
                props: props
            ))
        }

        for line in normalizedLines(text) {
            if line.trimmingCharacters(in: .whitespacesAndNewlines) == "$$$$" {
                finishRecord()
            } else {
                if !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { currentHasContent = true }
                if records.count < maxRecords { current.append(line) }
            }
        }
        finishRecord()
        return MoleculeGridCollection(format: "sdf", records: records, recordsTotal: recordsTotal)
    }

    private static func normalizedLines(_ text: String) -> [String] {
        text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
    }

    private static func extractMolblock(_ lines: [String]) -> String {
        if let endIndex = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines) == "M  END" }) {
            return lines.prefix(through: endIndex).joined(separator: "\n")
        }
        return lines.joined(separator: "\n")
    }

    private static func parseSDFProperties(_ lines: [String]) -> [String: String] {
        var props: [String: String] = [:]
        var index = 0
        while index < lines.count {
            let line = lines[index]
            guard line.hasPrefix(">") else {
                index += 1
                continue
            }
            let name = propertyName(from: line)
            index += 1
            var valueLines: [String] = []
            while index < lines.count {
                let valueLine = lines[index]
                if valueLine.hasPrefix(">") { break }
                if valueLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    index += 1
                    break
                }
                valueLines.append(valueLine)
                index += 1
            }
            if let name, !name.isEmpty, props.count < 64 {
                let value = valueLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty { props[clipped(name, limit: 80)] = clipped(value, limit: 500) }
            }
        }
        return props
    }

    private static func propertyName(from line: String) -> String? {
        guard let open = line.firstIndex(of: "<"),
              let close = line[open...].firstIndex(of: ">"),
              open < close else {
            return nil
        }
        return String(line[line.index(after: open)..<close]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstNonEmpty(_ values: [String?]) -> String? {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }

    private static func clipped(_ value: String?, limit: Int) -> String {
        let value = value ?? ""
        guard value.count > limit else { return value }
        let end = value.index(value.startIndex, offsetBy: max(0, limit - 3))
        return String(value[..<end]) + "..."
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }
}

private struct MoleculeGridCollection {
    let format: String
    let records: [MoleculeGridRecord]
    let recordsTotal: Int
}

private struct MoleculeGridRecord {
    let index: Int
    let name: String
    let smiles: String?
    let molblock: String?
    let props: [String: String]
}

private enum MoleculeGridPreviewError: LocalizedError {
    case couldNotEncodeJSON

    var errorDescription: String? {
        "Could not encode molecule grid preview JSON."
    }
}
