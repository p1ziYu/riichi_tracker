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
        // Scroll until the element is hittable. Two measured traps shape
        // this loop (both 2026-10-24):
        // 1. A plain app.swipeUp() starts its gesture low enough to land on
        //    the numberPad when it is up, and the keyboard swallows it:
        //    three such swipes moved the sheet 0pt, while one content-area
        //    swipe dismisses the keyboard and scrolls. So while the
        //    keyboard is up, only a content-area drag is used.
        // 2. A FIXED drag start stalls forever once the scroll position
        //    puts a drag-capturing row (Toggle/Picker) under that point:
        //    the 3-player rules form froze at the same spot for 20 straight
        //    drags. Varying the start x across iterations breaks the stall,
        //    because a capturing row cannot cover every start point.
        // Form rows virtualize, so a button below the fold is absent from
        // the hierarchy until it is scrolled into view — hence the
        // generous iteration budget (the 3P form needs ~16 drags).
        var attempt = 0
        for _ in 0..<40 where !element.isHittable {
            attempt += 1
            if app.buttons["Not Now"].exists { app.buttons["Not Now"].tap(); Thread.sleep(forTimeInterval: 1) }
            else if app.keyboards.firstMatch.exists {
                let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.46))
                let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.23))
                start.press(forDuration: 0.1, thenDragTo: end)
            } else if attempt % 4 == 0 {
                app.swipeUp()
            } else {
                let x: CGFloat = [0.5, 0.25, 0.75][attempt % 3]
                let start = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.46))
                let end = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.23))
                start.press(forDuration: 0.1, thenDragTo: end)
            }
        }
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
        // The Save Password prompt can appear seconds after sign-in, mid-scroll,
        // where it swallows gestures and makes lobby rows unwittable. Poll for it
        // instead of checking once: dismiss whenever it shows up, until it is gone.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<8 {
            if app.buttons["Not Now"].exists { app.buttons["Not Now"].tap() }
            else if springboard.buttons["Not Now"].exists { springboard.buttons["Not Now"].tap() }
            else { break }
            Thread.sleep(forTimeInterval: 1)
        }
    }


    private func installPromptMonitor() {
        addUIInterruptionMonitor(withDescription: "System save-password prompt") { element in
            let notNow = element.buttons["Not Now"]
            if notNow.exists { notNow.tap(); return true }
            return false
        }
    }

    // iosfix6 repro (item 3): preset chips in the local wizard must fill the
    // numeric field. Run against the baseline first: a dead tap fails here.
    func testLocalPresetChipsFillFields() {
        let app = launch(["-UITestSeed"])
        if app.tabBars.buttons["本地"].waitForExistence(timeout: 3) {
            tab("本地", in: app)
        } else {
            tab("本地牌桌", in: app)
        }
        XCTAssertTrue(app.buttons["离线开桌"].waitForExistence(timeout: timeout))
        tap(app.buttons["离线开桌"])
        XCTAssertTrue(app.buttons["local.template.house_4p"].waitForExistence(timeout: timeout))
        tap(app.buttons["local.template.house_4p"])
        tap(app.buttons["local.wizard.nextRules"])
        XCTAssertTrue(app.staticTexts["起点与成绩"].waitForExistence(timeout: timeout))
        let startField = app.textFields.element(boundBy: 0)
        XCTAssertTrue(startField.waitForExistence(timeout: timeout))
        XCTAssertEqual(startField.value as? String, "25000", "House 4P template must start at 25000")
        // Identifiers pin each chip (label queries once resolved the 30000
        // chip to the right element yet still filled 35000 — the Form-row
        // collapse — so labels alone cannot guard this regression).
        scrollTo(app.buttons["local.wizard.preset.startingPoints.30000"], in: app)
        tap(app.buttons["local.wizard.preset.startingPoints.30000"])
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(startField.value as? String, "30000", "Tapping the 30000 chip did not fill the starting-points field")
        // Second path: numberPad open, then dismiss via the keyboard
        // toolbar's 完成 (iosfix6 item 4), then tap a chip.
        startField.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        // Item 4 proof: the numberPad is up AND the toolbar's 完成 control
        // is on screen at the same time.
        capture("fix6-keypad-toolbar", in: app)
        // The keyboard toolbar's input-accessory button is exposed at app
        // level, not under the keyboards element (verified by tree dump).
        let doneButton = app.buttons["完成"].firstMatch
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5), "Keyboard toolbar 完成 button missing")
        doneButton.tap()
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(app.keyboards.firstMatch.exists, "完成 did not dismiss the keyboard")
        tap(app.buttons["local.wizard.preset.startingPoints.35000"])
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(startField.value as? String, "35000", "Tapping a chip after dismissing the keyboard did not fill the field")
        // Third path: tapping back down must also dispatch per-chip.
        tap(app.buttons["local.wizard.preset.startingPoints.25000"])
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(startField.value as? String, "25000", "Tapping the 25000 chip did not restore the field")
        capture("tour-local-preset-chip", in: app)
    }


    // iosfix6 item 1 (local picker): tapping a template must mark it
    // selected — checkmark + 已选 + gold tint — in the same row.
    func testLocalPickerShowsSelection() {
        let app = launch(["-UITestSeed"])
        if app.tabBars.buttons["本地"].waitForExistence(timeout: 3) {
            tab("本地", in: app)
        } else {
            tab("本地牌桌", in: app)
        }
        XCTAssertTrue(app.buttons["离线开桌"].waitForExistence(timeout: timeout))
        tap(app.buttons["离线开桌"])
        XCTAssertTrue(app.buttons["local.template.house_4p"].waitForExistence(timeout: timeout))
        tap(app.buttons["local.template.house_4p"])
        XCTAssertTrue(app.staticTexts["已选"].waitForExistence(timeout: timeout),
                      "Selected template row must show 已选")
        XCTAssertTrue(app.buttons["local.wizard.nextRules"].isEnabled,
                      "下一步 must enable once a template is selected")
        capture("fix6-picker-selected", in: app)
    }

    // iosfix6 item 5 (local rows): swipe-left reveals 删除, the two-step
    // confirm deletes, and the row is gone from the list afterwards.
    func testLocalSwipeDelete() {
        let app = launch(["-UITestSeed"])
        if app.tabBars.buttons["本地"].waitForExistence(timeout: 3) {
            tab("本地", in: app)
        } else {
            tab("本地牌桌", in: app)
        }
        XCTAssertTrue(app.buttons["离线开桌"].waitForExistence(timeout: timeout))
        func createTable(template: String) {
            tap(app.buttons["离线开桌"])
            XCTAssertTrue(app.buttons[template].waitForExistence(timeout: timeout))
            tap(app.buttons[template])
            tap(app.buttons["local.wizard.nextRules"])
            XCTAssertTrue(app.staticTexts["起点与成绩"].waitForExistence(timeout: timeout))
            scrollToAndTap(app.buttons["local.wizard.nextNames"], in: app)
            XCTAssertTrue(app.textFields["牌桌名称"].waitForExistence(timeout: timeout))
            tap(app.buttons["local.wizard.create"])
            XCTAssertTrue(app.staticTexts["座位与点数"].waitForExistence(timeout: 30))
            returnToLocalLobby(in: app)
        }
        createTable(template: "local.template.house_4p")
        createTable(template: "local.template.house_3p")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "四麻家规")).firstMatch.waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "三麻家规")).firstMatch.waitForExistence(timeout: timeout))
        let fourRow = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "四麻家规")).firstMatch
        fourRow.swipeLeft()
        let deleteButton = app.buttons["删除"].firstMatch
        XCTAssertTrue(deleteButton.waitForExistence(timeout: timeout), "Swipe-left must reveal 删除")
        capture("fix6-local-swipe", in: app)
        deleteButton.tap()
        XCTAssertTrue(app.buttons["继续确认"].waitForExistence(timeout: timeout))
        capture("fix6-local-delete-dialog", in: app)
        tap(app.buttons["继续确认"])
        XCTAssertTrue(app.buttons["不可恢复地删除"].waitForExistence(timeout: timeout))
        tap(app.buttons["不可恢复地删除"])
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "四麻家规")).firstMatch.exists,
                       "Deleted local table must leave the list")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "三麻家规")).firstMatch.exists,
                      "Other local tables must survive the delete")
        capture("fix6-local-after-delete", in: app)
    }

    // iosfix6 item 5 (online rows, disposable backend only): swipe-left on
    // a preparing owner row, confirm 删除, and the row leaves the list.
    // Runs ONLY against a disposable API (UITEST_DISPOSABLE=1) with two
    // seeded preparing matches: this test deletes one, the swipe-dialog
    // test below cancels on the other.
    func testDisposableOnlineDelete() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["UITEST_DISPOSABLE"] == "1", "Requires disposable API (UITEST_DISPOSABLE=1)")
        let email = environment["UITEST_EMAIL"] ?? ""
        let password = environment["UITEST_PASSWORD"] ?? ""
        try XCTSkipUnless(!email.isEmpty && !password.isEmpty, "Set UITEST_EMAIL and UITEST_PASSWORD for disposable online test")
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
        XCTAssertTrue(app.buttons["开桌 ↗"].waitForExistence(timeout: timeout), "Disposable account did not enter the signed-in lobby")
        dismissPasswordPromptIfPresent(in: app)
        let rows = app.buttons.matching(NSPredicate(format: "identifier == %@", "online.match.active"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: timeout), "Lobby matches did not load")
        XCTAssertEqual(rows.count, 2, "Disposable backend must seed two preparing matches")
        let row = rows.firstMatch
        scrollTo(row, in: app)
        Thread.sleep(forTimeInterval: 1)
        row.swipeLeft()
        if !app.buttons["删除"].firstMatch.waitForExistence(timeout: 5) {
            // A swipe issued while the list is still settling can miss the
            // row (seen once: Invalid frame dimension warning, no action
            // revealed). One retry on the settled row is enough.
            row.swipeLeft()
        }
        let deleteButton = app.buttons["删除"].firstMatch
        XCTAssertTrue(deleteButton.waitForExistence(timeout: timeout), "Swipe-left must reveal 删除 on an online row")
        capture("fix6-online-swipe", in: app)
        deleteButton.tap()
        XCTAssertTrue(app.alerts["删除牌桌？"].waitForExistence(timeout: timeout),
                      "Preparing owner row must offer real DELETE, not hide")
        capture("fix6-online-delete-dialog", in: app)
        tap(app.alerts["删除牌桌？"].buttons["删除"])
        Thread.sleep(forTimeInterval: 2)
        XCTAssertEqual(rows.count, 1, "Deleted online match must leave the list")
        XCTAssertTrue(rows.firstMatch.exists, "The other seeded match must survive")
        capture("fix6-online-after-delete", in: app)
    }

    // iosfix6 item 5 (online rows): swipe-left reveals 删除 and the Chinese
    // confirm dialog. The dialog is cancelled here on purpose: deleting a
    // shared seeded fixture would break the seeded table tour that runs
    // after this test in the same backend.
    func testSeededOnlineSwipeDialog() throws {
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
        XCTAssertTrue(app.buttons["online.match.active"].firstMatch.waitForExistence(timeout: timeout), "Lobby matches did not load")
        let row = app.buttons["online.match.active"].firstMatch
        scrollTo(row, in: app)
        Thread.sleep(forTimeInterval: 1)
        row.swipeLeft()
        if !app.buttons["删除"].firstMatch.waitForExistence(timeout: 5) {
            row.swipeLeft()
        }
        let deleteButton = app.buttons["删除"].firstMatch
        XCTAssertTrue(deleteButton.waitForExistence(timeout: timeout), "Swipe-left must reveal 删除 on an online row")
        capture("fix6-online-swipe", in: app)
        deleteButton.tap()
        XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: timeout), "Online delete must ask in Chinese before acting")
        capture("fix6-online-delete-dialog", in: app)
        tap(app.buttons["取消"])
        XCTAssertTrue(app.buttons["online.match.active"].firstMatch.exists, "Cancelling must leave the row in place")
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
        XCTAssertTrue(app.buttons["online.match.active"].firstMatch.waitForExistence(timeout: timeout), "Lobby matches did not load")
        scrollTo(app.buttons["online.match.active"].firstMatch, in: app)
        capture("tour-online-02-lobby", in: app)

        if !app.buttons["online.wizard.open"].isHittable { app.swipeDown() }
        tap(app.buttons["online.wizard.open"])
        for _ in 0..<3 where !app.staticTexts["选择系统规则模板"].exists {
            dismissPasswordPromptIfPresent(in: app)
            if app.buttons["online.wizard.open"].isHittable { tap(app.buttons["online.wizard.open"]) }
            else { break }
            Thread.sleep(forTimeInterval: 2)
        }
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

        // The lobby's second primary action opens room-code entry and QR scan
        // without leaving the lobby tab.
        tap(app.buttons["online.join.open"])
        XCTAssertTrue(app.textFields["checkIn.roomCode"].waitForExistence(timeout: timeout),
                      "Lobby join entry did not present the check-in flow")
        capture("tour-online-09-join", in: app)
        // A code alone may point to an owner, full, or already-started room.
        // Only a fixture explicitly reserved for this guest's undrawn room
        // can exercise joining without assuming the backend's state.
        if environment["UITEST_JOIN_GUEST_READY"] == "1" {
            let joinCode = try XCTUnwrap(environment["UITEST_JOINCODE"].flatMap { $0.isEmpty ? nil : $0 },
                                         "Guest-ready fixture requires UITEST_JOINCODE")
            let codeField = app.textFields["checkIn.roomCode"]
            codeField.tap()
            // Sheet-hosted Form fields can drop the first responder between
            // the tap and an element-scoped typeText; type at the app level
            // once the tap has had a moment to settle.
            Thread.sleep(forTimeInterval: 1)
            if !app.keyboards.firstMatch.exists {
                codeField.tap()
                Thread.sleep(forTimeInterval: 1)
            }
            app.typeText(joinCode)
            app.swipeUp()
            Thread.sleep(forTimeInterval: 1)
            tap(app.buttons["checkIn.redeemCode"])
            let join = app.buttons["checkIn.join"]
            for _ in 0..<8 where !join.exists {
                Thread.sleep(forTimeInterval: 2)
                app.swipeUp()
            }
            XCTAssertTrue(join.exists, "Guest-ready room code did not reach the join action")
            let count = app.staticTexts.matching(
                NSPredicate(format: "label MATCHES %@", "成员 [0-9]+/[0-9]+")).firstMatch
            if !count.exists { app.swipeDown() }
            XCTAssertTrue(count.waitForExistence(timeout: timeout), "Guest-ready room did not show its member count")
            let parts = count.label.dropFirst("成员 ".count).split(separator: "/")
            let joinedBefore = try XCTUnwrap(Int(parts.first ?? ""))
            let capacity = try XCTUnwrap(Int(parts.last ?? ""))
            XCTAssertGreaterThan(joinedBefore, 0)
            XCTAssertLessThan(joinedBefore, capacity, "Guest-ready room must have a free membership slot")
            XCTAssertTrue(join.isEnabled, "Guest-ready room must allow this account to join")
            for _ in 0..<3 {
                if app.staticTexts["已加入牌桌，等待房主抽风定座"].exists { break }
                if join.exists { scrollToAndTap(join, in: app) }
                Thread.sleep(forTimeInterval: 5)
            }
            let waiting = app.staticTexts["已加入牌桌，等待房主抽风定座"]
            XCTAssertTrue(waiting.waitForExistence(timeout: timeout),
                          "Joining the room did not reach the waiting state")
            let updatedCount = app.staticTexts["成员 \(joinedBefore + 1)/\(capacity)"]
            if !updatedCount.exists { app.swipeDown() }
            XCTAssertTrue(updatedCount.waitForExistence(timeout: timeout),
                          "Room member count did not include the new guest")
            capture("tour-online-10-waiting", in: app)
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
        scrollToAndTap(app.buttons["online.match.active"].firstMatch, in: app)
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
            for _ in 0..<12 where !app.buttons["online.table.resultEntry"].exists {
                Thread.sleep(forTimeInterval: 5)
                app.swipeUp()
            }
            XCTAssertTrue(app.buttons["online.table.resultEntry"].waitForExistence(timeout: timeout))
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
        // The sheet can be swallowed by a live re-render right after opening;
        // only scroll when the preview is still there (scrollTo throws on a
        // vanished element). The form-opened assertion above still stands.
        if app.buttons["online.result.preview"].exists {
            scrollTo(app.buttons["online.result.preview"], in: app)
        }
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
        scrollTo(app.buttons["online.match.active"].firstMatch, in: app)
        capture("tour-online-07-history", in: app)
        tab("我的", in: app)
        XCTAssertTrue(app.staticTexts["我的账号"].waitForExistence(timeout: timeout))
        capture("tour-online-08-profile", in: app)
    }
}
