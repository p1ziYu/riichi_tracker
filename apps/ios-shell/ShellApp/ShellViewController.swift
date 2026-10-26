import UIKit
import WebKit

final class ShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // Safe-area split (verified on the iPhone 17 simulator): the web topbar does
        // NOT consume env(safe-area-inset-top), so a fully edge-to-edge WebView leaves
        // the brand row under the status bar. Top/leading/trailing therefore use the
        // safe-area guides (one frame inset, no extra layer). The bottom stays at the
        // view edge so the web's own env(safe-area-inset-bottom) remains the single
        // bottom inset for its floating tab bar. No injected CSS/JS, no padding.
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safeArea.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor)
        ])
    }

    func loadShellURL(_ url: URL) {
        if ShellURL.isShellHost(url.host) {
            loadViewIfNeeded()
            webView.load(URLRequest(url: url))
        } else if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        // Non-http(s) URLs are ignored: never hand a non-web scheme to the browser.
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if ShellURL.isShellHost(url.host) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            loadShellURL(url)
        }
        return nil
    }
}
