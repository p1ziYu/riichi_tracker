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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.headlineMedium.copy(fontFamily = Brand.display), color = Brand.text)
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, color = Brand.goldText, style = MaterialTheme.typography.titleLarge.copy(fontFamily = Brand.display))
}

@Composable
private fun Caption(text: String) {
    Text(text, color = Brand.muted, style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun BrandLockup() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        EastTile()
        Column {
            Text("一姬", style = MaterialTheme.typography.headlineMedium.copy(fontFamily = Brand.display), color = Brand.text)
            Text("ICHIHIME", color = Brand.gold, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun AuthScreen(
    register: Boolean,
    busy: Boolean,
    error: String?,
    onSubmit: (email: String, password: String, name: String?) -> Unit,
    onModeChange: (Boolean) -> Unit,
    onGuest: () -> Unit,
    onLocal: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center) {
        BrandLockup()
        Spacer(Modifier.height(24.dp))
        Heading("登录一姬")
        Caption("从规则到结算，给同桌每一分一个清楚的去处。")
        Spacer(Modifier.height(20.dp))
        BrandPanel(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (register) OutlinedButton(onClick = { onModeChange(false) }, enabled = !busy) { Text("邮箱登录") }
                    else Button(onClick = { onModeChange(false) }, enabled = !busy) { Text("邮箱登录") }
                    if (register) Button(onClick = { onModeChange(true) }, enabled = !busy) { Text("注册账户") }
                    else OutlinedButton(onClick = { onModeChange(true) }, enabled = !busy) { Text("注册账户") }
                }
                // iosfix6 item 4: Done on the last field dismisses the IME.
                val authFocus = LocalFocusManager.current
                val authDone = KeyboardActions(onDone = { authFocus.clearFocus() })
                if (register) OutlinedTextField(name, { name = it }, label = { Text("昵称") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = authDone)
                OutlinedTextField(email, { email = it }, label = { Text("邮箱") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text("密码") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = authDone)
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
                Button(onClick = { onSubmit(email.trim(), password, if (register) name.trim() else null) },
                    enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank())) {
                    Text(if (busy) "请稍候…" else if (register) "注册并登录" else "登录")
                }
                OutlinedButton(onClick = onGuest, enabled = !busy) { Text("临时访客加入在线牌桌") }
                Caption("访客扫码或输入房间码加入牌桌，等待房主抽风定座；访客不能创建牌桌。")
                TextButton(onClick = onLocal, enabled = !busy) { Text("本地无身份模式") }
            }
        }
    }
}

@Composable
private fun RuleInfo(snapshot: JsonObject?, templates: List<TemplateDto>, versionId: String?) {
    val details = ruleDetails(snapshot, templates.firstOrNull { it.versionId == versionId })
    Caption("规则：${details.title}")
    Caption("来源：${sourceLabel(details.source)} · 审核：${reviewLabel(details.reviewStatus)}")
    Caption("自定义：${if (details.customizedKeys.isEmpty()) "无（按模板）" else details.customizedKeys.map(::customRuleLabel).distinct().joinToString("、")}")
}

@Composable
private fun MatchRow(match: MatchSummary, templates: List<TemplateDto>, onOpen: (String) -> Unit) {
    val title = ruleDetails(match.rulesSnapshot, templates.firstOrNull { it.versionId == match.rulesetVersionId }).title
    Card(onClick = { onOpen(match.id) }, modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Brand.panel),
        border = BorderStroke(1.dp, Brand.hairline)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            EastTile(Modifier.size(34.dp, 40.dp))
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                Text("${matchStatusLabel(match.status)} · ${match.playerCount} 麻", color = Brand.text)
                Caption(localMatchTime(match.createdAt))
                Caption("牌桌编号 · ${match.id}")
                Caption("更新于 ${localMatchTime(match.updatedAt)}")
            }
        }
    }
}

@Composable
private fun LobbyHero(onCreate: () -> Unit, onJoin: () -> Unit) {
    Column(Modifier.fillMaxWidth().border(1.dp, Brand.gold.copy(alpha = 0.44f), RoundedCornerShape(12.dp))
        .background(Brand.hero, RoundedCornerShape(12.dp)).padding(10.dp)
        .border(1.dp, Brand.gold.copy(alpha = 0.26f), RoundedCornerShape(8.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandLockup()
        Text("一姬 / ICHIHIME · 线下日麻记分", color = Brand.gold, style = MaterialTheme.typography.labelMedium)
        Heading("落座，即开局。")
        Text("从规则到结算，给同桌每一分一个清楚的去处。", color = Color(0xFFD3DFDC))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onCreate, modifier = Modifier.weight(1f)) { Text("开桌 ↗") }
            OutlinedButton(onClick = onJoin, modifier = Modifier.weight(1f)) { Text("加入牌桌") }
        }
        Caption("本桌在线记分 · 服务端确认每笔支付")
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatchListScreen(
    lobby: Boolean,
    matches: List<MatchSummary>?,
    templates: List<TemplateDto>,
    loading: Boolean,
    error: String?,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
    onHistory: () -> Unit,
    onCreate: () -> Unit,
    onJoin: () -> Unit,
    session: SessionMode,
    principalName: String?,
    // iosfix6 item 5: swipe-to-delete wiring. Defaults keep existing
    // call sites compiling; MainActivity passes the ViewModel functions.
    onDeleteMatch: (MatchSummary) -> Unit = {},
    hiddenUndoId: String? = null,
    onUnhideMatch: (String) -> Unit = {},
    onDismissUndo: () -> Unit = {},
    deleteRefusedMatch: MatchSummary? = null,
    onHideRefusedMatch: (MatchSummary) -> Unit = {},
    onDismissRefused: () -> Unit = {},
    deleteError: String? = null,
    onDismissDeleteError: () -> Unit = {},
) {
    val finished = finishedOwnMatches(matches.orEmpty())
    val live = matches.orEmpty().filterNot { isFinishedMatch(it.status) }.sortedByDescending { it.createdAt }
    var pendingDelete by remember { mutableStateOf<MatchSummary?>(null) }
    // iosfix8 item 2: stock SwipeToDismissBox, REVERTING fix7's
    // full-width custom row. The revealed action is a SMALL trailing
    // gold block (88dp wide, full row height via fillMaxHeight, flush
    // with the row's top and bottom edges), not a full-width button
    // and not fix6's floating pill / translucent band. The swipe
    // itself never deletes — confirmValueChange snaps the row back
    // and opens the existing Chinese confirm dialog, so a stray
    // swipe cannot destroy anything.
    @Composable
    fun DeletableRow(match: MatchSummary) {
        val dismissState = rememberSwipeToDismissBoxState(
            confirmValueChange = { value ->
                if (value == SwipeToDismissBoxValue.EndToStart) {
                    pendingDelete = match
                    false
                } else true
            })
        SwipeToDismissBox(state = dismissState,
            backgroundContent = {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
                    Box(Modifier.fillMaxHeight().width(88.dp).background(Brand.gold, RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center) {
                        Text("删除", color = Brand.background, style = MaterialTheme.typography.titleMedium)
                    }
                }
            },
            enableDismissFromStartToEnd = false) {
            MatchRow(match, templates, onOpen)
        }
    }
    Box(Modifier.fillMaxSize().background(Brand.background)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (lobby) {
                    item { LobbyHero(onCreate, onJoin) }
                    item {
                        Text("在线身份 · ${principalName?.takeIf { it.isNotBlank() } ?: if (session == SessionMode.ACCOUNT) "账户" else "临时访客"} · ${if (session == SessionMode.ACCOUNT) "账户" else "访客"}", color = Brand.goldText)
                        Caption("加入牌桌：扫码或输入房间码，加入后等待桌主抽风定座。")
                    }
                    if (loading && matches == null) item { CircularProgressIndicator() }
                    if (error != null) item { Text("加载失败：$error", color = MaterialTheme.colorScheme.error); TextButton(onClick = onRefresh) { Text("重试") } }
                    if (!loading && matches != null && live.isEmpty()) item { Caption("暂无正在进行的牌桌，下拉刷新试试") }
                    items(live, key = { "live:${it.id}" }) { DeletableRow(it) }
                    item {
                        BrandPanel(Modifier.fillMaxWidth().clickable(onClick = onHistory)) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                SectionTitle("战绩")
                                Caption("对局历史与成绩入口 · 已结束 ${finished.size} 桌")
                                Text("查看战绩 →", color = Brand.goldText)
                            }
                        }
                    }
                    items(finished.take(2), key = { "teaser:${it.id}" }) { DeletableRow(it) }
                } else {
                    val history = ownHistoryMatches(matches.orEmpty())
                    item { Heading("战绩") }
                    item { Caption("自己的对局记录 · 下拉刷新") }
                    if (loading && matches == null) item { CircularProgressIndicator() }
                    if (error != null) item { Text("加载失败：$error", color = MaterialTheme.colorScheme.error); TextButton(onClick = onRefresh) { Text("重试") } }
                    if (!loading && matches != null && history.isEmpty()) item { Caption("暂无对局记录。") }
                    items(history, key = { it.id }) { DeletableRow(it) }
                }
            }
        }
        if (hiddenUndoId != null) {
            Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brand.panel).padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("已隐藏对局记录", color = Brand.text)
                Row {
                    TextButton(onClick = { onUnhideMatch(hiddenUndoId) }) { Text("撤销") }
                    TextButton(onClick = onDismissUndo) { Text("知道了") }
                }
            }
        }
    }
    pendingDelete?.let { match ->
        val deletable = isDeletableMatch(match)
        AlertDialog(onDismissRequest = { pendingDelete = null },
            title = { Text(if (deletable) "删除牌桌？" else "隐藏牌桌？") },
            text = { Text(if (deletable) "这张未开始的牌桌将被永久删除，所有成员都将看不到它。此操作无法撤销。"
                else "这张牌桌只会从你的列表中隐藏，牌桌本身和其他成员不受影响。隐藏后可通过下方的撤销恢复。") },
            confirmButton = { TextButton(onClick = { onDeleteMatch(match); pendingDelete = null }) {
                Text(if (deletable) "删除" else "隐藏") } },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("取消") } })
    }
    deleteRefusedMatch?.let { match ->
        AlertDialog(onDismissRequest = onDismissRefused,
            title = { Text("无法彻底删除") },
            text = { Text("这张牌桌已抽风定座或已开始，无法彻底删除；可以改为仅从你的列表中隐藏。") },
            confirmButton = { TextButton(onClick = { onHideRefusedMatch(match); onDismissRefused() }) { Text("改为隐藏") } },
            dismissButton = { TextButton(onClick = onDismissRefused) { Text("取消") } })
    }
    deleteError?.let { message ->
        AlertDialog(onDismissRequest = onDismissDeleteError,
            title = { Text("删除失败") }, text = { Text(message) },
            confirmButton = { TextButton(onClick = onDismissDeleteError) { Text("知道了") } })
    }
}

@Composable
private fun SeatRow(seat: SeatDto) {
    val seatStatus = when (seat.status) {
        "empty" -> "空座"
        "assigned" -> "已入座"
        "checked_in" -> "已签到"
        else -> "状态未提供"
    }
    BrandPanel(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(36.dp).background(Color(0xFFEFE8D6), RoundedCornerShape(5.dp)), contentAlignment = Alignment.Center) {
                Text(when (seat.seatNo) { 0 -> "东"; 1 -> "南"; 2 -> "西"; 3 -> "北"; else -> "?" },
                    color = Color(0xFF194C46), fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f)) {
                Text(seat.displayName ?: "空座", color = Brand.text, style = MaterialTheme.typography.titleMedium)
                Caption("${seat.seatNo + 1} 号位 · $seatStatus")
            }
            Box(Modifier.background(Brand.cream, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                Text(seat.points?.let { "$it 点" } ?: "点数未提供", color = Brand.tileInk, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun MemberRow(member: MemberDto, drawn: Boolean, dealerSeatNo: Int?) {
    BrandPanel(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(36.dp).background(Color(0xFFEFE8D6), RoundedCornerShape(5.dp)), contentAlignment = Alignment.Center) {
                Text(if (drawn) windLabel(member.wind) else if (member.seatNo != null) "座" else "待",
                    color = Color(0xFF194C46), fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f)) {
                Text("${member.displayName}${if (member.isOwner) " · 桌主" else ""}",
                    color = Brand.text, style = MaterialTheme.typography.titleMedium)
                if (member.seatNo != null) {
                    Caption("${member.seatNo + 1} 号位" +
                        (member.wind?.let { " · ${windLabel(it)}风${if (member.seatNo == dealerSeatNo && it == "E") " · 庄家" else ""}" }
                            ?: " · 已就座"))
                } else Caption("等待抽风定座")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TableScreen(
    state: TableSnapshot?,
    hands: List<HandDto>?,
    settlement: SettlementPreview?,
    templates: List<TemplateDto>,
    loading: Boolean,
    error: String?,
    connection: String,
    onRefresh: () -> Unit,
    app: AppState,
    model: AppViewModel,
    tableId: String,
) {
    PullToRefreshBox(isRefreshing = loading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize().background(Brand.background)) {
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Heading("牌桌") }
            item { Caption("实时连接 · $connection") }
            if (connection.startsWith("实时连接失败") || connection.startsWith("实时连接已暂停")) item {
                OutlinedButton(onClick = { model.reconnect(tableId) }) { Text("重新连接实时牌桌") }
            }
            if (loading && state == null) item { CircularProgressIndicator() }
            if (error != null) item {
                Text("加载失败：$error", color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRefresh) { Text("重试") }
            }
            if (state == null && !loading) item { Caption("暂无对局数据，下拉刷新试试") }
            if (state != null) {
                item {
                    BrandPanel(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            val match = state.match
                            val title = ruleDetails(match.rulesSnapshot, templates.firstOrNull { it.versionId == match.rulesetVersionId }).title
                            Text(title, color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
                            Text("${matchStatusLabel(match.status)} · ${match.playerCount} 麻", color = Brand.text)
                            Caption("创建时间 · ${localMatchTime(match.createdAt)}")
                            Caption("牌桌编号 · ${match.id}")
                            RuleInfo(match.rulesSnapshot, templates, match.rulesetVersionId)
                        }
                    }
                }
                item { SectionTitle(if (state.match.status == "preparing") "成员与座次" else "座位与点数") }
                if (state.match.status == "preparing") {
                    val member = state.members.firstOrNull { it.principalId == app.profile?.principal?.id }
                    if (member != null && state.match.ownerPrincipalId != member.principalId) item {
                        Text(if (state.match.seatingDrawnAt == null) "已加入 · 等待桌主抽风定座"
                            else "已定座 ${member.seatNo?.plus(1) ?: "?"} 号位 · 等待桌主开局", color = Brand.goldText)
                    }
                    if (member == null) {
                        val mine = state.seats.firstOrNull { it.principalId != null &&
                            it.principalId == app.profile?.principal?.id && it.status == "checked_in" }
                        if (mine != null && state.match.ownerPrincipalId != app.profile?.principal?.id)
                            item { Text("已签到 ${mine.seatNo + 1} 号位 · 等待桌主开局", color = Brand.goldText) }
                    }
                }
                item {
                    Column(Modifier.fillMaxWidth().border(8.dp, Color(0xFF192B3A), RoundedCornerShape(20.dp))
                        .background(Brand.felt, RoundedCornerShape(14.dp)).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.match.status == "preparing" && state.members.isNotEmpty()) {
                            state.members.sortedWith(compareBy<MemberDto> { it.seatNo ?: Int.MAX_VALUE }.thenBy { it.displayName })
                                .forEach { MemberRow(it, state.match.seatingDrawnAt != null, state.match.dealerSeatNo) }
                        } else {
                            state.seats.sortedBy { it.seatNo }.forEach { SeatRow(it) }
                        }
                        BrandPanel(Modifier.fillMaxWidth()) {
                            val hand = state.currentHand
                            Column(Modifier.padding(12.dp)) {
                                if (hand == null) Caption("当前局 · 暂无进行中的牌局") else {
                                    Text("${windLabel(hand.roundWind)} ${hand.roundNumber ?: "?"} 局 · 庄家 ${hand.dealerSeatNo?.plus(1) ?: "?"} 号位", color = Brand.goldText)
                                    Caption("本场棒 ${hand.honba ?: "未提供"} · 立直供托 ${hand.riichiPool?.let { "$it 点 / ${poolSticks(it)} 根" } ?: "未提供"}")
                                    hand.seats.sortedBy { it.seatNo }.forEach { seat ->
                                        Caption("${seat.seatNo + 1} 号位 · ${when (seat.isRiichi) { true -> "已立直"; false -> "未立直"; null -> "立直状态未知" }}")
                                    }
                                }
                            }
                        }
                    }
                }
                item { OnlineTableControls(state.match.id, app, model) }
                if (isFinishedMatch(state.match.status)) item {
                    SectionTitle("最终排名")
                    if (settlement == null || settlement.standings.isEmpty()) Caption("结算数据暂未提供")
                }
                if (isFinishedMatch(state.match.status) && settlement != null) {
                    items(settlement.standings.sortedBy { it.rank }) { standing ->
                        BrandPanel(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("第 ${standing.rank} 名 · ${standing.seatNo + 1} 号位", color = Brand.goldText)
                                Text("${standing.finalPoints} 点 · 总成绩 ${standing.totalTenths / 10.0}",
                                    color = if (standing.totalTenths >= 0) Brand.gain else Brand.loss)
                            }
                        }
                    }
                }
            }
            item { SectionTitle(if (hands == null) "局历史 · 读取中" else "局历史 · 最早的 ${hands.size} 局") }
            item { Caption("显示最早的已结算局摘要（最多 100 局），非完整牌谱回放；无后续分页或原始输入。") }
            if (hands == null && !loading) item { Caption("牌局记录暂未提供") }
            if (hands != null && hands.isEmpty()) item { Caption("暂无牌局记录") }
            itemsIndexed(hands.orEmpty().sortedBy { it.handNo }) { _, hand ->
                BrandPanel(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("第 ${hand.handNo} 局 · ${windLabel(hand.roundWind)} ${hand.roundNumber} 局 · ${handKindLabel(hand.kind)}", color = Brand.goldText)
                        Caption("庄家 ${hand.dealerSeatNo + 1} 号位 · 本场棒 ${hand.honba}")
                        HorizontalDivider(color = Brand.hairline)
                        hand.perSeat.sortedBy { it.seatNo }.forEach { delta ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${delta.seatNo + 1} 号位", color = Brand.text)
                                Text("${if (delta.netPoints > 0) "+" else ""}${delta.netPoints} 点",
                                    color = when { delta.netPoints > 0 -> Brand.gain; delta.netPoints < 0 -> Brand.loss; else -> Brand.muted })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProfileScreen(
    profile: MeResponse?,
    error: String?,
    diagnostic: String?,
    onDiagnostic: () -> Unit,
    onLogout: () -> Unit,
    onCheckIn: () -> Unit,
    onRetry: () -> Unit,
    onLocal: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        BrandLockup()
        Heading("我的一姬")
        if (profile == null && error == null) CircularProgressIndicator()
        if (error != null) {
            Text("加载失败：$error", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onRetry) { Text("重试") }
        }
        profile?.principal?.let { principal ->
            BrandPanel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(principal.displayName, color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
                    Caption("账户与牌局记录")
                    Caption("账号类型 · ${when (principal.type) { "account" -> "注册用户"; "guest" -> "访客"; else -> "账号类型未提供" }}")
                    Caption("创建时间 · ${localMatchTime(principal.createdAt)}")
                }
            }
        }
        SectionTitle("桌边入口")
        OutlinedButton(onClick = onCheckIn) { Text("扫码、粘贴链接或输入房间码") }
        OutlinedButton(onClick = onDiagnostic) { Text("关于 / 诊断 · 引擎自检") }
        OutlinedButton(onClick = onLocal) { Text("进入本地无身份模式") }
        if (diagnostic != null) BrandPanel(Modifier.fillMaxWidth()) { Text("诊断结果：$diagnostic", Modifier.padding(16.dp)) }
        Button(onClick = onLogout) { Text("退出登录") }
    }
}
@Composable
fun CheckInScreen(initial: String?, state: AppState, model: AppViewModel, onClose: () -> Unit) {
    LaunchedEffect(initial) { model.beginCheckIn() }
    var input by remember(initial) { mutableStateOf(initial.orEmpty()) }
    var code by remember { mutableStateOf("") }
    var scanner by remember { mutableStateOf(false) }
    var resolved by remember(initial) { mutableStateOf<CheckInLink?>(null) }
    var refresh by remember(initial) { mutableIntStateOf(0) }
    var attempted by remember(initial) { mutableStateOf<String?>(null) }
    var alias by remember(initial) { mutableStateOf("") }
    val link = resolved ?: parseCheckInLink(input)
    val preview = state.joinSeats?.takeIf { state.joinPreviewLink?.matchId == link?.matchId &&
        state.joinPreviewLink?.token == link?.token }
    LaunchedEffect(link?.matchId, link?.token, refresh, state.busy) {
        val current = link?.takeIf { it.hasToken }
        val key = current?.let { "${it.matchId}:${it.token}:$refresh" }
        if (current != null && key != null && attempted != key && !state.busy) {
            attempted = key
            model.previewJoin(current)
        }
    }
    // iosfix6 item 4: Done dismisses the IME on every field here.
    val checkInFocus = androidx.compose.ui.platform.LocalFocusManager.current
    val doneKeys = androidx.compose.foundation.text.KeyboardActions(onDone = { checkInFocus.clearFocus() })
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BrandLockup()
        Heading("加入在线牌桌")
        Text("当前身份：${if (state.session == SessionMode.ONLINE_GUEST) "临时访客" else "账户"}。加入后等待房主抽风定座。", color = Brand.text)
        if (preview?.caller?.isMember != true) {
            OutlinedButton(onClick = { scanner = !scanner }) { Text(if (scanner) "关闭相机" else "相机扫码") }
            if (scanner) CheckInScanner { scanned ->
                input = scanned; resolved = null; scanner = false
            }
            OutlinedTextField(input, { input = it; resolved = null },
                label = { Text("粘贴完整 HTTPS 签到链接") },
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                keyboardActions = doneKeys)
            OutlinedTextField(code, { code = it.trim().uppercase(java.util.Locale.ROOT) },
                label = { Text("六位房间码") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                keyboardActions = doneKeys)
            Button(onClick = {
                resolved = null; input = ""
                model.byCode(code) { result -> resolved = result }
            }, enabled = !state.busy && normalizeJoinCode(code) != null) { Text("查看牌桌成员") }
        }
        if (input.isNotBlank() && link == null) Text("仅接受本站 /checkin/<对局编号> 安全链接", color = MaterialTheme.colorScheme.error)
        if (link != null && !link.hasToken) Text("签到链接无效或已过期，请房主重新分享链接，或使用房间码。", color = MaterialTheme.colorScheme.error)
        link?.takeIf { it.hasToken }?.let { Caption("目标牌桌 · ${it.matchId}") }
        if (state.busy && preview == null) CircularProgressIndicator()
        if (preview != null) {
            SectionTitle("牌桌成员 · ${preview.match.playerCount} 麻")
            preview.members.forEach { member ->
                Text("${member.displayName}${if (member.isOwner) "（房主）" else ""} · " +
                    (member.seatNo?.let { seat ->
                        "${seat + 1} 号位${member.wind?.let { " · ${windLabel(it)}${if (it == "E") " · 庄家" else ""}" } ?: ""}"
                    } ?: "等待抽风定座"), color = Brand.text)
            }
            when {
                preview.caller.isOwner -> {
                    Text("你是房主，已为你打开牌桌。", color = Brand.goldText)
                    Button(onClick = { model.openJoinedMatch(preview.match.id) }) { Text("查看牌桌") }
                }
                preview.caller.isMember -> {
                    Text("已加入牌桌，等待房主抽风定座", color = Brand.goldText)
                    Button(onClick = { model.openJoinedMatch(preview.match.id) }) { Text("查看牌桌") }
                }
                else -> {
                    if (preview.seating.memberCount >= preview.match.playerCount)
                        Text("牌桌已满员", color = MaterialTheme.colorScheme.error)
                    if (preview.match.status != "preparing")
                        Text("牌局已开始，无法加入。", color = MaterialTheme.colorScheme.error)
                    OutlinedTextField(alias, { alias = it }, label = { Text("显示昵称（选填）") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                        keyboardActions = doneKeys)
                    Button(onClick = { link?.let { model.checkIn(it, alias) } },
                        enabled = !state.busy && preview.seating.memberCount < preview.match.playerCount &&
                            preview.match.status == "preparing") { Text("加入牌桌") }
                }
            }
        }
        if (link?.hasToken == true && preview?.caller?.isMember != true)
            OutlinedButton(onClick = { refresh++ }, enabled = !state.busy) { Text("刷新成员") }
        state.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.session == SessionMode.ONLINE_GUEST) Caption("访客身份仅保留在此设备的有效登录会话；请勿退出或卸载。")
        Text("房间码可重新换取签到凭证；链接过期后请房主发送新链接。", color = Brand.muted)
        TextButton(onClick = onClose) { Text("关闭") }
    }
}
