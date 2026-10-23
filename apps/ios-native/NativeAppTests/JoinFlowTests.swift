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
    private let requestID = "22222222-2222-4222-8222-222222222222"

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

    func testCodeValidationReceiptRoundTripAndMatchMismatch() throws {
        XCTAssertEqual(JoinFlow.canonicalCode(" abcd23 \n"), "ABCD23")
        for invalid in ["ABCD01", "IIIIII", "OOOOOO", "ABC23", "ABC2345", "ABC/23"] {
            XCTAssertNil(JoinFlow.canonicalCode(invalid), invalid)
        }
        let receipt = try XCTUnwrap(JoinReceipt(matchId: match, joinRequestId: requestID, name: "访客"))
        XCTAssertEqual(JoinReceipt(receipt.text), receipt)
        XCTAssertEqual(JoinFlow.receipt(receipt.text, forMatch: match), receipt)
        XCTAssertNil(JoinFlow.receipt(receipt.text, forMatch: UUID().uuidString))
        XCTAssertNil(JoinFlow.receipt("not JSON", forMatch: match))
        XCTAssertNil(JoinReceipt(receipt.text.replacingOccurrences(of: "\"v\":1", with: "\"v\":2")))
        XCTAssertNil(JoinReceipt(matchId: match, joinRequestId: "bad", name: "访客"))
        XCTAssertNotNil(CheckInDestination("https://riichi.p1ziyu.com/checkin/\(match)?token=valid"))
        XCTAssertNil(CheckInDestination("https://evil.example/checkin/\(match)?token=valid"))
    }

    @MainActor func testFakeHTTPJoinIsSingleRequestAndApprovalPath() async throws {
        var posts: [String] = []
        let client = client { request in
            let path = request.url!.path
            posts.append(path)
            if path.hasSuffix("/join-requests") {
                return (200, [:], Data(#"{"joinRequestId":"22222222-2222-4222-8222-222222222222","status":"pending"}"#.utf8))
            }
            return (200, [:], Data(#"{"ok":true,"joinRequestId":"22222222-2222-4222-8222-222222222222","seatNo":2}"#.utf8))
        }
        let joined: JoinRequestDTO = try await client.post("/api/matches/\(match)/join-requests")
        XCTAssertEqual(joined.joinRequestId, requestID)
        let _: [String: JSONValue] = try await client.post("/api/matches/\(match)/join-requests/\(joined.joinRequestId)/approve", body: ["seatNo": 2])
        XCTAssertEqual(posts, ["/api/matches/\(match)/join-requests", "/api/matches/\(match)/join-requests/\(requestID)/approve"])
    }

    @MainActor func testWaiting403AndCodeLookupErrorMappingViaFakeHTTP() async throws {
        let client = client { request in
            if request.url!.path.contains("by-code") {
                return (429, ["Retry-After": "37"], Data(#"{"error":"rate_limited","message":"Too many requests"}"#.utf8))
            }
            return (403, [:], Data(#"{"error":"forbidden","message":"Access denied"}"#.utf8))
        }
        do {
            let _: TableSnapshot = try await client.get("/api/matches/\(match)")
            XCTFail("Unapproved guest must not read table")
        } catch let error as APIError {
            XCTAssertTrue(JoinFlow.isWaiting(error))
            XCTAssertEqual(error.status, 403)
        }
        do {
            let _: JoinCodeDTO = try await client.get("/api/matches/by-code/ABCD23")
            XCTFail("Rate-limited lookup must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "rate_limited")
            XCTAssertEqual(error.retryAfter, 37)
            XCTAssertFalse(JoinFlow.isWaiting(error))
            XCTAssertEqual(JoinFlow.codeError(error), "房间码查询过于频繁，请在 37 秒后重试。")
        }
    }

    @MainActor func testExpiredTokenCodeRecoveryAndLinkPrompt() async throws {
        XCTAssertTrue(JoinFlow.canResolveExpiredToken(code: " ABCD23 ", resolvedByCode: true))
        XCTAssertFalse(JoinFlow.canResolveExpiredToken(code: "", resolvedByCode: false))
        XCTAssertFalse(JoinFlow.canResolveExpiredToken(code: "ABCD23", resolvedByCode: false))
        XCTAssertTrue(JoinFlow.tokenExpired(APIError(status: 400, code: "invalid_token", message: "Expired signature")))
        XCTAssertFalse(JoinFlow.tokenExpired(APIError(status: 403, code: "check_in_not_approved", message: "Waiting")))
        let client = client { request in
            if request.url!.path.contains("by-code") {
                return (200, [:], Data(#"{"matchId":"11111111-1111-4111-8111-111111111111","token":"new-token","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
            }
            return (400, [:], Data(#"{"error":"token_consumed_or_expired","message":"Expired"}"#.utf8))
        }
        do {
            let _: CheckInResultDTO = try await client.post("/api/matches/\(match)/check-ins", body: ["token": "old-token"])
            XCTFail("Expired token must fail")
        } catch let error as APIError {
            XCTAssertTrue(JoinFlow.tokenExpired(error))
        }
        let renewed: JoinCodeDTO = try await client.get("/api/matches/by-code/ABCD23")
        XCTAssertEqual(renewed.matchId, match)
        XCTAssertEqual(renewed.token, "new-token")
    }
    @MainActor func testCodeNotFoundAndSeatConflictMapping() async throws {
        let client = client { request in
            if request.url!.path.contains("by-code") {
                return (404, [:], Data(#"{"error":"join_code_not_found","message":"Not found"}"#.utf8))
            }
            return (409, [:], Data(#"{"error":"seat_taken","message":"Seat taken"}"#.utf8))
        }
        do {
            let _: JoinCodeDTO = try await client.get("/api/matches/by-code/ABCD23")
            XCTFail("Missing code must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 404)
            XCTAssertEqual(error.code, "join_code_not_found")
            XCTAssertEqual(JoinFlow.codeError(error), "房间码不存在或已失效，请向房主核对。")
        }
        do {
            let _: [String: JSONValue] = try await client.post("/api/matches/\(match)/join-requests/\(requestID)/approve", body: ["seatNo": 1])
            XCTFail("Occupied seat must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "seat_taken")
            XCTAssertTrue(OnlineCommandPolicy.refreshAfter(error))
            XCTAssertEqual(OnlineCommandPolicy.approvalError(error), "座位已被占用，请刷新牌桌并选择其他空座。")
        }
    }

    func testStartedCodeAndResolvedApprovalHaveDistinctMessages() {
        let started = APIError(status: 409, code: "match_already_started", message: "Started")
        let resolved = APIError(status: 409, code: "join_request_already_decided", message: "Resolved")
        let missing = APIError(status: 404, code: "join_request_not_found", message: "Missing")
        XCTAssertEqual(JoinFlow.codeError(started), "牌桌已经开局，无法再通过房间码申请。")
        XCTAssertEqual(OnlineCommandPolicy.approvalError(started), "牌桌已经开局，无法批准新的申请。")
        XCTAssertEqual(OnlineCommandPolicy.approvalError(resolved), "这份申请已被处理，不能再次批准。")
        XCTAssertEqual(OnlineCommandPolicy.approvalError(missing), "申请编号不存在或不属于本桌，请核对回执。")
    }

    @MainActor func testStartedRoomCode409MapsToChineseState() async throws {
        let client = client { _ in
            (409, [:], Data(#"{"error":"match_already_started","message":"Started"}"#.utf8))
        }
        do {
            let _: JoinCodeDTO = try await client.get("/api/matches/by-code/ABCD23")
            XCTFail("Started table must reject room code")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 409)
            XCTAssertEqual(error.code, "match_already_started")
            XCTAssertEqual(JoinFlow.codeError(error), "牌桌已经开局，无法再通过房间码申请。")
        }
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

    @MainActor func testApprovalPollTransitionsFrom403ToCheckInWithoutEarlyPost() async throws {
        var reads = 0
        var checkIns = 0
        let client = client { request in
            if request.httpMethod == "GET" {
                reads += 1
                if reads == 1 {
                    return (403, [:], Data(#"{"error":"forbidden","message":"Waiting"}"#.utf8))
                }
                let body = Data(#"{"match":{"id":"11111111-1111-4111-8111-111111111111","status":"preparing","playerCount":4},"seats":[{"seatNo":0,"status":"assigned"}],"currentHand":null}"#.utf8)
                return (200, [:], body)
            }
            checkIns += 1
            return (200, [:], Data(#"{"seat":{"seatNo":0}}"#.utf8))
        }
        do {
            let _: TableSnapshot = try await client.get("/api/matches/\(match)")
            XCTFail("Pending match access should be forbidden")
        } catch let error as APIError {
            XCTAssertTrue(JoinFlow.isWaiting(error))
        }
        XCTAssertEqual(checkIns, 0)
        let table: TableSnapshot = try await client.get("/api/matches/\(match)")
        XCTAssertEqual(table.seats.first?.status, "assigned")
        let signed: CheckInResultDTO = try await client.post("/api/matches/\(match)/check-ins", body: ["token": "valid"])
        XCTAssertEqual(signed.seat.seatNo, 0)
        XCTAssertEqual(reads, 2)
        XCTAssertEqual(checkIns, 1)
    }

}
