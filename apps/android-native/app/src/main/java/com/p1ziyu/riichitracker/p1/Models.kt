package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable data class MatchSummary(
    val id: String, val status: String, val playerCount: Int, val createdAt: String,
    val updatedAt: String? = null, val rulesSnapshot: JsonObject? = null,
    val rulesetVersionId: String? = null, val isOwner: Boolean = false,
)
@Serializable data class TemplateDto(
    val versionId: String, val name: String, val scope: String,
    val reviewStatus: String, val config: JsonObject? = null,
    val templateKey: String? = null, val kind: String? = null,
)
@Serializable data class MatchDto(
    val id: String, val status: String, val playerCount: Int,
    val rulesSnapshot: JsonObject? = null, val rulesetVersionId: String? = null,
    val createdAt: String? = null, val ownerPrincipalId: String? = null,
    val joinCode: String? = null, val version: Long? = null,
    val settlementConfirmed: Boolean = false,
)
@Serializable data class SeatDto(
    val seatNo: Int, val displayName: String? = null, val points: Int? = null,
    val status: String? = null, val principalId: String? = null,
)
@Serializable data class RiichiUsage(val declares: Int = 0, val cancels: Int = 0)
@Serializable data class HandSeatDto(
    val seatNo: Int, val isRiichi: Boolean? = null, val points: Int? = null,
    val riichiChangeUsage: RiichiUsage = RiichiUsage(),
)
@Serializable data class CurrentHandDto(
    val id: String? = null, val roundWind: String? = null, val roundNumber: Int? = null,
    val dealerSeatNo: Int? = null, val honba: Int? = null, val riichiPool: Int? = null,
    val markRevision: Long? = null, val status: String? = null,
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
@Serializable data class PaymentPart(val reason: String, val amount: Int)
@Serializable data class PaymentSeat(val seatNo: Int, val netPoints: Int, val breakdown: List<PaymentPart> = emptyList())
@Serializable data class NextHandDto(val roundWind: String, val roundNumber: Int, val dealerSeatNo: Int, val honba: Int, val riichiPool: Int)
@Serializable data class PaymentPreview(val perSeat: List<PaymentSeat>, val nextHand: NextHandDto)
@Serializable data class CreatedMatch(val match: CreatedMatchData)
@Serializable data class CreatedMatchData(val id: String, val joinCode: String? = null)
@Serializable data class CheckInTokenDto(val token: String, val expiresAt: String)
@Serializable data class ByCodeDto(val matchId: String, val token: String, val expiresAt: String)
@Serializable data class CheckInSeatsDto(val match: CheckInMatchDto, val seats: List<SeatDto>)
@Serializable data class CheckInMatchDto(val id: String, val playerCount: Int, val status: String)
@Serializable data class ReassignDto(val fromSeatNo: Int, val toSeatNo: Int, val swapped: Boolean)
@Serializable data class RemoveMemberDto(val removed: Boolean)
@Serializable data class CheckInDto(val seat: CheckInSeat, val grantId: String)
@Serializable data class CheckInSeat(val seatNo: Int)
@Serializable data class PrincipalDto(
    val id: String, val displayName: String, val type: String, val createdAt: String? = null,
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
