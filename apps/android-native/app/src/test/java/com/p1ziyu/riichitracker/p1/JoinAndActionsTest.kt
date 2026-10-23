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
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            JoinActions(fake).seats(CheckInLink(matchId, null, ""))
        } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            JoinActions(fake).checkIn(CheckInLink(matchId, "", ""), 0, null)
        } }
        assertTrue(fake.calls.isEmpty())
    }
    @Test fun serverErrorsMapToActionableChineseCopy() {
        assertTrue(apiFailureMessage(ApiFailure(404, "join_code_not_found", null, "missing")).contains("房间码无效"))
        assertTrue(apiFailureMessage(ApiFailure(403, "guest_already_bound", null, "bound")).contains("其他牌桌"))
        assertTrue(apiFailureMessage(ApiFailure(409, "member_already_seated", null, "seated")).contains("已在本桌"))
        assertTrue(apiFailureMessage(ApiFailure(409, "seat_taken", null, "taken")).contains("刷新"))
        assertTrue(apiFailureMessage(ApiFailure(409, "match_full", null, "full")).contains("已满"))
        assertTrue(apiFailureMessage(ApiFailure(409, "match_already_started", null, "started")).contains("已开局"))
        assertTrue(apiFailureMessage(ApiFailure(404, "match_not_found", null, "missing")).contains("不存在"))
        assertFalse(apiFailureMessage(ApiFailure(404, "match_not_found", null, "missing")).contains("已开局"))
        for (code in listOf("invalid_token", "missing_token", "token_consumed_or_expired"))
            assertTrue(apiFailureMessage(ApiFailure(400, code, null, "expired")).contains("已过期"))
        assertTrue(apiFailureMessage(ApiFailure(429, "rate_limited", 12, "slow")).contains("12秒"))
        assertTrue(apiFailureMessage(ApiFailure(429, "rate_limited", null, "slow")).contains("稍后重试"))
        assertEquals("服务器维护中", apiFailureMessage(ApiFailure(503, "maintenance", null, "服务器维护中")))
    }

    @Test fun previewMapsOccupancyByPrincipalAndSortsFreeSeats(): Unit = runBlocking {
        val fake = FakeTransport().apply {
            getResponse = { """{"match":{"id":"$matchId","playerCount":4,"status":"preparing"},
                "seats":[{"seatNo":2,"principalId":null,"displayName":null,"status":"empty"},
                {"seatNo":0,"principalId":"owner","displayName":"房主","status":"checked_in"},
                {"seatNo":3,"principalId":null,"displayName":"旧昵称","status":"empty"},
                {"seatNo":1,"principalId":"guest","displayName":null,"status":"assigned"}]}""" }
        }
        val preview = JoinActions(fake).seats(CheckInLink(matchId, "signed+/token", ""))
        assertEquals(listOf(2, 3), freeJoinSeats(preview).map { it.seatNo })
        assertEquals(listOf(2, 3), selectableJoinSeats(preview, "newcomer").map { it.seatNo })
        assertEquals(listOf(1), selectableJoinSeats(preview, "guest").map { it.seatNo })
        assertEquals(listOf(0), selectableJoinSeats(preview, "owner").map { it.seatNo })
        assertEquals(listOf(2, 3), selectableJoinSeats(preview, null).map { it.seatNo })
        val full = preview.copy(seats = preview.seats.filter { it.principalId != null })
        assertTrue(selectableJoinSeats(full, "newcomer").isEmpty())
        assertEquals(listOf(0), selectableJoinSeats(full, "owner").map { it.seatNo })
        assertEquals("房主", preview.seats.first { it.seatNo == 0 }.displayName)
        assertEquals("GET" to "/api/matches/$matchId/check-in-seats?token=signed%2B%2Ftoken", fake.calls.single())
        fake.getResponse = { """{"match":{"id":"$otherId","playerCount":4,"status":"preparing"},"seats":[]}""" }
        assertThrows(IllegalStateException::class.java) { runBlocking {
            JoinActions(fake).seats(CheckInLink(matchId, "token", ""))
        } }
    }

    @Test fun codeResolvesBeforePreviewAndDirectCheckInEncodesExplicitOrAutoSeat() = runBlocking {
        val fake = FakeTransport().apply {
            getResponse = { path ->
                if (path.startsWith("/api/matches/by-code/"))
                    """{"matchId":"$matchId","token":"fresh","expiresAt":"2026-11-01T00:00:00Z"}"""
                else """{"match":{"id":"$matchId","playerCount":3,"status":"preparing"},
                    "seats":[{"seatNo":0,"principalId":"owner","displayName":"房主","status":"checked_in"},
                    {"seatNo":1,"principalId":null,"displayName":null,"status":"empty"},
                    {"seatNo":2,"principalId":null,"displayName":null,"status":"empty"}]}"""
            }
            postResponse = { _, _ -> """{"seat":{"seatNo":1},"grantId":"grant-1"}""" }
        }
        val joins = JoinActions(fake)
        val code = joins.resolve(" abc234 ")
        val link = CheckInLink(code.matchId, code.token, "")
        assertEquals(1, freeJoinSeats(joins.seats(link)).first().seatNo)
        val claimed = joins.checkIn(link, 1, " 新客 ")
        assertEquals(1, claimed.seat.seatNo)
        assertEquals("grant-1", claimed.grantId)
        val explicit = fake.calls.last().second
        assertEquals("/api/matches/$matchId/check-ins ", explicit.substringBefore("{"))
        assertEquals("fresh", Json.parseToJsonElement(explicit.substringAfter(" ")).jsonObject.getValue("token").jsonPrimitive.content)
        assertEquals("1", Json.parseToJsonElement(explicit.substringAfter(" ")).jsonObject.getValue("seatNo").jsonPrimitive.content)
        assertEquals("新客", Json.parseToJsonElement(explicit.substringAfter(" ")).jsonObject.getValue("alias").jsonPrimitive.content)
        joins.checkIn(link, null, " ")
        assertEquals(setOf("token"), Json.parseToJsonElement(fake.calls.last().second.substringAfter(" ")).jsonObject.keys)
        assertEquals(listOf("GET", "GET", "POST", "POST"), fake.calls.map { it.first })
    }

    @Test fun checkInFailuresDoNotRetryOrConsumeAnotherToken() = runBlocking {
        for (code in listOf("seat_taken", "match_full", "match_already_started", "invalid_token", "token_consumed_or_expired")) {
            val fake = FakeTransport().apply {
                postResponse = { _, _ -> throw ApiFailure(if (code == "invalid_token" || code == "token_consumed_or_expired") 400 else 409, code, null, code) }
            }
            val failure = assertThrows(ApiFailure::class.java) { runBlocking {
                JoinActions(fake).checkIn(CheckInLink(matchId, "token", ""), 2, null)
            } }
            assertEquals(code, failure.code)
            assertEquals(1, fake.calls.size)
        }
    }
    @Test fun seatTakenRefreshesAvailableSeatsWithoutReposting() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { _, _ -> throw ApiFailure(409, "seat_taken", null, "taken") }
            getResponse = { """{"match":{"id":"$matchId","playerCount":3,"status":"preparing"},
                "seats":[{"seatNo":0,"principalId":"owner","displayName":"房主","status":"checked_in"},
                {"seatNo":1,"principalId":null,"displayName":null,"status":"empty"},
                {"seatNo":2,"principalId":"other","displayName":"抢先签到","status":"checked_in"}]}""" }
        }
        val link = CheckInLink(matchId, "token", "")
        val previews = mutableListOf<CheckInSeatsDto?>()
        val failure = assertThrows(ApiFailure::class.java) { runBlocking {
            JoinActions(fake).checkInWithSeatRefresh(link, 2, null) { previews += it }
        } }
        assertEquals("seat_taken", failure.code)
        assertEquals(listOf(null, 1), previews.map { it?.let(::freeJoinSeats)?.singleOrNull()?.seatNo })
        assertEquals(listOf("POST", "GET"), fake.calls.map { it.first })
        assertEquals("GET" to "/api/matches/$matchId/check-in-seats?token=token", fake.calls.last())

        fake.calls.clear()
        fake.getResponse = { throw ApiFailure(400, "invalid_token", null, "expired") }
        previews.clear()
        val original = assertThrows(ApiFailure::class.java) { runBlocking {
            JoinActions(fake).checkInWithSeatRefresh(link, 2, null) { previews += it }
        } }
        assertEquals("seat_taken", original.code)
        assertEquals(listOf(null), previews)
        assertEquals(listOf("POST", "GET"), fake.calls.map { it.first })

        fake.calls.clear()
        fake.postResponse = { _, _ -> throw ApiFailure(409, "match_full", null, "full") }
        previews.clear()
        assertThrows(ApiFailure::class.java) { runBlocking {
            JoinActions(fake).checkInWithSeatRefresh(link, 2, null) { previews += it }
        } }
        assertTrue(previews.isEmpty())
        assertEquals(listOf("POST"), fake.calls.map { it.first })
    }


    @Test fun alreadyCheckedInResponseKeepsServerSeatAndGrant() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { _, _ -> """{"seat":{"seatNo":1},"grantId":"existing-grant"}""" }
        }
        val result = JoinActions(fake).checkIn(CheckInLink(matchId, "fresh", ""), 2, null)
        assertEquals(1, result.seat.seatNo)
        assertEquals("existing-grant", result.grantId)
        assertEquals(1, fake.calls.size)
    }

    @Test fun hostMoveSwapAndRemoveUseOwnerOnlyCommandShapes() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { path, _ ->
                if (path.endsWith("/remove")) """{"removed":true}"""
                else """{"fromSeatNo":1,"toSeatNo":2,"swapped":true}"""
            }
        }
        val joins = JoinActions(fake)
        assertTrue(joins.reassign(matchId, 1, 2).swapped)
        assertEquals("POST" to "/api/matches/$matchId/seats/reassign {\"fromSeatNo\":1,\"toSeatNo\":2}", fake.calls.first())
        assertTrue(joins.remove(matchId, otherId).removed)
        assertEquals("POST" to "/api/matches/$matchId/members/$otherId/remove {}", fake.calls.last())
        fake.postResponse = { _, _ -> """{"fromSeatNo":1,"toSeatNo":0,"swapped":false}""" }
        val moved = joins.reassign(matchId, 1, 0)
        assertFalse(moved.swapped)
        assertEquals(0, moved.toSeatNo)
    }
}
