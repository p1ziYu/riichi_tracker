# 一姬 Android WebView shell

Standalone Android app (`com.p1ziyu.riichitracker.shell`) displaying `https://riichi.p1ziyu.com/` in one WebView. The web app owns authentication and all UI. JavaScript and DOM storage are enabled; there is no native match logic, toolbar, scanner, or page injection.

The web page declares `viewport-fit=cover` and positions its header and bottom tabs using CSS `env(safe-area-inset-*)`. Android WebView does not provide usable CSS safe-area insets, so this shell keeps the default system-window behavior: the WebView sits inside the system bars once. No edge-to-edge decor call, custom padding, or inset layer is added. `adjustResize` resizes the WebView for the keyboard; orientation changes do not recreate the Activity.

The `autoVerify` App Links intent filter accepts HTTPS `/checkin/` links at the exact host. Cold and warm launches pass the entire incoming check-in URL, including its query, to the WebView; other hosts open with `ACTION_VIEW`. The server's `assetlinks.json` currently lists only the web app package. The coordinator must add `com.p1ziyu.riichitracker.shell` and its signing certificate fingerprint server-side for this new package to auto-verify. Debug-APK deep-link verification on an emulator or device is still open.

Build: `./gradlew :app:assembleDebug`. Pure Java URL tests: `./gradlew :app:testDebugUnitTest`. Neither command launches the app or contacts the production web origin.
