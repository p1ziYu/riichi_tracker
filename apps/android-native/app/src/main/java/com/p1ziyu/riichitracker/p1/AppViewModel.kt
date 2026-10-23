package com.p1ziyu.riichitracker.p1

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import kotlin.coroutines.resume

private fun Throwable.chineseMessage(): String = message ?: "网络连接失败，请重试"

data class AppState(
    val authenticated: Boolean = false, val registering: Boolean = false,
    val authBusy: Boolean = false, val authError: String? = null,
    val matches: List<MatchSummary>? = null, val listLoading: Boolean = false,
    val listError: String? = null, val templates: List<TemplateDto> = emptyList(),
    val table: TableSnapshot? = null, val hands: List<HandDto>? = null,
    val settlement: SettlementPreview? = null, val tableLoading: Boolean = false,
    val tableError: String? = null, val connection: String = "手动刷新",
    val profile: MeResponse? = null, val profileError: String? = null,
    val diagnostic: String? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = TokenStore(application)
    private val api = ApiClient(store)
    private val state = MutableStateFlow(AppState(authenticated = store.load() != null))
    val ui = state.asStateFlow()
    private val triggers = Channel<String>(Channel.CONFLATED)
    private var tableId: String? = null

    init {
        viewModelScope.launch {
            for (id in triggers) if (tableId == id) loadTable(id, initial = false)
        }
    }

    fun mode(register: Boolean) { state.value = state.value.copy(registering = register, authError = null) }
    fun login(email: String, password: String, name: String?) {
        if (state.value.authBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(authBusy = true, authError = null)
            try {
                api.signIn(email.trim(), password, name?.trim())
                api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                state.value = state.value.copy(authenticated = true, authBusy = false)
            } catch (error: Exception) {
                state.value = state.value.copy(authBusy = false, authError = "登录或注册失败：${error.chineseMessage()}")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try { api.signOut() }
            catch (_: Exception) { store.clear() }
            finally {
                tableId = null
                state.value = AppState()
            }
        }
    }

    private fun error(error: Exception): String {
        if (store.load() == null) state.value = AppState()
        return error.chineseMessage()
    }

    fun loadList() {
        viewModelScope.launch {
            state.value = state.value.copy(listLoading = true, listError = null)
            try {
                val matches = api.json.decodeFromString<List<MatchSummary>>(api.get("/api/matches?mine=1"))
                state.value = state.value.copy(matches = matches, listLoading = false)
            } catch (e: Exception) {
                val message = error(e)
                state.value = state.value.copy(listLoading = false, listError = message)
            }
        }
        viewModelScope.launch {
            try {
                val templates = api.json.decodeFromString<List<TemplateDto>>(api.get("/api/rulesets/templates"))
                state.value = state.value.copy(templates = templates)
            } catch (_: Exception) { /* Missing template metadata is shown honestly in UI. */ }
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
        state.value = state.value.copy(table = null, hands = null, settlement = null, tableError = null, connection = "手动刷新")
        refreshTable(id)
    }
    fun closeTable() { tableId = null; state.value = state.value.copy(connection = "手动刷新") }
    fun refreshTable(id: String) { triggers.trySend(id) }

    private suspend fun loadTable(id: String, initial: Boolean) {
        if (initial || state.value.table == null) state.value = state.value.copy(tableLoading = true)
        try {
            val snapshot = api.json.decodeFromString<TableSnapshot>(api.get("/api/matches/$id"))
            if (tableId != id) return
            state.value = state.value.copy(table = snapshot, tableLoading = false, tableError = null)
            try {
                val hands = api.json.decodeFromString<List<HandDto>>(api.get("/api/matches/$id/hands?limit=100"))
                if (tableId == id) state.value = state.value.copy(hands = hands)
            } catch (e: Exception) { if (tableId == id) state.value = state.value.copy(tableError = "读取局记录失败：${error(e)}") }
            if (snapshot.match.status == "finished") {
                try {
                    val preview = api.json.decodeFromString<SettlementPreview>(api.get("/api/matches/$id/settlement/preview"))
                    if (tableId == id) state.value = state.value.copy(settlement = preview)
                } catch (e: Exception) { if (tableId == id) state.value = state.value.copy(tableError = "读取终局成绩失败：${error(e)}") }
            } else if (tableId == id) state.value = state.value.copy(settlement = null)
        } catch (e: Exception) {
            if (tableId == id) state.value = state.value.copy(tableLoading = false, tableError = error(e))
        }
    }

    /** Called only from a STARTED lifecycle collector on the visible table route. */
    suspend fun liveWhileVisible(id: String) {
        var failures = 0
        try {
            while (kotlin.coroutines.coroutineContext.isActive && tableId == id && state.value.authenticated) {
                state.value = state.value.copy(connection = "重连中")
                try {
                    val ticket = api.json.decodeFromString<TicketDto>(api.post("/api/matches/$id/ws-tickets")).ticket
                    if (ticket.isBlank()) throw IOException("实时连接凭据缺失")
                    val openedAt = awaitSocket(id, ticket)
                    if (openedAt != 0L && android.os.SystemClock.elapsedRealtime() - openedAt >= 10_000L) failures = 0
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) {
                    if (store.load() == null) {
                        state.value = AppState()
                        return
                    }
                    // Manual refresh remains available when a ticket/connection fails.
                }
                failures = (failures + 1).coerceAtMost(6)
                delay((1000L shl (failures - 1)).coerceAtMost(30_000L))
            }
        } finally {
            if (tableId == id) state.value = state.value.copy(connection = "手动刷新")
        }
    }

    private suspend fun awaitSocket(id: String, ticket: String): Long {
        var openedAt = 0L
        suspendCancellableCoroutine<Unit> { continuation ->
            val completed = java.util.concurrent.atomic.AtomicBoolean()
            val request = Request.Builder().url("${api.wsOrigin}/ws/matches/$id?ticket=${java.net.URLEncoder.encode(ticket, "UTF-8")}").build()
            val socket = api.client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (continuation.isActive && tableId == id) {
                        openedAt = android.os.SystemClock.elapsedRealtime()
                        state.value = state.value.copy(connection = "已连接")
                        triggers.trySend(id)
                    }
                }
                override fun onMessage(webSocket: WebSocket, text: String) { if (tableId == id) triggers.trySend(id) }
                override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) { if (tableId == id) triggers.trySend(id) }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (completed.compareAndSet(false, true)) continuation.resume(Unit)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (completed.compareAndSet(false, true)) continuation.resume(Unit)
                }
            })
            continuation.invokeOnCancellation { socket.cancel() }
        }
        return openedAt
    }
}
