package com.p1ziyu.riichitracker.p1

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

private val groups = linkedMapOf(
    "起点与成绩" to listOf("startingPoints", "returnPoints", "targetPoints", "uma"),
    "终局策略" to listOf("fixedSouth4EndPolicy", "automaticEndPolicy", "bustEndsGame", "terminalRiichiPoolPolicy", "tiedUmaPolicy"),
    "支付数值" to listOf("notenPenaltyTotal", "honbaRon", "honbaPerPayer"),
    "多荣与立直" to listOf("multiRon", "doubleRonHonbaPolicy", "allowLowPointRiichi"),
    "流满与三麻" to listOf("nagashiManganEnabled", "nagashiCollectsRiichiPool", "nagashiDealerRepeatRequiresTenpai", "tsumoLoss"),
    "番数与役满" to listOf("kiriageMangan", "kazoeYakuman", "compositeYakuman", "doubleYakuman"),
)
private val options = mapOf(
    "fixedSouth4EndPolicy" to listOf("completed_south_4" to "打完南四局", "target_or_bust" to "目标点或飞人"),
    "automaticEndPolicy" to listOf("manual" to "手动终局", "ranked_sanma" to "三麻段位自动终局"),
    "terminalRiichiPoolPolicy" to listOf("first" to "首位领取", "unallocated" to "不分配"),
    "tiedUmaPolicy" to listOf("seat_order" to "按起家座次", "split" to "均分"),
    "multiRon" to listOf("head_bump" to "头跳", "double_ron" to "双响", "allow_all" to "允许全部"),
    "doubleRonHonbaPolicy" to listOf("nearest_only" to "最近一家", "each_winner" to "每位赢家"),
)
private val presets = mapOf("startingPoints" to listOf(25000, 30000, 35000),
    "returnPoints" to listOf(30000, 40000), "targetPoints" to listOf(30000, 40000),
    "honbaPerPayer" to listOf(100, 200))

@Composable
fun CreateScreen(templates: List<TemplateDto>, busy: Boolean, serverError: String?,
                 onCreate: (OnlineRules) -> Unit, onBack: () -> Unit,
                 onCreateLocal: ((OnlineRules, String, List<String>, Int) -> Unit)? = null) {
    var selected by remember { mutableStateOf<OnlineRules?>(null) }
    var step by remember { mutableIntStateOf(0) }
    var changeWarning by remember { mutableStateOf<TemplateDto?>(null) }
    var expanded by remember { mutableStateOf(true) }
    var editVersion by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var localName by remember { mutableStateOf("") }
    var playerNames by remember { mutableStateOf(List(4) { "" }) }
    var dealer by remember { mutableIntStateOf(0) }
    val rules = selected
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("开桌 · ${step + 1}/3", color = Brand.goldText, style = MaterialTheme.typography.headlineMedium)
        if (serverError != null) Text(serverError, color = MaterialTheme.colorScheme.error)
        if (step == 0 || rules == null) {
            Text("选择规则模板 · 切换模板将丢弃之前的调整", color = Brand.text)
            if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            templates.filter { it.scope == "system" }.forEach { template ->
                OutlinedButton(onClick = {
                    if (rules != null && rules.template.versionId != template.versionId && rules.changed > 0)
                        changeWarning = template
                    else {
                        try { selected = OnlineRules(template); step = 1; error = null }
                        catch (e: Exception) { error = e.message }
                    }
                }, modifier = Modifier.fillMaxWidth()) {
                    Text("${template.name} · ${template.kind ?: "规则"} · ${reviewLabel(template.reviewStatus)}", softWrap = true)
                }
            }
            if (templates.isEmpty()) Text("尚未取得服务端模板，请返回大厅刷新", color = Brand.text)
        } else {
            Text("基于〈${rules.template.name}〉 · ${sourceLabel(rules.template.scope)} · ${reviewLabel(rules.template.reviewStatus)}", color = Brand.text)
            if (step == 1) {
                OutlinedButton(onClick = { expanded = !expanded }) { Text("规则调整 · ${if (error != null) "请检查输入" else "已自定义 ${runCatching { rules.changed }.getOrDefault(0)} 项"}") }
                if (expanded) {
                    OutlinedButton(onClick = { rules.reset(); editVersion++; error = null }) { Text("恢复模板默认规则") }
                    Text("人数与立直棒固定。头名赏由起始点和返还点推导。", color = Brand.muted)
                    key(editVersion) {
                        groups.forEach { (title, keys) ->
                            Text(title, color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                            keys.filterNot { it == "tsumoLoss" && rules.playerCount != 3 ||
                                it == "doubleRonHonbaPolicy" && rules.values["multiRon"] == "head_bump" }.forEach { field ->
                                if (field == "uma") {
                                    val umaPresets = if (rules.playerCount == 3)
                                        listOf(listOf(20.0, 0.0, -20.0), listOf(30.0, 0.0, -30.0), listOf(10.0, 0.0, -10.0), List(3) { 0.0 })
                                    else listOf(listOf(20.0, 10.0, -10.0, -20.0), listOf(15.0, 5.0, -5.0, -15.0),
                                        listOf(30.0, 10.0, -10.0, -30.0), listOf(10.0, 5.0, -5.0, -10.0), List(4) { 0.0 })
                                    umaPresets.forEach { preset -> TextButton(onClick = { rules.setUma(preset); editVersion++ }) {
                                        Text(if (preset.all { it == 0.0 }) "无马点" else preset.joinToString(" / "))
                                    } }
                                    repeat(rules.playerCount) { index ->
                                        RuleNumber("第${index + 1}位马点（十分位）", rules.values["uma.$index"]
                                            ?: (rules.base["uma"] as JsonArray)[index].jsonPrimitive.content) {
                                            rules.update("uma.$index", it)
                                        }
                                    }
                                } else {
                                    val value = rules.values[field].orEmpty()
                                    val choices = options[field]?.filterNot { rules.playerCount == 4 && it.first == "ranked_sanma" ||
                                        rules.playerCount == 3 && it.first == "completed_south_4" }
                                    if (choices != null) {
                                        Text(ruleLabel(field), color = Brand.text)
                                        choices.forEach { (option, label) ->
                                            OutlinedButton(onClick = { rules.update(field, option) },
                                                modifier = Modifier.fillMaxWidth()) { Text("${if (option == value) "●" else "○"} $label") }
                                        }
                                    } else if ((rules.base[field] as? JsonPrimitive)?.booleanOrNull != null) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(ruleLabel(field), color = Brand.text, modifier = Modifier.weight(1f))
                                            Switch(checked = value == "true", onCheckedChange = { rules.update(field, it.toString()) })
                                        }
                                    } else {
                                        RuleNumber(ruleLabel(field), value) { rules.update(field, it) }
                                        (if (field == "notenPenaltyTotal") if (rules.playerCount == 3) listOf(0, 2000, 3000) else listOf(0, 3000)
                                            else if (field == "honbaRon") if (rules.playerCount == 3) listOf(200, 400) else listOf(300, 600)
                                            else presets[field].orEmpty()).forEach { point ->
                                            TextButton(onClick = { rules.update(field, point.toString()); editVersion++ }) { Text("$point") }
                                        }
                                        if (field == "notenPenaltyTotal") Text("1,500 点不可选：无法按听牌人数逐笔整百结算", color = Brand.muted)
                                    }
                                }
                            }
                            if (title == "多荣与立直" && rules.values["multiRon"] != "head_bump")
                                Text("供托固定由距离放铳者最近的有效赢家领取；本场分配可选。", color = Brand.muted)
                        }
                    }
                }
                val points = rules.values["startingPoints"]?.toIntOrNull()
                val returns = rules.values["returnPoints"]?.toIntOrNull()
                Text("头名赏（只读）：${if (points != null && returns != null) (returns - points) * rules.playerCount / 1000.0 else "输入无效"}", color = Brand.text)
                val evaluated = remember(rules, rules.values) {
                    runCatching { rules.validated(); rules.examples() }
                }
                evaluated.onSuccess { examples -> examples.forEach { (title, output) ->
                    BrandPanel(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
                        Text(title, color = Brand.goldText)
                        output.perSeat.forEach { seat ->
                            Text("${seat.seatNo + 1} 号位 ${if (seat.netPoints >= 0) "+" else ""}${seat.netPoints} 点", color = Brand.text)
                            Text(seat.breakdown.joinToString(" · ") { "${it.reason} ${it.amount}" }, color = Brand.muted)
                        }
                        Text("下一局：${windLabel(output.nextHand.roundWind)}${output.nextHand.roundNumber} · 庄 ${output.nextHand.dealerSeatNo + 1} · 本场 ${output.nextHand.honba} · 供托 ${output.nextHand.riichiPool} 点", color = Brand.goldText)
                    } }
                } }.onFailure { Text("规则或支付预览不可用：${it.message}", color = MaterialTheme.colorScheme.error) }
                val validationError = evaluated.exceptionOrNull()?.message
                Button(onClick = { step = 2 }, enabled = validationError == null) { Text("确认规则 →") }
            } else {
                Text(if (onCreateLocal == null) "规则仅调整此桌；提交后服务端冻结规则快照。" else "规则仅调整此桌；创建后保存完整本地规则快照。", color = Brand.text)
                Text("已自定义 ${rules.changed} 项 · ${rules.playerCount} 麻", color = Brand.text)
                if (onCreateLocal != null) {
                    OutlinedTextField(localName, { localName = it }, label = { Text("牌桌名称") }, modifier = Modifier.fillMaxWidth())
                    repeat(rules.playerCount) { seat ->
                        OutlinedTextField(playerNames[seat], { value ->
                            if (value.length <= 40) playerNames = playerNames.toMutableList().also { it[seat] = value }
                        }, label = { Text("${seat + 1}号位玩家（最多 40 字）") }, modifier = Modifier.fillMaxWidth())
                        OutlinedButton(onClick = { dealer = seat }) { Text("${if (dealer == seat) "●" else "○"} 指定 ${seat + 1}号位起家") }
                    }
                    Button(onClick = { onCreateLocal(rules, localName.trim(), playerNames.take(rules.playerCount), dealer) },
                        enabled = !busy && localName.isNotBlank() && runCatching { rules.validated() }.isSuccess) {
                        Text(if (busy) "正在创建…" else "创建本地牌桌并开首局")
                    }
                    Text("仅保存在此设备；没有身份、签到或云端同步。", color = Brand.muted)
                } else {
                    Button(onClick = { onCreate(rules) }, enabled = !busy && runCatching { rules.validated() }.isSuccess) { Text(if (busy) "正在创建…" else "创建在线牌桌") }
                    Text("创建后桌主先选座；其他玩家可用房间码或链接直接选座签到，座位齐备后确认开局。", color = Brand.muted)
                }
            }
            OutlinedButton(onClick = { step = if (step == 2) 1 else 0 }) { Text("返回上一步") }
        }
        OutlinedButton(onClick = onBack) { Text("退出开桌") }
    }
    changeWarning?.let { template -> AlertDialog(onDismissRequest = { changeWarning = null },
        title = { Text("切换规则模板？") }, text = { Text("当前调整将丢弃；新模板重新载入默认值。") },
        confirmButton = { TextButton(onClick = {
            changeWarning = null
            try { selected = OnlineRules(template); step = 1; error = null }
            catch (e: Exception) { error = e.message }
        }) { Text("丢弃并切换") } },
        dismissButton = { TextButton(onClick = { changeWarning = null }) { Text("保留当前") } }) }
}

@Composable private fun RuleNumber(label: String, value: String, update: (String) -> Unit) {
    OutlinedTextField(value, update, modifier = Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = true)
}
