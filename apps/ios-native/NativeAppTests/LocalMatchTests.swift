import XCTest
import SQLite3
@testable import IchihimeNative

@MainActor final class LocalMatchTests: XCTestCase {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("local-matches-\(UUID().uuidString).sqlite3")
    }
    private func create(_ store: LocalMatchStore, key: String = "house_4p", dealer: Int = 0) throws -> LocalMatch {
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == key })
        let rules = try LocalMatchStore.templateRules(key)
        let count = key.contains("3p") ? 3 : 4
        return try store.create(template: template, rules: rules, name: "离线测试", names: (0..<count).map { "座位 \($0)" }, dealer: dealer)
    }
    private func input(_ kind: String, winner: Int = 1, discard: Int = 2, tenpai: [Bool] = []) -> [String: JSONValue] {
        switch kind {
        case "ryuukyoku": return ["kind": .string(kind), "winners": .array([]), "tenpai": .array(tenpai.map(JSONValue.bool))]
        default:
            var winnerInput: [String: JSONValue] = ["seatNo": .number(Double(winner)), "han": .number(2), "fu": .number(30)]
            if kind == "ron" { winnerInput["dealInSeatNo"] = .number(Double(discard)) }
            return ["kind": .string(kind), "winners": .array([.object(winnerInput)])]
        }
    }
    private func match(_ store: LocalMatchStore, _ id: String) throws -> LocalMatch {
        try XCTUnwrap(store.matches.first { $0.id == id })
    }
    private func settle(_ store: LocalMatchStore, _ id: String, _ input: [String: JSONValue]) throws {
        let hand = try XCTUnwrap(match(store, id).currentHand)
        let expected = try store.preview(id, input: input)
        try store.settle(id, handID: hand.handId, revision: hand.markRevision, input: input)
        let actual = try XCTUnwrap(match(store, id).results.last)
        XCTAssertEqual(actual.input, input)
        XCTAssertEqual(actual.output, expected)
        let perSeat = try XCTUnwrap(actual.output["perSeat"]?.arrayValue)
        let netPoints = try perSeat.map { row -> Int in
            guard case .number(let value)? = row.object?["netPoints"] else { throw LocalFailure(message: "缺少结算净额") }
            return try XCTUnwrap(Int(exactly: value))
        }
        guard case .number(let nextPool)? = actual.output["nextHand"]?.object?["riichiPool"] else {
            throw LocalFailure(message: "缺少下一局供托")
        }
        XCTAssertEqual(netPoints.reduce(0, +) + Int(nextPool) - hand.riichiPool, 0,
                       "每局净额＋供托变化必须守恒")
        XCTAssertEqual(try match(store, id).nextHand?.riichiPool, actual.output["nextHand"]?.object?["riichiPool"].flatMap {
            if case .number(let value) = $0 { return Int(value) }; return nil
        })
    }
    func testFourBundledTemplatesOpenImmediatelyOfflineWithNamesAndDealer() throws {
        let store = LocalMatchStore(location: location())
        XCTAssertNil(store.failure)
        for template in LocalTemplate.all {
            let created = try create(store, key: template.id, dealer: 2)
            XCTAssertEqual(created.currentHand?.roundWind, "E")
            XCTAssertEqual(created.currentHand?.roundNumber, 1)
            XCTAssertEqual(created.currentHand?.dealerSeatNo, 2)
            XCTAssertEqual(created.startingDealerSeatNo, 2)
            XCTAssertEqual(created.rulesHash.count, 64)
            XCTAssertNotEqual(created.rulesHash, "local-only")
            XCTAssertEqual(created.seats[1].displayName, "座位 1")
            XCTAssertEqual(created.results.count, 0)
            XCTAssertEqual(created.engineVersion, EngineBridgeCheck.version)
            XCTAssertEqual(created.rules["templateKey"]?.string, template.id == "reference_4p_competition" ? "wrc_4p_ref_v1" :
                template.id == "reference_3p_common" ? "common_3p_ref_v1" : "\(template.id)_v1")
        }
    }
    func testSeatNameFortyCharacterBoundaryAndEditableLocalIdentity() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == "house_4p" })
        let rules = try LocalMatchStore.templateRules(template.id)
        let forty = String(repeating: "甲", count: 40)
        let id = try store.create(template: template, rules: rules, name: "姓名上限",
                                  names: [forty, "", "丙", "丁"], dealer: 0).id
        XCTAssertEqual(try match(store, id).seats[0].displayName, forty)
        XCTAssertEqual(try match(store, id).seats[1].displayName, "玩家 2")
        XCTAssertThrowsError(try store.create(template: template, rules: rules, name: "超限",
                                              names: [forty + "甲", "乙", "丙", "丁"], dealer: 0))
        try store.rename(id, seat: 1, name: forty)
        XCTAssertEqual(try match(LocalMatchStore(location: url), id).seats[1].displayName, forty)
        XCTAssertThrowsError(try store.rename(id, seat: 1, name: forty + "甲"))
    }
    func testMultiHandTrajectoryPoolAndSavedOutputsSurviveNewStore() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let id = try create(store).id
        try store.mark(id, seat: 0)
        XCTAssertEqual(try match(store, id).currentHand?.seats[0].declares, 1)
        try settle(store, id, input("ron"))
        XCTAssertEqual(try match(store, id).points, [24_000, 28_000, 23_000, 25_000])
        XCTAssertEqual(try match(store, id).nextHand?.roundNumber, 2)
        XCTAssertEqual(try match(store, id).nextHand?.riichiPool, 0)
        let historical = try XCTUnwrap(match(store, id).results.first)
        try store.openHand(id)
        try settle(store, id, input("tsumo", winner: 2))
        XCTAssertEqual(try match(store, id).points, [23_500, 27_000, 25_000, 24_500])
        try store.openHand(id)
        try store.mark(id, seat: 0)
        try settle(store, id, input("ryuukyoku", tenpai: [true, false, false, false]))
        XCTAssertEqual(try match(store, id).points, [25_500, 26_000, 24_000, 23_500])
        XCTAssertEqual(try match(store, id).nextHand?.riichiPool, 1_000)
        XCTAssertEqual(try match(store, id).nextHand?.honba, 1)
        try store.openHand(id)
        XCTAssertEqual(try match(store, id).currentHand?.riichiPool, 1_000)
        try settle(store, id, input("ron", winner: 0, discard: 1))
        XCTAssertEqual(try match(store, id).points, [28_800, 23_700, 24_000, 23_500])
        XCTAssertEqual(try match(store, id).nextHand?.riichiPool, 0)
        XCTAssertEqual(try match(store, id).results.count, 4)
        XCTAssertEqual(try match(store, id).results.first?.output, historical.output)
        let reopened = LocalMatchStore(location: url)
        XCTAssertNil(reopened.failure)
        XCTAssertEqual(try match(reopened, id).points, [28_800, 23_700, 24_000, 23_500])
        XCTAssertEqual(try match(reopened, id).results.first?.output, historical.output)
        try reopened.openHand(id)
        XCTAssertEqual(try match(reopened, id).currentHand?.seats[0].declares, 0)
        XCTAssertEqual(try match(reopened, id).currentHand?.roundWind, "S")
    }
    func testRiichiBudgetPersistsReloadAndCannotDoubleSettle() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let id = try create(store).id
        try store.mark(id, seat: 0)
        try store.mark(id, seat: 0)
        try store.mark(id, seat: 0)
        let reopened = LocalMatchStore(location: url)
        let hand = try XCTUnwrap(match(reopened, id).currentHand)
        XCTAssertEqual(hand.seats[0].declares, 2)
        XCTAssertEqual(hand.seats[0].cancels, 1)
        XCTAssertTrue(hand.seats[0].isRiichi)
        XCTAssertThrowsError(try reopened.mark(id, seat: 0))
        let ron = input("ron")
        try reopened.settle(id, handID: hand.handId, revision: hand.markRevision, input: ron)
        let saved = try match(reopened, id)
        XCTAssertThrowsError(try reopened.settle(id, handID: hand.handId, revision: hand.markRevision, input: ron))
        XCTAssertEqual(try match(reopened, id).results.count, 1)
        XCTAssertEqual(try match(reopened, id).points, saved.points)
        XCTAssertEqual(try match(reopened, id).results.first?.output, saved.results.first?.output)
    }
    func testSettlementJournalFailureRollsBackPointsAndHistory() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let id = try create(store).id
        let before = try match(store, id)
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE, nil), SQLITE_OK)
        defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db, "CREATE TRIGGER reject_settlement BEFORE INSERT ON settlement_journal BEGIN SELECT RAISE(ABORT, 'disk write refused'); END", nil, nil, nil), SQLITE_OK)
        let handID = try XCTUnwrap(before.currentHand).handId
        XCTAssertThrowsError(try store.settle(id, handID: handID, revision: 0, input: input("ron")))
        let reopened = LocalMatchStore(location: url)
        XCTAssertEqual(try match(reopened, id).points, before.points)
        XCTAssertEqual(try match(reopened, id).currentHand, before.currentHand)
        XCTAssertEqual(try match(reopened, id).results.count, 0)
        XCTAssertEqual(try match(reopened, id).nextHand, before.nextHand)
    }
    func testCorruptAndUnknownVersionAreNotOverwritten() throws {
        let corrupt = location()
        let bytes = Data("not a database".utf8)
        try bytes.write(to: corrupt)
        XCTAssertNotNil(LocalMatchStore(location: corrupt).failure)
        XCTAssertEqual(try Data(contentsOf: corrupt), bytes)
        let unknown = location()
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(unknown.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, "PRAGMA user_version = 99", nil, nil, nil), SQLITE_OK)
        XCTAssertEqual(sqlite3_close(db), SQLITE_OK)
        let prior = try Data(contentsOf: unknown)
        XCTAssertNotNil(LocalMatchStore(location: unknown).failure)
        XCTAssertEqual(try Data(contentsOf: unknown), prior)
    }
    private func replacePayload(at url: URL, match: LocalMatch) throws {
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE, nil), SQLITE_OK)
        defer { sqlite3_close(db) }
        var query: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(db, "UPDATE local_matches SET payload = ?", -1, &query, nil), SQLITE_OK)
        let statement = try XCTUnwrap(query)
        defer { sqlite3_finalize(statement) }
        let data = try JSONEncoder().encode(match)
        let step = data.withUnsafeBytes { bytes -> Int32 in
            guard sqlite3_bind_blob(statement, 1, bytes.baseAddress, Int32(bytes.count), nil) == SQLITE_OK else {
                return SQLITE_ERROR
            }
            return sqlite3_step(statement)
        }
        XCTAssertEqual(step, SQLITE_DONE)
    }
    func testDecodableCorruptionPreservesDatabaseAndSurfacesError() throws {
        for corrupted in ["seat_count", "mark_budget"] {
            let url = location()
            let store = LocalMatchStore(location: url)
            var match = try create(store)
            if corrupted == "seat_count" {
                match.seats.removeLast()
            } else {
                var hand = try XCTUnwrap(match.currentHand)
                hand.seats[0].declares = 2
                match.currentHand = hand
            }
            try replacePayload(at: url, match: match)
            let bytes = try Data(contentsOf: url)
            let reopened = LocalMatchStore(location: url)
            XCTAssertNotNil(reopened.failure, "\(corrupted) must be reported without reset")
            XCTAssertTrue(reopened.matches.isEmpty)
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }
    func testFinishedMatchHistoryImmutableAndDeleteWholeTable() throws {
        let store = LocalMatchStore(location: location())
        let id = try create(store).id
        let otherID = try create(store, key: "house_3p").id
        try settle(store, id, input("ron"))
        XCTAssertThrowsError(try store.finish(id)) // target not reached
        let first = try XCTUnwrap(match(store, id).results.first)
        try store.delete(id)
        XCTAssertNil(store.matches.first { $0.id == id })
        XCTAssertNotNil(store.matches.first { $0.id == otherID })
        XCTAssertEqual(try match(store, otherID).currentHand?.roundWind, "E")
        XCTAssertThrowsError(try store.openHand(id))
        XCTAssertNotNil(first.output["perSeat"])
    }
    func testRankedSanmaCannotManuallyAbandonAndPreservesPendingPool() throws {
        let store = LocalMatchStore(location: location())
        let id = try create(store, key: "reference_3p_common").id
        XCTAssertThrowsError(try store.finish(id))
        try store.mark(id, seat: 0)
        try settle(store, id, input("ryuukyoku", tenpai: [true, false, false]))
        XCTAssertEqual(try match(store, id).nextHand?.riichiPool, 1_000)
        try store.openHand(id)
        XCTAssertThrowsError(try store.finish(id))
        XCTAssertEqual(try match(store, id).currentHand?.riichiPool, 1_000)
    }
    func testPreviewRevisionInvalidatedAndAbandonOnlyDropsOpenHand() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == "house_4p" })
        var rules = try LocalMatchStore.templateRules(template.id)
        rules["targetPoints"] = .number(20_000)
        let id = try store.create(template: template, rules: rules, name: "终局回归",
                                  names: ["东", "南", "西", "北"], dealer: 0).id
        let stale = try XCTUnwrap(match(store, id).currentHand)
        _ = try store.preview(id, input: input("ron"))
        try store.mark(id, seat: 0)
        XCTAssertThrowsError(try store.settle(id, handID: stale.handId, revision: stale.markRevision, input: input("ron")))
        XCTAssertEqual(try match(store, id).points, [25_000, 25_000, 25_000, 25_000])
        XCTAssertTrue(try match(store, id).results.isEmpty)
        try settle(store, id, input("ryuukyoku", tenpai: [true, false, false, false]))
        let saved = try match(store, id)
        XCTAssertEqual(saved.nextHand?.riichiPool, 1_000)
        try store.openHand(id)
        try store.mark(id, seat: 1)
        try store.finish(id)
        let finished = try match(store, id)
        XCTAssertEqual(finished.status, "finished")
        XCTAssertNil(finished.currentHand)
        XCTAssertEqual(finished.points, saved.points)
        XCTAssertEqual(finished.nextHand, saved.nextHand)
        XCTAssertEqual(finished.results.first?.output, saved.results.first?.output)
        XCTAssertThrowsError(try store.openHand(id))
        try store.confirmTerminal(id)
        XCTAssertTrue(try match(store, id).settlementConfirmed)
        XCTAssertNotNil(try match(store, id).terminal)
        let terminal = try XCTUnwrap(match(store, id).terminal)
        XCTAssertThrowsError(try store.rename(id, seat: 0, name: "篡改历史"))
        XCTAssertThrowsError(try store.confirmTerminal(id))
        let reopened = LocalMatchStore(location: url)
        XCTAssertEqual(try match(reopened, id).terminal, terminal)
        XCTAssertEqual(try match(reopened, id).results.first?.output, saved.results.first?.output)
    }
    func testRankedSanmaAutomaticallyFinishesAtSouthThreeThreshold() throws {
        let store = LocalMatchStore(location: location())
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == "reference_3p_common" })
        var rules = try LocalMatchStore.templateRules(template.id)
        rules["targetPoints"] = .number(35_000)
        let id = try store.create(template: template, rules: rules, name: "三麻自动终局",
                                  names: ["一", "二", "三"], dealer: 0).id
        for index in 0..<6 {
            let hand = try XCTUnwrap(match(store, id).currentHand)
            XCTAssertEqual(hand.roundWind, index < 3 ? "E" : "S")
            XCTAssertEqual(hand.roundNumber, index % 3 + 1)
            try settle(store, id, input("ryuukyoku", tenpai: [false, false, false]))
            if index < 5 {
                XCTAssertEqual(try match(store, id).status, "active")
                try store.openHand(id)
            }
        }
        XCTAssertEqual(try match(store, id).status, "finished")
        XCTAssertNil(try match(store, id).currentHand)
        XCTAssertEqual(try match(store, id).points, [35_000, 35_000, 35_000])
        XCTAssertEqual(try match(store, id).nextHand?.roundWind, "W")
        try store.confirmTerminal(id)
        XCTAssertTrue(try match(store, id).settlementConfirmed)
        XCTAssertEqual(try match(store, id).terminal?["isGameEnd"], .bool(true))
    }
    func testEmptyDatabaseMigratesToExplicitVersionOne() throws {
        let url = location()
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil), SQLITE_OK)
        XCTAssertEqual(sqlite3_close(db), SQLITE_OK)
        let store = LocalMatchStore(location: url)
        XCTAssertNil(store.failure)
        _ = try create(store)
        XCTAssertEqual(sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        defer { sqlite3_close(db) }
        var query: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &query, nil), SQLITE_OK)
        defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
    func testResultDraftRestoresWithoutChangingSettledHistory() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let id = try create(store).id
        let hand = try XCTUnwrap(match(store, id).currentHand)
        var draft = ResultDraft()
        draft.kind = "tsumo"
        draft.winners = [2]
        draft.han[2] = "3"
        draft.fu[2] = "40"
        try store.saveDraft(id, handID: hand.handId, value: draft)
        let reopened = LocalMatchStore(location: url)
        XCTAssertEqual(try match(reopened, id).draft?.handId, hand.handId)
        XCTAssertEqual(try match(reopened, id).draft?.value, draft)
        try settle(reopened, id, input("tsumo", winner: 2))
        XCTAssertNil(try match(reopened, id).draft)
        XCTAssertEqual(try match(reopened, id).results.count, 1)
    }
    func testAdjustedStartingPointsRecomputesReadOnlyOka() throws {
        let store = LocalMatchStore(location: location())
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == "house_4p" })
        var rules = try LocalMatchStore.templateRules(template.id)
        rules["startingPoints"] = .number(30_000)
        let created = try store.create(template: template, rules: rules, name: "调整",
                                       names: ["一", "二", "三", "四"], dealer: 3)
        XCTAssertEqual(created.points, [30_000, 30_000, 30_000, 30_000])
        XCTAssertEqual(created.rules["oka"], .number(0))
        XCTAssertEqual(created.customizedKeys, ["startingPoints"])
        XCTAssertEqual(created.currentHand?.dealerSeatNo, 3)
    }
    func testTerminalUsesPersistedStartingDealerWithoutSettledHands() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let template = try XCTUnwrap(LocalTemplate.all.first { $0.id == "house_4p" })
        var rules = try LocalMatchStore.templateRules(template.id)
        rules["targetPoints"] = .number(20_000)
        let id = try store.create(template: template, rules: rules, name: "起家同点",
                                  names: ["一", "二", "三", "四"], dealer: 3).id
        try store.finish(id)
        let reopened = LocalMatchStore(location: url)
        let current = try match(reopened, id)
        XCTAssertTrue(current.results.isEmpty)
        XCTAssertNil(current.currentHand)
        XCTAssertEqual(current.startingDealerSeatNo, 3)
        let terminal = try reopened.previewTerminal(id)
        guard case .number(let seat)? = terminal["standings"]?.arrayValue?.first?.object?["seatNo"] else {
            return XCTFail("终局缺少首位座位")
        }
        XCTAssertEqual(Int(seat), 3)
        try reopened.confirmTerminal(id)
        XCTAssertEqual(try match(reopened, id).terminal, terminal)
    }
}
