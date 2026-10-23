package com.p1ziyu.riichitracker.p1

import com.riichi.mobileengine.*
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.*

private val fields = listOf("startingPoints", "returnPoints", "targetPoints", "uma", "fixedSouth4EndPolicy",
    "automaticEndPolicy", "bustEndsGame", "terminalRiichiPoolPolicy", "tiedUmaPolicy", "notenPenaltyTotal",
    "honbaRon", "honbaPerPayer", "multiRon", "doubleRonHonbaPolicy", "allowLowPointRiichi",
    "nagashiManganEnabled", "nagashiCollectsRiichiPool", "nagashiDealerRepeatRequiresTenpai", "tsumoLoss",
    "kiriageMangan", "kazoeYakuman", "compositeYakuman", "doubleYakuman")

internal fun JsonElement.toEngineValue(): Any? = when (this) {
    JsonNull -> null
    is JsonObject -> mapValues { it.value.toEngineValue() }
    is JsonArray -> map { it.toEngineValue() }
    is JsonPrimitive -> when {
        isString -> content
        content == "true" -> true
        content == "false" -> false
        else -> content.toDoubleOrNull()
    }
}

internal fun EngineRulesConfig.toFields(): Map<String, JsonElement> = mapOf(
    "startingPoints" to JsonPrimitive(startingPoints), "returnPoints" to JsonPrimitive(returnPoints),
    "targetPoints" to JsonPrimitive(targetPoints), "uma" to JsonArray(uma.map(::JsonPrimitive)),
    "fixedSouth4EndPolicy" to JsonPrimitive(fixedSouth4EndPolicy), "automaticEndPolicy" to JsonPrimitive(automaticEndPolicy),
    "bustEndsGame" to JsonPrimitive(bustEndsGame), "terminalRiichiPoolPolicy" to JsonPrimitive(terminalRiichiPoolPolicy),
    "tiedUmaPolicy" to JsonPrimitive(tiedUmaPolicy), "notenPenaltyTotal" to JsonPrimitive(notenPenaltyTotal),
    "honbaRon" to JsonPrimitive(honbaRon), "honbaPerPayer" to JsonPrimitive(honbaPerPayer),
    "multiRon" to JsonPrimitive(multiRon), "doubleRonHonbaPolicy" to JsonPrimitive(doubleRonHonbaPolicy),
    "allowLowPointRiichi" to JsonPrimitive(allowLowPointRiichi), "nagashiManganEnabled" to JsonPrimitive(nagashiManganEnabled),
    "nagashiCollectsRiichiPool" to JsonPrimitive(nagashiCollectsRiichiPool),
    "nagashiDealerRepeatRequiresTenpai" to JsonPrimitive(nagashiDealerRepeatRequiresTenpai),
    "tsumoLoss" to JsonPrimitive(tsumoLoss), "kiriageMangan" to JsonPrimitive(kiriageMangan),
    "kazoeYakuman" to JsonPrimitive(kazoeYakuman), "compositeYakuman" to JsonPrimitive(compositeYakuman),
    "doubleYakuman" to JsonPrimitive(doubleYakuman),
)

private val seedKeys = mapOf("house_4p" to HOUSE_4P_V1, "reference_4p_competition" to WRC_4P_REF_V1,
    "house_3p" to HOUSE_3P_V1, "reference_3p_common" to COMMON_3P_REF_V1)

class OnlineRules(val template: TemplateDto) {
    private val seed = seedKeys[template.templateKey]
    val playerCount = if (template.kind == "3p") 3 else if (template.kind == "4p") 4 else seed?.playerCount
        ?: ((template.config?.get("playerCount") as? JsonPrimitive)?.intOrNull ?: 4)
    val base: Map<String, JsonElement> = normalizeRulesConfig(
        (template.config?.mapValues { it.value.toEngineValue() } ?: seed?.toFields()?.mapValues { it.value.toEngineValue() }
            ?: error("模板规则缺失")), playerCount).toFields()
    var values: Map<String, String> by mutableStateOf(base.mapValues { (_, value) -> value.toString().trim('"') })
        private set

    val changed: Int get() = fields.count { key ->
        if (key == "uma") (base.getValue("uma") as JsonArray).indices.any { i ->
            values["uma.$i"]?.toDoubleOrNull() != null &&
                values["uma.$i"]?.toDoubleOrNull() != (base.getValue("uma") as JsonArray)[i].jsonPrimitive.double
        } || values["uma"] != base["uma"].toString()
        else values[key] != base[key].toString().trim('"')
    }
    fun reset() { values = base.mapValues { (_, value) -> value.toString().trim('"') } }
    fun update(key: String, input: String) {
        require(key in fields || key.startsWith("uma."))
        values = values + (key to input)
        if (key == "honbaRon" || key == "honbaPerPayer") {
            val number = input.toIntOrNull()
            val counterpart = if (key == "honbaRon") "honbaPerPayer" else "honbaRon"
            values = values + (counterpart to if (number == null) "" else if (key == "honbaRon") {
                if (number % (playerCount - 1) == 0) (number / (playerCount - 1)).toString() else ""
            } else (number.toLong() * (playerCount - 1)).toString())
        }
    }
    fun setUma(preset: List<Double>) { values = values + ("uma" to JsonArray(preset.map(::JsonPrimitive)).toString()) +
        preset.mapIndexed { index, v -> "uma.$index" to v.toString() } }
    private fun parsed(): Map<String, JsonElement> {
        val result = base.toMutableMap()
        for (key in fields) {
            if (key == "uma") continue
            val raw = values[key] ?: continue
            result[key] = when (base.getValue(key)) {
                is JsonPrimitive -> {
                    val original = base.getValue(key) as JsonPrimitive
                    when {
                        original.isString -> JsonPrimitive(raw)
                        original.booleanOrNull != null -> JsonPrimitive(raw.toBooleanStrictOrNull() ?: error("${ruleLabel(key)}需要有效开关"))
                        else -> JsonPrimitive(raw.toIntOrNull() ?: error("${ruleLabel(key)}需要有效整数"))
                    }
                }
                else -> error("无效规则字段")
            }
        }
        val uma = (base.getValue("uma") as JsonArray).mapIndexed { i, original ->
            val raw = values["uma.$i"] ?: (values["uma"]?.let { (Json.parseToJsonElement(it) as JsonArray)[i].jsonPrimitive.content }
                ?: original.jsonPrimitive.content)
            JsonPrimitive(raw.toDoubleOrNull() ?: error("第${i + 1}位马点不能为空"))
        }
        result["uma"] = JsonArray(uma)
        return result
    }
    fun validated(): JsonObject {
        val result = parsed()
        for (key in listOf("startingPoints", "returnPoints", "targetPoints", "notenPenaltyTotal", "honbaRon", "honbaPerPayer")) {
            val point = result.getValue(key).jsonPrimitive.int
            if (point < (if (key == "startingPoints") 1000 else if (key == "returnPoints" || key == "targetPoints") 100 else 0) ||
                point % 100 != 0) error("${ruleLabel(key)}须为${if (key == "startingPoints") "至少1000的" else "有效的"}整百点")
        }
        val uma = (result.getValue("uma") as JsonArray).map { it.jsonPrimitive.double }
        if (uma.size != playerCount || uma.any { !it.isFinite() || it * 10 != kotlin.math.floor(it * 10) } ||
            kotlin.math.abs(uma.sum()) > 0.00001) error("马点每座须为十分位，且总和为零")
        if (result.getValue("honbaRon").jsonPrimitive.int != result.getValue("honbaPerPayer").jsonPrimitive.int * (playerCount - 1))
            error("本场荣和总额与自摸每付款者不一致")
        if (result.getValue("notenPenaltyTotal").jsonPrimitive.int % (if (playerCount == 3) 200 else 600) != 0)
            error("流局罚符须可按听牌人数整百结算；1,500 点不支持")
        if (playerCount == 4 && result.getValue("automaticEndPolicy").jsonPrimitive.content == "ranked_sanma") error("四麻不能使用三麻自动终局")
        // Engine is the final local gate; API independently normalizes the same override on creation.
        normalizeRulesConfig(result.mapValues { it.value.toEngineValue() }, playerCount)
        return JsonObject(result)
    }
    fun overrides(): JsonObject {
        val parsed = validated()
        return JsonObject(fields.filter { parsed[it] != base[it] }.associateWith { parsed.getValue(it) })
    }
    fun payload(): String = buildJsonObject {
        put("rulesetVersionId", template.versionId)
        val diff = overrides()
        if (diff.isNotEmpty()) put("rulesOverride", diff)
    }.toString()
    fun examples(): List<Pair<String, SettlementOutput>> {
        val config = validated().mapValues { it.value.toEngineValue() }
        val points = validated().getValue("startingPoints").jsonPrimitive.int
        val hand = HandState("preview", "E", 1, 0, 0, 0,
            (0 until playerCount).map { SeatState(it, points, false, null) })
        return listOf(
            "子家 2 番 30 符荣和" to ResultInput(HandKind.RON, winners = listOf(WinnerInput(1, 2, 30, dealInSeatNo = 2))),
            "子家 2 番 30 符自摸" to ResultInput(HandKind.TSUMO, winners = listOf(WinnerInput(1, 2, 30))),
            "荒牌流局 · 一人听牌" to ResultInput(HandKind.RYUUKYOKU, tenpai = (0 until playerCount).map { it == 0 }),
            "荒牌流局 · 两人听牌" to ResultInput(HandKind.RYUUKYOKU, tenpai = (0 until playerCount).map { it < 2 }),
        ).map { (title, input) -> title to calculateSettlement(RulesSnapshot("local-preview", config), hand, input, ENGINE_VERSION) }
    }
}

internal fun ruleLabel(key: String): String = mapOf("startingPoints" to "起始点", "returnPoints" to "返还点",
    "targetPoints" to "终局目标点", "uma" to "马点", "fixedSouth4EndPolicy" to "末局结束条件",
    "automaticEndPolicy" to "自动终局", "bustEndsGame" to "飞人结束", "terminalRiichiPoolPolicy" to "终局供托",
    "tiedUmaPolicy" to "同点马点", "notenPenaltyTotal" to "荒牌流局罚符总额", "honbaRon" to "本场荣和总额",
    "honbaPerPayer" to "本场自摸每付款者", "multiRon" to "多家荣和", "doubleRonHonbaPolicy" to "双响本场分配",
    "allowLowPointRiichi" to "低点立直", "nagashiManganEnabled" to "流局满贯",
    "nagashiCollectsRiichiPool" to "流满收供托", "nagashiDealerRepeatRequiresTenpai" to "流满庄家听牌连庄",
    "tsumoLoss" to "三麻自摸损", "kiriageMangan" to "切上满贯", "kazoeYakuman" to "累计役满",
    "compositeYakuman" to "复合役满", "doubleYakuman" to "双倍役满")[key] ?: key
