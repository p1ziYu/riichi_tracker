package com.p1ziyu.riichitracker.p1

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class JoinAndActionsTest {
    private val matchId = "72fa6a0d-67a5-4235-b7f0-e5f551226a42"
    private val otherId = "13a6744e-1fcb-454b-a035-d11a9ced3e0f"
    private val requestId = "2a580ec1-7618-4c75-a71c-519ec5b333ce"
    private class FakeTransport : JoinTransport {
        val calls = mutableListOf<Pair<String, String>>()
        var getResponse: suspend (String) -> String = { "{}" }
        var postResponse: suspend (String, String) -> String = { _, _ -> "{}" }
        override suspend fun get(path: String): String { calls += "GET" to path; return getResponse(path) }
        override suspend fun post(path: String, body: String): String {
            calls += "POST" to "$path $body"
            return postResponse(path, body)
        }
    }

    @Test fun dealerDesignatedAndOmittedAreDistinctPayloads() {
        assertEquals("{}", finalizeBody(null))
        assertEquals(2, Json.parseToJsonElement(finalizeBody(2)).jsonObject.getValue("dealerSeatNo").jsonPrimitive.content.toInt())
    }

    @Test fun markUsesCompareAndSwapRevisionAndLimitsChanges() {
        val hand = CurrentHandDto(id = "hand", status = "open", markRevision = 12)
        val seat = HandSeatDto(1, false, 1200, RiichiUsage(1, 0))
        val body = Json.parseToJsonElement(markBody(hand, seat, true)).jsonObject
        assertEquals("12", body.getValue("expectedMarkRevision").jsonPrimitive.content)
        assertEquals("1", body.getValue("seatNo").jsonPrimitive.content)
        assertEquals("true", body.getValue("riichi").jsonPrimitive.content)
        assertTrue(canChangeRiichi(seat, false))
        assertFalse(canChangeRiichi(seat.copy(riichiChangeUsage = RiichiUsage(2, 0)), false))
        assertTrue(canChangeRiichi(seat.copy(isRiichi = true, points = 0), false))
        assertFalse(canChangeRiichi(seat.copy(isRiichi = true, riichiChangeUsage = RiichiUsage(0, 1)), true))
        assertFalse(canChangeRiichi(seat.copy(points = 999), false))
        assertTrue(canChangeRiichi(seat.copy(points = 999), true))
        assertFalse(canChangeRiichi(seat.copy(isRiichi = null), true))
        assertThrows(IllegalArgumentException::class.java) { markBody(hand.copy(markRevision = null), seat, true) }
    }
    @Test fun staleMarkRefreshesBeforePostingAndCurrentMarkUsesTransport() = runBlocking {
        val hand = CurrentHandDto(id = "hand", status = "open", markRevision = 12,
            seats = listOf(HandSeatDto(1, false, 1200)))
        val seat = hand.seats.single()
        val fake = FakeTransport()
        var refreshes = 0
        assertThrows(IllegalStateException::class.java) { runBlocking {
            changeMark(fake, matchId, hand, hand.copy(markRevision = 13), seat, false, true) { refreshes++ }
        } }
        assertEquals(1, refreshes)
        assertTrue(fake.calls.isEmpty())
        changeMark(fake, matchId, hand, hand, seat, false, true) { refreshes++ }
        assertEquals(1, fake.calls.size)
        assertTrue(fake.calls.single().second.contains("\"expectedMarkRevision\":12"))
    }
    @Test fun mark409TriggersRefetchWithoutAutomaticRetry() = runBlocking {
        val seat = HandSeatDto(1, false, 1200)
        val hand = CurrentHandDto(id = "hand", status = "open", markRevision = 8, seats = listOf(seat))
        val fake = FakeTransport().apply {
            postResponse = { _, _ -> throw ApiFailure(409, "stale_mark_revision", null, "stale") }
        }
        var refreshes = 0
        assertThrows(ApiFailure::class.java) { runBlocking {
            changeMark(fake, matchId, hand, hand, seat, false, true) {
                refreshes++
                runBlocking { fake.get("/api/matches/$matchId") }
            }
        } }
        assertEquals(1, refreshes)
        assertEquals(listOf("POST", "GET"), fake.calls.map { it.first })
        assertTrue(fake.calls.first().second.contains("\"expectedMarkRevision\":8"))
        assertEquals("GET" to "/api/matches/$matchId", fake.calls.last())
    }



    @Test fun previewRequiresSameHandInputAndMarkRevision() {
        val input = buildJsonObject { put("kind", "ron") }
        val otherInput = buildJsonObject { put("kind", "tsumo") }
        val hand = CurrentHandDto(id = "h1", status = "open", markRevision = 3)
        val output = PaymentPreview(emptyList(), NextHandDto("east", 2, 0, 0, 0))
        val bound = BoundPreview("h1", 3, input.toString(), output)
        assertTrue(bound.matches(hand, input))
        assertFalse(bound.matches(hand, otherInput))
        assertFalse(bound.matches(hand.copy(markRevision = 4), input))
        assertFalse(bound.matches(hand.copy(id = "h2"), input))
        assertFalse(bound.matches(hand.copy(status = "settled"), input))
    }

    @Test fun pendingResultRetryIsByteIdenticalAndEditGetsNewEventId() {
        val input = buildJsonObject { put("kind", "ron") }
        val first = PendingResult(matchId, "h1", resultBody(input, 3))
        val retry = first.body
        assertEquals(first.body, retry)
        val eventId = Json.parseToJsonElement(retry).jsonObject.getValue("clientEventId").jsonPrimitive.content
        assertEquals(eventId, java.util.UUID.fromString(eventId).toString())
        val edited = resultBody(buildJsonObject { put("kind", "tsumo") }, 3)
        assertNotEquals(retry, edited)
        assertNotEquals(eventId, Json.parseToJsonElement(edited).jsonObject.getValue("clientEventId").jsonPrimitive.content)
    }

    @Test fun codeNormalizesAndRejectsAmbiguousOrWrongLength() {
        assertEquals("ABC234", normalizeJoinCode(" abc234 "))
        assertNull(normalizeJoinCode("ABI234"))
        assertNull(normalizeJoinCode("ABO234"))
        assertNull(normalizeJoinCode("AB0234"))
        assertNull(normalizeJoinCode("AB1234"))
        assertNull(normalizeJoinCode("abc23"))
        assertNull(normalizeJoinCode("abc2345"))
        val fake = FakeTransport()
        assertThrows(IllegalArgumentException::class.java) { runBlocking { JoinActions(fake).resolve("ABC2345") } }
        assertTrue(fake.calls.isEmpty())
        assertTrue(expiredCheckInToken(ApiFailure(400, "invalid_token", null, "expired")))
        assertTrue(expiredCheckInToken(ApiFailure(400, "token_consumed_or_expired", null, "expired")))
        assertFalse(expiredCheckInToken(ApiFailure(403, "check_in_not_approved", null, "waiting")))
    }
    @Test fun serverErrorsMapToActionableChineseCopy() {
        assertTrue(apiFailureMessage(ApiFailure(404, "join_code_not_found", null, "missing")).contains("房间码无效"))
        assertTrue(apiFailureMessage(ApiFailure(403, "no_active_invitation", null, "missing")).contains("桌主"))
        assertTrue(apiFailureMessage(ApiFailure(403, "check_in_not_approved", null, "waiting")).contains("申请凭证"))
        assertTrue(apiFailureMessage(ApiFailure(409, "seat_taken", null, "taken")).contains("刷新"))
        assertTrue(apiFailureMessage(ApiFailure(409, "match_already_started", null, "started")).contains("已开局"))
        assertTrue(apiFailureMessage(ApiFailure(404, "match_not_found", null, "missing")).contains("不存在"))
        assertFalse(apiFailureMessage(ApiFailure(404, "match_not_found", null, "missing")).contains("已开局"))
        assertTrue(apiFailureMessage(ApiFailure(400, "token_consumed_or_expired", null, "expired")).contains("重新换取"))
        assertTrue(apiFailureMessage(ApiFailure(429, "rate_limited", 12, "slow")).contains("12秒"))
    }


    @Test fun receiptRoundTripAndWrongMatchOrVersionRejected() {
        val receipt = JoinReceipt(v = 1, matchId = matchId, joinRequestId = requestId, name = "访客")
        assertEquals(receipt, parseJoinReceipt(receipt.encode(), matchId))
        assertEquals("1", Json.parseToJsonElement(receipt.encode()).jsonObject.getValue("v").jsonPrimitive.content)
        assertNull(parseJoinReceipt(receipt.encode(), otherId))
        assertEquals(receipt, parseJoinReceipt(receipt.encode()))
        assertNull(parseJoinReceipt("not-json"))
        assertNull(parseJoinReceipt(receipt.copy(v = 2).encode(), matchId))
        assertNull(parseJoinReceipt("""{"matchId":"$matchId","joinRequestId":"$requestId","name":"访客"}""", matchId))
        assertNull(parseJoinReceipt(receipt.copy(joinRequestId = "not-an-id").encode(), matchId))
        assertNull(parseJoinReceipt("not-json", matchId))
    }

    @Test fun joinOnceReturnsReceiptAnd403GetMeansWaiting() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { _, _ -> """{"joinRequestId":"$requestId","status":"pending"}""" }
            getResponse = { throw ApiFailure(403, "forbidden", null, "waiting") }
        }
        val flow = JoinActions(fake)
        val receipt = flow.request(matchId, "访客")
        assertEquals(requestId, receipt.joinRequestId)
        assertEquals(receipt, flow.request(matchId, "访客", receipt))
        assertThrows(IllegalStateException::class.java) { runBlocking { flow.request(otherId, "访客", receipt) } }
        assertFalse(flow.approved(matchId))
        assertEquals(1, fake.calls.count { it.first == "POST" })
        assertEquals("GET" to "/api/matches/$matchId", fake.calls.last())
        fake.getResponse = { """{"match":{"id":"$matchId"}}""" }
        assertTrue(flow.approved(matchId))
    }
    @Test fun approvalAutoCheckInNeedsMatchingReceiptAndHeldToken() {
        val receipt = JoinReceipt(v = 1, matchId = matchId, joinRequestId = requestId, name = "访客")
        val link = CheckInLink(matchId, "held", "https://riichi.p1ziyu.com/checkin/$matchId?token=held")
        val key = approvedCheckInKey(receipt, link, true, false, null)
        assertEquals("$matchId:held", key)
        assertNull(approvedCheckInKey(receipt, link, false, false, null))
        assertNull(approvedCheckInKey(receipt, link, true, true, null))
        assertNull(approvedCheckInKey(receipt, link, true, false, 2))
        assertNull(approvedCheckInKey(receipt, link.copy(token = null), true, false, null))
        assertNull(approvedCheckInKey(receipt, link.copy(matchId = otherId), true, false, null))
        assertNull(approvedCheckInKey(receipt, null, true, false, null))
    }


    @Test fun approvalTargetsSelectedSeatOnlyAndRejectsWrongMatch(): Unit = runBlocking {
        val fake = FakeTransport()
        val flow = JoinActions(fake)
        val receipt = JoinReceipt(v = 1, matchId = matchId, joinRequestId = requestId, name = "访客")
        flow.approve(receipt, 2, matchId)
        assertEquals("/api/matches/$matchId/join-requests/$requestId/approve {\"seatNo\":2}", fake.calls.single().second)
        assertThrows(IllegalArgumentException::class.java) { runBlocking { flow.approve(receipt, 1, otherId) } }
        Unit
    }

    @Test fun expiredCodeReResolvesThenChecksInAndExpiredLinkDoesNot() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { _, body ->
                if (body.contains("old")) throw ApiFailure(400, "token_consumed_or_expired", null, "expired")
                """{"seat":{"seatNo":2}}"""
            }
            getResponse = { """{"matchId":"$matchId","token":"fresh","expiresAt":"2026-11-01T00:00:00Z"}""" }
        }
        val flow = JoinActions(fake)
        val link = CheckInLink(matchId, "old", "https://riichi.p1ziyu.com/checkin/$matchId?token=old")
        assertEquals(2, flow.checkInRecovering(link, " abc234 ").seat.seatNo)
        assertEquals(listOf("POST", "GET", "POST"), fake.calls.map { it.first })
        fake.calls.clear()
        assertThrows(ApiFailure::class.java) { runBlocking { flow.checkInRecovering(link, null) } }
        assertEquals(listOf("POST"), fake.calls.map { it.first })
    }

    @Test fun approvalConflictAndUnexpectedGetErrorsAreNotMistakenForWaiting(): Unit = runBlocking {
        val fake = FakeTransport().apply { getResponse = { throw ApiFailure(404, "match_not_found", null, "missing") } }
        assertThrows(ApiFailure::class.java) { runBlocking { JoinActions(fake).approved(matchId) } }
        fake.postResponse = { _, _ -> throw ApiFailure(409, "seat_taken", null, "taken") }
        assertThrows(ApiFailure::class.java) { runBlocking {
            JoinActions(fake).approve(JoinReceipt(v = 1, matchId = matchId, joinRequestId = requestId, name = "访客"), 1, matchId)
        } }
        Unit
    }
}
