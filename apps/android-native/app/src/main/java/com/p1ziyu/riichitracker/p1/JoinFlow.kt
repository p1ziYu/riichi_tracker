package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.Locale

fun apiFailureMessage(error: ApiFailure): String = when (error.code) {
    "match_full" -> "牌桌已满员，无法加入。"
    "match_already_started" -> "牌局已开始，无法加入。"
    "invalid_token", "token_consumed_or_expired", "missing_token" -> "签到链接无效或已过期，请房主重新分享链接，或使用房间码。"
    "seat_claim_retired" -> "入座方式已更新，请重新加入牌桌。"
    "owner_auto_check_in" -> "你是房主，已为你打开牌桌。"
    "guest_already_bound" -> "当前访客身份已绑定其他牌桌。"
    "room_not_full" -> "人数尚未到齐，无法抽风定座。"
    "seating_already_drawn" -> "已完成抽风定座。"
    "seating_already_complete" -> "座位已确定，可直接开局。"
    "forbidden" -> "只有房主可以执行此操作。"
    "member_not_found" -> "成员已不在牌桌中。"
    "seat_empty" -> "该座位暂无成员。"
    "invalid_seat" -> "座位选择无效。"
    "rate_limited" -> "尝试过于频繁，请稍后再试。"
    "join_code_not_found" -> "房间码不正确，或牌桌已结束。"
    "incomplete_check_ins" -> "成员尚未全部就座，无法开局。"
    "match_not_found" -> "牌桌不存在或已被删除。"
    else -> "操作失败，请稍后重试。"
}

private val joinCodePattern = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$")

fun normalizeJoinCode(input: String): String? = input.trim().uppercase(Locale.ROOT)
    .takeIf(joinCodePattern::matches)


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

    suspend fun checkIn(link: CheckInLink, alias: String?): CheckInDto {
        val token = link.token?.takeIf(String::isNotBlank) ?: throw IllegalArgumentException("链接缺少签到凭证")
        return json.decodeFromString(transport.post("/api/matches/${link.matchId}/check-ins",
            json.encodeToString(CheckInRequestDto(token, alias?.trim()?.takeIf(String::isNotEmpty)))))
    }

    suspend fun draw(matchId: String): DrawSeatsDto =
        json.decodeFromString(transport.post("/api/matches/$matchId/seats/draw"))

    suspend fun reassign(matchId: String, fromSeatNo: Int, toSeatNo: Int): ReassignDto =
        json.decodeFromString(transport.post("/api/matches/$matchId/seats/reassign",
            buildJsonObject { put("fromSeatNo", fromSeatNo); put("toSeatNo", toSeatNo) }.toString()))

    suspend fun remove(matchId: String, principalId: String): RemoveMemberDto =
        json.decodeFromString(transport.post("/api/matches/$matchId/members/$principalId/remove"))
}
