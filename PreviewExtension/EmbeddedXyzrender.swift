import Darwin
import Foundation

/// Quick Look cannot spawn the bundled Python executable. CJSON uses that same
/// interpreter and renderer in the extension process, with isolated Python state.
enum EmbeddedXyzrender {
    private typealias Run = @convention(c) (
        UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>,
        UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafeMutablePointer<CChar>, Int
    ) -> Int32

    static func render(
        extensionBundle: URL,
        pythonHome: String,
        sitePackages: String,
        sourceURL: URL,
        arguments: [String],
        logURL: URL
    ) throws -> Int32 {
        let sourceAttributes = try FileManager.default.attributesOfItem(atPath: sourceURL.path)
        guard (sourceAttributes[.size] as? NSNumber)?.uint64Value ?? 0 <= 64 * 1024 * 1024 else {
            throw failure("CJSON input exceeds the 64 MiB limit.")
        }
        let libraryDirectory = extensionBundle.appendingPathComponent("Contents/lib")
        let bridgeURL = libraryDirectory.appendingPathComponent("burette-xyzrender-bridge.dylib")
        let pythonURL = libraryDirectory.appendingPathComponent("libpython3.13.dylib")
        guard let handle = dlopen(bridgeURL.path, RTLD_NOW | RTLD_LOCAL) else {
            let detail = dlerror().map { String(cString: $0) } ?? "unknown error"
            throw failure("Could not load bundled CJSON renderer: \(detail)")
        }
        // The bridge owns the process-lifetime interpreter and its serialization.
        // Do not unload it while Python modules retain native function pointers.
        guard let symbol = dlsym(handle, "burette_xyzrender_run") else {
            throw failure("The bundled CJSON renderer entry point is missing.")
        }
        let run = unsafeBitCast(symbol, to: Run.self)
        let argumentData = try JSONSerialization.data(withJSONObject: arguments)
        guard argumentData.count <= 1024 * 1024 else {
            throw failure("CJSON render arguments exceed the 1 MiB limit.")
        }
        let argumentJSON = String(decoding: argumentData, as: UTF8.self)
        var error = [CChar](repeating: 0, count: 1024)
        let status = run(pythonURL.path, pythonHome, sitePackages, argumentJSON, logURL.path, &error, error.count)
        if status < 0 { throw failure(String(cString: error)) }
        if status == 0, let outputIndex = arguments.firstIndex(of: "-o"),
           arguments.indices.contains(outputIndex + 1) {
            let attributes = try FileManager.default.attributesOfItem(atPath: arguments[outputIndex + 1])
            if (attributes[.size] as? NSNumber)?.uint64Value ?? 0 > 32 * 1024 * 1024 {
                throw failure("CJSON render output exceeds the 32 MiB limit.")
            }
        }
        return status
    }

    private static func failure(_ message: String) -> NSError {
        NSError(domain: "BuretteEmbeddedXyzrender", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
