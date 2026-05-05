import SwiftUI

extension Notification.Name {
    static let burreteOpenSettingsSection = Notification.Name("BurreteOpenSettingsSection")
}

@main
struct BurreteApp: App {
    @NSApplicationDelegateAdaptor(AppLifecycleBridge.self) private var appLifecycle

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
