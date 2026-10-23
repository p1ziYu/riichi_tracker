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
        for _ in 0..<12 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, "Missing visible UI control: \(element.identifier)", file: file, line: line)
    }

    private func scrollToAndTap(_ element: XCUIElement, in app: XCUIApplication,
                                file: StaticString = #filePath, line: UInt = #line) {
        scrollTo(element, in: app, file: file, line: line)
        element.tap()
    }

    private func tab(_ name: String, in app: XCUIApplication) {
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

    func testAuthTour() {
        let app = launch(["-UITestSeed"])
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

        XCTAssertTrue(app.buttons["local.table.enterResult"].waitForExistence(timeout: timeout))
        capture("tour-local-05-table", in: app)
        tap(app.buttons["local.table.enterResult"])
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
        XCTAssertTrue(app.staticTexts["四麻家规 · 已结束"].waitForExistence(timeout: timeout))
        scrollTo(app.staticTexts["已结算逐局历史 · 保存的原始输入及引擎输出"], in: app)
        scrollTo(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "local.table.history.")).firstMatch, in: app)
        capture("tour-local-08-table-after-settle", in: app)
        returnToLocalLobby(in: app)
        tap(app.buttons["离线开桌"])
        tap(app.buttons["local.template.house_3p"])
        tap(app.buttons["local.wizard.nextRules"])
        scrollToAndTap(app.buttons["local.wizard.nextNames"], in: app)
        tap(app.buttons["local.wizard.create"])
        XCTAssertTrue(app.buttons["local.table.enterResult"].waitForExistence(timeout: timeout))
        returnToLocalLobby(in: app)
        XCTAssertTrue(app.staticTexts["三麻家规"].waitForExistence(timeout: timeout))
        if !app.staticTexts["四麻家规"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["四麻家规"].isHittable)
        XCTAssertTrue(app.staticTexts["三麻家规"].isHittable)
        capture("tour-local-09-lobby-rows", in: app)
    }

    func testSeededOnlineTour() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["UITEST_SEEDED"] == "1", "Requires disposable seeded online backend (UITEST_SEEDED=1)")
        let email = environment["UITEST_EMAIL"] ?? ""
        let password = environment["UITEST_PASSWORD"] ?? ""
        try XCTSkipUnless(!email.isEmpty && !password.isEmpty, "Set UITEST_EMAIL and UITEST_PASSWORD for seeded online tour")

        let app = launch(["-UITestSeed"])
        showSignedOutAuth(in: app)
        let emailField = app.textFields["邮箱"]
        let passwordField = app.secureTextFields["密码"]
        tap(emailField)
        emailField.typeText(email)
        tap(passwordField)
        passwordField.typeText(password)
        tap(app.buttons["登录"])
        XCTAssertTrue(app.buttons["开桌 ↗"].waitForExistence(timeout: timeout), "Seeded account did not enter the signed-in lobby")
        scrollTo(app.buttons["online.match.active"], in: app)
        capture("tour-online-02-lobby", in: app)

        if !app.buttons["online.wizard.open"].isHittable { app.swipeDown() }
        tap(app.buttons["online.wizard.open"])
        XCTAssertTrue(app.staticTexts["选择系统规则模板"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "rulesWizard.template."))
            .firstMatch.waitForExistence(timeout: timeout), "Seeded backend must serve a selectable ruleset template")
        capture("tour-online-03-wizard", in: app)
        // This wizard is a dismissible sheet, without a Close toolbar item.
        for origin in [0.12, 0.06] where !app.buttons["online.wizard.open"].isHittable {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: origin))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        XCTAssertTrue(app.buttons["online.wizard.open"].isHittable, "Could not dismiss the wizard sheet")

        tab("我的", in: app)
        tap(app.buttons["扫描二维码 / 粘贴签到链接 / 房间码"])
        XCTAssertTrue(app.textFields["checkIn.roomCode"].waitForExistence(timeout: timeout))
        capture("tour-online-04-checkin", in: app)
        tap(app.buttons["关闭"])
        tab("大厅", in: app)
        scrollToAndTap(app.buttons["online.match.active"], in: app)
        XCTAssertTrue(app.staticTexts["对局信息"].waitForExistence(timeout: timeout), "Seeded match did not load")
        capture("tour-online-05-table", in: app)
        scrollToAndTap(app.buttons["online.table.resultEntry"], in: app)
        XCTAssertTrue(app.buttons["online.result.preview"].waitForExistence(timeout: timeout), "Seeded match must have a writable current hand")
        capture("tour-online-06-result-entry", in: app)
        tap(app.buttons["关闭"])
        tab("战绩", in: app)
        XCTAssertTrue(app.navigationBars["战绩"].waitForExistence(timeout: timeout))
        scrollTo(app.buttons["online.match.active"], in: app)
        capture("tour-online-07-history", in: app)
        tab("我的", in: app)
        XCTAssertTrue(app.staticTexts["我的账号"].waitForExistence(timeout: timeout))
        capture("tour-online-08-profile", in: app)
    }
}
