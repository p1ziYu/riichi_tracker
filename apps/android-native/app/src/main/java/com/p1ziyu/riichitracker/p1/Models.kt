package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.Serializable

/**
 * Final-native model (spec §1–§2): only final scores are recorded.
 * No per-hand rounds, no settlements, no draw-winds, no templates.
 * Every field that the new API may omit has a default, so a summary
 * shape from /api/matches/mine and a full detail shape both decode.
 */
@Serializable data class PrincipalDto(
    val id: String, val displayName: String, val type: String = "account",
    val createdAt: String? = null,
)

/** GET /api/me: isAdmin added by spec §2; old responses without it decode as false. */
@Serializable data class MeResponse(
    val principal: PrincipalDto, val isAdmin: Boolean = false,
)

@Serializable data class MemberDto(
    val userId: String, val displayName: String,
    // Tolerate the old member shape (principalId) if a backend still sends it.
    val principalId: String? = null, val isOwner: Boolean = false,
    val isHost: Boolean = false, // new contract field (spec follow-up §5)
) {
    val id: String get() = userId.ifBlank { principalId.orEmpty() }
    val host: Boolean get() = isHost || isOwner
}

/** New contract: seats[{seatNo, userId, wind}], empty until full (follow-up §5). */
@Serializable data class SeatDto(val userId: String, val wind: String, val seatNo: Int? = null)

@Serializable data class FinalScoreDto(val wind: String, val score: Int, val rank: Int? = null)

@Serializable data class MatchDetail(
    val id: String,
    val mode: String? = null, // '3p' | '4p'
    val status: String = "waiting",
    val hostId: String? = null,
    val ownerPrincipalId: String? = null, // tolerated old field
    val joinCode: String? = null,
    val members: List<MemberDto> = emptyList(),
    val seats: List<SeatDto> = emptyList(),
    val finalScores: List<FinalScoreDto>? = null,
    val createdAt: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val correctedAt: String? = null,
    // Tolerated old summary fields, so /api/matches/mine rows decode either way.
    val playerCount: Int? = null,
) {
    val host: String? get() = hostId ?: ownerPrincipalId
    /** Seats if drawn, else members in join order (waiting screen). */
    val seatCount: Int get() = if (seats.isNotEmpty()) seats.size else members.size
    val expectedCount: Int get() = when (mode) {
        "3p" -> 3
        "4p" -> 4
        else -> playerCount ?: seatCount
    }
    val isHost: (String?) -> Boolean = { me -> me != null && host == me }
    fun displayNameFor(userId: String): String =
        members.firstOrNull { it.id == userId }?.displayName ?: "玩家"
    fun windFor(userId: String): String? = seats.firstOrNull { it.userId == userId }?.wind
    /** Ordered seat rows for table / final-score screens: wind order, then members. */
    fun seatRows(): List<SeatRow> {
        val winds = windsFor(mode ?: if (expectedCount == 3) "3p" else "4p")
        val byWind = seats.associateBy { it.wind }
        return winds.mapNotNull { wind ->
            val seat = byWind[wind] ?: return@mapNotNull null
            SeatRow(wind, seat.userId, displayNameFor(seat.userId))
        }.ifEmpty {
            members.mapIndexed { index, member ->
                SeatRow(winds.getOrNull(index) ?: "?", member.id, member.displayName)
            }
        }
    }
    fun finalByWind(): Map<String, Int> =
        finalScores?.associate { it.wind to it.score }.orEmpty()
}

data class SeatRow(val wind: String, val userId: String, val displayName: String)

/** POST /api/matches {mode} response; also used for join results (same shape). */
@Serializable data class CreatedMatch(val match: MatchDetail? = null, val id: String? = null,
    val joinCode: String? = null) {
    val matchId: String? get() = match?.id ?: id
}

/** GET /api/matches/by-code/:code (existing shape, kept). */
@Serializable data class ByCodeDto(val matchId: String, val token: String? = null,
    val expiresAt: String? = null)

/** Admin (spec §2, isAdmin only). */
@Serializable data class AdminPlayerDto(val id: String, val name: String? = null,
    val displayName: String? = null, val matchCount: Int = 0) {
    val label: String get() = displayName ?: name ?: id
}

@Serializable data class ApiErrorDto(val message: String? = null, val error: String? = null)

/** Follow-up §5: GET /api/admin/players wraps the list. */
@Serializable data class AdminPlayersDto(val players: List<AdminPlayerDto> = emptyList())
