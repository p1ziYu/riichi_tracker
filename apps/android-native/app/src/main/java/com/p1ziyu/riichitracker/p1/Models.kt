package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable data class MatchSummary(
    val id: String, val status: String, val playerCount: Int, val createdAt: String,
    val updatedAt: String? = null, val rulesSnapshot: JsonObject? = null,
    val rulesetVersionId: String? = null,
)
@Serializable data class TemplateDto(
    val versionId: String, val name: String, val scope: String,
    val reviewStatus: String, val config: JsonObject? = null,
)
@Serializable data class MatchDto(
    val id: String, val status: String, val playerCount: Int,
    val rulesSnapshot: JsonObject? = null, val rulesetVersionId: String? = null,
    val createdAt: String? = null,
)
@Serializable data class SeatDto(
    val seatNo: Int, val displayName: String? = null, val points: Int? = null,
    val status: String? = null,
)
@Serializable data class HandSeatDto(val seatNo: Int, val isRiichi: Boolean? = null)
@Serializable data class CurrentHandDto(
    val roundWind: String? = null, val roundNumber: Int? = null,
    val dealerSeatNo: Int? = null, val honba: Int? = null, val riichiPool: Int? = null,
    val seats: List<HandSeatDto> = emptyList(),
)
@Serializable data class TableSnapshot(
    val match: MatchDto, val seats: List<SeatDto>, val currentHand: CurrentHandDto? = null,
)
@Serializable data class HandDeltaDto(val seatNo: Int, val netPoints: Int)
@Serializable data class HandDto(
    val handNo: Int, val roundWind: String, val roundNumber: Int,
    val dealerSeatNo: Int, val honba: Int, val kind: String,
    val perSeat: List<HandDeltaDto>,
)
@Serializable data class StandingDto(
    val seatNo: Int, val rank: Int, val finalPoints: Int, val totalTenths: Int,
)
@Serializable data class SettlementPreview(
    val terminalTenths: List<Int>, val standings: List<StandingDto> = emptyList(),
)
@Serializable data class PrincipalDto(
    val displayName: String, val type: String, val createdAt: String? = null,
)
@Serializable data class MeResponse(val principal: PrincipalDto)
@Serializable data class TicketDto(val ticket: String)
@Serializable data class ApiErrorDto(val message: String? = null, val error: String? = null)

data class RuleDetails(val title: String, val source: String, val reviewStatus: String, val customizedKeys: List<String>)

fun poolSticks(points: Int): Int = points / 1000

fun ruleDetails(snapshot: JsonObject?, template: TemplateDto?): RuleDetails {
    val metadata = snapshot?.get("metadata") as? JsonObject
    val name = metadata?.get("baseTemplateName")?.jsonPrimitive?.content ?: template?.name ?: "规则模板未提供"
    val source = template?.scope ?: metadata?.get("baseTemplateScope")?.jsonPrimitive?.content ?: "来源未提供"
    val review = template?.reviewStatus ?: metadata?.get("reviewStatus")?.jsonPrimitive?.content ?: "审核状态未提供"
    val base = (metadata?.get("baseConfig") as? JsonObject) ?: template?.config
    val excluded = setOf("metadata", "oka", "okaTenths", "umaTenths", "startPoints", "endTarget", "ryuukyokuPenaltyTotal", "ryuukyokuPoolTotal", "bustEndsMatch")
    val changes = if (snapshot != null && base != null) snapshot.keys.filter {
        it !in excluded && it in base && snapshot[it] != base[it]
    }.sorted() else emptyList()
    return RuleDetails(name, source, review, changes)
}
