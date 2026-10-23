import Foundation
import Combine
import SQLite3
import CryptoKit

struct LocalSeat: Codable, Equatable, Identifiable {
    let seatNo: Int
    var displayName: String
    var id: Int { seatNo }
}

struct LocalHandSeat: Codable, Equatable {
    let seatNo: Int
    let points: Int
    var isRiichi: Bool
    var declares: Int
    var cancels: Int
}

struct LocalNextHand: Codable, Equatable {
    let roundWind: String
    let roundNumber: Int
    let dealerSeatNo: Int
    let honba: Int
    let riichiPool: Int
}

struct LocalHand: Codable, Equatable {
    let handId: String
    let roundWind: String
    let roundNumber: Int
    let dealerSeatNo: Int
    let honba: Int
    let riichiPool: Int
    var markRevision: Int
    let resultRevision: Int
    var seats: [LocalHandSeat]
}

struct LocalResult: Codable, Identifiable {
    let hand: LocalHand
    let input: [String: JSONValue]
    let output: [String: JSONValue]
    let settledAt: String
    var id: String { hand.handId }
}

struct LocalDraft: Codable {
    let handId: String
    let value: ResultDraft
}

struct LocalMatch: Codable, Identifiable {
    let id: String
    var name: String
    let createdAt: String
    var updatedAt: String
    var status: String
    let seedKey: String
    let templateName: String
    let reviewStatus: String
    let rulesHash: String
    let startingDealerSeatNo: Int
    let engineVersion: String
    let rules: [String: JSONValue]
    let baseRules: [String: JSONValue]?
    var seats: [LocalSeat]
    var points: [Int]
    var currentHand: LocalHand?
    var draft: LocalDraft?
    var nextHand: LocalNextHand?
    var results: [LocalResult]
    var terminal: [String: JSONValue]?
    var settlementConfirmed: Bool
    var customizedKeys: [String] {
        guard let baseRules else { return [] }
        return Set(rules.keys).union(baseRules.keys).filter { $0 != "oka" && rules[$0] != baseRules[$0] }.sorted()
    }
}

struct LocalTemplate: Identifiable {
    let id: String
    let name: String
    let reviewStatus: String
    static let all: [Self] = [
        .init(id: "house_4p", name: "四麻家规", reviewStatus: "已审核"),
        .init(id: "reference_4p_competition", name: "四麻国际竞技参考", reviewStatus: "待审核"),
        .init(id: "house_3p", name: "三麻家规", reviewStatus: "已审核"),
        .init(id: "reference_3p_common", name: "三麻常见玩法参考", reviewStatus: "待审核")
    ]
}

struct LocalFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Stored snapshots and settlement outputs are authoritative. This file is separate from
/// account caches, Keychain credentials, and any online pending-result directories.
@MainActor final class LocalMatchStore: ObservableObject {
    @Published private(set) var matches: [LocalMatch] = []
    @Published private(set) var failure: String?
    private let location: URL
    private var db: OpaquePointer?
    private static let migrations: [(Int, String)] = [
        (1, "CREATE TABLE local_matches (id TEXT PRIMARY KEY NOT NULL, payload BLOB NOT NULL, updated_at TEXT NOT NULL); " +
            "CREATE TABLE settlement_journal (hand_id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL REFERENCES local_matches(id) ON DELETE CASCADE, payload BLOB NOT NULL);")
    ]

    init(location: URL? = nil) {
        self.location = location ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LocalMatches.sqlite3")
        do { try open(); try reload() }
        catch { failure = error.localizedDescription; close() }
    }
    deinit { if let db { sqlite3_close(db) } }
    private func close() { if let db { sqlite3_close(db); self.db = nil } }
    private func error(_ prefix: String) -> LocalFailure {
        LocalFailure(message: "\(prefix)：\(db.map { String(cString: sqlite3_errmsg($0)) } ?? "数据库不可用")；原始文件未清空，请先备份。")
    }
    private func run(_ sql: String) throws {
        guard let db, sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw error("本地数据库操作失败") }
    }
    private func open() throws {
        try FileManager.default.createDirectory(at: location.deletingLastPathComponent(), withIntermediateDirectories: true)
        // Opening an unknown-version file must not alter it: check the version read-only first.
        if FileManager.default.fileExists(atPath: location.path) {
            var probe: OpaquePointer?
            guard sqlite3_open_v2(location.path, &probe, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                if let probe { sqlite3_close(probe) }
                throw LocalFailure(message: "本地数据库损坏或不可读；原文件已保留。")
            }
            defer { sqlite3_close(probe) }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(probe, "PRAGMA user_version", -1, &statement, nil) == SQLITE_OK else {
                throw LocalFailure(message: "本地数据库版本不可读；原文件已保留。")
            }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW else { throw LocalFailure(message: "本地数据库版本不可读；原文件已保留。") }
            let version = sqlite3_column_int(statement, 0)
            guard version >= 0 && version <= Self.migrations.count else {
                throw LocalFailure(message: "本地数据库版本 \(version) 不兼容；原文件已保留。")
            }
            if version == 0 {
                var check: OpaquePointer?
                guard sqlite3_prepare_v2(probe, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", -1, &check, nil) == SQLITE_OK else {
                    throw LocalFailure(message: "本地数据库结构不可读；原文件已保留。")
                }
                defer { sqlite3_finalize(check) }
                guard sqlite3_step(check) == SQLITE_ROW && sqlite3_column_int(check, 0) == 0 else {
                    throw LocalFailure(message: "本地数据库缺少版本标记；原文件已保留。")
                }
            }
            var integrity: OpaquePointer?
            guard sqlite3_prepare_v2(probe, "PRAGMA quick_check", -1, &integrity, nil) == SQLITE_OK else {
                throw LocalFailure(message: "本地数据库完整性检查失败；原文件已保留。")
            }
            defer { sqlite3_finalize(integrity) }
            guard sqlite3_step(integrity) == SQLITE_ROW,
                  String(cString: sqlite3_column_text(integrity, 0)) == "ok" else {
                throw LocalFailure(message: "本地数据库损坏；原文件已保留。")
            }
        }
        guard sqlite3_open_v2(location.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw error("无法打开本地数据库")
        }
        try run("PRAGMA foreign_keys = ON")
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &statement, nil) == SQLITE_OK else { throw error("无法读取版本") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw error("无法读取版本") }
        let version = Int(sqlite3_column_int(statement, 0))
        for (number, sql) in Self.migrations where number > version {
            try run("BEGIN IMMEDIATE")
            do { try run(sql); try run("PRAGMA user_version = \(number)"); try run("COMMIT") }
            catch { try? run("ROLLBACK"); throw self.error("本地迁移失败") }
        }
    }
    private func statement(_ sql: String) throws -> OpaquePointer {
        var query: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &query, nil) == SQLITE_OK, let query else { throw error("无法读取本地记录") }
        return query
    }
    private func bind(_ value: String, at index: Int32, to query: OpaquePointer) {
        sqlite3_bind_text(query, index, value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }
    private func bind(_ value: Data, at index: Int32, to query: OpaquePointer) {
        _ = value.withUnsafeBytes { bytes in sqlite3_bind_blob(query, index, bytes.baseAddress, Int32(bytes.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
    }
    private func decode(_ query: OpaquePointer, column: Int32 = 0) throws -> LocalMatch {
        guard let blob = sqlite3_column_blob(query, column) else { throw error("本地记录不完整") }
        let data = Data(bytes: blob, count: Int(sqlite3_column_bytes(query, column)))
        do {
            let match = try JSONDecoder().decode(LocalMatch.self, from: data)
            try validate(match)
            return match
        } catch {
            throw LocalFailure(message: "本地记录损坏，原文件已保留：\(error.localizedDescription)")
        }
    }
    private func storedInt(_ value: JSONValue?) -> Int? {
        guard case .number(let number)? = value else { return nil }
        return Int(exactly: number)
    }
    private static func rulesDigest(_ rules: [String: JSONValue]) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return SHA256.hash(data: try encoder.encode(rules))
            .map { String(format: "%02x", $0) }.joined()
    }
    private func validate(_ match: LocalMatch) throws {
        func invalid() -> LocalFailure { LocalFailure(message: "本地记录结构不完整，原文件已保留。") }
        guard match.id.hasPrefix("local-"), !match.name.isEmpty, !match.engineVersion.isEmpty,
              let digest = try? Self.rulesDigest(match.rules), match.rulesHash == digest,
              !match.createdAt.isEmpty, !match.updatedAt.isEmpty,
              match.status == "active" || match.status == "finished",
              case .number(let playerCount)? = match.rules["playerCount"],
              (playerCount == 3 || playerCount == 4), let count = Int(exactly: playerCount),
              match.seats.count == count, match.points.count == count,
              (0..<count).contains(match.startingDealerSeatNo),
              Set(match.seats.map(\.seatNo)) == Set(0..<count),
              match.seats.allSatisfy({ !$0.displayName.isEmpty && $0.displayName.count <= 40 }),
              match.points.allSatisfy({ (-2_147_483_647...2_147_483_647).contains($0) }),
              match.nextHand != nil,
              (match.status != "finished" || match.currentHand == nil),
              (!match.settlementConfirmed || (match.status == "finished" && match.terminal?["isGameEnd"] == .bool(true)))
        else { throw invalid() }

        func validNext(_ roundWind: String, _ roundNumber: Int, _ dealer: Int, _ honba: Int, _ pool: Int) -> Bool {
            ["E", "S", "W"].contains(roundWind) && (1...count).contains(roundNumber) &&
                (0..<count).contains(dealer) && honba >= 0 && pool >= 0 && pool % 1000 == 0
        }
        func validHand(_ hand: LocalHand) -> Bool {
            !hand.handId.isEmpty && validNext(hand.roundWind, hand.roundNumber, hand.dealerSeatNo, hand.honba, hand.riichiPool) &&
                hand.markRevision >= 0 && hand.resultRevision >= 0 && hand.seats.count == count &&
                Set(hand.seats.map(\.seatNo)) == Set(0..<count) &&
                hand.seats.allSatisfy { seat in
                    (-2_147_483_647...2_147_483_647).contains(seat.points) &&
                        (0...2).contains(seat.declares) && (0...1).contains(seat.cancels) &&
                        seat.declares - seat.cancels == (seat.isRiichi ? 1 : 0)
                }
        }
        func validOutput(_ output: [String: JSONValue], oldPool: Int) -> Bool {
            guard let rows = output["perSeat"]?.arrayValue, rows.count == count,
                  let rawNext = output["nextHand"]?.object,
                  let roundWind = rawNext["roundWind"]?.string,
                  let round = storedInt(rawNext["roundNumber"]),
                  let dealer = storedInt(rawNext["dealerSeatNo"]),
                  let honba = storedInt(rawNext["honba"]),
                  let pool = storedInt(rawNext["riichiPool"]),
                  validNext(roundWind, round, dealer, honba, pool) else { return false }
            var seen = Set<Int>()
            var total: Int64 = 0
            for row in rows {
                guard let fields = row.object, let seat = storedInt(fields["seatNo"]), (0..<count).contains(seat),
                      seen.insert(seat).inserted, let net = storedInt(fields["netPoints"]),
                      (-2_147_483_647...2_147_483_647).contains(net), let parts = fields["breakdown"]?.arrayValue,
                      parts.allSatisfy({ part in
                          guard let detail = part.object, detail["reason"]?.string != nil,
                                let amount = storedInt(detail["amount"]) else { return false }
                          return (-2_147_483_647...2_147_483_647).contains(amount)
                      }) else { return false }
                total += Int64(net)
            }
            return seen.count == count && total + Int64(pool) - Int64(oldPool) == 0
        }
        guard let next = match.nextHand,
              validNext(next.roundWind, next.roundNumber, next.dealerSeatNo, next.honba, next.riichiPool),
              match.currentHand.map(validHand) ?? true,
              match.currentHand.map({ hand in hand.seats.allSatisfy { $0.points == match.points[$0.seatNo] } }) ?? true,
              match.draft == nil || (match.currentHand != nil && match.draft?.handId == match.currentHand?.handId),
              match.results.allSatisfy({ result in
                  validHand(result.hand) && !result.settledAt.isEmpty &&
                      result.input["kind"]?.string != nil &&
                      validOutput(result.output, oldPool: result.hand.riichiPool)
              }),
              Set(match.results.map(\.id)).count == match.results.count
        else { throw invalid() }
    }
    func reload() throws {
        guard failure == nil, db != nil else { throw LocalFailure(message: failure ?? "数据库未打开") }
        let query = try statement("SELECT payload FROM local_matches ORDER BY updated_at DESC")
        defer { sqlite3_finalize(query) }
        var loaded: [LocalMatch] = []
        while true {
            let step = sqlite3_step(query)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw error("本地记录读取失败") }
            loaded.append(try decode(query))
        }
        matches = loaded
    }
    private func current(_ id: String) throws -> LocalMatch {
        let query = try statement("SELECT payload FROM local_matches WHERE id = ?")
        defer { sqlite3_finalize(query) }
        bind(id, at: 1, to: query)
        guard sqlite3_step(query) == SQLITE_ROW else { throw LocalFailure(message: "本地牌桌不存在或已删除") }
        return try decode(query)
    }
    private func transact<T>(_ body: () throws -> T) throws -> T {
        guard failure == nil, db != nil else { throw LocalFailure(message: failure ?? "数据库未打开") }
        try run("BEGIN IMMEDIATE")
        do {
            let value = try body()
            try run("COMMIT")
            try reload()
            return value
        } catch { try? run("ROLLBACK"); throw error }
    }
    private func save(_ match: LocalMatch) throws {
        try validate(match)
        let query = try statement("INSERT INTO local_matches (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
        defer { sqlite3_finalize(query) }
        bind(match.id, at: 1, to: query)
        bind(try JSONEncoder().encode(match), at: 2, to: query)
        bind(match.updatedAt, at: 3, to: query)
        guard sqlite3_step(query) == SQLITE_DONE else { throw error("本地保存失败") }
    }
    private static func json(_ value: Any) throws -> [String: JSONValue] {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        return try JSONDecoder().decode([String: JSONValue].self, from: data)
    }
    private static func object(_ value: [String: JSONValue]) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LocalFailure(message: "保存的引擎输入格式无效")
        }
        return object
    }
    static func templateRules(_ key: String) throws -> [String: JSONValue] {
        try json(EngineBridgeCheck.bundledTemplate(key))
    }
    func create(template: LocalTemplate, rules: [String: JSONValue], name: String, names: [String], dealer: Int) throws -> LocalMatch {
        let baseRules = try Self.templateRules(template.id)
        guard let count = storedInt(baseRules["playerCount"]), let templateKey = baseRules["templateKey"]?.string else {
            throw LocalFailure(message: "本地人数、姓名或起家座位无效")
        }
        var requested = try Self.object(rules)
        requested["templateKey"] = templateKey
        requested["playerCount"] = count
        requested.removeValue(forKey: "oka") // read-only value follows the edited start/return points
        let config = try Self.json(EngineBridgeCheck.normalizedRules(requested))
        let tableName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard names.count == count, names.allSatisfy({ $0.count <= 40 }),
              (0..<count).contains(dealer), !tableName.isEmpty else {
            throw LocalFailure(message: "本地人数、姓名或起家座位无效")
        }
        let start = storedInt(config["startingPoints"]) ?? 0
        guard start > 0 else { throw LocalFailure(message: "起始点数无效") }
        let now = ISO8601DateFormatter().string(from: Date())
        let next = LocalNextHand(roundWind: "E", roundNumber: 1, dealerSeatNo: dealer, honba: 0, riichiPool: 0)
        let hand = LocalHand(handId: UUID().uuidString, roundWind: next.roundWind, roundNumber: 1,
                             dealerSeatNo: dealer, honba: 0, riichiPool: 0, markRevision: 0, resultRevision: 0,
                             seats: (0..<count).map { LocalHandSeat(seatNo: $0, points: start, isRiichi: false, declares: 0, cancels: 0) })
        let match = LocalMatch(id: "local-\(UUID().uuidString)", name: tableName,
                               createdAt: now, updatedAt: now, status: "active", seedKey: template.id,
                               templateName: template.name, reviewStatus: template.reviewStatus,
                               rulesHash: try Self.rulesDigest(config), startingDealerSeatNo: dealer,
                               engineVersion: EngineBridgeCheck.version, rules: config,
                               baseRules: baseRules,
                               seats: (0..<count).map { LocalSeat(seatNo: $0, displayName: names[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "玩家 \($0 + 1)" : names[$0].trimmingCharacters(in: .whitespacesAndNewlines)) },
                               points: Array(repeating: start, count: count), currentHand: hand, draft: nil, nextHand: next,
                               results: [], terminal: nil, settlementConfirmed: false)
        return try transact { try save(match); return match }
    }
    @discardableResult private func update(_ id: String, _ transform: (inout LocalMatch) throws -> Void) throws -> LocalMatch {
        try transact {
            var match = try current(id)
            try transform(&match)
            match.updatedAt = ISO8601DateFormatter().string(from: Date())
            try save(match)
            return match
        }
    }
    func rename(_ id: String, seat: Int, name: String) throws {
        guard name.count <= 40 else { throw LocalFailure(message: "姓名最多 40 字") }
        _ = try update(id) { match in
            guard match.status == "active" else { throw LocalFailure(message: "已结束牌桌的姓名不可修改") }
            guard let index = match.seats.firstIndex(where: { $0.seatNo == seat }) else { throw LocalFailure(message: "座位不存在") }
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            match.seats[index].displayName = trimmed.isEmpty ? "玩家 \(seat + 1)" : trimmed
        }
    }
    func mark(_ id: String, seat: Int) throws {
        _ = try update(id) { match in
            guard match.status == "active", var hand = match.currentHand,
                  let index = hand.seats.firstIndex(where: { $0.seatNo == seat }) else { throw LocalFailure(message: "没有进行中的局") }
            var entry = hand.seats[index]
            guard entry.isRiichi || entry.points >= 1000 || match.rules["allowLowPointRiichi"] == .bool(true) else {
                throw LocalFailure(message: "点数不足，不能立直")
            }
            guard entry.isRiichi ? entry.cancels < 1 : entry.declares < 2 else {
                throw LocalFailure(message: "本局该座位立直次数已达上限（声明 2 次，取消 1 次）")
            }
            if entry.isRiichi { entry.cancels += 1 } else { entry.declares += 1 }
            entry.isRiichi.toggle()
            hand.seats[index] = entry
            hand.markRevision += 1
            match.currentHand = hand
        }
    }
    func saveDraft(_ id: String, handID: String, value: ResultDraft) throws {
        _ = try update(id) { match in
            guard match.status == "active", match.currentHand?.handId == handID else {
                throw LocalFailure(message: "当前局已变化，无法保存结果草稿")
            }
            match.draft = LocalDraft(handId: handID, value: value)
        }
    }
    private static func handObject(_ hand: LocalHand) -> [String: Any] {
        ["handId": hand.handId, "roundWind": hand.roundWind, "roundNumber": hand.roundNumber,
         "dealerSeatNo": hand.dealerSeatNo, "honba": hand.honba, "riichiPool": hand.riichiPool,
         "markRevision": hand.markRevision, "resultRevision": hand.resultRevision,
         "seats": hand.seats.map { ["seatNo": $0.seatNo, "points": $0.points, "isRiichi": $0.isRiichi] as [String: Any] }]
    }
    private static func nextObject(_ hand: LocalNextHand) -> [String: Any] {
        ["roundWind": hand.roundWind, "roundNumber": hand.roundNumber, "dealerSeatNo": hand.dealerSeatNo,
         "honba": hand.honba, "riichiPool": hand.riichiPool]
    }
    private static func calculate(_ match: LocalMatch, _ input: [String: JSONValue]) throws -> [String: JSONValue] {
        guard match.engineVersion == EngineBridgeCheck.version else { throw LocalFailure(message: "旧版引擎的牌桌仅供查看，不能按新算法结算") }
        guard match.status == "active", let hand = match.currentHand else { throw LocalFailure(message: "没有进行中的局") }
        return try json(EngineBridgeCheck.localCalculation("calculateSettlement", [
            ["rulesHash": match.rulesHash, "config": try object(match.rules)], handObject(hand), try object(input), match.engineVersion
        ]))
    }
    func preview(_ id: String, input: [String: JSONValue]) throws -> [String: JSONValue] {
        try Self.calculate(current(id), input)
    }
    func settle(_ id: String, handID: String, revision: Int, input: [String: JSONValue]) throws {
        try transact {
            var match = try current(id)
            guard let hand = match.currentHand, hand.handId == handID, hand.markRevision == revision else {
                throw LocalFailure(message: "局或立直标记已变化，请重新预览")
            }
            let output = try Self.calculate(match, input)
            guard let parts = output["perSeat"]?.arrayValue, parts.count == match.seats.count,
                  let nextValue = output["nextHand"] else { throw LocalFailure(message: "引擎未返回完整支付") }
            let next = try JSONDecoder().decode(LocalNextHand.self, from: JSONEncoder().encode(nextValue))
            var points = match.points
            var seen = Set<Int>()
            for part in parts {
                guard let fields = part.object, case .number(let number)? = fields["seatNo"],
                      case .number(let amount)? = fields["netPoints"], number.rounded() == number,
                      amount.rounded() == amount, let seat = Int(exactly: number),
                      let delta = Int(exactly: amount), (0..<points.count).contains(seat), seen.insert(seat).inserted else {
                    throw LocalFailure(message: "引擎支付数据不完整")
                }
                let (sum, overflow) = points[seat].addingReportingOverflow(delta)
                guard !overflow else { throw LocalFailure(message: "点数超出范围") }
                points[seat] = sum
            }
            guard seen.count == match.seats.count else { throw LocalFailure(message: "引擎支付缺少座位") }
            let ended = try EngineBridgeCheck.localCalculation("isAutomaticMatchEnd", [
                try Self.object(match.rules), Self.handObject(hand), try Self.object(input), Self.nextObject(next),
                points.enumerated().map { ["seatNo": $0.offset, "points": $0.element] }
            ]) as? Bool
            guard let ended else { throw LocalFailure(message: "自动终局结果无效") }
            let settledAt = ISO8601DateFormatter().string(from: Date())
            let result = LocalResult(hand: hand, input: input, output: output, settledAt: settledAt)
            let journal = try statement("INSERT INTO settlement_journal (hand_id,match_id,payload) VALUES (?,?,?)")
            defer { sqlite3_finalize(journal) }
            bind(handID, at: 1, to: journal)
            bind(id, at: 2, to: journal)
            bind(try JSONEncoder().encode(result), at: 3, to: journal)
            guard sqlite3_step(journal) == SQLITE_DONE else { throw error("结算流水写入失败") }
            match.points = points
            match.results.append(result)
            match.currentHand = nil
            match.draft = nil
            match.nextHand = next
            if ended { match.status = "finished" }
            match.updatedAt = settledAt
            try save(match)
        }
    }
    func openHand(_ id: String) throws {
        _ = try update(id) { match in
            guard match.status == "active", match.currentHand == nil, let next = match.nextHand else {
                throw LocalFailure(message: "当前不能新开一局")
            }
            guard !(match.rules["fixedSouth4EndPolicy"] == .string("completed_south_4") && next.roundWind == "W" && next.roundNumber == 1) else {
                throw LocalFailure(message: "固定南四局已结束，请先终局")
            }
            match.currentHand = LocalHand(handId: UUID().uuidString, roundWind: next.roundWind,
                roundNumber: next.roundNumber, dealerSeatNo: next.dealerSeatNo, honba: next.honba,
                riichiPool: next.riichiPool, markRevision: 0, resultRevision: 0,
                seats: match.seats.map { LocalHandSeat(seatNo: $0.seatNo, points: match.points[$0.seatNo],
                                                       isRiichi: false, declares: 0, cancels: 0) })
            match.draft = nil
        }
    }
    func finish(_ id: String) throws {
        _ = try update(id) { match in
            guard match.status == "active" else { throw LocalFailure(message: "牌局已经结束") }
            guard match.rules["automaticEndPolicy"] != .string("ranked_sanma") else {
                throw LocalFailure(message: "段位战结束条件尚未满足，不能手动终局")
            }
            if match.rules["fixedSouth4EndPolicy"] == .string("completed_south_4") {
                guard match.nextHand?.roundWind == "W", match.nextHand?.roundNumber == 1,
                      match.results.contains(where: { $0.hand.roundWind == "S" && $0.hand.roundNumber == 4 }) else {
                    throw LocalFailure(message: "固定南四局尚未结束，不能提前终局")
                }
            } else {
                let target = (match.rules["targetPoints"].flatMap { if case .number(let value) = $0 { Int(exactly: value) } else { nil } }) ?? Int.max
                guard (match.points.max() ?? 0) >= target ||
                      (match.rules["bustEndsGame"] == .bool(true) && match.points.contains(where: { $0 < 0 })) else {
                    throw LocalFailure(message: "尚未达到终局目标点，也没有启用飞人结束的负分座位")
                }
            }
            // A live hand is abandoned, not settled; the previous pool and journal remain intact.
            match.currentHand = nil
            match.draft = nil
            match.status = "finished"
        }
    }
    func previewTerminal(_ id: String) throws -> [String: JSONValue] {
        let match = try current(id)
        guard match.status == "finished" else { throw LocalFailure(message: "请先终局") }
        guard match.engineVersion == EngineBridgeCheck.version else { throw LocalFailure(message: "旧版引擎的牌桌仅供查看") }
        let completed = match.rules["fixedSouth4EndPolicy"] == .string("completed_south_4") &&
            match.nextHand?.roundWind == "W" && match.nextHand?.roundNumber == 1 &&
            match.results.contains { $0.hand.roundWind == "S" && $0.hand.roundNumber == 4 }
        return try Self.json(EngineBridgeCheck.localCalculation("calculateTerminalSettlement", [
            match.points, ["rulesHash": match.rulesHash, "config": try Self.object(match.rules)],
            ["riichiPool": match.nextHand?.riichiPool ?? 0,
             "startingDealerSeatNo": match.startingDealerSeatNo,
             "requireTargetPoints": true, "completedSouth4": completed] as [String: Any]
        ]))
    }
    func confirmTerminal(_ id: String) throws {
        let terminal = try previewTerminal(id)
        guard terminal["isGameEnd"] == .bool(true) else { throw LocalFailure(message: "终局成绩尚未产生") }
        _ = try update(id) { match in
            guard match.status == "finished", !match.settlementConfirmed else { throw LocalFailure(message: "终局已经确认") }
            match.terminal = terminal
            match.settlementConfirmed = true
        }
    }
    func delete(_ id: String) throws {
        try transact {
            _ = try current(id)
            let query = try statement("DELETE FROM local_matches WHERE id = ?")
            defer { sqlite3_finalize(query) }
            bind(id, at: 1, to: query)
            guard sqlite3_step(query) == SQLITE_DONE else { throw error("删除本地牌桌失败") }
        }
    }
}
