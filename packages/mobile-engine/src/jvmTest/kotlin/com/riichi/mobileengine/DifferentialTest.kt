package com.riichi.mobileengine

import java.io.File
import java.math.BigDecimal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals

/** Reads each JSONL record once; the 22 MB property corpus is never loaded into memory. */
class DifferentialTest {
    private val json = Json
    private object UndefinedValue

    private fun JsonElement.obj(): JsonObject = this as JsonObject
    private fun JsonElement.array(): JsonArray = this as JsonArray
    private fun JsonObject.required(key: String): JsonElement = getValue(key)
    private fun JsonElement.text(): String = (this as JsonPrimitive).content

    private fun decode(element: JsonElement): Any? = when (element) {
        JsonNull -> null
        is JsonArray -> element.map(::decode)
        is JsonObject -> when (element["\$type"]?.let { (it as? JsonPrimitive)?.content }) {
            "undefined" -> UndefinedValue
            "bigint" -> element.required("value").text().toLong()
            "number" -> when (element.required("value").text()) {
                "NaN" -> Double.NaN
                "Infinity" -> Double.POSITIVE_INFINITY
                "-Infinity" -> Double.NEGATIVE_INFINITY
                "-0" -> -0.0
                else -> error("Unrecognized encoded number $element")
            }
            else -> element.mapValues { decode(it.value) }
        }
        is JsonPrimitive -> when {
            element.isString -> element.content
            element.booleanOrNull != null -> element.booleanOrNull!!
            else -> element.longOrNull ?: element.doubleOrNull
                ?: error("Unrecognized JSON number $element")
        }
    }

    private fun JsonElement.rawMap(): Map<String, Any?> = decode(this) as Map<String, Any?>
    private fun Map<String, Any?>.integer(key: String): Int = (getValue(key) as Number).toInt()
    private fun Map<String, Any?>.optionalInteger(key: String): Int? = (this[key] as? Number)?.toInt()
    private fun Map<String, Any?>.string(key: String): String = getValue(key) as String
    private fun Map<String, Any?>.flag(key: String): Boolean = getValue(key) as Boolean

    private fun rules(value: JsonElement): RulesSnapshot {
        val raw = value.rawMap()
        return RulesSnapshot(raw.string("rulesHash"), raw.getValue("config") as Map<String, Any?>)
    }

    private fun hand(value: JsonElement): HandState {
        val raw = value.rawMap()
        val seats = (raw.getValue("seats") as List<*>).map { item ->
            val seat = item as Map<String, Any?>
            SeatState(seat.integer("seatNo"), seat.integer("points"), seat.flag("isRiichi"), seat["isTenpai"] as Boolean?)
        }
        return HandState(
            handId = raw.string("handId"), roundWind = raw.string("roundWind"),
            roundNumber = raw.integer("roundNumber"), dealerSeatNo = raw.integer("dealerSeatNo"),
            honba = raw.integer("honba"), riichiPool = raw.integer("riichiPool"), seats = seats,
            markRevision = (raw.getValue("markRevision") as Number).toLong(),
            resultRevision = (raw.getValue("resultRevision") as Number).toLong(),
        )
    }

    private fun result(value: JsonElement): ResultInput {
        val raw = value.rawMap()
        val winners = (raw["winners"] as? List<*>)?.map { item ->
            val winner = item as Map<String, Any?>
            WinnerInput(
                seatNo = winner.integer("seatNo"), han = winner.integer("han"), fu = winner.integer("fu"),
                yakumanCount = winner.optionalInteger("yakumanCount"),
                dealInSeatNo = winner.optionalInteger("dealInSeatNo"),
                doubleYakumanCount = winner.optionalInteger("doubleYakumanCount"),
                isRiichiDeclarationDealIn = winner["isRiichiDeclarationDealIn"] as? Boolean,
            )
        } ?: emptyList()
        val eligibility = (raw["nagashiEligibility"] as? List<*>)?.map { item ->
            val entry = item as Map<String, Any?>
            NagashiEligibilityInput(entry.integer("seatNo"), (entry.getValue("discards") as List<*>).map { discard ->
                val d = discard as Map<String, Any?>
                DiscardInput(d.string("tile"), d.flag("called"))
            })
        }
        fun payments(key: String): Map<Int, Int>? = (raw[key] as? Map<*, *>)?.map { (seat, amount) ->
            (seat as String).toInt() to (amount as Number).toInt()
        }?.toMap()
        fun roles(key: String): Map<Int, String>? = (raw[key] as? Map<*, *>)?.map { (seat, role) ->
            (seat as String).toInt() to (role as String)
        }?.toMap()
        return ResultInput(
            kind = raw.string("kind"), winners = winners, nagashiEligibility = eligibility,
            tenpai = (raw["tenpai"] as? List<*>)?.map { it as Boolean },
            chomboRole = roles("chomboRole"),
            riichiDeclarationDealInSeatNo = raw.optionalInteger("riichiDeclarationDealInSeatNo"),
            manualPayments = payments("manualPayments"),
        )
    }

    private fun nextHand(value: JsonElement): NextHandState {
        val raw = value.rawMap()
        return NextHandState(raw.string("roundWind"), raw.integer("roundNumber"),
            raw.integer("dealerSeatNo"), raw.integer("honba"), raw.integer("riichiPool"))
    }

    private fun balances(value: JsonElement): List<SeatBalance> = value.array().map { item ->
        val raw = item.rawMap()
        SeatBalance(raw.integer("seatNo"), raw.integer("points"))
    }

    private fun terminalOptions(value: JsonElement?): TerminalSettlementOptions? {
        if (value == null || value == JsonNull) return null
        val raw = value.rawMap()
        return TerminalSettlementOptions(
            riichiPool = raw.optionalInteger("riichiPool"),
            startingDealerSeatNo = raw.optionalInteger("startingDealerSeatNo"),
            requireTargetPoints = raw["requireTargetPoints"] as Boolean?,
            completedSouth4 = raw["completedSouth4"] as Boolean?,
        )
    }

    private fun invoke(operation: String, args: JsonArray): Any? = when (operation) {
        "normalizeRulesConfig" -> normalizeRulesConfig(args[0].rawMap(),
            args.getOrNull(1)?.let { if (it == JsonNull) null else (decode(it) as Number).toInt() })
        "calculateSettlement" -> {
            val rawResult = args[2].rawMap()
            val malformedFlag = (rawResult["winners"] as? List<*>)?.any { item ->
                val marker = (item as Map<*, *>)["isRiichiDeclarationDealIn"]
                marker != null && marker !== UndefinedValue && marker !is Boolean
            } == true
            if (malformedFlag) calculateSettlement(rules(args[0]), hand(args[1]), rawResult as Any?, args[3].text())
            else calculateSettlement(rules(args[0]), hand(args[1]), result(args[2]), args[3].text())
        }
        "isAutomaticMatchEnd" -> isAutomaticMatchEnd(args[0].rawMap(), hand(args[1]),
            result(args[2]), nextHand(args[3]), balances(args[4]))
        "calculateTerminalSettlement" -> calculateTerminalSettlement(decode(args[0]), decode(args[1])!!,
            terminalOptions(args.getOrNull(2)))
        else -> error("Unknown fixture operation $operation")
    }

    // Explicit output projection keeps null-valued required fields, while omitting absent optional fields.
    private fun projected(value: Any?): Any? = when (value) {
        is EngineRulesConfig -> buildMap<String, Any?> {
            if (value.templateKey != null) put("templateKey", value.templateKey)
            put("playerCount", value.playerCount)
            put("startingPoints", value.startingPoints)
            put("returnPoints", value.returnPoints)
            put("targetPoints", value.targetPoints)
            put("uma", value.uma)
            put("oka", value.oka)
            put("honbaPerPayer", value.honbaPerPayer)
            put("honbaRon", value.honbaRon)
            put("notenPenaltyTotal", value.notenPenaltyTotal)
            put("kiriageMangan", value.kiriageMangan)
            put("kazoeYakuman", value.kazoeYakuman)
            put("compositeYakuman", value.compositeYakuman)
            put("doubleYakuman", value.doubleYakuman)
            put("nagashiManganEnabled", value.nagashiManganEnabled)
            put("nagashiDealerRepeatRequiresTenpai", value.nagashiDealerRepeatRequiresTenpai)
            put("tsumoLoss", value.tsumoLoss)
            put("multiRon", value.multiRon)
            put("doubleRonHonbaPolicy", value.doubleRonHonbaPolicy)
            put("nagashiCollectsRiichiPool", value.nagashiCollectsRiichiPool)
            put("bustEndsGame", value.bustEndsGame)
            put("allowLowPointRiichi", value.allowLowPointRiichi)
            put("fixedSouth4EndPolicy", value.fixedSouth4EndPolicy)
            put("terminalRiichiPoolPolicy", value.terminalRiichiPoolPolicy)
            put("tiedUmaPolicy", value.tiedUmaPolicy)
            put("automaticEndPolicy", value.automaticEndPolicy)
        }
        is SettlementOutput -> mapOf("perSeat" to value.perSeat, "nextHand" to value.nextHand)
        is SeatPayment -> mapOf("seatNo" to value.seatNo, "netPoints" to value.netPoints, "breakdown" to value.breakdown)
        is BreakdownEntry -> mapOf("reason" to value.reason, "amount" to value.amount)
        is NextHandState -> mapOf("roundWind" to value.roundWind, "roundNumber" to value.roundNumber,
            "dealerSeatNo" to value.dealerSeatNo, "honba" to value.honba, "riichiPool" to value.riichiPool)
        is TerminalSettlementOutput.NotEnded -> mapOf(
            "isGameEnd" to false, "gameEndReason" to "not_ended",
            "unclaimedRiichiPoints" to value.unclaimedRiichiPoints,
            "poolRecipientSeatNo" to null, "perSeat" to value.perSeat,
            "standings" to emptyList<Any>(), "tenths" to emptyList<Any>(),
        )
        is TerminalSettlementOutput.Ended -> mapOf(
            "isGameEnd" to true, "gameEndReason" to value.gameEndReason,
            "unclaimedRiichiPoints" to value.unclaimedRiichiPoints,
            "poolRecipientSeatNo" to value.poolRecipientSeatNo, "perSeat" to value.perSeat,
            "standings" to value.standings, "tenths" to value.tenths,
        )
        is TerminalSeatPoints -> mapOf(
            "seatNo" to value.seatNo, "rawPoints" to value.rawPoints, "finalPoints" to value.finalPoints,
        )
        is TerminalSeatResult -> mapOf(
            "seatNo" to value.seatNo, "rawPoints" to value.rawPoints, "finalPoints" to value.finalPoints,
            "rank" to value.rank, "baseTenths" to value.baseTenths, "umaTenths" to value.umaTenths,
            "okaTenths" to value.okaTenths, "penaltyTenths" to value.penaltyTenths,
            "totalTenths" to value.totalTenths, "competencyPoints" to value.competencyPoints,
        )
        is Map<*, *> -> value.mapValues { projected(it.value) }
        is List<*> -> value.map(::projected)
        else -> value
    }

    /** Compare JSON trees structurally: object keys are unordered, arrays ordered, numbers exact. */
    private fun compare(expected: JsonElement, actual: Any?, path: String = "$"): String? {
        val output = projected(actual)
        return when (expected) {
            JsonNull -> if (output == null) null else "$path: expected null, got $output"
            is JsonObject -> {
                if (output !is Map<*, *>) return "$path: expected object, got $output"
                val missing = expected.keys - output.keys
                if (missing.isNotEmpty()) return "$path.${missing.first()}: missing key"
                val extra = output.keys - expected.keys
                if (extra.isNotEmpty()) return "$path.${extra.first()}: unexpected key"
                expected.entries.firstNotNullOfOrNull { (key, child) -> compare(child, output[key], "$path.$key") }
            }
            is JsonArray -> {
                if (output !is List<*>) return "$path: expected array, got $output"
                if (expected.size != output.size) return "$path: expected length ${expected.size}, got ${output.size}"
                expected.indices.firstNotNullOfOrNull { index -> compare(expected[index], output[index], "$path[$index]") }
            }
            is JsonPrimitive -> {
                if (expected.isString) {
                    if (output == expected.content) null else "$path: expected $expected, got $output"
                } else if (expected.booleanOrNull != null) {
                    if (output == expected.booleanOrNull) null else "$path: expected $expected, got $output"
                } else {
                    val numeric = output as? Number ?: return "$path: expected numeric $expected, got $output"
                    val decimal = try { BigDecimal(numeric.toString()) } catch (_: NumberFormatException) {
                        return "$path: expected numeric $expected, got $numeric"
                    }
                    if (BigDecimal(expected.content).compareTo(decimal) == 0) null
                    else "$path: expected $expected, got $numeric"
                }
            }
        }
    }

    private fun failure(error: Throwable): Map<String, String> {
        val category = when (error) {
            is EngineException -> when (error.category) {
                EngineErrorCategory.ENGINE_VALIDATION -> "engine-validation"
                EngineErrorCategory.HOST_TYPE -> "host-type"
                EngineErrorCategory.OTHER -> "other"
            }
            is ClassCastException, is NullPointerException, is IndexOutOfBoundsException -> "host-type"
            else -> "other"
        }
        val errorClass = when (category) {
            "host-type" -> "TypeError"
            else -> "Error"
        }
        return mapOf("kind" to "throw", "errorClass" to errorClass,
            "message" to (error.message ?: error.toString()), "category" to category)
    }

    private fun fixtureDirectory(): File {
        val candidates = listOf(File("golden"), File("../golden"))
        return candidates.firstOrNull { File(it, "manifest.json").isFile }
            ?: error("golden/manifest.json missing from ${File(".").absolutePath}")
    }

    @Test
    fun goldenDifferential() {
        val golden = fixtureDirectory()
        val manifest = json.parseToJsonElement(File(golden, "manifest.json").readText()).obj()
        val fileManifest = manifest.required("files").obj()
        val report = StringBuilder("Kotlin engine differential against golden fixtures\n")
        val mismatchSummaries = mutableListOf<String>()
        var mismatchCount = 0
        var total = 0
        for ((fileName, statsElement) in fileManifest) {
            val stats = statsElement.obj()
            val expectedCounts = stats.required("counts").obj().mapValues { it.value.text().toInt() }
            val counts = expectedCounts.keys.associateWith { 0 }.toMutableMap()
            var count = 0
            File(golden, fileName).bufferedReader().useLines { lines ->
                for (line in lines) {
                    val fixture = json.parseToJsonElement(line).obj()
                    val id = fixture.required("id").text()
                    val operation = fixture.required("operation").text()
                    counts[operation] = (counts[operation] ?: error("Unexpected operation $operation")) + 1
                    count++
                    val expected = fixture.required("expected").obj()
                    val actual: Any? = try {
                        mapOf("kind" to "return", "value" to invoke(operation, fixture.required("args").array()))
                    } catch (error: Throwable) {
                        failure(error)
                    }
                    val diff = compare(expected, actual)
                    if (diff != null) {
                        mismatchCount++
                        if (mismatchSummaries.size < 20) mismatchSummaries += "$fileName $id $operation $diff"
                    }
                }
            }
            report.append("$fileName: $count records\n")
            for ((operation, expectedCount) in expectedCounts) {
                report.append("  $operation: ${counts[operation]} / $expectedCount\n")
            }
            val manifestCount = stats.required("totalCount").text().toInt()
            if (count != manifestCount || counts != expectedCounts) {
                mismatchCount++
                mismatchSummaries += "$fileName: manifest expected $manifestCount $expectedCounts; observed $count $counts"
            }
            total += count
        }
        val declaredTotal = manifest.required("totalCount").text().toInt()
        if (total != declaredTotal) {
            mismatchCount++
            mismatchSummaries += "manifest total expected $declaredTotal; observed $total"
        }
        report.append("Total: $total / $declaredTotal; mismatches: $mismatchCount\n")
        report.append("First 20 mismatch paths:\n")
        mismatchSummaries.take(20).forEach { report.append("  $it\n") }
        val reportFile = File("build/reports/differential.txt")
        reportFile.parentFile.mkdirs()
        reportFile.writeText(report.toString())
        assertEquals(declaredTotal, total, reportFile.path)
        assertEquals(0, mismatchCount, "See ${reportFile.path}: ${mismatchSummaries.firstOrNull() ?: "manifest count mismatch"}")
    }

    @Test
    fun canonicalTemplates() {
        assertEquals("0.1.0", ENGINE_VERSION)
        assertEquals(
            setOf("house_4p_v1", "wrc_4p_ref_v1", "house_3p_v1", "common_3p_ref_v1"),
            RULESET_TEMPLATES.keys,
        )
        assertEquals(HOUSE_4P_V1, normalizeRulesConfig(emptyMap()))
        for ((key, template) in listOf(
            "house_4p_v1" to HOUSE_4P_V1,
            "wrc_4p_ref_v1" to WRC_4P_REF_V1,
            "house_3p_v1" to HOUSE_3P_V1,
            "common_3p_ref_v1" to COMMON_3P_REF_V1,
        )) {
            assertEquals(template, normalizeRulesConfig(mapOf("templateKey" to key)), key)
            assertEquals(key, template.templateKey)
        }
        assertEquals(listOf(20.0, 10.0, -10.0, -20.0), HOUSE_4P_V1.uma)
        assertEquals(25000, HOUSE_4P_V1.startingPoints)
        assertEquals(30000, HOUSE_4P_V1.returnPoints)
        assertEquals("target_or_bust", HOUSE_4P_V1.fixedSouth4EndPolicy)
        assertEquals(listOf(15.0, 5.0, -5.0, -15.0), WRC_4P_REF_V1.uma)
        assertEquals("head_bump", WRC_4P_REF_V1.multiRon)
        assertEquals("completed_south_4", WRC_4P_REF_V1.fixedSouth4EndPolicy)
        assertEquals(3, HOUSE_3P_V1.playerCount)
        assertEquals(35000, HOUSE_3P_V1.startingPoints)
        assertEquals(40000, HOUSE_3P_V1.returnPoints)
        assertEquals(2000, COMMON_3P_REF_V1.notenPenaltyTotal)
        assertEquals("ranked_sanma", COMMON_3P_REF_V1.automaticEndPolicy)
    }
}
