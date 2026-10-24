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

private val TABLE_REFRESH_EVENTS = setOf("member_joined", "seats_drawn", "seat_claimed", "join_approved",
    "check_in", "seats_finalized", "hand_started", "marks_changed", "hand_settled", "match_finished",
    "settlement_confirmed")
enum class SessionMode { RESTORING, SIGNED_OUT, ACCOUNT, ONLINE_GUEST, LOCAL_ONLY }

// iosfix6 item 5: the DELETE-vs-hide decision, kept as a pure function so
// unit tests pin it: only an owner deleting a preparing (not yet drawn)
// room may call DELETE; everything else hides per-user.
internal fun isDeletableMatch(match: MatchSummary): Boolean =
    match.isOwner && match.status == "preparing"
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
    val invitation: CheckInTokenDto? = null, val joinedMatchId: String? = null,
    val joinSeats: CheckInSeatsDto? = null, val joinPreviewLink: CheckInLink? = null,
    val preview: BoundPreview? = null, val terminal: BoundTerminal? = null,
    val draft: SavedResultDraft? = null, val draftEditVersion: Long = 0, val pendingReviewed: Boolean = false,
    val marksChangedSincePreview: Boolean = false,
    val pendingResult: PendingResult? = null, val createdMatchId: String? = null,
    val revokedTableId: String? = null, val accessNotice: String? = null,
    // iosfix6 item 5: 409-refused DELETE awaiting a hide fallback, and the
    // hidden row awaiting an undo tap. Kept in state (not the composable)
    // so a recomposition or list reload cannot lose them.
    val deleteRefusedId: String? = null, val hiddenUndoId: String? = null,
    val deleteError: String? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = TokenStore(application)
    private val api = ApiClient(store)
    private val pendingStore = PendingResultStore(application)
    private val draftStore = ResultDraftStore(application)
    private val joins = JoinActions(api, api.json)
    private val state = MutableStateFlow(AppState(
        session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
        authError = if (store.credentialInvalidated) "本机加密凭据不可读取，请重新登录" else null))
    val ui = state.asStateFlow()
    private val triggers = Channel<String>(Channel.CONFLATED)
    private var tableId: String? = null
    private var generation = 0
    @Volatile private var liveSocket: WebSocket? = null

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
                    profile = me, authError = null)
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
        draftStore.clear()
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
                state.value = AppState(session = SessionMode.ACCOUNT, profile = me)
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
                state.value = AppState(session = SessionMode.ONLINE_GUEST, profile = me)
            } catch (e: Exception) {
                state.value = state.value.copy(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
                    authBusy = false, authError = e.chineseMessage())
            }
        }
    }
    fun localOnly() {
        generation++
        liveSocket?.cancel()
        liveSocket = null
        tableId = null
        state.value = AppState(session = SessionMode.LOCAL_ONLY)
    }
    fun online() {
        generation++
        state.value = AppState(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT)
        if (state.value.session == SessionMode.RESTORING) restore()
    }
    fun logout() {
        generation++
        draftStore.clear()
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

    // iosfix6 item 5: swipe-to-delete. Only an owner deleting a preparing
    // (not yet drawn) room calls DELETE; every other row calls /hide, which
    // is per-user and reversible via the undo banner. A refused DELETE
    // (409 match_not_deletable) surfaces as deleteRefusedId so the UI can
    // offer hide instead; raw server messages never reach the UI.
    fun deleteOrHide(match: MatchSummary, asHide: Boolean = false) {
        if (state.value.busy) return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, deleteError = null)
            try {
                val hide = asHide || !isDeletableMatch(match)
                if (hide) api.post("/api/matches/${match.id}/hide") else api.delete("/api/matches/${match.id}")
                state.value = state.value.copy(
                    matches = state.value.matches?.filterNot { it.id == match.id },
                    hiddenUndoId = if (hide) match.id else null, busy = false)
                loadList()
            } catch (e: ApiFailure) {
                state.value = if (e.code == "match_not_deletable" && !asHide) {
                    state.value.copy(deleteRefusedId = match.id, busy = false)
                } else if (e.code == "forbidden") {
                    state.value.copy(deleteError = "你不是这张牌桌的成员，无法隐藏它。", busy = false)
                } else {
                    state.value.copy(deleteError = e.chineseMessage(), busy = false)
                }
            } catch (e: Exception) {
                state.value = state.value.copy(deleteError = "操作失败，请稍后重试。", busy = false)
            }
        }
    }

    fun unhideMatch(id: String) {
        viewModelScope.launch {
            try {
                api.post("/api/matches/$id/unhide")
                state.value = state.value.copy(hiddenUndoId = null)
                loadList()
            } catch (e: Exception) {
                state.value = state.value.copy(deleteError = e.chineseMessage())
            }
        }
    }

    fun clearDeleteRefused() { state.value = state.value.copy(deleteRefusedId = null) }
    fun clearHiddenUndo() { state.value = state.value.copy(hiddenUndoId = null) }
    fun clearDeleteError() { state.value = state.value.copy(deleteError = null) }

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
            tableError = null, preview = null, terminal = null, draft = null, pendingReviewed = false,
            marksChangedSincePreview = false, revokedTableId = null, connection = "手动刷新",
            pendingResult = state.value.profile?.principal?.id?.let { pendingStore.read(it, id) })
        refreshTable(id)
    }
    fun closeTable() {
        liveSocket?.cancel()
        liveSocket = null
        tableId = null
        state.value = state.value.copy(table = null, hands = null, settlement = null,
            invitation = null, preview = null, terminal = null, draft = null,
            pendingResult = null, pendingReviewed = false, marksChangedSincePreview = false,
            tableError = null, actionError = null, connection = "手动刷新")
    }
    private fun revokeTable(id: String) {
        if (tableId != id || state.value.revokedTableId == id) return
        state.value.draft?.takeIf { it.matchId == id }?.let {
            draftStore.clear(it.principalId, it.matchId, it.handId)
        }
        closeTable()
        generation++
        state.value = state.value.copy(matches = state.value.matches?.filterNot { it.id == id },
            revokedTableId = id, accessNotice = "你已被房主移出牌桌")
    }
    fun clearAccessNotice() { state.value = state.value.copy(revokedTableId = null, accessNotice = null) }
    private fun membershipRevoked(id: String, updated: TableSnapshot? = null,
                                  status: Int? = null, wsCloseCode: Int? = null,
                                  wsSignal: String? = null): Boolean =
        tableId == id && isMembershipRevoked(state.value.table, state.value.profile?.principal?.id,
            updated, status, wsCloseCode, wsSignal)
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
            if (membershipRevoked(id, updated = snapshot)) {
                revokeTable(id)
                return
            }
            val preview = state.value.preview?.takeIf {
                it.handId == snapshot.currentHand?.id && it.revision == snapshot.currentHand.markRevision &&
                    snapshot.currentHand.status == "open"
            }
            val changedMarks = state.value.table?.currentHand?.let { previous ->
                snapshot.currentHand?.let { hand ->
                    previous.id == hand.id && previous.markRevision != hand.markRevision
                }
            } == true
            val draft = snapshot.currentHand?.id?.let { handId ->
                state.value.profile?.principal?.id?.let { principalId -> draftStore.read(principalId, id, handId) }
            }
            val terminal = state.value.terminal?.takeIf { it.version == snapshot.match.version }
            val pending = state.value.pendingResult
            val resolution = pending?.let { pendingResolution(it, snapshot) }
            if (pending != null && resolution in listOf(PendingResolution.SETTLED, PendingResolution.CHANGED_REVISION)) {
                pendingStore.clear()
                if (resolution == PendingResolution.SETTLED) {
                    state.value.profile?.principal?.id?.let { principalId ->
                        draftStore.clear(principalId, id, pending.handId)
                    }
                }
            }
            state.value = state.value.copy(table = snapshot, tableLoading = false, tableError = null,
                preview = preview, terminal = terminal,
                draft = if (resolution == PendingResolution.SETTLED) null else draft,
                marksChangedSincePreview = (state.value.marksChangedSincePreview || changedMarks) &&
                    snapshot.currentHand?.status == "open",
                pendingResult = if (resolution == PendingResolution.SAME_REVISION ||
                    resolution == PendingResolution.UNVERIFIED) pending else null,
                pendingReviewed = resolution == PendingResolution.SAME_REVISION,
                actionError = when (resolution) {
                    PendingResolution.SETTLED -> "本局已由服务端结算，已清除待确认请求。"
                    PendingResolution.CHANGED_REVISION -> "立直标记已变化，请重新预览；旧请求不可重发，草稿已保留。"
                    else -> state.value.actionError
                },
                invitation = state.value.invitation?.takeIf { snapshot.match.status == "preparing" &&
                    runCatching { java.time.Instant.parse(it.expiresAt).isAfter(java.time.Instant.now()) }.getOrDefault(false) })
            try {
                val hands = api.json.decodeFromString<List<HandDto>>(api.get("/api/matches/$id/hands?limit=100"))
                if (tableId == id && at == generation) state.value = state.value.copy(hands = hands)
            } catch (e: Exception) {
                if (e is ApiFailure && membershipRevoked(id, status = e.status)) revokeTable(id)
                else if (tableId == id && at == generation) state.value = state.value.copy(tableError = "读取局记录失败：${error(e)}")
            }
            if (tableId != id || at != generation) return
            if (snapshot.match.status == "finished") {
                try {
                    val result = api.json.decodeFromString<SettlementPreview>(api.get("/api/matches/$id/settlement/preview"))
                    if (tableId == id && at == generation) state.value = state.value.copy(settlement = result)
                } catch (e: Exception) {
                    if (e is ApiFailure && membershipRevoked(id, status = e.status)) revokeTable(id)
                    else if (tableId == id && at == generation) state.value = state.value.copy(tableError = "读取终局成绩失败：${error(e)}")
                }
            } else if (tableId == id && at == generation) state.value = state.value.copy(settlement = null)
        } catch (e: Exception) {
            if (e is ApiFailure && membershipRevoked(id, status = e.status)) revokeTable(id)
            else if (tableId == id && at == generation) state.value = state.value.copy(tableLoading = false, tableError = error(e))
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
                    if (e is ApiFailure && membershipRevoked(id, status = e.status)) {
                        revokeTable(id)
                        return
                    }
                    if (store.load() == null) {
                        state.value = AppState(authError = "登录已失效，请重新认证")
                        return
                    }
                    state.value = state.value.copy(connection = "实时连接失败：${e.chineseMessage()}，可手动刷新")
                    if (e is ApiFailure && e.status == 401) return
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
                        viewModelScope.launch {
                            if (tableId == id) {
                                state.value = state.value.copy(connection = "已连接")
                                triggers.trySend(id)
                            }
                        }
                    }
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (tableId != id) return
                    val type = runCatching {
                        api.json.parseToJsonElement(text).jsonObject["type"]?.jsonPrimitive?.content
                    }.getOrNull()
                    if (membershipRevoked(id, wsSignal = type)) {
                        viewModelScope.launch { revokeTable(id) }
                    } else if (type != null && type in TABLE_REFRESH_EVENTS) {
                        triggers.trySend(id)
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (completed.compareAndSet(false, true)) {
                        if (response?.code == 401 || response?.code == 403)
                            continuation.resumeWithException(ApiFailure(response.code, "ws_forbidden", null, "实时连接被拒绝"))
                        else continuation.resume(Unit)
                    }
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (completed.compareAndSet(false, true)) {
                        if (membershipRevoked(id, wsCloseCode = code))
                            continuation.resumeWithException(ApiFailure(403, "ws_revoked", null, "实时访问权限已撤销"))
                        else continuation.resume(Unit)
                    }
                }
            })
            liveSocket = socket
            continuation.invokeOnCancellation { socket.cancel(); if (liveSocket === socket) liveSocket = null }
        }
        liveSocket = null
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
                    if (e is ApiFailure && id != null && membershipRevoked(id, status = e.status)) {
                        revokeTable(id)
                    } else {
                        if (e is ApiFailure && e.status == 409 && id != null) {
                            state.value = state.value.copy(preview = null, terminal = null)
                            refreshTable(id)
                        }
                        state.value = state.value.copy(actionError = error(e))
                    }
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
    private fun requireHost(id: String): TableSnapshot {
        val table = requireNotNull(state.value.table?.takeIf { it.match.id == id && tableId == id }) { "请先刷新牌桌" }
        check(isTableHost(table, state.value.profile?.principal?.id)) { "只有桌主可以操作" }
        return table
    }
    private fun requireParticipant(id: String): TableSnapshot {
        val table = requireNotNull(state.value.table?.takeIf { it.match.id == id && tableId == id }) { "请先刷新牌桌" }
        check(isCheckedInParticipant(table, state.value.profile?.principal?.id)) { "只有已签到参赛者可以操作" }
        return table
    }
    fun drawSeats(id: String) = operation(id) {
        val table = requireHost(id)
        check(table.match.status == "preparing" && table.match.seatingDrawnAt == null) { "座位已确定" }
        joins.draw(id)
    }
    fun invite(id: String) = operation(id) {
        check(requireHost(id).match.status == "preparing") { "座位已确认" }
        val token = api.json.decodeFromString<CheckInTokenDto>(api.post("/api/matches/$id/check-in-tokens"))
        if (tableId == id) state.value = state.value.copy(invitation = token)
    }
    fun finalizeSeats(id: String) = operation(id) {
        check(requireHost(id).match.status == "preparing") { "座位已确认" }
        api.post("/api/matches/$id/seats/finalize")
    }
    fun beginCheckIn() {
        state.value = state.value.copy(joinedMatchId = null,
            joinSeats = null, joinPreviewLink = null, actionError = null)
    }
    fun previewJoin(link: CheckInLink) = operation(null) {
        state.value = state.value.copy(joinSeats = null, joinPreviewLink = null)
        val preview = joins.seats(link)
        state.value = state.value.copy(joinSeats = preview, joinPreviewLink = link,
            joinedMatchId = if (preview.caller.isOwner) link.matchId else null)
    }
    fun checkIn(link: CheckInLink, alias: String?) = operation(null) {
        val result = joins.checkIn(link, alias)
        val preview = state.value.joinSeats?.takeIf { state.value.joinPreviewLink == link }
        state.value = state.value.copy(joinSeats = preview?.let {
            val alreadyPresent = it.members.any { member -> member.principalId == result.member.principalId }
            it.copy(caller = it.caller.copy(isMember = true),
                members = if (alreadyPresent) it.members
                    else it.members + MemberDto(result.member.principalId, result.member.displayName),
                seating = it.seating.copy(memberCount = it.seating.memberCount + if (alreadyPresent) 0 else 1))
        })
        loadList()
    }
    fun openJoinedMatch(id: String) { state.value = state.value.copy(joinedMatchId = id) }
    fun clearJoinedMatch() { state.value = state.value.copy(joinedMatchId = null) }
    fun byCode(code: String, onResolved: (CheckInLink) -> Unit) = operation(null) {
        state.value = state.value.copy(joinSeats = null, joinPreviewLink = null)
        val result = joins.resolve(code)
        onResolved(CheckInLink(result.matchId, result.token,
            "https://riichi.p1ziyu.com/checkin/${result.matchId}?token=${java.net.URLEncoder.encode(result.token, "UTF-8")}"))
    }
    fun reassignSeat(id: String, fromSeatNo: Int, toSeatNo: Int) = operation(id) {
        val table = requireHost(id)
        check(table.match.status == "preparing" &&
            table.match.ownerPrincipalId == state.value.profile?.principal?.id &&
            fromSeatNo != toSeatNo && table.seats.any { it.seatNo == fromSeatNo && it.principalId != null } &&
            table.seats.any { it.seatNo == toSeatNo }) { "座位已变化，请刷新牌桌" }
        joins.reassign(id, fromSeatNo, toSeatNo)
    }
    fun removeMember(id: String, principalId: String) = operation(id) {
        val table = requireHost(id)
        check(table.match.status == "preparing" &&
            principalId != table.match.ownerPrincipalId &&
            table.members.any { it.principalId == principalId }) { "成员已变化，请刷新牌桌" }
        joins.remove(id, principalId)
    }
    fun mark(id: String, hand: CurrentHandDto, seat: HandSeatDto, riichi: Boolean) = operation(id) {
        requireParticipant(id)
        val rules = state.value.table?.match?.rulesSnapshot
        changeMark(api, id, hand, state.value.table?.currentHand, seat,
            rules?.get("allowLowPointRiichi")?.jsonPrimitive?.booleanOrNull == true, riichi) { refreshTable(id) }
        state.value = state.value.copy(preview = null)
    }
    fun preview(id: String, hand: CurrentHandDto, input: JsonObject) = operation(id) {
        requireParticipant(id)
        val handId = requireNotNull(hand.id)
        val revision = requireNotNull(hand.markRevision)
        val editVersion = state.value.draftEditVersion
        val output = api.json.decodeFromString<PaymentPreview>(api.post("/api/matches/$id/hands/$handId/preview",
            buildJsonObject { put("resultInput", input) }.toString()))
        val seatNos = state.value.table?.seats?.map { it.seatNo }?.toSet().orEmpty()
        check(output.perSeat.map { it.seatNo }.toSet() == seatNos && output.perSeat.size == seatNos.size) { "服务端未提供完整支付预览" }
        if (tableId == id && state.value.draftEditVersion == editVersion &&
            state.value.table?.currentHand?.id == handId &&
            state.value.table?.currentHand?.markRevision == revision)
            state.value = state.value.copy(preview = BoundPreview(handId, revision, input.toString(), output),
                marksChangedSincePreview = false)
    }
    fun saveDraft(id: String, hand: CurrentHandDto, draft: ResultDraft) {
        val principalId = state.value.profile?.principal?.id ?: return
        val handId = hand.id ?: return
        if (tableId != id || state.value.table?.currentHand?.id != handId || !isCheckedInParticipant(state.value.table, principalId)) return
        val record = SavedResultDraft(principalId, id, handId, hand.markRevision, draft)
        state.value = state.value.copy(preview = null, draftEditVersion = state.value.draftEditVersion + 1)
        try {
            draftStore.save(record)
            state.value = state.value.copy(draft = record)
        } catch (e: Exception) {
            state.value = state.value.copy(actionError = "草稿保存失败：${e.message}")
        }
    }
    fun submit(id: String, hand: CurrentHandDto, input: JsonObject) {
        val preview = state.value.preview ?: return
        if (!preview.matches(hand, input) || state.value.busy || tableId != id ||
            !isCheckedInParticipant(state.value.table, state.value.profile?.principal?.id) ||
            state.value.table?.currentHand?.id != hand.id ||
            state.value.table?.currentHand?.markRevision != hand.markRevision) return
        val principalId = state.value.profile?.principal?.id ?: return
        val pending = PendingResult(id, preview.handId, resultBody(input, preview.revision))
        try { pendingStore.save(principalId, pending) }
        catch (e: Exception) { state.value = state.value.copy(actionError = "无法保存待提交请求：${e.message}"); return }
        state.value = state.value.copy(pendingResult = pending, pendingReviewed = false)
        sendPending(pending)
    }
    private fun sendPending(pending: PendingResult) = operation(pending.matchId) {
        requireParticipant(pending.matchId)
        val principalId = requireNotNull(state.value.profile?.principal?.id)
        check(state.value.pendingResult == pending &&
            pendingStore.read(principalId, pending.matchId) == pending) { "待确认原请求已变化" }
        api.post("/api/matches/${pending.matchId}/hands/${pending.handId}/results", pending.body)
        pendingStore.clear()
        draftStore.clear(principalId, pending.matchId, pending.handId)
        state.value = state.value.copy(pendingResult = null, pendingReviewed = false, draft = null, preview = null)
    }
    fun resend() {
        val pending = state.value.pendingResult ?: return
        if (!mayResendPending(pending, state.value.table?.currentHand, state.value.pendingReviewed)) {
            state.value = state.value.copy(actionError = "请先刷新核对本局仍未结算且立直版本未变；不能自动改写请求")
            return
        }
        sendPending(pending)
    }
    fun nextHand(id: String) = operation(id) {
        check(requireParticipant(id).match.status == "in_progress") { "牌局已结束" }
        api.post("/api/matches/$id/hands")
    }
    fun finish(id: String) = operation(id) {
        check(requireHost(id).match.status == "in_progress") { "牌局已结束" }
        api.post("/api/matches/$id/finish")
    }
    fun terminalPreview(id: String) = operation(id) {
        val version = state.value.table?.match?.version ?: throw IllegalStateException("缺少牌桌版本")
        val output = api.json.decodeFromString<SettlementPreview>(api.get("/api/matches/$id/settlement/preview"))
        if (tableId == id && state.value.table?.match?.version == version) state.value = state.value.copy(terminal = BoundTerminal(version, output))
    }
    fun confirmSettlement(id: String) = operation(id) {
        requireHost(id)
        check(state.value.terminal?.version == state.value.table?.match?.version) { "请先预览当前终局成绩" }
        api.post("/api/matches/$id/settlement/confirm")
        state.value = state.value.copy(terminal = null)
    }
}
