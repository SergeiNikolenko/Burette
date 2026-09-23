import Foundation

@main
struct SARPreviewImportTests {
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let preview = try MoleculeGridPreviewBuilder.makePreview(
            fileURL: url, data: Data(contentsOf: url), host: .quickLook,
            theme: "light", canvasBackground: "#ffffff", transparentBackground: false,
            debug: false, allowSelection: true, allowExport: true, maxRecords: 100
        )!
        precondition(preview.recordsTotal == 8 && preview.recordsIncluded == 8)
        let json = preview.recordsScript
            .replacingOccurrences(of: "window.BuretteGridRecords = ", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: ";\n"))
        let rows = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [[String: Any]]
        precondition(rows[0]["name"] as? String == "Benzene methyl chloro")
        precondition(rows[0]["smiles"] as? String == "Cc1ccc(Cl)cc1")
        precondition(rows[7]["smiles"] as? String == "not-a-smiles((")
        let props = rows[0]["props"] as! [String: String]
        precondition(props["RGroup_Series"] == "S1" && props["index"] == nil)
        print("Swift SAR preview import: 8 original rows and SAR properties preserved")
    }
}
