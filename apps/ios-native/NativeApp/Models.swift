import Foundation

indirect enum JSONValue: Codable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let object = try? value.decode([String: JSONValue].self) { self = .object(object) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else { self = .string(try value.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let object): try value.encode(object)
        case .array(let array): try value.encode(array)
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .bool(let bool): try value.encode(bool)
        case .null: try value.encodeNil()
        }
    }

    var object: [String: JSONValue]? {
        guard case .object(let object) = self else { return nil }
        return object
    }
    var arrayValue: [JSONValue]? {
        guard case .array(let values) = self else { return nil }
        return values
    }

    var string: String? {
        guard case .string(let string) = self else { return nil }
        return string
    }
}

struct MatchSummary: Codable, Identifiable {
    let id: String
    let status: String
    let playerCount: Int
    let createdAt: String
    let updatedAt: String?
    let rulesSnapshot: [String: JSONValue]?
    let rulesetVersionId: String?
    // Served by GET /api/matches?mine=1; defaulted so older fixtures that
    // omit them still decode. isOwner decides DELETE-vs-hide (iosfix6).
    // MUST be var: Swift's synthesized Decodable skips `let` properties
    // with defaults ("immutable property will not be decoded"), so `let`
    // silently pinned isOwner to false and DELETE was unreachable —
    // caught by the disposable-backend delete test 2026-10-24.
    var isOwner: Bool = false
    var hidden: Bool = false
}

struct TemplateDTO: Codable, Identifiable {
    let versionId: String
    let name: String
    let scope: String
    let reviewStatus: String
    let config: [String: JSONValue]?

    var id: String { versionId }
}

struct MatchDTO: Codable {
    let id: String
    let status: String
    let ownerPrincipalId: String?
    let joinCode: String?
    let settlementConfirmed: Bool?
    let version: Int?
    let playerCount: Int
    let rulesSnapshot: [String: JSONValue]?
    let rulesetVersionId: String?
    let createdAt: String?
    let seatingDrawnAt: String?
    let dealerSeatNo: Int?

    init(id: String, status: String, ownerPrincipalId: String?, joinCode: String?,
         settlementConfirmed: Bool?, version: Int?, playerCount: Int,
         rulesSnapshot: [String: JSONValue]?, rulesetVersionId: String?, createdAt: String?,
         seatingDrawnAt: String? = nil, dealerSeatNo: Int? = nil) {
        self.id = id
        self.status = status
        self.ownerPrincipalId = ownerPrincipalId
        self.joinCode = joinCode
        self.settlementConfirmed = settlementConfirmed
        self.version = version
        self.playerCount = playerCount
        self.rulesSnapshot = rulesSnapshot
        self.rulesetVersionId = rulesetVersionId
        self.createdAt = createdAt
        self.seatingDrawnAt = seatingDrawnAt
        self.dealerSeatNo = dealerSeatNo
    }
}

struct SeatDTO: Codable, Identifiable {
    let principalId: String?
    let seatNo: Int
    let displayName: String?
    let points: Int?
    let status: String?

    var id: Int { seatNo }
}

struct RiichiUsageDTO: Codable {
    let declares: Int
    let cancels: Int
}

struct HandSeatDTO: Codable {
    let seatNo: Int
    let isRiichi: Bool
    let riichiChangeUsage: RiichiUsageDTO
}

struct CurrentHandDTO: Codable {
    let id: String
    let state: String
    let markRevision: Int64
    let roundWind: String?
    let roundNumber: Int?
    let dealerSeatNo: Int?
    let honba: Int?
    let riichiPool: Int?
    let seats: [HandSeatDTO]
}

struct MatchMemberDTO: Codable, Identifiable {
    let principalId: String
    let displayName: String
    let isOwner: Bool
    let seatNo: Int?
    let wind: String?

    var id: String { principalId }
}

struct TableSnapshot: Codable {
    let match: MatchDTO
    let seats: [SeatDTO]
    let members: [MatchMemberDTO]
    let currentHand: CurrentHandDTO?

    private enum CodingKeys: String, CodingKey { case match, seats, currentHand, members }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        match = try fields.decode(MatchDTO.self, forKey: .match)
        seats = try fields.decode([SeatDTO].self, forKey: .seats)
        currentHand = try fields.decodeIfPresent(CurrentHandDTO.self, forKey: .currentHand)
        members = try fields.decodeIfPresent([MatchMemberDTO].self, forKey: .members) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(match, forKey: .match)
        try fields.encode(seats, forKey: .seats)
        try fields.encodeIfPresent(currentHand, forKey: .currentHand)
        try fields.encode(members, forKey: .members)
    }

    init(match: MatchDTO, seats: [SeatDTO], currentHand: CurrentHandDTO?, members: [MatchMemberDTO] = []) {
        self.match = match
        self.seats = seats
        self.currentHand = currentHand
        self.members = members
    }
}

struct HandDeltaDTO: Codable {
    let seatNo: Int
    let netPoints: Int
}

struct HandDTO: Codable, Identifiable {
    let handNo: Int
    let roundWind: String
    let roundNumber: Int
    let dealerSeatNo: Int
    let honba: Int
    let kind: String
    let perSeat: [HandDeltaDTO]

    var id: Int { handNo }
}

struct StandingDTO: Codable {
    let seatNo: Int
    let rank: Int
    let finalPoints: Int
    let totalTenths: Int
}

struct SettlementPreview: Codable {
    let terminalTenths: [Int]
    let standings: [StandingDTO]

    private enum CodingKeys: String, CodingKey { case terminalTenths, standings }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        terminalTenths = try fields.decode([Int].self, forKey: .terminalTenths)
        standings = try fields.decodeIfPresent([StandingDTO].self, forKey: .standings) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(terminalTenths, forKey: .terminalTenths)
        try fields.encode(standings, forKey: .standings)
    }
}

struct PrincipalDTO: Codable {
    let id: String
    let displayName: String
    let type: String
    let createdAt: String?
}

struct MeResponse: Codable {
    let principal: PrincipalDTO
}

struct TicketDTO: Codable {
    let ticket: String
}
struct CreatedMatchDTO: Decodable {
    struct Match: Decodable { let id: String }
    let match: Match
}

struct CheckInTokenDTO: Decodable {
    let token: String
    let expiresAt: String
}

struct JoinCodeDTO: Decodable {
    let matchId: String
    let token: String
    let expiresAt: String
}

struct CheckInSeatsDTO: Decodable {
    struct Match: Decodable {
        let id: String
        let playerCount: Int
        let status: String
    }
    struct Caller: Decodable {
        let principalId: String
        let isOwner: Bool
        let isMember: Bool
    }
    struct Seating: Decodable {
        let drawn: Bool
        let dealerSeatNo: Int?
        let memberCount: Int
        let seatedCount: Int
    }
    struct Seat: Decodable {
        let seatNo: Int
        let principalId: String?
        let displayName: String?
        let status: String?
    }

    let match: Match
    let caller: Caller
    let members: [MatchMemberDTO]
    let seating: Seating
    let seats: [Seat]

    private enum CodingKeys: String, CodingKey { case match, caller, members, seating, seats }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        match = try fields.decode(Match.self, forKey: .match)
        caller = try fields.decode(Caller.self, forKey: .caller)
        members = try fields.decode([MatchMemberDTO].self, forKey: .members)
        seating = try fields.decode(Seating.self, forKey: .seating)
        seats = try fields.decodeIfPresent([Seat].self, forKey: .seats) ?? []
    }
}

struct CheckInResultDTO: Decodable {
    struct Member: Decodable {
        let principalId: String
        let displayName: String
    }
    let member: Member
    let seated: Bool
    let grantId: String
}

struct CommandReceiptDTO: Decodable {
    let markRevision: Int64?
    let settlementId: String?
}

struct PaymentDTO: Decodable {
    struct Part: Decodable { let reason: String; let amount: Int }
    let seatNo: Int
    let netPoints: Int
    let breakdown: [Part]
}

struct NextHandDTO: Decodable {
    let roundWind: String
    let roundNumber: Int
    let dealerSeatNo: Int
    let honba: Int
    let riichiPool: Int
}

struct PaymentPreviewDTO: Decodable {
    let perSeat: [PaymentDTO]
    let nextHand: NextHandDTO
}


struct RuleDetails {
    let title: String
    let source: String
    let reviewStatus: String
    let customizedKeys: [String]
}

func poolSticks(points: Int) -> Int { points / 1_000 }

func ruleDetails(snapshot: [String: JSONValue]?, template: TemplateDTO?) -> RuleDetails {
    let metadata = snapshot?["metadata"]?.object
    let title = metadata?["baseTemplateName"]?.string ?? template?.name ?? "规则模板未提供"
    let source = template?.scope ?? metadata?["baseTemplateScope"]?.string ?? "来源未提供"
    let reviewStatus = template?.reviewStatus ?? metadata?["reviewStatus"]?.string ?? "审核状态未提供"
    let base = metadata?["baseConfig"]?.object ?? template?.config
    let excluded: Set<String> = ["metadata", "oka", "okaTenths", "umaTenths", "startPoints", "endTarget", "ryuukyokuPenaltyTotal", "ryuukyokuPoolTotal", "bustEndsMatch"]
    let customizedKeys: [String]
    if let snapshot = snapshot, let base = base {
        customizedKeys = snapshot.keys.filter { key in
            !excluded.contains(key) && base[key] != nil && snapshot[key] != base[key]
        }.sorted()
    } else {
        customizedKeys = []
    }
    return RuleDetails(title: title, source: source, reviewStatus: reviewStatus, customizedKeys: customizedKeys)
}
