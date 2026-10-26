import XCTest

// 最后一版原生 UI 巡游（全部走 -UITestSeed 内存 stub，不触网；
// 本地模式为真实完整流程；在线屏为 stub 演练，见报告标注）。
// 截图写入 FINAL_SHOT_DIR（兼容旧 FIX8_SHOT_DIR）。

final class ScreenshotTourTests: XCTestCase {
    private let timeout: TimeInterval = 20

    private func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        return app
    }

    private func capture(_ name: String, in app: XCUIApplication) {
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        // 测试进程不继承 shell 环境变量时旧逻辑（仅 env 设置才写盘）
        // 会导致截图一张不落；改为默认写 /tmp/final-shots，env 可覆盖。
        let dir = ProcessInfo.processInfo.environment["FINAL_SHOT_DIR"]
            ?? ProcessInfo.processInfo.environment["FIX8_SHOT_DIR"]
            ?? "/tmp/final-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing UI control: \(element.identifier)", file: file, line: line)
        element.tap()
    }

    private func tab(_ name: String, in app: XCUIApplication) {
        tap(app.tabBars.buttons[name])
    }

    /// List 折叠行不在无障碍树里：向上滑直到元素可点（分享页的
    /// 查看牌桌在 240pt 二维码下方，首屏看不到，必须先滚）。
    /// 注意：对树里还不存在的元素查 isHittable 会直接抛快照错误，
    /// 所以循环里必须先判 exists（不存在时安全返回 false）再判 hittable，
    /// 不能先 waitForExistence（折叠行 20 秒都等不到）。
    private func scrollToAndTap(_ element: XCUIElement, in app: XCUIApplication,
                                file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<30 {
            if element.exists && element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists && element.isHittable, "UI control never became hittable: \(element.identifier)", file: file, line: line)
        element.tap()
    }

    private func back(in app: XCUIApplication) {
        let backButton = app.navigationBars.element.buttons.firstMatch
        if backButton.waitForExistence(timeout: 5) { backButton.tap() }
    }

    private func setField(_ field: XCUIElement, to value: String, in app: XCUIApplication) {
        XCTAssertTrue(field.waitForExistence(timeout: timeout))
        field.tap()
        Thread.sleep(forTimeInterval: 1)
        if let current = field.value as? String, !current.isEmpty, current != value {
            // 实测（iOS 27 模拟器，numbersAndPunctuation 键盘）：
            // typeText 的删除字符与键盘删除键点按均无效（旧值不删、
            // 新值追加成 400300）；双击选中后覆盖、三击全选后覆盖有效。
            // 故改值一律双击选中后输入，校验不符时三击重试一次。
            // 注意：双击只选中一个词，测试用名/数字均为单 token。
            field.tap(withNumberOfTaps: 2, numberOfTouches: 1)
            Thread.sleep(forTimeInterval: 1)
        }
        if !value.isEmpty { field.typeText(value) }
        if !value.isEmpty, let actual = field.value as? String, actual != value {
            field.tap(withNumberOfTaps: 3, numberOfTouches: 1)
            Thread.sleep(forTimeInterval: 1)
            field.typeText(value)
        }
        // numbersAndPunctuation 键盘无回车：点工具栏完成收起键盘。
        if app.keyboards.firstMatch.exists {
            let done = app.buttons["完成"].firstMatch
            if done.exists { done.tap() }
            Thread.sleep(forTimeInterval: 1)
        }
    }

    // 本地真实流程：建桌 → 随机分座 → 终局记分（合计不对 → 合计正确）→ 历史 → 纠正。
    func testLocalFinalFlow() {
        let app = launch(["-UITestSeed"])
        tab("本地", in: app)
        XCTAssertTrue(app.buttons["local.create.open"].waitForExistence(timeout: timeout))
        capture("final-local-lobby", in: app)
        tap(app.buttons["local.create.open"])
        XCTAssertTrue(app.buttons["local.mode.4p"].waitForExistence(timeout: timeout))
        capture("final-local-create", in: app)
        tap(app.buttons["local.mode.4p"])
        let names = ["甲", "乙", "丙", "丁"]
        for (index, name) in names.enumerated() {
            setField(app.textFields["local.name.\(index)"], to: name, in: app)
        }
        tap(app.buttons["local.create.confirm"])
        XCTAssertTrue(app.buttons["local.final.open"].waitForExistence(timeout: timeout), "建桌后应直接进入进行中牌桌")
        capture("final-local-table", in: app)
        tap(app.buttons["local.final.open"])
        XCTAssertTrue(app.textFields["final.score.E"].waitForExistence(timeout: timeout))
        // 合计不对：300×4=1200 ≠ 1000，保存应禁用并中文提示。
        for wind in ["E", "S", "W", "N"] {
            setField(app.textFields["final.score.\(wind)"], to: "300", in: app)
        }
        XCTAssertTrue(app.staticTexts["final.sum"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["final.sum.hint"].waitForExistence(timeout: timeout), "合计不对时应有中文提示")
        XCTAssertFalse(app.buttons["final.save"].isEnabled, "合计不对时保存必须禁用")
        capture("final-local-sum-wrong", in: app)
        // 合计正确：400+300+200+100=1000。
        let correct = ["E": "400", "S": "300", "W": "200", "N": "100"]
        for (wind, value) in correct {
            setField(app.textFields["final.score.\(wind)"], to: value, in: app)
        }
        XCTAssertTrue(app.buttons["final.save"].isEnabled, "合计正确时保存必须可用")
        capture("final-local-sum-ok", in: app)
        tap(app.buttons["final.save"])
        XCTAssertTrue(app.buttons["local.final.open"].waitForExistence(timeout: timeout), "保存成功后回到牌桌")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "第 1 名")).firstMatch.waitForExistence(timeout: timeout))
        capture("final-local-finished", in: app)
        // 历史纠正：座次锁定只改分数，合计仍为 1000。
        tap(app.buttons["local.final.open"])
        XCTAssertTrue(app.textFields["final.score.E"].waitForExistence(timeout: timeout))
        setField(app.textFields["final.score.E"], to: "350", in: app)
        setField(app.textFields["final.score.W"], to: "250", in: app)
        XCTAssertTrue(app.buttons["final.save"].isEnabled)
        capture("final-local-correct", in: app)
        tap(app.buttons["final.save"])
        XCTAssertTrue(app.buttons["local.final.open"].waitForExistence(timeout: timeout))
        back(in: app)
        XCTAssertTrue(app.buttons["local.create.open"].waitForExistence(timeout: timeout), "返回本地列表后应看到开桌入口")
        capture("final-local-history", in: app)
    }

    // 本地滑动删除保留：右侧金色整高删除块 + 两步中文确认，取消则保留。
    func testLocalSwipeDelete() {
        let app = launch(["-UITestSeed"])
        tab("本地", in: app)
        tap(app.buttons["local.create.open"])
        tap(app.buttons["local.mode.4p"])
        for index in 0..<4 {
            setField(app.textFields["local.name.\(index)"], to: "玩家\(index + 1)", in: app)
        }
        tap(app.buttons["local.create.confirm"])
        XCTAssertTrue(app.buttons["local.final.open"].waitForExistence(timeout: timeout))
        back(in: app)
        XCTAssertTrue(app.buttons["local.create.open"].waitForExistence(timeout: timeout))
        let row = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "四麻")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: timeout))
        let frame = row.frame
        let drag = {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
                .withOffset(CGVector(dx: app.frame.width - 30, dy: frame.midY))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
                .withOffset(CGVector(dx: 30, dy: frame.midY))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        drag()
        Thread.sleep(forTimeInterval: 1)
        var deleteButton = app.buttons.matching(NSPredicate(format: "label == %@", "删除")).allElementsBoundByIndex.first(where: { $0.isHittable }) ?? app.buttons["删除"].firstMatch
        if !deleteButton.isHittable {
            drag()
            Thread.sleep(forTimeInterval: 1)
            deleteButton = app.buttons.matching(NSPredicate(format: "label == %@", "删除")).allElementsBoundByIndex.first(where: { $0.isHittable }) ?? app.buttons["删除"].firstMatch
        }
        XCTAssertTrue(deleteButton.isHittable, "左滑必须露出可点的删除块")
        capture("final-local-swipe", in: app)
        deleteButton.tap()
        XCTAssertTrue(app.buttons["继续确认"].waitForExistence(timeout: timeout))
        capture("final-local-delete-dialog", in: app)
        tap(app.buttons["保留牌桌"])
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "四麻")).firstMatch.exists, "取消删除必须保留牌桌")
    }

    // 在线 stub 演练：开桌 → 分享页 → 进行中桌 → 终局记分（不对/对）→ 历史纠正 → 管理。
    func testStubOnlineFlow() {
        let app = launch(["-UITestSeed", "-UITestAdmin"])
        XCTAssertTrue(app.buttons["online.create.open"].waitForExistence(timeout: timeout), "stub 大厅应直接可用")
        capture("final-online-lobby", in: app)
        tap(app.buttons["online.create.open"])
        XCTAssertTrue(app.buttons["online.create.mode.4p"].waitForExistence(timeout: timeout))
        tap(app.buttons["online.create.mode.4p"])
        tap(app.buttons["online.create.confirm"])
        XCTAssertTrue(app.staticTexts["share.joinCode"].waitForExistence(timeout: timeout), "开桌后应进入分享页并显示房间码")
        capture("final-online-share", in: app)
        scrollToAndTap(app.buttons["share.viewTable"], in: app)
        XCTAssertTrue(app.staticTexts["table.joinCode"].waitForExistence(timeout: timeout), "分享页应能进入等待中的牌桌")
        capture("final-online-table-waiting", in: app)
        back(in: app)
        XCTAssertTrue(app.buttons["online.create.open"].waitForExistence(timeout: timeout))
        scrollToAndTap(app.buttons["online.match.in_progress"].firstMatch, in: app)
        XCTAssertTrue(app.buttons["online.final.open"].waitForExistence(timeout: timeout), "进行中桌（我是房主）应有终局记分入口")
        capture("final-online-table", in: app)
        scrollToAndTap(app.buttons["online.final.open"], in: app)
        XCTAssertTrue(app.textFields["final.score.E"].waitForExistence(timeout: timeout))
        for wind in ["E", "S", "W", "N"] {
            setField(app.textFields["final.score.\(wind)"], to: "300", in: app)
        }
        XCTAssertFalse(app.buttons["final.save"].isEnabled, "在线合计不对时保存必须禁用")
        capture("final-online-sum-wrong", in: app)
        let correct = ["E": "400", "S": "300", "W": "200", "N": "100"]
        for (wind, value) in correct {
            setField(app.textFields["final.score.\(wind)"], to: value, in: app)
        }
        XCTAssertTrue(app.buttons["final.save"].isEnabled)
        capture("final-online-sum-ok", in: app)
        tap(app.buttons["final.save"])
        XCTAssertTrue(app.buttons["online.final.correct"].waitForExistence(timeout: timeout), "保存成功后已结束桌应有纠正入口")
        capture("final-online-finished", in: app)
        scrollToAndTap(app.buttons["online.final.correct"], in: app)
        XCTAssertTrue(app.textFields["final.score.E"].waitForExistence(timeout: timeout))
        capture("final-online-correct", in: app)
        tap(app.buttons["关闭"].firstMatch)
        back(in: app)
        XCTAssertTrue(app.buttons["online.create.open"].waitForExistence(timeout: timeout))
        tab("我的", in: app)
        XCTAssertTrue(app.buttons["profile.admin.open"].waitForExistence(timeout: timeout), "stub 管理员应在我的页看到管理入口")
        tap(app.buttons["profile.admin.open"])
        XCTAssertTrue(app.staticTexts["玩家管理"].waitForExistence(timeout: timeout))
        capture("final-online-admin", in: app)
        tap(app.buttons["关闭"].firstMatch)
    }

    // 在线 stub 演练：输房间码直接进桌（成员），不经过签到页。
    func testStubJoinByCode() {
        let app = launch(["-UITestSeed"])
        tap(app.buttons["online.join.open"])
        XCTAssertTrue(app.textFields["join.roomCode"].waitForExistence(timeout: timeout))
        capture("final-online-join", in: app)
        setField(app.textFields["join.roomCode"], to: "ABCD23", in: app)
        tap(app.buttons["join.submitCode"])
        XCTAssertTrue(app.staticTexts["table.joinCode"].waitForExistence(timeout: timeout), "输码加入后应直接进桌并显示房间码")
        capture("final-online-joined", in: app)
    }
}


