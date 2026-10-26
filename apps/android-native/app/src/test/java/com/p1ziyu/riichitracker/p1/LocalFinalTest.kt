package com.p1ziyu.riichitracker.p1

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class LocalFinalTest {
    @Test fun createDrawsAllWindsOnce() {
        val m = createLocalFinalMatch("4p", listOf("甲", "乙", "丙", "丁"), random = Random(42))
        assertEquals("in_progress", m.status)
        assertEquals(setOf("东", "南", "西", "北"), m.seats.map { it.wind }.toSet())
        assertEquals(setOf("甲", "乙", "丙", "丁"), m.seats.map { it.name }.toSet())
        assertNull(m.finalScores)
    }
    @Test fun createSanmaUsesThreeWinds() {
        val m = createLocalFinalMatch("3p", listOf("甲", "乙", "丙"), random = Random(7))
        assertEquals(setOf("东", "南", "西"), m.seats.map { it.wind }.toSet())
        assertEquals(1050, m.total)
    }
    @Test fun finalScoresNeedCorrectTotal() {
        val m = createLocalFinalMatch("4p", listOf("甲", "乙", "丙", "丁"), random = Random(1))
        val cells = m.seats.associate { it.wind to "250" }
        val done = m.withFinalScores(cells)
        assertEquals("finished", done.status)
        assertEquals(1000, done.finalScores!!.sumOf { it.score })
        assertEquals(setOf(1, 2, 3, 4), done.finalScores.map { it.rank }.toSet())
    }
    @Test fun wrongTotalThrowsAndLeavesMatchUnchanged() {
        val m = createLocalFinalMatch("3p", listOf("甲", "乙", "丙"), random = Random(1))
        val cells = m.seats.associate { it.wind to "100" }
        try {
            m.withFinalScores(cells)
            fail("expected wrong total to throw")
        } catch (_: IllegalStateException) { }
        assertEquals("in_progress", m.status); assertNull(m.finalScores)
    }
    @Test fun correctionKeepsSeatsOnlyChangesScores() {
        val base = createLocalFinalMatch("4p", listOf("甲", "乙", "丙", "丁"), random = Random(3))
        val first = base.withFinalScores(base.seats.associate { it.wind to "250" })
        val corrected = first.withFinalScores(first.seats.associate {
            it.wind to when (it.wind) { "东" -> "500"; "南" -> "300"; "西" -> "100"; else -> "100" }
        })
        assertEquals("finished", corrected.status)
        assertEquals(first.seats, corrected.seats)
        assertNotNull(corrected.correctedAt)
        assertEquals(1000, corrected.finalScores!!.sumOf { it.score })
        assertEquals(500, corrected.finalByWind()["东"])
    }
}
