package com.p1ziyu.riichitracker.p1

import org.junit.Assert.*
import org.junit.Test

class FinalScoresTest {
    @Test fun totals() {
        assertEquals(1000, totalFor("4p"))
        assertEquals(1050, totalFor("3p"))
        assertEquals(listOf("东", "南", "西"), windsFor("3p"))
        assertEquals(listOf("东", "南", "西", "北"), windsFor("4p"))
    }
    @Test fun correctFourPlayerSumIsSaveable() {
        val v = validateFinalScores(mapOf("东" to "400", "南" to "300", "西" to "200", "北" to "100"), "4p")
        assertTrue(v.saveable); assertEquals(1000, v.sum)
    }
    @Test fun wrongSumDisablesSave() {
        val v = validateFinalScores(mapOf("东" to "400", "南" to "300", "西" to "200", "北" to "101"), "4p")
        assertFalse(v.saveable); assertEquals(1001, v.sum)
        assertTrue(v.hint.contains("合计不对"))
    }
    @Test fun negativeAndZeroAllowed() {
        val v = validateFinalScores(mapOf("东" to "1050", "南" to "0", "西" to "0"), "3p")
        assertTrue(v.saveable)
        val neg = validateFinalScores(mapOf("东" to "1100", "南" to "-50", "西" to "0"), "3p")
        assertTrue(neg.saveable)
    }
    @Test fun outOfRangeRejected() {
        val v = validateFinalScores(mapOf("东" to "10000", "南" to "0", "西" to "0", "北" to "0"), "4p")
        assertFalse(v.saveable)
        val bad = validateFinalScores(mapOf("东" to "abc", "南" to "0", "西" to "0", "北" to "0"), "4p")
        assertFalse(bad.saveable)
    }
    @Test fun incompleteNotSaveable() {
        val v = validateFinalScores(mapOf("东" to "400", "南" to "", "西" to "200", "北" to "100"), "4p")
        assertFalse(v.saveable); assertFalse(v.complete)
    }
    @Test fun tieBreakFollowsWindOrder() {
        val ranks = computeRanks(mapOf("东" to 300, "南" to 300, "西" to 200, "北" to 200), windsFor("4p"))
        assertEquals(1, ranks["东"]); assertEquals(2, ranks["南"])
        assertEquals(3, ranks["西"]); assertEquals(4, ranks["北"])
        val sanma = computeRanks(mapOf("东" to 350, "南" to 350, "西" to 350), windsFor("3p"))
        assertEquals(1, sanma["东"]); assertEquals(2, sanma["南"]); assertEquals(3, sanma["西"])
    }
    @Test fun payloadIsNullWhenInvalid() {
        assertNull(finalScoresPayload(mapOf("东" to "1", "南" to "2", "西" to "3", "北" to "4"), "4p"))
        assertNotNull(finalScoresPayload(mapOf("东" to "400", "南" to "300", "西" to "200", "北" to "100"), "4p"))
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
