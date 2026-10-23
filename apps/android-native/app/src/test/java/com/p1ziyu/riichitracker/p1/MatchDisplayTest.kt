package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

class MatchDisplayTest {
    @Test fun localDateUsesDeviceTimezoneRatherThanRawIso() {
        val tokyo = TimeZone.getTimeZone("Asia/Tokyo")
        assertEquals("2026-10-23 13:34", localMatchTime("2026-10-23T04:34:13.715Z", tokyo))
        assertEquals("2026-10-22 21:34", localMatchTime("2026-10-23T04:34:13.715Z", TimeZone.getTimeZone("America/Los_Angeles")))
    }

    @Test fun malformedOrMissingDateHasLocalizedFallback() {
        assertEquals("时间未提供", localMatchTime("invalid", TimeZone.getTimeZone("UTC")))
        assertEquals("时间未提供", localMatchTime(null, TimeZone.getTimeZone("UTC")))
    }

    @Test fun ownHistoryIncludesPreparingAndActiveMatchesInRecentFirstOrder() {
        val fixture = requireNotNull(javaClass.classLoader?.getResource("matches_mine.json")).readText()
        val ownList = Json { ignoreUnknownKeys = true }.decodeFromString<List<MatchSummary>>(fixture)
        val preparing = ownList.single()
        val active = preparing.copy(id = "active", status = "active", createdAt = "2026-10-22T04:34:13.715Z")
        val finished = preparing.copy(id = "finished", status = "finished", createdAt = "2026-10-21T04:34:13.715Z")
        val completed = preparing.copy(id = "completed", status = "completed", createdAt = "2026-10-20T04:34:13.715Z")
        assertEquals(listOf(preparing.id, "active", "finished", "completed"),
            ownHistoryMatches(listOf(completed, finished, active, preparing)).map { it.id })
    }
}
