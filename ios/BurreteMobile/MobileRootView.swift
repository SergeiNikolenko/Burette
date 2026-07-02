import SwiftUI

/// Root shell for the iPhone app. The Mol* viewer is full-screen; there is no
/// bottom tab bar. A left-edge swipe opens the Files browser (project drawer),
/// a right-edge swipe opens Settings.
struct MobileRootView: View {
    @State private var model = MobileAppModel()

    var body: some View {
        MobilePreviewScreen(model: model)
            .preferredColorScheme(model.theme.preferredColorSchemeValue)
    }
}

extension MobileThemeSelection {
    /// Color-scheme mapping so the root shell can apply the theme app-wide.
    var preferredColorSchemeValue: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }
}
