package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

fun finalizeBody(dealerSeatNo: Int?): String = buildJsonObject {
    if (dealerSeatNo != null) put("dealerSeatNo", dealerSeatNo)
}.toString()

fun canChangeRiichi(seat: HandSeatDto, allowLowPointRiichi: Boolean): Boolean = when (seat.isRiichi) {
    null -> false
    true -> seat.riichiChangeUsage.cancels < 1
    false -> seat.riichiChangeUsage.declares < 2 &&
        (allowLowPointRiichi || (seat.points ?: 0) >= 1000)
}

fun markBody(hand: CurrentHandDto, seat: HandSeatDto, riichi: Boolean): String = buildJsonObject {
    put("seatNo", seat.seatNo)
    put("riichi", riichi)
    put("expectedMarkRevision", requireNotNull(hand.markRevision))
}.toString()

suspend fun changeMark(
    transport: JoinTransport, matchId: String, hand: CurrentHandDto, current: CurrentHandDto?,
    seat: HandSeatDto, allowLowPointRiichi: Boolean, riichi: Boolean, refresh: () -> Unit,
) {
    val handId = requireNotNull(hand.id)
    if (current?.id != handId || current.markRevision != hand.markRevision || current.status != "open") {
        refresh()
        throw IllegalStateException("牌局标记版本已变化，请刷新牌桌")
    }
    val currentSeat = current.seats.firstOrNull { it.seatNo == seat.seatNo }
    check(currentSeat != null && currentSeat.isRiichi == seat.isRiichi &&
        canChangeRiichi(currentSeat, allowLowPointRiichi) &&
        riichi == (currentSeat.isRiichi == false)) { "此座位当前不能更改立直标记" }
    try {
        transport.post("/api/matches/$matchId/hands/$handId/marks", markBody(hand, seat, riichi))
    } catch (error: ApiFailure) {
        if (error.status == 409) refresh()
        throw error
    }
}

fun BoundPreview.matches(hand: CurrentHandDto, input: JsonObject): Boolean =
    hand.status == "open" && handId == hand.id && revision == hand.markRevision && this.input == input.toString()

fun resultBody(input: JsonObject, revision: Long, eventId: String = UUID.randomUUID().toString()): String =
    buildJsonObject {
        put("resultInput", input)
        put("confirmedMarkRevision", revision)
        put("clientEventId", eventId)
    }.toString()
