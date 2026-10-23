import Foundation
import XCTest
@testable import IchihimeNative

private final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, [String: String], Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { XCTFail("Missing HTTP fixture"); return }
        let (status, headers, body) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class JoinFlowTests: XCTestCase {
    private let match = "11111111-1111-4111-8111-111111111111"

    @MainActor private func client(_ handler: @escaping (URLRequest) -> (Int, [String: String], Data)) -> APIClient {
        StubProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return APIClient(transport: URLSession(configuration: configuration), bearerOverride: "test-bearer")
    }

    func testDealerRandomOmittedAndExplicitZero() throws {
        let random = try JSONSerialization.jsonObject(with: JSONEncoder().encode(FinalizeSeats(dealerSeatNo: nil))) as! [String: Any]
        XCTAssertNil(random["dealerSeatNo"])
        let explicit = try JSONSerialization.jsonObject(with: JSONEncoder().encode(FinalizeSeats(dealerSeatNo: 0))) as! [String: Int]
        XCTAssertEqual(explicit["dealerSeatNo"], 0)
    }

    func testMarkCASLimitsAndLowPoints() throws {
        let declare = HandSeatDTO(seatNo: 0, isRiichi: false, riichiChangeUsage: RiichiUsageDTO(declares: 1, cancels: 0))
        let exhausted = HandSeatDTO(seatNo: 0, isRiichi: false, riichiChangeUsage: RiichiUsageDTO(declares: 2, cancels: 0))
        let cancel = HandSeatDTO(seatNo: 0, isRiichi: true, riichiChangeUsage: RiichiUsageDTO(declares: 2, cancels: 0))
        let cancelled = HandSeatDTO(seatNo: 0, isRiichi: true, riichiChangeUsage: RiichiUsageDTO(declares: 2, cancels: 1))
        XCTAssertFalse(OnlineCommandPolicy.canToggle(declare, points: 999, allowLowPointRiichi: false))
        XCTAssertTrue(OnlineCommandPolicy.canToggle(declare, points: 1000, allowLowPointRiichi: false))
        XCTAssertTrue(OnlineCommandPolicy.canToggle(declare, points: 0, allowLowPointRiichi: true))
        XCTAssertFalse(OnlineCommandPolicy.canToggle(exhausted, points: 5000, allowLowPointRiichi: true))
        XCTAssertTrue(OnlineCommandPolicy.canToggle(cancel, points: 0, allowLowPointRiichi: false))
        XCTAssertFalse(OnlineCommandPolicy.canToggle(cancelled, points: 5000, allowLowPointRiichi: true))
        let body = try JSONEncoder().encode(MarkCommand(seatNo: 0, riichi: true, expectedMarkRevision: 17))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["expectedMarkRevision"] as? Int, 17)
        XCTAssertEqual(json["riichi"] as? Bool, true)
        XCTAssertTrue(OnlineCommandPolicy.refreshAfter(APIError(status: 409, code: "stale_mark_revision", message: "stale")))
        XCTAssertFalse(OnlineCommandPolicy.refreshAfter(APIError(status: 400, message: "invalid")))
    }

    func testPreviewBindingInvalidatesForInputAndMarkRevision() {
        let a: [String: JSONValue] = ["kind": .string("ron"), "winners": .array([])]
        let b: [String: JSONValue] = ["kind": .string("tsumo"), "winners": .array([])]
        let baseline = OnlineCommandPolicy.previewBinding(handID: "hand", revision: 3, input: a)
        XCTAssertNotNil(baseline)
        XCTAssertEqual(baseline, OnlineCommandPolicy.previewBinding(handID: "hand", revision: 3, input: a))
        XCTAssertNotEqual(baseline, OnlineCommandPolicy.previewBinding(handID: "hand", revision: 4, input: a))
        XCTAssertNotEqual(baseline, OnlineCommandPolicy.previewBinding(handID: "hand", revision: 3, input: b))
    }

    func testResultRetryPreservesExactBodyAndEditUsesNewEventID() throws {
        let input: [String: JSONValue] = ["kind": .string("tsumo")]
        let first = ResultCommand(resultInput: input, confirmedMarkRevision: 8, clientEventId: UUID().uuidString)
        let original = try JSONEncoder().encode(first)
        let envelope = PendingResultEnvelope(handID: "hand", body: original)
        let restored = try JSONDecoder().decode(PendingResultEnvelope.self, from: JSONEncoder().encode(envelope))
        XCTAssertEqual(restored.body, original)
        XCTAssertEqual(restored.handID, "hand")
        let edited = ResultCommand(resultInput: ["kind": .string("ron")], confirmedMarkRevision: 8, clientEventId: UUID().uuidString)
        XCTAssertNotEqual(first.clientEventId, edited.clientEventId)
        XCTAssertNotEqual(original, try JSONEncoder().encode(edited))
    }

    func testCodeValidationAndUniversalLinkRouting() {
        XCTAssertEqual(JoinFlow.canonicalCode(" abcd23 \n"), "ABCD23")
        for invalid in ["ABCD01", "IIIIII", "OOOOOO", "ABC23", "ABC2345", "ABC/23"] {
            XCTAssertNil(JoinFlow.canonicalCode(invalid), invalid)
        }
        let link = "https://riichi.p1ziyu.com/checkin/\(match)?token=abc%2B%26"
        XCTAssertEqual(CheckInDestination(link)?.matchID, match)
        XCTAssertEqual(CheckInDestination(link)?.token, "abc+&")
        XCTAssertEqual(CheckInDestination("ichihime-native://checkin/\(match)?token=valid")?.matchID, match)
        for invalid in [
            "http://riichi.p1ziyu.com/checkin/\(match)?token=valid",
            "https://evil.example/checkin/\(match)?token=valid",
            "https://riichi.p1ziyu.com.evil.example/checkin/\(match)?token=valid",
            "https://riichi.p1ziyu.com/checkin/\(match)?token=a&token=b",
            "https://riichi.p1ziyu.com/checkin/\(match)?token=valid&other=1",
            "https://riichi.p1ziyu.com/checkin/not-a-uuid?token=valid"
        ] { XCTAssertNil(CheckInDestination(invalid), invalid) }
    }

    func testPreviewOccupancyMapsZeroBasedSeatsAndMissingSlots() throws {
        let preview = try JSONDecoder().decode(CheckInSeatsDTO.self, from: Data("""
        {"match":{"id":"\(match)","playerCount":4,"status":"preparing"},
         "seats":[{"seatNo":2,"principalId":"guest","displayName":"访客","status":"checked_in"},
                  {"seatNo":0,"principalId":"owner","displayName":"桌主","status":"checked_in"}]}
        """.utf8))
        XCTAssertEqual(preview.match.playerCount, 4)
        XCTAssertEqual(preview.seat(at: 0)?.displayName, "桌主")
        XCTAssertNil(preview.seat(at: 1)?.principalId)
        XCTAssertEqual(preview.seat(at: 2)?.displayName, "访客")
        XCTAssertNil(preview.seat(at: 3)?.principalId)
        XCTAssertEqual(preview.seats.filter { $0.principalId != nil }.count, 2)
    }

    @MainActor func testDirectPreviewExplicitAndAutoCheckInAndIdempotentResponse() async throws {
        var requests: [URLRequest] = []
        let client = client { request in
            requests.append(request)
            if request.httpMethod == "GET" {
                return (200, [:], Data("""
                {"match":{"id":"\(self.match)","playerCount":4,"status":"preparing"},
                 "seats":[{"seatNo":0,"principalId":"owner","displayName":"桌主","status":"checked_in"}]}
                """.utf8))
            }
            return (200, [:], Data(#"{"seat":{"seatNo":2},"grantId":"grant-1"}"#.utf8))
        }
        let preview = try await client.checkInSeats(matchID: match, token: "a&b +")
        XCTAssertEqual(preview.seat(at: 0)?.displayName, "桌主")
        let explicit = try await client.checkIn(matchID: match, command: CheckInCommand(token: "valid", seatNo: 2, alias: "访客"))
        let auto = try await client.checkIn(matchID: match, command: CheckInCommand(token: "valid", seatNo: nil, alias: nil))
        let repeated = try await client.checkIn(matchID: match, command: CheckInCommand(token: "valid", seatNo: 2, alias: "访客"))
        XCTAssertEqual(explicit.seat.seatNo, 2)
        XCTAssertEqual(explicit.grantId, "grant-1")
        XCTAssertEqual(auto.seat.seatNo, explicit.seat.seatNo)
        XCTAssertEqual(repeated.seat.seatNo, explicit.seat.seatNo)
        XCTAssertEqual(repeated.grantId, explicit.grantId)
        XCTAssertEqual(requests.map { $0.httpMethod }, ["GET", "POST", "POST", "POST"])
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer test-bearer" })
        XCTAssertEqual(requests.map { $0.url!.path }, [
            "/api/matches/\(match)/check-in-seats",
            "/api/matches/\(match)/check-ins",
            "/api/matches/\(match)/check-ins",
            "/api/matches/\(match)/check-ins"
        ])
        XCTAssertEqual(URLComponents(url: requests[0].url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "token" })?.value, "a&b +")
        let explicitJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: Any])
        XCTAssertEqual(explicitJSON["token"] as? String, "valid")
        XCTAssertEqual(explicitJSON["seatNo"] as? Int, 2)
        XCTAssertEqual(explicitJSON["alias"] as? String, "访客")
        XCTAssertEqual(requests[3].httpBody, requests[1].httpBody)
        let autoJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[2].httpBody!) as? [String: Any])
        XCTAssertEqual(autoJSON["token"] as? String, "valid")
        XCTAssertNil(autoJSON["seatNo"])
        XCTAssertNil(autoJSON["alias"])
    }

    @MainActor func testCodeLookupReturnsShortLivedCheckInToken() async throws {
        var requestedPath: String?
        let client = client { request in
            requestedPath = request.url?.path
            return (200, [:], Data("""
            {"matchId":"\(self.match)","token":"signed-token","expiresAt":"2026-10-23T12:10:00Z"}
            """.utf8))
        }
        let code = try XCTUnwrap(JoinFlow.canonicalCode(" abcd23 "))
        let result: JoinCodeDTO = try await client.get("/api/matches/by-code/\(code)")
        XCTAssertEqual(requestedPath, "/api/matches/by-code/ABCD23")
        XCTAssertEqual(result.matchId, match)
        XCTAssertEqual(result.token, "signed-token")
        XCTAssertEqual(result.expiresAt, "2026-10-23T12:10:00Z")
    }

    @MainActor func testCodeLookupErrorMappingViaFakeHTTP() async throws {
        let client = client { request in
            if request.url!.path.contains("by-code") {
                return (429, ["Retry-After": "37"], Data(#"{"error":"rate_limited","message":"Too many requests"}"#.utf8))
            }
            return (400, [:], Data(#"{"error":"invalid_token","message":"Invalid"}"#.utf8))
        }
        do {
            let _: JoinCodeDTO = try await client.get("/api/matches/by-code/ABCD23")
            XCTFail("Rate-limited lookup must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.retryAfter, 37)
            XCTAssertEqual(JoinFlow.codeError(error), "房间码查询过于频繁，请在 37 秒后重试。")
        }
        do {
            let _: CheckInSeatsDTO = try await client.checkInSeats(matchID: match, token: "invalid")
            XCTFail("Invalid token must fail before joining")
        } catch let error as APIError {
            XCTAssertTrue(JoinFlow.tokenExpired(error))
            XCTAssertEqual(JoinFlow.joinError(error), "签到凭证无效或已过期。请重新输入房间码，或向桌主索取新的签到链接。")
        }
    }

    @MainActor func testConsumedPreviewCanRecoverExistingCheckedInSeat() async throws {
        var requests: [URLRequest] = []
        let client = client { request in
            requests.append(request)
            if request.httpMethod == "GET" {
                return (400, [:], Data(#"{"error":"token_consumed_or_expired","message":"Consumed"}"#.utf8))
            }
            return (200, [:], Data(#"{"seat":{"seatNo":1},"grantId":"existing-grant"}"#.utf8))
        }
        do {
            let _: CheckInSeatsDTO = try await client.checkInSeats(matchID: match, token: "signed-token")
            XCTFail("Consumed invitation should not reveal the seat preview")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "token_consumed_or_expired")
        }
        let result = try await client.checkIn(
            matchID: match, command: CheckInCommand(token: "signed-token", seatNo: nil, alias: nil))
        XCTAssertEqual(result.seat.seatNo, 1)
        XCTAssertEqual(result.grantId, "existing-grant")
        XCTAssertEqual(requests.map { $0.url!.path }, [
            "/api/matches/\(match)/check-in-seats", "/api/matches/\(match)/check-ins"
        ])
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: Any])
        XCTAssertEqual(body["token"] as? String, "signed-token")
        XCTAssertNil(body["seatNo"])
        XCTAssertNil(body["alias"])
    }

    @MainActor func testDirectJoinSeatTakenFullStartedAndExpiredErrors() async throws {
        for (code, status, message) in [
            ("seat_taken", 409, "座位已被占用，请重新选择空座。"),
            ("match_full", 409, "牌桌已满，无法加入。"),
            ("match_already_started", 409, "牌桌已经开局，无法加入。"),
            ("token_consumed_or_expired", 400, "签到凭证无效或已过期。请重新输入房间码，或向桌主索取新的签到链接。"),
            ("guest_already_bound", 403, "当前临时访客已绑定其他牌桌，请使用账户身份加入。")
        ] {
            let client = client { _ in
                (status, [:], Data(#"{"error":"\#(code)","message":"Rejected"}"#.utf8))
            }
            do {
                let _ = try await client.checkIn(matchID: match, command: CheckInCommand(token: "token", seatNo: 1, alias: nil))
                XCTFail("\(code) must fail")
            } catch let error as APIError {
                XCTAssertEqual(error.status, status)
                XCTAssertEqual(error.code, code)
                XCTAssertEqual(JoinFlow.joinError(error), message)
            }
        }
        let missing = APIError(status: 404, code: "join_code_not_found", message: "Missing")
        XCTAssertEqual(JoinFlow.codeError(missing), "房间码不存在或已失效，请向房主核对。")
        XCTAssertEqual(JoinFlow.codeError(APIError(status: 409, code: "match_already_started", message: "Started")),
                       "牌桌已经开局，无法通过房间码加入。")
    }

    @MainActor func testHostReassignMoveSwapAndRemoveShapes() async throws {
        var requests: [URLRequest] = []
        let guest = "33333333-3333-4333-8333-333333333333"
        let client = client { request in
            requests.append(request)
            if request.url!.path.hasSuffix("/remove") {
                return (200, [:], Data(#"{"removed":true}"#.utf8))
            }
            if requests.count == 1 {
                return (200, [:], Data(#"{"fromSeatNo":0,"toSeatNo":2,"swapped":true}"#.utf8))
            }
            return (200, [:], Data(#"{"fromSeatNo":2,"toSeatNo":1,"swapped":false}"#.utf8))
        }
        let swap = try await client.reassignSeat(matchID: match, from: 0, to: 2)
        let move = try await client.reassignSeat(matchID: match, from: 2, to: 1)
        let removed = try await client.removeMember(matchID: match, principalID: guest)
        XCTAssertTrue(swap.swapped)
        XCTAssertEqual(swap.toSeatNo, 2)
        XCTAssertFalse(move.swapped)
        XCTAssertEqual(move.fromSeatNo, 2)
        XCTAssertEqual(move.toSeatNo, 1)
        XCTAssertTrue(removed.removed)
        XCTAssertEqual(requests.map { $0.url!.path }, [
            "/api/matches/\(match)/seats/reassign",
            "/api/matches/\(match)/seats/reassign",
            "/api/matches/\(match)/members/\(guest)/remove"
        ])
        for (request, from, to) in [(requests[0], 0, 2), (requests[1], 2, 1)] {
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Int])
            XCTAssertEqual(body, ["fromSeatNo": from, "toSeatNo": to])
        }
        XCTAssertEqual(String(data: requests[2].httpBody!, encoding: .utf8), "{}")
    }
    @MainActor func testNativeAuthOriginOnlyOnSignIn() async throws {
        var requests: [URLRequest] = []
        let client = client { request in
            requests.append(request)
            return (403, [:], Data(#"{"error":"forbidden","message":"Denied"}"#.utf8))
        }
        do { try await client.signInGuest(); XCTFail("Expected fixture error") }
        catch let error as APIError { XCTAssertEqual(error.status, 403) }
        do {
            let _: TableSnapshot = try await client.get("/api/matches/\(match)")
            XCTFail("Expected fixture error")
        } catch let error as APIError { XCTAssertEqual(error.status, 403) }
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Origin"), "https://riichi.p1ziyu.com")
        XCTAssertNil(requests[1].value(forHTTPHeaderField: "Origin"))
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer test-bearer")
    }


}
