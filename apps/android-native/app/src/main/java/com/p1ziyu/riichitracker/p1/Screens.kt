package com.p1ziyu.riichitracker.p1

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.headlineMedium.copy(fontFamily = Brand.display), color = Brand.text)
}
@Composable private fun SectionTitle(text: String) {
    Text(text, color = Brand.goldText, style = MaterialTheme.typography.titleLarge.copy(fontFamily = Brand.display))
}
@Composable private fun Caption(text: String) {
    Text(text, color = Brand.muted, style = MaterialTheme.typography.bodySmall)
}
@Composable private fun ErrorText(text: String?) {
    if (text != null) Text(text, color = MaterialTheme.colorScheme.error)
}
@Composable private fun BrandLockup() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        EastTile()
        Column {
            Text("一姬", style = MaterialTheme.typography.headlineMedium.copy(fontFamily = Brand.display), color = Brand.text)
            Text("ICHIHIME", color = Brand.gold, style = MaterialTheme.typography.labelSmall)
        }
    }
}
@Composable private fun ScreenColumn(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState())
        .padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

// ---- Auth (fix10 login mapping retained via chineseMessage) -----------------

@Composable fun AuthScreen(register: Boolean, busy: Boolean, error: String?,
    onSubmit: (String, String, String?) -> Unit, onModeChange: (Boolean) -> Unit,
    onGuest: () -> Unit, onLocal: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState())
        .padding(24.dp), verticalArrangement = Arrangement.Center) {
        BrandLockup()
        Spacer(Modifier.height(24.dp))
        Heading("登录一姬")
        Caption("只记终局得点：开桌、入座、填分、看历史。")
        Spacer(Modifier.height(20.dp))
        BrandPanel(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (register) OutlinedButton(onClick = { onModeChange(false) }, enabled = !busy) { Text("邮箱登录") }
                    else Button(onClick = { onModeChange(false) }, enabled = !busy) { Text("邮箱登录") }
                    if (register) Button(onClick = { onModeChange(true) }, enabled = !busy) { Text("注册账户") }
                    else OutlinedButton(onClick = { onModeChange(true) }, enabled = !busy) { Text("注册账户") }
                }
                val focus = LocalFocusManager.current
                val done = KeyboardActions(onDone = { focus.clearFocus() })
                if (register) OutlinedTextField(name, { name = it }, label = { Text("昵称") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = done)
                OutlinedTextField(email, { email = it }, label = { Text("邮箱") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text("密码") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = done)
                ErrorText(error)
                Button(onClick = { onSubmit(email.trim(), password, if (register) name.trim() else null) },
                    enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank())) {
                    Text(if (busy) "请稍候…" else if (register) "注册并登录" else "登录")
                }
                OutlinedButton(onClick = onGuest, enabled = !busy) { Text("临时访客加入在线牌桌") }
                Caption("访客扫码或输入房间码加入牌桌；访客不能创建牌桌。")
                TextButton(onClick = onLocal, enabled = !busy) { Text("本地无身份模式") }
            }
        }
    }
}

// ---- Lobby / History --------------------------------------------------------

@Composable private fun MatchRow(match: MatchDetail, onOpen: (String) -> Unit) {
    Card(onClick = { onOpen(match.id) }, modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Brand.panel),
        border = BorderStroke(1.dp, Brand.hairline)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            EastTile(Modifier.size(34.dp, 40.dp))
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("${modeLabel(match.mode)} · ${statusLabel(match.status)}",
                    color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                Text("成员 ${match.seatCount} / ${match.expectedCount} 人", color = Brand.text)
                if (match.joinCode != null) Text("房间码：${match.joinCode}", color = Brand.text)
                Caption(localMatchTime(match.createdAt))
                Caption("牌桌编号 · ${match.id}")
            }
        }
    }
}

@Composable fun LobbyScreen(state: AppState, onRefresh: () -> Unit, onOpen: (String) -> Unit,
    onCreate: (String) -> Unit, onJoinCode: (String) -> Unit, onJoinLink: (String) -> Unit,
    onScan: () -> Unit, onAdmin: () -> Unit) {
    var showJoin by remember { mutableStateOf(false) }
    val matches = state.matches?.let(::sortLobby).orEmpty()
    ScreenColumn {
        BrandLockup()
        Text("我的对局", style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Brand.display), color = Brand.text)
        if (state.listLoading) CircularProgressIndicator(color = Brand.gold)
        ErrorText(state.listError)
        OutlinedButton(onClick = onRefresh) { Text("刷新") }
        SectionTitle("开桌")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { onCreate("4p") }, modifier = Modifier.weight(1f), enabled = !state.busy) { Text("开四麻桌") }
            Button(onClick = { onCreate("3p") }, modifier = Modifier.weight(1f), enabled = !state.busy) { Text("开三麻桌") }
        }
        Caption("仅注册用户可开桌；开桌后分享链接、二维码或房间码，等人齐自动分座。")
        SectionTitle("加入")
        Button(onClick = { showJoin = true }, modifier = Modifier.fillMaxWidth()) { Text("加入牌桌") }
        if (state.isAdmin) {
            SectionTitle("管理")
            OutlinedButton(onClick = onAdmin, modifier = Modifier.fillMaxWidth()) { Text("管理入口（管理员）") }
        }
        SectionTitle("进行中置顶 · 最近已结束")
        if (matches.isEmpty() && !state.listLoading) Caption("暂无对局，先开一桌或加入一桌。")
        matches.forEach { MatchRow(it, onOpen) }
        ErrorText(state.actionError)
    }
    if (showJoin) JoinDialog(state, onDismiss = { showJoin = false },
        onJoinCode = { code -> showJoin = false; onJoinCode(code) },
        onJoinLink = { link -> showJoin = false; onJoinLink(link) }, onScan = { showJoin = false; onScan() })
}

@Composable private fun JoinDialog(state: AppState, onDismiss: () -> Unit,
    onJoinCode: (String) -> Unit, onJoinLink: (String) -> Unit, onScan: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var link by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("加入牌桌") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("输房间码、扫码或粘贴链接，进来即成员，不再经过签到页。满员会中文提示，重复进同一桌直接打开。")
            OutlinedTextField(code, { code = it }, label = { Text("六位房间码") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            Button(onClick = { onJoinCode(code) }, enabled = code.isNotBlank()) { Text("用房间码加入") }
            OutlinedTextField(link, { link = it }, label = { Text("粘贴加入链接") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            Button(onClick = { onJoinLink(link) }, enabled = link.isNotBlank()) { Text("用链接加入") }
            OutlinedButton(onClick = onScan) { Text("扫码加入") }
            ErrorText(state.joinError)
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text("取消") } })
}

@Composable fun HistoryScreen(state: AppState, onRefresh: () -> Unit, onOpen: (String) -> Unit) {
    val matches = state.matches?.let(::sortHistory).orEmpty()
    ScreenColumn {
        BrandLockup()
        Heading("历史")
        Caption("只列出你参与的已结束对局。点一行看详情；房主可在详情里纠正终局得点。")
        if (state.listLoading) CircularProgressIndicator(color = Brand.gold)
        ErrorText(state.listError)
        OutlinedButton(onClick = onRefresh) { Text("刷新") }
        if (matches.isEmpty() && !state.listLoading) Caption("暂无已结束对局。")
        matches.forEach { MatchRow(it, onOpen) }
    }
}

// ---- Share / waiting ---------------------------------------------------------

@Composable fun ShareScreen(match: MatchDetail, onRefresh: () -> Unit, onEnter: () -> Unit,
    onBack: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    val link = shareLink(match.id, match.joinCode)
    // Waiting polls: the server seats players automatically once full.
    LaunchedEffect(match.id, match.status) {
        while (match.status == "waiting") { delay(5000); onRefresh() }
    }
    ScreenColumn {
        BrandLockup()
        Heading("分享，等人齐")
        Text("${modeLabel(match.mode)} · 成员 ${match.seatCount} / ${match.expectedCount} 人",
            color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
        Caption("人齐后服务端自动随机分座（东座即庄家），座次锁定，不再抽风、不再调座。")
        SectionTitle("房间码")
        Text(match.joinCode ?: "等待服务端发放", color = Brand.text,
            style = MaterialTheme.typography.headlineMedium)
        SectionTitle("加入链接")
        Text(link, color = Brand.text)
        Button(onClick = { clipboard.setText(AnnotatedString(link)) }) { Text("复制链接") }
        SectionTitle("二维码")
        InvitationQr(link, "加入二维码")
        SectionTitle("成员")
        if (match.members.isEmpty()) Caption("暂无成员信息，点刷新查看。")
        match.members.forEach { member ->
            Text("${member.displayName}${if (member.id == match.host) "（房主）" else ""}", color = Brand.text)
        }
        OutlinedButton(onClick = onRefresh) { Text("刷新成员") }
        if (match.status == "in_progress" || match.status == "finished") {
            Button(onClick = onEnter, modifier = Modifier.fillMaxWidth()) { Text("进入牌桌") }
        } else {
            Caption("还没人齐：分享上方链接、二维码或房间码给同桌。")
        }
        TextButton(onClick = onBack) { Text("返回大厅") }
    }
}

// ---- Online table (in progress / finished, read-only for non-host) -----------

@Composable fun TableScreen(match: MatchDetail, meId: String?, isAdmin: Boolean,
    busy: Boolean, error: String?, onRefresh: () -> Unit, onFinal: () -> Unit,
    onCorrect: () -> Unit, onCancel: () -> Unit, onAdminCorrect: () -> Unit, onBack: () -> Unit) {
    var showCancel by remember { mutableStateOf(false) }
    val host = match.host == meId
    val rows = match.seatRows()
    ScreenColumn {
        BrandLockup()
        Heading("${modeLabel(match.mode)}牌桌")
        Text(statusLabel(match.status), color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
        if (match.joinCode != null) Text("房间码：${match.joinCode}", color = Brand.text)
        SectionTitle("座次")
        if (rows.isEmpty()) Caption("座次尚未分出：等待人齐后服务端自动分座。")
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${row.wind} · ${row.displayName}", color = Brand.text)
                if (row.wind == "东") Text("庄家", color = Brand.goldText)
            }
            HorizontalDivider(color = Brand.hairline)
        }
        if (match.status == "finished" && match.finalScores != null) {
            SectionTitle("终局得点")
            val ranks = computeRanks(match.finalByWind(), windsFor(match.mode))
            match.finalScores.forEach { score ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${score.wind} · ${match.displayNameFor(match.seats.firstOrNull { it.wind == score.wind }?.userId ?: "")}",
                        color = Brand.text)
                    Text("${score.score} · ${rankLabel(score.rank ?: ranks[score.wind])}", color = Brand.text)
                }
            }
            val total = match.finalScores.sumOf { it.score }
            Text("合计 $total / ${totalFor(match.mode)}", color = Brand.goldText)
            if (match.correctedAt != null) Caption("已纠正于 ${localMatchTime(match.correctedAt)}")
        }
        if (match.status == "in_progress") {
            if (host) Button(onClick = onFinal, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text("继续本场：填终局得点") }
            else Caption("只有房主可以填终局得点；你是成员，只读查看。")
            if (host) OutlinedButton(onClick = { showCancel = true }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Brand.loss)) { Text("取消本场") }
        }
        if (match.status == "finished") {
            if (host) Button(onClick = onCorrect, modifier = Modifier.fillMaxWidth()) { Text("纠正终局得点") }
            if (isAdmin) OutlinedButton(onClick = onAdminCorrect, modifier = Modifier.fillMaxWidth()) { Text("管理员纠正") }
            if (!host && !isAdmin) Caption("只有房主可以纠正终局得点。")
        }
        OutlinedButton(onClick = onRefresh) { Text("刷新") }
        ErrorText(error)
        TextButton(onClick = onBack) { Text("返回大厅") }
    }
    if (showCancel) AlertDialog(onDismissRequest = { showCancel = false }, title = { Text("取消本场？") },
        text = { Text("取消后本桌作废，不能再填终局分。确定取消吗？") },
        confirmButton = { Button(onClick = { showCancel = false; onCancel() },
            colors = ButtonDefaults.buttonColors(containerColor = Brand.loss, contentColor = Color.Black)) { Text("确定取消") } },
        dismissButton = { TextButton(onClick = { showCancel = false }) { Text("再想想") } })
}

// ---- Final-score entry: host only, keypad, live total, save gating ----------

private fun applyKey(current: String, key: String): String = when (key) {
    "退格" -> current.dropLast(1)
    "清除" -> ""
    "±" -> if (current.startsWith("-")) current.drop(1) else "-$current"
    else -> {
        if (current == "0") key
        else if (current == "-0") "-$key"
        else if (current.replace("-", "").length >= 4) current
        else current + key
    }
}

@Composable fun FinalScoreScreen(match: MatchDetail, initial: Map<String, String>,
    busy: Boolean, error: String?, correction: Boolean, adminMode: Boolean,
    onSave: (Map<String, String>) -> Unit, onBack: () -> Unit) {
    val winds = windsFor(match.mode)
    var cells by remember { mutableStateOf(winds.associateWith { initial[it].orEmpty() }) }
    var active by remember { mutableStateOf(winds.firstOrNull() ?: "东") }
    val parsed = winds.associateWith { parseScoreCell(cells[it].orEmpty()) }
    val ranks = computeRanks(parsed.filterValues { it != null }.mapValues { it.value!! }, winds)
    val validation = validateFinalScores(cells, match.mode)
    ScreenColumn {
        BrandLockup()
        Heading(if (correction) "纠正终局得点" else "终局记分")
        Caption("${modeLabel(match.mode)} · 每座一行：风、姓名、得点输入、顺位自动显示。单位：实际点数 ÷100，支持负数和 0。")
        if (adminMode) Caption("管理员纠正：座次锁定，只改分数。")
        winds.forEach { wind ->
            val row = match.seatRows().firstOrNull { it.wind == wind }
            val selected = active == wind
            BrandPanel(Modifier.fillMaxWidth().clickable { active = wind }
                .border(if (selected) 2.dp else 0.dp, Brand.gold, RoundedCornerShape(10.dp))) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("$wind · ${row?.displayName ?: "待定"}", color = Brand.goldText,
                            style = MaterialTheme.typography.titleMedium)
                        Text(rankLabel(ranks[wind]), color = Brand.text)
                    }
                    OutlinedTextField(cells[wind].orEmpty(), { value ->
                        cells = cells + (wind to value.filter { it.isDigit() || it == '-' }.take(6))
                        active = wind
                    }, label = { Text("得点（÷100 单位）") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth())
                }
            }
        }
        Text("当前合计 ${validation.sum} / ${totalFor(match.mode)}",
            color = if (validation.saveable) Brand.gain else Brand.loss,
            style = MaterialTheme.typography.titleMedium)
        Text(validation.hint, color = if (validation.saveable) Brand.gain else Brand.loss)
        SectionTitle("数字键盘")
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "退格")
        keys.chunked(3).forEach { rowKeys ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                rowKeys.forEach { key ->
                    OutlinedButton(onClick = { cells = cells + (active to applyKey(cells[active].orEmpty(), key)) },
                        modifier = Modifier.weight(1f)) { Text(key) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TextButton(onClick = { cells = cells + (active to "") }, modifier = Modifier.weight(1f)) { Text("清除本座") }
        }
        Button(onClick = { onSave(cells) }, enabled = validation.saveable && !busy,
            modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "保存中…" else if (correction) "保存纠正" else "保存终局分")
        }
        if (!validation.saveable) Caption("合计不对时保存禁用：请把合计调成 ${totalFor(match.mode)} 再保存。")
        ErrorText(error)
        TextButton(onClick = onBack) { Text("返回") }
    }
}

// ---- Admin -------------------------------------------------------------------

@Composable fun AdminScreen(players: List<AdminPlayerDto>?, matches: List<MatchDetail>?,
    error: String?, busy: Boolean, onRefresh: () -> Unit, onOpen: (String) -> Unit,
    onDelete: (String) -> Unit, onBack: () -> Unit) {
    var pendingDelete by remember { mutableStateOf<String?>(null) }
    ScreenColumn {
        BrandLockup()
        Heading("管理")
        Caption("仅管理员可见：玩家管理与数据管理。")
        OutlinedButton(onClick = onRefresh) { Text("刷新") }
        ErrorText(error)
        SectionTitle("玩家管理")
        if (players.isNullOrEmpty()) Caption("暂无玩家数据。")
        players?.forEach { player ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(player.label, color = Brand.text)
                Text("参与 ${player.matchCount} 桌", color = Brand.muted)
            }
            HorizontalDivider(color = Brand.hairline)
        }
        SectionTitle("数据管理（全部对局）")
        if (matches.isNullOrEmpty()) Caption("暂无对局。")
        matches?.forEach { match ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).clickable { onOpen(match.id) }) {
                    Text("${modeLabel(match.mode)} · ${statusLabel(match.status)}", color = Brand.goldText)
                    Caption("${match.seatCount} / ${match.expectedCount} 人 · ${localMatchTime(match.createdAt)}")
                }
                Button(onClick = { pendingDelete = match.id },
                    colors = ButtonDefaults.buttonColors(containerColor = Brand.loss, contentColor = Color.Black)) {
                    Text("删除")
                }
            }
            HorizontalDivider(color = Brand.hairline)
        }
        TextButton(onClick = onBack) { Text("返回大厅") }
    }
    pendingDelete?.let { id ->
        AlertDialog(onDismissRequest = { pendingDelete = null }, title = { Text("删除这桌？") },
            text = { Text("删除后不可恢复。确定删除吗？") },
            confirmButton = { Button(onClick = { pendingDelete = null; onDelete(id) },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.loss, contentColor = Color.Black)) { Text("确定删除") } },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("取消") } })
    }
}

// ---- Local mode ---------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun LocalScreen(state: LocalUiState, model: AppViewModel, onOpen: (String) -> Unit,
    onCreate: () -> Unit, onOnline: () -> Unit) {
    var showCreate by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { model.reloadLocal() }
    ScreenColumn {
        BrandLockup()
        Heading("本地牌桌")
        Caption("离线完整可用：本机建桌输名字、选模式，直接随机分座；本机房主填终局分。本地不设加入、分享与管理。")
        Button(onClick = { showCreate = true }, modifier = Modifier.fillMaxWidth()) { Text("本地建桌") }
        ErrorText(state.error)
        if (state.loading) CircularProgressIndicator(color = Brand.gold)
        SectionTitle("进行中")
        state.matches.filter { it.status == "in_progress" }.forEach { match ->
            LocalRow(match, onOpen, onDelete = { model.deleteLocal(match.id) })
        }
        SectionTitle("本地历史")
        state.matches.filter { it.status != "in_progress" }.forEach { match ->
            LocalRow(match, onOpen, onDelete = { model.deleteLocal(match.id) })
        }
        if (state.matches.isEmpty() && !state.loading) Caption("暂无本地桌。")
        TextButton(onClick = onOnline) { Text("进入在线登录") }
    }
    if (showCreate) LocalCreateDialog(onDismiss = { showCreate = false },
        onCreate = { mode, names -> showCreate = false; model.createLocal(mode, names) })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun LocalRow(match: LocalFinalMatch, onOpen: (String) -> Unit, onDelete: () -> Unit) {
    val dismiss = rememberSwipeToDismissBoxState()
    if (dismiss.currentValue == SwipeToDismissBoxValue.EndToStart) {
        LaunchedEffect(match.id) { onDelete() }
    }
    SwipeToDismissBox(state = dismiss, enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(Modifier.fillMaxSize().background(Color(0xFF8B1E1E)), contentAlignment = Alignment.CenterEnd) {
                Text("删除", color = Color.White, modifier = Modifier.padding(end = 20.dp))
            }
        }) {
        Card(onClick = { onOpen(match.id) }, modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Brand.panel),
            border = BorderStroke(1.dp, Brand.hairline)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("${modeLabel(match.mode)} · ${if (match.status == "in_progress") "进行中" else if (match.status == "finished") "已结束" else "已取消"}",
                    color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                Text(match.seats.joinToString(" ") { "${it.wind}${it.name}" }, color = Brand.text)
                if (match.finalScores != null) {
                    Text(match.finalScores.joinToString(" ") { "${it.wind}${it.score}" }, color = Brand.text)
                    Text("合计 ${match.finalScores.sumOf { it.score }} / ${match.total}", color = Brand.goldText)
                }
                Caption("左滑删除 · ${localMatchTime(match.createdAt)}")
            }
        }
    }
}

@Composable private fun LocalCreateDialog(onDismiss: () -> Unit, onCreate: (String, List<String>) -> Unit) {
    var mode by remember { mutableStateOf("4p") }
    val count = if (mode == "3p") 3 else 4
    var names by remember { mutableStateOf(List(4) { "" }) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("本地建桌") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (mode == "4p") Button(onClick = { mode = "4p" }) { Text("四麻") }
                else OutlinedButton(onClick = { mode = "4p" }) { Text("四麻") }
                if (mode == "3p") Button(onClick = { mode = "3p" }) { Text("三麻") }
                else OutlinedButton(onClick = { mode = "3p" }) { Text("三麻") }
            }
            Text("输入 $count 个名字，建桌即随机分座（东座即庄家）。")
            (0 until count).forEach { i ->
                OutlinedTextField(names[i], { value ->
                    names = names.toMutableList().also { it[i] = value } }, label = { Text("玩家 ${i + 1}") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            ErrorText(error)
        }
    }, confirmButton = {
        Button(onClick = {
            val taken = names.take(count)
            if (taken.any { it.isBlank() }) { error = "请填完 $count 个名字。"; return@Button }
            if (taken.map { it.trim() }.distinct().size != count) { error = "玩家姓名不能重复。"; return@Button }
            onCreate(mode, taken)
        }) { Text("建桌并分座") }
    }, dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } })
}

@Composable fun LocalDetailScreen(match: LocalFinalMatch, error: String?,
    onFinal: () -> Unit, onCancel: () -> Unit, onBack: () -> Unit) {
    var showCancel by remember { mutableStateOf(false) }
    ScreenColumn {
        BrandLockup()
        Heading("本地${modeLabel(match.mode)}牌桌")
        SectionTitle("座次")
        match.seats.forEach { seat ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${seat.wind} · ${seat.name}", color = Brand.text)
                if (seat.wind == "东") Text("庄家", color = Brand.goldText)
            }
            HorizontalDivider(color = Brand.hairline)
        }
        if (match.finalScores != null) {
            SectionTitle("终局得点")
            match.finalScores.forEach { score ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${score.wind} · ${match.seats.firstOrNull { it.wind == score.wind }?.name}", color = Brand.text)
                    Text("${score.score} · ${rankLabel(score.rank)}", color = Brand.text)
                }
            }
            Text("合计 ${match.finalScores.sumOf { it.score }} / ${match.total}", color = Brand.goldText)
            if (match.correctedAt != null) Caption("已纠正于 ${localMatchTime(match.correctedAt)}")
        }
        if (match.status == "in_progress") {
            Button(onClick = onFinal, modifier = Modifier.fillMaxWidth()) { Text("填终局得点") }
            OutlinedButton(onClick = { showCancel = true }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Brand.loss)) { Text("取消本场") }
        }
        if (match.status == "finished") {
            Button(onClick = onFinal, modifier = Modifier.fillMaxWidth()) { Text("纠正终局得点") }
        }
        ErrorText(error)
        TextButton(onClick = onBack) { Text("返回本地") }
    }
    if (showCancel) AlertDialog(onDismissRequest = { showCancel = false }, title = { Text("取消本场？") },
        text = { Text("取消后本桌作废，不能再填终局分。确定取消吗？") },
        confirmButton = { Button(onClick = { showCancel = false; onCancel() },
            colors = ButtonDefaults.buttonColors(containerColor = Brand.loss, contentColor = Color.Black)) { Text("确定取消") } },
        dismissButton = { TextButton(onClick = { showCancel = false }) { Text("再想想") } })
}

@Composable fun LocalFinalScreen(match: LocalFinalMatch, error: String?,
    onSave: (Map<String, String>) -> Unit, onBack: () -> Unit) {
    val winds = windsFor(match.mode)
    var cells by remember { mutableStateOf(winds.associateWith { localFinalCells(match)[it].orEmpty() }) }
    var active by remember { mutableStateOf(winds.firstOrNull() ?: "东") }
    val parsed = winds.associateWith { parseScoreCell(cells[it].orEmpty()) }
    val ranks = computeRanks(parsed.filterValues { it != null }.mapValues { it.value!! }, winds)
    val validation = validateFinalScores(cells, match.mode)
    val correction = match.status == "finished"
    ScreenColumn {
        BrandLockup()
        Heading(if (correction) "纠正本地终局分" else "本地终局记分")
        Caption("${modeLabel(match.mode)} · 单位：实际点数 ÷100，支持负数和 0。座次锁定，只改分数。")
        winds.forEach { wind ->
            val seat = match.seats.firstOrNull { it.wind == wind }
            BrandPanel(Modifier.fillMaxWidth().clickable { active = wind }
                .border(if (active == wind) 2.dp else 0.dp, Brand.gold, RoundedCornerShape(10.dp))) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("$wind · ${seat?.name}", color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                        Text(rankLabel(ranks[wind]), color = Brand.text)
                    }
                    OutlinedTextField(cells[wind].orEmpty(), { value ->
                        cells = cells + (wind to value.filter { it.isDigit() || it == '-' }.take(6))
                        active = wind
                    }, label = { Text("得点（÷100 单位）") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth())
                }
            }
        }
        Text("当前合计 ${validation.sum} / ${match.total}",
            color = if (validation.saveable) Brand.gain else Brand.loss,
            style = MaterialTheme.typography.titleMedium)
        Text(validation.hint, color = if (validation.saveable) Brand.gain else Brand.loss)
        SectionTitle("数字键盘")
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "退格").chunked(3).forEach { rowKeys ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                rowKeys.forEach { key ->
                    OutlinedButton(onClick = { cells = cells + (active to applyKey(cells[active].orEmpty(), key)) },
                        modifier = Modifier.weight(1f)) { Text(key) }
                }
            }
        }
        Button(onClick = { onSave(cells) }, enabled = validation.saveable, modifier = Modifier.fillMaxWidth()) {
            Text(if (correction) "保存纠正" else "保存终局分")
        }
        if (!validation.saveable) Caption("合计不对时保存禁用：请把合计调成 ${match.total} 再保存。")
        ErrorText(error)
        TextButton(onClick = onBack) { Text("返回") }
    }
}

@Composable fun ProfileScreen(profile: MeResponse?, error: String?, onLogout: () -> Unit,
    onLocal: () -> Unit, onRefresh: () -> Unit) {
    ScreenColumn {
        BrandLockup()
        Heading("我的")
        if (profile != null) {
            Text(profile.principal.displayName, color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
            Caption("账号类型：${if (profile.principal.type == "guest") "临时访客" else "注册账户"}")
            if (profile.isAdmin) Caption("管理员账号")
        }
        ErrorText(error)
        OutlinedButton(onClick = onRefresh) { Text("刷新资料") }
        Button(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("退出登录") }
        TextButton(onClick = onLocal) { Text("本地无身份模式") }
    }
}

@Composable fun ScanScreen(onFound: (String) -> Unit, onBack: () -> Unit) {
    ScreenColumn {
        BrandLockup()
        Heading("扫码加入")
        Caption("把二维码对准相机；识别到加入链接后直接进桌。")
        CheckInScanner(accept = { parseJoinLink(it) != null }, onFound = onFound)
        TextButton(onClick = onBack) { Text("返回") }
    }
}
