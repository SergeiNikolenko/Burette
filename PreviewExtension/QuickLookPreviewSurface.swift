import SwiftUI
import WebKit

struct QuickLookPreviewSurface: View {
    let webView: WKWebView
    let transparentBackground: Bool

    var body: some View {
        ZStack {
            if transparentBackground {
                Rectangle()
                    .fill(.regularMaterial)
                    .ignoresSafeArea()
            } else {
                Color.black
                    .ignoresSafeArea()
            }
            QuickLookWebViewRepresentable(webView: webView)
        }
    }
}

struct QuickLookWebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
    }
}
