package com.p1ziyu.riichitracker.p1

fun isCheckedInParticipant(table: TableSnapshot?, principalId: String?): Boolean =
    table != null && principalId != null && table.seats.any {
        it.principalId == principalId && it.status == "checked_in"
    }

fun isTableHost(table: TableSnapshot?, principalId: String?): Boolean =
    table != null && principalId != null && table.match.ownerPrincipalId == principalId

fun mayDrawSeats(table: TableSnapshot): Boolean =
    table.match.status == "preparing" && table.match.seatingDrawnAt == null &&
        table.members.size == table.match.playerCount &&
        table.seats.any { it.status != "checked_in" }

fun mayStartMatch(table: TableSnapshot): Boolean =
    table.match.status == "preparing" && (table.match.seatingDrawnAt != null ||
        table.seats.size == table.match.playerCount && table.seats.all { it.status == "checked_in" })

/** Revocation is a transition from an active preparing-room member, including members
 * still waiting for the draw; an unrelated 403 must not close a spectator's table. */
fun isMembershipRevoked(previous: TableSnapshot?, principalId: String?, updated: TableSnapshot? = null,
                        status: Int? = null, wsCloseCode: Int? = null, wsSignal: String? = null): Boolean {
    if (previous?.match?.status != "preparing" || principalId == null) return false
    val wasMember = previous.members.any { it.principalId == principalId } ||
        previous.seats.any { it.principalId == principalId }
    if (!wasMember || previous.match.ownerPrincipalId == principalId) return false
    return status == 403 || wsCloseCode == 1008 ||
        wsSignal == "access_revoked" || wsSignal == "permission_revoked" ||
        (updated != null && updated.members.none { it.principalId == principalId } &&
            updated.seats.none { it.principalId == principalId })
}
