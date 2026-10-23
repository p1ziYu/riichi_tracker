package com.riichi.mobileengine

import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.pow

private val WIND_ORDER = listOf("E", "S", "W")

private fun invalid(message: String): Nothing = throw EngineException(message, EngineErrorCategory.ENGINE_VALIDATION)


private fun roundedHundred(value: Double): Double = ceil(value / 100.0) * 100.0

private fun effectiveFu(fu: Int): Double {
    if (fu < 20) invalid("Invalid fu: $fu. Must be an integer >= 20.")
    return if (fu == 25) 25.0 else ceil(fu / 10.0) * 10.0
}

private fun calculateBasicPoints(
    han: Int,
    fu: Int,
    yakumanCount: Int?,
    doubleYakumanCount: Int?,
    config: EngineRulesConfig,
): Double {
    if (han < 1) invalid("Invalid han: $han. Must be an integer >= 1.")
    // Fu is validated even for yakuman, despite being irrelevant to its amount.
    val resolvedFu = effectiveFu(fu)
    if (yakumanCount != null && yakumanCount < 0) invalid("Invalid yakumanCount: $yakumanCount.")
    if (doubleYakumanCount != null && doubleYakumanCount < 0) invalid("Invalid doubleYakumanCount: $doubleYakumanCount.")
    if ((doubleYakumanCount ?: 0) > 0 && !config.doubleYakuman) {
        invalid("Special double yakuman is disabled by this ruleset.")
    }
    val multiplier = (if (config.compositeYakuman) (yakumanCount ?: 0).toDouble() else min(yakumanCount ?: 0, 1).toDouble()) +
        2.0 * (doubleYakumanCount ?: 0)
    if (multiplier > 0.0) return 8000.0 * (if (config.compositeYakuman) multiplier else min(multiplier, 2.0))
    if (han >= 13) return if (config.kazoeYakuman) 8000.0 else 6000.0
    if (han >= 11) return 6000.0
    if (han >= 8) return 4000.0
    if (han >= 6) return 3000.0
    if (han == 5) return 2000.0
    val rawBasic = resolvedFu * 2.0.pow(han + 2.0)
    if (rawBasic >= 2000.0 || (config.kiriageMangan && rawBasic == 1920.0)) return 2000.0
    return rawBasic
}

/** Decide whether a settled hand ends a ranked-sanma match. */
@Throws(EngineException::class)
fun isAutomaticMatchEnd(
    rawConfig: Map<String, Any?>,
    handState: HandState,
    resultInput: ResultInput,
    nextHand: NextHandState,
    pointsAfter: List<SeatBalance>,
): Boolean {
    val config = normalizeRulesConfig(rawConfig, handState.seats.size)
    if (config.automaticEndPolicy != "ranked_sanma") return false
    if (pointsAfter.size != config.playerCount ||
        pointsAfter.any { balance -> handState.seats.none { it.seatNo == balance.seatNo } }
    ) invalid("Automatic match end requires all settled seat balances.")
    if (config.bustEndsGame && pointsAfter.any { it.points < 0 }) return true
    if (handState.roundWind == "W" && handState.roundNumber == 3) return true
    if (handState.roundWind != "S" || handState.roundNumber != 3) return false

    var leader = pointsAfter[0]
    for (i in 1 until pointsAfter.size) {
        val seat = pointsAfter[i]
        if (seat.points > leader.points || (seat.points == leader.points && seat.seatNo < leader.seatNo)) leader = seat
    }
    val dealerWon = (resultInput.kind == "ron" || resultInput.kind == "tsumo") &&
        resultInput.winners.any { it.seatNo == handState.dealerSeatNo }
    val dealerTenpai = (resultInput.kind == "ryuukyoku" || resultInput.kind == "nagashi_mangan") &&
        resolveTenpaiMap(handState, resultInput, config.playerCount)[handState.dealerSeatNo] == true
    if ((dealerWon || dealerTenpai) && leader.seatNo == handState.dealerSeatNo &&
        leader.points >= config.startingPoints
    ) return true
    return nextHand.roundWind == "W" && nextHand.roundNumber == 1 && leader.points >= config.targetPoints
}

private fun advanceDealerAndRound(
    handState: HandState,
    seatOrder: List<Int>,
    dealerRepeats: Boolean,
    nextHonba: Int,
    nextRiichiPool: Int,
): NextHandState {
    if (dealerRepeats) return NextHandState(
        handState.roundWind, handState.roundNumber, handState.dealerSeatNo, nextHonba, nextRiichiPool,
    )
    val nextDealerSeatNo = seatOrder[(seatOrder.indexOf(handState.dealerSeatNo) + 1) % seatOrder.size]
    var nextRoundNumber = handState.roundNumber + 1
    var nextRoundWind = handState.roundWind
    if (nextRoundNumber > seatOrder.size) {
        nextRoundNumber = 1
        nextRoundWind = WIND_ORDER[(WIND_ORDER.indexOf(handState.roundWind) + 1) % WIND_ORDER.size]
    }
    return NextHandState(nextRoundWind, nextRoundNumber, nextDealerSeatNo, nextHonba, nextRiichiPool)
}

private fun computeTsumoPaymentsForWinner(
    winnerSeatNo: Int,
    basicPoints: Double,
    dealerSeatNo: Int,
    seatOrder: List<Int>,
    config: EngineRulesConfig,
): Map<Int, Double> {
    val payments = linkedMapOf<Int, Double>()
    val isDealerWinner = winnerSeatNo == dealerSeatNo
    val nonWinners = seatOrder.filter { it != winnerSeatNo }
    if (config.playerCount == 4 || config.tsumoLoss) {
        for (payer in nonWinners) {
            payments[payer] = roundedHundred((if (isDealerWinner || payer == dealerSeatNo) 2.0 else 1.0) * basicPoints)
        }
    } else if (isDealerWinner) {
        val total4p = 3.0 * roundedHundred(2.0 * basicPoints)
        val firstShare = roundedHundred(total4p / 2.0)
        payments[nonWinners[0]] = firstShare
        payments[nonWinners[1]] = total4p - firstShare
    } else {
        val total4p = roundedHundred(2.0 * basicPoints) + 2.0 * roundedHundred(basicPoints)
        val nonDealerShare = roundedHundred(total4p / 3.0)
        val dealerShare = total4p - nonDealerShare
        for (payer in nonWinners) payments[payer] = if (payer == dealerSeatNo) dealerShare else nonDealerShare
    }
    return payments
}

/**
 * Dynamic boundary for callers carrying malformed values that a Boolean? cannot represent.
 * Normal callers use the fully typed overload below.
 */
@Throws(EngineException::class)
fun calculateSettlement(
    rulesSnapshot: RulesSnapshot,
    handState: HandState,
    resultInput: Any?,
    engineVersion: String,
): SettlementOutput {
    if (resultInput is ResultInput) return calculateSettlement(rulesSnapshot, handState, resultInput, engineVersion)
    val raw = resultInput as? Map<*, *> ?: invalid("Invalid resultInput.")
    fun integer(value: Any?): Int? {
        val n = value as? Number ?: return null
        val d = n.toDouble()
        return if (d.isFinite() && d % 1.0 == 0.0 && d in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) d.toInt() else null
    }
    fun requiredInteger(value: Any?, field: String): Int =
        integer(value) ?: throw EngineException("Invalid $field.", EngineErrorCategory.HOST_TYPE)
    val rawWinners = raw["winners"] as? List<*> ?: emptyList<Any?>()
    val winners = rawWinners.map { value ->
        val winner = value as? Map<*, *> ?: throw EngineException("Invalid winner.", EngineErrorCategory.HOST_TYPE)
        val flag = winner["isRiichiDeclarationDealIn"]
        if (flag != null && flag !is Boolean) invalid("isRiichiDeclarationDealIn must be a boolean.")
        WinnerInput(
            seatNo = requiredInteger(winner["seatNo"], "winner seatNo"),
            han = requiredInteger(winner["han"], "han"),
            fu = requiredInteger(winner["fu"], "fu"),
            yakumanCount = winner["yakumanCount"]?.let { requiredInteger(it, "yakumanCount") },
            dealInSeatNo = winner["dealInSeatNo"]?.let { requiredInteger(it, "dealInSeatNo") },
            doubleYakumanCount = winner["doubleYakumanCount"]?.let { requiredInteger(it, "doubleYakumanCount") },
            isRiichiDeclarationDealIn = flag as Boolean?,
        )
    }
    val histories = (raw["nagashiEligibility"] as? List<*>)?.map { value ->
        val history = value as? Map<*, *> ?: throw EngineException("Invalid nagashi mangan winner discard history.", EngineErrorCategory.HOST_TYPE)
        NagashiEligibilityInput(
            requiredInteger(history["seatNo"], "nagashi seatNo"),
            (history["discards"] as? List<*>)?.map { tileValue ->
                val discard = tileValue as? Map<*, *> ?: throw EngineException("Invalid discard.", EngineErrorCategory.HOST_TYPE)
                DiscardInput(
                    discard["tile"] as? String ?: throw EngineException("Invalid tile.", EngineErrorCategory.HOST_TYPE),
                    discard["called"] as? Boolean ?: throw EngineException("Invalid called.", EngineErrorCategory.HOST_TYPE),
                )
            } ?: emptyList(),
        )
    }
    val tenpai = (raw["tenpai"] as? List<*>)?.mapIndexed { index, value ->
        value as? Boolean ?: invalid("Invalid tenpai value at index $index: expected boolean.")
    }
    val payments = (raw["manualPayments"] as? Map<*, *>)?.entries?.associate { (key, value) ->
        requiredInteger(key.toString().toIntOrNull(), "manual payment seat") to requiredInteger(value, "manual payment")
    }
    return calculateSettlement(
        rulesSnapshot, handState,
        ResultInput(
            kind = raw["kind"] as? String ?: invalid("Unsupported hand kind: ${raw["kind"]}"),
            winners = winners,
            nagashiEligibility = histories,
            tenpai = tenpai,
            riichiDeclarationDealInSeatNo = raw["riichiDeclarationDealInSeatNo"]?.let {
                requiredInteger(it, "riichiDeclarationDealInSeatNo")
            },
            manualPayments = payments,
        ),
        engineVersion,
    )
}

/** Pure settlement: payment entries are recorded in the same order as the source engine. */
@Throws(EngineException::class)
fun calculateSettlement(
    rulesSnapshot: RulesSnapshot,
    handState: HandState,
    resultInput: ResultInput,
    engineVersion: String,
): SettlementOutput {
    if (engineVersion.isEmpty()) invalid("Invalid engineVersion: must be a non-empty string.")
    val seatCount = handState.seats.size
    if (seatCount != 3 && seatCount != 4) invalid("Invalid seat count: $seatCount. Expected 3 or 4 seats.")
    val config = normalizeRulesConfig(rulesSnapshot.config, seatCount)
    val playerCount = config.playerCount

    val seatMap = mutableMapOf<Int, SeatState>()
    for (s in handState.seats) {
        if (s.seatNo < 0) invalid("Invalid seatNo: ${s.seatNo}.")
        if (s.seatNo in seatMap) invalid("Duplicate seatNo: ${s.seatNo}.")
        if (s.points == Int.MIN_VALUE) invalid("Invalid points for seat ${s.seatNo}: ${s.points}.")
        seatMap[s.seatNo] = s
    }
    val seatOrder = handState.seats.map { it.seatNo }.sorted()
    if (handState.dealerSeatNo !in seatMap) invalid("dealerSeatNo ${handState.dealerSeatNo} is not in handState.seats.")
    if (handState.honba < 0 || handState.honba == MAX_STORED_INTEGER) invalid("Invalid honba: ${handState.honba}.")
    if (handState.riichiPool < 0 || handState.riichiPool % 1000 != 0) {
        invalid("Invalid riichiPool: ${handState.riichiPool}. Must be a non-negative multiple of 1000.")
    }
    if (handState.roundWind !in WIND_ORDER) invalid("Invalid roundWind: ${handState.roundWind}.")
    if (handState.roundNumber !in 1..playerCount) {
        invalid("Invalid roundNumber: ${handState.roundNumber} for $playerCount players.")
    }

    val breakdowns = mutableMapOf<Int, MutableList<BreakdownEntry>>()
    val netMap = mutableMapOf<Int, Int>()
    for (s in handState.seats) {
        breakdowns[s.seatNo] = mutableListOf()
        netMap[s.seatNo] = 0
    }
    fun addEntry(seatNo: Int, reason: String, amount: Double) {
        val checkedAmount = safePoints(amount, reason)
        val net = safePoints(netMap.getValue(seatNo).toDouble() + checkedAmount, "seat $seatNo netPoints")
        breakdowns.getValue(seatNo).add(BreakdownEntry(reason, checkedAmount))
        netMap[seatNo] = net
    }
    fun output(nextHand: NextHandState, verifyZeroSum: Boolean = true): SettlementOutput {
        val perSeat = handState.seats.map { s -> SeatPayment(s.seatNo, netMap.getValue(s.seatNo), breakdowns.getValue(s.seatNo)) }
        if (verifyZeroSum) assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool)
        return SettlementOutput(perSeat, nextHand)
    }

    val kind = resultInput.kind
    val declarationSeatNo = resultInput.riichiDeclarationDealInSeatNo
    val winnerDeclaresDealIn = resultInput.winners.any { it.isRiichiDeclarationDealIn == true }
    val winnerDeniesDealIn = resultInput.winners.any { it.isRiichiDeclarationDealIn == false }
    if (winnerDeniesDealIn && (declarationSeatNo != null || winnerDeclaresDealIn)) {
        invalid("Conflicting riichi declaration deal-in flags for the same ron discard.")
    }
    if (declarationSeatNo != null && (kind != "ron" || seatMap[declarationSeatNo]?.isRiichi != true ||
            resultInput.winners.none { it.dealInSeatNo == declarationSeatNo && it.seatNo != declarationSeatNo })
    ) invalid("riichiDeclarationDealInSeatNo must be a marked seat that dealt in on a ron.")
    if (winnerDeclaresDealIn && (kind != "ron" ||
            resultInput.winners.any { w -> w.dealInSeatNo == null || seatMap[w.dealInSeatNo]?.isRiichi != true })
    ) invalid("isRiichiDeclarationDealIn requires a marked ron deal-in seat.")

    if (kind == "chombo") {
        val manualPayments = resultInput.manualPayments
        if (!manualPayments.isNullOrEmpty()) {
            var manualSum = 0L
            // JS Object.entries enumerates integer property names in numerical order.
            for (seatNo in manualPayments.keys.sorted()) {
                val delta = manualPayments.getValue(seatNo)
                if (seatNo !in seatMap) invalid("Invalid manual payment seat: $seatNo.")
                if (delta.toLong() % 100L != 0L) invalid("Invalid manual payment for seat $seatNo: $delta. Must be a multiple of 100.")
                manualSum += delta
                addEntry(seatNo, "manual_adjudication", delta.toDouble())
            }
            if (manualSum != 0L) invalid("Invalid chombo manualPayments: sum must be 0, got $manualSum.")
        } else {
            for (s in handState.seats) addEntry(s.seatNo, "chombo_replay", 0.0)
        }
        return output(NextHandState(handState.roundWind, handState.roundNumber, handState.dealerSeatNo,
            handState.honba, handState.riichiPool), verifyZeroSum = false)
    }

    val voidedRiichiSeats = mutableSetOf<Int>()
    if (declarationSeatNo != null) voidedRiichiSeats.add(declarationSeatNo)
    if (kind == "ron") {
        for (w in resultInput.winners) {
            if (w.isRiichiDeclarationDealIn == true && w.dealInSeatNo != null) voidedRiichiSeats.add(w.dealInSeatNo)
        }
    }
    var newRiichiSticksPoints = 0L
    for (s in handState.seats) {
        if (s.isRiichi && s.seatNo !in voidedRiichiSeats) {
            if (!config.allowLowPointRiichi && s.points < 1000) {
                invalid("Seat ${s.seatNo} has ${s.points} points (< 1000) and cannot confirm riichi.")
            }
            addEntry(s.seatNo, "riichi", -1000.0)
            newRiichiSticksPoints += 1000L
        }
    }
    val totalPoolAvailable = safePoints(handState.riichiPool.toLong() + newRiichiSticksPoints, "riichiPool")

    if (kind == "ron") {
        if (resultInput.winners.isEmpty()) invalid("Ron requires at least one winner.")
        if (resultInput.winners.size >= playerCount) {
            invalid("Invalid number of ron winners (${resultInput.winners.size}) for $playerCount players.")
        }
        val seenWinners = mutableSetOf<Int>()
        var dealInSeatNo: Int? = null
        for (w in resultInput.winners) {
            if (w.seatNo !in seatMap) invalid("Invalid winner seatNo: ${w.seatNo}.")
            if (!seenWinners.add(w.seatNo)) invalid("Duplicate winner seatNo: ${w.seatNo}.")
            val discarder = w.dealInSeatNo
            if (discarder == null || discarder !in seatMap) {
                invalid("Ron winner ${w.seatNo} must specify a valid dealInSeatNo.")
            }
            if (discarder == w.seatNo) invalid("Winner ${w.seatNo} cannot deal in to themselves.")
            if (dealInSeatNo == null) dealInSeatNo = discarder
            else if (dealInSeatNo != discarder) invalid("All winners in a multi-ron must share the same dealInSeatNo.")
            calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config)
        }
        if (playerCount == 4 && resultInput.winners.size == 3 && config.multiRon == "double_ron") {
            return output(advanceDealerAndRound(handState, seatOrder, true, handState.honba + 1, totalPoolAvailable))
        }
        val discarderSeatNo = dealInSeatNo ?: invalid("Ron requires at least one winner.")
        val dealInIdx = seatOrder.indexOf(discarderSeatNo)
        val sortedWinners = resultInput.winners.sortedBy { w ->
            (seatOrder.indexOf(w.seatNo) - dealInIdx + playerCount) % playerCount
        }
        val activeWinners = if (config.multiRon == "head_bump") listOf(sortedWinners[0]) else sortedWinners
        val nearestWinnerSeatNo = activeWinners[0].seatNo
        for (w in activeWinners) {
            val basicPoints = calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config)
            val handPoints = roundedHundred((if (w.seatNo == handState.dealerSeatNo) 6.0 else 4.0) * basicPoints)
            addEntry(discarderSeatNo, "ron_payment", -handPoints)
            addEntry(w.seatNo, "ron_win", handPoints)
            val getsHonba = handState.honba > 0 &&
                (config.doubleRonHonbaPolicy == "each_winner" || w.seatNo == nearestWinnerSeatNo)
            if (getsHonba) {
                val honbaBonus = safePoints(handState.honba.toLong() * config.honbaRon, "honba bonus")
                addEntry(discarderSeatNo, "honba_payment", -honbaBonus.toDouble())
                addEntry(w.seatNo, "honba_win", honbaBonus.toDouble())
            }
            if (w.seatNo == nearestWinnerSeatNo && totalPoolAvailable > 0) {
                addEntry(w.seatNo, "riichi_pool", totalPoolAvailable.toDouble())
            }
        }
        val dealerWon = activeWinners.any { it.seatNo == handState.dealerSeatNo }
        return output(advanceDealerAndRound(handState, seatOrder, dealerWon,
            if (dealerWon) handState.honba + 1 else 0, 0))
    }

    if (kind == "tsumo") {
        if (resultInput.winners.size != 1) invalid("Tsumo requires exactly one winner.")
        val w = resultInput.winners[0]
        if (w.seatNo !in seatMap) invalid("Invalid tsumo winner seatNo: ${w.seatNo}.")
        if (w.dealInSeatNo != null) invalid("Tsumo winner must not have a dealInSeatNo.")
        val basicPoints = calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config)
        val basePayments = computeTsumoPaymentsForWinner(w.seatNo, basicPoints,
            handState.dealerSeatNo, seatOrder, config)
        var totalWinPoints = 0.0
        var totalHonbaPoints = 0L
        val perPayerHonba = safePoints(handState.honba.toLong() * config.honbaPerPayer, "honba payment")
        for ((payerSeatNo, baseAmount) in basePayments) {
            addEntry(payerSeatNo, "tsumo_payment", -baseAmount)
            totalWinPoints += baseAmount
            if (perPayerHonba > 0) {
                addEntry(payerSeatNo, "honba_payment", -perPayerHonba.toDouble())
                totalHonbaPoints = safePoints(totalHonbaPoints + perPayerHonba, "honba total").toLong()
            }
        }
        addEntry(w.seatNo, "tsumo_win", totalWinPoints)
        if (totalHonbaPoints > 0) addEntry(w.seatNo, "honba_win", totalHonbaPoints.toDouble())
        if (totalPoolAvailable > 0) addEntry(w.seatNo, "riichi_pool", totalPoolAvailable.toDouble())
        val dealerWon = w.seatNo == handState.dealerSeatNo
        return output(advanceDealerAndRound(handState, seatOrder, dealerWon,
            if (dealerWon) handState.honba + 1 else 0, 0))
    }

    if (kind == "ryuukyoku") {
        if (resultInput.winners.isNotEmpty()) invalid("Ryuukyoku must not have winners.")
        val tenpaiMap = resolveTenpaiMap(handState, resultInput, playerCount)
        for (s in handState.seats) {
            if (s.isRiichi && tenpaiMap[s.seatNo] != true) {
                invalid("Riichi seat ${s.seatNo} is noten: manual adjudication required.")
            }
        }
        val tenpaiSeats = seatOrder.filter { tenpaiMap[it] == true }
        val notenSeats = seatOrder.filter { tenpaiMap[it] != true }
        if (tenpaiSeats.isNotEmpty() && tenpaiSeats.size < playerCount && config.notenPenaltyTotal > 0) {
            val receivePerTenpai = config.notenPenaltyTotal.toDouble() / tenpaiSeats.size
            val payPerNoten = config.notenPenaltyTotal.toDouble() / notenSeats.size
            for (seat in tenpaiSeats) addEntry(seat, "tenpai_receipt", receivePerTenpai)
            for (seat in notenSeats) addEntry(seat, "noten_penalty", -payPerNoten)
        }
        val dealerTenpai = tenpaiMap[handState.dealerSeatNo] == true
        return output(advanceDealerAndRound(handState, seatOrder, dealerTenpai,
            handState.honba + 1, totalPoolAvailable))
    }

    if (kind == "nagashi_mangan") {
        if (!config.nagashiManganEnabled) invalid("Automatic nagashi mangan is disabled: manual adjudication required.")
        if (resultInput.winners.isEmpty()) invalid("Nagashi mangan requires at least one winner.")
        val seenWinners = mutableSetOf<Int>()
        for (w in resultInput.winners) {
            if (w.seatNo !in seatMap) invalid("Invalid nagashi_mangan winner seatNo: ${w.seatNo}.")
            if (!seenWinners.add(w.seatNo)) invalid("Duplicate nagashi_mangan winner seatNo: ${w.seatNo}.")
        }
        val histories = resultInput.nagashiEligibility
        if (histories == null || histories.size != seenWinners.size) {
            invalid("Nagashi mangan requires a complete discard history for every claimed winner.")
        }
        val seenHistories = mutableSetOf<Int>()
        for (history in histories) {
            if (history.seatNo !in seenWinners || !seenHistories.add(history.seatNo) || history.discards.isEmpty()) {
                invalid("Invalid nagashi mangan winner discard history.")
            }
            for (discard in history.discards) {
                val tile = discard.tile
                val legalTile = tile.length == 2 &&
                    ((tile[0] in '1'..'9' && tile[1] in "mps") || (tile[0] in '1'..'7' && tile[1] == 'z'))
                val terminalHonor = tile.length == 2 &&
                    ((tile[0] in "19" && tile[1] in "mps") || (tile[0] in '1'..'7' && tile[1] == 'z'))
                if (!legalTile || discard.called || !terminalHonor) {
                    invalid("Nagashi mangan seat ${history.seatNo} has a called or non-terminal/honor discard.")
                }
            }
        }
        val tenpaiMap = resolveTenpaiMap(handState, resultInput, playerCount)
        for (s in handState.seats) {
            if (s.isRiichi && tenpaiMap[s.seatNo] != true) {
                invalid("Riichi seat ${s.seatNo} is noten: manual adjudication required.")
            }
        }
        for (w in resultInput.winners) {
            val payments = computeTsumoPaymentsForWinner(w.seatNo, 2000.0,
                handState.dealerSeatNo, seatOrder, config)
            var totalNagashiWin = 0.0
            for ((payerSeatNo, amount) in payments) {
                addEntry(payerSeatNo, "nagashi_mangan_payment", -amount)
                totalNagashiWin += amount
            }
            addEntry(w.seatNo, "nagashi_mangan_win", totalNagashiWin)
        }
        var nextRiichiPool = totalPoolAvailable
        if (config.nagashiCollectsRiichiPool && totalPoolAvailable > 0) {
            // Deliberately use the first submitted winner, not turn order.
            addEntry(resultInput.winners[0].seatNo, "riichi_pool", totalPoolAvailable.toDouble())
            nextRiichiPool = 0
        }
        val dealerTenpai = tenpaiMap[handState.dealerSeatNo] == true
        val dealerRepeats = if (config.nagashiDealerRepeatRequiresTenpai) dealerTenpai
            else handState.dealerSeatNo in seenWinners || dealerTenpai
        return output(advanceDealerAndRound(handState, seatOrder, dealerRepeats,
            handState.honba + 1, nextRiichiPool))
    }

    invalid("Unsupported hand kind: $kind")
}

private fun resolveTenpaiMap(handState: HandState, resultInput: ResultInput, playerCount: Int): Map<Int, Boolean> {
    val values = resultInput.tenpai
    if (values != null) {
        if (values.size != playerCount) invalid("Invalid resultInput.tenpai: expected array of length $playerCount.")
        return handState.seats.mapIndexed { index, seat -> seat.seatNo to values[index] }.toMap()
    }
    return handState.seats.associate { it.seatNo to (it.isTenpai == true) }
}

private fun assertZeroSum(perSeat: List<SeatPayment>, riichiPoolBefore: Int, riichiPoolAfter: Int) {
    val seatSum = perSeat.sumOf { it.netPoints.toLong() }
    val poolDelta = riichiPoolAfter.toLong() - riichiPoolBefore
    if (seatSum + poolDelta != 0L) {
        invalid("Zero-sum invariant violated: sum(perSeat.netPoints)=$seatSum, poolDelta=$poolDelta.")
    }
}
