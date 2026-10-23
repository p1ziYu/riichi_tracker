package com.p1ziyu.riichitracker.p1

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale
import java.util.UUID

@Serializable data class JoinReceipt(val v: Int, val matchId: String, val joinRequestId: String, val name: String) {
    fun encode(): String = Json.encodeToString(this)
}

fun parseJoinReceipt(raw: String, matchId: String? = null): JoinReceipt? = runCatching {
    Json.decodeFromString<JoinReceipt>(raw.trim()).takeIf {
        it.v == 1 && (matchId == null || it.matchId == matchId) &&
            runCatching { UUID.fromString(it.matchId); UUID.fromString(it.joinRequestId) }.isSuccess &&
            it.name.isNotBlank()
    }
}.getOrNull()

fun apiFailureMessage(error: ApiFailure): String = when (error.code) {
    "check_in_not_approved" -> "桌主尚未批准此身份的座位，请出示申请凭证。"
    "no_active_invitation" -> "桌主尚未开放申请，请联系桌主生成邀请。"
    "guest_already_bound" -> "此访客身份已绑定其他牌桌。"
    "seat_taken", "join_request_already_decided" -> "座位或申请状态已变化，请刷新牌桌。"
    "join_code_not_found" -> "房间码无效，请核对后重试。"
    "match_not_found" -> "牌桌不存在或已删除，请核对邀请信息。"
    "match_already_started" -> "牌桌已开局，不能再批准申请。请刷新牌桌。"
    "join_request_not_found" -> "申请凭证未找到，请核对所属牌桌。"
    "invalid_token", "token_consumed_or_expired" -> "签到凭证已失效：房间码可重新换取，链接请桌主重新发送。"
    "rate_limited" -> error.retryAfterSeconds?.let { "查询过于频繁，请${it}秒后重试" } ?: "查询过于频繁，请稍后重试"
    else -> error.message ?: "请求失败（${error.status}）"
}

fun normalizeJoinCode(input: String): String? = input.trim().uppercase(Locale.ROOT)
    .takeIf { Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$").matches(it) }

fun expiredCheckInToken(error: ApiFailure): Boolean =
    error.code == "invalid_token" || error.code == "token_consumed_or_expired"

fun approvedCheckInKey(receipt: JoinReceipt?, link: CheckInLink?, approved: Boolean,
                       busy: Boolean, joinedSeat: Int?): String? =
    if (approved && !busy && joinedSeat == null && receipt != null && link != null &&
        receipt.matchId == link.matchId && link.hasToken)
        "${link.matchId}:${link.token}" else null

/** Only the currently authenticated principal's receipt may be read. */
class JoinReceiptStore(context: Context) {
    private val preferences = context.getSharedPreferences("join-receipts", Context.MODE_PRIVATE)
    fun read(principalId: String): JoinReceipt? = preferences.getString(principalId, null)?.let { raw ->
        runCatching { Json.decodeFromString<JoinReceipt>(raw) }.getOrNull()?.takeIf {
            it.v == 1 && parseJoinReceipt(raw, it.matchId) != null
        }
    }
    fun save(principalId: String, receipt: JoinReceipt) {
        check(preferences.edit().putString(principalId, receipt.encode()).commit()) { "无法保存申请凭证" }
    }
    fun clear(principalId: String) { preferences.edit().remove(principalId).apply() }
}

interface JoinTransport {
    suspend fun get(path: String): String
    suspend fun post(path: String, body: String = "{}"): String
}

/** GET access, not a join-request list, is the authoritative approval signal. */
class JoinActions(private val transport: JoinTransport, private val json: Json = Json { ignoreUnknownKeys = true }) {
    suspend fun request(matchId: String, name: String, existing: JoinReceipt? = null): JoinReceipt {
        existing?.let {
            if (it.matchId == matchId) return it
            error("请先完成或主动放弃当前申请，勿覆盖已保存的凭证")
        }
        val response = json.decodeFromString<JoinRequestDto>(transport.post("/api/matches/$matchId/join-requests"))
        check(response.status == "pending") { "申请状态异常" }
        return JoinReceipt(v = 1, matchId = matchId, joinRequestId = response.joinRequestId, name = name)
    }
    suspend fun approved(matchId: String): Boolean = try {
        transport.get("/api/matches/$matchId")
        true
    } catch (error: ApiFailure) {
        if (error.status == 403) false else throw error
    }
    suspend fun approve(receipt: JoinReceipt, seatNo: Int, matchId: String) {
        require(parseJoinReceipt(receipt.encode(), matchId) != null) { "申请凭证不属于当前牌桌" }
        transport.post("/api/matches/$matchId/join-requests/${receipt.joinRequestId}/approve",
            buildJsonObject { put("seatNo", seatNo) }.toString())
    }
    suspend fun checkIn(link: CheckInLink): CheckInDto {
        val token = requireNotNull(link.token) { "链接缺少签到凭证" }
        return json.decodeFromString(transport.post("/api/matches/${link.matchId}/check-ins",
            buildJsonObject { put("token", token) }.toString()))
    }
    suspend fun resolve(code: String): ByCodeDto {
        val normalized = requireNotNull(normalizeJoinCode(code)) { "请输入六位有效房间码" }
        return json.decodeFromString(transport.get("/api/matches/by-code/$normalized"))
    }
    suspend fun checkInRecovering(link: CheckInLink, sourceCode: String?): CheckInDto = try {
        checkIn(link)
    } catch (error: ApiFailure) {
        val code = sourceCode ?: throw error
        if (!expiredCheckInToken(error)) throw error
        val fresh = resolve(code)
        check(fresh.matchId == link.matchId) { "房间码对应的牌桌已变化" }
        checkIn(CheckInLink(fresh.matchId, fresh.token, link.url))
    }
}

@Serializable data class JoinRequestDto(val joinRequestId: String, val status: String)
