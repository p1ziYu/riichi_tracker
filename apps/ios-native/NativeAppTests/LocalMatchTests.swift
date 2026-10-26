import XCTest
@testable import IchihimeNative

// 最后一版原生本地测试：建桌随机分座、合计校验、终局保存、纠正座次锁定、
// 删除与 JSON 持久化（不再用 SQLite/引擎）。

@MainActor final class LocalMatchTests: XCTestCase {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("local-final-\(UUID().uuidString).json")
    }

    func testCreateShufflesWindsAndCoversAllSeats() throws {
        let store = LocalMatchStore(location: location())
        XCTAssertNil(store.failure)
        let match = try store.create(names: ["阿东", "阿南", "阿西", "阿北"], mode: .four)
        XCTAssertEqual(match.status, "in_progress")
        XCTAssertEqual(Set(match.seats.map { $0.wind }), Set(["E", "S", "W", "N"]))
        XCTAssertEqual(Set(match.seats.map { $0.name }), Set(["阿东", "阿南", "阿西", "阿北"]))
        let three = try store.create(names: ["甲", "乙", "丙"], mode: .three)
        XCTAssertEqual(Set(three.seats.map { $0.wind }), Set(["E", "S", "W"]))
    }

    func testCreateRejectsEmptyNameAndWrongCount() {
        let store = LocalMatchStore(location: location())
        XCTAssertThrowsError(try store.create(names: ["甲", "", "丙", "丁"], mode: .four))
        XCTAssertThrowsError(try store.create(names: ["甲", "乙"], mode: .four))
    }

    func testSaveRejectsWrongSumAndAcceptsCorrectSumWithRanks() throws {
        let store = LocalMatchStore(location: location())
        let match = try store.create(names: ["甲", "乙", "丙", "丁"], mode: .four)
        let byWind = Dictionary(uniqueKeysWithValues: match.seats.map { ($0.wind, $0.name) })
        _ = byWind
        XCTAssertThrowsError(try store.saveFinalScores(
            id: match.id,
            scores: [FinalScoreEntry(wind: "E", score: 400), FinalScoreEntry(wind: "S", score: 300),
                     FinalScoreEntry(wind: "W", score: 200), FinalScoreEntry(wind: "N", score: 101)],
            correction: false))
        let saved = try store.saveFinalScores(
            id: match.id,
            scores: [FinalScoreEntry(wind: "E", score: 100), FinalScoreEntry(wind: "S", score: 400),
                     FinalScoreEntry(wind: "W", score: 200), FinalScoreEntry(wind: "N", score: 300)],
            correction: false)
        XCTAssertEqual(saved.status, "finished")
        XCTAssertEqual(saved.finalScores?.first { $0.wind == "S" }?.rank, 1)
        XCTAssertEqual(saved.finalScores?.first { $0.wind == "E" }?.rank, 4)
    }

    func testCorrectionLocksSeatsAndPersistsAcrossReload() throws {
        let url = location()
        let store = LocalMatchStore(location: url)
        let match = try store.create(names: ["甲", "乙", "丙"], mode: .three)
        let seatsBefore = match.seats
        _ = try store.saveFinalScores(
            id: match.id,
            scores: [FinalScoreEntry(wind: "E", score: 500), FinalScoreEntry(wind: "S", score: 300),
                     FinalScoreEntry(wind: "W", score: 250)],
            correction: false)
        let corrected = try store.saveFinalScores(
            id: match.id,
            scores: [FinalScoreEntry(wind: "E", score: 450), FinalScoreEntry(wind: "S", score: 350),
                     FinalScoreEntry(wind: "W", score: 250)],
            correction: true)
        XCTAssertEqual(corrected.seats, seatsBefore)
        XCTAssertNotNil(corrected.correctedAt)
        let reloaded = LocalMatchStore(location: url)
        let found = try XCTUnwrap(reloaded.match(match.id))
        XCTAssertEqual(found.finalScores?.first { $0.wind == "E" }?.score, 450)
        XCTAssertEqual(found.seats, seatsBefore)
        try reloaded.delete(match.id)
        XCTAssertNil(reloaded.match(match.id))
    }

    func testNegativeAndZeroScoresAllowedInThreePlayer() throws {
        let store = LocalMatchStore(location: location())
        let match = try store.create(names: ["甲", "乙", "丙"], mode: .three)
        let saved = try store.saveFinalScores(
            id: match.id,
            scores: [FinalScoreEntry(wind: "E", score: -50), FinalScoreEntry(wind: "S", score: 0),
                     FinalScoreEntry(wind: "W", score: 1100)],
            correction: false)
        XCTAssertEqual(saved.status, "finished")
    }
}
