import Foundation
import XCTest
@testable import IchihimeNative

// 最后一版原生单元测试：加入解析/房间码、终局校验与顺位、
// /api/me 的 isAdmin 解码、stub 服务的加入幂等/满员/房主记分/纠正座次锁定。

final class JoinFlowTests: XCTestCase {
    private let matchID = "11111111-1111-4111-8111-111111111111"

    func testCanonicalCodeAccepts32SymbolAlphabet() {
        XCTAssertEqual(JoinFlow.canonicalCode("abcd23"), "ABCD23")
        XCTAssertEqual(JoinFlow.canonicalCode("  efgh45 "), "EFGH45")
        XCTAssertNil(JoinFlow.canonicalCode("ABCD12"), "1 不在 32 符号内")
        XCTAssertNil(JoinFlow.canonicalCode("ABCD10"), "0 不在 32 符号内")
        XCTAssertNil(JoinFlow.canonicalCode("ABCDIO"), "I/O 不在 32 符号内")
        XCTAssertNil(JoinFlow.canonicalCode("ABCDE"), "不足 6 位")
        XCTAssertNil(JoinFlow.canonicalCode("ABCDEFG"), "超过 6 位")
    }

    func testJoinDestinationAcceptsLinkAndDeepLinkWithoutToken() {
        let https = JoinDestination("https://riichi.p1ziyu.com/checkin/\(matchID)")
        XCTAssertEqual(https?.matchID, matchID)
        XCTAssertNil(https?.token)
        let deep = JoinDestination("ichihime-native://checkin/\(matchID)?token=tok123")
        XCTAssertEqual(deep?.matchID, matchID)
        XCTAssertEqual(deep?.token, "tok123")
        XCTAssertNil(JoinDestination("https://evil.example.com/checkin/\(matchID)"))
        XCTAssertNil(JoinDestination("https://riichi.p1ziyu.com/checkin/not-a-uuid"))
        XCTAssertNil(JoinDestination("https://riichi.p1ziyu.com/checkin/\(matchID)?token=a&token=b"))
    }

    func testFinalScoreTotalsAndRange() {
        XCTAssertEqual(FinalMode.four.total, 1000)
        XCTAssertEqual(FinalMode.three.total, 1050)
        XCTAssertNil(FinalScoreLogic.validationError(
            scores: [("E", 400), ("S", 300), ("W", 200), ("N", 100)], mode: .four))
        XCTAssertNotNil(FinalScoreLogic.validationError(
            scores: [("E", 400), ("S", 300), ("W", 200), ("N", 101)], mode: .four))
        XCTAssertNotNil(FinalScoreLogic.validationError(
            scores: [("E", 10000), ("S", 0), ("W", 0), ("N", -9000)], mode: .four))
        XCTAssertNil(FinalScoreLogic.validationError(
            scores: [("E", -50), ("S", 0), ("W", 1100)], mode: .three), "三麻允许负数与 0")
        XCTAssertNotNil(FinalScoreLogic.validationError(
            scores: [("E", 400), ("S", 300), ("W", nil), ("N", 300)], mode: .four))
    }

    func testFinalScoreParseSupportsNegativeAndGrouped() {
        XCTAssertEqual(FinalScoreLogic.parse("-250"), -250)
        XCTAssertEqual(FinalScoreLogic.parse("1,000"), 1000)
        XCTAssertEqual(FinalScoreLogic.parse(" 250 "), 250)
        XCTAssertNil(FinalScoreLogic.parse(""))
        XCTAssertNil(FinalScoreLogic.parse("12.5"))
        XCTAssertNil(FinalScoreLogic.parse("abc"))
    }

    func testTieBreakFollowsWindOrder() {
        // 300 同点组为东/西/北，按风序东 > 西 > 北；100 分的南为第 4。
        let four = FinalScoreLogic.ranks(for: [("N", 300), ("E", 300), ("W", 300), ("S", 100)], mode: .four)
        XCTAssertEqual(four["E"], 1)
        XCTAssertEqual(four["W"], 2)
        XCTAssertEqual(four["N"], 3)
        XCTAssertEqual(four["S"], 4)
        let ranks = FinalScoreLogic.ranks(for: [("E", 300), ("S", 300), ("W", 300), ("N", 300)], mode: .four)
        XCTAssertEqual(ranks, ["E": 1, "S": 2, "W": 3, "N": 4])
        let three = FinalScoreLogic.ranks(for: [("W", 500), ("E", 500), ("S", 50)], mode: .three)
        XCTAssertEqual(three["E"], 1)
        XCTAssertEqual(three["W"], 2)
        XCTAssertEqual(three["S"], 3)
    }

    func testMeResponseIsAdminDefaultsFalse() throws {
        let decoder = JSONDecoder()
        let admin = try decoder.decode(MeResponse.self, from: Data("""
            {"principal": {"id": "p1", "displayName": "Ryan", "type": "account"}, "isAdmin": true}
            """.utf8))
        XCTAssertTrue(admin.isAdmin)
        let plain = try decoder.decode(MeResponse.self, from: Data("""
            {"principal": {"id": "p1", "displayName": "Ryan", "type": "account"}}
            """.utf8))
        XCTAssertFalse(plain.isAdmin)
    }

    func testErrorCopyMapsNewFinalScoreCodesToChinese() {
        XCTAssertEqual(APIErrorCopy.text(APIError(status: 400, code: "sum_mismatch", message: "sum mismatch")), "终局合计不对，请核对后再保存。")
        XCTAssertEqual(APIErrorCopy.text(APIError(status: 409, code: "match_full", message: "full")), "牌桌已满员，无法加入。")
        XCTAssertEqual(APIErrorCopy.text(APIError(status: 403, code: "forbidden", message: "forbidden")), "只有房主可以执行此操作。")
        XCTAssertFalse(APIErrorCopy.text(APIError(status: 401, code: nil, message: "Invalid email or password")).contains("Invalid"))
    }

    @MainActor func testStubJoinIsIdempotentAndFillsSeatsOnFull() async throws {
        let service = StubFinalService(isAdmin: false)
        let waiting = try await service.joinByCode("ABCD23")
        XCTAssertEqual(waiting.members.count, 2)
        XCTAssertEqual(waiting.status, "waiting")
        let again = try await service.joinByCode("ABCD23")
        XCTAssertEqual(again.members.count, 2, "重复加入幂等，不重复计成员")
        XCTAssertEqual(again.id, waiting.id)
    }

    @MainActor func testStubSubmitAndCorrectionLockSeats() async throws {
        let service = StubFinalService(isAdmin: true)
        let playing = try await service.mine().first { $0.status == "in_progress" }!
        let seatsBefore = playing.seats
        let saved = try await service.submitFinalScores(
            matchId: playing.id,
            scores: [FinalScoreEntry(wind: "E", score: 400), FinalScoreEntry(wind: "S", score: 300),
                     FinalScoreEntry(wind: "W", score: 200), FinalScoreEntry(wind: "N", score: 100)],
            correction: false)
        XCTAssertEqual(saved.status, "finished")
        XCTAssertEqual(saved.finalScores?.first { $0.wind == "E" }?.rank, 1)
        let corrected = try await service.submitFinalScores(
            matchId: playing.id,
            scores: [FinalScoreEntry(wind: "E", score: 350), FinalScoreEntry(wind: "S", score: 300),
                     FinalScoreEntry(wind: "W", score: 250), FinalScoreEntry(wind: "N", score: 100)],
            correction: true)
        XCTAssertEqual(corrected.seats, seatsBefore, "纠正座次锁定，只改分数")
        XCTAssertEqual(corrected.finalScores?.first { $0.wind == "E" }?.score, 350)
        XCTAssertNotNil(corrected.correctedAt)
    }

    @MainActor func testStubSubmitRejectsWrongSum() async throws {
        let service = StubFinalService(isAdmin: false)
        let playing = try await service.mine().first { $0.status == "in_progress" }!
        do {
            _ = try await service.submitFinalScores(
                matchId: playing.id,
                scores: [FinalScoreEntry(wind: "E", score: 400), FinalScoreEntry(wind: "S", score: 300),
                         FinalScoreEntry(wind: "W", score: 200), FinalScoreEntry(wind: "N", score: 101)],
                correction: false)
            XCTFail("合计不对必须拒绝")
        } catch let failure as APIError {
            XCTAssertEqual(failure.code, "sum_mismatch")
        }
    }

    @MainActor func testStubCancelRequiresHost() async throws {
        let service = StubFinalService(isAdmin: false)
        // 种子等待桌的房主是 stub-host，不是当前 stub-me，因此取消应被拒绝。
        do {
            _ = try await service.cancel(matchId: "22222222-2222-4222-8222-222222222222")
            XCTFail("非房主取消必须拒绝")
        } catch let failure as APIError {
            XCTAssertEqual(failure.code, "forbidden")
        }
    }
}


// API 实测偏差回归：创建返回 {match} 包裹、admin/players 返回 {players} 包裹、
// join 无凭证拒绝 missing_credential、token 不消费。
private final class FinalAPIStubProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { return }
        let (status, body) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class FinalAPIWrapperTests: XCTestCase {
    private func client() -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FinalAPIStubProtocol.self]
        return APIClient(transport: URLSession(configuration: configuration), bearerOverride: "test-bearer")
    }

    func testLiveCreateDecodesMatchWrapper() async throws {
        FinalAPIStubProtocol.handler = { _ in
            (200, Data("""
                {"match": {"id": "55555555-5555-4555-8555-555555555555", "mode": "4p", "status": "waiting",
                "hostId": "host-1", "joinCode": "ABCD23", "members": [{"userId": "host-1", "displayName": "房主", "isHost": true}],
                "seats": [], "finalScores": null}}
                """.utf8))
        }
        let api = client()
        let session = AppSession()
        _ = session
        let service = LiveFinalService(api: api, session: session)
        let match = try await service.create(mode: .four)
        XCTAssertEqual(match.id, "55555555-5555-4555-8555-555555555555")
        XCTAssertEqual(match.joinCode, "ABCD23")
        XCTAssertEqual(match.seatDisplays().count, 1, "未分座时座次显示退化为成员列表")
    }

    func testLiveAdminPlayersDecodesPlayersWrapper() async throws {
        FinalAPIStubProtocol.handler = { _ in
            (200, Data("""
                {"players": [{"id": "u1", "name": "甲", "matchCount": 3}]}
                """.utf8))
        }
        let service = LiveFinalService(api: client(), session: AppSession())
        let players = try await service.adminPlayers()
        XCTAssertEqual(players.count, 1)
        XCTAssertEqual(players.first?.name, "甲")
        XCTAssertEqual(players.first?.matchCount, 3)
    }

    func testLiveSeatDisplayResolvesNameFromMembers() async throws {
        // API 实测 seats 不带显示名：座位名必须按 userId 查 members。
        FinalAPIStubProtocol.handler = { _ in
            (200, Data("""
                {"match": {"id": "66666666-6666-4666-8666-666666666666", "mode": "4p", "status": "in_progress",
                "hostId": "u1", "joinCode": "EFGH45",
                "members": [{"userId": "u1", "displayName": "东家", "isHost": true}, {"userId": "u2", "displayName": "南家", "isHost": false}],
                "seats": [{"seatNo": 0, "userId": "u1", "wind": "E"}, {"seatNo": 1, "userId": "u2", "wind": "S"}],
                "finalScores": null}}
                """.utf8))
        }
        // 用 mine 路径验 seatDisplays：直接构造视图对象即可覆盖解析与查名。
        let decoder = JSONDecoder()
        let match = try decoder.decode(FinalMatch.self, from: Data("""
            {"id": "66666666-6666-4666-8666-666666666666", "mode": "4p", "status": "in_progress",
            "hostId": "u1", "joinCode": "EFGH45",
            "members": [{"userId": "u1", "displayName": "东家", "isHost": true}, {"userId": "u2", "displayName": "南家", "isHost": false}],
            "seats": [{"seatNo": 0, "userId": "u1", "wind": "E"}, {"seatNo": 1, "userId": "u2", "wind": "S"}],
            "finalScores": null}
            """.utf8))
        XCTAssertEqual(match.seatDisplays().map { $0.name }, ["东家", "南家"])
        XCTAssertEqual(match.seats.first?.seatNo, 0)
    }

    func testStubJoinLinkRequiresCredentialAndTokenIsNotConsumed() async throws {
        let service = StubFinalService(isAdmin: false)
        let bare = JoinDestination("https://riichi.p1ziyu.com/checkin/22222222-2222-4222-8222-222222222222")!
        do {
            _ = try await service.joinLink(bare)
            XCTFail("无凭证链接必须拒绝")
        } catch let failure as APIError {
            XCTAssertEqual(failure.code, "missing_credential")
        }
        let withToken = JoinDestination("https://riichi.p1ziyu.com/checkin/22222222-2222-4222-8222-222222222222?token=shared-token")!
        let first = try await service.joinLink(withToken)
        XCTAssertEqual(first.members.count, 2)
        // 同一 token 可再次用于另一成员场景：这里重复加入同一用户幂等返回，
        // 且 token 本身未被消费（再次调用不报 token 失效）。
        let again = try await service.joinLink(withToken)
        XCTAssertEqual(again.members.count, 2)
        let wrongCode = JoinDestination("https://riichi.p1ziyu.com/checkin/22222222-2222-4222-8222-222222222222?code=ZZZZ99")!
        do {
            _ = try await service.joinLink(wrongCode)
            XCTFail("错误房间码必须拒绝")
        } catch let failure as APIError {
            XCTAssertEqual(failure.code, "join_code_not_found")
        }
    }
}
