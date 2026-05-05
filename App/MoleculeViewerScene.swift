import SwiftUI
import WebKit

struct MoleculeViewerScene: View {
    let webView: WKWebView
    let transparentWindow: Bool
    let windowOpacity: Double

    private let surfaceCornerRadius: CGFloat = 8
    private let surfaceInset: CGFloat = 10

    var body: some View {
        ZStack {
            sceneBackground
            WebViewRepresentable(webView: webView)
                .clipShape(RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous)
                        .strokeBorder(Color.secondary.opacity(0.22), lineWidth: 1)
                }
                .shadow(color: Color.black.opacity(transparentWindow ? 0.18 : 0.10), radius: 10, x: 0, y: 3)
                .padding(surfaceInset)
        }
    }

    @ViewBuilder
    private var sceneBackground: some View {
        if transparentWindow {
            Rectangle()
                .fill(.regularMaterial)
                .opacity(windowOpacity)
                .ignoresSafeArea()
        } else {
            Rectangle()
                .fill(.background)
                .ignoresSafeArea()
        }
    }
}

struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
    }
}
