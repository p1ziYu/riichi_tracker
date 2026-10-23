import Foundation
import CoreFoundation
import MobileEngine

/// Replays bundled JS-golden vectors through the exported Kotlin/Native framework.
/// No fixture result is synthesized from its expected value.
enum EngineBridgeCheck {
    static let version = MobileEngineCoreKt.ENGINE_VERSION

    static func runSample() async -> String {
        do {
            let (total, failures) = try replay()
            return failures.isEmpty
                ? "通过 \(total)/\(total) · ENGINE_VERSION \(version)"
                : "失败 \(failures.count)/\(total) · ENGINE_VERSION \(version) · \(failures.prefix(3).joined(separator: "; "))"
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
                return KotlinDouble(double: number.doubleValue)
            }
            let integer = number.int64Value
            return integer >= Int32.min && integer <= Int32.max
                ? KotlinInt(int: Int32(integer)) : KotlinLong(longLong: integer)
        }
        return value
    }
    private static func bridgedObject(_ value: Any?) -> [String: Any] {
        bridged(object(value)) as? [String: Any] ?? [:]
    }
    private static func optInteger(_ value: Any?) -> KotlinInt? {
        guard let number = value as? NSNumber else { return nil }
        return KotlinInt(int: number.int32Value)
    }
    private static func optBoolean(_ value: Any?) -> KotlinBoolean? {
        guard let number = value as? NSNumber else { return nil }
        return KotlinBoolean(bool: number.boolValue)
    }

    private static func hand(_ value: Any?) -> MobileEngineHandState {
        let item = object(value)
        let seats = array(item["seats"]).map { entry -> MobileEngineSeatState in
            let seat = object(entry)
            return MobileEngineSeatState(seatNo: integer(seat["seatNo"]), points: integer(seat["points"]),
                                         isRiichi: (seat["isRiichi"] as? NSNumber)?.boolValue ?? false,
                                         isTenpai: optBoolean(seat["isTenpai"]))
        }
        return MobileEngineHandState(handId: item["handId"] as? String ?? "",
                                     roundWind: item["roundWind"] as? String ?? "",
                                     roundNumber: integer(item["roundNumber"]),
                                     dealerSeatNo: integer(item["dealerSeatNo"]),
                                     honba: integer(item["honba"]), riichiPool: integer(item["riichiPool"]),
                                     seats: seats,
                                     markRevision: (item["markRevision"] as? NSNumber)?.int64Value ?? 0,
                                     resultRevision: (item["resultRevision"] as? NSNumber)?.int64Value ?? 0)
    }

    private static func result(_ value: Any?) -> MobileEngineResultInput {
        let item = object(value)
        let winners = array(item["winners"]).map { entry -> MobileEngineWinnerInput in
            let winner = object(entry)
            return MobileEngineWinnerInput(seatNo: integer(winner["seatNo"]), han: integer(winner["han"]),
                                           fu: integer(winner["fu"]), yakumanCount: optInteger(winner["yakumanCount"]),
                                           dealInSeatNo: optInteger(winner["dealInSeatNo"]),
                                           doubleYakumanCount: optInteger(winner["doubleYakumanCount"]),
                                           isRiichiDeclarationDealIn: optBoolean(winner["isRiichiDeclarationDealIn"]))
        }
        let nagashi: [MobileEngineNagashiEligibilityInput]? = item["nagashiEligibility"].map { source in
            array(source).map { entry in
                let eligibility = object(entry)
                let discards = array(eligibility["discards"]).map { value -> MobileEngineDiscardInput in
                    let discard = object(value)
                    return MobileEngineDiscardInput(tile: discard["tile"] as? String ?? "",
                                                    called: (discard["called"] as? NSNumber)?.boolValue ?? false)
                }
                return MobileEngineNagashiEligibilityInput(seatNo: integer(eligibility["seatNo"]), discards: discards)
            }
        }
        let roles = (item["chomboRole"] as? [String: String])?.reduce(into: [KotlinInt: String]()) {
            if let seat = Int32($1.key) { $0[KotlinInt(int: seat)] = $1.value }
        }
        let payments = (item["manualPayments"] as? [String: NSNumber])?.reduce(into: [KotlinInt: KotlinInt]()) {
            if let seat = Int32($1.key) { $0[KotlinInt(int: seat)] = KotlinInt(int: $1.value.int32Value) }
        }
        return MobileEngineResultInput(kind: item["kind"] as? String ?? "", winners: winners,
                                       nagashiEligibility: nagashi,
                                       tenpai: (item["tenpai"] as? [NSNumber])?.map(\.boolValue),
                                       chomboRole: roles, riichiDeclarationDealInSeatNo: optInteger(item["riichiDeclarationDealInSeatNo"]),
                                       manualPayments: payments)
    }

    private static func rules(_ value: Any?) -> MobileEngineRulesSnapshot {
        let raw = object(value)
        return MobileEngineRulesSnapshot(rulesHash: raw["rulesHash"] as? String ?? "",
                                         config: bridgedObject(raw["config"]))
    }
    private static func nextHand(_ value: Any?) -> MobileEngineNextHandState {
        let raw = object(value)
        return MobileEngineNextHandState(roundWind: raw["roundWind"] as? String ?? "",
                                         roundNumber: integer(raw["roundNumber"]), dealerSeatNo: integer(raw["dealerSeatNo"]),
                                         honba: integer(raw["honba"]), riichiPool: integer(raw["riichiPool"]))
    }

    private static func normalize(_ config: MobileEngineEngineRulesConfig) -> [String: Any] {
        var fields: [String: Any] = [
            "playerCount": config.playerCount, "startingPoints": config.startingPoints,
            "returnPoints": config.returnPoints, "targetPoints": config.targetPoints,
            "uma": config.uma, "oka": config.oka,
            "honbaPerPayer": config.honbaPerPayer, "honbaRon": config.honbaRon,
            "notenPenaltyTotal": config.notenPenaltyTotal, "kiriageMangan": config.kiriageMangan,
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

    private static func payment(_ value: MobileEngineSeatPayment) -> [String: Any] {
        ["seatNo": value.seatNo, "netPoints": value.netPoints,
         "breakdown": value.breakdown.map { ["reason": $0.reason, "amount": $0.amount] }]
    }
    private static func next(_ value: MobileEngineNextHandState) -> [String: Any] {
        ["roundWind": value.roundWind, "roundNumber": value.roundNumber,
         "dealerSeatNo": value.dealerSeatNo, "honba": value.honba, "riichiPool": value.riichiPool]
    }
    private static func terminalSeat(_ value: MobileEngineTerminalSeatEntry) -> [String: Any] {
        var fields: [String: Any] = ["seatNo": value.seatNo, "rawPoints": value.rawPoints,
                                     "finalPoints": value.finalPoints]
        if let ranked = value as? MobileEngineTerminalSeatResult {
            fields.merge(["rank": ranked.rank, "baseTenths": ranked.baseTenths,
                          "umaTenths": ranked.umaTenths, "okaTenths": ranked.okaTenths,
                          "penaltyTenths": ranked.penaltyTenths, "totalTenths": ranked.totalTenths,
                          "competencyPoints": ranked.competencyPoints]) { _, new in new }
        }
        return fields
    }
    private static func terminal(_ value: MobileEngineTerminalSettlementOutput) -> [String: Any] {
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
            let inferred = args.count > 1 ? optInteger(args[1]) : nil
            return normalize(MobileEngineCoreKt.normalizeRulesConfig(rawConfig: bridgedObject(args[0]),
                                                                     inferredPlayerCount: inferred))
        case "calculateSettlement":
            let value = MobileEngineSettlementKt.calculateSettlement(
                rulesSnapshot: rules(args[0]), handState: hand(args[1]), resultInput: result(args[2]),
                engineVersion: args[3] as? String ?? version)
            return ["perSeat": value.perSeat.map(payment), "nextHand": next(value.nextHand)]
        case "isAutomaticMatchEnd":
            let balances = array(args[4]).map { entry -> MobileEngineSeatBalance in
                let raw = object(entry)
                return MobileEngineSeatBalance(seatNo: integer(raw["seatNo"]), points: integer(raw["points"]))
            }
            return MobileEngineSettlementKt.isAutomaticMatchEnd(
                rawConfig: bridgedObject(args[0]), handState: hand(args[1]), resultInput: result(args[2]),
                nextHand: nextHand(args[3]), pointsAfter: balances)
        case "calculateTerminalSettlement":
            let rawOptions = args.count > 2 ? object(args[2]) : [:]
            let options = MobileEngineTerminalSettlementOptions(
                riichiPool: optInteger(rawOptions["riichiPool"]),
                startingDealerSeatNo: optInteger(rawOptions["startingDealerSeatNo"]),
                requireTargetPoints: optBoolean(rawOptions["requireTargetPoints"]),
                completedSouth4: optBoolean(rawOptions["completedSouth4"]))
            return terminal(MobileEngineTerminalKt.calculateTerminalSettlement(
                finalPoints: bridged(args[0]), rules: bridged(args[1]), options: options))
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

    static func replay() throws -> (Int, [String]) {
        guard let url = Bundle.main.url(forResource: "bridge-sample", withExtension: "jsonl") else {
            throw NSError(domain: "EngineBridgeCheck", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Missing bundled bridge fixtures"])
        }
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        var failures: [String] = []
        for line in lines {
            let fixture = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
            let expected = object(fixture["expected"])
            guard expected["kind"] as? String == "return" else {
                failures.append("\(fixture["id"] ?? "?"): unsupported throw fixture")
                continue
            }
            let actual = try invoke(fixture)
            if canonical(actual) != canonical(expected["value"] ?? NSNull()) {
                failures.append("\(fixture["id"] ?? "?"): output mismatch")
            }
        }
        return (lines.count, failures)
    }
}
