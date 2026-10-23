package com.p1ziyu.riichitracker.p1

import com.riichi.mobileengine.ENGINE_VERSION
import com.riichi.mobileengine.HandState
import com.riichi.mobileengine.ResultInput
import com.riichi.mobileengine.RulesSnapshot
import com.riichi.mobileengine.SeatState
import com.riichi.mobileengine.WinnerInput
import com.riichi.mobileengine.calculateSettlement
import com.riichi.mobileengine.calculateTerminalSettlement

/** Golden fixtures unit-1 and unit-150 in packages/mobile-engine/golden/fixtures-unit.jsonl. */
fun engineDiagnostic(): String = try {
    val rules = RulesSnapshot("test-hash", mapOf("templateKey" to "house_4p_v1"))
    val hand = HandState("hand-4p-1", "E", 1, 0, 0, 0,
        (0..3).map { SeatState(it, 25_000, false, null) })
    val handResult = calculateSettlement(rules, hand,
        ResultInput("ron", listOf(WinnerInput(1, 1, 25, dealInSeatNo = 2))), ENGINE_VERSION)
    val handOk = handResult.perSeat.map { it.netPoints } == listOf(0, 800, -800, 0) &&
        handResult.nextHand.roundWind == "E" && handResult.nextHand.roundNumber == 2 &&
        handResult.nextHand.dealerSeatNo == 1 && handResult.nextHand.riichiPool == 0
    val terminal = calculateTerminalSettlement(listOf(40_000, 30_000, 20_000, 10_000), rules)
    val terminalOk = terminal.isGameEnd && terminal.tenths == listOf(500, 100, -200, -400) &&
        terminal.standings.map { it.rank } == listOf(1, 2, 3, 4)
    "ENGINE $ENGINE_VERSION · 局结算 ${if (handOk) "通过" else "失败"} · 终局结算 ${if (terminalOk) "通过" else "失败"}"
} catch (_: Exception) {
    "ENGINE $ENGINE_VERSION · 自检失败"
}
