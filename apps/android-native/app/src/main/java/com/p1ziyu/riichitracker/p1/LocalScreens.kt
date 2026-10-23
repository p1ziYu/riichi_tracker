package com.p1ziyu.riichitracker.p1

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable fun LocalContent(state: LocalUiState, model: LocalViewModel, onOnline: () -> Unit) {
    var route by remember { mutableStateOf("lobby") }
    val selected = state.match
    LaunchedEffect(state.createdId) {
        state.createdId?.let { id -> route = "table"; model.open(id); model.clearCreated() }
    }
    BackHandler(route != "lobby") {
        if (route == "table") model.close()
        route = "lobby"
    }
    when (route) {
        "create" -> CreateScreen(LOCAL_TEMPLATES.map(::localTemplateDto), state.busy, state.error,
            onCreate = {}, onBack = { route = "lobby" }, onCreateLocal = model::create)
        "table" -> LocalTableScreen(state, model, onBack = { model.close(); route = "lobby" })
        else -> LocalListScreen(state, model, route == "history", onCreate = { route = "create" },
            onHistory = { route = "history" }, onLobby = { route = "lobby" },
            onOpen = { id -> route = "table"; model.open(id) }, onOnline = onOnline)
    }
}

@Composable private fun LocalListScreen(state: LocalUiState, model: LocalViewModel, history: Boolean,
    onCreate: () -> Unit, onHistory: () -> Unit, onLobby: () -> Unit,
    onOpen: (String) -> Unit, onOnline: () -> Unit) {
    var deleting by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val matches = if (history) state.matches.filter { it.status == "finished" } else state.matches.filter { it.status == "active" }
    Column(Modifier.fillMaxSize().background(Brand.background).padding(16.dp)) {
        Text(if (history) "本地战绩" else "本地牌桌", style = MaterialTheme.typography.headlineMedium, color = Brand.goldText)
        Text("仅存于此设备 · 无账户、访客身份或云端同步", color = Brand.muted)
        Row {
            TextButton(onClick = onLobby) { Text("继续对局") }
            TextButton(onClick = onHistory) { Text("已结束 · ${state.matches.count { it.status == "finished" }}") }
        }
        Row {
            Button(onClick = onCreate) { Text("本地开桌") }
            TextButton(onClick = onOnline) { Text("进入在线登录") }
        }
        if (state.loading) CircularProgressIndicator()
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = model::reload) { Text("重试读取（不清除数据）") } }
        if (!state.loading && state.error == null && matches.isEmpty()) Text("暂无本地牌局", color = Brand.muted)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(matches, key = { it.id }) { match ->
                BrandPanel(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(match.name, color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
                        Text("${match.templateName} · ${reviewLabel(match.reviewStatus)} · ${match.seats.size} 麻", color = Brand.text)
                        val changes = remember(match.rules, match.seedKey) { match.customizedRules() }
                        Text("自定义：${if (changes.isEmpty()) "无（按模板）" else changes.joinToString("、")}", color = Brand.muted)
                        Text("${if (match.status == "active") "进行中" else "已结束"} · ${localMatchTime(match.updatedAt)} · ${match.results.size} 局", color = Brand.muted)
                        TextButton(onClick = { onOpen(match.id) }) { Text(if (history) "查看结算与历史" else "继续对局") }
                        OutlinedButton(onClick = { deleting = match.id; confirmDelete = false }, enabled = !state.busy) { Text("删除整桌") }
                    }
                }
            }
        }
    }
    deleting?.let { id ->
        AlertDialog(onDismissRequest = { deleting = null; confirmDelete = false },
            title = { Text(if (confirmDelete) "最后确认永久删除？" else "删除本地整桌？") },
            text = { Text("这将永久删除整桌、所有已结算历史及最终成绩，不可恢复。") },
            confirmButton = { TextButton(onClick = {
                if (confirmDelete) { model.delete(id); deleting = null; confirmDelete = false }
                else confirmDelete = true
            }, enabled = !state.busy) { Text(if (confirmDelete) "永久删除" else "继续确认") } },
            dismissButton = { TextButton(onClick = { deleting = null; confirmDelete = false }) { Text("取消") } })
    }
}

private fun LocalMatch.asTable(): TableSnapshot = TableSnapshot(
    MatchDto(id, if (status == "active") "in_progress" else "finished", seats.size,
        rulesSnapshot = rules, createdAt = createdAt, settlementConfirmed = settlementConfirmed),
    seats.mapIndexed { seatNo, name -> SeatDto(seatNo, name, points[seatNo], "checked_in") },
    currentHand?.let { hand -> CurrentHandDto(hand.handId, hand.roundWind, hand.roundNumber,
        hand.dealerSeatNo, hand.honba, hand.riichiPool, hand.markRevision, "open",
        hand.seats.map { HandSeatDto(it.seatNo, it.isRiichi, it.points, it.usage) }) })

@Composable private fun LocalTableScreen(state: LocalUiState, model: LocalViewModel, onBack: () -> Unit) {
    val match = state.match
    var showResult by remember(match?.id) { mutableStateOf(false) }
    var finishStage by remember(match?.id) { mutableIntStateOf(0) }
    var editingSeat by remember(match?.id) { mutableStateOf<Int?>(null) }
    var newName by remember(match?.id) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = onBack) { Text("← 本地牌桌") }
        if (state.loading) CircularProgressIndicator()
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (match != null && state.error != null)
            TextButton(onClick = { model.open(match.id) }, enabled = !state.busy) { Text("重新读取本地牌桌") }
        if (match == null) return@Column
        Text(match.name, color = Brand.goldText, style = MaterialTheme.typography.headlineMedium)
        Text("${match.templateName} · ${reviewLabel(match.reviewStatus)} · ${if (match.status == "active") "进行中" else "已结束"}", color = Brand.text)
        val changes = remember(match.rules, match.seedKey) { match.customizedRules() }
        Text("来源：随包模板 · 自定义：${if (changes.isEmpty()) "无（按模板）" else changes.joinToString("、")}", color = Brand.muted)
        Text("引擎 ${match.engineVersion} · ${match.seats.size} 麻 · 创建 ${localMatchTime(match.createdAt)}", color = Brand.muted)
        match.seats.forEachIndexed { seat, name ->
            BrandPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("${seat + 1}号位 · $name · ${match.points[seat]} 点", color = Brand.text)
                    TextButton(onClick = { editingSeat = seat; newName = name }, enabled = !state.busy &&
                        match.status == "active" &&
                        match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) { Text("修改姓名") }
                }
            }
        }
        match.currentHand?.let { hand ->
            Text("${windLabel(hand.roundWind)} ${hand.roundNumber} 局 · 庄 ${hand.dealerSeatNo + 1}号位 · 本场 ${hand.honba} · 供托 ${hand.riichiPool} 点 / ${poolSticks(hand.riichiPool)} 根", color = Brand.goldText)
            hand.seats.forEach { seat ->
                Text("${match.seats[seat.seatNo]} · ${seat.points} 点 · ${if (seat.isRiichi) "已立直" else "未立直"} · 宣言 ${seat.usage.declares}/2 · 取消 ${seat.usage.cancels}/1", color = Brand.text)
                val canMark = if (seat.isRiichi) seat.usage.cancels < 1 else seat.usage.declares < 2 &&
                    (seat.points >= 1000 || match.rules["allowLowPointRiichi"]?.let { it.toString() == "true" } == true)
                OutlinedButton(onClick = { model.mark(seat.seatNo) }, enabled = !state.busy && canMark &&
                    match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) {
                    Text(if (seat.isRiichi) "取消立直" else "声明立直")
                }
            }
            Button(onClick = { showResult = true }, enabled = !state.busy &&
                match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) { Text("录入本局结果") }
        }
        if (match.status == "active") {
            if (match.currentHand == null) Button(onClick = model::nextHand, enabled = !state.busy &&
                match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) { Text("新开一局") }
            if (match.rules["automaticEndPolicy"]?.toString()?.trim('"') != "ranked_sanma")
                OutlinedButton(onClick = { finishStage = 1 }, enabled = !state.busy &&
                    match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) { Text("终局${if (match.currentHand != null) " · 放弃未结算当前局" else ""}") }
        } else {
            Text("终局${if (match.settlementConfirmed) " · 已确认" else " · 待确认"}", color = Brand.goldText)
            Button(onClick = model::previewTerminal, enabled = !state.busy &&
                match.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) { Text("预览终局成绩") }
            (match.terminal ?: state.terminal)?.let { terminal ->
                Text("终局：${terminal.gameEndReason} · 遗留供托 ${terminal.unclaimedRiichiPoints} 点 · " +
                    "领取座位 ${terminal.poolRecipientSeatNo?.plus(1) ?: "未分配"}", color = Brand.muted)
                terminal.standings.forEach { seat ->
                    Text("第 ${seat.rank} 名 · ${match.seats[seat.seatNo]} · ${seat.finalPoints} 点 · 总成绩 ${seat.totalTenths / 10.0}", color = Brand.text)
                }
            }
            if (!match.settlementConfirmed && state.terminal != null)
                Button(onClick = model::confirmTerminal, enabled = !state.busy) { Text("确认并保存终局成绩") }
        }
        Text("已结算历史 · ${match.results.size} 局（只读，完整保存的输入、支付及局前状态）", color = Brand.goldText)
        match.results.forEachIndexed { index, result ->
            BrandPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("第 ${index + 1} 局 · ${windLabel(result.hand.roundWind)}${result.hand.roundNumber} · ${handKindLabel(result.input.getValue("kind").toString().trim('"'))}", color = Brand.goldText)
                    Text("庄 ${result.hand.dealerSeatNo + 1} · 本场 ${result.hand.honba} · 供托 ${result.hand.riichiPool}点 · ${localMatchTime(result.settledAt)}", color = Brand.muted)
                    result.hand.seats.forEach { seat -> Text("${seat.seatNo + 1}号位局前 ${seat.points} 点 · ${if (seat.isRiichi) "立直" else "未立直"}", color = Brand.text) }
                    Text("录入：${result.input}", color = Brand.muted)
                    result.output.perSeat.forEach { payment ->
                        Text("${payment.seatNo + 1}号位 ${if (payment.netPoints >= 0) "+" else ""}${payment.netPoints} 点 · ${payment.breakdown.joinToString(" / ") { "${it.reason} ${it.amount}" }}", color = Brand.text)
                    }
                    val next = result.output.nextHand
                    Text("下一局 ${windLabel(next.roundWind)}${next.roundNumber} · 庄 ${next.dealerSeatNo + 1} · 本场 ${next.honba} · 供托 ${next.riichiPool}点", color = Brand.goldText)
                }
            }
        }
    }
    if (match != null && finishStage != 0) AlertDialog(onDismissRequest = { finishStage = 0 },
        title = { Text(if (finishStage == 1) "结束本地牌局？" else "再次确认放弃当前局？") },
        text = { Text(if (match.currentHand != null) "当前未结算局（包括立直标记）将放弃，已结算局与供托不受影响。终局须满足规则。" else "已结算局不会删除；终局须满足规则。") },
        confirmButton = { TextButton(onClick = {
            if (finishStage == 1) finishStage = 2 else { finishStage = 0; model.finish() }
        }, enabled = !state.busy) { Text(if (finishStage == 1) "继续确认" else "确认终局") } },
        dismissButton = { TextButton(onClick = { finishStage = 0 }) { Text("取消") } })
    if (match != null) editingSeat?.let { seat ->
        AlertDialog(onDismissRequest = { editingSeat = null }, title = { Text("修改 ${seat + 1} 号位姓名") },
            text = { OutlinedTextField(newName, { if (it.length <= 40) newName = it }, label = { Text("1–40 字") }) },
            confirmButton = { TextButton(onClick = { model.rename(seat, newName); editingSeat = null }, enabled = !state.busy && newName.isNotBlank()) { Text("保存") } },
            dismissButton = { TextButton(onClick = { editingSeat = null }) { Text("取消") } })
    }
    val hand = match?.currentHand
    if (match != null && hand != null && showResult && match.status == "active") {
        val table = match.asTable()
        val current = requireNotNull(table.currentHand)
        val draft = match.draft?.let { SavedResultDraft("local", match.id, hand.handId, hand.markRevision, it) }
        val editorState = AppState(session = SessionMode.LOCAL_ONLY, draft = draft, preview = state.preview,
            busy = state.busy, actionError = state.error)
        ResultEditor(match.id, table, current, editorState, model::saveDraft, model::preview, model::settle) { showResult = false }
    }
}
