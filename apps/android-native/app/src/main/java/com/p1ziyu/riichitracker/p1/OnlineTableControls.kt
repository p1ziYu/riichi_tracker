package com.p1ziyu.riichitracker.p1

import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
fun OnlineTableControls(id: String, state: AppState, model: AppViewModel) {
    val table = state.table ?: return
    val principal = state.profile?.principal?.id
    val isOwner = principal != null && principal == table.match.ownerPrincipalId
    val participant = principal != null && table.seats.any { it.principalId == principal && it.status == "checked_in" }
    val preparing = table.match.status == "preparing"
    val active = table.match.status == "in_progress" || table.match.status == "active"
    val hand = table.currentHand
    val open = active && hand?.status == "open"
    val between = active && (hand == null || hand.status == "settled")
    var dealer by remember(id) { mutableStateOf<Int?>(null) }
    var showResult by remember(id) { mutableStateOf(false) }
    var confirmFinish by remember(id) { mutableStateOf(false) }
    var movingSeat by remember(id) { mutableStateOf<Int?>(null) }
    var removingSeat by remember(id) { mutableStateOf<SeatDto?>(null) }
    val clipboard = LocalClipboardManager.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.actionError != null) Text(state.actionError, color = MaterialTheme.colorScheme.error)
        if (preparing && isOwner) {
            Text("桌主座位与邀请", color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
            Text("房主选座后分享房间码或十分钟签到链接。访客直接选座签到；座位满员且已签到即可确认座次。", color = Brand.text)
            table.seats.sortedBy { it.seatNo }.forEach { seat ->
                if (seat.principalId == null || seat.principalId == principal && seat.status != "checked_in")
                    OutlinedButton(onClick = { model.claim(id, seat.seatNo) }, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth()) { Text("房主选 ${seat.seatNo + 1} 号位") }
            }
            Text("起家 · ${dealer?.let { "${it + 1} 号位" } ?: "服务器随机（默认）"}", color = Brand.text)
            OutlinedButton(onClick = { dealer = null }) { Text("随机起家") }
            table.seats.filter { it.principalId != null }.sortedBy { it.seatNo }.forEach { seat ->
                OutlinedButton(onClick = { dealer = seat.seatNo }) { Text("指定 ${seat.displayName ?: "${seat.seatNo + 1}号位"} 为起家") }
            }
            table.match.joinCode?.let { code ->
                Text("房间码：$code", color = Brand.goldText)
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(code)) }) { Text("复制房间码") }
            }
            Button(onClick = { model.invite(id) }, enabled = !state.busy) { Text("生成十分钟签到链接") }
            state.invitation?.let { token ->
                val valid = runCatching { java.time.Instant.parse(token.expiresAt).isAfter(java.time.Instant.now()) }.getOrDefault(false)
                if (valid) {
                    val link = "https://riichi.p1ziyu.com/checkin/$id?token=${java.net.URLEncoder.encode(token.token, "UTF-8")}"
                    InvitationQr(link)
                    Text("单人一次性 · 截止 ${localMatchTime(token.expiresAt)}", color = Brand.text)
                    OutlinedButton(onClick = { clipboard.setText(AnnotatedString(link)) }) { Text("复制玩家签到链接") }
                } else Text("签到链接已过期，请重新生成", color = Brand.text)
            }
            Text("已入座成员 · 可在开局前移动、交换座位或移除访客", color = Brand.goldText)
            table.seats.sortedBy { it.seatNo }.forEach { seat ->
                Text("${seat.seatNo + 1} 号位 · ${seat.displayName ?: "空座"} · ${if (seat.status == "checked_in") "已签到" else if (seat.principalId != null) "已入座" else "空座"}",
                    color = Brand.text)
                if (seat.principalId != null) {
                    OutlinedButton(onClick = { movingSeat = seat.seatNo }, enabled = !state.busy) {
                        Text("移动 / 交换 ${seat.displayName ?: "${seat.seatNo + 1}号位"}")
                    }
                    if (seat.principalId != principal) OutlinedButton(onClick = { removingSeat = seat }, enabled = !state.busy) {
                        Text("移除 ${seat.displayName ?: "${seat.seatNo + 1}号位"}")
                    }
                }
            }
            Button(onClick = { model.finalizeSeats(id, dealer) }, enabled = !state.busy &&
                table.seats.size == table.match.playerCount && table.seats.all { it.status == "checked_in" }) { Text("确认座次并开局") }
        }
        if (open && participant && hand != null) {
            Text("立直标记 · 服务器版本 ${hand.markRevision ?: "未提供"}", color = Brand.goldText)
            hand.seats.sortedBy { it.seatNo }.forEach { seat ->
                val usage = seat.riichiChangeUsage
                val lowAllowed = table.match.rulesSnapshot?.get("allowLowPointRiichi")?.jsonPrimitive?.booleanOrNull == true
                val allowed = canChangeRiichi(seat, lowAllowed)
                OutlinedButton(onClick = { model.mark(id, hand, seat, seat.isRiichi != true) },
                    enabled = !state.busy && state.pendingResult == null && seat.isRiichi != null && hand.markRevision != null && allowed,
                    modifier = Modifier.fillMaxWidth()) {
                    Text("${seat.seatNo + 1}号位 ${if (seat.isRiichi == true) "取消立直" else "宣言立直"} · 宣言 ${usage.declares}/2 · 取消 ${usage.cancels}/1")
                }
            }
            Button(onClick = { showResult = true }, enabled = !state.busy && state.pendingResult == null) { Text("录入本局结果") }
        }
        if (active && !participant) Text("仅已确认座位且签到的玩家可提交立直和结果。", color = Brand.muted)
        if (between && participant) Button(onClick = { model.nextHand(id) }, enabled = !state.busy) { Text("新开一局") }
        if (between && isOwner && table.match.rulesSnapshot?.get("automaticEndPolicy")?.jsonPrimitive?.content != "ranked_sanma")
            OutlinedButton(onClick = { confirmFinish = true }, enabled = !state.busy) { Text("终局") }
        if (table.match.status == "finished") {
            OutlinedButton(onClick = { model.terminalPreview(id) }, enabled = !state.busy) { Text("预览终局成绩") }
            state.terminal?.takeIf { it.version == table.match.version }?.output?.let { output ->
                output.standings.sortedBy { it.rank }.forEach {
                    Text("第${it.rank}名 · ${it.seatNo + 1}号位 · ${it.finalPoints} 点 · ${it.totalTenths / 10.0}", color = Brand.text)
                }
                if (isOwner && !table.match.settlementConfirmed) Button(onClick = { model.confirmSettlement(id) }, enabled = !state.busy) { Text("确认终局成绩") }
            }
        }
        state.pendingResult?.takeIf { it.matchId == id }?.let {
            Text("本局提交结果未知。请先刷新权威牌桌；仅在尚未结算时原样重试，不要编辑后提交新请求。", color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { model.refreshTable(id) }) { Text("刷新确认") }
            OutlinedButton(onClick = model::resend, enabled = !state.busy) { Text("原请求重试（同一 clientEventId）") }
            if (hand?.id != it.handId || hand?.status == "settled")
                TextButton(onClick = model::resolvePendingWithoutResend) { Text("已核对服务端状态，清除本地待确认请求") }
        }
    }
    if (confirmFinish) AlertDialog(onDismissRequest = { confirmFinish = false },
        title = { Text("结束本桌？") }, text = { Text("仅桌主可以结束牌局；终局条件以服务端规则为准。") },
        confirmButton = { TextButton(onClick = { confirmFinish = false; model.finish(id) }) { Text("确认终局") } },
        dismissButton = { TextButton(onClick = { confirmFinish = false }) { Text("取消") } })
    if (showResult && hand != null && open) {
        ResultEditor(id, table, hand, state, model) { showResult = false }
    }
    movingSeat?.let { from ->
        val source = table.seats.firstOrNull { it.seatNo == from && it.principalId != null }
        if (source == null || !preparing || !isOwner) movingSeat = null else AlertDialog(
            onDismissRequest = { movingSeat = null },
            title = { Text("调整 ${source.displayName ?: "${from + 1}号位"} 的座位") },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                    table.seats.sortedBy { it.seatNo }.filterNot { it.seatNo == from }.forEach { target ->
                        TextButton(onClick = { movingSeat = null; model.reassignSeat(id, from, target.seatNo) },
                            enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                            Text("${target.seatNo + 1}号位 · ${target.displayName ?: "空座"} · ${if (target.principalId == null) "移动" else "交换"}")
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { movingSeat = null }) { Text("取消") } })
    }
    removingSeat?.let { seat ->
        if (!preparing || !isOwner || seat.principalId == null ||
            table.seats.none { it.seatNo == seat.seatNo && it.principalId == seat.principalId }) removingSeat = null
        else AlertDialog(onDismissRequest = { removingSeat = null },
            title = { Text("移除 ${seat.displayName ?: "${seat.seatNo + 1}号位"}？") },
            text = { Text("此操作将腾出 ${seat.seatNo + 1} 号位；该成员需要新的签到凭证才能重新加入。") },
            confirmButton = { TextButton(onClick = {
                removingSeat = null
                model.removeMember(id, seat.principalId)
            }, enabled = !state.busy) { Text("确认移除") } },
            dismissButton = { TextButton(onClick = { removingSeat = null }) { Text("取消") } })
    }
}

@Composable private fun ResultEditor(id: String, table: TableSnapshot, hand: CurrentHandDto,
                                      state: AppState, model: AppViewModel, onDismiss: () -> Unit) {
    val seats = table.seats.sortedBy { it.seatNo }
    var kind by remember(hand.id) { mutableStateOf("ron") }
    var winner by remember(hand.id) { mutableIntStateOf(seats.firstOrNull()?.seatNo ?: 0) }
    var loser by remember(hand.id) { mutableIntStateOf(seats.getOrNull(1)?.seatNo ?: 1) }
    var han by remember(hand.id) { mutableStateOf("2") }
    var fu by remember(hand.id) { mutableStateOf("30") }
    var river by remember(hand.id) { mutableStateOf("") }
    var attested by remember(hand.id) { mutableStateOf(false) }
    var tenpai by remember(hand.id) { mutableStateOf(emptySet<Int>()) }
    val tiles = river.trim().split(Regex("[\\s,，]+" )).filter(String::isNotBlank)
    val valid = seats.isNotEmpty() && (kind == "ryuukyoku" || seats.any { it.seatNo == winner } && when (kind) {
        "nagashi_mangan" -> attested && tiles.isNotEmpty() && tiles.all { Regex("(?:[19][mps]|[1-7]z)").matches(it) }
        "ron" -> (han.toIntOrNull()?.let { it in 1..130 } == true) &&
            (fu.toIntOrNull()?.let { it in 20..140 } == true) &&
            loser != winner && seats.any { it.seatNo == loser }
        "tsumo" -> (han.toIntOrNull()?.let { it in 1..130 } == true) &&
            (fu.toIntOrNull()?.let { it in 20..140 } == true)
        else -> false
    })
    val input = remember(kind, winner, loser, han, fu, river, attested, tenpai, seats) {
        if (!valid) null else buildJsonObject {
            put("kind", kind)
            if (kind == "ryuukyoku" || kind == "nagashi_mangan")
                put("tenpai", JsonArray(seats.map { JsonPrimitive(it.seatNo in tenpai) }))
            put("winners", JsonArray(if (kind == "ryuukyoku") emptyList() else listOf(buildJsonObject {
                put("seatNo", winner)
                put("han", if (kind == "nagashi_mangan") 5 else han.toInt())
                put("fu", if (kind == "nagashi_mangan") 30 else fu.toInt())
                if (kind == "ron") put("dealInSeatNo", loser)
            })))
            if (kind == "nagashi_mangan") put("nagashiEligibility", buildJsonArray { add(buildJsonObject {
                put("seatNo", winner)
                put("discards", buildJsonArray { tiles.forEach { tile ->
                    add(buildJsonObject { put("tile", tile); put("called", false) })
                } })
            }) })
        }
    }
    val preview = state.preview?.takeIf { input != null && it.matches(hand, input) }
    AlertDialog(onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text("本局支付 · 以服务端预览为准") },
        text = {
            Column(Modifier.heightIn(max = 550.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val scroll = androidx.compose.foundation.rememberScrollState()
                Column(Modifier.verticalScroll(scroll), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("ron" to "荣和", "tsumo" to "自摸", "ryuukyoku" to "荒牌流局", "nagashi_mangan" to "流局满贯")
                        .filterNot { it.first == "nagashi_mangan" && table.match.rulesSnapshot?.get("nagashiManganEnabled")?.jsonPrimitive?.booleanOrNull != true }
                        .forEach { (option, label) -> TextButton(onClick = { kind = option }) { Text("${if (kind == option) "●" else "○"} $label") } }
                    if (kind != "ryuukyoku") {
                        Text("赢家座位", color = Brand.text)
                        seats.forEach { seat -> TextButton(onClick = { winner = seat.seatNo }) { Text("${if (winner == seat.seatNo) "●" else "○"} ${seat.seatNo + 1}号位 ${seat.displayName.orEmpty()}") } }
                    }
                    if (kind == "ron") {
                        Text("放铳座位", color = Brand.text)
                        seats.filterNot { it.seatNo == winner }.forEach { seat -> TextButton(onClick = { loser = seat.seatNo }) { Text("${if (loser == seat.seatNo) "●" else "○"} ${seat.seatNo + 1}号位") } }
                    }
                    if (kind == "ron" || kind == "tsumo") {
                        OutlinedTextField(han, { han = it }, label = { Text("番（1–130）") })
                        OutlinedTextField(fu, { fu = it }, label = { Text("符（20–140）") })
                    }
                    if (kind == "ryuukyoku" || kind == "nagashi_mangan") seats.forEach { seat ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${seat.seatNo + 1} 号位听牌", color = Brand.text)
                            Checkbox(seat.seatNo in tenpai, { checked -> tenpai = if (checked) tenpai + seat.seatNo else tenpai - seat.seatNo })
                        }
                    }
                    if (kind == "nagashi_mangan") {
                        OutlinedTextField(river, { river = it; attested = false }, label = { Text("全部幺九弃牌（如 1m 9p 1z）") }, modifier = Modifier.fillMaxWidth())
                        Row { Checkbox(attested, { attested = it }); Text("确认记录完整，所有弃牌未被鸣走", color = Brand.text) }
                    }
                    if (!valid) Text("请填写有效座位、番符或完整流满证据", color = MaterialTheme.colorScheme.error)
                    if (preview != null) {
                        preview.output.perSeat.forEach { payment -> Text("${payment.seatNo + 1}号位 ${if (payment.netPoints >= 0) "+" else ""}${payment.netPoints} 点 · " +
                            payment.breakdown.joinToString(" / ") { "${it.reason} ${it.amount}" }, color = Brand.text) }
                        val next = preview.output.nextHand
                        Text("下一局 ${windLabel(next.roundWind)}${next.roundNumber} · 庄 ${next.dealerSeatNo + 1} · 本场${next.honba} · 供托${next.riichiPool}点", color = Brand.goldText)
                    }
                    state.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            Column {
                Button(onClick = { input?.let { model.preview(id, hand, it) } }, enabled = valid && !state.busy && state.pendingResult == null && hand.markRevision != null) { Text("服务端预览") }
                Button(onClick = { input?.let { model.submit(id, hand, it) } }, enabled = preview != null && !state.busy && state.pendingResult == null) { Text("确认并结算") }
            }
        }, dismissButton = { TextButton(onClick = onDismiss, enabled = !state.busy) { Text("关闭") } })
}
