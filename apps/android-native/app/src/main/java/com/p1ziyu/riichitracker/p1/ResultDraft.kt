package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
private val TILE_SEPARATOR = Regex("[\\s,，]+")
private val NAGASHI_TILE = Regex("(?:[19][mps]|[1-7]z)")

@Serializable data class WinnerDraft(
    val seatNo: Int, val han: String = "2", val fu: String = "30",
    val yakuman: Boolean = false, val yakumanCount: String = "0", val doubleYakumanCount: String = "0",
)

@Serializable data class ResultDraft(
    val kind: String = "ron", val winners: List<WinnerDraft> = emptyList(),
    val dealInSeatNo: Int? = null, val declarationDealIn: Boolean = false,
    val tenpai: Set<Int> = emptySet(), val river: String = "", val attested: Boolean = false,
)

data class ValidatedResult(val input: JsonObject?, val errors: Map<String, String>)

/** The three-ron abortive case is engine-supported but the double_ron entry offers only two;
 * allow_all is the policy that offers every other seat. */
fun ronWinnerLimit(snapshot: JsonObject?, playerCount: Int): Int = when (
    snapshot?.get("multiRon")?.jsonPrimitive?.content
) {
    "head_bump" -> 1
    "double_ron" -> minOf(2, playerCount - 1)
    "allow_all" -> playerCount - 1
    else -> 1 // An unavailable rule snapshot must not grant multi-ron entry.
}

fun validateResultDraft(draft: ResultDraft, table: TableSnapshot, hand: CurrentHandDto): ValidatedResult {
    val errors = linkedMapOf<String, String>()
    val seats = table.seats.sortedBy { it.seatNo }.map { it.seatNo }
    val rules = table.match.rulesSnapshot
    val winners = draft.winners
    val scoring = draft.kind == "ron" || draft.kind == "tsumo"
    val selected = if (draft.kind == "ryuukyoku") emptyList() else winners
    if (seats.size != table.match.playerCount || seats != (0 until table.match.playerCount).toList())
        errors["seats"] = "座位信息不完整，请刷新牌桌"
    if (hand.status != "open" || hand.id == null || hand.markRevision == null)
        errors["hand"] = "当前局尚不可结算，请刷新牌桌"
    if (draft.kind !in listOf("ron", "tsumo", "ryuukyoku", "nagashi_mangan"))
        errors["kind"] = "请选择有效局结果"
    val cap = when (draft.kind) {
        "ron" -> ronWinnerLimit(rules, table.match.playerCount)
        "nagashi_mangan" -> if (rules?.get("nagashiManganEnabled")?.jsonPrimitive?.booleanOrNull == true) 1 else 0
        "tsumo" -> 1
        else -> 0
    }
    if (selected.size !in 1..cap && draft.kind != "ryuukyoku") errors["winners"] = "此规则最多允许 $cap 位赢家"
    if (selected.map { it.seatNo }.distinct().size != selected.size || selected.any { it.seatNo !in seats })
        errors["winners"] = "赢家座位必须各不相同且属于本桌"
    if (draft.kind == "ron") {
        if (draft.dealInSeatNo !in seats || selected.any { it.seatNo == draft.dealInSeatNo })
            errors["dealInSeatNo"] = "请选择一位不同于所有赢家的放铳者"
        if (draft.declarationDealIn && hand.seats.none { it.seatNo == draft.dealInSeatNo && it.isRiichi == true })
            errors["declarationDealIn"] = "仅已标记立直的放铳者可声明宣言牌放铳"
    } else if (draft.declarationDealIn) errors["declarationDealIn"] = "仅荣和可声明宣言牌放铳"
    val parsed = selected.mapIndexed { index, winner ->
        fun number(field: String, value: String, max: Int, min: Int = 0): Int? {
            val n = value.toIntOrNull()
            if (n == null || n !in min..max || value != n.toString())
                errors["winners.$index.$field"] = "$field 必须是 $min–$max 的整数"
            return n
        }
        val ordinary = if (scoring && winner.yakuman) number("yakumanCount", winner.yakumanCount,
            if (rules?.get("compositeYakuman")?.jsonPrimitive?.booleanOrNull == true) 10 else 1) else 0
        val special = if (scoring && winner.yakuman) number("doubleYakumanCount", winner.doubleYakumanCount, 10) else 0
        if (scoring && winner.yakuman && ordinary == 0 && special == 0)
            errors["winners.$index.yakumanCount"] = "役满至少选择一个普通或特殊双倍计数"
        if (special != null && special > 0 && rules?.get("doubleYakuman")?.jsonPrimitive?.booleanOrNull != true)
            errors["winners.$index.doubleYakumanCount"] = "此规则未启用特殊双倍役满"
        val han = if (scoring && !winner.yakuman) number("han", winner.han, 130, 1) else if (scoring) 1 else 5
        val fu = if (scoring && !winner.yakuman) number("fu", winner.fu, 140, 20) else 30
        buildJsonObject {
            put("seatNo", winner.seatNo)
            put("han", han ?: 1)
            put("fu", fu ?: 30)
            if (scoring && ordinary != null && ordinary > 0) put("yakumanCount", ordinary)
            if (scoring && special != null && special > 0) put("doubleYakumanCount", special)
            if (draft.kind == "ron" && draft.dealInSeatNo != null) put("dealInSeatNo", draft.dealInSeatNo)
        }
    }
    val tiles = draft.river.trim().split(TILE_SEPARATOR).filter(String::isNotBlank)
    if (draft.kind == "nagashi_mangan" && (!draft.attested || tiles.isEmpty() ||
            tiles.any { !NAGASHI_TILE.matches(it) }))
        errors["river"] = "逐张填写全部幺九弃牌并确认未被鸣走"
    return ValidatedResult(if (errors.isNotEmpty()) null else buildJsonObject {
        put("kind", draft.kind)
        put("winners", JsonArray(parsed))
        if (draft.kind == "ryuukyoku" || draft.kind == "nagashi_mangan")
            put("tenpai", JsonArray(seats.map { JsonPrimitive(it in draft.tenpai) }))
        if (draft.kind == "ron" && draft.declarationDealIn)
            put("riichiDeclarationDealInSeatNo", requireNotNull(draft.dealInSeatNo))
        if (draft.kind == "nagashi_mangan") put("nagashiEligibility", buildJsonArray {
            selected.forEach { winner -> add(buildJsonObject {
                put("seatNo", winner.seatNo)
                put("discards", buildJsonArray { tiles.forEach { tile -> add(buildJsonObject {
                    put("tile", tile); put("called", false)
                }) } })
            }) }
        })
    }, errors)
}
