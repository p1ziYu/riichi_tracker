import Foundation

// 最后一版原生在线服务（spec §2 契约）。
// LiveFinalService 走真实新 API；StubFinalService 只在 -UITestSeed 演示模式下
// 于内存演练同一流程（真实新 API 合入前，协调者再于一次性后端验证）。
// 两个实现共用 FinalScoreLogic 校验，因此 stub 演练的合计/顺位规则与线上一致。

@MainActor
protocol FinalMatchService {
    var isAdmin: Bool { get }
    var currentUserId: String? { get }
    func mine() async throws -> [FinalMatch]
    func create(mode: FinalMode) async throws -> FinalMatch
    func joinByCode(_ code: String) async throws -> FinalMatch
    func joinLink(_ destination: JoinDestination) async throws -> FinalMatch
    func submitFinalScores(matchId: String, scores: [FinalScoreEntry], correction: Bool) async throws -> FinalMatch
    func cancel(matchId: String) async throws -> FinalMatch
    func adminPlayers() async throws -> [AdminPlayer]
    func adminMatches() async throws -> [FinalMatch]
    func deleteAdmin(matchId: String) async throws
    func correctAdmin(matchId: String, scores: [FinalScoreEntry]) async throws -> FinalMatch
}

private struct CreateMatchBody: Encodable { let mode: String }
private struct JoinBody: Encodable {
    let code: String?
    let token: String?
    private enum CodingKeys: String, CodingKey { case code, token }
    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encodeIfPresent(code, forKey: .code)
        try fields.encodeIfPresent(token, forKey: .token)
    }
}
private struct FinalScoresBody: Encodable { let scores: [FinalScoreEntry] }
private struct ByCodeWrapper: Decodable {
    let match: FinalMatch?
    let matchId: String?
    let id: String?
}
private struct CreatedMatchWrapper: Decodable { let match: FinalMatch }
private struct AdminPlayersWrapper: Decodable { let players: [AdminPlayer] }

@MainActor
final class LiveFinalService: FinalMatchService {
    private let api: APIClient
    private let session: AppSession

    init(api: APIClient, session: AppSession) {
        self.api = api
        self.session = session
    }

    var isAdmin: Bool { session.isAdmin }
    var currentUserId: String? { session.principalID }

    func mine() async throws -> [FinalMatch] {
        try await api.get("/api/matches/mine")
    }

    func create(mode: FinalMode) async throws -> FinalMatch {
        // API 实测：创建返回 {match: {...}}，不是裸 match 视图。
        if let wrapped: CreatedMatchWrapper = try? await api.post("/api/matches", body: CreateMatchBody(mode: mode.rawValue)) {
            return wrapped.match
        }
        return try await api.post("/api/matches", body: CreateMatchBody(mode: mode.rawValue))
    }

    func joinByCode(_ code: String) async throws -> FinalMatch {
        // by-code 端点返回的形态以 API worker 的实现为准：先按完整对局解，
        // 再按 {match}/{matchId} 包裹解，最后以 id 走 join（join 本身幂等）。
        if let direct: FinalMatch = try? await api.get("/api/matches/by-code/\(code)") {
            return try await api.post("/api/matches/\(direct.id)/join", body: JoinBody(code: code, token: nil))
        }
        let wrapped: ByCodeWrapper = try await api.get("/api/matches/by-code/\(code)")
        guard let id = wrapped.match?.id ?? wrapped.matchId ?? wrapped.id else {
            throw APIError(status: 404, code: "match_not_found", message: "牌桌不存在")
        }
        if let match = wrapped.match { return try await api.post("/api/matches/\(match.id)/join", body: JoinBody(code: code, token: nil)) }
        return try await api.post("/api/matches/\(id)/join", body: JoinBody(code: code, token: nil))
    }

    func joinLink(_ destination: JoinDestination) async throws -> FinalMatch {
        // API 实测：join 必须带凭证（code 或 token），否则 400 missing_credential；
        // 不支持 alias 改名，显示名取账号资料。本机先拦无凭证链接，不发无效请求。
        guard destination.token != nil || destination.code != nil else {
            throw APIError(status: 400, code: "missing_credential", message: "加入需要凭证")
        }
        do {
            return try await api.post("/api/matches/\(destination.matchID)/join",
                                      body: JoinBody(code: destination.code, token: destination.token))
        } catch let failure as APIError where failure.code == "already_member" || failure.code == "already_joined" {
            // 重复加入幂等：直接取回该桌。
            let mine: [FinalMatch] = try await api.get("/api/matches/mine")
            if let match = mine.first(where: { $0.id == destination.matchID }) { return match }
            throw failure
        }
    }

    func submitFinalScores(matchId: String, scores: [FinalScoreEntry], correction: Bool) async throws -> FinalMatch {
        let body = FinalScoresBody(scores: scores)
        if correction {
            return try await api.patch("/api/matches/\(matchId)/final-scores", body: body)
        }
        return try await api.post("/api/matches/\(matchId)/final-scores", body: body)
    }

    func cancel(matchId: String) async throws -> FinalMatch {
        try await api.post("/api/matches/\(matchId)/cancel")
    }

    func adminPlayers() async throws -> [AdminPlayer] {
        // API 实测：admin/players 返回 {players: [...]}，不是裸数组。
        let wrapped: AdminPlayersWrapper = try await api.get("/api/admin/players")
        return wrapped.players
    }

    func adminMatches() async throws -> [FinalMatch] {
        try await api.get("/api/admin/matches")
    }

    func deleteAdmin(matchId: String) async throws {
        try await api.deleteRequest("/api/admin/matches/\(matchId)")
    }

    func correctAdmin(matchId: String, scores: [FinalScoreEntry]) async throws -> FinalMatch {
        try await api.patch("/api/admin/matches/\(matchId)/final-scores", body: FinalScoresBody(scores: scores))
    }
}

/// 演示用内存服务：仅 -UITestSeed 启动参数下使用，不触网。
/// 种子数据：1 张等待中的四麻（房主为演示房主）、1 张进行中的四麻（我是房主）、
/// 1 张已结束的四麻（我是房主，终局分已记）。admin 门禁由 -UITestAdmin 控制。
@MainActor
final class StubFinalService: FinalMatchService {
    let isAdmin: Bool
    let currentUserId: String? = "stub-me"
    private var matches: [FinalMatch]

    init(isAdmin: Bool) {
        self.isAdmin = isAdmin
        let waiting = FinalMatch(
            id: "22222222-2222-4222-8222-222222222222", mode: .four, status: "waiting",
            hostId: "stub-host", joinCode: "ABCD23",
            members: [FinalMember(userId: "stub-host", displayName: "演示房主")],
            seats: [], finalScores: nil)
        let playing = FinalMatch(
            id: "33333333-3333-4333-8333-333333333333", mode: .four, status: "in_progress",
            hostId: "stub-me", joinCode: "EFGH45",
            members: [
                FinalMember(userId: "stub-me", displayName: "我"),
                FinalMember(userId: "stub-b", displayName: "小南"),
                FinalMember(userId: "stub-c", displayName: "小西"),
                FinalMember(userId: "stub-d", displayName: "小北"),
            ],
            seats: [
                FinalSeat(wind: "E", userId: "stub-me", displayName: "我"),
                FinalSeat(wind: "S", userId: "stub-b", displayName: "小南"),
                FinalSeat(wind: "W", userId: "stub-c", displayName: "小西"),
                FinalSeat(wind: "N", userId: "stub-d", displayName: "小北"),
            ],
            finalScores: nil)
        let finishedScores = FinalScoreLogic.entriesWithRanks(
            [("E", 400), ("S", 300), ("W", 200), ("N", 100)], mode: .four)
        let finished = FinalMatch(
            id: "44444444-4444-4444-8444-444444444444", mode: .four, status: "finished",
            hostId: "stub-me", joinCode: "JKLM67",
            members: [
                FinalMember(userId: "stub-me", displayName: "我"),
                FinalMember(userId: "stub-b", displayName: "小南"),
                FinalMember(userId: "stub-c", displayName: "小西"),
                FinalMember(userId: "stub-d", displayName: "小北"),
            ],
            seats: [
                FinalSeat(wind: "E", userId: "stub-me", displayName: "我"),
                FinalSeat(wind: "S", userId: "stub-b", displayName: "小南"),
                FinalSeat(wind: "W", userId: "stub-c", displayName: "小西"),
                FinalSeat(wind: "N", userId: "stub-d", displayName: "小北"),
            ],
            finalScores: finishedScores)
        self.matches = [waiting, playing, finished]
    }

    func mine() async throws -> [FinalMatch] { matches }

    func create(mode: FinalMode) async throws -> FinalMatch {
        let code = String((0..<6).map { _ in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".randomElement()! })
        let match = FinalMatch(
            id: UUID().uuidString, mode: mode, status: "waiting",
            hostId: currentUserId, joinCode: code,
            members: [FinalMember(userId: currentUserId ?? "stub-me", displayName: "我")],
            seats: [], finalScores: nil,
            createdAt: ISO8601DateFormatter().string(from: Date()))
        matches.insert(match, at: 0)
        return match
    }

    func joinByCode(_ code: String) async throws -> FinalMatch {
        guard let index = matches.firstIndex(where: { $0.joinCode == code }) else {
            throw APIError(status: 404, code: "join_code_not_found", message: "房间码不正确")
        }
        return try join(at: index)
    }

    func joinLink(_ destination: JoinDestination) async throws -> FinalMatch {
        // 与 API 实测一致：无凭证（既无 token 又无 code）拒绝 missing_credential；
        // code 若与房间码不符拒绝；token 不消费（同一链接可接纳所有座位）。
        guard destination.token != nil || destination.code != nil else {
            throw APIError(status: 400, code: "missing_credential", message: "加入需要凭证")
        }
        guard let index = matches.firstIndex(where: { $0.id == destination.matchID }) else {
            throw APIError(status: 404, code: "match_not_found", message: "牌桌不存在")
        }
        if let code = destination.code, matches[index].joinCode != code {
            throw APIError(status: 404, code: "join_code_not_found", message: "房间码不正确")
        }
        return try join(at: index)
    }

    private func join(at index: Int) throws -> FinalMatch {
        var match = matches[index]
        if match.isFinished || match.isCancelled {
            throw APIError(status: 409, code: "match_already_started", message: "牌局已结束")
        }
        if match.members.contains(where: { $0.userId == currentUserId }) { return match }
        guard match.members.count < match.mode.playerCount else {
            throw APIError(status: 409, code: "match_full", message: "牌桌已满员")
        }
        match.members.append(FinalMember(userId: currentUserId ?? "stub-me", displayName: "我"))
        if match.members.count == match.mode.playerCount {
            var rng = SystemRandomNumberGenerator()
            let winds = match.mode.winds.shuffled(using: &rng)
            match.seats = zip(winds, match.members).enumerated().map {
                FinalSeat(wind: $0.element.0, userId: $0.element.1.userId, displayName: $0.element.1.displayName, seatNo: $0.offset)
            }
            match.status = "in_progress"
            match.startedAt = ISO8601DateFormatter().string(from: Date())
        }
        matches[index] = match
        return match
    }

    func submitFinalScores(matchId: String, scores: [FinalScoreEntry], correction: Bool) async throws -> FinalMatch {
        guard let index = matches.firstIndex(where: { $0.id == matchId }) else {
            throw APIError(status: 404, code: "match_not_found", message: "牌桌不存在")
        }
        var match = matches[index]
        guard match.hostId == currentUserId else {
            throw APIError(status: 403, code: "forbidden", message: "只有房主可以记分")
        }
        if correction {
            guard match.isFinished else {
                throw APIError(status: 409, code: "match_not_finished", message: "牌局尚未结束")
            }
        } else {
            guard match.isInProgress else {
                throw APIError(status: 409, code: "match_not_in_progress", message: "牌局不在进行中")
            }
        }
        let pairs = scores.map { (wind: $0.wind, score: Optional($0.score)) }
        if let error = FinalScoreLogic.validationError(scores: pairs, mode: match.mode) {
            throw APIError(status: 400, code: "sum_mismatch", message: error)
        }
        // 座次锁定：纠正只改分数，不接受座位变更。
        let ranked = FinalScoreLogic.entriesWithRanks(scores.map { (wind: $0.wind, score: $0.score) }, mode: match.mode)
        match.finalScores = ranked
        if correction {
            match.correctedAt = ISO8601DateFormatter().string(from: Date())
        } else {
            match.status = "finished"
            match.finishedAt = ISO8601DateFormatter().string(from: Date())
        }
        matches[index] = match
        return match
    }

    func cancel(matchId: String) async throws -> FinalMatch {
        guard let index = matches.firstIndex(where: { $0.id == matchId }) else {
            throw APIError(status: 404, code: "match_not_found", message: "牌桌不存在")
        }
        var match = matches[index]
        guard match.hostId == currentUserId else {
            throw APIError(status: 403, code: "forbidden", message: "只有房主可以取消")
        }
        guard !match.isFinished else {
            throw APIError(status: 409, code: "match_already_started", message: "已结束的牌局无法取消")
        }
        match.status = "cancelled"
        matches[index] = match
        return match
    }

    func adminPlayers() async throws -> [AdminPlayer] {
        guard isAdmin else { throw APIError(status: 403, code: "forbidden", message: "只有管理员可以查看") }
        var counts: [String: (name: String, count: Int)] = [:]
        for match in matches {
            for member in match.members {
                counts[member.userId, default: (member.displayName, 0)].count += 1
            }
        }
        return counts.map { AdminPlayer(id: $0.key, name: $0.value.name, matchCount: $0.value.count) }
            .sorted { $0.matchCount > $1.matchCount }
    }

    func adminMatches() async throws -> [FinalMatch] {
        guard isAdmin else { throw APIError(status: 403, code: "forbidden", message: "只有管理员可以查看") }
        return matches
    }

    func deleteAdmin(matchId: String) async throws {
        guard isAdmin else { throw APIError(status: 403, code: "forbidden", message: "只有管理员可以删除") }
        matches.removeAll { $0.id == matchId }
    }

    func correctAdmin(matchId: String, scores: [FinalScoreEntry]) async throws -> FinalMatch {
        // 管理员纠正不要求管理员本人是房主：不走房主校验的 submit 路径，
        // 直接按同校验改写（线上以 API 的 403 为准）。
        guard isAdmin else { throw APIError(status: 403, code: "forbidden", message: "只有管理员可以纠正") }
        guard let index = matches.firstIndex(where: { $0.id == matchId }) else {
            throw APIError(status: 404, code: "match_not_found", message: "牌桌不存在")
        }
        var match = matches[index]
        guard match.isFinished else {
            throw APIError(status: 409, code: "match_not_finished", message: "牌局尚未结束")
        }
        let pairs = scores.map { (wind: $0.wind, score: Optional($0.score)) }
        if let error = FinalScoreLogic.validationError(scores: pairs, mode: match.mode) {
            throw APIError(status: 400, code: "sum_mismatch", message: error)
        }
        match.finalScores = FinalScoreLogic.entriesWithRanks(scores.map { (wind: $0.wind, score: $0.score) }, mode: match.mode)
        match.correctedAt = ISO8601DateFormatter().string(from: Date())
        matches[index] = match
        return match
    }
}
