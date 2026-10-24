package com.p1ziyu.riichitracker.p1

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.TimeZone

class OnlineFlowTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val templates: List<TemplateDto> by lazy {
        json.decodeFromString(requireNotNull(javaClass.classLoader?.getResource("ruleset_templates.json")).readText())
    }

    @Test fun allFourTemplatesPreviewAndCreatePayload() {
        assertEquals(4, templates.size)
        templates.forEach { template ->
            val rules = OnlineRules(template)
            val payload = json.parseToJsonElement(rules.payload()).jsonObject
            assertEquals(template.versionId, payload.getValue("rulesetVersionId").jsonPrimitive.content)
            assertNull(payload["rulesOverride"])
            assertEquals(4, rules.examples().size)
            assertEquals(template.kind, "${rules.playerCount}p")
        }
    }

    @Test fun presetChipValuesLandInRulesAndDeleteDecision() {
        // iosfix6 item 3 (Android): preset taps are plain state updates in
        // Compose (no List-row collapse); pin that a preset value sticks.
        val rules = OnlineRules(templates.first { it.kind == "4p" })
        rules.update("startingPoints", "30000")
        assertEquals("30000", rules.values["startingPoints"])
        rules.setUma(listOf(15.0, 5.0, -5.0, -15.0))
        assertEquals("[15.0,5.0,-5.0,-15.0]", rules.values["uma"])
        // iosfix6 item 5: DELETE only for owner + preparing.
        val base = MatchSummary("m", "preparing", 4, "2026-10-24T00:00:00Z", isOwner = true)
        assertTrue(isDeletableMatch(base))
        assertFalse(isDeletableMatch(base.copy(isOwner = false)))
        assertFalse(isDeletableMatch(base.copy(status = "active")))
        assertFalse(isDeletableMatch(base.copy(status = "finished")))
    }

    @Test fun pointAndUmaValidationNeverSerializesIncompleteInput() {
        val rules = OnlineRules(templates.first { it.kind == "3p" })
        rules.update("startingPoints", "")
        assertThrows(IllegalStateException::class.java) { rules.payload() }
        rules.update("startingPoints", "35000")
        rules.update("honbaPerPayer", "200")
        assertEquals("400", rules.values["honbaRon"])
        rules.update("notenPenaltyTotal", "1500")
        assertThrows(IllegalStateException::class.java) { rules.payload() }
        rules.update("notenPenaltyTotal", "2000")
        rules.update("uma.0", "20.1")
        assertThrows(IllegalStateException::class.java) { rules.payload() }
        rules.update("uma.0", "20")
        val override = json.parseToJsonElement(rules.payload()).jsonObject.getValue("rulesOverride").jsonObject
        assertEquals(200, override.getValue("honbaPerPayer").jsonPrimitive.int)
        assertEquals(400, override.getValue("honbaRon").jsonPrimitive.int)
        assertFalse(override.containsKey("oka"))
    }

    @Test fun joinLinkAndLocalTime() {
        val id = "72fa6a0d-67a5-4235-b7f0-e5f551226a42"
        val link = parseCheckInLink("https://riichi.p1ziyu.com/checkin/$id?token=abc%2Fdef")!!
        assertEquals("abc/def", link.token)
        assertNull(parseCheckInLink("https://riichi.p1ziyu.com/checkin/$id?token=one&token=two"))
        assertEquals("2026-10-23 22:30", localMatchTime("2026-10-23T14:30:00.123Z", TimeZone.getTimeZone("Asia/Shanghai")))
        assertEquals("时间未提供", localMatchTime("2026-10-23T14:30:00"))
    }

    @Test fun roomNeedsAllMembersBeforeDrawAndDrawBeforeStart() {
        val match = MatchDto(id = "room", status = "preparing", playerCount = 3)
        val seats = (0..2).map { SeatDto(seatNo = it, status = "empty") }
        val owner = MemberDto("owner", "房主", isOwner = true)
        val joined = TableSnapshot(match, seats, members = listOf(owner, MemberDto("a", "成员一")))
        assertFalse(mayDrawSeats(joined))
        assertFalse(mayStartMatch(joined))
        val full = joined.copy(members = joined.members + MemberDto("b", "成员二"))
        assertTrue(mayDrawSeats(full))
        assertFalse(mayStartMatch(full))
        val drawn = full.copy(match = match.copy(seatingDrawnAt = "2026-10-24T12:00:00Z", dealerSeatNo = 1))
        assertFalse(mayDrawSeats(drawn))
        assertTrue(mayStartMatch(drawn))
        val removed = drawn.copy(match = match, members = drawn.members.dropLast(1))
        assertFalse(mayDrawSeats(removed))
        assertFalse(mayStartMatch(removed))
        val legacy = full.copy(seats = seats.mapIndexed { no, seat ->
            seat.copy(principalId = full.members[no].principalId, status = "checked_in")
        })
        assertFalse(mayDrawSeats(legacy))
        assertTrue(mayStartMatch(legacy))
        assertFalse(mayStartMatch(drawn.copy(match = drawn.match.copy(status = "in_progress"))))
    }
}
