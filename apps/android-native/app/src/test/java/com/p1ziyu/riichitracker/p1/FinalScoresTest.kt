package com.p1ziyu.riichitracker.p1

import org.junit.Assert.*
import org.junit.Test

class FinalScoresTest {
    @Test fun totals() {
        assertEquals(1000, totalFor("4p"))
        assertEquals(1050, totalFor("3p"))
        assertEquals(listOf("E", "S", "W"), windsFor("3p"))
        assertEquals(listOf("E", "S", "W", "N"), windsFor("4p"))
    }
    @Test fun correctFourPlayerSumIsSaveable() {
        val v = validateFinalScores(mapOf("E" to "400", "S" to "300", "W" to "200", "N" to "100"), "4p")
        assertTrue(v.saveable); assertEquals(1000, v.sum)
    }
    @Test fun wrongSumDisablesSave() {
        val v = validateFinalScores(mapOf("E" to "400", "S" to "300", "W" to "200", "N" to "101"), "4p")
        assertFalse(v.saveable); assertEquals(1001, v.sum)
        assertTrue(v.hint.contains("合计不对"))
    }
    @Test fun negativeAndZeroAllowed() {
        val v = validateFinalScores(mapOf("E" to "1050", "S" to "0", "W" to "0"), "3p")
        assertTrue(v.saveable)
        val neg = validateFinalScores(mapOf("E" to "1100", "S" to "-50", "W" to "0"), "3p")
        assertTrue(neg.saveable)
    }
    @Test fun outOfRangeRejected() {
        val v = validateFinalScores(mapOf("E" to "10000", "S" to "0", "W" to "0", "N" to "0"), "4p")
        assertFalse(v.saveable)
        val bad = validateFinalScores(mapOf("E" to "abc", "S" to "0", "W" to "0", "N" to "0"), "4p")
        assertFalse(bad.saveable)
    }
    @Test fun incompleteNotSaveable() {
        val v = validateFinalScores(mapOf("E" to "400", "S" to "", "W" to "200", "N" to "100"), "4p")
        assertFalse(v.saveable); assertFalse(v.complete)
    }
    @Test fun tieBreakFollowsWindOrder() {
        val ranks = computeRanks(mapOf("E" to 300, "S" to 300, "W" to 200, "N" to 200), windsFor("4p"))
        assertEquals(1, ranks["E"]); assertEquals(2, ranks["S"])
        assertEquals(3, ranks["W"]); assertEquals(4, ranks["N"])
        val sanma = computeRanks(mapOf("E" to 350, "S" to 350, "W" to 350), windsFor("3p"))
        assertEquals(1, sanma["E"]); assertEquals(2, sanma["S"]); assertEquals(3, sanma["W"])
    }
    @Test fun payloadIsNullWhenInvalid() {
        assertNull(finalScoresPayload(mapOf("E" to "1", "S" to "2", "W" to "3", "N" to "4"), "4p"))
        assertNotNull(finalScoresPayload(mapOf("E" to "400", "S" to "300", "W" to "200", "N" to "100"), "4p"))
    }
    @Test fun lobbySortPinsActiveFirst() {
        val finished = MatchDetail(id = "f", mode = "4p", status = "finished", createdAt = "2026-10-26T10:00:00Z")
        val active = MatchDetail(id = "a", mode = "4p", status = "in_progress", createdAt = "2026-10-25T10:00:00Z")
        val waiting = MatchDetail(id = "w", mode = "3p", status = "waiting", createdAt = "2026-10-24T10:00:00Z")
        assertEquals(listOf("a", "w", "f"), sortLobby(listOf(finished, waiting, active)).map { it.id })
        assertEquals(listOf("f"), sortHistory(listOf(finished, waiting, active)).map { it.id })
    }
    @Test fun errorMappingNeverLeaksRawEnglish() {
        assertEquals("牌桌已满员，无法加入。", apiFailureMessage(ApiFailure(409, "match_full", null, "match full")))
        assertEquals("只有房主可以执行此操作。", apiFailureMessage(ApiFailure(403, "forbidden", null, "forbidden")))
        assertEquals("牌桌不存在或已被删除。", apiFailureMessage(ApiFailure(404, "something_unknown", null, "not found")))
        assertEquals("尝试过于频繁，请稍后再试。", apiFailureMessage(ApiFailure(429, null, null, "")))
    }
}
