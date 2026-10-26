package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class JoinLinkTest {
    private val json = Json { ignoreUnknownKeys = true }
    @Test fun roomCodeNormalization() {
        assertEquals("ABC234", normalizeJoinCode("abc234"))
        assertNull(normalizeJoinCode("ABC123")) // 1 is excluded from the code alphabet
        assertNull(normalizeJoinCode("ABC12")) // too short
        assertNull(normalizeJoinCode("ABC012")) // 0 excluded
        assertNull(normalizeJoinCode("ABCI23")) // I excluded
    }
    @Test fun shareLinkEmbedsJoinCode() {
        val link = shareLink("123e4567-e89b-12d3-a456-426614174000", "ABC234")
        assertEquals("https://riichi.p1ziyu.com/checkin/123e4567-e89b-12d3-a456-426614174000?token=ABC234", link)
        val parsed = parseJoinLink(link)
        assertNotNull(parsed)
        assertEquals("ABC234", parsed!!.token)
        assertEquals("123e4567-e89b-12d3-a456-426614174000", parsed.matchId)
    }
    @Test fun linkWithoutCredentialParsesButHasNoToken() {
        val parsed = parseJoinLink("https://riichi.p1ziyu.com/checkin/123e4567-e89b-12d3-a456-426614174000")
        assertNotNull(parsed); assertFalse(parsed!!.hasToken)
    }
    @Test fun rejectsWrongHostAndBadPaths() {
        assertNull(parseJoinLink("https://evil.example/checkin/123e4567-e89b-12d3-a456-426614174000?token=ABC234"))
        assertNull(parseJoinLink("https://riichi.p1ziyu.com/matches/123e4567-e89b-12d3-a456-426614174000"))
        assertNull(parseJoinLink("not a url"))
    }
    @Test fun meDecodesWithAndWithoutIsAdmin() {
        val with = json.decodeFromString<MeResponse>(
            """{"principal":{"id":"p1","displayName":"房主","type":"account"},"isAdmin":true}""")
        assertTrue(with.isAdmin)
        val without = json.decodeFromString<MeResponse>(
            """{"principal":{"id":"p2","displayName":"成员","type":"account"}}""")
        assertFalse(without.isAdmin)
    }
    @Test fun matchDetailDecodesNewContract() {
        val m = json.decodeFromString<MatchDetail>("""{
            "id":"m1","mode":"3p","status":"in_progress","hostId":"u1","joinCode":"ABC234",
            "members":[{"userId":"u1","displayName":"东家"},{"userId":"u2","displayName":"南家"},{"userId":"u3","displayName":"西家"}],
            "seats":[{"userId":"u1","wind":"东"},{"userId":"u2","wind":"南"},{"userId":"u3","wind":"西"}],
            "finalScores":null,"createdAt":"2026-10-26T00:00:00Z"}""")
        assertEquals(3, m.expectedCount)
        assertEquals(listOf("东", "南", "西"), m.seatRows().map { it.wind })
        assertTrue(m.isHost("u1")); assertFalse(m.isHost("u2"))
    }
}
