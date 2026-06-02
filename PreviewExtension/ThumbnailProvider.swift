import AppKit
import Foundation
import QuickLookThumbnailing

final class ThumbnailProvider: QLThumbnailProvider {
    private static let maxBytes = 384 * 1024

    override func provideThumbnail(
        for request: QLFileThumbnailRequest,
        _ handler: @escaping (QLThumbnailReply?, Error?) -> Void
    ) {
        let size = request.maximumSize
        let fileURL = request.fileURL
        let fileExtension = Self.structurePathExtension(for: fileURL)
        let atoms = Self.readSmallMolecule(fileURL: fileURL, fileExtension: fileExtension)
        let reply = QLThumbnailReply(contextSize: size) {
            Self.drawThumbnail(size: size, fileExtension: fileExtension, atoms: atoms)
            return true
        }
        handler(reply, nil)
    }

    private static func readSmallMolecule(fileURL: URL, fileExtension: String) -> [ThumbnailAtom]? {
        guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]),
              data.count <= maxBytes else {
            return nil
        }
        let text = decodeText(data)
        switch fileExtension {
        case "pdb", "ent", "pdbqt", "pqr":
            return parsePDB(text)
        case "sdf", "sd", "mol":
            return parseMolfile(text)
        case "xyz":
            return parseXYZ(text)
        default:
            return nil
        }
    }

    private static func drawThumbnail(size: CGSize, fileExtension: String, atoms: [ThumbnailAtom]?) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let rect = CGRect(origin: .zero, size: size)
        context.setFillColor(NSColor(calibratedWhite: 0.97, alpha: 1).cgColor)
        context.fill(rect)
        context.setStrokeColor(NSColor(calibratedWhite: 0.78, alpha: 1).cgColor)
        context.setLineWidth(max(1, min(size.width, size.height) * 0.015))
        context.stroke(rect.insetBy(dx: 1, dy: 1))

        guard let atoms, atoms.count >= 2 else {
            drawGenericGlyph(fileExtension: fileExtension, in: rect, context: context)
            return
        }
        drawMolecule(atoms, in: rect.insetBy(dx: size.width * 0.14, dy: size.height * 0.18), context: context)
    }

    private static func drawMolecule(_ atoms: [ThumbnailAtom], in rect: CGRect, context: CGContext) {
        let limitedAtoms = Array(atoms.prefix(180))
        guard let minX = limitedAtoms.map(\.x).min(),
              let maxX = limitedAtoms.map(\.x).max(),
              let minY = limitedAtoms.map(\.y).min(),
              let maxY = limitedAtoms.map(\.y).max() else {
            return
        }
        let spanX = max(maxX - minX, 0.001)
        let spanY = max(maxY - minY, 0.001)
        let scale = min(rect.width / CGFloat(spanX), rect.height / CGFloat(spanY))
        let moleculeWidth = CGFloat(spanX) * scale
        let moleculeHeight = CGFloat(spanY) * scale
        let origin = CGPoint(
            x: rect.midX - moleculeWidth / 2,
            y: rect.midY - moleculeHeight / 2
        )
        let points = limitedAtoms.map { atom in
            CGPoint(
                x: origin.x + CGFloat(atom.x - minX) * scale,
                y: origin.y + moleculeHeight - CGFloat(atom.y - minY) * scale
            )
        }

        context.setLineCap(.round)
        context.setLineWidth(max(1.2, min(rect.width, rect.height) * 0.018))
        context.setStrokeColor(NSColor(calibratedRed: 0.25, green: 0.34, blue: 0.42, alpha: 0.58).cgColor)
        for index in 0..<points.count {
            for other in (index + 1)..<points.count {
                let dx = limitedAtoms[index].x - limitedAtoms[other].x
                let dy = limitedAtoms[index].y - limitedAtoms[other].y
                let dz = limitedAtoms[index].z - limitedAtoms[other].z
                let distance = sqrt(dx * dx + dy * dy + dz * dz)
                if distance > 0.35 && distance < 1.85 {
                    context.move(to: points[index])
                    context.addLine(to: points[other])
                    context.strokePath()
                }
            }
        }

        let atomRadius = max(2.5, min(rect.width, rect.height) * 0.035)
        for (atom, point) in zip(limitedAtoms, points) {
            context.setFillColor(color(for: atom.element).cgColor)
            context.fillEllipse(in: CGRect(
                x: point.x - atomRadius,
                y: point.y - atomRadius,
                width: atomRadius * 2,
                height: atomRadius * 2
            ))
        }
    }

    private static func drawGenericGlyph(fileExtension: String, in rect: CGRect, context: CGContext) {
        let inset = min(rect.width, rect.height) * 0.22
        let page = rect.insetBy(dx: inset, dy: inset * 0.75)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: page.minX, y: page.minY))
        path.addLine(to: CGPoint(x: page.maxX, y: page.minY))
        path.addLine(to: CGPoint(x: page.maxX, y: page.maxY - page.height * 0.18))
        path.addLine(to: CGPoint(x: page.maxX - page.width * 0.2, y: page.maxY))
        path.addLine(to: CGPoint(x: page.minX, y: page.maxY))
        path.closeSubpath()
        context.setFillColor(NSColor(calibratedRed: 0.86, green: 0.91, blue: 0.95, alpha: 1).cgColor)
        context.addPath(path)
        context.fillPath()
        context.setStrokeColor(NSColor(calibratedRed: 0.25, green: 0.34, blue: 0.42, alpha: 0.7).cgColor)
        context.setLineWidth(max(1, rect.width * 0.018))
        context.addPath(path)
        context.strokePath()

        let label = fileExtension.uppercased()
        let attributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor(calibratedRed: 0.22, green: 0.29, blue: 0.36, alpha: 1),
            .font: NSFont.monospacedSystemFont(ofSize: max(9, min(rect.width, rect.height) * 0.16), weight: .semibold)
        ]
        let attributed = NSAttributedString(string: label, attributes: attributes)
        let labelSize = attributed.size()
        attributed.draw(at: CGPoint(x: rect.midX - labelSize.width / 2, y: rect.midY - labelSize.height / 2))
    }

    private static func parsePDB(_ text: String) -> [ThumbnailAtom]? {
        var atoms: [ThumbnailAtom] = []
        for line in text.split(whereSeparator: \.isNewline) {
            guard line.hasPrefix("ATOM") || line.hasPrefix("HETATM") else { continue }
            let value = String(line)
            guard value.count >= 54,
                  let x = Double(value[safe: 30..<38].trimmingCharacters(in: .whitespaces)),
                  let y = Double(value[safe: 38..<46].trimmingCharacters(in: .whitespaces)),
                  let z = Double(value[safe: 46..<54].trimmingCharacters(in: .whitespaces)) else {
                continue
            }
            let element = value.count >= 78
                ? value[safe: 76..<78].trimmingCharacters(in: .whitespaces)
                : value[safe: 12..<16].trimmingCharacters(in: .whitespaces)
            atoms.append(ThumbnailAtom(element: element, x: x, y: y, z: z))
            if atoms.count > 240 { return nil }
        }
        return atoms.count >= 2 ? atoms : nil
    }

    private static func parseMolfile(_ text: String) -> [ThumbnailAtom]? {
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        guard lines.count >= 4 else { return nil }
        let counts = lines[3].split(whereSeparator: \.isWhitespace)
        guard let atomCount = counts.first.flatMap({ Int($0) }),
              atomCount > 1,
              atomCount <= 240,
              lines.count >= 4 + atomCount else {
            return nil
        }
        var atoms: [ThumbnailAtom] = []
        for line in lines[4..<(4 + atomCount)] {
            let parts = line.split(whereSeparator: \.isWhitespace)
            guard parts.count >= 4,
                  let x = Double(parts[0]),
                  let y = Double(parts[1]),
                  let z = Double(parts[2]) else {
                continue
            }
            atoms.append(ThumbnailAtom(element: String(parts[3]), x: x, y: y, z: z))
        }
        return atoms.count >= 2 ? atoms : nil
    }

    private static func parseXYZ(_ text: String) -> [ThumbnailAtom]? {
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        guard let atomCount = lines.first.flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }),
              atomCount > 1,
              atomCount <= 240,
              lines.count >= atomCount + 2 else {
            return nil
        }
        var atoms: [ThumbnailAtom] = []
        for line in lines[2..<(2 + atomCount)] {
            let parts = line.split(whereSeparator: \.isWhitespace)
            guard parts.count >= 4,
                  let x = Double(parts[1]),
                  let y = Double(parts[2]),
                  let z = Double(parts[3]) else {
                continue
            }
            atoms.append(ThumbnailAtom(element: String(parts[0]), x: x, y: y, z: z))
        }
        return atoms.count >= 2 ? atoms : nil
    }

    private static func structurePathExtension(for url: URL) -> String {
        if url.lastPathComponent.lowercased().hasSuffix(".mae.gz") {
            return "maegz"
        }
        return url.pathExtension.lowercased()
    }

    private static func decodeText(_ data: Data) -> String {
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: .isoLatin1) { return value }
        return String(decoding: data, as: UTF8.self)
    }

    private static func color(for element: String) -> NSColor {
        switch element.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "C": return NSColor(calibratedRed: 0.24, green: 0.27, blue: 0.31, alpha: 1)
        case "N": return NSColor(calibratedRed: 0.16, green: 0.34, blue: 0.78, alpha: 1)
        case "O": return NSColor(calibratedRed: 0.78, green: 0.18, blue: 0.18, alpha: 1)
        case "S": return NSColor(calibratedRed: 0.82, green: 0.62, blue: 0.15, alpha: 1)
        case "P": return NSColor(calibratedRed: 0.87, green: 0.43, blue: 0.2, alpha: 1)
        case "H": return NSColor(calibratedRed: 0.86, green: 0.88, blue: 0.9, alpha: 1)
        default: return NSColor(calibratedRed: 0.24, green: 0.56, blue: 0.54, alpha: 1)
        }
    }
}

private struct ThumbnailAtom {
    let element: String
    let x: Double
    let y: Double
    let z: Double
}

private extension String {
    subscript(safe range: Range<Int>) -> String {
        let lower = index(startIndex, offsetBy: max(0, min(range.lowerBound, count)))
        let upper = index(startIndex, offsetBy: max(0, min(range.upperBound, count)))
        return String(self[lower..<upper])
    }
}
