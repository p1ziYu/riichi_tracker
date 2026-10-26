package com.p1ziyu.riichitracker.p1

import java.net.URI
import java.net.URLDecoder
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone

// ---- Spec §1: modes, winds, totals, ranks ---------------------------------

/** Winds in seat order. East is the dealer seat.
 *  Internal keys are the server wind codes (E/S/W/N); render only
 *  via windLabel(). The server rejects Chinese winds (400 unknown_wind). */
fun windsFor(mode: String?): List<String> = when (mode) {
    "3p" -> listOf("E", "S", "W")
    else -> listOf("E", "S", "W", "N")
}

/** Display-only mapping: server wind code -> Chinese wind name. */
fun windLabel(wind: String): String = when (wind) {
    "E" -> "东"
    "S" -> "南"
    "W" -> "西"
    "N" -> "北"
    else -> wind
}

fun modeLabel(mode: String?): String = when (mode) {
    "3p" -> "三麻"
    "4p" -> "四麻"
    else -> "牌桌"
}

/** Total final points (÷100 units): 4p = 1000, 3p = 1050. */
fun totalFor(mode: String?): Int = if (mode == "3p") 1050 else 1000

/** Tie-break: same score ranks by wind order, East first (spec §1). */
fun computeRanks(scores: Map<String, Int>, winds: List<String>): Map<String, Int> {
    val ordered = winds.filter { it in scores }
        .sortedWith(compareByDescending<String> { scores.getValue(it) }.thenBy { winds.indexOf(it) })
    return ordered.mapIndexed { index, wind -> wind to (index + 1) }.toMap()
}

fun rankLabel(rank: Int?): String = if (rank == null) "—" else "第 $rank 名"

// ---- Score input: actual points ÷ 100, range -9999..9999 ------------------

/** Parses one final-score cell. Blank / lone "-" is "not yet entered" (null),
 *  anything else unparseable or out of range is an error (see validate). */
fun parseScoreCell(text: String): Int? {
    val t = text.trim()
    if (t.isEmpty() || t == "-") return null
    return t.toIntOrNull()
}

data class FinalValidation(val sum: Int, val complete: Boolean, val saveable: Boolean,
    val hint: String)

fun validateFinalScores(cells: Map<String, String>, mode: String?): FinalValidation {
    val winds = windsFor(mode)
    val parsed = winds.associateWith { parseScoreCell(cells[it].orEmpty()) }
    val outOfRange = winds.any { wind ->
        val raw = cells[wind].orEmpty().trim()
        raw.isNotEmpty() && raw != "-" && (raw.toIntOrNull() == null || raw.toInt() !in -9999..9999)
    }
    val sum = parsed.values.filterNotNull().sum()
    val total = totalFor(mode)
    val complete = parsed.values.all { it != null }
    return when {
        outOfRange -> FinalValidation(sum, complete, false, "每位得点须在 -9999 至 9999 之间（单位：实际点数 ÷100，支持负数和 0）。")
        !complete -> FinalValidation(sum, false, false, "请填完每座得点，当前合计 $sum / $total。")
        sum != total -> FinalValidation(sum, true, false, "合计不对：当前合计 $sum，${modeLabel(mode)}合计须为 $total，不能保存。")
        else -> FinalValidation(sum, true, true, "合计正确：$sum / $total，可以保存。")
    }
}

/** Scores map ready to POST/PATCH once validation passes. */
fun finalScoresPayload(cells: Map<String, String>, mode: String?): List<FinalScoreDto>? {
    val v = validateFinalScores(cells, mode)
    if (!v.saveable) return null
    return windsFor(mode).map { wind -> FinalScoreDto(wind, parseScoreCell(cells[wind].orEmpty())!!) }
}

// ---- Lobby ordering ---------------------------------------------------------

fun statusLabel(status: String): String = when (status.lowercase(Locale.ROOT)) {
    "waiting" -> "等待人齐"
    "in_progress" -> "进行中"
    "finished" -> "已结束"
    "cancelled" -> "已取消"
    "preparing" -> "等待人齐"
    "active" -> "进行中"
    else -> "进行中"
}

fun isFinishedStatus(status: String): Boolean =
    status.lowercase(Locale.ROOT) in setOf("finished", "completed", "settled")

fun isActiveStatus(status: String): Boolean =
    status.lowercase(Locale.ROOT) in setOf("waiting", "in_progress", "preparing", "active")

/** Lobby: active (waiting + in-progress) pinned on top, then finished, newest first. */
fun sortLobby(matches: List<MatchDetail>): List<MatchDetail> =
    matches.sortedWith(
        compareByDescending<MatchDetail> { isActiveStatus(it.status) }
            .thenByDescending { it.createdAt.orEmpty() })

fun sortHistory(matches: List<MatchDetail>): List<MatchDetail> =
    matches.filter { isFinishedStatus(it.status) }.sortedByDescending { it.createdAt.orEmpty() }

internal fun localMatchTime(value: String?, timeZone: TimeZone = TimeZone.getDefault()): String {
    if (value.isNullOrBlank()) return "时间未提供"
    return runCatching {
        OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            .atZoneSameInstant(timeZone.toZoneId())
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT))
    }.getOrDefault("时间未提供")
}

// ---- Join: room code + links (spec §1: code / QR / link, no check-in page) --

private val joinCodePattern = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$")

fun normalizeJoinCode(input: String): String? =
    input.trim().uppercase(Locale.ROOT).takeIf(joinCodePattern::matches)

/** Share / deep link. The share page embeds the (lifelong) joinCode as the
 *  token query param; POST /api/matches/:id/join accepts code or token, so
 *  the server must accept the joinCode in that position (see report). */
fun shareLink(matchId: String, joinCode: String?): String =
    if (joinCode.isNullOrBlank()) "https://riichi.p1ziyu.com/checkin/$matchId"
    else "https://riichi.p1ziyu.com/checkin/$matchId?token=$joinCode"

data class JoinLink(val matchId: String, val token: String?, val url: String) {
    val hasToken: Boolean get() = !token.isNullOrBlank()
}

fun parseJoinLink(input: String): JoinLink? {
    val url = input.trim()
    val uri = try { URI(url) } catch (_: Exception) { return null }
    if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != "riichi.p1ziyu.com" ||
        uri.port != -1 || uri.userInfo != null || uri.fragment != null) return null
    val matchId = Regex("^/checkin/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")
        .matchEntire(uri.rawPath)?.groupValues?.get(1) ?: return null
    val params = uri.rawQuery?.split('&')?.map { it.split('=', limit = 2) }.orEmpty()
    if (params.any { it.size != 2 || it[0] !in setOf("token", "code") } ||
        params.count { it[0] == "token" } > 1 || params.count { it[0] == "code" } > 1) return null
    val credential = params.singleOrNull()?.get(1)?.let {
        runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull()
    }
    return JoinLink(matchId, credential?.takeIf { it.isNotBlank() }, url)
}

// ---- Error mapping: raw API English never reaches the UI (spec §0) --------

fun apiFailureMessage(error: ApiFailure): String = when (error.code) {
    "match_full" -> "牌桌已满员，无法加入。"
    "match_already_started" -> "牌局已开始，无法加入。"
    "already_member", "already_joined" -> "你已是本桌成员，直接进入牌桌。"
    "invalid_token", "token_consumed_or_expired", "missing_token", "invalid_code" ->
        "加入凭证无效或已过期，请房主重新分享链接，或使用房间码。"
    "missing_credential" -> "加入需要凭证：请用房间码或房主分享的链接加入。"
    "join_code_not_found" -> "房间码不正确，或牌桌已结束。"
    "match_not_found" -> "牌桌不存在或已被删除。"
    "forbidden", "not_host" -> "只有房主可以执行此操作。"
    "not_member" -> "你不是本桌成员。"
    "not_in_progress" -> "牌局不在进行中，无法记终局分。"
    "already_finished" -> "牌局已结束，请用纠正修改终局分。"
    "not_finished" -> "牌局尚未结束，无法纠正终局分。"
    "invalid_final_scores", "score_out_of_range", "total_mismatch", "seats_incomplete" ->
        "终局分无效：请检查每座得点范围与合计（四麻 1000、三麻 1050）。"
    "match_not_deletable" -> "这张牌桌已开始，无法彻底删除。"
    "rate_limited" -> "尝试过于频繁，请稍后再试。"
    else -> when (error.status) {
        401 -> "登录已失效，请重新登录。"
        403 -> "你没有权限执行此操作。"
        404 -> "牌桌不存在或已被删除。"
        409 -> "牌桌状态已变化，请刷新后重试。"
        429 -> "尝试过于频繁，请稍后再试。"
        else -> "操作失败，请稍后重试。"
    }
}

fun Throwable.chineseMessage(): String = when (this) {
    is ApiFailure -> apiFailureMessage(this)
    else -> message?.takeIf { it.isNotBlank() } ?: "网络连接失败，请重试"
}
