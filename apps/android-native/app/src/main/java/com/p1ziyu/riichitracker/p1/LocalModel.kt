package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID
import kotlin.random.Random

/**
 * Local offline mode (spec §3): create on-device with 3/4 names + mode,
 * seats are drawn at random immediately, host enters final scores on-device,
 * same total validation, local history + correction. No join/share/admin.
 */
@Serializable data class LocalSeat(val wind: String, val name: String)
@Serializable data class LocalFinal(val wind: String, val score: Int, val rank: Int)
@Serializable data class LocalFinalMatch(
    val id: String, val mode: String, val status: String, // in_progress | finished | cancelled
    val seats: List<LocalSeat>, val finalScores: List<LocalFinal>? = null,
    val createdAt: String, val correctedAt: String? = null,
) {
    val total: Int get() = totalFor(mode)
    fun seatRows(): List<LocalSeat> = seats
    fun finalByWind(): Map<String, Int> = finalScores?.associate { it.wind to it.score }.orEmpty()
}

fun createLocalFinalMatch(mode: String, names: List<String>,
    now: String = Instant.now().toString(),
    id: String = "local-${UUID.randomUUID()}",
    random: Random = Random.Default): LocalFinalMatch {
    require(mode in setOf("3p", "4p")) { "模式须为三麻或四麻" }
    val count = if (mode == "3p") 3 else 4
    require(names.size == count) { "须输入 $count 个名字" }
    val clean = names.mapIndexed { i, n -> n.trim().ifEmpty { "玩家 ${i + 1}" } }
    require(clean.all { it.length <= 40 }) { "玩家姓名最多 40 字" }
    require(clean.distinct().size == clean.size) { "玩家姓名不能重复" }
    // Random seat draw at creation: shuffled names take winds in order; east = dealer.
    val winds = windsFor(mode)
    val seats = clean.shuffled(random).mapIndexed { i, name -> LocalSeat(winds[i], name) }
    return LocalFinalMatch(id, mode, "in_progress", seats, null, now, null)
}

fun LocalFinalMatch.withFinalScores(cells: Map<String, String>,
    now: String = Instant.now().toString()): LocalFinalMatch {
    check(status == "in_progress" || status == "finished") { "本桌已取消，不能记分" }
    val payload = finalScoresPayload(cells, mode) ?: error(validateFinalScores(cells, mode).hint)
    val ranks = computeRanks(payload.associate { it.wind to it.score }, windsFor(mode))
    return copy(status = "finished",
        finalScores = payload.map { LocalFinal(it.wind, it.score, ranks.getValue(it.wind)) },
        correctedAt = if (status == "finished") now else correctedAt)
}

fun LocalFinalMatch.cancel(): LocalFinalMatch {
    check(status == "in_progress") { "只有进行中的本地桌可以取消" }
    return copy(status = "cancelled")
}

fun localFinalCells(match: LocalFinalMatch): Map<String, String> =
    match.finalByWind().mapValues { it.value.toString() }
