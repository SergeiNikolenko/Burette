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

struct MoleculeGridFileSupport: Equatable {
    static let sdfKey = "gridPreviewSupportsSDF"
    static let smilesKey = "gridPreviewSupportsSMILES"
    static let csvKey = "gridPreviewSupportsCSV"
    static let tsvKey = "gridPreviewSupportsTSV"

    let sdf: Bool
    let smiles: Bool
    let csv: Bool
    let tsv: Bool

    static let all = MoleculeGridFileSupport(sdf: true, smiles: true, csv: true, tsv: true)

    static func load(from defaults: UserDefaults = .standard) -> MoleculeGridFileSupport {
        MoleculeGridFileSupport(
            sdf: boolValue(defaults.object(forKey: sdfKey), defaultValue: true),
            smiles: boolValue(defaults.object(forKey: smilesKey), defaultValue: true),
            csv: boolValue(defaults.object(forKey: csvKey), defaultValue: true),
            tsv: boolValue(defaults.object(forKey: tsvKey), defaultValue: true)
        )
    }

    static func loadFromAppPreferences(appID: CFString) -> MoleculeGridFileSupport {
        MoleculeGridFileSupport(
            sdf: boolValue(CFPreferencesCopyAppValue(sdfKey as CFString, appID), defaultValue: true),
            smiles: boolValue(CFPreferencesCopyAppValue(smilesKey as CFString, appID), defaultValue: true),
            csv: boolValue(CFPreferencesCopyAppValue(csvKey as CFString, appID), defaultValue: true),
            tsv: boolValue(CFPreferencesCopyAppValue(tsvKey as CFString, appID), defaultValue: true)
        )
    }

    func supports(fileExtension ext: String) -> Bool {
        switch ext.lowercased() {
        case "sdf", "sd":
            return sdf
        case "smi", "smiles":
            return smiles
        case "csv":
            return csv
        case "tsv":
            return tsv
        default:
            return false
        }
    }

    static func canPreview(fileExtension ext: String) -> Bool {
        ["csv", "sd", "sdf", "smi", "smiles", "tsv"].contains(ext.lowercased())
    }

    static func requiresGridPreview(fileExtension ext: String) -> Bool {
        ["csv", "smi", "smiles", "tsv"].contains(ext.lowercased())
    }

    private static func boolValue(_ value: Any?, defaultValue: Bool) -> Bool {
        (value as? Bool) ?? defaultValue
    }
}

enum MoleculeGridPreviewBuilder {
    static func makePreview(
        fileURL: URL,
        data: Data,
        host: MoleculeGridPreviewHost,
        theme: String,
        canvasBackground: String,
        transparentBackground: Bool,
        themeTokens: [String: Any]? = nil,
        overlayOpacity: Double = 0.90,
        debug: Bool,
        allowSelection: Bool,
        allowExport: Bool,
        maxRecords: Int,
        fileSupport: MoleculeGridFileSupport = .all
    ) throws -> MoleculeGridPreview? {
        let ext = fileURL.pathExtension.lowercased()
        guard fileSupport.supports(fileExtension: ext) else { return nil }
        let text = decodeText(data)
        let recordLimit = max(1, maxRecords)
        let collection: MoleculeGridCollection

        switch ext {
        case "csv":
            collection = try parseDelimitedTableWithFallback(text, separator: ",", format: "csv", maxRecords: recordLimit)
            guard collection.recordsTotal > 0 else { return nil }
        case "smi", "smiles":
            collection = parseSmiles(text, maxRecords: recordLimit)
            guard collection.recordsTotal > 0 else { return nil }
        case "sdf", "sd":
            collection = parseSDF(text, maxRecords: recordLimit)
            guard collection.recordsTotal > 1 else { return nil }
        case "tsv":
            collection = try parseDelimitedTableWithFallback(text, separator: "\t", format: "tsv", maxRecords: recordLimit)
            guard collection.recordsTotal > 0 else { return nil }
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

        var config: [String: Any] = [
            "mode": "grid2d",
            "format": collection.format,
            "label": fileURL.lastPathComponent,
            "byteCount": data.count,
            "host": host.rawValue,
            "quickLookBuild": host == .quickLook ? "burrete-grid2d-quicklook" : "burrete-grid2d-app",
            "debug": debug,
            "appViewer": host == .app,
            "quickLookViewer": host == .quickLook,
            "theme": theme,
            "canvasBackground": canvasBackground,
            "overlayOpacity": min(max(overlayOpacity, 0.72), 0.98),
            "transparentBackground": transparentBackground,
            "recordsTotal": collection.recordsTotal,
            "recordsIncluded": includedRecords.count,
            "recordsTruncated": collection.recordsTotal > includedRecords.count,
            "pageSize": 48,
            "capabilities": [
                "selection": allowSelection,
                "export": allowExport,
                "substructureSearch": true,
                "rendererSwitch": collection.format == "sdf"
            ]
        ]
        if let themeTokens {
            config["themeTokens"] = themeTokens
        }

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
            let smiles = String(first)
            guard looksLikeSmiles(smiles) else { continue }
            defer { recordsTotal += 1 }
            guard records.count < maxRecords else { continue }
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

    private static func parseDelimitedTable(
        _ text: String,
        separator: Character,
        format: String,
        maxRecords: Int
    ) throws -> MoleculeGridCollection {
        let rows = normalizedLines(text).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard let headerLine = rows.first else {
            return MoleculeGridCollection(format: format, records: [], recordsTotal: 0)
        }
        let headers = parseDelimitedLine(headerLine, separator: separator).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let normalizedHeaders = headers.map { $0.lowercased().replacingOccurrences(of: " ", with: "_") }
        let namedSmilesIndexes = normalizedHeaders.enumerated().compactMap { index, value in
            isSmilesColumn(value) ? index : nil
        }
        let firstRowLooksLikeData = headers.contains(where: looksLikeSmiles)
        let inferredSmilesIndexes = firstRowLooksLikeData
            ? []
            : inferSmilesColumnIndexes(rows: Array(rows.dropFirst()), columnCount: headers.count, separator: separator)
        let smilesIndexes = Array(Set(namedSmilesIndexes + inferredSmilesIndexes)).sorted()
        guard !smilesIndexes.isEmpty else {
            throw MoleculeGridPreviewError.missingMoleculeColumn(format.uppercased())
        }
        let hasMultipleSmilesColumns = smilesIndexes.count > 1
        let nameIndex = normalizedHeaders.enumerated().first(where: { index, value in
            ["compound_id", "id", "name", "title", "compound"].contains(value) && !smilesIndexes.contains(index)
        })?.offset

        var records: [MoleculeGridRecord] = []
        var recordsTotal = 0
        for (rowIndex, line) in rows.dropFirst().enumerated() {
            let cells = parseDelimitedLine(line, separator: separator)
            for smilesIndex in smilesIndexes {
                guard smilesIndex < cells.count else { continue }
                let smiles = cells[smilesIndex].trimmingCharacters(in: .whitespacesAndNewlines)
                guard !smiles.isEmpty else { continue }
                defer { recordsTotal += 1 }
                guard records.count < maxRecords else { continue }

                let rawName = nameIndex.flatMap { $0 < cells.count ? cells[$0].trimmingCharacters(in: .whitespacesAndNewlines) : nil } ?? ""
                let baseName = rawName.isEmpty ? "Molecule \(rowIndex + 1)" : rawName
                let columnName = headers[smilesIndex].isEmpty ? "Column \(smilesIndex + 1)" : headers[smilesIndex]
                let name = hasMultipleSmilesColumns ? "\(baseName) \(columnName)" : baseName
                var props: [String: String] = [
                    "CSV row": "\(rowIndex + 1)",
                    "SMILES column": columnName,
                ]
                for (index, header) in headers.enumerated() where !smilesIndexes.contains(index) && index != nameIndex {
                    guard index < cells.count else { continue }
                    let value = cells[index].trimmingCharacters(in: .whitespacesAndNewlines)
                    if !header.isEmpty, !value.isEmpty, props.count < 64 {
                        props[clipped(header, limit: 80)] = clipped(value, limit: 500)
                    }
                }
                records.append(MoleculeGridRecord(
                    index: recordsTotal,
                    name: clipped(name, limit: 160),
                    smiles: clipped(smiles, limit: 2048),
                    molblock: nil,
                    props: props
                ))
            }
        }
        return MoleculeGridCollection(format: format, records: records, recordsTotal: recordsTotal)
    }

    private static func parseDelimitedTableWithFallback(
        _ text: String,
        separator: Character,
        format: String,
        maxRecords: Int
    ) throws -> MoleculeGridCollection {
        do {
            return try parseDelimitedTable(text, separator: separator, format: format, maxRecords: maxRecords)
        } catch MoleculeGridPreviewError.missingMoleculeColumn {
            return parseDelimitedRowsAsSmiles(text, separator: separator, format: format, maxRecords: maxRecords)
        }
    }

    private static func parseDelimitedRowsAsSmiles(
        _ text: String,
        separator: Character,
        format: String,
        maxRecords: Int
    ) -> MoleculeGridCollection {
        let rows = normalizedLines(text).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !rows.isEmpty else {
            return MoleculeGridCollection(format: format, records: [], recordsTotal: 0)
        }
        let firstRowCells = parseDelimitedLine(rows[0], separator: separator).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let startIndex = isLikelyDelimitedHeader(firstRowCells) ? 1 : 0
        var records: [MoleculeGridRecord] = []
        var recordsTotal = 0
        for row in rows.dropFirst(startIndex) {
            let rawCells = parseDelimitedLine(row, separator: separator).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            let cells = rawCells.filter { !$0.isEmpty }
            guard let smiles = cells.first, looksLikeSmiles(smiles) else { continue }
            defer { recordsTotal += 1 }
            guard records.count < maxRecords else { continue }
            let rawName = cells.dropFirst().first ?? ""
            let name = rawName.isEmpty ? "Molecule \(recordsTotal + 1)" : rawName
            var props: [String: String] = [:]
            if cells.count > 2 {
                for (offset, value) in cells.dropFirst(2).enumerated() where props.count < 64 {
                    let clippedValue = clipped(value, limit: 500)
                    if !clippedValue.isEmpty {
                        props["Column \(offset + 3)"] = clippedValue
                    }
                }
            }
            records.append(MoleculeGridRecord(
                index: recordsTotal,
                name: clipped(name, limit: 160),
                smiles: clipped(smiles, limit: 2048),
                molblock: nil,
                props: props
            ))
        }
        return MoleculeGridCollection(format: format, records: records, recordsTotal: recordsTotal)
    }

    private static func parseDelimitedLine(_ line: String, separator: Character) -> [String] {
        let chars = Array(line)
        var fields: [String] = []
        var field = ""
        var index = 0
        var inQuotes = false
        while index < chars.count {
            let char = chars[index]
            if char == "\"" {
                if inQuotes, index + 1 < chars.count, chars[index + 1] == "\"" {
                    field.append(char)
                    index += 1
                } else {
                    inQuotes.toggle()
                }
            } else if char == separator, !inQuotes {
                fields.append(field)
                field = ""
            } else {
                field.append(char)
            }
            index += 1
        }
        fields.append(field)
        return fields
    }

    private static func isSmilesColumn(_ value: String) -> Bool {
        value == "smile" || value == "smiels" || value.contains("smiles")
    }

    private static func inferSmilesColumnIndexes(rows: [String], columnCount: Int, separator: Character) -> [Int] {
        var indexes: [Int] = []
        for columnIndex in 0..<columnCount {
            var nonEmpty = 0
            var valid = 0
            for row in rows {
                let cells = parseDelimitedLine(row, separator: separator)
                guard columnIndex < cells.count else { continue }
                let value = cells[columnIndex].trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else { continue }
                nonEmpty += 1
                if looksLikeSmiles(value) { valid += 1 }
            }
            if isLikelySmilesColumn(nonEmpty: nonEmpty, valid: valid) {
                indexes.append(columnIndex)
            }
        }
        return indexes
    }

    private static func isLikelySmilesColumn(nonEmpty: Int, valid: Int) -> Bool {
        guard nonEmpty > 0, valid > 0 else { return false }
        if valid < 2, nonEmpty > 2 { return false }
        return valid * 5 >= nonEmpty * 4
    }

    private static func isLikelyDelimitedHeader(_ cells: [String]) -> Bool {
        let normalized = cells.map { $0.lowercased().replacingOccurrences(of: " ", with: "_") }
        if normalized.contains(where: isSmilesColumn) { return true }
        let commonHeaders: Set<String> = ["id", "name", "title", "compound", "molecule", "structure", "inchi"]
        return normalized.contains { commonHeaders.contains($0) }
    }

    private static func looksLikeSmiles(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { return false }
        let lowered = trimmed.lowercased()
        let knownHeaders: Set<String> = ["smiles", "smile", "id", "name", "title", "compound", "molecule", "structure", "inchi"]
        if knownHeaders.contains(lowered) { return false }
        if trimmed.hasPrefix("InChI=") || isInChIKey(trimmed) { return false }
        guard trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return false }
        let characters = Array(trimmed)
        var index = 0
        var hasAtom = false
        var hasAromaticAtom = false
        var hasStructuralMarker = false
        while index < characters.count {
            let character = characters[index]
            if character == "[" {
                var bracketIndex = index + 1
                var hasBracketAtom = false
                var closedBracket = false
                while bracketIndex < characters.count {
                    if characters[bracketIndex] == "]" {
                        closedBracket = true
                        break
                    }
                    if characters[bracketIndex].isLetter {
                        hasBracketAtom = true
                    }
                    bracketIndex += 1
                }
                guard closedBracket, hasBracketAtom else { return false }
                hasAtom = true
                hasStructuralMarker = true
                index = bracketIndex
            } else if character.isNumber {
                hasStructuralMarker = true
            } else if "]=#@+-/\\().,:$%".contains(character) {
                hasStructuralMarker = true
            } else if character == "B", index + 1 < characters.count, characters[index + 1] == "r" {
                hasAtom = true
                index += 1
            } else if character == "C", index + 1 < characters.count, characters[index + 1] == "l" {
                hasAtom = true
                index += 1
            } else if "BCNOFPSIKH".contains(character) {
                hasAtom = true
            } else if "bcnops".contains(character) {
                hasAtom = true
                hasAromaticAtom = true
            } else {
                return false
            }
            index += 1
        }
        guard hasAtom else { return false }
        return !hasAromaticAtom || hasStructuralMarker
    }

    private static func isInChIKey(_ value: String) -> Bool {
        let characters = Array(value)
        guard characters.count == 27, characters[14] == "-", characters[25] == "-" else { return false }
        return characters.enumerated().allSatisfy { index, character in
            if index == 14 || index == 25 { return true }
            let scalars = character.unicodeScalars
            guard scalars.count == 1, let scalar = scalars.first else { return false }
            return scalar.value >= 65 && scalar.value <= 90
        }
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
    case missingMoleculeColumn(String)

    var errorDescription: String? {
        switch self {
        case .couldNotEncodeJSON:
            return "Could not encode molecule grid preview JSON."
        case .missingMoleculeColumn(let format):
            return "\(format) table needs a column whose name contains smiles."
        }
    }
}
