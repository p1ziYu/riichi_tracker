package com.p1ziyu.riichitracker.p1

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun AuthScreen(
    register: Boolean,
    busy: Boolean,
    error: String?,
    onSubmit: (email: String, password: String, name: String?) -> Unit,
    onModeChange: (Boolean) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text(if (register) "注册账号" else "登录", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(email, { email = it }, label = { Text("邮箱") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("密码") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        if (register) OutlinedTextField(name, { name = it }, label = { Text("昵称") }, singleLine = true,
            modifier = Modifier.fillMaxWidth())
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(12.dp))
        Button(onClick = { onSubmit(email.trim(), password, if (register) name.trim() else null) },
            enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank())) {
            Text(if (busy) "请稍候…" else if (register) "注册" else "登录")
        }
        TextButton(onClick = { onModeChange(!register) }, enabled = !busy) {
            Text(if (register) "已有账号？登录" else "没有账号？注册")
        }
    }
}

private fun isFinished(status: String): Boolean =
    status.equals("finished", true) || status.equals("completed", true) || status.equals("settled", true)
private fun statusLabel(status: String): String = when (status) {
    "preparing", "lobby" -> "等待座次确认"
    "active", "in_progress" -> "进行中"
    "finished", "completed" -> "已结束"
    else -> status
}

@Composable
private fun RuleInfo(snapshot: kotlinx.serialization.json.JsonObject?, templates: List<TemplateDto>, versionId: String?) {
    val details = ruleDetails(snapshot, templates.firstOrNull { it.versionId == versionId })
    Text("规则：${details.title}")
    Text("来源：${when (details.source) { "system" -> "系统模板"; "private" -> "私有模板"; else -> details.source }} · 审核：${when (details.reviewStatus) { "approved", "verified" -> "已审核"; "pending", "unreviewed" -> "待审核"; "rejected" -> "未通过"; else -> details.reviewStatus }}")
    Text("自定义：${if (details.customizedKeys.isEmpty()) "无（按模板）" else details.customizedKeys.joinToString("、")}")
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
) {
    var showCreateNotice by remember { mutableStateOf(false) }
    if (showCreateNotice) AlertDialog(onDismissRequest = { showCreateNotice = false },
        title = { Text("只读体验") }, text = { Text("当前试用版仅供查看；完整版本将提供创建牌桌功能。") },
        confirmButton = { TextButton(onClick = { showCreateNotice = false }) { Text("知道了") } })
    val sorted = if (lobby) matches.orEmpty().sortedWith(compareBy<MatchSummary> { isFinished(it.status) }
        .thenByDescending { it.createdAt })
    else matches.orEmpty().sortedByDescending { it.createdAt }
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(if (lobby) "对局大厅" else "历史对局", style = MaterialTheme.typography.headlineMedium) }
            if (lobby) item {
                Card(onClick = { showCreateNotice = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("创建对局 · 只读体验版不可创建", Modifier.padding(16.dp))
                }
            }
            if (loading && matches == null) item { CircularProgressIndicator() }
            if (error != null) item {
                Text("加载失败：$error", color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRefresh) { Text("重试") }
            }
            if (!loading && matches != null && sorted.isEmpty()) item { Text("暂无对局，下拉刷新试试") }
            items(sorted, key = { it.id }) { match ->
                Card(onClick = { onOpen(match.id) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("对局 ${match.id}", style = MaterialTheme.typography.titleMedium)
                        Text("状态：${statusLabel(match.status)} · ${match.playerCount} 人")
                        Text("创建时间：${match.createdAt}")
                        Text("更新时间：${match.updatedAt ?: "未提供"}")
                        RuleInfo(match.rulesSnapshot, templates, match.rulesetVersionId)
                    }
                }
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
) {
    PullToRefreshBox(isRefreshing = loading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text("对局详情", style = MaterialTheme.typography.headlineMedium) }
            item { Text("连接状态：$connection") }
            if (loading && state == null) item { CircularProgressIndicator() }
            if (error != null) item {
                Text("加载失败：$error", color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRefresh) { Text("重试") }
            }
            if (state == null && !loading) item { Text("暂无对局数据，下拉刷新试试") }
            if (state != null) {
                item {
                    Text("对局 ${state.match.id} · ${statusLabel(state.match.status)} · ${state.match.playerCount} 人",
                        style = MaterialTheme.typography.titleLarge)
                    Text("创建时间：${state.match.createdAt ?: "未提供"}")
                    RuleInfo(state.match.rulesSnapshot, templates, state.match.rulesetVersionId)
                }
                item { Text("座位与点数", style = MaterialTheme.typography.titleMedium) }
                items(state.seats.sortedBy { it.seatNo }) { seat ->
                    Text("${seat.seatNo + 1} 号位 · ${seat.displayName ?: "空座"} · ${seat.points?.let { "$it 点" } ?: "点数未提供"} · ${when (seat.status) { "empty" -> "空座"; "assigned" -> "已入座"; "checked_in" -> "已签到"; else -> "状态未提供" }}")
                }
                item {
                    val hand = state.currentHand
                    if (hand == null) Text("当前局：暂无进行中的牌局") else Column {
                        Text("当前局：${when (hand.roundWind) { "E" -> "东"; "S" -> "南"; "W" -> "西"; else -> hand.roundWind ?: "?" }} ${hand.roundNumber ?: "?"} 局 · 庄家 ${hand.dealerSeatNo?.plus(1) ?: "?"} 号位")
                        Text("本场棒：${hand.honba ?: "未提供"} · 立直供托：${hand.riichiPool?.let { "$it 点 / ${poolSticks(it)} 根" } ?: "未提供"}")
                        hand.seats.sortedBy { it.seatNo }.forEach { seat ->
                            Text("${seat.seatNo + 1} 号位 · ${when (seat.isRiichi) { true -> "已立直"; false -> "未立直"; null -> "立直状态未知" }}")
                        }
                    }
                }
                if (isFinished(state.match.status)) item {
                    Text("最终排名", style = MaterialTheme.typography.titleMedium)
                    if (settlement == null || settlement.standings.isEmpty()) Text("结算数据暂未提供")
                }
                if (isFinished(state.match.status) && settlement != null) {
                    items(settlement.standings.sortedBy { it.rank }) { standing ->
                        Text("第 ${standing.rank} 名 · ${standing.seatNo + 1} 号位 · ${standing.finalPoints} 点 · 总成绩 ${standing.totalTenths / 10.0}")
                    }
                }
            }
            item { Text(if (hands == null) "局记录 · 读取中" else "局记录 · 最早的 ${hands.size} 局（按对局顺序）", style = MaterialTheme.typography.titleMedium) }
            if (hands == null && !loading) item { Text("牌局记录暂未提供") }
            if (hands != null && hands.isEmpty()) item { Text("暂无牌局记录") }
            val earliest = hands.orEmpty().sortedBy { it.handNo }
            itemsIndexed(earliest) { _, hand ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("第 ${hand.handNo} 局 · ${hand.roundWind} ${hand.roundNumber} 局 · ${hand.kind}")
                        Text("庄家 ${hand.dealerSeatNo + 1} 号位 · 本场棒 ${hand.honba}")
                        hand.perSeat.sortedBy { it.seatNo }.forEach { delta ->
                            Text("${delta.seatNo + 1} 号位：${if (delta.netPoints > 0) "+" else ""}${delta.netPoints} 点")
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
) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("我的账号", style = MaterialTheme.typography.headlineMedium)
        if (profile == null && error == null) CircularProgressIndicator()
        if (error != null) {
            Text("加载失败：$error", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onRetry) { Text("重试") }
        }
        profile?.principal?.let {
            Text("昵称：${it.displayName}")
            Text("账号类型：${it.type}")
            Text("创建时间：${it.createdAt ?: "未提供"}")
        }
        OutlinedButton(onClick = onDiagnostic) { Text("关于 / 诊断 · 引擎自检") }
        OutlinedButton(onClick = onCheckIn) { Text("粘贴签到链接") }
        if (diagnostic != null) Text("诊断结果：$diagnostic")
        Button(onClick = onLogout) { Text("退出登录") }
    }
}

@Composable
fun CheckInScreen(initial: String?, onOpenBrowser: (String) -> Unit) {
    var input by remember(initial) { mutableStateOf(initial.orEmpty()) }
    val link = parseCheckInLink(input.trim())
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("签到链接", style = MaterialTheme.typography.headlineMedium)
        Text("当前只读体验版暂不支持签到；可打开网页版签到。")
        Text("粘贴或通过链接打开后，确认对局编号与签到凭证是否存在。")
        OutlinedTextField(input, { input = it }, label = { Text("粘贴签到链接（内容隐藏）") },
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        if (input.isNotBlank()) {
            if (link == null) Text("链接无效，请检查后重试", color = MaterialTheme.colorScheme.error)
            else {
                Text("对局：${link.matchId}")
                Text(if (link.hasToken) "链接含签到凭证；不会在页面展示" else "链接不含签到凭证")
            }
        }
        Button(onClick = { link?.let { onOpenBrowser(it.url) } }, enabled = link != null) {
            Text("打开网页版签到")
        }
    }
}
