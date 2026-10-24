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
            JoinActions(fake).checkIn(CheckInLink(matchId, "", ""), null)
        } }
        assertTrue(fake.calls.isEmpty())
    }
    @Test fun serverErrorsMapToExactChineseCopyWithoutLeakingServerText() {
        val messages = mapOf(
            "match_full" to "牌桌已满员，无法加入。",
            "match_already_started" to "牌局已开始，无法加入。",
            "invalid_token" to "签到链接无效或已过期，请房主重新分享链接，或使用房间码。",
            "token_consumed_or_expired" to "签到链接无效或已过期，请房主重新分享链接，或使用房间码。",
            "missing_token" to "签到链接无效或已过期，请房主重新分享链接，或使用房间码。",
            "seat_claim_retired" to "入座方式已更新，请重新加入牌桌。",
            "owner_auto_check_in" to "你是房主，已为你打开牌桌。",
            "guest_already_bound" to "当前访客身份已绑定其他牌桌。",
            "room_not_full" to "人数尚未到齐，无法抽风定座。",
            "seating_already_drawn" to "已完成抽风定座。",
            "seating_already_complete" to "座位已确定，可直接开局。",
            "forbidden" to "只有房主可以执行此操作。",
            "member_not_found" to "成员已不在牌桌中。",
            "seat_empty" to "该座位暂无成员。",
            "invalid_seat" to "座位选择无效。",
            "rate_limited" to "尝试过于频繁，请稍后再试。",
            "join_code_not_found" to "房间码不正确，或牌桌已结束。",
            "incomplete_check_ins" to "成员尚未全部就座，无法开局。",
            "match_not_found" to "牌桌不存在或已被删除。",
        )
        messages.forEach { (code, expected) ->
            assertEquals(code, expected, apiFailureMessage(ApiFailure(409, code, 12, "PRIVATE SERVER TEXT")))
        }
        assertEquals("操作失败，请稍后重试。",
            apiFailureMessage(ApiFailure(503, "unrecognized", null, "PRIVATE SERVER TEXT")))
    }

    @Test fun previewProvidesCallerMembershipAndUndrawnSeating(): Unit = runBlocking {
        val fake = FakeTransport().apply {
            getResponse = { """{"match":{"id":"$matchId","playerCount":3,"status":"preparing"},
                "caller":{"principalId":"guest","isOwner":false,"isMember":false},
                "members":[{"principalId":"owner","displayName":"房主","isOwner":true,"seatNo":null,"wind":null}],
                "seating":{"drawn":false,"dealerSeatNo":null,"memberCount":1,"seatedCount":0},
                "seats":[{"seatNo":0,"principalId":null,"status":"empty"},
                         {"seatNo":1,"principalId":null,"status":"empty"},
                         {"seatNo":2,"principalId":null,"status":"empty"}]}""" }
        }
        val preview = JoinActions(fake).seats(CheckInLink(matchId, "signed+/token", ""))
        assertEquals("guest", preview.caller.principalId)
        assertFalse(preview.caller.isOwner)
        assertFalse(preview.caller.isMember)
        assertEquals(listOf("owner"), preview.members.map { it.principalId })
        assertTrue(preview.members.single().isOwner)
        assertNull(preview.members.single().seatNo)
        assertNull(preview.members.single().wind)
        assertFalse(preview.seating.drawn)
        assertEquals(1, preview.seating.memberCount)
        assertEquals(0, preview.seating.seatedCount)
        assertNull(preview.seating.dealerSeatNo)
        assertEquals("GET" to "/api/matches/$matchId/check-in-seats?token=signed%2B%2Ftoken", fake.calls.single())
        fake.getResponse = { """{"match":{"id":"$otherId","playerCount":3,"status":"preparing"},
            "caller":{"principalId":"guest","isOwner":false,"isMember":false},
            "members":[],"seating":{"drawn":false,"memberCount":0,"seatedCount":0}}""" }
        assertThrows(IllegalStateException::class.java) { runBlocking {
            JoinActions(fake).seats(CheckInLink(matchId, "token", ""))
        } }
    }

    @Test fun previewDistinguishesOwnerReturningMemberAndFullDrawnTable() = runBlocking {
        val fake = FakeTransport().apply {
            getResponse = { path ->
                val caller = when {
                    path.contains("token=owner") -> """{"principalId":"owner","isOwner":true,"isMember":true}"""
                    path.contains("token=member") -> """{"principalId":"guest","isOwner":false,"isMember":true}"""
                    else -> """{"principalId":"newcomer","isOwner":false,"isMember":false}"""
                }
                """{"match":{"id":"$matchId","playerCount":3,"status":"preparing"},
                   "caller":$caller,
                   "members":[{"principalId":"owner","displayName":"房主","isOwner":true,"seatNo":2,"wind":"E"},
                              {"principalId":"guest","displayName":"回访者","isOwner":false,"seatNo":0,"wind":"S"},
                              {"principalId":"third","displayName":"第三位","isOwner":false,"seatNo":1,"wind":"W"}],
                   "seating":{"drawn":true,"dealerSeatNo":2,"memberCount":3,"seatedCount":3},
                   "seats":[]}"""
            }
        }
        val joins = JoinActions(fake)
        val owner = joins.seats(CheckInLink(matchId, "owner", ""))
        val member = joins.seats(CheckInLink(matchId, "member", ""))
        val outsider = joins.seats(CheckInLink(matchId, "newcomer", ""))
        assertTrue(owner.caller.isOwner)
        assertTrue(owner.caller.isMember)
        assertFalse(member.caller.isOwner)
        assertTrue(member.caller.isMember)
        assertFalse(outsider.caller.isOwner)
        assertFalse(outsider.caller.isMember)
        assertEquals(outsider.match.playerCount, outsider.seating.memberCount)
        assertTrue(outsider.seating.drawn)
        assertEquals(3, outsider.seating.seatedCount)
        assertEquals(2, outsider.seating.dealerSeatNo)
        assertEquals(listOf("E", "S", "W"), outsider.members.map { it.wind })
        assertEquals(listOf(2, 0, 1), outsider.members.map { it.seatNo })
    }

    @Test fun codeResolvesBeforePreviewAndJoinPostsTokenWithOptionalAliasButNeverSeat() = runBlocking {
        val fake = FakeTransport().apply {
            getResponse = { path ->
                if (path.startsWith("/api/matches/by-code/"))
                    """{"matchId":"$matchId","token":"fresh","expiresAt":"2026-11-01T00:00:00Z"}"""
                else """{"match":{"id":"$matchId","playerCount":3,"status":"preparing"},
                    "caller":{"principalId":"guest","isOwner":false,"isMember":false},
                    "members":[{"principalId":"owner","displayName":"房主","isOwner":true}],
                    "seating":{"drawn":false,"memberCount":1,"seatedCount":0}}"""
            }
            postResponse = { _, _ -> """{"member":{"principalId":"guest","displayName":"新客"},"seated":false,"grantId":"grant-1"}""" }
        }
        val joins = JoinActions(fake)
        val code = joins.resolve(" abc234 ")
        val link = CheckInLink(code.matchId, code.token, "")
        assertEquals("ABC234", fake.calls.first().second.substringAfterLast("/"))
        assertEquals(1, joins.seats(link).seating.memberCount)
        val joined = joins.checkIn(link, " 新客 ")
        assertEquals("guest", joined.member.principalId)
        assertEquals("新客", joined.member.displayName)
        assertFalse(joined.seated)
        assertEquals("grant-1", joined.grantId)
        val post = fake.calls.last().second
        assertEquals("/api/matches/$matchId/check-ins ", post.substringBefore("{"))
        val body = Json.parseToJsonElement(post.substringAfter(" ")).jsonObject
        assertEquals(setOf("token", "alias"), body.keys)
        assertEquals("fresh", body.getValue("token").jsonPrimitive.content)
        assertEquals("新客", body.getValue("alias").jsonPrimitive.content)
        joins.checkIn(link, " ")
        assertEquals(setOf("token"), Json.parseToJsonElement(fake.calls.last().second.substringAfter(" ")).jsonObject.keys)
        assertEquals(listOf("GET", "GET", "POST", "POST"), fake.calls.map { it.first })
    }


    @Test fun joinFailuresDoNotRetryOrConsumeAnotherToken() = runBlocking {
        for (code in listOf("match_full", "match_already_started", "invalid_token",
                "token_consumed_or_expired", "owner_auto_check_in")) {
            val fake = FakeTransport().apply {
                postResponse = { _, _ -> throw ApiFailure(409, code, null, code) }
            }
            val failure = assertThrows(ApiFailure::class.java) { runBlocking {
                JoinActions(fake).checkIn(CheckInLink(matchId, "token", ""), null)
            } }
            assertEquals(code, failure.code)
            assertEquals(listOf("POST" to "/api/matches/$matchId/check-ins {\"token\":\"token\"}"), fake.calls)
        }
    }

    @Test fun hostDrawPostsEmptyBodyAndReadsWindAndDealer() = runBlocking {
        val fake = FakeTransport().apply {
            postResponse = { _, _ -> """{"seats":[
                {"seatNo":0,"principalId":"guest","displayName":"新客","wind":"S"},
                {"seatNo":1,"principalId":"third","displayName":"第三位","wind":"W"},
                {"seatNo":2,"principalId":"owner","displayName":"房主","wind":"E"}],
                "dealerSeatNo":2}""" }
        }
        val drawn = JoinActions(fake).draw(matchId)
        assertEquals("POST" to "/api/matches/$matchId/seats/draw {}", fake.calls.single())
        assertEquals(2, drawn.dealerSeatNo)
        assertEquals(listOf(0, 1, 2), drawn.seats.map { it.seatNo })
        assertEquals(listOf("guest", "third", "owner"), drawn.seats.map { it.principalId })
        assertEquals(listOf("S", "W", "E"), drawn.seats.map { it.wind })
        assertEquals("房主", drawn.seats.last().displayName)
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
