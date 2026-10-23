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
}
