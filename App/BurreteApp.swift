import SwiftUI

@main
struct BurreteApp: App {
    @NSApplicationDelegateAdaptor(AppLifecycleBridge.self) private var appLifecycle

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
