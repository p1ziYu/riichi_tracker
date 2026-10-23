package com.p1ziyu.riichitracker.p1

fun isCheckedInParticipant(table: TableSnapshot?, principalId: String?): Boolean =
    table != null && principalId != null && table.seats.any {
        it.principalId == principalId && it.status == "checked_in"
    }

fun isTableHost(table: TableSnapshot?, principalId: String?): Boolean =
    table != null && principalId != null && table.match.ownerPrincipalId == principalId

/** A revocation is a transition from a previously seated preparing member, not any 403
 * from an unrelated request or a non-member's attempt to open a table. */
fun isMembershipRevoked(previous: TableSnapshot?, principalId: String?, updated: TableSnapshot? = null,
                        status: Int? = null, wsCloseCode: Int? = null, wsSignal: String? = null): Boolean {
    if (previous?.match?.status != "preparing" || principalId == null ||
        previous.seats.none { it.principalId == principalId }) return false
    return status == 403 || wsCloseCode == 1008 ||
        wsSignal == "access_revoked" || wsSignal == "permission_revoked" ||
        (updated != null && updated.seats.none { it.principalId == principalId })
}
