import Foundation
import CoreFoundation
import MobileEngine

/// Replays bundled JS-golden vectors through the exported Kotlin/Native framework.
/// No fixture result is synthesized from its expected value.
enum EngineBridgeCheck {
    static let version = CoreKt.ENGINE_VERSION
    static func normalizedRules(_ config: [String: Any]) throws -> [String: Any] {
        try normalize(CoreKt.normalizeRulesConfig(rawConfig: bridgedObject(config), inferredPlayerCount: nil))
    }

    static func bundledTemplate(_ key: String) throws -> [String: Any] {
        let config: EngineRulesConfig
        switch key {
        case "house_4p": config = CoreKt.HOUSE_4P_V1
        case "reference_4p_competition": config = CoreKt.WRC_4P_REF_V1
        case "house_3p": config = CoreKt.HOUSE_3P_V1
        case "reference_3p_common": config = CoreKt.COMMON_3P_REF_V1
        default: throw NSError(domain: "LocalEngine", code: 1,
                               userInfo: [NSLocalizedDescriptionKey: "未知的本地模板"])
        }
        return normalize(config)
    }

    static func localCalculation(_ operation: String, _ args: [Any]) throws -> Any {
        try invoke(["operation": operation, "args": args])
    }
    static func samplePayment(config: [String: Any], input: [String: Any]) throws -> [String: Any] {
        guard let count = (config["playerCount"] as? NSNumber)?.intValue, (3...4).contains(count),
              let start = (config["startingPoints"] as? NSNumber)?.intValue, start > 0 else {
            throw APIError(status: nil, message: "引擎预览缺少合法人数或起始点")
        }
        let hand: [String: Any] = [
            "handId": "preview", "roundWind": "E", "roundNumber": 1,
            "dealerSeatNo": 0, "honba": 0, "riichiPool": 0,
            "markRevision": 0, "resultRevision": 0,
            "seats": (0..<count).map { ["seatNo": $0, "points": start, "isRiichi": false] as [String: Any] }
        ]
        guard let payment = try invoke(["operation": "calculateSettlement",
                                        "args": [["rulesHash": "local-preview", "config": config],
                                                 hand, input, version]]) as? [String: Any] else {
            throw APIError(status: nil, message: "引擎预览输出格式无效")
        }
        return payment
    }

    static func runSample() async -> String {
        do {
            let (total, failures, bridgeSkipped) = try replay()
            let skippedNote = bridgeSkipped.isEmpty ? ""
                : " · 桥接不可表示 \(bridgeSkipped.count) 条（错类型入参无法经类型化桥表达，JVM 原始路径已覆盖）：\(bridgeSkipped.joined(separator: ","))"
            return failures.isEmpty
                ? "通过 \(total - bridgeSkipped.count)/\(total) · ENGINE_VERSION \(version)\(skippedNote)"
                : "失败 \(failures.count)/\(total) · ENGINE_VERSION \(version) · \(failures.prefix(3).joined(separator: "; "))\(skippedNote)"
        } catch {
            return "自检失败 · ENGINE_VERSION \(version) · \(error.localizedDescription)"
        }
    }

    private static func integer(_ value: Any?) -> Int32 { (value as? NSNumber)?.int32Value ?? 0 }
    private static func object(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }
    private static func array(_ value: Any?) -> [Any] { value as? [Any] ?? [] }

    // NSDictionary/NSNumber values passed through Any do not automatically become Kotlin
    // primitive boxes. Preserve their JSON types at the Swift→Kotlin boundary.
    private static func bridged(_ value: Any) -> Any {
        if let fields = value as? [String: Any] { return fields.mapValues(bridged) }
        if let entries = value as? [Any] { return entries.map(bridged) }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return KotlinBoolean(bool: number.boolValue) }
            if ["d", "f"].contains(String(cString: number.objCType)) {
                return NSNumber(value: number.doubleValue)
            }
            let integer = number.int64Value
            // NSNumber(value:) preserves the objCType tag (i/q/d) that Kotlin/Native
            // maps back to Int/Long/Double; constructing KotlinInt/KotlinLong/KotlinDouble
            // directly would reference the unexported MobileEngineNumber class and fail to link.
            return integer >= Int64(Int32.min) && integer <= Int64(Int32.max)
                ? NSNumber(value: Int32(integer)) : NSNumber(value: integer)
        }
        return value
    }
    private static func bridgedObject(_ value: Any?) -> [String: Any] {
        bridged(object(value)) as? [String: Any] ?? [:]
    }
    // Optional-field readers must distinguish ABSENT (nil/NSNull -> nil) from
    // PRESENT-BUT-MISTYPED: a mistyped value has no representation in the typed
    // bridge, so surface it instead of silently dropping it (the JVM raw-map
    // differential covers those fixtures through the core's own validation).
    private static func optInteger(_ value: Any?) throws -> KotlinInt? {
        guard let value, !(value is NSNull) else { return nil }
        // Golden-format tagged values (see packages/mobile-engine PORTING-NOTES):
        // undefined == absent; bigint carries a decimal string.
        if let dict = value as? [String: Any], let tag = dict["$type"] as? String {
            if tag == "undefined" { return nil }
            if tag == "bigint", let decimal = dict["value"] as? String,
               let wide = Int64(decimal), wide >= Int64(Int32.min) && wide <= Int64(Int32.max) {
                return KotlinInt(int: Int32(wide))
            }
            throw NSError(domain: "EngineBridgeCheck", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Bridge cannot represent tagged \(tag) as an integer"])
        }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            throw NSError(domain: "EngineBridgeCheck", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Bridge cannot represent \(type(of: value)) as an integer"])
        }
        return KotlinInt(int: number.int32Value)
    }
    private static func optBoolean(_ value: Any?) throws -> KotlinBoolean? {
        guard let value, !(value is NSNull) else { return nil }
        if let dict = value as? [String: Any], let tag = dict["$type"] as? String {
            if tag == "undefined" { return nil }
            throw NSError(domain: "EngineBridgeCheck", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Bridge cannot represent tagged \(tag) as a boolean"])
        }
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw NSError(domain: "EngineBridgeCheck", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Bridge cannot represent \(type(of: value)) as a boolean"])
        }
        return KotlinBoolean(bool: number.boolValue)
    }

    private static func handKind(_ value: String?) -> HandKind {
        switch value {
        case "tsumo": return HandKind.tsumo
        case "ryuukyoku": return HandKind.ryuukyoku
        case "chombo": return HandKind.chombo
        case "nagashi_mangan": return HandKind.nagashiMangan
        default: return HandKind.ron
        }
    }

    private static func hand(_ value: Any?) throws -> HandState {
        let item = object(value)
        let seats = try array(item["seats"]).map { entry -> SeatState in
            let seat = object(entry)
            return SeatState(seatNo: integer(seat["seatNo"]), points: integer(seat["points"]),
                                         isRiichi: try optBoolean(seat["isRiichi"])?.boolValue ?? false,
                                         isTenpai: try optBoolean(seat["isTenpai"]))
        }
        return HandState(handId: item["handId"] as? String ?? "",
                                     roundWind: item["roundWind"] as? String ?? "",
                                     roundNumber: integer(item["roundNumber"]),
                                     dealerSeatNo: integer(item["dealerSeatNo"]),
                                     honba: integer(item["honba"]), riichiPool: integer(item["riichiPool"]),
                                     seats: seats,
                                     markRevision: (item["markRevision"] as? NSNumber)?.int64Value ?? 0,
                                     resultRevision: (item["resultRevision"] as? NSNumber)?.int64Value ?? 0)
    }

    private static func result(_ value: Any?) throws -> ResultInput {
        let item = object(value)
        let winners = try array(item["winners"]).map { entry -> WinnerInput in
            let winner = object(entry)
            return WinnerInput(seatNo: integer(winner["seatNo"]), han: integer(winner["han"]),
                                           fu: integer(winner["fu"]), yakumanCount: try optInteger(winner["yakumanCount"]),
                                           dealInSeatNo: try optInteger(winner["dealInSeatNo"]),
                                           doubleYakumanCount: try optInteger(winner["doubleYakumanCount"]),
                                           isRiichiDeclarationDealIn: try optBoolean(winner["isRiichiDeclarationDealIn"]))
        }
        let nagashi: [NagashiEligibilityInput]? = item["nagashiEligibility"].map { source in
            array(source).map { entry in
                let eligibility = object(entry)
                let discards = array(eligibility["discards"]).map { value -> DiscardInput in
                    let discard = object(value)
                    return DiscardInput(tile: discard["tile"] as? String ?? "",
                                                    called: (discard["called"] as? NSNumber)?.boolValue ?? false)
                }
                return NagashiEligibilityInput(seatNo: integer(eligibility["seatNo"]), discards: discards)
            }
        }
        let roles = (item["chomboRole"] as? [String: String])?.reduce(into: [KotlinInt: String]()) {
            if let seat = Int32($1.key) { $0[KotlinInt(int: seat)] = $1.value }
        }
        let payments = (item["manualPayments"] as? [String: NSNumber])?.reduce(into: [KotlinInt: KotlinInt]()) {
            if let seat = Int32($1.key) { $0[KotlinInt(int: seat)] = KotlinInt(int: $1.value.int32Value) }
        }
        return ResultInput(kind: handKind(item["kind"] as? String), winners: winners,
                                       nagashiEligibility: nagashi,
                                       tenpai: (item["tenpai"] as? [NSNumber])?.map { KotlinBoolean(bool: $0.boolValue) },
                                       chomboRole: roles, riichiDeclarationDealInSeatNo: try optInteger(item["riichiDeclarationDealInSeatNo"]),
                                       manualPayments: payments)
    }

    private static func rules(_ value: Any?) -> RulesSnapshot {
        let raw = object(value)
        return RulesSnapshot(rulesHash: raw["rulesHash"] as? String ?? "",
                                         config: bridgedObject(raw["config"]))
    }
    private static func nextHand(_ value: Any?) -> NextHandState {
        let raw = object(value)
        return NextHandState(roundWind: raw["roundWind"] as? String ?? "",
                                         roundNumber: integer(raw["roundNumber"]), dealerSeatNo: integer(raw["dealerSeatNo"]),
                                         honba: integer(raw["honba"]), riichiPool: integer(raw["riichiPool"]))
    }

    private static func normalize(_ config: EngineRulesConfig) -> [String: Any] {
        var fields: [String: Any] = [
            "playerCount": Int(config.playerCount), "startingPoints": Int(config.startingPoints),
            "returnPoints": Int(config.returnPoints), "targetPoints": Int(config.targetPoints),
            "uma": config.uma, "oka": config.oka,
            "honbaPerPayer": Int(config.honbaPerPayer), "honbaRon": Int(config.honbaRon),
            "notenPenaltyTotal": Int(config.notenPenaltyTotal), "kiriageMangan": config.kiriageMangan,
            "kazoeYakuman": config.kazoeYakuman, "compositeYakuman": config.compositeYakuman,
            "doubleYakuman": config.doubleYakuman, "nagashiManganEnabled": config.nagashiManganEnabled,
            "nagashiDealerRepeatRequiresTenpai": config.nagashiDealerRepeatRequiresTenpai,
            "tsumoLoss": config.tsumoLoss, "multiRon": config.multiRon,
            "doubleRonHonbaPolicy": config.doubleRonHonbaPolicy,
            "nagashiCollectsRiichiPool": config.nagashiCollectsRiichiPool,
            "bustEndsGame": config.bustEndsGame,
            "allowLowPointRiichi": config.allowLowPointRiichi,
            "fixedSouth4EndPolicy": config.fixedSouth4EndPolicy,
            "terminalRiichiPoolPolicy": config.terminalRiichiPoolPolicy,
            "tiedUmaPolicy": config.tiedUmaPolicy, "automaticEndPolicy": config.automaticEndPolicy
        ]
        if let template = config.templateKey { fields["templateKey"] = template }
        return fields
    }

    private static func payment(_ value: SeatPayment) -> [String: Any] {
        ["seatNo": Int(value.seatNo), "netPoints": Int(value.netPoints),
         "breakdown": value.breakdown.map { ["reason": $0.reason, "amount": Int($0.amount)] }]
    }
    private static func next(_ value: NextHandState) -> [String: Any] {
        ["roundWind": value.roundWind, "roundNumber": value.roundNumber,
         "dealerSeatNo": value.dealerSeatNo, "honba": value.honba, "riichiPool": value.riichiPool]
    }
    private static func terminalSeat(_ value: TerminalSeatEntry) -> [String: Any] {
        var fields: [String: Any] = ["seatNo": value.seatNo, "rawPoints": value.rawPoints,
                                     "finalPoints": value.finalPoints]
        if let ranked = value as? TerminalSeatResult {
            fields.merge(["rank": ranked.rank, "baseTenths": ranked.baseTenths,
                          "umaTenths": ranked.umaTenths, "okaTenths": ranked.okaTenths,
                          "penaltyTenths": ranked.penaltyTenths, "totalTenths": ranked.totalTenths,
                          "competencyPoints": ranked.competencyPoints]) { _, new in new }
        }
        return fields
    }
    private static func terminal(_ value: TerminalSettlementOutput) -> [String: Any] {
        ["isGameEnd": value.isGameEnd, "gameEndReason": value.gameEndReason,
         "unclaimedRiichiPoints": value.unclaimedRiichiPoints,
         "poolRecipientSeatNo": value.poolRecipientSeatNo as Any? ?? NSNull(),
         "perSeat": value.perSeat.map(terminalSeat),
         "standings": value.standings.map(terminalSeat), "tenths": value.tenths]
    }

    private static func invoke(_ fixture: [String: Any]) throws -> Any {
        let args = array(fixture["args"])
        switch fixture["operation"] as? String {
        case "normalizeRulesConfig":
            let inferred = args.count > 1 ? try optInteger(args[1]) : nil
            return normalize(try CoreKt.normalizeRulesConfig(rawConfig: bridgedObject(args[0]),
                                                                     inferredPlayerCount: inferred))
        case "calculateSettlement":
            let value = try SettlementKt.calculateSettlement(
                rulesSnapshot: rules(args[0]), handState: try hand(args[1]), resultInput: try result(args[2]),
                engineVersion: args[3] as? String ?? version)
            return ["perSeat": value.perSeat.map(payment), "nextHand": next(value.nextHand)]
        case "isAutomaticMatchEnd":
            let balances = array(args[4]).map { entry -> SeatBalance in
                let raw = object(entry)
                return SeatBalance(seatNo: integer(raw["seatNo"]), points: integer(raw["points"]))
            }
            return try SettlementKt.isAutomaticMatchEnd(
                rawConfig: bridgedObject(args[0]), handState: try hand(args[1]), resultInput: try result(args[2]),
                nextHand: nextHand(args[3]), pointsAfter: balances)
        case "calculateTerminalSettlement":
            let rawOptions: [String: Any] = args.count > 2 ? object(args[2]) : [:]
            return terminal(try TerminalKt.calculateTerminalSettlement(
                finalPoints: bridged(args[0]), rules: bridged(args[1]), options__: rawOptions))
        default:
            throw NSError(domain: "EngineBridgeCheck", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Unsupported fixture operation"])
        }
    }

    /// Exact integer/boolean identity, unordered object keys, ordered arrays.
    private static func canonical(_ value: Any) -> String {
        if value is NSNull { return "null" }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            let decimal = Decimal(string: number.stringValue, locale: Locale(identifier: "en_US_POSIX"))
            return "n:\(decimal.map { NSDecimalNumber(decimal: $0).stringValue } ?? "invalid")"
        }
        if let string = value as? String { return "s:\(String(reflecting: string))" }
        if let list = value as? [Any] { return "[\(list.map(canonical).joined(separator: ","))]" }
        if let map = value as? [String: Any] {
            return "{\(map.keys.sorted().map { "\(String(reflecting: $0)):\(canonical(map[$0]!))" }.joined(separator: ","))}"
        }
        return "unsupported:\(type(of: value))"
    }

    static func replay() throws -> (Int, [String], [String]) {
        guard let url = Bundle.main.url(forResource: "bridge-sample", withExtension: "jsonl") else {
            throw NSError(domain: "EngineBridgeCheck", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Missing bundled bridge fixtures"])
        }
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        var failures: [String] = []
        var bridgeSkipped: [String] = []
        for line in lines {
            let fixture = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
            let expected = object(fixture["expected"])
            let fixtureId = fixture["id"] ?? "?"
            if expected["kind"] as? String == "throw" {
                // Mirror the JVM differential: a thrown Kotlin EngineException is a
                // match when its message matches the fixture's expected message.
                do {
                    _ = try invoke(fixture)
                    failures.append("\(fixtureId): expected throw, got return")
                } catch let error as NSError {
                    if error.domain == "EngineBridgeCheck" {
                        // Input cannot be represented in the typed bridge (e.g. a
                        // string where a boolean belongs); not a core result.
                        bridgeSkipped.append("\(fixtureId)")
                    } else {
                        let expectedMessage = expected["message"] as? String ?? ""
                        let haystack = "\(error.domain) \(error.localizedDescription)"
                        if !expectedMessage.isEmpty && !haystack.contains(expectedMessage) {
                            failures.append("\(fixtureId): throw mismatch domain=\(error.domain) desc=\(error.localizedDescription) expected=\(expectedMessage)")
                        }
                    }
                }
                continue
            }
            do {
                let actual = try invoke(fixture)
                if canonical(actual) != canonical(expected["value"] ?? NSNull()) {
                    failures.append("\(fixtureId): output mismatch")
                }
            } catch let error as NSError {
                failures.append("\(fixtureId): unexpected throw \(error.domain): \(error.localizedDescription)")
            }
        }
        return (lines.count, failures, bridgeSkipped)
    }
}
