package com.riichi.mobileengine

import kotlin.math.abs
import kotlin.math.floor

private const val TERMINAL_MAX_STORED_INTEGER = 2_147_483_647

private data class TerminalEntry(val seatNo: Double, val points: Double)
private data class AdjustedTerminalEntry(val seatNo: Int, val rawPoints: Int, val finalPoints: Int)

// JS prints integral Numbers without a decimal suffix in validation messages.
private fun terminalNumberText(value: Double): String =
    if (value == Double.POSITIVE_INFINITY) "Infinity"
    else if (value == Double.NEGATIVE_INFINITY) "-Infinity"
    else if (value.isNaN()) "NaN"
    else if (value == 0.0) "0"
    else if (value % 1.0 == 0.0 && abs(value) < 1.0e21) value.toLong().toString()
    else value.toString()

private fun terminalNumber(value: Any?): Double? = (value as? Number)?.toDouble()

private fun terminalValueText(value: Any?): String = when (value) {
    is Number -> terminalNumberText(value.toDouble())
    is String -> value
    is Boolean -> value.toString()
    null -> "null"
    else -> value.toString()
}

private fun terminalTruth(value: Any?): Boolean = when (value) {
    null -> false
    is Boolean -> value
    is Number -> value.toDouble() != 0.0 && !value.toDouble().isNaN()
    is String -> value.isNotEmpty()
    else -> true
}

private fun terminalOption(options: Any?, key: String): Any? = when (options) {
    is Map<*, *> -> options[key]
    is TerminalSettlementOptions -> when (key) {
        "riichiPool" -> options.riichiPool
        "startingDealerSeatNo" -> options.startingDealerSeatNo
        "requireTargetPoints" -> options.requireTargetPoints
        "completedSouth4" -> options.completedSouth4
        else -> null
    }
    else -> null
}

private fun terminalEntries(list: List<*>, label: String): List<TerminalEntry> = list.mapIndexed { index, item ->
    if (item is SeatBalance) return@mapIndexed TerminalEntry(item.seatNo.toDouble(), item.points.toDouble())
    if (item is TerminalPoint.NumberPoint) return@mapIndexed TerminalEntry(index.toDouble(), item.points.toDouble())
    val number = terminalNumber(item)
    if (number != null) {
        TerminalEntry(index.toDouble(), number)
    } else {
        val map = item as? Map<*, *>
        val seatNo = terminalNumber(map?.get("seatNo"))
        val points = terminalNumber(map?.get("points"))
        if (seatNo == null || points == null) {
            throw EngineException("Invalid finalPoints $label at index $index.")
        }
        TerminalEntry(seatNo, points)
    }
}

private fun terminalJsRound(value: Double): Long = floor(value + 0.5).toLong()

/** Calculates final ranking and integer-tenths scores, retaining the input seat order in perSeat. */
@Throws(EngineException::class)
fun calculateTerminalSettlement(
    finalPoints: TerminalPointsInput,
    rules: Any?,
    options: TerminalSettlementOptions? = null,
): TerminalSettlementOutput = calculateTerminalSettlementInternal(finalPoints, rules, options)

/** Raw JSON input boundary: preserves malformed list entries and inline field types for validation. */
@Throws(EngineException::class)
fun calculateTerminalSettlement(
    finalPoints: Any?,
    rules: Any?,
    options: TerminalSettlementOptions? = null,
): TerminalSettlementOutput = calculateTerminalSettlementInternal(finalPoints, rules, options)

/** Raw options boundary for JSON inputs whose invalid field types must reach TS-style validation. */
@Throws(EngineException::class)
fun calculateTerminalSettlement(
    finalPoints: Any?,
    rules: Any?,
    options: Map<String, Any?>,
): TerminalSettlementOutput = calculateTerminalSettlementInternal(finalPoints, rules, options)

private fun calculateTerminalSettlementInternal(
    finalPoints: Any?,
    rules: Any?,
    options: Any?,
): TerminalSettlementOutput {
    if (finalPoints !is List<*> && finalPoints !is Map<*, *> && finalPoints !is TerminalPointsInput) {
        throw EngineException("Invalid finalPoints input.")
    }
    if (rules !is RulesSnapshot && rules !is Map<*, *> && rules !is List<*>) {
        throw EngineException("Invalid rules input.")
    }
    val rawConfig: Map<String, Any?> = when (rules) {
        is RulesSnapshot -> rules.config
        is List<*> -> emptyMap()
        is Map<*, *> -> {
            val config = rules["config"]
            if (config is List<*>) emptyMap()
            else {
                @Suppress("UNCHECKED_CAST")
                ((config as? Map<*, *>) ?: rules) as Map<String, Any?>
            }
        }
        else -> error("validated above")
    }

    val inline = finalPoints as? Map<*, *>
    val typedInline = finalPoints as? TerminalPointsInput.ObjectInput
    val rawList: List<*> = when (finalPoints) {
        is List<*> -> finalPoints
        is TerminalPointsInput.PointList -> finalPoints.points
        is TerminalPointsInput.SeatList -> finalPoints.seats
        is TerminalPointsInput.MixedList -> finalPoints.entries
        is TerminalPointsInput.ObjectInput -> finalPoints.seats ?: finalPoints.points
            ?: throw EngineException("Invalid finalPoints: expected array of points/seats.")
        else -> (inline!!["seats"] ?: inline["points"]) as? List<*>
            ?: throw EngineException("Invalid finalPoints: expected array of points/seats.")
    }
    val seatEntries = terminalEntries(rawList, if (inline == null && typedInline == null) "entry" else "seat entry")
    if (seatEntries.size != 3 && seatEntries.size != 4) {
        throw EngineException("Invalid seat count in calculateTerminalSettlement: ${seatEntries.size}. Expected 3 or 4.")
    }

    val config = normalizeRulesConfig(rawConfig, seatEntries.size)
    val playerCount = config.playerCount
    val seenSeats = HashSet<Double>(seatEntries.size)
    for (seat in seatEntries) {
        if (!seat.seatNo.isFinite() || seat.seatNo % 1.0 != 0.0 || seat.seatNo < 0.0 || seat.seatNo > Int.MAX_VALUE) {
            throw EngineException("Invalid seatNo: ${terminalNumberText(seat.seatNo)}.")
        }
        if (!seenSeats.add(seat.seatNo)) {
            throw EngineException("Duplicate seatNo: ${terminalNumberText(seat.seatNo)}.")
        }
        if (!seat.points.isFinite() || seat.points % 1.0 != 0.0 || abs(seat.points) > TERMINAL_MAX_STORED_INTEGER || seat.points % 100.0 != 0.0) {
            throw EngineException("Invalid points for seat ${terminalNumberText(seat.seatNo)}: ${terminalNumberText(seat.points)}. Must be a stored integer multiple of 100.")
        }
    }

    val rawPool = terminalOption(options, "riichiPool")
        ?: inline?.get("riichiPool")
        ?: typedInline?.riichiPool
        ?: inline?.get("unclaimedRiichiPoints")
        ?: typedInline?.unclaimedRiichiPoints
        ?: pickNumber(rawConfig, listOf("riichiPool", "unclaimedRiichiPoints"))
        ?: 0
    val unclaimedPool = terminalNumber(rawPool)
    if (unclaimedPool == null || !validStoredInteger(unclaimedPool) || unclaimedPool % 1000.0 != 0.0) {
        throw EngineException("Invalid unclaimedRiichiPoints: ${terminalValueText(rawPool)}. Must be a non-negative multiple of 1000.")
    }
    val unclaimedRiichiPoints = unclaimedPool.toInt()

    val seatOrder = seatEntries.map { it.seatNo }.sorted()
    val rawStartingDealer = terminalOption(options, "startingDealerSeatNo")
        ?: inline?.get("startingDealerSeatNo")
        ?: typedInline?.startingDealerSeatNo
        ?: pickNumber(rawConfig, listOf("startingDealerSeatNo", "initialDealerSeatNo"))
        ?: seatOrder[0]
    val startingDealer = terminalNumber(rawStartingDealer)
    val startingDealerIndex = if (startingDealer == null) -1 else seatOrder.indexOf(startingDealer)
    if (startingDealerIndex == -1) {
        throw EngineException("Invalid startingDealerSeatNo: ${terminalValueText(rawStartingDealer)}.")
    }

    val anyBust = config.bustEndsGame && seatEntries.any { it.points < 0 }
    val maxActualPoints = seatEntries.maxOf { it.points }
    val requireTargetPoints = terminalOption(options, "requireTargetPoints")
        ?: inline?.get("requireTargetPoints")
        ?: typedInline?.requireTargetPoints
        ?: pickBoolean(rawConfig, listOf("requireTargetPoints"))
        ?: false
    val completedSouth4 = terminalOption(options, "completedSouth4")
        ?: inline?.get("completedSouth4")
        ?: typedInline?.completedSouth4
    if (completedSouth4 != null && completedSouth4 !is Boolean) {
        throw EngineException("completedSouth4 must be a boolean.")
    }
    val gameEndReason = if (config.fixedSouth4EndPolicy == "completed_south_4") {
        if (completedSouth4 == true) "final_round_complete" else "not_ended"
    } else if (anyBust) {
        "bust"
    } else if (maxActualPoints >= config.targetPoints) {
        "target_reached"
    } else if (terminalTruth(requireTargetPoints)) {
        "not_ended"
    } else {
        "final_round_complete"
    }

    val totalPoints = seatEntries.fold(unclaimedPool) { sum, seat -> sum + seat.points }
    val expectedTotalPoints = playerCount.toLong() * config.startingPoints
    if (totalPoints != expectedTotalPoints.toDouble()) {
        throw EngineException("Total points conservation violated: sum(points + pool)=${terminalNumberText(totalPoints)}, expected $expectedTotalPoints ($playerCount * ${config.startingPoints}).")
    }
    if (gameEndReason == "not_ended") {
        return TerminalSettlementOutput.NotEnded(
            unclaimedRiichiPoints = unclaimedRiichiPoints,
            perSeat = seatEntries.map { TerminalSeatPoints(it.seatNo.toInt(), it.points.toInt(), it.points.toInt()) },
        )
    }

    // Stable starting-dealer order resolves equal raw scores before pool allocation.
    fun dealerDistance(seatNo: Double): Int =
        (seatOrder.indexOf(seatNo) - startingDealerIndex + playerCount) % playerCount
    val provisionalSorted = seatEntries.sortedWith(
        compareByDescending<TerminalEntry> { it.points }.thenBy { dealerDistance(it.seatNo) },
    )
    val poolRecipientSeatNo = if (config.terminalRiichiPoolPolicy == "first") provisionalSorted[0].seatNo.toInt() else null
    val adjustedEntries = seatEntries.map { seat ->
        val number = seat.seatNo.toInt()
        AdjustedTerminalEntry(
            seatNo = number,
            rawPoints = seat.points.toInt(),
            finalPoints = safePoints(seat.points.toLong() + (if (number == poolRecipientSeatNo) unclaimedRiichiPoints.toLong() else 0L), "finalPoints"),
        )
    }
    val finalSorted = adjustedEntries.sortedWith(
        compareByDescending<AdjustedTerminalEntry> { it.finalPoints }.thenBy { dealerDistance(it.seatNo.toDouble()) },
    )
    val okaTotalTenths = terminalJsRound(config.oka * 10).toInt()
    val umaByRank = MutableList(playerCount) { terminalJsRound(config.uma[it] * 10).toInt() }
    if (config.tiedUmaPolicy == "split") {
        var start = 0
        while (start < playerCount) {
            var end = start + 1
            while (end < playerCount && finalSorted[end].finalPoints == finalSorted[start].finalPoints) end++
            if (end - start > 1) {
                var total = 0L
                for (i in start until end) total += umaByRank[i]
                val share = floor(total.toDouble() / (end - start)).toLong()
                val remainder = total - share * (end - start)
                for (i in start until end) {
                    umaByRank[i] = (share + if (i - start < remainder) 1L else 0L).toInt()
                }
            }
            start = end
        }
    }

    val resultBySeat = HashMap<Int, TerminalSeatResult>(playerCount)
    val standings = ArrayList<TerminalSeatResult>(playerCount)
    var sharedRank = 1
    for (i in finalSorted.indices) {
        val entry = finalSorted[i]
        if (i > 0 && entry.finalPoints != finalSorted[i - 1].finalPoints) sharedRank = i + 1
        val rank = if (config.tiedUmaPolicy == "split") sharedRank else i + 1
        val baseTenths = terminalJsRound((entry.finalPoints.toLong() - config.returnPoints).toDouble() / 100).toInt()
        val umaTenths = umaByRank[i]
        val okaTenths = if (i == 0) okaTotalTenths else 0
        val totalTenths = safePoints(baseTenths.toLong() + umaTenths + okaTenths, "totalTenths")
        val seatResult = TerminalSeatResult(
            seatNo = entry.seatNo,
            rawPoints = entry.rawPoints,
            finalPoints = entry.finalPoints,
            rank = rank,
            baseTenths = baseTenths,
            umaTenths = umaTenths,
            okaTenths = okaTenths,
            penaltyTenths = 0,
            totalTenths = totalTenths,
            competencyPoints = totalTenths / 10.0,
        )
        standings.add(seatResult)
        resultBySeat[entry.seatNo] = seatResult
    }
    val sumTenths = standings.sumOf { it.totalTenths.toLong() }
    if (sumTenths + (if (poolRecipientSeatNo == null) unclaimedRiichiPoints / 100L else 0L) != 0L) {
        throw EngineException("Terminal settlement zero-sum violated: sum(totalTenths)=$sumTenths.")
    }
    val perSeat = adjustedEntries.map { resultBySeat.getValue(it.seatNo) }
    return TerminalSettlementOutput.Ended(
        gameEndReason = gameEndReason,
        unclaimedRiichiPoints = unclaimedRiichiPoints,
        poolRecipientSeatNo = poolRecipientSeatNo,
        perSeat = perSeat,
        standings = standings,
        tenths = perSeat.map { it.totalTenths },
    )
}
