package com.p1ziyu.riichitracker.p1

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

/** B1 regression: internal winds are server codes (E/S/W/N); Chinese names
 *  are display-only via windLabel(). Covers the three observed failures:
 *  seatRows mapping, correction initial values, and payload wind codes. */
class WindMappingTest {
    @Test fun windLabelMapsCodesToChineseOnlyForDisplay() {
        assertEquals("东", windLabel("E"))
        assertEquals("南", windLabel("S"))
        assertEquals("西", windLabel("W"))
        assertEquals("北", windLabel("N"))
        assertEquals("?", windLabel("?"))
    }

    @Test fun windsForReturnsServerCodes() {
        assertEquals(listOf("E", "S", "W"), windsFor("3p"))
        assertEquals(listOf("E", "S", "W", "N"), windsFor("4p"))
    }

    @Test fun seatRowsMapsServerSeatsInsteadOfFallingBackToJoinOrder() {
        // Server seats deliberately NOT in join order: W=j3, N=j2 (the B1 screenshot case).
        val m = MatchDetail(
            id = "m", mode = "4p", status = "in_progress",
            members = listOf(
                MemberDto(userId = "j1", displayName = "j1"),
                MemberDto(userId = "j2", displayName = "j2"),
                MemberDto(userId = "j3", displayName = "j3"),
                MemberDto(userId = "j4", displayName = "j4"),
            ),
            seats = listOf(
                SeatDto(userId = "j1", wind = "E"),
                SeatDto(userId = "j2", wind = "N"),
                SeatDto(userId = "j3", wind = "W"),
                SeatDto(userId = "j4", wind = "S"),
            ),
        )
        val rows = m.seatRows()
        assertEquals(listOf("E", "S", "W", "N"), rows.map { it.wind })
        assertEquals(listOf("j1", "j4", "j3", "j2"), rows.map { it.userId })
        assertEquals(listOf("j1", "j4", "j3", "j2"), rows.map { it.displayName })
    }

    @Test fun correctionInitialKeysMatchWindsFor() {
        val m = MatchDetail(
            id = "m", mode = "4p", status = "finished",
            members = listOf(MemberDto(userId = "j1", displayName = "j1")),
            finalScores = listOf(
                FinalScoreDto(wind = "E", score = 400),
                FinalScoreDto(wind = "S", score = 300),
                FinalScoreDto(wind = "W", score = 200),
                FinalScoreDto(wind = "N", score = 100),
            ),
        )
        val initial = m.finalByWind().mapValues { it.value.toString() }
        // What FinalScoreScreen does: winds.associateWith { initial[it] } must not be blank.
        val cells = windsFor(m.mode).associateWith { initial[it].orEmpty() }
        assertEquals(mapOf("E" to "400", "S" to "300", "W" to "200", "N" to "100"), cells)
        val ranks = computeRanks(m.finalByWind(), windsFor(m.mode))
        assertEquals(1, ranks["E"]); assertEquals(4, ranks["N"])
    }

    @Test fun payloadUsesServerWindCodesNotChinese() {
        val payload = finalScoresPayload(
            mapOf("E" to "400", "S" to "300", "W" to "200", "N" to "100"), "4p")
        assertNotNull(payload)
        assertEquals(listOf("E", "S", "W", "N"), payload!!.map { it.wind })
        assertEquals(listOf(400, 300, 200, 100), payload.map { it.score })
    }

    @Test fun localCreationAndCorrectionUseServerCodes() {
        val m = createLocalFinalMatch("4p", listOf("甲", "乙", "丙", "丁"), random = Random(42))
        assertEquals(setOf("E", "S", "W", "N"), m.seats.map { it.wind }.toSet())
        val done = m.withFinalScores(m.seats.associate { it.wind to "250" })
        assertEquals(setOf("E", "S", "W", "N"), done.finalScores!!.map { it.wind }.toSet())
        val corrected = done.withFinalScores(done.seats.associate {
            it.wind to when (it.wind) { "E" -> "500"; "S" -> "300"; "W" -> "100"; else -> "100" }
        })
        assertEquals(500, corrected.finalByWind()["E"])
        assertEquals(done.seats, corrected.seats)
    }
}
