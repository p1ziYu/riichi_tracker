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
        assertEquals("checked_in", table.seats.single { it.seatNo == 0 }.status)
        assertEquals(25000, table.seats.single { it.seatNo == 0 }.points)
        assertNull(table.currentHand)
        assertTrue(hands.isEmpty())
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
        assertFalse(first.contentEquals(second))
        assertEquals("bearer-secret", crypto.open(first))
        first[first.lastIndex] = (first.last().toInt() xor 1).toByte()
        assertThrows(javax.crypto.AEADBadTagException::class.java) { crypto.open(first) }
    }
    @Test fun engineLinkRunsGoldenOperations() {
        assertEquals("ENGINE 0.1.0 · 局结算 通过 · 终局结算 通过", engineDiagnostic())
    }

}
