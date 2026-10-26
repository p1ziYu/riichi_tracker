# 一姬 iOS WebView shell

This standalone iOS 17+ UIKit app (`com.p1ziyu.riichitracker.shell`) displays `https://riichi.p1ziyu.com/` in one WKWebView. The web app owns authentication and all UI. The shell enables JavaScript and persistent DOM storage, with no native business UI or page injection. Exact-host navigation stays in the WebView; other hosts open using `UIApplication.shared.open`. Cold and warm incoming links pass the full URL, including the query, to the WebView.

The page already declares `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` and uses CSS `env(safe-area-inset-*)` for its header and bottom tabs. WKWebView is constrained to the safe-area guides on top/leading/trailing and to the superview's bottom edge, with `scrollView.contentInsetAdjustmentBehavior = .never`. Rationale (verified on the iPhone 17 simulator against mobile Safari): the web topbar does not consume `env(safe-area-inset-top)`, so a fully edge-to-edge WebView leaves the brand row under the status bar; framing top/sides in the safe area fixes that with a single inset layer, while the bottom stays edge-to-edge so the web's own `env(safe-area-inset-bottom)` remains the single bottom inset for its floating tab bar. The shell adds no safe-area padding, additional content insets, injected CSS/JS, or viewport override. WKWebView scrolling remains enabled for keyboard access.

The Associated Domains entitlement is `applinks:riichi.p1ziyu.com`. The server-side apple-app-site-association currently lists only the web app's team/app ID. The coordinator must add this new `.shell` app ID server-side before a signed build will reliably open universal links from outside. The shell-side entitlement and URL handling are complete; signed-device cold/warm deep-link verification remains open. Automatic signing has no preconfigured team.

For a local unsigned IPA artifact on a Mac with Xcode, run from this directory (this does **not** produce an installable signed-device app):

```sh
xcodebuild -project IchihimeShell.xcodeproj -scheme 一姬 -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath ./DerivedData CODE_SIGNING_ALLOWED=NO build
mkdir -p Payload
cp -R DerivedData/Build/Products/Release-iphoneos/一姬.app Payload/
zip -r 一姬-unsigned.ipa Payload
```

For a signed build, select a development team and provisioning in Xcode, then archive and export using your own signing credentials. No production endpoint is contacted by the build itself; opening the app will load the configured site.
