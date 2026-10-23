package com.p1ziyu.riichitracker.p1

import com.riichi.mobileengine.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID
import java.security.MessageDigest

/** Frozen v1 records: historical outputs are displayed, never recomputed on read. */
@Serializable data class LocalHandSeat(val seatNo: Int, val points: Int, val isRiichi: Boolean = false,
    val isTenpai: Boolean? = null, val usage: RiichiUsage = RiichiUsage())
@Serializable data class LocalHand(val handId: String, val roundWind: String, val roundNumber: Int,
    val dealerSeatNo: Int, val honba: Int, val riichiPool: Int, val seats: List<LocalHandSeat>,
    val markRevision: Long = 0, val resultRevision: Long = 0)
@Serializable data class LocalTerminalSeat(val seatNo: Int, val rank: Int, val rawPoints: Int,
    val finalPoints: Int, val baseTenths: Int, val umaTenths: Int, val okaTenths: Int,
    val penaltyTenths: Int, val totalTenths: Int, val competencyPoints: Double)
@Serializable data class LocalTerminal(val isGameEnd: Boolean, val gameEndReason: String,
    val unclaimedRiichiPoints: Int, val poolRecipientSeatNo: Int?,
    val perSeat: List<LocalTerminalSeat>, val standings: List<LocalTerminalSeat>, val tenths: List<Int>)
@Serializable data class LocalResult(val hand: LocalHand, val input: JsonObject,
    val output: PaymentPreview, val settledAt: String)
@Serializable data class LocalMatch(val id: String, val name: String, val seedKey: String,
    val templateName: String, val reviewStatus: String, val createdAt: String, val updatedAt: String,
    val engineVersion: String, val rulesHash: String, val rules: JsonObject,
    val startingDealerSeatNo: Int, val seats: List<String>, val points: List<Int>,
    val status: String = "active", val currentHand: LocalHand? = null, val nextHand: NextHandDto? = null,
    val results: List<LocalResult> = emptyList(), val terminal: LocalTerminal? = null,
    val settlementConfirmed: Boolean = false, val draft: ResultDraft? = null, val revision: Long = 0)

data class LocalTemplate(val key: String, val title: String, val review: String, val engineKey: String)
val LOCAL_TEMPLATES = listOf(
    LocalTemplate("reference_4p_competition", "四麻国际竞技参考", "pending", "wrc_4p_ref_v1"),
    LocalTemplate("reference_3p_common", "三麻常见玩法参考", "pending", "common_3p_ref_v1"),
    LocalTemplate("house_4p", "四麻家规", "reviewed", "house_4p_v1"),
    LocalTemplate("house_3p", "三麻家规", "reviewed", "house_3p_v1"),
)
fun localTemplateDto(template: LocalTemplate): TemplateDto {
    val seed = requireNotNull(RULESET_TEMPLATES[template.engineKey])
    return TemplateDto(template.key, template.title, "system", template.review,
        JsonObject(seed.toFields() + ("templateKey" to JsonPrimitive(template.engineKey))),
        template.key, if (seed.playerCount == 3) "3p" else "4p")
}
fun LocalMatch.customizedRules(): List<String> {
    val template = LOCAL_TEMPLATES.firstOrNull { it.key == seedKey } ?: return emptyList()
    val base = RULESET_TEMPLATES.getValue(template.engineKey).toFields()
    return base.keys.filter { rules[it] != base[it] }.map(::ruleLabel)
}

internal fun localRulesHash(rules: JsonObject): String {
    val canonical = JsonObject(rules.toSortedMap()).toString().toByteArray(Charsets.UTF_8)
    val digest = MessageDigest.getInstance("SHA-256").digest(canonical)
    val hex = "0123456789abcdef"
    return buildString(digest.size * 2) {
        for (byte in digest) {
            val value = byte.toInt() and 0xff
            append(hex[value ushr 4]); append(hex[value and 15])
        }
    }
}
private fun LocalMatch.config(): Map<String, Any?> = rules.mapValues { it.value.toEngineValue() }
private fun LocalMatch.snapshot() = RulesSnapshot(rulesHash, config())
private fun LocalHand.engine() = HandState(handId, roundWind, roundNumber, dealerSeatNo, honba,
    riichiPool, seats.map { SeatState(it.seatNo, it.points, it.isRiichi, it.isTenpai) }, markRevision, resultRevision)
private fun JsonObject.engineResult(): ResultInput = ResultInput(
    kind = getValue("kind").jsonPrimitive.content,
    winners = (getValue("winners") as JsonArray).map { value ->
        val winner = value.jsonObject
        WinnerInput(winner.getValue("seatNo").jsonPrimitive.int, winner.getValue("han").jsonPrimitive.int,
            winner.getValue("fu").jsonPrimitive.int, winner["yakumanCount"]?.jsonPrimitive?.intOrNull,
            winner["dealInSeatNo"]?.jsonPrimitive?.intOrNull,
            winner["doubleYakumanCount"]?.jsonPrimitive?.intOrNull)
    },
    nagashiEligibility = (get("nagashiEligibility") as? JsonArray)?.map { value ->
        val item = value.jsonObject
        NagashiEligibilityInput(item.getValue("seatNo").jsonPrimitive.int,
            item.getValue("discards").jsonArray.map { discard ->
                DiscardInput(discard.jsonObject.getValue("tile").jsonPrimitive.content,
                    discard.jsonObject.getValue("called").jsonPrimitive.boolean)
            })
    },
    tenpai = (get("tenpai") as? JsonArray)?.map { it.jsonPrimitive.boolean },
    riichiDeclarationDealInSeatNo = get("riichiDeclarationDealInSeatNo")?.jsonPrimitive?.intOrNull,
)
private fun SettlementOutput.stored() = PaymentPreview(perSeat.map { seat ->
    PaymentSeat(seat.seatNo, seat.netPoints, seat.breakdown.map { PaymentPart(it.reason, it.amount) })
}, NextHandDto(nextHand.roundWind, nextHand.roundNumber, nextHand.dealerSeatNo, nextHand.honba, nextHand.riichiPool))

fun createLocalMatch(rules: JsonObject, seedKey: String, name: String, names: List<String>, dealer: Int,
                     now: String = Instant.now().toString(), id: String = "local-${UUID.randomUUID()}"): LocalMatch {
    val seed = LOCAL_TEMPLATES.firstOrNull { it.key == seedKey } ?: error("本地模板不存在")
    val expected = RULESET_TEMPLATES.getValue(seed.engineKey)
    val frozen = JsonObject(rules + mapOf("templateKey" to JsonPrimitive(seed.engineKey),
        "playerCount" to JsonPrimitive(expected.playerCount)))
    val config = normalizeRulesConfig(frozen.mapValues { it.value.toEngineValue() })
    require(config.playerCount == names.size && dealer in names.indices) { "起家座位或人数无效" }
    require(names.all { it.length <= 40 } && name.isNotBlank()) { "玩家姓名最多 40 字，牌桌名称不能为空" }
    val next = NextHandDto("E", 1, dealer, 0, 0)
    val initial = LocalMatch(id, name.trim(), seedKey, seed.title, seed.review, now, now,
        ENGINE_VERSION, localRulesHash(frozen), frozen, dealer,
        names.mapIndexed { index, value -> value.trim().ifEmpty { "玩家 ${index + 1}" } },
        List(config.playerCount) { config.startingPoints }, nextHand = next)
    return initial.openHand()
}
fun LocalMatch.openHand(): LocalMatch {
    check(engineVersion == ENGINE_VERSION) { "该桌引擎版本不受支持，只能查看已保存的结果" }
    check(status == "active" && currentHand == null && nextHand != null) { "当前不能新开一局" }
    check(!(rules["fixedSouth4EndPolicy"]?.jsonPrimitive?.content == "completed_south_4" &&
        nextHand.roundWind == "W" && nextHand.roundNumber == 1)) { "固定南四局已结束，请先终局" }
    val next = nextHand
    return copy(currentHand = LocalHand(UUID.randomUUID().toString(), next.roundWind, next.roundNumber,
        next.dealerSeatNo, next.honba, next.riichiPool,
        points.indices.map { LocalHandSeat(it, points[it]) }), draft = null)
}
fun LocalMatch.renameSeat(seat: Int, newName: String): LocalMatch {
    check(engineVersion == ENGINE_VERSION) { "该桌引擎版本不受支持，只能查看已保存的结果" }
    check(status == "active") { "已结束牌局的座位姓名属于不可变历史" }
    check(seat in seats.indices && newName.isNotBlank() && newName.length <= 40) { "玩家姓名须为 1–40 字" }
    return copy(seats = seats.mapIndexed { i, value -> if (i == seat) newName.trim() else value })
}
fun LocalMatch.markRiichi(seatNo: Int): LocalMatch {
    check(engineVersion == ENGINE_VERSION) { "该桌引擎版本不受支持，只能查看已保存的结果" }
    val hand = requireNotNull(currentHand?.takeIf { status == "active" }) { "没有进行中的局" }
    val seat = hand.seats.firstOrNull { it.seatNo == seatNo } ?: error("座位不存在")
    val usage = seat.usage
    check(seat.isRiichi || seat.points >= 1000 || rules["allowLowPointRiichi"]?.jsonPrimitive?.boolean == true) { "点数不足" }
    check(if (seat.isRiichi) usage.cancels < 1 else usage.declares < 2) { "该座位立直次数已达上限" }
    return copy(currentHand = hand.copy(markRevision = hand.markRevision + 1,
        seats = hand.seats.map { if (it.seatNo != seatNo) it else it.copy(isRiichi = !it.isRiichi,
            usage = usage.copy(declares = usage.declares + if (it.isRiichi) 0 else 1,
                cancels = usage.cancels + if (it.isRiichi) 1 else 0)) }))
}
fun LocalMatch.previewResult(input: JsonObject): PaymentPreview {
    check(engineVersion == ENGINE_VERSION) { "该桌引擎版本不受支持，只能查看已保存的结果" }
    val hand = requireNotNull(currentHand?.takeIf { status == "active" }) { "没有进行中的局" }
    return calculateSettlement(snapshot(), hand.engine(), input.engineResult(), engineVersion).stored()
}
fun LocalMatch.settle(input: JsonObject, now: String = Instant.now().toString()): LocalMatch {
    val hand = requireNotNull(currentHand) { "没有进行中的局" }
    val output = previewResult(input)
    val payments = output.perSeat.associateBy { it.seatNo }
    check(payments.size == points.size && points.indices.all { it in payments }) { "引擎支付座位不完整" }
    val balances = points.indices.map { index -> Math.addExact(points[index], payments.getValue(index).netPoints) }
    check(output.perSeat.sumOf { it.netPoints.toLong() } + output.nextHand.riichiPool - hand.riichiPool == 0L) { "结算点数不守恒" }
    val next = output.nextHand
    val autoEnd = isAutomaticMatchEnd(config(), hand.engine(), input.engineResult(),
        NextHandState(next.roundWind, next.roundNumber, next.dealerSeatNo, next.honba, next.riichiPool),
        balances.indices.map { SeatBalance(it, balances[it]) })
    return copy(status = if (autoEnd) "finished" else "active", points = balances,
        currentHand = null, nextHand = next, draft = null,
        results = results + LocalResult(hand, input, output, now))
}
fun LocalMatch.finish(): LocalMatch {
    check(engineVersion == ENGINE_VERSION) { "该桌引擎版本不受支持，只能查看已保存的结果" }
    check(status == "active") { "牌局已经结束" }
    check(rules["automaticEndPolicy"]?.jsonPrimitive?.content != "ranked_sanma") { "段位战结束条件尚未满足" }
    val fixed = rules["fixedSouth4EndPolicy"]?.jsonPrimitive?.content == "completed_south_4"
    if (fixed) check(nextHand?.roundWind == "W" && nextHand.roundNumber == 1 &&
        results.any { it.hand.roundWind == "S" && it.hand.roundNumber == 4 }) { "固定南四局尚未结束" }
    else check(points.max() >= (rules["targetPoints"]?.jsonPrimitive?.int ?: Int.MAX_VALUE) ||
        (rules["bustEndsGame"]?.jsonPrimitive?.boolean == true && points.any { it < 0 })) { "尚未达到终局条件" }
    return copy(status = "finished", currentHand = null, draft = null)
}
fun LocalMatch.previewTerminal(): LocalTerminal {
    check(status == "finished" && engineVersion == ENGINE_VERSION) { "请先终局；不支持的引擎版本只能查看旧记录" }
    val completed = rules["fixedSouth4EndPolicy"]?.jsonPrimitive?.content == "completed_south_4" &&
        nextHand?.roundWind == "W" && nextHand.roundNumber == 1 &&
        results.any { it.hand.roundWind == "S" && it.hand.roundNumber == 4 }
    val result = calculateTerminalSettlement(TerminalPointsInput.PointList(points), snapshot(),
        TerminalSettlementOptions(nextHand?.riichiPool ?: 0, startingDealerSeatNo, true, completed))
    check(result is TerminalSettlementOutput.Ended) { "终局成绩尚未产生" }
    fun stored(seat: TerminalSeatResult) = LocalTerminalSeat(seat.seatNo, seat.rank, seat.rawPoints, seat.finalPoints,
        seat.baseTenths, seat.umaTenths, seat.okaTenths, seat.penaltyTenths, seat.totalTenths, seat.competencyPoints)
    return LocalTerminal(result.isGameEnd, result.gameEndReason, result.unclaimedRiichiPoints,
        result.poolRecipientSeatNo, result.perSeat.map(::stored), result.standings.map(::stored), result.tenths)
}
fun LocalMatch.confirmTerminal(): LocalMatch {
    check(!settlementConfirmed) { "终局成绩已确认" }
    return copy(terminal = previewTerminal(), settlementConfirmed = true)
}
private fun validLocalSeat(seat: LocalHandSeat): Boolean =
    seat.usage.declares in 0..2 && seat.usage.cancels in 0..1 &&
        seat.usage.declares - seat.usage.cancels == (if (seat.isRiichi) 1 else 0)
private fun validLocalNext(next: NextHandDto, count: Int): Boolean =
    next.roundWind in listOf("E", "S", "W") && next.roundNumber in 1..count &&
        next.dealerSeatNo in 0 until count && next.honba >= 0 &&
        next.riichiPool >= 0 && next.riichiPool % 1000 == 0
private fun validLocalHand(hand: LocalHand, count: Int): Boolean =
    hand.handId.isNotBlank() && hand.roundWind in listOf("E", "S", "W") &&
        hand.roundNumber in 1..count && hand.dealerSeatNo in 0 until count &&
        hand.honba >= 0 && hand.riichiPool >= 0 && hand.riichiPool % 1000 == 0 &&
        hand.markRevision >= 0 && hand.resultRevision >= 0 &&
        hand.seats.size == count && hand.seats.map { it.seatNo }.toSet() == (0 until count).toSet() &&
        hand.seats.all(::validLocalSeat)
/** Read failures are fatal: never treat a broken record as an empty list. */
fun LocalMatch.validateStored(): LocalMatch {
    check(id.startsWith("local-") && status in setOf("active", "finished") && seats.size in 3..4 &&
        startingDealerSeatNo in seats.indices && rulesHash == localRulesHash(rules) &&
        rules["playerCount"]?.jsonPrimitive?.intOrNull == seats.size &&
        points.size == seats.size && results.all { result ->
            result.output.perSeat.size == points.size &&
                result.output.perSeat.map { it.seatNo }.toSet() == points.indices.toSet() &&
                validLocalHand(result.hand, points.size) &&
                validLocalNext(result.output.nextHand, points.size)
        } &&
        (nextHand == null || validLocalNext(nextHand, points.size)) &&
        (status != "active" || nextHand != null) && (status != "finished" || currentHand == null) &&
        (currentHand == null || validLocalHand(currentHand, points.size)) &&
        (terminal == null || terminal.isGameEnd && terminal.perSeat.size == points.size &&
            terminal.standings.size == points.size && terminal.tenths.size == points.size &&
            terminal.perSeat.map { it.seatNo }.toSet() == points.indices.toSet() &&
            terminal.standings.map { it.seatNo }.toSet() == points.indices.toSet()) &&
        (!settlementConfirmed || terminal != null)) { "本地牌局记录不完整；请先备份数据" }
    return this
}
