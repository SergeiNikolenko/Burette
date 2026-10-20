// Read-only host inventory and graceful termination for the owned perf process.
// No UI scripting or Automation permissions are required.
import AppKit
import Foundation

let arguments = CommandLine.arguments.dropFirst()
func emit(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
switch arguments.first {
case "screens":
    try emit(NSScreen.screens.map { screen -> [String: Any] in
        let frame = screen.frame, visible = screen.visibleFrame
        return ["name": screen.localizedName,
                "frame": [frame.origin.x, frame.origin.y, frame.width, frame.height],
                "visible": [visible.origin.x, visible.origin.y, visible.width, visible.height],
                "scale": screen.backingScaleFactor, "fps": screen.maximumFramesPerSecond]
    })
case "pids":
    guard arguments.count == 2 else { exit(2) }
    try emit(NSRunningApplication.runningApplications(withBundleIdentifier: arguments.last!)
        .map { Int($0.processIdentifier) })
case "terminate":
    guard arguments.count == 2, let pid = Int32(arguments.last!) else { exit(2) }
    guard let app = NSRunningApplication(processIdentifier: pid) else { exit(0) }
    guard app.bundleIdentifier?.hasPrefix("com.local.BuretteV10.Dev.") == true else { exit(2) }
    exit(app.terminate() ? 0 : 1)
default:
    exit(2)
}
