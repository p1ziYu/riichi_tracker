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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
                    OutlinedButton(onClick = { onModeChange(false) }, enabled = !busy && register) { Text("邮箱登录") }
                    OutlinedButton(onClick = { onModeChange(true) }, enabled = !busy && !register) { Text("注册账户") }
                }
                if (register) OutlinedTextField(name, { name = it }, label = { Text("昵称") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(email, { email = it }, label = { Text("邮箱") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text("密码") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
                Button(onClick = { onSubmit(email.trim(), password, if (register) name.trim() else null) },
                    enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank())) {
                    Text(if (busy) "请稍候…" else if (register) "注册并登录" else "登录")
                }
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
private fun LobbyHero(onCreate: () -> Unit) {
    Column(Modifier.fillMaxWidth().border(1.dp, Brand.gold.copy(alpha = 0.44f), RoundedCornerShape(12.dp))
        .background(Brand.hero, RoundedCornerShape(12.dp)).padding(10.dp)
        .border(1.dp, Brand.gold.copy(alpha = 0.26f), RoundedCornerShape(8.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandLockup()
        Text("一姬 / ICHIHIME · 线下日麻记分", color = Brand.gold, style = MaterialTheme.typography.labelMedium)
        Heading("落座，即开局。")
        Text("从规则到结算，给同桌每一分一个清楚的去处。", color = Color(0xFFD3DFDC))
        Button(onClick = onCreate) { Text("开桌 ↗") }
        Caption("只读体验 · 暂不支持创建牌桌")
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
) {
    var showCreateNotice by remember { mutableStateOf(false) }
    if (showCreateNotice) AlertDialog(onDismissRequest = { showCreateNotice = false },
        title = { Text("只读体验") }, text = { Text("当前试用版仅供查看；完整版本将提供创建牌桌功能。") },
        confirmButton = { TextButton(onClick = { showCreateNotice = false }) { Text("知道了") } })
    val finished = finishedOwnMatches(matches.orEmpty())
    val live = matches.orEmpty().filterNot { isFinishedMatch(it.status) }.sortedByDescending { it.createdAt }
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize().background(Brand.background)) {
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (lobby) {
                item { LobbyHero { showCreateNotice = true } }
                item { SectionTitle("正在进行的牌桌") }
                if (loading && matches == null) item { CircularProgressIndicator() }
                if (error != null) item { Text("加载失败：$error", color = MaterialTheme.colorScheme.error); TextButton(onClick = onRefresh) { Text("重试") } }
                if (!loading && matches != null && live.isEmpty()) item { Caption("暂无正在进行的牌桌，下拉刷新试试") }
                items(live, key = { "live:${it.id}" }) { MatchRow(it, templates, onOpen) }
                item { SectionTitle("规则模板") }
                if (templates.isEmpty()) item { Caption("模板资料暂未提供") }
                items(templates.take(2), key = { "template:${it.versionId}" }) { template ->
                    BrandPanel(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(template.name, color = Brand.goldText, style = MaterialTheme.typography.titleMedium)
                            Caption("${sourceLabel(template.scope)} · ${reviewLabel(template.reviewStatus)} · 只读预览")
                        }
                    }
                }
                item {
                    BrandPanel(Modifier.fillMaxWidth().clickable(onClick = onHistory)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            SectionTitle("战绩")
                            Caption("对局历史与成绩入口 · 已结束 ${finished.size} 桌")
                            Text("查看战绩 →", color = Brand.goldText)
                        }
                    }
                }
                items(finished.take(2), key = { "teaser:${it.id}" }) { MatchRow(it, templates, onOpen) }
            } else {
                val history = ownHistoryMatches(matches.orEmpty())
                item { Heading("战绩") }
                item { Caption("自己的对局记录 · 下拉刷新") }
                if (loading && matches == null) item { CircularProgressIndicator() }
                if (error != null) item { Text("加载失败：$error", color = MaterialTheme.colorScheme.error); TextButton(onClick = onRefresh) { Text("重试") } }
                if (!loading && matches != null && history.isEmpty()) item { Caption("暂无对局记录。") }
                items(history, key = { it.id }) { MatchRow(it, templates, onOpen) }
            }
        }
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
    PullToRefreshBox(isRefreshing = loading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize().background(Brand.background)) {
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Heading("牌桌") }
            item { Caption("实时连接 · $connection") }
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
                item { SectionTitle("座位与点数") }
                item {
                    Column(Modifier.fillMaxWidth().border(8.dp, Color(0xFF192B3A), RoundedCornerShape(20.dp))
                        .background(Brand.felt, RoundedCornerShape(14.dp)).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.seats.sortedBy { it.seatNo }.forEach { SeatRow(it) }
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
            item { SectionTitle(if (hands == null) "局记录 · 读取中" else "局记录 · 最早的 ${hands.size} 局（按对局顺序）") }
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
        OutlinedButton(onClick = onCheckIn) { Text("粘贴签到链接") }
        OutlinedButton(onClick = onDiagnostic) { Text("关于 / 诊断 · 引擎自检") }
        if (diagnostic != null) BrandPanel(Modifier.fillMaxWidth()) { Text("诊断结果：$diagnostic", Modifier.padding(16.dp)) }
        Button(onClick = onLogout) { Text("退出登录") }
    }
}
@Composable
fun CheckInScreen(initial: String?, onOpenBrowser: (String) -> Unit) {
    var input by remember(initial) { mutableStateOf(initial.orEmpty()) }
    val link = parseCheckInLink(input.trim())
    Column(Modifier.fillMaxSize().background(Brand.background).verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BrandLockup()
        Heading("玩家签到")
        BrandPanel(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("当前只读体验版暂不支持签到；可打开网页版签到。", color = Brand.text)
                Caption("粘贴或通过链接打开后，确认对局编号与签到凭证是否存在。")
                OutlinedTextField(input, { input = it }, label = { Text("粘贴签到链接（内容隐藏）") },
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                if (input.isNotBlank()) {
                    if (link == null) Text("链接无效，请检查后重试", color = MaterialTheme.colorScheme.error)
                    else {
                        Caption("牌桌编号 · ${link.matchId}")
                        Caption(if (link.hasToken) "链接含签到凭证；不会在页面展示" else "链接不含签到凭证")
                    }
                }
                Button(onClick = { link?.let { onOpenBrowser(it.url) } }, enabled = link != null) {
                    Text("打开网页版签到")
                }
            }
        }
    }
}
