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
    val isOwner = isTableHost(table, principal)
    val participant = isCheckedInParticipant(table, principal)
    val preparing = table.match.status == "preparing"
    val active = table.match.status == "in_progress" || table.match.status == "active"
    val hand = table.currentHand
    val open = active && hand?.status == "open"
    val between = active && (hand == null || hand.status == "settled")
    val drawn = table.match.seatingDrawnAt != null
    val legacyReady = table.seats.size == table.match.playerCount &&
        table.seats.all { it.status == "checked_in" }
    var showResult by remember(id) { mutableStateOf(false) }
    var confirmFinish by remember(id) { mutableStateOf(false) }
    var movingSeat by remember(id) { mutableStateOf<Int?>(null) }
    var removingMember by remember(id) { mutableStateOf<MemberDto?>(null) }
    val clipboard = LocalClipboardManager.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.actionError != null) Text(state.actionError, color = MaterialTheme.colorScheme.error)
        if (!participant && !isOwner) Text("未签到或旁观者仅可只读查看规则、分数、局摘要和终局；无权记分或确认。", color = Brand.muted)
        else if (isOwner && !participant && active) Text("桌主尚未签到，当前只能查看；请由已签到参赛者录入局结果。", color = Brand.muted)
        if (preparing && isOwner) {
            Text("桌主邀请与开局", color = Brand.goldText, style = MaterialTheme.typography.titleLarge)
            Text("分享房间码或十分钟加入链接。人齐后由桌主抽风定座，再开局。", color = Brand.text)
            table.match.joinCode?.let { code ->
                Text("房间码：$code", color = Brand.goldText)
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(code)) }) { Text("复制房间码") }
            }
            Button(onClick = { model.invite(id) }, enabled = !state.busy) { Text("生成十分钟加入链接") }
            state.invitation?.let { token ->
                val valid = runCatching { java.time.Instant.parse(token.expiresAt).isAfter(java.time.Instant.now()) }.getOrDefault(false)
                if (valid) {
                    val link = "https://riichi.p1ziyu.com/checkin/$id?token=${java.net.URLEncoder.encode(token.token, "UTF-8")}"
                    InvitationQr(link)
                    Text("单人一次性 · 截止 ${localMatchTime(token.expiresAt)}", color = Brand.text)
                    OutlinedButton(onClick = { clipboard.setText(AnnotatedString(link)) }) { Text("复制玩家加入链接") }
                } else Text("加入链接已过期，请重新生成", color = Brand.text)
            }
            Text("已加入成员 · 开局前可调整座位或移除成员", color = Brand.goldText)
            table.members.forEach { member ->
                if (member.seatNo != null) {
                    OutlinedButton(onClick = { movingSeat = member.seatNo }, enabled = !state.busy) {
                        Text("移动 / 交换 ${member.displayName}")
                    }
                }
                if (member.principalId != principal) {
                    OutlinedButton(onClick = { removingMember = member }, enabled = !state.busy) {
                        Text("移除 ${member.displayName}")
                    }
                }
            }
            if (!drawn) {
                if (table.members.size < table.match.playerCount && !legacyReady)
                    Text("还差 ${table.match.playerCount - table.members.size} 人", color = Brand.muted)
                Button(onClick = { model.drawSeats(id) },
                    enabled = !state.busy && mayDrawSeats(table)) {
                    Text("抽风定座")
                }
            }
            if (!drawn && !legacyReady) Text("人齐后先抽风定座", color = Brand.muted)
            Button(onClick = { model.finalizeSeats(id) }, enabled = !state.busy && mayStartMatch(table)) {
                Text("确认座次并开局")
            }
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
        if (active && !participant && !isOwner) Text("仅已签到参赛者可更改立直和提交局结果。", color = Brand.muted)
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
            if (!isOwner && !table.match.settlementConfirmed) Text("仅桌主可确认终局；此处可只读查看成绩。", color = Brand.muted)
        }
        state.pendingResult?.takeIf { it.matchId == id }?.let {
            Text("结果未确认：请刷新权威牌桌；未结算且立直版本未变才可原样重试，不能编辑后覆盖旧请求。", color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { model.refreshTable(id) }) { Text("刷新确认") }
            OutlinedButton(onClick = model::resend, enabled = !state.busy && participant &&
                mayResendPending(it, hand, state.pendingReviewed)) {
                Text("原请求重试（同一 clientEventId）")
            }
        }
    }
    if (confirmFinish) AlertDialog(onDismissRequest = { confirmFinish = false },
        title = { Text("结束本桌？") }, text = { Text("仅桌主可以结束牌局；终局条件以服务端规则为准。") },
        confirmButton = { TextButton(onClick = { confirmFinish = false; model.finish(id) }) { Text("确认终局") } },
        dismissButton = { TextButton(onClick = { confirmFinish = false }) { Text("取消") } })
    if (showResult && participant && hand != null && open) {
        ResultEditor(id, table, hand, state, { model.saveDraft(id, hand, it) },
            { model.preview(id, hand, it) }, { model.submit(id, hand, it) }) { showResult = false }
    }
    movingSeat?.let { from ->
        val source = table.members.firstOrNull { it.seatNo == from }
        if (source == null || !preparing || !isOwner) movingSeat = null else AlertDialog(
            onDismissRequest = { movingSeat = null },
            title = { Text("调整 ${source.displayName} 的座位") },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                    table.seats.sortedBy { it.seatNo }.filterNot { it.seatNo == from }.forEach { target ->
                        val occupant = table.members.firstOrNull { it.seatNo == target.seatNo }
                        TextButton(onClick = { movingSeat = null; model.reassignSeat(id, from, target.seatNo) },
                            enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                            Text("${target.seatNo + 1}号位 · ${occupant?.displayName ?: "空座"} · ${if (occupant == null) "移动" else "交换"}")
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { movingSeat = null }) { Text("取消") } })
    }
    removingMember?.let { selected ->
        val member = table.members.firstOrNull { it.principalId == selected.principalId }
        if (!preparing || !isOwner || member == null || member.principalId == principal) removingMember = null
        else AlertDialog(onDismissRequest = { removingMember = null },
            title = { Text("移除 ${member.displayName}？") },
            text = { Text(if (drawn) "移除成员后本桌抽风座次将重置，剩余成员需要重新抽风定座；该成员需要新的加入凭证才能重新加入。"
                else "该成员需要新的加入凭证才能重新加入。") },
            confirmButton = { TextButton(onClick = {
                removingMember = null
                model.removeMember(id, member.principalId)
            }, enabled = !state.busy) { Text("确认移除") } },
            dismissButton = { TextButton(onClick = { removingMember = null }) { Text("取消") } })
    }
}

@Composable fun ResultEditor(id: String, table: TableSnapshot, hand: CurrentHandDto,
                             state: AppState, onSave: (ResultDraft) -> Unit,
                             onPreview: (JsonObject) -> Unit, onSubmit: (JsonObject) -> Unit,
                             onDismiss: () -> Unit) {
    val seats = table.seats.sortedBy { it.seatNo }
    var draft by remember(hand.id) {
        mutableStateOf(state.draft?.takeIf { it.matchId == id && it.handId == hand.id }?.draft
            ?: ResultDraft(winners = seats.firstOrNull()?.let { listOf(WinnerDraft(it.seatNo)) }.orEmpty(),
                dealInSeatNo = seats.getOrNull(1)?.seatNo))
    }
    fun update(next: ResultDraft) {
        draft = next
        onSave(next)
    }
    val cap = ronWinnerLimit(table.match.rulesSnapshot, table.match.playerCount)
    val validated = validateResultDraft(draft, table, hand)
    val input = validated.input
    val preview = state.preview?.takeIf { input != null && it.matches(hand, input) }
    AlertDialog(onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text(if (state.session == SessionMode.LOCAL_ONLY) "本局支付 · 本机引擎预览" else "本局支付 · 以服务端预览为准") },
        text = {
            Column(Modifier.heightIn(max = 550.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("ron" to "荣和", "tsumo" to "自摸", "ryuukyoku" to "荒牌流局", "nagashi_mangan" to "流局满贯")
                    .filterNot { it.first == "nagashi_mangan" && table.match.rulesSnapshot?.get("nagashiManganEnabled")?.jsonPrimitive?.booleanOrNull != true }
                    .forEach { (option, label) ->
                        TextButton(onClick = { update(draft.copy(kind = option, declarationDealIn = false)) }) {
                            Text("${if (draft.kind == option) "●" else "○"} $label")
                        }
                    }
                if (draft.kind != "ryuukyoku") {
                    Text("赢家 · ${if (draft.kind == "ron") "本规则最多 $cap 位" else "仅一位"}", color = Brand.text)
                    seats.forEach { seat ->
                        val selected = draft.winners.any { it.seatNo == seat.seatNo }
                        val limit = if (draft.kind == "ron") cap else 1
                        OutlinedButton(onClick = {
                            val next = if (selected) draft.winners.filterNot { it.seatNo == seat.seatNo }
                                else if (limit == 1) listOf(WinnerDraft(seat.seatNo))
                                else draft.winners + WinnerDraft(seat.seatNo)
                            update(draft.copy(winners = next))
                        }, enabled = selected || draft.winners.size < limit, modifier = Modifier.fillMaxWidth()) {
                            Text("${if (selected) "●" else "○"} ${seat.seatNo + 1}号位 ${seat.displayName.orEmpty()}")
                        }
                    }
                }
                validated.errors["winners"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (draft.kind == "ron") {
                    Text("所有赢家共用同一放铳座位", color = Brand.text)
                    seats.filterNot { seat -> draft.winners.any { it.seatNo == seat.seatNo } }.forEach { seat ->
                        TextButton(onClick = { update(draft.copy(dealInSeatNo = seat.seatNo, declarationDealIn = false)) }) {
                            Text("${if (draft.dealInSeatNo == seat.seatNo) "●" else "○"} ${seat.seatNo + 1}号位")
                        }
                    }
                    validated.errors["dealInSeatNo"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    val marked = hand.seats.any { it.seatNo == draft.dealInSeatNo && it.isRiichi == true }
                    if (marked) Row {
                        Checkbox(draft.declarationDealIn, { update(draft.copy(declarationDealIn = it)) })
                        Text("放铳牌是该座的立直宣言牌", color = Brand.text)
                    }
                    validated.errors["declarationDealIn"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
                if (draft.kind == "ron" || draft.kind == "tsumo") draft.winners.forEachIndexed { index, winner ->
                    Text("${winner.seatNo + 1}号位番符 / 役满", color = Brand.goldText)
                    fun change(next: WinnerDraft) {
                        update(draft.copy(winners = draft.winners.toMutableList().also { it[index] = next }))
                    }
                    Row {
                        Checkbox(winner.yakuman, {
                            change(winner.copy(yakuman = it, yakumanCount = if (it) winner.yakumanCount else "0",
                                doubleYakumanCount = if (it) winner.doubleYakumanCount else "0"))
                        })
                        Text("显式役满（向服务器仍发送番 1、符 30）", color = Brand.text)
                    }
                    if (!winner.yakuman) {
                        OutlinedTextField(winner.han, { change(winner.copy(han = it)) },
                            label = { Text("番（1–130）") },
                            isError = "winners.$index.han" in validated.errors)
                        validated.errors["winners.$index.han"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        OutlinedTextField(winner.fu, { change(winner.copy(fu = it)) },
                            label = { Text("符（20–140）") },
                            isError = "winners.$index.fu" in validated.errors)
                        validated.errors["winners.$index.fu"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    } else {
                        val ordinaryCap = if (table.match.rulesSnapshot?.get("compositeYakuman")?.jsonPrimitive?.booleanOrNull == true) 10 else 1
                        OutlinedTextField(winner.yakumanCount, { change(winner.copy(yakumanCount = it)) },
                            label = { Text("普通役满数（0–$ordinaryCap）") },
                            isError = "winners.$index.yakumanCount" in validated.errors)
                        validated.errors["winners.$index.yakumanCount"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        if (table.match.rulesSnapshot?.get("doubleYakuman")?.jsonPrimitive?.booleanOrNull == true) {
                            OutlinedTextField(winner.doubleYakumanCount, { change(winner.copy(doubleYakumanCount = it)) },
                                label = { Text("特殊双倍役满数（0–10）") },
                                isError = "winners.$index.doubleYakumanCount" in validated.errors)
                            validated.errors["winners.$index.doubleYakumanCount"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
                if (draft.kind == "ryuukyoku" || draft.kind == "nagashi_mangan") seats.forEach { seat ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("${seat.seatNo + 1} 号位听牌", color = Brand.text)
                        Checkbox(seat.seatNo in draft.tenpai, { checked ->
                            update(draft.copy(tenpai = if (checked) draft.tenpai + seat.seatNo else draft.tenpai - seat.seatNo))
                        })
                    }
                }
                if (draft.kind == "nagashi_mangan") {
                    OutlinedTextField(draft.river, { update(draft.copy(river = it, attested = false)) },
                        label = { Text("全部幺九弃牌（如 1m 9p 1z）") }, modifier = Modifier.fillMaxWidth(),
                        isError = "river" in validated.errors)
                    Row { Checkbox(draft.attested, { update(draft.copy(attested = it)) }); Text("确认记录完整，所有弃牌未被鸣走", color = Brand.text) }
                    validated.errors["river"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
                validated.errors["seats"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                validated.errors["hand"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (state.marksChangedSincePreview)
                    Text("立直标记已变化，请重新预览", color = MaterialTheme.colorScheme.error)
                if (preview != null) {
                    preview.output.perSeat.forEach { payment -> Text("${payment.seatNo + 1}号位 ${if (payment.netPoints >= 0) "+" else ""}${payment.netPoints} 点 · " +
                        payment.breakdown.joinToString(" / ") { "${it.reason} ${it.amount}" }, color = Brand.text) }
                    val next = preview.output.nextHand
                    Text("下一局 ${windLabel(next.roundWind)}${next.roundNumber} · 庄 ${next.dealerSeatNo + 1} · 本场${next.honba} · 供托${next.riichiPool}点", color = Brand.goldText)
                }
                state.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Column {
                Button(onClick = { input?.let(onPreview) },
                    enabled = input != null && !state.busy && state.pendingResult == null) { Text("预览支付") }
                Button(onClick = { input?.let(onSubmit) },
                    enabled = preview != null && !state.busy && state.pendingResult == null) { Text("确认并结算") }
            }
        }, dismissButton = { TextButton(onClick = onDismiss, enabled = !state.busy) { Text("关闭") } })
}
