import XCTest

final class ScreenshotTourTests: XCTestCase {
    private let timeout: TimeInterval = 15

    private func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }

    private func capture(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing UI control: \(element.identifier)", file: file, line: line)
        element.tap()
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication,
                          file: StaticString = #filePath, line: UInt = #line) {
        dismissPasswordPromptIfPresent(in: app)
        for _ in 0..<12 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, "Missing visible UI control: \(element.identifier)", file: file, line: line)
    }

    private func scrollToAndTap(_ element: XCUIElement, in app: XCUIApplication,
                                file: StaticString = #filePath, line: UInt = #line) {
        scrollTo(element, in: app, file: file, line: line)
        element.tap()
    }

    private func tab(_ name: String, in app: XCUIApplication) {
        dismissPasswordPromptIfPresent(in: app)
        tap(app.tabBars.buttons[name])
    }

    private func returnToLocalLobby(in app: XCUIApplication) {
        tap(app.navigationBars.buttons["本地牌桌"])
        XCTAssertTrue(app.buttons["离线开桌"].waitForExistence(timeout: timeout))
    }

    // Keychain credentials can survive app relaunches and independent test executions.
    private func showSignedOutAuth(in app: XCUIApplication) {
        if !app.tabBars.buttons["在线登录"].waitForExistence(timeout: 4) {
            if app.tabBars.buttons["我的"].waitForExistence(timeout: timeout) {
                tab("我的", in: app)
                tap(app.buttons["退出登录"])
            } else if app.buttons["先进入本地牌桌（保留在线凭据）"].exists {
                tap(app.buttons["先进入本地牌桌（保留在线凭据）"])
                if app.buttons["返回在线"].waitForExistence(timeout: timeout) {
                    tap(app.buttons["返回在线"])
                    tab("我的", in: app)
                    tap(app.buttons["退出登录"])
                }
            }
        }
        tab("在线登录", in: app)
        XCTAssertTrue(app.buttons["以在线临时访客进入"].waitForExistence(timeout: timeout))
    }


    // The simulator's iCloud Keychain prompt can surface long after sign-in and
    // then swallows later gestures. Depending on the OS build it is owned by the
    // app process or by SpringBoard, so check both, more than once.
    private func dismissPasswordPromptIfPresent(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if app.buttons["Not Now"].exists { app.buttons["Not Now"].tap(); return }
        if springboard.buttons["Not Now"].exists { springboard.buttons["Not Now"].tap(); return }
        _ = app.tabBars.firstMatch.waitForExistence(timeout: 1)
        if app.buttons["Not Now"].exists { app.buttons["Not Now"].tap(); return }
        if springboard.buttons["Not Now"].exists { springboard.buttons["Not Now"].tap(); return }
    }


    private func installPromptMonitor() {
        addUIInterruptionMonitor(withDescription: "System save-password prompt") { element in
            let notNow = element.buttons["Not Now"]
            if notNow.exists { notNow.tap(); return true }
            return false
        }
    }

    func testAuthTour() {
        let app = launch(["-UITestSeed"])
        installPromptMonitor()
        showSignedOutAuth(in: app)
        capture("tour-online-01-auth", in: app)
    }

    func testLocalTour() {
        // One launch: the fresh -UITestSeed store must retain the newly created table
        // between the wizard, settlement, and final lobby-row captures.
        let app = launch(["-UITestSeed"])
        if app.tabBars.buttons["本地"].waitForExistence(timeout: 3) {
            tab("本地", in: app)
        } else {
            tab("本地牌桌", in: app)
        }
        XCTAssertTrue(app.buttons["离线开桌"].waitForExistence(timeout: timeout))
        capture("tour-local-01-lobby", in: app)

        tap(app.buttons["离线开桌"])
        XCTAssertTrue(app.buttons["local.template.house_4p"].waitForExistence(timeout: timeout))
        capture("tour-local-02-wizard-templates", in: app)
        tap(app.buttons["local.template.house_4p"])
        tap(app.buttons["local.wizard.nextRules"])
        XCTAssertTrue(app.staticTexts["起点与成绩"].waitForExistence(timeout: timeout))
        scrollTo(app.staticTexts["终局策略"], in: app)
        capture("tour-local-03-wizard-rules", in: app)
        scrollToAndTap(app.buttons["local.wizard.nextNames"], in: app)
        XCTAssertTrue(app.textFields["牌桌名称"].waitForExistence(timeout: timeout))
        capture("tour-local-04-wizard-names", in: app)
        tap(app.buttons["local.wizard.create"])

        XCTAssertTrue(app.staticTexts["座位与点数"].waitForExistence(timeout: 30))
        capture("tour-local-05-table", in: app)
        scrollToAndTap(app.buttons["local.table.enterResult"], in: app)
        XCTAssertTrue(app.buttons["local.result.preview"].waitForExistence(timeout: timeout))
        capture("tour-local-06-result-entry", in: app)
        // A dealer counted yakuman bankrupts seat 2 under the bundled house rules,
        // producing a finished match without inventing a server or store fixture.
        let han = app.textFields["1 号位番 1–130"]
        tap(han)
        let currentHan = han.value as? String ?? ""
        han.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: currentHan.count) + "13")
        scrollToAndTap(app.buttons["local.result.preview"], in: app)
        scrollTo(app.staticTexts["local.result.payment.1"], in: app)
        capture("tour-local-07-settle-preview", in: app)
        scrollToAndTap(app.buttons["local.result.settle"], in: app)
        // House rules end manually (automaticEndPolicy=manual): settling one hand
        // does not finish the match, even with a seat below zero.
        scrollToAndTap(app.buttons["手动终局"], in: app)
        tap(app.buttons["继续确认"])
        tap(app.buttons["放弃当前局并终局"])
        if app.buttons["确认并保存最终成绩"].waitForExistence(timeout: 5) {
            scrollToAndTap(app.buttons["确认并保存最终成绩"], in: app)
        }
        XCTAssertTrue(app.staticTexts["四麻家规 · 已结束"].waitForExistence(timeout: 30))
        scrollTo(app.staticTexts["已结算逐局历史 · 保存的原始输入及引擎输出"], in: app)
        scrollTo(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "local.table.history.")).firstMatch, in: app)
        capture("tour-local-08-table-after-settle", in: app)
        returnToLocalLobby(in: app)
        tap(app.buttons["离线开桌"])
        tap(app.buttons["local.template.house_3p"])
        tap(app.buttons["local.wizard.nextRules"])
        scrollToAndTap(app.buttons["local.wizard.nextNames"], in: app)
        tap(app.buttons["local.wizard.create"])
        XCTAssertTrue(app.staticTexts["座位与点数"].waitForExistence(timeout: 30))
        returnToLocalLobby(in: app)
        XCTAssertTrue(app.staticTexts["三麻家规"].waitForExistence(timeout: timeout))
        if !app.staticTexts["四麻家规"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["四麻家规"].isHittable)
        XCTAssertTrue(app.staticTexts["三麻家规"].isHittable)
        capture("tour-local-09-lobby-rows", in: app)
    }

    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    func testSeededOnlineTour() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["UITEST_SEEDED"] == "1", "Requires disposable seeded online backend (UITEST_SEEDED=1)")
        let email = environment["UITEST_EMAIL"] ?? ""
        let password = environment["UITEST_PASSWORD"] ?? ""
        try XCTSkipUnless(!email.isEmpty && !password.isEmpty, "Set UITEST_EMAIL and UITEST_PASSWORD for seeded online tour")

        let app = launch(["-UITestSeed"])
        installPromptMonitor()
        showSignedOutAuth(in: app)
        let emailField = app.textFields["邮箱"]
        let passwordField = app.secureTextFields["密码"]
        tap(emailField)
        emailField.typeText(email)
        tap(passwordField)
        passwordField.typeText(password)
        tap(app.buttons["登录"])
        XCTAssertTrue(app.buttons["开桌 ↗"].waitForExistence(timeout: timeout), "Seeded account did not enter the signed-in lobby")
        dismissPasswordPromptIfPresent(in: app)
        scrollTo(app.buttons["online.match.active"], in: app)
        capture("tour-online-02-lobby", in: app)

        if !app.buttons["online.wizard.open"].isHittable { app.swipeDown() }
        tap(app.buttons["online.wizard.open"])
        XCTAssertTrue(app.staticTexts["选择系统规则模板"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "rulesWizard.template."))
            .firstMatch.waitForExistence(timeout: timeout), "Seeded backend must serve a selectable ruleset template")
        dismissPasswordPromptIfPresent(in: app)
        capture("tour-online-03-wizard", in: app)
        // This wizard is a dismissible sheet, without a Close toolbar item.
        dismissPasswordPromptIfPresent(in: app)
        for origin in [0.12, 0.06] where !app.buttons["online.wizard.open"].isHittable {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: origin))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        XCTAssertTrue(app.buttons["online.wizard.open"].isHittable, "Could not dismiss the wizard sheet")

        // The lobby's second primary action opens the existing join flow
        // (room-code entry + QR scan) without leaving the lobby tab.
        tap(app.buttons["online.join.open"])
        XCTAssertTrue(app.textFields["checkIn.roomCode"].waitForExistence(timeout: timeout),
                      "Lobby join entry did not present the check-in flow")
        capture("tour-online-09-join", in: app)
        // With a seeded room code, the same flow reaches the seat preview
        // (its "N / 4。自动选择…" line is a punctuation-metrics proof surface).
        if let joinCode = environment["UITEST_JOINCODE"], !joinCode.isEmpty {
            let codeField = app.textFields["checkIn.roomCode"]
            tap(codeField)
            codeField.typeText(joinCode)
            tap(app.buttons["checkIn.redeemCode"])
            XCTAssertTrue(app.buttons["checkIn.confirmSeat"].waitForExistence(timeout: timeout),
                          "Room code did not reach the seat preview")
            capture("tour-online-10-seats", in: app)
        }
        tap(app.buttons["关闭"])
        XCTAssertFalse(app.textFields["checkIn.roomCode"].waitForExistence(timeout: 3), "Join sheet did not close")

        tab("我的", in: app)
        tap(app.buttons["扫描二维码 / 粘贴签到链接 / 房间码"])
        if !app.textFields["checkIn.roomCode"].waitForExistence(timeout: timeout) {
            // Sheet presentation occasionally lags a beat behind the profile tab
            // switch; one more tap on the still-visible row is harmless.
            tap(app.buttons["扫描二维码 / 粘贴签到链接 / 房间码"])
        }
        XCTAssertTrue(app.textFields["checkIn.roomCode"].waitForExistence(timeout: timeout))
        capture("tour-online-04-checkin", in: app)
        tap(app.buttons["关闭"])
        XCTAssertFalse(app.textFields["checkIn.roomCode"].waitForExistence(timeout: 3), "Check-in sheet did not close")
    }

    func testSeededTableTour() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["UITEST_SEEDED"] == "1", "Requires disposable seeded online backend (UITEST_SEEDED=1)")
        let email = environment["UITEST_EMAIL"] ?? ""
        let password = environment["UITEST_PASSWORD"] ?? ""
        try XCTSkipUnless(!email.isEmpty && !password.isEmpty, "Set UITEST_EMAIL and UITEST_PASSWORD for seeded online tour")

        let app = launch(["-UITestSeed"])
        installPromptMonitor()
        showSignedOutAuth(in: app)
        let emailField = app.textFields["邮箱"]
        let passwordField = app.secureTextFields["密码"]
        tap(emailField)
        emailField.typeText(email)
        tap(passwordField)
        passwordField.typeText(password)
        tap(app.buttons["登录"])
        XCTAssertTrue(app.buttons["开桌 ↗"].waitForExistence(timeout: timeout), "Seeded account did not enter the signed-in lobby")
        dismissPasswordPromptIfPresent(in: app)
        scrollToAndTap(app.buttons["online.match.active"], in: app)
        XCTAssertTrue(app.staticTexts["对局信息"].waitForExistence(timeout: timeout), "Seeded match did not load")
        capture("tour-online-05-table", in: app)
        dismissPasswordPromptIfPresent(in: app)
        // The hand-controls area loads asynchronously: poll for either state
        // (open hand -> result entry, or no hand yet -> open-hand button)
        // instead of racing a single short existence wait.
        // Hand controls sit below the seats section; offscreen List rows are
        // not realized in the accessibility tree, so scroll while polling.
        var handState = ""
        for _ in 0..<20 {
            dismissPasswordPromptIfPresent(in: app)
            if app.buttons["online.table.resultEntry"].exists { handState = "entry"; break }
            if app.buttons["新开一局"].exists { handState = "open"; break }
            app.swipeUp()
        }
        if handState == "open" {
            // A freshly finalized match has no open hand yet; the host opens the
            // first one from the table, exactly as in the Web UI.
            dismissPasswordPromptIfPresent(in: app)
            scrollToAndTap(app.buttons["新开一局"], in: app)
            XCTAssertTrue(app.buttons["online.table.resultEntry"].waitForExistence(timeout: 15))
        }
        // The entry button stays disabled until the pending-result check has
        // loaded; tapping it earlier is a silent no-op.
        let entryButton = app.buttons["online.table.resultEntry"]
        if !entryButton.waitForExistence(timeout: timeout) {
            dismissPasswordPromptIfPresent(in: app)
            _ = entryButton.waitForExistence(timeout: timeout)
        }
        XCTAssertTrue(entryButton.exists, "Result entry button never appeared")
        var enableWait = 0
        while enableWait < 20 {
            if entryButton.exists && entryButton.isEnabled { break }
            dismissPasswordPromptIfPresent(in: app)
            _ = entryButton.waitForExistence(timeout: 1)
            enableWait += 1
        }
        XCTAssertTrue(entryButton.exists && entryButton.isEnabled, "Result entry never became writable")
        // A live-snapshot re-render can swallow the first sheet presentation;
        // retry the tap a few times before giving up (a human would tap again).
        var formOpened = false
        for _ in 0..<3 where !formOpened {
            dismissPasswordPromptIfPresent(in: app)
            scrollToAndTap(entryButton, in: app)
            formOpened = app.buttons["online.result.preview"].waitForExistence(timeout: 5)
        }
        XCTAssertTrue(formOpened, "Result entry form never presented")
        scrollTo(app.buttons["online.result.preview"], in: app)
        capture("tour-online-06-result-entry", in: app)
        tap(app.buttons["关闭"])
        let alertSave = app.alerts.buttons["保存草稿并关闭"]
        if alertSave.waitForExistence(timeout: 3) {
            alertSave.tap()
        } else if app.buttons["保存草稿并关闭"].waitForExistence(timeout: 1) {
            tap(app.buttons["保存草稿并关闭"])
        }
        XCTAssertTrue(app.buttons["online.table.resultEntry"].waitForExistence(timeout: timeout), "Result form did not close back to the table")
        tab("战绩", in: app)
        XCTAssertTrue(app.navigationBars["战绩"].waitForExistence(timeout: timeout))
        scrollTo(app.buttons["online.match.active"], in: app)
        capture("tour-online-07-history", in: app)
        tab("我的", in: app)
        XCTAssertTrue(app.staticTexts["我的账号"].waitForExistence(timeout: timeout))
        capture("tour-online-08-profile", in: app)
    }
}
