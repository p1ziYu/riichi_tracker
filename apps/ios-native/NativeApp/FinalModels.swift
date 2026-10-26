import Foundation

// 最后一版原生共享模型（spec §1/§2）。
// 只记终局得点：单位 = 实际点数 ÷ 100；个人范围 -9999~9999；
// 四麻合计 1000，三麻合计 1050；同点顺位按风序 东 > 南 > 西 > 北。

enum FinalMode: String, Codable, CaseIterable {
    case three = "3p"
    case four = "4p"

    var winds: [String] {
        switch self {
        case .three: return ["E", "S", "W"]
        case .four: return ["E", "S", "W", "N"]
        }
    }
    var total: Int { self == .three ? 1050 : 1000 }
    var playerCount: Int { winds.count }
    var label: String { self == .three ? "三麻" : "四麻" }
    var windOrder: [String: Int] {
        Dictionary(uniqueKeysWithValues: winds.enumerated().map { ($1, $0) })
    }
}

struct FinalMember: Codable, Hashable {
    let userId: String
    let displayName: String
    // API 实测视图：members[{userId, displayName, isHost}]。
    var isHost: Bool = false

    private enum Keys: String, CodingKey { case userId, principalId, id, displayName, name, isHost }

    init(userId: String, displayName: String, isHost: Bool = false) {
        self.userId = userId
        self.displayName = displayName
        self.isHost = isHost
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        userId = try fields.decodeIfPresent(String.self, forKey: .userId)
            ?? fields.decodeIfPresent(String.self, forKey: .principalId)
            ?? fields.decodeIfPresent(String.self, forKey: .id)
            ?? ""
        displayName = try fields.decodeIfPresent(String.self, forKey: .displayName)
            ?? fields.decodeIfPresent(String.self, forKey: .name)
            ?? userId
        isHost = try fields.decodeIfPresent(Bool.self, forKey: .isHost) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: Keys.self)
        try fields.encode(userId, forKey: .userId)
        try fields.encode(displayName, forKey: .displayName)
        try fields.encode(isHost, forKey: .isHost)
    }
}

// API 实测视图：seats[{seatNo, userId, wind}]（人齐前为空），
// 座位本身不带显示名——显示名一律按 userId 查 members 得到。
struct FinalSeat: Codable, Hashable {
    let wind: String
    let userId: String?
    let seatNo: Int?
    let displayName: String?

    private enum Keys: String, CodingKey { case wind, userId, principalId, id, displayName, name, seatNo }

    init(wind: String, userId: String?, displayName: String? = nil, seatNo: Int? = nil) {
        self.wind = wind
        self.userId = userId
        self.displayName = displayName
        self.seatNo = seatNo
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        wind = try fields.decodeIfPresent(String.self, forKey: .wind) ?? "?"
        userId = try fields.decodeIfPresent(String.self, forKey: .userId)
            ?? fields.decodeIfPresent(String.self, forKey: .principalId)
            ?? fields.decodeIfPresent(String.self, forKey: .id)
        displayName = try fields.decodeIfPresent(String.self, forKey: .displayName)
            ?? fields.decodeIfPresent(String.self, forKey: .name)
        seatNo = try fields.decodeIfPresent(Int.self, forKey: .seatNo)
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: Keys.self)
        try fields.encode(wind, forKey: .wind)
        try fields.encodeIfPresent(userId, forKey: .userId)
        try fields.encodeIfPresent(displayName, forKey: .displayName)
        try fields.encodeIfPresent(seatNo, forKey: .seatNo)
    }
}

struct FinalScoreEntry: Codable, Hashable {
    let wind: String
    let score: Int
    var rank: Int

    init(wind: String, score: Int, rank: Int = 0) {
        self.wind = wind
        self.score = score
        self.rank = rank
    }
}

struct FinalMatch: Codable, Hashable, Identifiable {
    var id: String
    var mode: FinalMode
    var status: String
    var hostId: String?
    var joinCode: String?
    var members: [FinalMember]
    var seats: [FinalSeat]
    var finalScores: [FinalScoreEntry]?
    var createdAt: String?
    var startedAt: String?
    var finishedAt: String?
    var correctedAt: String?

    static func == (lhs: FinalMatch, rhs: FinalMatch) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var isWaiting: Bool { status == "waiting" || status == "preparing" }
    var isInProgress: Bool { status == "in_progress" || status == "active" }
    var isFinished: Bool { ["finished", "completed", "settled"].contains(status) }
    var isCancelled: Bool { status == "cancelled" || status == "abandoned" }
    var seatsDrawn: Bool { !seats.isEmpty }

    func statusLabel() -> String {
        switch status {
        case "waiting", "preparing": return "等待人齐"
        case "in_progress", "active": return "进行中"
        case "finished", "completed", "settled": return "已结束"
        case "cancelled", "abandoned": return "已取消"
        default: return "未知状态"
        }
    }

    private enum Keys: String, CodingKey {
        case id, mode, status, hostId, ownerPrincipalId, joinCode, members, seats, finalScores,
             createdAt, startedAt, finishedAt, correctedAt
    }

    init(id: String, mode: FinalMode, status: String, hostId: String?, joinCode: String?,
         members: [FinalMember], seats: [FinalSeat], finalScores: [FinalScoreEntry]?,
         createdAt: String? = nil, startedAt: String? = nil, finishedAt: String? = nil, correctedAt: String? = nil) {
        self.id = id
        self.mode = mode
        self.status = status
        self.hostId = hostId
        self.joinCode = joinCode
        self.members = members
        self.seats = seats
        self.finalScores = finalScores
        self.createdAt = createdAt
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.correctedAt = correctedAt
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        id = try fields.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        mode = try fields.decodeIfPresent(FinalMode.self, forKey: .mode) ?? .four
        status = try fields.decodeIfPresent(String.self, forKey: .status) ?? "waiting"
        hostId = try fields.decodeIfPresent(String.self, forKey: .hostId)
            ?? fields.decodeIfPresent(String.self, forKey: .ownerPrincipalId)
        joinCode = try fields.decodeIfPresent(String.self, forKey: .joinCode)
        members = try fields.decodeIfPresent([FinalMember].self, forKey: .members) ?? []
        seats = try fields.decodeIfPresent([FinalSeat].self, forKey: .seats) ?? []
        finalScores = try fields.decodeIfPresent([FinalScoreEntry].self, forKey: .finalScores)
        createdAt = try fields.decodeIfPresent(String.self, forKey: .createdAt)
        startedAt = try fields.decodeIfPresent(String.self, forKey: .startedAt)
        finishedAt = try fields.decodeIfPresent(String.self, forKey: .finishedAt)
        correctedAt = try fields.decodeIfPresent(String.self, forKey: .correctedAt)
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: Keys.self)
        try fields.encode(id, forKey: .id)
        try fields.encode(mode, forKey: .mode)
        try fields.encode(status, forKey: .status)
        try fields.encodeIfPresent(hostId, forKey: .hostId)
        try fields.encodeIfPresent(joinCode, forKey: .joinCode)
        try fields.encode(members, forKey: .members)
        try fields.encode(seats, forKey: .seats)
        try fields.encodeIfPresent(finalScores, forKey: .finalScores)
        try fields.encodeIfPresent(createdAt, forKey: .createdAt)
        try fields.encodeIfPresent(startedAt, forKey: .startedAt)
        try fields.encodeIfPresent(finishedAt, forKey: .finishedAt)
        try fields.encodeIfPresent(correctedAt, forKey: .correctedAt)
    }
}

struct AdminPlayer: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let matchCount: Int

    private enum Keys: String, CodingKey { case id, userId, name, displayName, matchCount, matches }

    init(id: String, name: String, matchCount: Int) {
        self.id = id
        self.name = name
        self.matchCount = matchCount
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        id = try fields.decodeIfPresent(String.self, forKey: .id)
            ?? fields.decodeIfPresent(String.self, forKey: .userId) ?? ""
        name = try fields.decodeIfPresent(String.self, forKey: .name)
            ?? fields.decodeIfPresent(String.self, forKey: .displayName) ?? id
        matchCount = try fields.decodeIfPresent(Int.self, forKey: .matchCount)
            ?? fields.decodeIfPresent(Int.self, forKey: .matches) ?? 0
    }
}

/// 终局记分纯逻辑：校验 + 同点风序顺位。UI 与 stub/在线共用同一份实现。
enum FinalScoreLogic {
    /// 得点输入解析：允许前导负号、千分位逗号与空格；空串为 nil（未填）。
    static func parse(_ text: String) -> Int? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "，", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard !cleaned.isEmpty else { return nil }
        guard cleaned.range(of: #"^-?\d+$"#, options: .regularExpression) != nil else { return nil }
        return Int(cleaned)
    }

    /// 返回 nil 表示可保存；否则返回中文提示。
    static func validationError(scores: [(wind: String, score: Int?)], mode: FinalMode) -> String? {
        guard scores.count == mode.playerCount else { return "座位不全，无法保存。" }
        for entry in scores {
            guard let score = entry.score else { return "还有座位未填得点。" }
            guard (-9999...9999).contains(score) else { return "得点超出范围（-9999~9999）。" }
        }
        let sum = scores.compactMap { $0.score }.reduce(0, +)
        guard sum == mode.total else { return "当前合计 \(sum) / \(mode.total)，合计不对，无法保存。" }
        return nil
    }

    /// 顺位：得分高者在前；同点按风序 东 > 南 > 西 > 北。顺位互不相同（1…n）。
    static func ranks(for scores: [(wind: String, score: Int)], mode: FinalMode) -> [String: Int] {
        let order = mode.windOrder
        let sorted = scores.sorted {
            if $0.score != $1.score { return $0.score > $1.score }
            return (order[$0.wind] ?? 99) < (order[$1.wind] ?? 99)
        }
        var result: [String: Int] = [:]
        for (index, entry) in sorted.enumerated() { result[entry.wind] = index + 1 }
        return result
    }

    static func entriesWithRanks(_ scores: [(wind: String, score: Int)], mode: FinalMode) -> [FinalScoreEntry] {
        let ranks = ranks(for: scores, mode: mode)
        return scores.map { FinalScoreEntry(wind: $0.wind, score: $0.score, rank: ranks[$0.wind] ?? 0) }
    }

    /// 随机分座：风序洗牌后依次分给成员。东座即庄家（起家）。
    static func shuffledSeats<RNG: RandomNumberGenerator>(names: [String], mode: FinalMode, using rng: inout RNG) -> [FinalSeat] {
        let winds = mode.winds.shuffled(using: &rng)
        return zip(winds, names).map { FinalSeat(wind: $0.0, userId: nil, displayName: $0.1) }
    }
}

/// 加入目标：链接/深链进来即成员，不再经过签到页。
/// 接受：https://riichi.p1ziyu.com/checkin/<id>[?token=…]、
/// ichihime-native://checkin/<id>[?token=…]、https://…/matches/<id>?code=XXXXXX。
struct JoinDestination {
    let matchID: String
    let token: String?
    let code: String?

    init?(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              components.user == nil, components.password == nil,
              components.port == nil, components.fragment == nil else { return nil }
        let scheme = components.scheme?.lowercased()
        let host = components.host?.lowercased()
        let path = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false)
        let query = components.queryItems ?? []
        let tokens = query.filter { $0.name == "token" }
        let codes = query.filter { $0.name == "code" }
        guard tokens.count <= 1, codes.count <= 1 else { return nil }
        let tokenValue = tokens.first?.value
        if let tokenValue, tokenValue.isEmpty { return nil }
        var id: String?
        if scheme == "https", host == "riichi.p1ziyu.com", path.count == 3, path[0].isEmpty, path[1] == "checkin" {
            id = String(path[2])
        } else if scheme == "ichihime-native", host == "checkin", path.count == 2, path[0].isEmpty {
            id = String(path[1])
        } else if scheme == "https", host == "riichi.p1ziyu.com", path.count == 3, path[0].isEmpty, path[1] == "matches" {
            id = String(path[2])
        } else if scheme == "ichihime-native", host == "checkin", path.isEmpty || path == ["/"] || path == [""] {
            let ids = query.filter { $0.name == "matchId" }
            guard ids.count == 1, let value = ids.first?.value else { return nil }
            id = value
        }
        guard let id, id.count == 36, UUID(uuidString: id) != nil else { return nil }
        matchID = id
        token = tokenValue
        code = codes.first?.value.flatMap { JoinFlow.canonicalCode($0) }
    }
}

enum JoinFlow {
    /// 6 位房间码：大写字母+数字，32 符号（去 0/1/I/O）。
    static func canonicalCode(_ code: String) -> String? {
        let canonical = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard canonical.count == 6,
              canonical.allSatisfy({ "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }) else { return nil }
        return canonical
    }
}
