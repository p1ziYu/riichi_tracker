package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun fixture(name: String): String = requireNotNull(javaClass.classLoader?.getResource("$name.json"))
        .readText()

    @Test fun capturedMe() {
        val me = json.decodeFromString<MeResponse>(fixture("api_me"))
        assertEquals("account", me.principal.type)
        assertEquals("Disposable Fixture Owner", me.principal.displayName)
    }

    @Test fun capturedMatchListAndTemplates() {
        val matches = json.decodeFromString<List<MatchSummary>>(fixture("matches_mine"))
        val templates = json.decodeFromString<List<TemplateDto>>(fixture("ruleset_templates"))
        assertEquals(1, matches.size)
        assertEquals("preparing", matches.single().status)
        assertEquals(4, matches.single().playerCount)
        assertNotNull(templates.single { it.versionId == matches.single().rulesetVersionId }.config)
    }

    @Test fun capturedTableAndHands() {
        val table = json.decodeFromString<TableSnapshot>(fixture("match_detail"))
        val hands = json.decodeFromString<List<HandDto>>(fixture("hands_empty"))
        assertEquals(4, table.seats.size)
        assertEquals("empty", table.seats.single { it.seatNo == 0 }.status)
        assertEquals(25000, table.seats.single { it.seatNo == 0 }.points)
        assertNull(table.match.seatingDrawnAt)
        assertNull(table.match.dealerSeatNo)
        assertEquals("4334cf00-6cd0-4c69-81ce-12f3d2424b0b", table.members.single().principalId)
        assertTrue(table.members.single().isOwner)
        assertNull(table.members.single().seatNo)
        assertNull(table.members.single().wind)
        assertNull(table.currentHand)
        assertTrue(hands.isEmpty())
    }

    @Test fun drawnMatchDetailKeepsMemberWindAndDealerFromServer() {
        val table = json.decodeFromString<TableSnapshot>("""{
            "match":{"id":"m","playerCount":4,"status":"preparing",
                "seatingDrawnAt":"2026-10-24T12:00:00Z","dealerSeatNo":2},
            "members":[
                {"principalId":"owner","displayName":"房主","isOwner":true,"seatNo":2,"wind":"E"},
                {"principalId":"guest","displayName":"成员","isOwner":false,"seatNo":3,"wind":"S"},
                {"principalId":"third","displayName":"第三位","seatNo":0,"wind":"W"},
                {"principalId":"fourth","displayName":"第四位","seatNo":1,"wind":"N"}
            ],
            "seats":[
                {"seatNo":0,"principalId":"third","status":"checked_in"},
                {"seatNo":1,"principalId":"fourth","status":"checked_in"},
                {"seatNo":2,"principalId":"owner","status":"checked_in"},
                {"seatNo":3,"principalId":"guest","status":"checked_in"}
            ]
        }""")
        assertEquals("2026-10-24T12:00:00Z", table.match.seatingDrawnAt)
        assertEquals(2, table.match.dealerSeatNo)
        assertEquals(listOf(2, 3, 0, 1), table.members.map { it.seatNo })
        assertEquals(listOf("E", "S", "W", "N"), table.members.map { it.wind })
        assertEquals(4, table.seats.count { it.status == "checked_in" })
    }

    @Test fun poolUsesPointUnits() {
        assertEquals(0, poolSticks(0))
        assertEquals(1, poolSticks(1000))
        assertEquals(3, poolSticks(3000))
    }

    @Test fun checkInHostAndToken() {
        val id = "72fa6a0d-67a5-4235-b7f0-e5f551226a42"
        val valid = parseCheckInLink("https://riichi.p1ziyu.com/checkin/$id?token=abc%2Fdef")
        assertEquals(id, valid?.matchId)
        assertTrue(valid!!.hasToken)
        assertEquals(false, parseCheckInLink("https://riichi.p1ziyu.com/checkin/$id")?.hasToken)
        assertNull(parseCheckInLink("https://riichi.p1ziyu.com.evil.test/checkin/$id?token=x"))
        assertNull(parseCheckInLink("http://riichi.p1ziyu.com/checkin/$id?token=x"))
        assertNull(parseCheckInLink("https://riichi.p1ziyu.com/checkin/../checkin/$id?token=x"))
        assertNull(parseCheckInLink("https://riichi.p1ziyu.com/checkin/nope?token=x"))
        assertEquals(false, parseCheckInLink("https://riichi.p1ziyu.com/checkin/$id?token=")?.hasToken)
    }

    @Test fun authenticatedEncryptionRoundTripAndTamper() {
        val key = javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val crypto = TokenCipher(key)
        val first = crypto.seal("bearer-secret")
        val second = crypto.seal("bearer-secret")
        assertEquals(1, first[0].toInt())
        assertEquals(1 + 12 + "bearer-secret".toByteArray(Charsets.UTF_8).size + 16, first.size)
        assertFalse(first.contentEquals(second))
        assertEquals("bearer-secret", crypto.open(first))
        assertEquals("bearer-secret", crypto.open(second))
        first[first.lastIndex] = (first.last().toInt() xor 1).toByte()
        assertThrows(javax.crypto.AEADBadTagException::class.java) { crypto.open(first) }
    }
    @Test fun engineLinkRunsGoldenOperations() {
        assertEquals("ENGINE 0.1.0 · 局结算 通过 · 终局结算 通过", engineDiagnostic())
    }

}
