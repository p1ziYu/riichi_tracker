package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ResultCompletenessTest {
    private fun table(policy: String = "allow_all", count: Int = 4, composite: Boolean = true,
                      double: Boolean = true): TableSnapshot = TableSnapshot(
        MatchDto("m", "in_progress", count, rulesSnapshot = buildJsonObject {
            put("multiRon", policy); put("compositeYakuman", composite)
            put("doubleYakuman", double); put("nagashiManganEnabled", true)
        }, ownerPrincipalId = "host"),
        (0 until count).map { SeatDto(it, principalId = when (it) { 0 -> "host"; 1 -> "player"; else -> null },
            status = if (it < 2) "checked_in" else "empty") },
    )
    private val hand = CurrentHandDto("h", status = "open", markRevision = 7,
        seats = (0..3).map { HandSeatDto(it, isRiichi = it == 0) })
    private fun ron(vararg winners: WinnerDraft) = ResultDraft(winners = winners.toList(), dealInSeatNo = 0)
    private fun input(draft: ResultDraft, table: TableSnapshot = table(), h: CurrentHandDto = hand): JsonObject =
        requireNotNull(validateResultDraft(draft, table, h).input)

    @Test fun ronCapsFollowSnapshotAndExcludeDuplicateOrDiscarder() {
        assertEquals(1, ronWinnerLimit(table("head_bump").match.rulesSnapshot, 4))
        assertEquals(2, ronWinnerLimit(table("double_ron").match.rulesSnapshot, 4))
        assertEquals(2, ronWinnerLimit(table("double_ron", 3).match.rulesSnapshot, 3))
        assertEquals(3, ronWinnerLimit(table("allow_all").match.rulesSnapshot, 4))
        assertEquals(1, ronWinnerLimit(null, 4))
        val triple = ron(WinnerDraft(1), WinnerDraft(2), WinnerDraft(3))
        assertEquals(3, input(triple, table("allow_all")).getValue("winners").jsonArray.size)
        assertTrue("winners" in validateResultDraft(triple, table("head_bump"), hand).errors)
        assertTrue("winners" in validateResultDraft(triple, table("double_ron"), hand).errors)
        assertTrue("winners" in validateResultDraft(triple, table("double_ron", 3), hand).errors)
        assertTrue("winners" in validateResultDraft(ron(WinnerDraft(1), WinnerDraft(1)), table(), hand).errors)
        assertTrue("dealInSeatNo" in validateResultDraft(ron(WinnerDraft(0)), table(), hand).errors)
        val winners = input(ron(WinnerDraft(1), WinnerDraft(2))).getValue("winners").jsonArray
        assertTrue(winners.all { it.jsonObject.getValue("dealInSeatNo").jsonPrimitive.int == 0 })
    }

    @Test fun eachWinnerYakumanHasIndependentCountsSwitchesAndFieldErrors() {
        val explicit = WinnerDraft(1, han = "", fu = "", yakuman = true, yakumanCount = "1", doubleYakumanCount = "1")
        val ordinary = WinnerDraft(2, han = "3", fu = "40")
        val winners = input(ron(explicit, ordinary)).getValue("winners").jsonArray
        assertEquals(1, winners[0].jsonObject.getValue("han").jsonPrimitive.int)
        assertEquals(30, winners[0].jsonObject.getValue("fu").jsonPrimitive.int)
        assertEquals(1, winners[0].jsonObject.getValue("doubleYakumanCount").jsonPrimitive.int)
        assertEquals(3, winners[1].jsonObject.getValue("han").jsonPrimitive.int)
        assertNull(winners[1].jsonObject["yakumanCount"])
        assertTrue("winners.0.doubleYakumanCount" in validateResultDraft(ron(explicit), table(double = false), hand).errors)
        assertTrue("winners.0.yakumanCount" in validateResultDraft(ron(explicit.copy(yakumanCount = "2")), table(composite = false), hand).errors)
        assertTrue("winners.0.yakumanCount" in validateResultDraft(ron(explicit.copy(yakumanCount = "0", doubleYakumanCount = "0")), table(), hand).errors)
        assertTrue("winners.0.yakumanCount" in validateResultDraft(ron(explicit.copy(yakumanCount = "11")), table(), hand).errors)
        assertTrue("winners.0.doubleYakumanCount" in validateResultDraft(ron(explicit.copy(doubleYakumanCount = "-1")), table(), hand).errors)
        assertTrue("winners.0.han" in validateResultDraft(ron(ordinary.copy(han = "")), table(), hand).errors)
        assertTrue("winners.0.fu" in validateResultDraft(ron(ordinary.copy(fu = "")), table(), hand).errors)
        assertTrue("winners.0.han" in validateResultDraft(ron(ordinary.copy(han = "131")), table(), hand).errors)
        assertTrue("winners.0.fu" in validateResultDraft(ron(ordinary.copy(fu = "19")), table(), hand).errors)
    }

    @Test fun declarationIsTopLevelAndRequiresMatchingMarkedRonDiscarder() {
        val draft = ron(WinnerDraft(1), WinnerDraft(2)).copy(declarationDealIn = true)
        val payload = input(draft)
        assertEquals(0, payload.getValue("riichiDeclarationDealInSeatNo").jsonPrimitive.int)
        assertTrue(payload.getValue("winners").jsonArray.all { "isRiichiDeclarationDealIn" !in it.jsonObject })
        assertTrue("declarationDealIn" in validateResultDraft(draft, table(), hand.copy(seats =
            hand.seats.map { it.copy(isRiichi = false) })).errors)
        assertTrue("declarationDealIn" in validateResultDraft(draft.copy(kind = "tsumo"), table(), hand).errors)
        assertTrue("dealInSeatNo" in validateResultDraft(draft.copy(dealInSeatNo = 1), table(), hand).errors)
        assertFalse("riichiDeclarationDealInSeatNo" in input(draft.copy(declarationDealIn = false)))
    }

    @Test fun draftRoundTripsAndPreviewInvalidatesOnRevisionOrInputEdit() {
        val draft = ron(WinnerDraft(1, han = "", fu = "40"))
        val record = SavedResultDraft("player", "m", "h", 7, draft)
        assertEquals(record, Json.decodeFromString<SavedResultDraft>(Json.encodeToString(record)))
        val valid = input(draft.copy(winners = listOf(WinnerDraft(1))))
        val preview = BoundPreview("h", 7, valid.toString(), PaymentPreview(emptyList(), NextHandDto("E", 2, 0, 0, 0)))
        assertTrue(preview.matches(hand, valid))
        assertFalse(preview.matches(hand.copy(markRevision = 8), valid))
        assertFalse(preview.matches(hand, input(ron(WinnerDraft(1, han = "3")))))
        assertEquals("", record.draft.winners.single().han)
    }

    @Test fun journalPreservesRawBodyAndUncertainResolutionRequiresAuthoritativeReview() {
        val payload = input(ron(WinnerDraft(1)))
        val body = resultBody(payload, 7, "bbbbbbbb-0000-4000-8000-000000000001")
        val record = PendingRecord("player", "m", "h", body, "bbbbbbbb-0000-4000-8000-000000000001")
        val restored = Json.decodeFromString<PendingRecord>(Json.encodeToString(record))
        assertEquals(body, restored.body)
        assertEquals(setOf("resultInput", "confirmedMarkRevision", "clientEventId"),
            Json.parseToJsonElement(restored.body).jsonObject.keys)
        val pending = PendingResult("m", "h", restored.body)
        assertEquals("bbbbbbbb-0000-4000-8000-000000000001", restored.clientEventId)
        assertEquals(PendingResolution.SAME_REVISION, pendingResolution(pending, table().copy(currentHand = hand)))
        assertEquals(PendingResolution.SETTLED,
            pendingResolution(pending, table().copy(currentHand = hand.copy(status = "settled"))))
        assertEquals(PendingResolution.CHANGED_REVISION,
            pendingResolution(pending, table().copy(currentHand = hand.copy(markRevision = 8))))
        assertEquals(7L, pendingRevision(pending))
        assertFalse(mayResendPending(pending, hand, false))
        assertTrue(mayResendPending(pending, hand, true))
        assertFalse(mayResendPending(pending, hand.copy(markRevision = 8), true))
        assertFalse(mayResendPending(pending, hand.copy(status = "settled"), true))
        assertNotEquals(body, resultBody(payload, 7, "cccccccc-0000-4000-8000-000000000002"))
    }

    @Test fun roleGatesAndResourceSpecificRevocation() {
        val match = table()
        assertTrue(isCheckedInParticipant(match, "player"))
        assertTrue(isTableHost(match, "host"))
        assertFalse(isTableHost(match, "player"))
        assertFalse(isCheckedInParticipant(match, "watcher"))
        assertFalse(isCheckedInParticipant(match.copy(seats = match.seats.map {
            if (it.principalId == "player") it.copy(status = "assigned") else it
        }), "player"))
        val preparing = match.copy(match = match.match.copy(status = "preparing"))
        val removed = preparing.copy(seats = preparing.seats.map {
            if (it.principalId == "player") it.copy(principalId = null, status = "empty") else it
        })
        assertTrue(isMembershipRevoked(preparing, "player", updated = removed))
        assertTrue(isMembershipRevoked(preparing, "player", status = 403))
        assertTrue(isMembershipRevoked(preparing, "player", wsCloseCode = 1008))
        assertFalse(isMembershipRevoked(preparing, "host", updated = removed))
        assertFalse(isMembershipRevoked(preparing, "watcher", status = 403))
        assertFalse(isMembershipRevoked(preparing, "player", status = 401))
        assertFalse(isMembershipRevoked(match, "player", status = 403))
    }
    @Test fun removedSeatlessMemberLosesPreparingRoomAccess() {
        val preparing = table().copy(
            match = table().match.copy(status = "preparing"),
            seats = table().seats.map { it.copy(principalId = null, status = "empty") },
            members = listOf(MemberDto("host", "房主", isOwner = true), MemberDto("player", "成员")),
        )
        val removed = preparing.copy(members = preparing.members.filterNot { it.principalId == "player" })
        assertTrue(isMembershipRevoked(preparing, "player", updated = removed))
        assertTrue(isMembershipRevoked(preparing, "player", status = 403))
        assertFalse(isMembershipRevoked(preparing, "host", updated = removed))
        assertFalse(isMembershipRevoked(preparing, "watcher", status = 403))
    }
    @Test fun flowAndNagashiKeepTheirExistingInputShape() {
        val draw = input(ResultDraft(kind = "ryuukyoku", tenpai = setOf(0, 2)))
        assertEquals(listOf(true, false, true, false),
            draw.getValue("tenpai").jsonArray.map { it.jsonPrimitive.boolean })
        assertEquals(0, draw.getValue("winners").jsonArray.size)
        val nagashi = ResultDraft(kind = "nagashi_mangan", winners = listOf(WinnerDraft(1)),
            river = "1m 9p 7z", attested = true)
        assertEquals(3, input(nagashi).getValue("nagashiEligibility").jsonArray[0].jsonObject
            .getValue("discards").jsonArray.size)
        assertTrue("river" in validateResultDraft(nagashi.copy(attested = false), table(), hand).errors)
        assertTrue("winners" in validateResultDraft(nagashi.copy(winners = listOf(WinnerDraft(1), WinnerDraft(2))), table(), hand).errors)
    }
}
