package com.p1ziyu.riichitracker.p1

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.Locale

fun apiFailureMessage(error: ApiFailure): String = when (error.code) {
    "missing_token", "invalid_token", "token_consumed_or_expired" -> "签到链接无效或已过期：房间码可重新换取，链接请桌主重新发送。"
    "guest_already_bound" -> "此访客身份已绑定其他牌桌。"
    "seat_taken" -> "所选座位已被占用，请刷新座位并重新选座。"
    "match_full" -> "牌桌座位已满，请联系桌主。"
    "match_already_started" -> "牌桌已开局，不能再加入。"
    "member_already_seated" -> "你已在本桌入座，请刷新座位查看。"
    "join_code_not_found" -> "房间码无效，请核对后重试。"
    "match_not_found" -> "牌桌不存在或已删除，请核对邀请信息。"
    "rate_limited" -> error.retryAfterSeconds?.let { "查询过于频繁，请${it}秒后重试" } ?: "查询过于频繁，请稍后重试"
    else -> error.message ?: "请求失败（${error.status}）"
}

private val joinCodePattern = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$")

fun normalizeJoinCode(input: String): String? = input.trim().uppercase(Locale.ROOT)
    .takeIf(joinCodePattern::matches)

/** API seats are zero-based. Occupancy is determined by principalId, never by displayName. */
fun freeJoinSeats(preview: CheckInSeatsDto): List<SeatDto> =
    preview.seats.filter { it.principalId == null }.sortedBy { it.seatNo }

/** A returning member keeps their existing seat, even when the table has other empty seats. */
fun selectableJoinSeats(preview: CheckInSeatsDto, principalId: String?): List<SeatDto> =
    preview.seats.firstOrNull { principalId != null && it.principalId == principalId }
        ?.let(::listOf) ?: freeJoinSeats(preview)

interface JoinTransport {
    suspend fun get(path: String): String
    suspend fun post(path: String, body: String = "{}"): String
}

class JoinActions(private val transport: JoinTransport, private val json: Json = Json { ignoreUnknownKeys = true }) {
    suspend fun resolve(code: String): ByCodeDto {
        val normalized = requireNotNull(normalizeJoinCode(code)) { "请输入六位有效房间码" }
        return json.decodeFromString(transport.get("/api/matches/by-code/$normalized"))
    }

    suspend fun seats(link: CheckInLink): CheckInSeatsDto {
        val token = link.token?.takeIf(String::isNotBlank) ?: throw IllegalArgumentException("链接缺少签到凭证")
        val response = json.decodeFromString<CheckInSeatsDto>(transport.get(
            "/api/matches/${link.matchId}/check-in-seats?token=${URLEncoder.encode(token, "UTF-8")}"))
        check(response.match.id == link.matchId) { "座位预览与签到牌桌不一致" }
        return response
    }

    suspend fun checkIn(link: CheckInLink, seatNo: Int?, alias: String?): CheckInDto {
        val token = link.token?.takeIf(String::isNotBlank) ?: throw IllegalArgumentException("链接缺少签到凭证")
        return json.decodeFromString(transport.post("/api/matches/${link.matchId}/check-ins",
            buildJsonObject {
                put("token", token)
                seatNo?.let { put("seatNo", it) }
                alias?.trim()?.takeIf(String::isNotEmpty)?.let { put("alias", it) }
            }.toString()))
    }

    /** Refresh availability after a competing check-in, without retrying the original write. */
    suspend fun checkInWithSeatRefresh(link: CheckInLink, seatNo: Int?, alias: String?,
                                       onSeats: (CheckInSeatsDto?) -> Unit): CheckInDto = try {
        checkIn(link, seatNo, alias)
    } catch (error: ApiFailure) {
        if (error.code == "seat_taken") {
            onSeats(null)
            try { onSeats(seats(link)) }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { /* Keep the original conflict; the guest can refresh again. */ }
        }
        throw error
    }

    suspend fun reassign(matchId: String, fromSeatNo: Int, toSeatNo: Int): ReassignDto =
        json.decodeFromString(transport.post("/api/matches/$matchId/seats/reassign",
            buildJsonObject { put("fromSeatNo", fromSeatNo); put("toSeatNo", toSeatNo) }.toString()))

    suspend fun remove(matchId: String, principalId: String): RemoveMemberDto =
        json.decodeFromString(transport.post("/api/matches/$matchId/members/$principalId/remove"))
}
