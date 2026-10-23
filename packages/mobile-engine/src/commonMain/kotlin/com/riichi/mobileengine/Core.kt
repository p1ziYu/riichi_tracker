package com.riichi.mobileengine

import kotlin.math.abs
import kotlin.math.floor

/** The original engine's public input and output shapes. Raw rule configuration intentionally
 * retains dynamically typed values so an absent key, null, and an invalid present key differ. */
data class RulesSnapshot(val rulesHash: String, val config: Map<String, Any?>)
data class SeatState(val seatNo: Int, val points: Int, val isRiichi: Boolean, val isTenpai: Boolean?)
data class HandState(
    val handId: String,
    val roundWind: String,
    val roundNumber: Int,
    val dealerSeatNo: Int,
    val honba: Int,
    val riichiPool: Int,
    val seats: List<SeatState>,
    val markRevision: Long = 0,
    val resultRevision: Long = 0,
)
enum class HandKind(val wireValue: String) {
    RON("ron"),
    TSUMO("tsumo"),
    RYUUKYOKU("ryuukyoku"),
    CHOMBO("chombo"),
    NAGASHI_MANGAN("nagashi_mangan"),
}

data class WinnerInput(
    val seatNo: Int,
    val han: Int,
    val fu: Int,
    val yakumanCount: Int? = null,
    val dealInSeatNo: Int? = null,
    val doubleYakumanCount: Int? = null,
    val isRiichiDeclarationDealIn: Boolean? = null,
)
data class DiscardInput(val tile: String, val called: Boolean)
data class NagashiEligibilityInput(val seatNo: Int, val discards: List<DiscardInput>)
data class ResultInput(
    val kind: String,
    val winners: List<WinnerInput> = emptyList(),
    val nagashiEligibility: List<NagashiEligibilityInput>? = null,
    val tenpai: List<Boolean>? = null,
    val chomboRole: Map<Int, String>? = null,
    val riichiDeclarationDealInSeatNo: Int? = null,
    val manualPayments: Map<Int, Int>? = null,
) {
    /** Typed construction for known results; the string constructor preserves invalid raw kinds
     * until the engine's unsupported-kind validation runs. */
    constructor(
        kind: HandKind,
        winners: List<WinnerInput> = emptyList(),
        nagashiEligibility: List<NagashiEligibilityInput>? = null,
        tenpai: List<Boolean>? = null,
        chomboRole: Map<Int, String>? = null,
        riichiDeclarationDealInSeatNo: Int? = null,
        manualPayments: Map<Int, Int>? = null,
    ) : this(kind.wireValue, winners, nagashiEligibility, tenpai, chomboRole, riichiDeclarationDealInSeatNo, manualPayments)
}
data class BreakdownEntry(val reason: String, val amount: Int)
data class SeatPayment(val seatNo: Int, val netPoints: Int, val breakdown: List<BreakdownEntry>)
data class NextHandState(
    val roundWind: String,
    val roundNumber: Int,
    val dealerSeatNo: Int,
    val honba: Int,
    val riichiPool: Int,
)
data class SettlementOutput(val perSeat: List<SeatPayment>, val nextHand: NextHandState)
sealed interface TerminalPoint {
    val points: Int
    data class NumberPoint(override val points: Int) : TerminalPoint
}
data class SeatBalance(val seatNo: Int, override val points: Int) : TerminalPoint

data class EngineRulesConfig(
    val templateKey: String?,
    val playerCount: Int,
    val startingPoints: Int,
    val returnPoints: Int,
    val targetPoints: Int,
    val uma: List<Double>,
    val oka: Double,
    val honbaPerPayer: Int,
    val honbaRon: Int,
    val notenPenaltyTotal: Int,
    val kiriageMangan: Boolean,
    val kazoeYakuman: Boolean,
    val compositeYakuman: Boolean,
    val doubleYakuman: Boolean,
    val nagashiManganEnabled: Boolean,
    val nagashiDealerRepeatRequiresTenpai: Boolean,
    val tsumoLoss: Boolean,
    val multiRon: String,
    val doubleRonHonbaPolicy: String,
    val nagashiCollectsRiichiPool: Boolean,
    val bustEndsGame: Boolean,
    val allowLowPointRiichi: Boolean,
    val fixedSouth4EndPolicy: String,
    val terminalRiichiPoolPolicy: String,
    val tiedUmaPolicy: String,
    val automaticEndPolicy: String,
)

/** Supported typed terminal inputs; the raw Any? overload handles arbitrary JSON and malformed
 * inputs at the engine validation boundary. */
sealed interface TerminalPointsInput {
    data class PointList(val points: List<Int>) : TerminalPointsInput
    data class SeatList(val seats: List<SeatBalance>) : TerminalPointsInput
    data class MixedList(val entries: List<TerminalPoint>) : TerminalPointsInput
    data class ObjectInput(
        val seats: List<TerminalPoint>? = null,
        val points: List<Int>? = null,
        val riichiPool: Int? = null,
        val unclaimedRiichiPoints: Int? = null,
        val startingDealerSeatNo: Int? = null,
        val requireTargetPoints: Boolean? = null,
        val completedSouth4: Boolean? = null,
    ) : TerminalPointsInput
}
data class TerminalSettlementOptions(
    val riichiPool: Int? = null,
    val startingDealerSeatNo: Int? = null,
    val requireTargetPoints: Boolean? = null,
    val completedSouth4: Boolean? = null,
)
sealed interface TerminalSeatEntry {
    val seatNo: Int
    val rawPoints: Int
    val finalPoints: Int
}
data class TerminalSeatPoints(
    override val seatNo: Int,
    override val rawPoints: Int,
    override val finalPoints: Int,
) : TerminalSeatEntry
data class TerminalSeatResult(
    override val seatNo: Int,
    override val rawPoints: Int,
    override val finalPoints: Int,
    val rank: Int,
    val baseTenths: Int,
    val umaTenths: Int,
    val okaTenths: Int,
    val penaltyTenths: Int,
    val totalTenths: Int,
    val competencyPoints: Double,
) : TerminalSeatEntry
sealed interface TerminalSettlementOutput {
    val isGameEnd: Boolean
    val gameEndReason: String
    val unclaimedRiichiPoints: Int
    val poolRecipientSeatNo: Int?
    val perSeat: List<TerminalSeatEntry>
    val standings: List<TerminalSeatResult>
    val tenths: List<Int>

    data class NotEnded(
        override val unclaimedRiichiPoints: Int,
        override val perSeat: List<TerminalSeatPoints>,
    ) : TerminalSettlementOutput {
        override val isGameEnd: Boolean get() = false
        override val gameEndReason: String get() = "not_ended"
        override val poolRecipientSeatNo: Int? get() = null
        override val standings: List<TerminalSeatResult> get() = emptyList()
        override val tenths: List<Int> get() = emptyList()
    }

    data class Ended(
        override val gameEndReason: String,
        override val unclaimedRiichiPoints: Int,
        override val poolRecipientSeatNo: Int?,
        override val perSeat: List<TerminalSeatResult>,
        override val standings: List<TerminalSeatResult>,
        override val tenths: List<Int>,
    ) : TerminalSettlementOutput {
        override val isGameEnd: Boolean get() = true
    }
}

enum class EngineErrorCategory { ENGINE_VALIDATION, HOST_TYPE, OTHER }
class EngineException(
    message: String,
    val category: EngineErrorCategory = EngineErrorCategory.ENGINE_VALIDATION,
) : IllegalArgumentException(message)

const val ENGINE_VERSION = "0.1.0"
internal const val MAX_STORED_INTEGER = 2_147_483_647

val HOUSE_4P_V1 = EngineRulesConfig(
    templateKey = "house_4p_v1", playerCount = 4, startingPoints = 25000,
    returnPoints = 30000, targetPoints = 30000, uma = listOf(20.0, 10.0, -10.0, -20.0),
    oka = 20.0, honbaPerPayer = 100, honbaRon = 300, notenPenaltyTotal = 3000,
    kiriageMangan = false, kazoeYakuman = true, compositeYakuman = true, doubleYakuman = false,
    tsumoLoss = false, multiRon = "double_ron", doubleRonHonbaPolicy = "each_winner",
    nagashiCollectsRiichiPool = false, nagashiManganEnabled = false,
    nagashiDealerRepeatRequiresTenpai = false, bustEndsGame = true, allowLowPointRiichi = false,
    fixedSouth4EndPolicy = "target_or_bust", terminalRiichiPoolPolicy = "first",
    tiedUmaPolicy = "seat_order", automaticEndPolicy = "manual",
)
val WRC_4P_REF_V1 = HOUSE_4P_V1.copy(
    templateKey = "wrc_4p_ref_v1", startingPoints = 30000,
    uma = listOf(15.0, 5.0, -5.0, -15.0), oka = 0.0, kiriageMangan = true,
    multiRon = "head_bump", doubleRonHonbaPolicy = "nearest_only",
    bustEndsGame = false, allowLowPointRiichi = true,
    fixedSouth4EndPolicy = "completed_south_4", terminalRiichiPoolPolicy = "unallocated",
    tiedUmaPolicy = "split",
)
val HOUSE_3P_V1 = HOUSE_4P_V1.copy(
    templateKey = "house_3p_v1", playerCount = 3, startingPoints = 35000,
    returnPoints = 40000, targetPoints = 40000, uma = listOf(20.0, 0.0, -20.0), oka = 15.0,
    honbaRon = 200, tsumoLoss = true,
)
val COMMON_3P_REF_V1 = HOUSE_3P_V1.copy(
    templateKey = "common_3p_ref_v1", notenPenaltyTotal = 2000,
    doubleRonHonbaPolicy = "nearest_only", nagashiManganEnabled = true,
    nagashiDealerRepeatRequiresTenpai = true, automaticEndPolicy = "ranked_sanma",
)
val RULESET_TEMPLATES: Map<String, EngineRulesConfig> = mapOf(
    "house_4p_v1" to HOUSE_4P_V1,
    "wrc_4p_ref_v1" to WRC_4P_REF_V1,
    "house_3p_v1" to HOUSE_3P_V1,
    "common_3p_ref_v1" to COMMON_3P_REF_V1,
)

internal fun validStoredInteger(value: Double, min: Int = 0): Boolean =
    value.isFinite() && value % 1.0 == 0.0 && value >= min && value <= MAX_STORED_INTEGER

internal fun safePoints(value: Long, label: String): Int {
    if (value < -MAX_STORED_INTEGER.toLong() || value > MAX_STORED_INTEGER.toLong()) {
        throw EngineException("Invalid $label: point arithmetic exceeds the stored integer range.")
    }
    return value.toInt()
}

internal fun safePoints(value: Double, label: String): Int {
    if (!value.isFinite() || value % 1.0 != 0.0 || abs(value) > MAX_STORED_INTEGER) {
        throw EngineException("Invalid $label: point arithmetic exceeds the stored integer range.")
    }
    return value.toInt()
}

/** A present invalid alias does not fall back to a later alias. */
internal fun pickNumber(obj: Map<String, Any?>, keys: List<String>): Double? {
    for (key in keys) {
        if (!obj.containsKey(key)) continue
        val value = obj[key]
        if (value !is Number || !value.toDouble().isFinite()) {
            throw EngineException("Invalid $key: expected a finite number.")
        }
        return value.toDouble()
    }
    return null
}

internal fun pickBoolean(obj: Map<String, Any?>, keys: List<String>): Boolean? {
    for (key in keys) {
        if (!obj.containsKey(key)) continue
        val value = obj[key]
        if (value !is Boolean) throw EngineException("Invalid $key: expected a boolean.")
        return value
    }
    return null
}

/** JavaScript's Math.round: halfway values round toward positive infinity. */
private fun jsRound(value: Double): Double = floor(value + 0.5)
private fun jsNumber(value: Double): String = when {
    value.isNaN() -> "NaN"
    value == Double.POSITIVE_INFINITY -> "Infinity"
    value == Double.NEGATIVE_INFINITY -> "-Infinity"
    value == 0.0 -> "0"
    value % 1.0 == 0.0 && abs(value) < Long.MAX_VALUE.toDouble() ->
        value.toLong().toString()
    else -> value.toString()
}
private object RuleAliases {
    val playerCount = listOf("playerCount", "players", "numPlayers")
    val startingPoints = listOf("startingPoints", "startPoints", "initialPoints", "openingBalance")
    val returnPoints = listOf("returnPoints", "okaBasePoints", "baseReturnPoints")
    val targetPoints = listOf("targetPoints", "goalPoints")
    val oka = listOf("oka")
    val okaTenths = listOf("okaTenths")
    val honbaPerPayer = listOf("honbaPerPayer", "honbaTsumoPerPayer", "tsumoHonbaPerPayer", "honbaTsumo")
    val honbaObjPerPayer = listOf("perPayer", "tsumoPerPayer", "tsumo")
    val honbaRon = listOf("honbaRon", "ronHonba", "honbaTotal", "honbaPointsRon", "honbaPoints")
    val honbaObjRon = listOf("ron", "total")
    val notenPenaltyTotal = listOf(
        "notenPenaltyTotal", "ryuukyokuPenaltyTotal", "tenpaiPenaltyTotal", "ryuukyokuPoolTotal",
        "notenTotal", "ryuukyokuTotal", "tenpaiTotal",
    )
    val kiriageMangan = listOf("kiriageMangan", "kiriage")
    val kazoeYakuman = listOf("kazoeYakuman")
    val compositeYakuman = listOf("compositeYakuman")
    val doubleYakuman = listOf("doubleYakuman")
    val nagashiManganEnabled = listOf("nagashiManganEnabled")
    val nagashiDealerRepeatRequiresTenpai = listOf("nagashiDealerRepeatRequiresTenpai")
    val tsumoLoss = listOf("tsumoLoss")
    val nagashiCollectsRiichiPool = listOf("nagashiCollectsRiichiPool", "nagashiTakesPool")
    val bustEndsGame = listOf("bustEndsGame", "tobiEndsGame")
    val allowLowPointRiichi = listOf("allowLowPointRiichi")
}

@Throws(EngineException::class)
fun normalizeRulesConfig(rawConfig: Map<String, Any?>, inferredPlayerCount: Int? = null): EngineRulesConfig {
    val templateKey = rawConfig["templateKey"] as? String
    val templateBase = templateKey?.let { RULESET_TEMPLATES[it] }
    val explicitPlayerCount = pickNumber(rawConfig, RuleAliases.playerCount)
    if (explicitPlayerCount != null && explicitPlayerCount != 3.0 && explicitPlayerCount != 4.0) {
        throw EngineException("Invalid playerCount in config: ${jsNumber(explicitPlayerCount)}. Expected 3 or 4.")
    }
    if (explicitPlayerCount != null && inferredPlayerCount != null && explicitPlayerCount != inferredPlayerCount.toDouble()) {
        throw EngineException("Seat count mismatch: config specifies ${jsNumber(explicitPlayerCount)} players, but received $inferredPlayerCount seats.")
    }
    if (templateBase != null && (explicitPlayerCount != null && explicitPlayerCount != templateBase.playerCount.toDouble() ||
                inferredPlayerCount != null && inferredPlayerCount != templateBase.playerCount)) {
        throw EngineException("Seat count mismatch: template $templateKey requires ${templateBase.playerCount} players.")
    }
    val resolvedCount = explicitPlayerCount ?: templateBase?.playerCount?.toDouble() ?: inferredPlayerCount?.toDouble() ?: 4.0
    if (resolvedCount != 3.0 && resolvedCount != 4.0) {
        throw EngineException("Invalid player count: ${jsNumber(resolvedCount)}. Expected 3 or 4.")
    }
    val playerCount = resolvedCount.toInt()
    val base = templateBase ?: if (playerCount == 3) HOUSE_3P_V1 else HOUSE_4P_V1

    val startingPoints = pickNumber(rawConfig, RuleAliases.startingPoints)
        ?: base.startingPoints.toDouble()
    val returnPoints = pickNumber(rawConfig, RuleAliases.returnPoints)
        ?: base.returnPoints.toDouble()
    val targetPoints = pickNumber(rawConfig, RuleAliases.targetPoints) ?: returnPoints
    if (!validStoredInteger(startingPoints, 1) || startingPoints % 100.0 != 0.0) {
        throw EngineException("Invalid startingPoints: ${jsNumber(startingPoints)}. Must be a positive stored integer multiple of 100.")
    }
    if (!validStoredInteger(returnPoints, 1) || returnPoints % 100.0 != 0.0) {
        throw EngineException("Invalid returnPoints: ${jsNumber(returnPoints)}. Must be a positive stored integer multiple of 100.")
    }
    if (!validStoredInteger(targetPoints, 1) || targetPoints % 100.0 != 0.0) {
        throw EngineException("Invalid targetPoints: ${jsNumber(targetPoints)}. Must be a positive stored integer multiple of 100.")
    }

    var uma = base.uma
    val rawUma = rawConfig["uma"]
    val rawUmaTenths = rawConfig["umaTenths"]
    if (rawUma is List<*>) {
        if (rawUma.size != playerCount || rawUma.any { it !is Number || !it.toDouble().isFinite() }) {
            throw EngineException("Invalid uma array: must have $playerCount finite numbers.")
        }
        uma = rawUma.map { (it as Number).toDouble() }
    } else if (rawUmaTenths is List<*>) {
        if (rawUmaTenths.size != playerCount || rawUmaTenths.any {
                it !is Number || !it.toDouble().isFinite() || it.toDouble() % 1.0 != 0.0
            }) {
            throw EngineException("Invalid umaTenths array: must have $playerCount integers.")
        }
        uma = rawUmaTenths.map { (it as Number).toDouble() / 10.0 }
    }
    if (uma.any { !((it * 10.0).isFinite() && (it * 10.0) % 1.0 == 0.0 && abs(it * 10.0) <= MAX_STORED_INTEGER) } ||
        uma.sumOf { jsRound(it * 10.0) } != 0.0) {
        throw EngineException("Invalid uma: values must be stored integer tenths and sum to 0.")
    }

    val computedOka = ((returnPoints - startingPoints) * playerCount) / 1000.0
    val explicitOka = pickNumber(rawConfig, RuleAliases.oka)
    val explicitOkaTenths = pickNumber(rawConfig, RuleAliases.okaTenths)
    if (explicitOka != null && jsRound(explicitOka * 10.0) != jsRound(computedOka * 10.0)) {
        throw EngineException("Invalid oka: ${jsNumber(explicitOka)} does not match (returnPoints - startingPoints) * playerCount / 1000 = ${jsNumber(computedOka)}.")
    }
    if (explicitOkaTenths != null && explicitOkaTenths != jsRound(computedOka * 10.0)) {
        throw EngineException("Invalid okaTenths: ${jsNumber(explicitOkaTenths)} does not match expected ${jsNumber(jsRound(computedOka * 10.0))}.")
    }

    // Look up only known string aliases; no copy of a host map is necessary.
    @Suppress("UNCHECKED_CAST")
    val honbaFields = rawConfig["honba"] as? Map<String, Any?>
    var explicitHonbaPerPayer = pickNumber(rawConfig, RuleAliases.honbaPerPayer)
        ?: honbaFields?.let { pickNumber(it, RuleAliases.honbaObjPerPayer) }
    var explicitHonbaRon = pickNumber(rawConfig, RuleAliases.honbaRon)
        ?: honbaFields?.let { pickNumber(it, RuleAliases.honbaObjRon) }
        ?: (rawConfig["honba"] as? Number)?.toDouble()
    val payerCount = playerCount - 1
    if (explicitHonbaPerPayer != null && explicitHonbaRon != null) {
        if (explicitHonbaRon != explicitHonbaPerPayer * payerCount) {
            throw EngineException("Inconsistent honba config: honbaRon (${jsNumber(explicitHonbaRon)}) must equal (playerCount - 1) * honbaPerPayer (${jsNumber(explicitHonbaPerPayer * payerCount)}).")
        }
    } else if (explicitHonbaPerPayer != null) {
        explicitHonbaRon = explicitHonbaPerPayer * payerCount
    } else if (explicitHonbaRon != null) {
        if (explicitHonbaRon % payerCount != 0.0) {
            throw EngineException("Invalid honbaRon (${jsNumber(explicitHonbaRon)}) for $playerCount players: not divisible by $payerCount payers.")
        }
        explicitHonbaPerPayer = explicitHonbaRon / payerCount
    }
    val honbaPerPayer = explicitHonbaPerPayer ?: base.honbaPerPayer.toDouble()
    val honbaRon = explicitHonbaRon ?: base.honbaRon.toDouble()
    if (!validStoredInteger(honbaPerPayer) || honbaPerPayer % 100.0 != 0.0) {
        throw EngineException("Invalid honbaPerPayer: ${jsNumber(honbaPerPayer)}. Must be a non-negative stored integer multiple of 100.")
    }
    if (!validStoredInteger(honbaRon) || honbaRon % 100.0 != 0.0) {
        throw EngineException("Invalid honbaRon: ${jsNumber(honbaRon)}. Must be a non-negative stored integer multiple of 100.")
    }

    val notenPenaltyTotal = pickNumber(rawConfig, RuleAliases.notenPenaltyTotal)
        ?: base.notenPenaltyTotal.toDouble()
    if (!validStoredInteger(notenPenaltyTotal) || notenPenaltyTotal % 100.0 != 0.0) {
        throw EngineException("Invalid notenPenaltyTotal: ${jsNumber(notenPenaltyTotal)}. Must be a non-negative stored integer multiple of 100.")
    }
    val unit = if (playerCount == 3) 200 else 600
    if (notenPenaltyTotal % unit != 0.0) {
        throw EngineException("Invalid ${playerCount}p notenPenaltyTotal: ${jsNumber(notenPenaltyTotal)} must be divisible by $unit.")
    }

    val kiriageMangan = pickBoolean(rawConfig, RuleAliases.kiriageMangan) ?: base.kiriageMangan
    val kazoeYakuman = if (rawConfig["kazoeYakuman"] == "single_yakuman_at_13_han") true else
        pickBoolean(rawConfig, RuleAliases.kazoeYakuman) ?: base.kazoeYakuman
    val compositeYakuman = pickBoolean(rawConfig, RuleAliases.compositeYakuman) ?: base.compositeYakuman
    val doubleYakuman = pickBoolean(rawConfig, RuleAliases.doubleYakuman) ?: base.doubleYakuman
    val nagashiManganEnabled = pickBoolean(rawConfig, RuleAliases.nagashiManganEnabled) ?: base.nagashiManganEnabled
    val nagashiDealerRepeatRequiresTenpai = pickBoolean(rawConfig, RuleAliases.nagashiDealerRepeatRequiresTenpai)
        ?: base.nagashiDealerRepeatRequiresTenpai
    var tsumoLoss = pickBoolean(rawConfig, RuleAliases.tsumoLoss) ?: base.tsumoLoss
    if (rawConfig["tsumoPaymentMode"] is String) tsumoLoss = rawConfig["tsumoPaymentMode"] == "tsumo_loss"
    val configuredMultiRon = rawConfig["multiRon"] as? String
    val multiRon = when (configuredMultiRon) {
        "double_ron" -> "double_ron"
        "head_bump" -> "head_bump"
        "allow_all" -> "allow_all"
        else -> when {
            rawConfig["headBump"] == true || rawConfig["doubleRon"] == false -> "head_bump"
            rawConfig["tripleRon"] == "allow" || rawConfig["tripleRon"] == true -> "allow_all"
            else -> base.multiRon
        }
    }
    val doubleRonHonbaPolicy = (rawConfig["doubleRonHonbaPolicy"] as? String)
        ?.takeIf { it == "each_winner" || it == "nearest_only" } ?: base.doubleRonHonbaPolicy
    val nagashiCollectsRiichiPool = pickBoolean(rawConfig, RuleAliases.nagashiCollectsRiichiPool)
        ?: base.nagashiCollectsRiichiPool
    val bustEndsGame = pickBoolean(rawConfig, RuleAliases.bustEndsGame) ?: base.bustEndsGame
    val allowLowPointRiichi = pickBoolean(rawConfig, RuleAliases.allowLowPointRiichi) ?: base.allowLowPointRiichi
    val fixedSouth4EndPolicy = (rawConfig["fixedSouth4EndPolicy"] as? String)
        ?.takeIf { it == "completed_south_4" || it == "target_or_bust" } ?: base.fixedSouth4EndPolicy
    val terminalRiichiPoolPolicy = (rawConfig["terminalRiichiPoolPolicy"] as? String)
        ?.takeIf { it == "unallocated" || it == "first" } ?: base.terminalRiichiPoolPolicy
    val tiedUmaPolicy = (rawConfig["tiedUmaPolicy"] as? String)
        ?.takeIf { it == "split" || it == "seat_order" } ?: base.tiedUmaPolicy
    val automaticEndPolicy = (rawConfig["automaticEndPolicy"] as? String)
        ?.takeIf { it == "ranked_sanma" || it == "manual" } ?: base.automaticEndPolicy

    return EngineRulesConfig(
        templateKey = templateKey ?: base.templateKey, playerCount = playerCount,
        startingPoints = startingPoints.toInt(), returnPoints = returnPoints.toInt(), targetPoints = targetPoints.toInt(),
        uma = uma, oka = computedOka, honbaPerPayer = honbaPerPayer.toInt(), honbaRon = honbaRon.toInt(),
        notenPenaltyTotal = notenPenaltyTotal.toInt(), kiriageMangan = kiriageMangan,
        kazoeYakuman = kazoeYakuman, compositeYakuman = compositeYakuman, doubleYakuman = doubleYakuman,
        nagashiManganEnabled = nagashiManganEnabled,
        nagashiDealerRepeatRequiresTenpai = nagashiDealerRepeatRequiresTenpai, tsumoLoss = tsumoLoss,
        multiRon = multiRon, doubleRonHonbaPolicy = doubleRonHonbaPolicy,
        nagashiCollectsRiichiPool = nagashiCollectsRiichiPool, bustEndsGame = bustEndsGame,
        allowLowPointRiichi = allowLowPointRiichi, fixedSouth4EndPolicy = fixedSouth4EndPolicy,
        terminalRiichiPoolPolicy = terminalRiichiPoolPolicy, tiedUmaPolicy = tiedUmaPolicy,
        automaticEndPolicy = automaticEndPolicy,
    )
}

/** At this boundary malformed JSON inputs can be represented without coercing null to an empty config. */
@Throws(EngineException::class)
fun normalizeRulesConfig(rawConfig: Any?, inferredPlayerCount: Int? = null): EngineRulesConfig {
    if (rawConfig is List<*>) return normalizeRulesConfig(emptyMap(), inferredPlayerCount)
    if (rawConfig !is Map<*, *>) throw EngineException("Invalid rulesSnapshot.config: must be an object.")
    @Suppress("UNCHECKED_CAST")
    return normalizeRulesConfig(rawConfig as Map<String, Any?>, inferredPlayerCount)
}
