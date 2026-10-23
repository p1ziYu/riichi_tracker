package com.p1ziyu.riichitracker.p1

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private fun Throwable.chineseMessage(): String = when (this) {
    is ApiFailure -> apiFailureMessage(this)
    else -> message ?: "网络连接失败，请重试"
}

enum class SessionMode { RESTORING, SIGNED_OUT, ACCOUNT, ONLINE_GUEST, LOCAL_ONLY }
data class PendingResult(val matchId: String, val handId: String, val body: String)
data class BoundPreview(val handId: String, val revision: Long, val input: String, val output: PaymentPreview)
data class BoundTerminal(val version: Long, val output: SettlementPreview)
data class AppState(
    val session: SessionMode = SessionMode.SIGNED_OUT, val registering: Boolean = false,
    val authBusy: Boolean = false, val authError: String? = null,
    val matches: List<MatchSummary>? = null, val listLoading: Boolean = false,
    val listError: String? = null, val templates: List<TemplateDto> = emptyList(),
    val table: TableSnapshot? = null, val hands: List<HandDto>? = null,
    val settlement: SettlementPreview? = null, val tableLoading: Boolean = false,
    val tableError: String? = null, val connection: String = "手动刷新", val connectionEpoch: Int = 0,
    val profile: MeResponse? = null, val profileError: String? = null,
    val diagnostic: String? = null, val busy: Boolean = false, val actionError: String? = null,
    val invitation: CheckInTokenDto? = null, val joinedSeat: Int? = null, val joinedMatchId: String? = null,
    val receipt: JoinReceipt? = null, val approvalReady: Boolean = false,
    val approvalWaiting: Boolean = false,
    val preview: BoundPreview? = null, val terminal: BoundTerminal? = null,
    val pendingResult: PendingResult? = null, val createdMatchId: String? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = TokenStore(application)
    private val api = ApiClient(store)
    private val pendingStore = PendingResultStore(application)
    private val receiptStore = JoinReceiptStore(application)
    private val joins = JoinActions(api, api.json)
    private val state = MutableStateFlow(AppState(
        session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
        authError = if (store.credentialInvalidated) "本机加密凭据不可读取，请重新登录" else null))
    val ui = state.asStateFlow()
    private val triggers = Channel<String>(Channel.CONFLATED)
    private var tableId: String? = null
    private var generation = 0

    init {
        viewModelScope.launch {
            for (id in triggers) if (tableId == id) loadTable(id)
        }
        if (state.value.session == SessionMode.RESTORING) restore()
    }
    private fun restore() {
        val at = generation
        viewModelScope.launch {
            try {
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                if (at == generation) state.value = state.value.copy(
                    session = if (me.principal.type == "guest") SessionMode.ONLINE_GUEST else SessionMode.ACCOUNT,
                    profile = me, receipt = receiptStore.read(me.principal.id), authError = null)
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(
                    session = if (store.load() == null) SessionMode.SIGNED_OUT else SessionMode.RESTORING,
                    authError = if (store.load() == null) "登录已失效，请重新认证" else "恢复会话失败：${e.chineseMessage()}")
            }
        }
    }
    fun retryRestore() { if (store.load() != null) restore() else state.value = AppState(authError = "登录已失效，请重新认证") }
    fun abandonRestore() {
        store.clear()
        pendingStore.clear()
        generation++
        state.value = AppState()
    }

    fun mode(register: Boolean) { state.value = state.value.copy(registering = register, authError = null) }
    fun login(email: String, password: String, name: String?) {
        if (state.value.authBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(authBusy = true, authError = null)
            try {
                api.signIn(email.trim(), password, name?.trim())
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                generation++
                state.value = AppState(session = SessionMode.ACCOUNT, profile = me, receipt = receiptStore.read(me.principal.id))
            } catch (error: Exception) {
                state.value = state.value.copy(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
                    authBusy = false, authError = "登录或注册失败：${error.chineseMessage()}")
            }
        }
    }
    fun guest() {
        if (state.value.authBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(authBusy = true, authError = null)
            try {
                api.anonymous()
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                generation++
                state.value = AppState(session = SessionMode.ONLINE_GUEST, profile = me, receipt = receiptStore.read(me.principal.id))
            } catch (e: Exception) {
                state.value = state.value.copy(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
                    authBusy = false, authError = e.chineseMessage())
            }
        }
    }
    fun localOnly() { state.value = state.value.copy(session = SessionMode.LOCAL_ONLY) }
    fun online() {
        state.value = state.value.copy(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT)
        if (state.value.session == SessionMode.RESTORING) restore()
    }
    fun logout() {
        generation++
        pendingStore.clear()
        tableId = null
        state.value = AppState(authBusy = true)
        viewModelScope.launch {
            var remoteFailed = false
            try { api.signOut() } catch (_: Exception) { store.clear(); remoteFailed = true }
            state.value = AppState(authError = if (remoteFailed) "本机已退出；离线退出不保证服务器会话立即撤销" else null)
        }
    }

    private fun error(error: Exception): String {
        if (store.load() == null && state.value.session != SessionMode.LOCAL_ONLY)
            state.value = AppState(authError = "登录已失效，请重新认证")
        return error.chineseMessage()
    }

    fun loadList() {
        if (state.value.session != SessionMode.ACCOUNT && state.value.session != SessionMode.ONLINE_GUEST) return
        val at = generation
        viewModelScope.launch {
            state.value = state.value.copy(listLoading = true, listError = null)
            try {
                val matches = api.json.decodeFromString<List<MatchSummary>>(api.get("/api/matches?mine=1"))
                if (at == generation) state.value = state.value.copy(matches = matches, listLoading = false)
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(listLoading = false, listError = error(e))
            }
        }
        viewModelScope.launch {
            try {
                val templates = api.json.decodeFromString<List<TemplateDto>>(api.get("/api/rulesets/templates"))
                if (at == generation) state.value = state.value.copy(templates = templates)
            } catch (e: Exception) { if (at == generation) state.value = state.value.copy(listError = "读取模板失败：${error(e)}") }
        }
    }

    fun loadProfile() {
        viewModelScope.launch {
            state.value = state.value.copy(profileError = null)
            try { state.value = state.value.copy(profile = api.json.decodeFromString(api.get("/api/me"))) }
            catch (e: Exception) { state.value = state.value.copy(profileError = error(e)) }
        }
    }

    fun runDiagnostic() { state.value = state.value.copy(diagnostic = engineDiagnostic()) }

    fun openTable(id: String) {
        tableId = id
        state.value = state.value.copy(table = null, hands = null, settlement = null, invitation = null,
            tableError = null, preview = null, terminal = null, connection = "手动刷新",
            pendingResult = state.value.profile?.principal?.id?.let { pendingStore.read(it, id) })
        refreshTable(id)
    }
    fun closeTable() {
        tableId = null
        state.value = state.value.copy(table = null, invitation = null, preview = null, terminal = null, connection = "手动刷新")
    }
    fun refreshTable(id: String) { triggers.trySend(id) }
    fun reconnect(id: String) {
        if (tableId == id) {
            state.value = state.value.copy(connectionEpoch = state.value.connectionEpoch + 1)
            refreshTable(id)
        }
    }

    private suspend fun loadTable(id: String) {
        val at = generation
        if (state.value.table == null) state.value = state.value.copy(tableLoading = true)
        try {
            val snapshot = api.json.decodeFromString<TableSnapshot>(api.get("/api/matches/$id"))
            if (tableId != id || at != generation) return
            val preview = state.value.preview?.takeIf {
                it.handId == snapshot.currentHand?.id && it.revision == snapshot.currentHand.markRevision &&
                    snapshot.currentHand.status == "open"
            }
            val terminal = state.value.terminal?.takeIf { it.version == snapshot.match.version }
            state.value = state.value.copy(table = snapshot, tableLoading = false, tableError = null,
                preview = preview, terminal = terminal,
                invitation = state.value.invitation?.takeIf { snapshot.match.status == "preparing" &&
                    runCatching { java.time.Instant.parse(it.expiresAt).isAfter(java.time.Instant.now()) }.getOrDefault(false) })
            try {
                val hands = api.json.decodeFromString<List<HandDto>>(api.get("/api/matches/$id/hands?limit=100"))
                if (tableId == id && at == generation) state.value = state.value.copy(hands = hands)
            } catch (e: Exception) { if (tableId == id && at == generation) state.value = state.value.copy(tableError = "读取局记录失败：${error(e)}") }
            if (snapshot.match.status == "finished") {
                try {
                    val result = api.json.decodeFromString<SettlementPreview>(api.get("/api/matches/$id/settlement/preview"))
                    if (tableId == id && at == generation) state.value = state.value.copy(settlement = result)
                } catch (e: Exception) { if (tableId == id && at == generation) state.value = state.value.copy(tableError = "读取终局成绩失败：${error(e)}") }
            } else if (tableId == id && at == generation) state.value = state.value.copy(settlement = null)
        } catch (e: Exception) {
            if (tableId == id && at == generation) state.value = state.value.copy(tableLoading = false, tableError = error(e))
        }
    }

    /** Called only from a STARTED lifecycle collector on the visible table route. */
    suspend fun liveWhileVisible(id: String) {
        var failures = 0
        try {
            while (kotlin.coroutines.coroutineContext.isActive && tableId == id && state.value.session in listOf(SessionMode.ACCOUNT, SessionMode.ONLINE_GUEST)) {
                state.value = state.value.copy(connection = "重连中")
                try {
                    val ticket = api.json.decodeFromString<TicketDto>(api.post("/api/matches/$id/ws-tickets")).ticket
                    if (ticket.isBlank()) throw IOException("实时连接凭据缺失")
                    val openedAt = awaitSocket(id, ticket)
                    if (openedAt != 0L && android.os.SystemClock.elapsedRealtime() - openedAt >= 10_000L) failures = 0
                } catch (cancel: CancellationException) { throw cancel }
                catch (e: Exception) {
                    if (store.load() == null) {
                        state.value = AppState(authError = "登录已失效，请重新认证")
                        return
                    }
                    state.value = state.value.copy(connection = "实时连接失败：${e.chineseMessage()}，可手动刷新")
                    if (e is ApiFailure && e.status in listOf(401, 403)) return
                }
                failures++
                if (failures >= 5) {
                    state.value = state.value.copy(connection = "实时连接已暂停，可手动重连并刷新")
                    return
                }
                delay((1000L shl (failures - 1)).coerceAtMost(30_000L))
            }
        } finally {
            if (tableId == id && !state.value.connection.startsWith("实时连接失败") &&
                !state.value.connection.startsWith("实时连接已暂停"))
                state.value = state.value.copy(connection = "手动刷新")
        }
    }

    private suspend fun awaitSocket(id: String, ticket: String): Long {
        val openedAt = java.util.concurrent.atomic.AtomicLong(0L)
        suspendCancellableCoroutine<Unit> { continuation ->
            val completed = java.util.concurrent.atomic.AtomicBoolean()
            val request = Request.Builder().url("${api.wsOrigin}/ws/matches/$id?ticket=${java.net.URLEncoder.encode(ticket, "UTF-8")}").build()
            val socket = api.client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (continuation.isActive && tableId == id) {
                        openedAt.set(android.os.SystemClock.elapsedRealtime())
                        viewModelScope.launch { state.value = state.value.copy(connection = "已连接"); triggers.trySend(id) }
                    }
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (tableId == id && runCatching {
                        api.json.parseToJsonElement(text).jsonObject["type"]?.jsonPrimitive?.content
                    }.getOrNull() != null) triggers.trySend(id)
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (completed.compareAndSet(false, true)) {
                        if (response?.code == 401 || response?.code == 403)
                            continuation.resumeWithException(ApiFailure(response.code, "ws_forbidden", null, "实时连接被拒绝"))
                        else continuation.resume(Unit)
                    }
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (completed.compareAndSet(false, true)) continuation.resume(Unit)
                }
            })
            continuation.invokeOnCancellation { socket.cancel() }
        }
        return openedAt.get()
    }
    private fun operation(id: String?, command: suspend () -> Unit) {
        if (state.value.busy) return
        val at = generation
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, actionError = null)
            try {
                command()
                if (at == generation && id != null) refreshTable(id)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (at == generation) {
                    if (e is ApiFailure && e.status == 409 && id != null) {
                        state.value = state.value.copy(preview = null, terminal = null)
                        refreshTable(id)
                    }
                    state.value = state.value.copy(actionError = error(e))
                }
            } finally { if (at == generation) state.value = state.value.copy(busy = false) }
        }
    }
    fun createMatch(rules: OnlineRules) = operation(null) {
        if (state.value.session != SessionMode.ACCOUNT) throw IllegalStateException("仅注册用户可创建在线牌桌")
        val match = api.json.decodeFromString<CreatedMatch>(api.post("/api/matches", rules.payload()))
        state.value = state.value.copy(createdMatchId = match.match.id)
        loadList()
    }
    fun clearCreatedMatch() { state.value = state.value.copy(createdMatchId = null) }
    fun claim(id: String, seatNo: Int) = operation(id) {
        api.post("/api/matches/$id/seats/claim", """{"seatNo":$seatNo}""")
    }
    fun invite(id: String) = operation(id) {
        val token = api.json.decodeFromString<CheckInTokenDto>(api.post("/api/matches/$id/check-in-tokens"))
        if (tableId == id) state.value = state.value.copy(invitation = token)
    }
    fun finalizeSeats(id: String, dealer: Int?) = operation(id) {
        api.post("/api/matches/$id/seats/finalize", finalizeBody(dealer))
    }
    fun beginCheckIn() { state.value = state.value.copy(joinedSeat = null, joinedMatchId = null, actionError = null) }
    fun requestJoin(matchId: String) = operation(null) {
        val principal = requireNotNull(state.value.profile?.principal) { "请先登录" }
        val existing = state.value.receipt
        val receipt = joins.request(matchId, principal.displayName, existing)
        if (receipt == existing) return@operation
        receiptStore.save(principal.id, receipt)
        state.value = state.value.copy(receipt = receipt, approvalReady = false, approvalWaiting = false)
    }
    fun discardReceipt() {
        state.value.profile?.principal?.id?.let { receiptStore.clear(it) }
        state.value = state.value.copy(receipt = null, approvalReady = false, approvalWaiting = false)
    }
    /** Called by the visible check-in route; bounded so foreground waiting never spins forever. */
    suspend fun pollApproval(receipt: JoinReceipt) {
        val at = generation
        state.value = state.value.copy(approvalWaiting = true)
        try {
            repeat(5) { attempt ->
                if (at != generation || state.value.receipt != receipt) return
                try {
                    if (joins.approved(receipt.matchId)) {
                        state.value = state.value.copy(approvalReady = true, approvalWaiting = false, actionError = null)
                        return
                    }
                } catch (e: CancellationException) { throw e
                } catch (e: Exception) {
                    state.value = state.value.copy(actionError = error(e))
                    return
                }
                if (attempt < 4) delay(3000)
            }
        } finally { if (at == generation) state.value = state.value.copy(approvalWaiting = false) }
    }
    fun checkIn(link: CheckInLink, sourceCode: String? = null) = operation(null) {
        val result = joins.checkInRecovering(link, sourceCode)
        state.value.profile?.principal?.id?.let { receiptStore.clear(it) }
        state.value = state.value.copy(joinedSeat = result.seat.seatNo, joinedMatchId = link.matchId,
            receipt = null, approvalReady = false)
        loadList()
    }
    fun clearJoinedMatch() { state.value = state.value.copy(joinedMatchId = null) }
    fun byCode(code: String, onResolved: (CheckInLink) -> Unit) = operation(null) {
        val result = joins.resolve(code)
        onResolved(CheckInLink(result.matchId, result.token,
            "https://riichi.p1ziyu.com/checkin/${result.matchId}?token=${java.net.URLEncoder.encode(result.token, "UTF-8")}"))
    }
    fun approveReceipt(id: String, receipt: JoinReceipt, seatNo: Int, onApproved: () -> Unit) = operation(id) {
        val table = state.value.table ?: throw IllegalStateException("请先刷新牌桌")
        check(table.match.id == id && table.match.status == "preparing" &&
            table.match.ownerPrincipalId == state.value.profile?.principal?.id &&
            table.seats.any { it.seatNo == seatNo && it.principalId == null }) { "座位已变化，请刷新牌桌" }
        joins.approve(receipt, seatNo, id)
        onApproved()
    }
    fun mark(id: String, hand: CurrentHandDto, seat: HandSeatDto, riichi: Boolean) = operation(id) {
        val rules = state.value.table?.match?.rulesSnapshot
        changeMark(api, id, hand, state.value.table?.currentHand, seat,
            rules?.get("allowLowPointRiichi")?.jsonPrimitive?.booleanOrNull == true, riichi) { refreshTable(id) }
        state.value = state.value.copy(preview = null)
    }
    fun preview(id: String, hand: CurrentHandDto, input: JsonObject) = operation(id) {
        val handId = requireNotNull(hand.id)
        val revision = requireNotNull(hand.markRevision)
        val output = api.json.decodeFromString<PaymentPreview>(api.post("/api/matches/$id/hands/$handId/preview",
            buildJsonObject { put("resultInput", input) }.toString()))
        val seatNos = state.value.table?.seats?.map { it.seatNo }?.toSet().orEmpty()
        check(output.perSeat.map { it.seatNo }.toSet() == seatNos && output.perSeat.size == seatNos.size) { "服务端未提供完整支付预览" }
        if (tableId == id && state.value.table?.currentHand?.id == handId &&
            state.value.table?.currentHand?.markRevision == revision)
            state.value = state.value.copy(preview = BoundPreview(handId, revision, input.toString(), output))
    }
    fun submit(id: String, hand: CurrentHandDto, input: JsonObject) {
        val preview = state.value.preview ?: return
        if (!preview.matches(hand, input)) return
        if (state.value.pendingResult != null) return
        val body = resultBody(input, preview.revision)
        val pending = PendingResult(id, preview.handId, body)
        val principalId = state.value.profile?.principal?.id ?: return
        try { pendingStore.save(principalId, pending) }
        catch (e: Exception) { state.value = state.value.copy(actionError = "无法保存待提交请求：${e.message}"); return }
        state.value = state.value.copy(pendingResult = pending)
        resend()
    }
    fun resend() {
        val pending = state.value.pendingResult ?: return
        operation(pending.matchId) {
            api.post("/api/matches/${pending.matchId}/hands/${pending.handId}/results", pending.body)
            pendingStore.clear()
            state.value = state.value.copy(pendingResult = null, preview = null)
        }
    }
    fun resolvePendingWithoutResend() {
        // Only the user may discard an uncertain request after checking the authoritative table.
        pendingStore.clear()
        state.value = state.value.copy(pendingResult = null)
    }
    fun nextHand(id: String) = operation(id) { api.post("/api/matches/$id/hands") }
    fun finish(id: String) = operation(id) { api.post("/api/matches/$id/finish") }
    fun terminalPreview(id: String) = operation(id) {
        val version = state.value.table?.match?.version ?: throw IllegalStateException("缺少牌桌版本")
        val output = api.json.decodeFromString<SettlementPreview>(api.get("/api/matches/$id/settlement/preview"))
        if (tableId == id && state.value.table?.match?.version == version) state.value = state.value.copy(terminal = BoundTerminal(version, output))
    }
    fun confirmSettlement(id: String) = operation(id) {
        check(state.value.terminal?.version == state.value.table?.match?.version) { "请先预览当前终局成绩" }
        api.post("/api/matches/$id/settlement/confirm")
        state.value = state.value.copy(terminal = null)
    }
}
