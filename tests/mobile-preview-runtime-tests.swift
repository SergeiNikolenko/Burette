import Foundation

@main
struct MobilePreviewRuntimeTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("frames.xyz")
        let document = MobilePreviewDocument(filename: "frames.xyz", importedFileURL: url)
        let fixtures: [(String, Int)] = [
            ("\(Int.max)\ncomment\n", 0),
            ("2\ncomment\nH 0 0 0\n", 0),
            ("1", 0),
            ("1\ncomment\nH 0 0 0\n", 1),
            ("1\nfirst\nH 0 0 0\n1\nsecond\nH 1 0 0\n", 2)
        ]
        for (text, expected) in fixtures {
            try Data(text.utf8).write(to: url)
            precondition(document.xyzFrameCount() == expected)
            precondition(document.xyzFrameCount(frameLimit: 1) == min(1, expected))
        }
        // Sparse input proves the size check precedes unbounded materialization.
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(MobilePreviewRuntime.maximumPreviewBytes + 1))
        try handle.close()
        do {
            _ = try MobilePreviewRuntime.readPreviewData(at: url)
            preconditionFailure("Oversized input must be rejected")
        } catch MobilePreviewRuntime.RuntimeError.sampleTooLarge {
            // Expected error, rather than a trap or a full-file allocation.
        }
        precondition(document.xyzFrameCount() == 0)
        print("Mobile runtime: malformed XYZ, frame limits, and bounded input passed")
    }
}
